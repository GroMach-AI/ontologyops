from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app


def configured_client(tmp_path: Path, monkeypatch) -> TestClient:
    monkeypatch.setenv("ONTOLOGYOPS_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("ONTOLOGYOPS_METADATA_PATH", str(tmp_path / "metadata.db"))
    return TestClient(app)


def create_published_sales_order_ontology(client: TestClient) -> str:
    saved = client.post(
        "/api/ontology-drafts/list",
        json={
            "id": "onto-sales-orders",
            "name": "制造业本体",
            "scope": "销售与生产履约",
            "objects": 1,
            "links": 0,
            "entities": [
                {
                    "name": "SalesOrder",
                    "label": "销售订单",
                    "description": "客户销售订单",
                    "properties": [
                        {"name": "order_id", "type": "string", "is_key": True, "description": "订单唯一标识"},
                        {"name": "customer_code", "type": "string", "is_key": False, "description": "客户编码"},
                        {"name": "quantity", "type": "integer", "is_key": False, "description": "订单数量"},
                    ],
                }
            ],
            "relationships": [],
        },
    )
    assert saved.status_code == 200
    draft_id = saved.json()["draft_id"]
    assert client.post(f"/api/ontology-drafts/{draft_id}/publish").status_code == 201
    return "onto-sales-orders"


def test_materialization_rejects_profiled_dataset(tmp_path: Path, monkeypatch) -> None:
    client = configured_client(tmp_path, monkeypatch)
    ontology_id = create_published_sales_order_ontology(client)
    uploaded = client.post(
        "/api/sources/upload",
        files={"file": ("sales.csv", b"sales_order_no,customer_code,quantity\nSO-001,C-001,20\n", "text/csv")},
    ).json()

    response = client.post(
        f"/api/pipelines/{uploaded['pipeline_id']}/materialize",
        json={
            "dataset_id": uploaded["dataset_version_id"],
            "ontology_id": ontology_id,
            "entity_id": "SalesOrder",
            "primary_key_field": "sales_order_no",
            "field_mappings": {"order_id": "sales_order_no", "customer_code": "customer_code", "quantity": "quantity"},
        },
    )

    assert response.status_code == 400
    assert "trusted" in response.json()["detail"]


def test_trusted_dataset_materializes_entity_instances_and_returns_evidence(tmp_path: Path, monkeypatch) -> None:
    client = configured_client(tmp_path, monkeypatch)
    ontology_id = create_published_sales_order_ontology(client)
    uploaded = client.post(
        "/api/sources/upload",
        files={"file": ("sales.csv", b"sales_order_no,customer_code,quantity\nSO-001,C-001,20\nSO-002,C-002,8\n", "text/csv")},
    ).json()
    run = client.post(f"/api/pipelines/{uploaded['pipeline_id']}/run", json={}).json()
    checked = client.post(f"/api/datasets/{run['dataset_id']}/quality-check", json={"unique_fields": ["sales_order_no"]})
    assert checked.status_code == 200
    trusted = client.post(f"/api/datasets/{run['dataset_id']}/trust", json={"decision": "trusted", "reason": "订单号唯一性校验通过"})
    assert trusted.status_code == 200

    materialized = client.post(
        f"/api/pipelines/{uploaded['pipeline_id']}/materialize",
        json={
            "dataset_id": run["dataset_id"],
            "ontology_id": ontology_id,
            "entity_id": "SalesOrder",
            "primary_key_field": "sales_order_no",
            "field_mappings": {"order_id": "sales_order_no", "customer_code": "customer_code", "quantity": "quantity"},
        },
    )

    assert materialized.status_code == 201
    assert materialized.json()["written_count"] == 2
    assert materialized.json()["total_count"] == 2
    assert materialized.json()["pipeline_run_id"] == run["id"]

    instances = client.get(f"/api/ontologies/{ontology_id}/entities/SalesOrder/instances")
    assert instances.status_code == 200
    body = instances.json()
    assert body["total"] == 2
    assert body["items"][0]["properties"]["order_id"] == "SO-001"
    assert body["items"][0]["source_dataset_id"] == run["dataset_id"]
    assert body["items"][0]["evidence"] == {
        "dataset_id": run["dataset_id"],
        "mapping_id": materialized.json()["mapping_id"],
        "pipeline_run_id": run["id"],
    }
