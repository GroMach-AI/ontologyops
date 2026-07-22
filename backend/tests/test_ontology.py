from fastapi.testclient import TestClient

from app.domain.ontology import normalize_definition
from app.main import app


def test_publish_factory_ontology_creates_immutable_version(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("ONTOLOGYOPS_METADATA_PATH", str(tmp_path / "metadata.db"))
    client = TestClient(app)

    response = client.post("/api/ontology/publish-factory")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "published"
    assert body["semantic_version"] == "v1.0.0"
    assert len(body["definition"]["objects"]) == 6
    assert len(body["definition"]["metrics"]) == 2
    assert len(body["definition"]["rules"]) == 2


def test_legacy_definition_is_normalized_for_the_resource_editor() -> None:
    legacy_definition = {
        "objects": [{"id": "Supplier"}],
        "links": [{"name": "supplier_orders"}],
        "metrics": [],
        "rules": [],
    }

    normalized = normalize_definition(legacy_definition)

    assert normalized["objects"][0]["attributes"]
    assert normalized["links"][0]["cardinality"] == "one_to_many"
    assert normalized["mappings"]
    assert normalized["functions"]
    assert normalized["policies"]
