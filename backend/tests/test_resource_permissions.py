from fastapi.testclient import TestClient

from app.main import app


def test_operator_cannot_change_model_or_publish_ontology(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("ONTOLOGYOPS_METADATA_PATH", str(tmp_path / "metadata.db"))
    client = TestClient(app)

    models = client.get("/api/models")
    provider_id = models.json()["providers"][0]["id"]
    denied_model = client.patch(
        f"/api/models/{provider_id}",
        headers={"X-Demo-Role": "operator"},
        json={"enabled": True, "is_default": True},
    )
    denied_publish = client.post("/api/ontology/publish", headers={"X-Demo-Role": "operator"})

    assert denied_model.status_code == 403
    assert denied_publish.status_code == 403
    events = client.get("/api/governance/audit").json()
    assert any(event["event_type"] == "permission_denied" for event in events)
