from __future__ import annotations

import os
import json
from pathlib import Path
from uuid import uuid4

import duckdb
from fastapi import APIRouter, File, Header, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.pipeline import PipelineService
from app.core.database import runtime_metadata_engine
from app.models.platform import DataSource, Dataset, QualityRuleRecord, QualityRunRecord
from app.services.audit import write_audit_event
from app.domain.authorization import require_resource_access


router = APIRouter(prefix="/api/sources", tags=["data-sources"])
dataset_router = APIRouter(prefix="/api/datasets", tags=["datasets"])


class QualityCheckRequest(BaseModel):
    unique_fields: list[str] = Field(default_factory=list)


class TrustDatasetRequest(BaseModel):
    decision: str = Field(pattern="^(trusted|rejected)$")
    reason: str = Field(max_length=500)


@router.get("")
def list_sources() -> dict[str, object]:
    with Session(runtime_metadata_engine()) as session:
        sources = session.scalars(select(DataSource).order_by(DataSource.created_at.desc())).all()
        datasets = session.scalars(select(Dataset)).all()
    # Prefer the latest trusted result. Raw snapshots remain available for lineage.
    dataset_by_source: dict[str, Dataset] = {}
    for dataset in datasets:
        current = dataset_by_source.get(dataset.source_id)
        if current is None or (dataset.stage == "trusted" and current.stage != "trusted"):
            dataset_by_source[dataset.source_id] = dataset
    return {
        "sources": [
            {
                "id": source.id,
                "name": source.name,
                "kind": source.kind,
                "created_at": source.created_at.isoformat(),
                "pipeline_id": json.loads(source.config_json).get("pipeline_id"),
                "dataset": (
                    {
                        "id": dataset_by_source[source.id].id,
                        "stage": dataset_by_source[source.id].stage,
                        "schema": dataset_by_source[source.id].schema_json,
                    }
                    if source.id in dataset_by_source
                    else None
                ),
            }
            for source in sources
        ]
    }


@dataset_router.get("/{dataset_id}/preview")
def preview_dataset(dataset_id: str) -> dict[str, object]:
    with Session(runtime_metadata_engine()) as session:
        dataset = session.get(Dataset, dataset_id)
        if dataset is None:
            raise HTTPException(status_code=404, detail="Dataset not found")
        parquet_path = dataset.parquet_path
        lifecycle_status = dataset.stage
        schema = json.loads(dataset.schema_json)
    connection = duckdb.connect()
    try:
        escaped_path = parquet_path.replace("'", "''")
        cursor = connection.execute(f"SELECT * FROM read_parquet('{escaped_path}') LIMIT 20")
        columns = [column[0] for column in cursor.description]
        rows = [dict(zip(columns, row, strict=True)) for row in cursor.fetchall()]
    finally:
        connection.close()
    profile_columns = schema.get("columns", columns)
    return {
        "dataset_version_id": dataset_id,
        "lifecycle_status": lifecycle_status,
        "columns": profile_columns,
        "rows": rows,
        "row_count": len(rows),
    }


@dataset_router.post("/{dataset_id}/quality-check")
def run_dataset_quality_check(dataset_id: str, request: QualityCheckRequest) -> dict[str, object]:
    with Session(runtime_metadata_engine()) as session:
        dataset = session.get(Dataset, dataset_id)
        if dataset is None:
            raise HTTPException(status_code=404, detail="Dataset not found")
        parquet_path = dataset.parquet_path

    connection = duckdb.connect()
    try:
        described = connection.execute(
            f"DESCRIBE SELECT * FROM read_parquet('{parquet_path.replace("'", "''")}')"
        ).fetchall()
        available_fields = {str(column[0]) for column in described}
        unknown_fields = [field for field in request.unique_fields if field not in available_fields]
        if unknown_fields:
            raise HTTPException(status_code=400, detail=f"Unknown quality fields: {', '.join(unknown_fields)}")

        findings: list[dict[str, object]] = []
        for field in request.unique_fields:
            quoted = '"' + field.replace('"', '""') + '"'
            rows = connection.execute(
                f"SELECT {quoted}, COUNT(*) AS occurrences FROM read_parquet('{parquet_path.replace("'", "''")}') "
                f"WHERE {quoted} IS NOT NULL GROUP BY {quoted} HAVING COUNT(*) > 1 LIMIT 20"
            ).fetchall()
            findings.extend(
                {"field": field, "value": str(value), "occurrences": int(count), "rule": "unique"}
                for value, count in rows
            )
    finally:
        connection.close()

    status = "fail" if findings else "pass"
    run_id = str(uuid4())
    rule_id = str(uuid4())
    with Session(runtime_metadata_engine()) as session:
        session.add(
            QualityRuleRecord(
                id=rule_id,
                name=f"Dataset {dataset_id} uniqueness check",
                dataset_name=dataset_id,
                rule_type="unique",
                field=",".join(request.unique_fields),
                config_json=json.dumps({"unique_fields": request.unique_fields}),
            )
        )
        session.add(
            QualityRunRecord(
                id=run_id,
                rule_id=rule_id,
                status=status,
                pass_rate="100" if not findings else "0",
                sample_json=json.dumps(findings, ensure_ascii=False),
            )
        )
        session.commit()

    return {"quality_run_id": run_id, "dataset_version_id": dataset_id, "status": status, "findings": findings}


@dataset_router.post("/{dataset_id}/trust")
def decide_dataset_trust(dataset_id: str, request: TrustDatasetRequest) -> dict[str, object]:
    engine = runtime_metadata_engine()
    with Session(engine) as session:
        dataset = session.get(Dataset, dataset_id)
        if dataset is None:
            raise HTTPException(status_code=404, detail="Dataset not found")
        rule_ids = select(QualityRuleRecord.id).where(QualityRuleRecord.dataset_name == dataset_id)
        latest_run = session.scalars(
            select(QualityRunRecord).where(QualityRunRecord.rule_id.in_(rule_ids)).order_by(QualityRunRecord.created_at.desc())
        ).first()
        if request.decision == "trusted" and (latest_run is None or latest_run.status != "pass"):
            raise HTTPException(status_code=400, detail="A passing quality check is required before trusting this dataset")
        dataset.stage = request.decision
        session.commit()
    write_audit_event(
        engine,
        actor="modeler",
        event_type="dataset_trust_decided",
        resource_type="dataset_version",
        payload={"dataset_version_id": dataset_id, "decision": request.decision, "reason": request.reason},
    )
    return {"dataset_version_id": dataset_id, "lifecycle_status": request.decision}


@router.post("/upload", status_code=201)
async def upload_source(file: UploadFile = File(...), x_demo_role: str = Header(default="modeler")) -> dict[str, object]:
    engine = runtime_metadata_engine()
    if not require_resource_access(engine, x_demo_role, "data_source", "write"):
        raise HTTPException(status_code=403, detail="Role is not allowed to import data")
    filename = file.filename or "upload"
    extension = Path(filename).suffix.lower()
    content = await file.read()
    data_dir = Path(os.getenv("ONTOLOGYOPS_DATA_DIR", "../data")).resolve()
    if extension == ".xlsx":
        service = PipelineService(data_dir)
        result = service.register_upload(engine, filename, "xlsx", content)
        write_audit_event(engine, actor=x_demo_role, event_type="source_created", resource_type="data_source", payload=result)
        return result
    if extension != ".csv":
        raise HTTPException(
            status_code=400,
            detail="当前结构化数据管道支持 CSV；Excel 导入将在后续切片启用。",
        )
    service = PipelineService(data_dir)
    result = service.register_upload(engine, filename, "csv", content)
    write_audit_event(engine, actor=x_demo_role, event_type="source_created", resource_type="data_source", payload=result)
    return result
