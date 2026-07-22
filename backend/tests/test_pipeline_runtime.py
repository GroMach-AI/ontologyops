from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app


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
    assert uploaded.json()["status"] == "ready"

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


def test_mysql_source_can_be_saved_without_persisting_password(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("ONTOLOGYOPS_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("ONTOLOGYOPS_METADATA_PATH", str(tmp_path / "metadata.db"))

    class Cursor:
        def execute(self, _sql): pass
        def fetchall(self): return [("purchase_orders",)]
        def __enter__(self): return self
        def __exit__(self, *_args): return None
    class Connection:
        def cursor(self): return Cursor()
        def close(self): pass
    monkeypatch.setattr("app.api.data_sources.pymysql.connect", lambda **_kwargs: Connection())
    client = TestClient(app)
    response = client.post("/api/sources/mysql", json={"host": "db.local", "username": "readonly", "password": "secret", "password_env": "DEMO_MYSQL_PASSWORD", "database": "factory", "table": "purchase_orders"})

    assert response.status_code == 201
    listed = client.get("/api/sources").json()["sources"]
    saved = next(source for source in listed if source["kind"] == "mysql")
    assert "secret" not in str(saved)
    assert saved["name"] == "factory.purchase_orders"
