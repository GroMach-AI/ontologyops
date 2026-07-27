from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app


def configured_client(tmp_path: Path, monkeypatch) -> TestClient:
    monkeypatch.setenv("ONTOLOGYOPS_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("ONTOLOGYOPS_METADATA_PATH", str(tmp_path / "metadata.db"))
    return TestClient(app)


def upload_csv(client: TestClient, filename: str, content: bytes) -> str:
    response = client.post("/api/sources/upload", files={"file": (filename, content, "text/csv")})
    assert response.status_code == 201
    return str(response.json()["dataset_version_id"])


def test_duplicate_key_dataset_cannot_be_trusted(tmp_path: Path, monkeypatch) -> None:
    client = configured_client(tmp_path, monkeypatch)
    dataset_id = upload_csv(client, "orders.csv", b"order_id\nPO-1\nPO-1\n")

    quality = client.post(
        f"/api/datasets/{dataset_id}/quality-check",
        json={"unique_fields": ["order_id"]},
    )

    assert quality.status_code == 200
    assert quality.json()["status"] == "fail"
    trusted = client.post(
        f"/api/datasets/{dataset_id}/trust",
        json={"decision": "trusted", "reason": ""},
    )
    assert trusted.status_code == 400
