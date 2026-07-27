from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import create_engine_and_schema
from app.domain.pipeline import PipelineService
from app.main import app
from app.models.platform import DataSource, Dataset


def test_pipeline_runs_fixed_six_stage_flow(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("ONTOLOGYOPS_DATA_DIR", str(tmp_path))
    client = TestClient(app)

    response = client.post(
        "/api/sources/upload",
        files={
            "file": (
                "orders.csv",
                b"order_number,supplier,quantity\nPO-1,Huadong,12\nPO-2,Beichen,8\n",
                "text/csv",
            )
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["lifecycle_status"] == "profiled"
    run = client.post(f"/api/pipelines/{body['pipeline_id']}/run", json={})
    assert run.status_code == 200
    result = run.json()
    assert [node["type"] for node in result["nodes"]] == [
        "source",
        "raw_dataset",
        "transform",
        "clean_dataset",
        "ontology_mapping",
        "publish",
    ]
    assert all(node["status"] == "success" for node in result["nodes"])
    assert result["preview"]["row_count"] == 2


def test_pipeline_result_can_be_registered_as_data_assets(tmp_path: Path) -> None:
    service = PipelineService(tmp_path)
    result = service.run_csv("orders.csv", b"order_number\nPO-1\n")
    engine = create_engine_and_schema(tmp_path / "metadata.db")

    service.register_result(engine, "orders.csv", "csv", result)

    with Session(engine) as session:
        source = session.scalar(select(DataSource))
        dataset = session.scalar(select(Dataset))
    assert source is not None
    assert source.name == "orders.csv"
    assert dataset is not None
    assert dataset.stage == "trusted"


def test_uploaded_assets_are_listed(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("ONTOLOGYOPS_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("ONTOLOGYOPS_METADATA_PATH", str(tmp_path / "metadata.db"))
    client = TestClient(app)

    client.post(
        "/api/sources/upload",
        files={"file": ("orders.csv", b"order_number\nPO-1\n", "text/csv")},
    )
    response = client.get("/api/sources")

    assert response.status_code == 200
    assert response.json()["sources"][0]["name"] == "orders.csv"
