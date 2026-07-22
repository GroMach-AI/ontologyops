from __future__ import annotations

import json
import os
from pathlib import Path
from uuid import uuid4

import duckdb
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import runtime_metadata_engine
from app.domain.lineage import metric_lineage
from app.domain.authorization import RESTRICTED_FIELDS
from app.domain.quality import QualityRule, run_quality_rule
from app.models.platform import AuditEvent, QualityRuleRecord, QualityRunRecord
from app.services.audit import write_audit_event
from app.domain.authorization import require_resource_access


router = APIRouter(prefix="/api/governance", tags=["governance"])
ALLOWED_DATASETS = {"purchase_orders", "inventory", "suppliers"}
DEFAULT_QUALITY_RULES = (
    ("订单编号唯一性", "purchase_orders", "unique", "order_number"),
    ("应交日期完整性", "purchase_orders", "not_null", "promised_at"),
    ("库存数量非负", "inventory", "non_negative", "quantity_on_hand"),
)


class CreateQualityRuleRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    dataset_name: str
    rule_type: str
    field: str
    config: dict[str, object] = Field(default_factory=dict)


@router.post("/quality/rules", status_code=201)
def create_quality_rule(request: CreateQualityRuleRequest, x_demo_role: str = Header(default="modeler")) -> dict[str, object]:
    engine = runtime_metadata_engine()
    if not require_resource_access(engine, x_demo_role, "governance", "write"):
        raise HTTPException(status_code=403, detail="Role is not allowed to create quality rules")
    if request.dataset_name not in ALLOWED_DATASETS:
        raise HTTPException(status_code=400, detail="Unknown dataset")
    if request.rule_type not in {"unique", "not_null", "non_negative", "timely", "cross_field_equal"}:
        raise HTTPException(status_code=400, detail="Unsupported quality rule")
    record = QualityRuleRecord(
        id=str(uuid4()),
        name=request.name,
        dataset_name=request.dataset_name,
        rule_type=request.rule_type,
        field=request.field,
        config_json=json.dumps(request.config, ensure_ascii=False),
    )
    with Session(engine) as session:
        session.add(record)
        session.commit()
        rule_id = record.id
        serialized = _serialize_rule(record)
    write_audit_event(
        engine,
        actor=x_demo_role,
        event_type="quality_rule_created",
        resource_type="quality_rule",
        payload={"rule_id": rule_id},
    )
    return serialized


@router.get("/quality/rules")
def list_quality_rules() -> list[dict[str, object]]:
    engine = runtime_metadata_engine()
    _ensure_default_rules(engine)
    with Session(engine) as session:
        records = session.scalars(select(QualityRuleRecord)).all()
        runs = session.scalars(select(QualityRunRecord)).all()
        latest_by_rule: dict[str, QualityRunRecord] = {}
        for run in runs:
            if run.rule_id not in latest_by_rule or run.created_at > latest_by_rule[run.rule_id].created_at:
                latest_by_rule[run.rule_id] = run
        return [_serialize_rule(record, latest_by_rule.get(record.id)) for record in records]


@router.post("/quality/rules/{rule_id}/run")
def run_rule(rule_id: str, x_demo_role: str = Header(default="modeler")) -> dict[str, object]:
    engine = runtime_metadata_engine()
    if not require_resource_access(engine, x_demo_role, "governance", "run"):
        raise HTTPException(status_code=403, detail="Role is not allowed to run quality rules")
    with Session(engine) as session:
        record = session.get(QualityRuleRecord, rule_id)
        if record is None:
            raise HTTPException(status_code=404, detail="Quality rule not found")
        session.expunge(record)
    rows = _load_dataset_rows(record.dataset_name)
    result = run_quality_rule(
        QualityRule(id=record.id, rule_type=record.rule_type, field=record.field, config=json.loads(record.config_json)), rows
    )
    run = QualityRunRecord(
        id=str(uuid4()),
        rule_id=record.id,
        status=result.status,
        pass_rate=str(result.pass_rate),
        sample_json=json.dumps(result.sample_rows, ensure_ascii=False),
    )
    with Session(engine) as session:
        session.add(run)
        session.commit()
    write_audit_event(
        engine,
        actor=x_demo_role,
        event_type="quality_rule_run",
        resource_type="quality_rule",
        payload={"rule_id": record.id, "status": result.status},
    )
    return {
        "rule_id": record.id,
        "status": result.status,
        "pass_rate": result.pass_rate,
        "sample_rows": result.sample_rows,
    }


@router.get("/lineage/{resource_type}/{resource_id}")
def get_lineage(resource_type: str, resource_id: str) -> dict[str, object]:
    if resource_type != "metric":
        raise HTTPException(status_code=404, detail="Lineage resource is not available")
    try:
        return metric_lineage(resource_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail="Lineage resource is not available") from error


@router.get("/audit")
def list_audit_events(limit: int = 50) -> list[dict[str, object]]:
    with Session(runtime_metadata_engine()) as session:
        events = session.scalars(select(AuditEvent).order_by(AuditEvent.created_at.desc()).limit(limit)).all()
        return [
            {
                "id": event.id,
                "actor": event.actor,
                "event_type": event.event_type,
                "resource_type": event.resource_type,
                "payload": json.loads(event.payload_json),
                "created_at": event.created_at.isoformat(),
            }
            for event in events
        ]


@router.get("/permissions/preview")
def permission_preview(role: str) -> dict[str, object]:
    if role not in {"admin", "modeler", "operator"}:
        raise HTTPException(status_code=400, detail="Unknown role")
    hidden = sorted(RESTRICTED_FIELDS.get(role, {}).get("Supplier", set()))
    return {
        "role": role,
        "object": "Supplier",
        "visible_fields": ["supplier_id", "supplier_name", "risk_level"],
        "hidden_fields": hidden,
    }


def _load_dataset_rows(dataset_name: str) -> list[dict[str, object]]:
    data_dir = Path(os.getenv("ONTOLOGYOPS_DATA_DIR", "../data")).resolve()
    connection = duckdb.connect(str(data_dir / "ontologyops.duckdb"), read_only=True)
    try:
        cursor = connection.execute(f"SELECT * FROM {dataset_name}")
        columns = [column[0] for column in cursor.description]
        return [dict(zip(columns, row, strict=True)) for row in cursor.fetchall()]
    finally:
        connection.close()


def _serialize_rule(record: QualityRuleRecord, latest_run: QualityRunRecord | None = None) -> dict[str, object]:
    result: dict[str, object] = {
        "id": record.id,
        "name": record.name,
        "dataset_name": record.dataset_name,
        "rule_type": record.rule_type,
        "field": record.field,
        "config": json.loads(record.config_json),
    }
    if latest_run is not None:
        result["latest_run"] = {
            "status": latest_run.status,
            "pass_rate": float(latest_run.pass_rate),
            "sample_rows": json.loads(latest_run.sample_json),
            "created_at": latest_run.created_at.isoformat(),
        }
    else:
        result["latest_run"] = None
    return result


def _ensure_default_rules(engine) -> None:
    with Session(engine) as session:
        if session.scalar(select(QualityRuleRecord.id).limit(1)) is not None:
            return
        session.add_all(
            [
                QualityRuleRecord(
                    id=str(uuid4()),
                    name=name,
                    dataset_name=dataset_name,
                    rule_type=rule_type,
                    field=field,
                )
                for name, dataset_name, rule_type, field in DEFAULT_QUALITY_RULES
            ]
        )
        session.commit()
