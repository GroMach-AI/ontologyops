from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from io import BytesIO
from pathlib import Path
from uuid import uuid4

import duckdb
import pandas as pd
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session

from app.models.platform import DataSource, Dataset, PipelineNodeRun, PipelineRun


FIXED_NODE_TYPES = (
    "source",
    "raw_dataset",
    "transform",
    "clean_dataset",
    "ontology_mapping",
    "publish",
)


@dataclass(frozen=True)
class PipelineNodeResult:
    type: str
    status: str
    output: str


@dataclass(frozen=True)
class PipelineResult:
    source_id: str
    dataset_id: str
    pipeline_id: str
    nodes: list[PipelineNodeResult]
    preview: dict[str, object]

    def to_dict(self) -> dict[str, object]:
        return {
            "source_id": self.source_id,
            "dataset_id": self.dataset_id,
            "pipeline_id": self.pipeline_id,
            "nodes": [asdict(node) for node in self.nodes],
            "preview": self.preview,
        }


class PipelineService:
    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir
        self.upload_dir = data_dir / "uploads"
        self.dataset_dir = data_dir / "datasets"
        self.database_path = data_dir / "pipeline.duckdb"
        self.upload_dir.mkdir(parents=True, exist_ok=True)
        self.dataset_dir.mkdir(parents=True, exist_ok=True)

    def run_csv(self, filename: str, content: bytes) -> PipelineResult:
        source_id = str(uuid4())
        dataset_id = str(uuid4())
        pipeline_id = str(uuid4())
        source_path = self.upload_dir / f"{source_id}-{_safe_filename(filename)}"
        source_path.write_bytes(content)

        table_name = f"dataset_{dataset_id.replace('-', '_')}"
        raw_path = self.dataset_dir / f"{dataset_id}-raw.parquet"
        clean_path = self.dataset_dir / f"{dataset_id}-clean.parquet"
        connection = duckdb.connect(str(self.database_path))
        try:
            path_sql = source_path.as_posix().replace("'", "''")
            connection.execute(
                f"CREATE TABLE {table_name} AS SELECT * FROM read_csv_auto('{path_sql}')"
            )
            raw_sql = raw_path.as_posix().replace("'", "''")
            clean_sql = clean_path.as_posix().replace("'", "''")
            connection.execute(f"COPY {table_name} TO '{raw_sql}' (FORMAT PARQUET)")
            connection.execute(
                f"CREATE TABLE {table_name}_clean AS SELECT DISTINCT * FROM {table_name}"
            )
            connection.execute(
                f"COPY {table_name}_clean TO '{clean_sql}' (FORMAT PARQUET)"
            )
            rows = connection.execute(f"SELECT * FROM {table_name}_clean LIMIT 20").fetchall()
            columns = [column[0] for column in connection.description]
            total = connection.execute(
                f"SELECT COUNT(*) FROM {table_name}_clean"
            ).fetchone()[0]
        finally:
            connection.close()

        return PipelineResult(
            source_id=source_id,
            dataset_id=dataset_id,
            pipeline_id=pipeline_id,
            nodes=[
                PipelineNodeResult("source", "success", filename),
                PipelineNodeResult("raw_dataset", "success", raw_path.name),
                PipelineNodeResult("transform", "success", "deduplicate"),
                PipelineNodeResult("clean_dataset", "success", clean_path.name),
                PipelineNodeResult("ontology_mapping", "success", "mapping-ready"),
                PipelineNodeResult("publish", "success", "trusted-dataset"),
            ],
            preview={
                "columns": columns,
                "rows": [dict(zip(columns, row, strict=True)) for row in rows],
                "row_count": total,
            },
        )

    def run_excel(self, filename: str, content: bytes) -> PipelineResult:
        dataframe = pd.read_excel(BytesIO(content))
        normalized_csv = dataframe.to_csv(index=False).encode("utf-8")
        return self.run_csv(f"{Path(filename).stem}.csv", normalized_csv)

    def register_upload(
        self,
        engine: Engine,
        filename: str,
        kind: str,
        content: bytes,
    ) -> dict[str, object]:
        source_id = str(uuid4())
        source_path = self.upload_dir / f"{source_id}-{_safe_filename(filename)}"
        source_path.write_bytes(content)
        dataframe = self._read_dataframe(source_path, kind)
        dataset_id = str(uuid4())
        dataset_path = self.dataset_dir / f"{dataset_id}-profiled.parquet"
        _write_dataframe_parquet(dataframe, dataset_path)
        profile = _profile_dataframe(dataframe)
        with Session(engine) as session:
            session.add(
                DataSource(
                    id=source_id,
                    kind=kind,
                    name=filename,
                    config_json=json.dumps({"path": str(source_path), "pipeline_id": source_id}),
                )
            )
            session.add(
                Dataset(
                    id=dataset_id,
                    source_id=source_id,
                    stage="profiled",
                    schema_json=json.dumps({"columns": profile}, ensure_ascii=False),
                    parquet_path=str(dataset_path),
                )
            )
            session.commit()
        return {
            "source_id": source_id,
            "pipeline_id": source_id,
            "dataset_version_id": dataset_id,
            "lifecycle_status": "profiled",
            "profile": profile,
        }

    def run_registered_pipeline(
        self,
        engine: Engine,
        pipeline_id: str,
        transforms: list[dict[str, object]],
    ) -> dict[str, object]:
        with Session(engine) as session:
            source = session.get(DataSource, pipeline_id)
            if source is None:
                raise KeyError("Pipeline source not found")
            source_id = source.id
            filename = source.name
            kind = source.kind
            config = json.loads(source.config_json)
        if kind not in {"csv", "xlsx"}:
            raise ValueError("Only structured sources can run a data pipeline")

        run_id = str(uuid4())
        with Session(engine) as session:
            session.add(PipelineRun(id=run_id, source_id=source_id, status="running"))
            session.commit()
        try:
            dataframe = self._read_registered_dataframe(config, kind)
            input_rows = len(dataframe)
            raw_dataset_id = str(uuid4())
            dataset_id = str(uuid4())
            raw_path = self.dataset_dir / f"{raw_dataset_id}-raw.parquet"
            clean_path = self.dataset_dir / f"{dataset_id}-clean.parquet"
            _write_dataframe_parquet(dataframe, raw_path)
            clean = _apply_transforms(dataframe, transforms).drop_duplicates()
            _write_dataframe_parquet(clean, clean_path)
            preview = _dataframe_preview(clean)
            nodes = [
                PipelineNodeResult("source", "success", filename),
                PipelineNodeResult("raw_dataset", "success", raw_path.name),
                PipelineNodeResult("transform", "success", _transform_summary(transforms)),
                PipelineNodeResult("clean_dataset", "success", clean_path.name),
                PipelineNodeResult("ontology_mapping", "success", "mapping-ready"),
                PipelineNodeResult("publish", "success", "trusted-dataset"),
            ]
            with Session(engine) as session:
                session.add_all(
                    [
                        Dataset(
                            id=raw_dataset_id,
                            source_id=source_id,
                            stage="raw",
                            schema_json=json.dumps({"columns": list(dataframe.columns)}),
                            parquet_path=str(raw_path),
                        ),
                        Dataset(
                            id=dataset_id,
                            source_id=source_id,
                            stage="trusted",
                            schema_json=json.dumps({"columns": preview["columns"]}),
                            parquet_path=str(clean_path),
                        ),
                    ]
                )
                run = session.get(PipelineRun, run_id)
                assert run is not None
                run.status = "success"
                run.input_rows = input_rows
                run.output_rows = int(preview["row_count"])
                session.add_all(
                    [
                        PipelineNodeRun(
                            id=str(uuid4()),
                            pipeline_run_id=run_id,
                            node_type=node.type,
                            status=node.status,
                            output_json=json.dumps({"output": node.output}, ensure_ascii=False),
                        )
                        for node in nodes
                    ]
                )
                session.commit()
            return {
                "id": run_id,
                "pipeline_id": pipeline_id,
                "source_id": source_id,
                "dataset_id": dataset_id,
                "status": "success",
                "input_rows": input_rows,
                "output_rows": preview["row_count"],
                "nodes": [asdict(node) for node in nodes],
                "preview": preview,
            }
        except Exception as error:
            with Session(engine) as session:
                run = session.get(PipelineRun, run_id)
                if run is not None:
                    run.status = "failed"
                    run.error_message = str(error)
                    session.commit()
            raise

    def list_pipeline_runs(self, engine: Engine, pipeline_id: str) -> dict[str, object]:
        with Session(engine) as session:
            runs = session.scalars(
                select(PipelineRun)
                .where(PipelineRun.source_id == pipeline_id)
                .order_by(PipelineRun.created_at.desc())
            ).all()
            node_runs = session.scalars(select(PipelineNodeRun)).all()
        nodes_by_run: dict[str, list[PipelineNodeRun]] = {}
        for node in node_runs:
            nodes_by_run.setdefault(node.pipeline_run_id, []).append(node)
        return {
            "runs": [
                {
                    "id": run.id,
                    "status": run.status,
                    "input_rows": run.input_rows,
                    "output_rows": run.output_rows,
                    "error_message": run.error_message,
                    "created_at": run.created_at.isoformat(),
                    "nodes": [
                        {
                            "type": node.node_type,
                            "status": node.status,
                            "output": json.loads(node.output_json).get("output"),
                        }
                        for node in nodes_by_run.get(run.id, [])
                    ],
                }
                for run in runs
            ]
        }

    def register_result(
        self,
        engine: Engine,
        filename: str,
        kind: str,
        result: PipelineResult,
    ) -> None:
        schema = {"columns": result.preview["columns"]}
        clean_path = self.dataset_dir / f"{result.dataset_id}-clean.parquet"
        with Session(engine) as session:
            session.add(
                DataSource(
                    id=result.source_id,
                    kind=kind,
                    name=filename,
                    config_json=json.dumps({"pipeline_id": result.pipeline_id}),
                )
            )
            session.add(
                Dataset(
                    id=result.dataset_id,
                    source_id=result.source_id,
                    stage="trusted",
                    schema_json=json.dumps(schema, ensure_ascii=False),
                    parquet_path=str(clean_path),
                )
            )
            session.commit()

    def _read_dataframe(self, path: Path, kind: str) -> pd.DataFrame:
        if kind == "xlsx":
            return pd.read_excel(path)
        return pd.read_csv(path)

    def _read_registered_dataframe(self, config: dict[str, object], kind: str) -> pd.DataFrame:
        return self._read_dataframe(Path(str(config["path"])), kind)


def _safe_filename(filename: str) -> str:
    return Path(filename).name.replace(" ", "_")


def _apply_transforms(dataframe: pd.DataFrame, transforms: list[dict[str, object]]) -> pd.DataFrame:
    result = dataframe.copy()
    for transform in transforms:
        transform_type = transform.get("type")
        if transform_type == "rename":
            source = str(transform.get("from", ""))
            target = str(transform.get("to", ""))
            if source not in result.columns or not target:
                raise ValueError("Invalid rename transform")
            result = result.rename(columns={source: target})
        elif transform_type == "select":
            fields = transform.get("fields")
            if not isinstance(fields, list) or any(field not in result.columns for field in fields):
                raise ValueError("Invalid select transform")
            result = result[[str(field) for field in fields]]
        elif transform_type == "drop_null":
            field = str(transform.get("field", ""))
            if field not in result.columns:
                raise ValueError("Invalid drop_null transform")
            result = result.dropna(subset=[field])
        elif transform_type == "fill_null":
            field = str(transform.get("field", ""))
            if field not in result.columns:
                raise ValueError("Invalid fill_null transform")
            result[field] = result[field].fillna(transform.get("value"))
        elif transform_type == "filter_equals":
            field = str(transform.get("field", ""))
            if field not in result.columns:
                raise ValueError("Invalid filter transform")
            result = result[result[field] == transform.get("value")]
        elif transform_type == "cast":
            field = str(transform.get("field", ""))
            dtype = str(transform.get("dtype", ""))
            if field not in result.columns or dtype not in {"string", "int", "float"}:
                raise ValueError("Invalid cast transform")
            target_type = {"string": "string", "int": "int64", "float": "float64"}[dtype]
            result[field] = result[field].astype(target_type)
        else:
            raise ValueError("Unsupported transform")
    return result


def _transform_summary(transforms: list[dict[str, object]]) -> str:
    return ", ".join(str(item.get("type")) for item in transforms) if transforms else "deduplicate"


def _dataframe_preview(dataframe: pd.DataFrame) -> dict[str, object]:
    rows = dataframe.head(20).where(pd.notnull(dataframe.head(20)), None).to_dict(orient="records")
    return {"columns": list(dataframe.columns), "rows": rows, "row_count": len(dataframe)}


def _profile_dataframe(dataframe: pd.DataFrame) -> list[dict[str, object]]:
    """Return a bounded, serialisable column profile for a DatasetVersion."""
    profile: list[dict[str, object]] = []
    for column in dataframe.columns:
        series = dataframe[column]
        non_null = series.dropna()
        total = len(series)
        profile.append(
            {
                "name": str(column),
                "type": str(series.dtype),
                "unique_count": int(non_null.nunique()),
                "null_percent": round((total - len(non_null)) / max(total, 1) * 100, 1),
                "samples": [str(value) for value in non_null.head(5).tolist()],
            }
        )
    return profile


def _write_dataframe_parquet(dataframe: pd.DataFrame, path: Path) -> None:
    connection = duckdb.connect()
    try:
        connection.register("frame", dataframe)
        escaped_path = path.as_posix().replace("'", "''")
        connection.execute(f"COPY frame TO '{escaped_path}' (FORMAT PARQUET)")
    finally:
        connection.close()
