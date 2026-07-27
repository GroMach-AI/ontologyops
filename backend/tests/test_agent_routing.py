from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app
from test_agent_ontology_query import create_published_sales_ontology, materialize_sales_orders


def configured_client(tmp_path: Path, monkeypatch) -> TestClient:
    monkeypatch.setenv("ONTOLOGYOPS_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("ONTOLOGYOPS_METADATA_PATH", str(tmp_path / "metadata.db"))
    return TestClient(app)


def test_agent_uses_previous_entity_context_for_follow_up_list(tmp_path: Path, monkeypatch) -> None:
    client = configured_client(tmp_path, monkeypatch)
    ontology_id = create_published_sales_ontology(client)
    materialize_sales_orders(client, ontology_id)

    response = client.post(
        "/api/agent/chat",
        headers={"X-Demo-Role": "modeler"},
        json={"message": "分别是哪几笔？", "context_entity_id": "SalesOrder"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["route"] == "ontology"
    assert body["tool_calls"][0]["entity_id"] == "SalesOrder"
    assert body["tool_calls"][0]["operation"] == "list"
    assert "SO-001" in body["answer"]


def test_agent_routes_non_ontology_question_to_general_knowledge(tmp_path: Path, monkeypatch) -> None:
    client = configured_client(tmp_path, monkeypatch)
    create_published_sales_ontology(client)

    response = client.post(
        "/api/agent/chat",
        headers={"X-Demo-Role": "modeler"},
        json={"message": "你是哪个模型？"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["route"] == "knowledge"
    assert body["tool_calls"] == []
    assert body["model"]["mode"] in {"real", "mock", "deterministic"}


def test_general_question_overrides_previous_entity_context(tmp_path: Path, monkeypatch) -> None:
    client = configured_client(tmp_path, monkeypatch)
    create_published_sales_ontology(client)

    response = client.post(
        "/api/agent/chat",
        headers={"X-Demo-Role": "modeler"},
        json={"message": "你是哪个模型？", "context_entity_id": "SalesOrder"},
    )

    assert response.status_code == 200
    assert response.json()["route"] == "knowledge"
