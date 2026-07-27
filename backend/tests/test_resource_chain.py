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


def create_supplier_draft(client: TestClient, dataset_id: str) -> str:
    response = client.post(
        "/api/ontology-drafts",
        json={
            "name": "供应链本体",
            "scope": "供应商管理",
            "entities": [
                {
                    "id": "supplier",
                    "name": "Supplier",
                    "primary_key": "supplier_id",
                    "properties": ["supplier_id", "name"],
                }
            ],
            "relationships": [],
            "mappings": [
                {
                    "entity_id": "supplier",
                    "dataset_version_id": dataset_id,
                    "field_mappings": {"supplier_id": "supplier_id", "name": "name"},
                }
            ],
            "candidate_decisions": [],
        },
    )
    assert response.status_code == 201
    return str(response.json()["draft_id"])


def test_untrusted_mapping_blocks_release(tmp_path: Path, monkeypatch) -> None:
    client = configured_client(tmp_path, monkeypatch)
    dataset_id = upload_csv(client, "suppliers.csv", b"supplier_id,name\nS-1,Neo\n")
    draft_id = create_supplier_draft(client, dataset_id)

    response = client.post(f"/api/ontology-drafts/{draft_id}/validate")

    assert response.status_code == 200
    assert response.json()["valid"] is False
    assert response.json()["blockers"] == [
        {
            "code": "mapping_dataset_not_trusted",
            "message": "映射引用的数据集版本尚未可信。",
            "resource_id": dataset_id,
        }
    ]


def trust_uploaded_supplier_dataset(client: TestClient) -> str:
    dataset_id = upload_csv(client, "suppliers.csv", b"supplier_id,name\nS-1,Neo\n")
    assert client.post(f"/api/datasets/{dataset_id}/quality-check", json={"unique_fields": ["supplier_id"]}).json()["status"] == "pass"
    assert client.post(f"/api/datasets/{dataset_id}/trust", json={"decision": "trusted", "reason": "质量通过"}).status_code == 200
    return dataset_id


def test_valid_draft_publishes_immutable_manifest(tmp_path: Path, monkeypatch) -> None:
    client = configured_client(tmp_path, monkeypatch)
    dataset_id = trust_uploaded_supplier_dataset(client)
    draft_id = create_supplier_draft(client, dataset_id)

    published = client.post(f"/api/ontology-drafts/{draft_id}/publish")

    assert published.status_code == 201
    body = published.json()
    assert body["status"] == "published"
    assert body["semantic_version"] == "v1"
    assert body["manifest"]["mappings"][0]["dataset_version_id"] == dataset_id


def test_mapping_with_unknown_source_field_blocks_release(tmp_path: Path, monkeypatch) -> None:
    client = configured_client(tmp_path, monkeypatch)
    dataset_id = trust_uploaded_supplier_dataset(client)
    response = client.post(
        "/api/ontology-drafts",
        json={
            "name": "供应链本体",
            "scope": "供应商管理",
            "entities": [{"id": "supplier", "name": "Supplier", "primary_key": "supplier_id", "properties": ["supplier_id"]}],
            "relationships": [],
            "mappings": [{"entity_id": "supplier", "dataset_version_id": dataset_id, "field_mappings": {"supplier_id": "missing_column"}}],
            "candidate_decisions": [],
        },
    )
    draft_id = response.json()["draft_id"]

    validation = client.post(f"/api/ontology-drafts/{draft_id}/validate")

    assert validation.json()["valid"] is False
    assert validation.json()["blockers"][0]["code"] == "mapping_source_field_missing"
