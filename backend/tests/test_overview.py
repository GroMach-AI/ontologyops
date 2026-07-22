from fastapi.testclient import TestClient

from app.main import app


def test_overview_reads_platform_state(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("ONTOLOGYOPS_METADATA_PATH", str(tmp_path / "metadata.db"))
    client = TestClient(app)
    client.post("/api/ontology/publish-factory")

    response = client.get("/api/overview")

    assert response.status_code == 200
    assert response.json()["published_ontology"]["semantic_version"] == "v1.0.0"
    assert "recent_activity" in response.json()
