from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app


def test_file_upload_creates_profiled_dataset_version(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("ONTOLOGYOPS_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("ONTOLOGYOPS_METADATA_PATH", str(tmp_path / "metadata.db"))
    client = TestClient(app)

    response = client.post(
        "/api/sources/upload",
        files={"file": ("orders.csv", b"order_id,qty\nPO-1,2\n", "text/csv")},
    )

    assert response.status_code == 201
    assert response.json()["lifecycle_status"] == "profiled"
    dataset_version_id = response.json()["dataset_version_id"]
    preview = client.get(f"/api/datasets/{dataset_version_id}/preview")
    assert preview.status_code == 200
    assert preview.json()["lifecycle_status"] == "profiled"
    assert preview.json()["columns"][0]["name"] == "order_id"


def test_upload_then_manual_pipeline_run_persists_node_history(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("ONTOLOGYOPS_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("ONTOLOGYOPS_METADATA_PATH", str(tmp_path / "metadata.db"))
    client = TestClient(app)

    uploaded = client.post(
        "/api/sources/upload",
        files={"file": ("orders.csv", b"order_no,qty\nPO-1,1\nPO-1,1\n", "text/csv")},
    )
    assert uploaded.status_code == 201
    assert uploaded.json()["pipeline_id"]
    assert uploaded.json()["lifecycle_status"] == "profiled"

    result = client.post(
        f"/api/pipelines/{uploaded.json()['pipeline_id']}/run",
        json={"transforms": [{"type": "rename", "from": "order_no", "to": "order_number"}]},
    )
    assert result.status_code == 200
    body = result.json()
    assert body["status"] == "success"
    assert body["input_rows"] == 2
    assert body["output_rows"] == 1
    assert body["preview"]["columns"] == ["order_number", "qty"]

    history = client.get(f"/api/pipelines/{uploaded.json()['pipeline_id']}/runs")
    assert history.status_code == 200
    assert history.json()["runs"][0]["nodes"][2]["type"] == "transform"

    preview = client.get(f"/api/datasets/{body['dataset_id']}/preview")
    assert preview.status_code == 200
    assert preview.json()["rows"][0]["order_number"] == "PO-1"
