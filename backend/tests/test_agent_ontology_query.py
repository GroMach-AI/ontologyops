from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app


def configured_client(tmp_path: Path, monkeypatch) -> TestClient:
    monkeypatch.setenv("ONTOLOGYOPS_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("ONTOLOGYOPS_METADATA_PATH", str(tmp_path / "metadata.db"))
    return TestClient(app)


def create_published_sales_ontology(client: TestClient) -> str:
    created = client.post(
        "/api/ontology-drafts/list",
        json={
            "id": "onto-agent-sales",
            "name": "制造业本体",
            "scope": "销售与生产履约",
            "objects": 2,
            "links": 0,
            "entities": [
                {
                    "name": "SalesOrder",
                    "label": "销售订单",
                    "description": "客户下达的销售订单",
                    "properties": [
                        {"name": "order_id", "type": "string", "is_key": True, "description": "订单唯一标识"},
                        {"name": "customer_code", "type": "string", "is_key": False, "description": "客户编码"},
                    ],
                },
                {
                    "name": "Supplier",
                    "label": "供应商",
                    "description": "供应物料的外部合作方",
                    "properties": [
                        {"name": "supplier_id", "type": "string", "is_key": True, "description": "供应商唯一标识"},
                    ],
                },
            ],
            "relationships": [],
        },
    )
    assert created.status_code == 200
    assert client.post(f"/api/ontology-drafts/{created.json()['draft_id']}/publish").status_code == 201
    return "onto-agent-sales"


def materialize_sales_orders(client: TestClient, ontology_id: str) -> None:
    upload = client.post(
        "/api/sources/upload",
        files={"file": ("sales_orders.csv", b"sales_order_no,customer_code\nSO-001,C-001\nSO-002,C-002\n", "text/csv")},
    ).json()
    run = client.post(f"/api/pipelines/{upload['pipeline_id']}/run", json={}).json()
    assert client.post(f"/api/datasets/{run['dataset_id']}/quality-check", json={"unique_fields": ["sales_order_no"]}).json()["status"] == "pass"
    assert client.post(f"/api/datasets/{run['dataset_id']}/trust", json={"decision": "trusted", "reason": "质量通过"}).status_code == 200
    materialized = client.post(
        f"/api/pipelines/{upload['pipeline_id']}/materialize",
        json={
            "dataset_id": run["dataset_id"],
            "ontology_id": ontology_id,
            "entity_id": "SalesOrder",
            "primary_key_field": "sales_order_no",
            "field_mappings": {"order_id": "sales_order_no", "customer_code": "customer_code"},
        },
    )
    assert materialized.status_code == 201


def test_agent_counts_only_materialized_published_entity_data(tmp_path: Path, monkeypatch) -> None:
    client = configured_client(tmp_path, monkeypatch)
    ontology_id = create_published_sales_ontology(client)
    materialize_sales_orders(client, ontology_id)

    response = client.post("/api/agent/chat", headers={"X-Demo-Role": "modeler"}, json={"message": "目前有多少销售订单？"})

    assert response.status_code == 200
    body = response.json()
    assert "2" in body["answer"]
    assert body["tool_calls"] == [{"name": "query_entity_instances", "entity_id": "SalesOrder", "operation": "count", "status": "success"}]
    assert body["evidence"][0]["kind"] == "entity_count"
    assert body["evidence"][0]["dataset_id"]
    assert body["provenance"]["ontology_version"] == "v1"


def test_agent_says_no_data_when_published_entity_has_no_instances(tmp_path: Path, monkeypatch) -> None:
    client = configured_client(tmp_path, monkeypatch)
    ontology_id = create_published_sales_ontology(client)
    materialize_sales_orders(client, ontology_id)

    response = client.post("/api/agent/chat", headers={"X-Demo-Role": "modeler"}, json={"message": "有哪些供应商？"})

    assert response.status_code == 200
    body = response.json()
    assert "供应商" in body["answer"]
    assert "尚无已映射数据" in body["answer"]
    assert body["evidence"] == [{"kind": "entity_no_data", "entity_id": "Supplier", "entity_label": "供应商"}]
