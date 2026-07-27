from fastapi.testclient import TestClient

from app.main import app


def test_resource_api_creates_transitions_and_reads_relation(tmp_path, monkeypatch):
    monkeypatch.setenv("ONTOLOGYOPS_METADATA_PATH", str(tmp_path / "metadata.db"))
    client = TestClient(app)

    created = client.post(
        "/api/v1/resources",
        json={
            "resource_type": "dataset_version",
            "display_name": "新供应商文件",
            "metadata": {},
        },
        headers={"X-Demo-Role": "modeler"},
    )
    assert created.status_code == 201
    resource_id = created.json()["id"]

    transitioned = client.post(
        f"/api/v1/resources/{resource_id}/transition",
        json={"target_status": "profiled"},
        headers={"X-Demo-Role": "modeler"},
    )
    assert transitioned.status_code == 200
    assert transitioned.json()["lifecycle_status"] == "profiled"

    source = client.post(
        "/api/v1/resources",
        json={"resource_type": "source_asset", "display_name": "供应商 CSV", "metadata": {}},
        headers={"X-Demo-Role": "modeler"},
    )
    relation = client.post(
        f"/api/v1/resources/{source.json()['id']}/relations",
        json={"to_resource_id": resource_id, "relation_type": "produced_by"},
        headers={"X-Demo-Role": "modeler"},
    )
    assert relation.status_code == 201

    relations = client.get(f"/api/v1/resources/{source.json()['id']}/relations?direction=outgoing")
    assert relations.status_code == 200
    assert relations.json()["relations"][0]["to_resource_id"] == resource_id


def test_operator_cannot_modify_resources(tmp_path, monkeypatch):
    monkeypatch.setenv("ONTOLOGYOPS_METADATA_PATH", str(tmp_path / "metadata.db"))
    client = TestClient(app)

    response = client.post(
        "/api/v1/resources",
        json={"resource_type": "source_asset", "display_name": "受限文件", "metadata": {}},
        headers={"X-Demo-Role": "operator"},
    )

    assert response.status_code == 403
    assert response.json()["code"] == "forbidden"
