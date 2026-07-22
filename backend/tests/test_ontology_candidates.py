from fastapi.testclient import TestClient

from app.main import app


def test_mock_candidate_can_be_saved_as_draft_and_published(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("ONTOLOGYOPS_METADATA_PATH", str(tmp_path / "metadata.db"))
    client = TestClient(app)

    candidate = client.post("/api/ontology/candidates", json={"datasets": ["purchase_orders"]})
    assert candidate.status_code == 200
    assert candidate.json()["mode"] == "mock"

    saved = client.patch("/api/ontology/draft", json={"definition": candidate.json()["definition"]})
    assert saved.status_code == 200
    assert saved.json()["status"] == "draft"

    loaded_draft = client.get("/api/ontology/draft")
    assert loaded_draft.status_code == 200
    assert loaded_draft.json()["definition"]["functions"]

    impact = client.get("/api/ontology/draft/impact")
    assert impact.status_code == 200
    assert "affected" in impact.json()

    published = client.post("/api/ontology/publish")
    assert published.status_code == 200
    assert published.json()["status"] == "published"

    history = client.get("/api/ontology/versions")
    assert history.status_code == 200
    version_id = history.json()["versions"][0]["id"]
    rollback = client.post(f"/api/ontology/versions/{version_id}/rollback")
    assert rollback.status_code == 200
    assert rollback.json()["status"] == "draft"


def test_candidate_includes_editable_semantic_resources(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("ONTOLOGYOPS_METADATA_PATH", str(tmp_path / "metadata.db"))
    client = TestClient(app)

    response = client.post("/api/ontology/candidates", json={"datasets": ["purchase_orders", "inventory"]})
    assert response.status_code == 200
    definition = response.json()["definition"]
    assert definition["objects"][0]["attributes"]
    assert definition["links"][0]["cardinality"]
    assert definition["mappings"]
    assert definition["functions"]
