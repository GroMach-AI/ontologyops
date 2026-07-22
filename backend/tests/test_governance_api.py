from fastapi.testclient import TestClient

from app.main import app
from app.seed.factory_seed import seed_factory_demo


def test_quality_rule_can_be_created_and_run(tmp_path, monkeypatch) -> None:
    seed_factory_demo(tmp_path)
    monkeypatch.setenv("ONTOLOGYOPS_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("ONTOLOGYOPS_METADATA_PATH", str(tmp_path / "metadata.db"))
    client = TestClient(app)

    defaults = client.get("/api/governance/quality/rules")
    assert defaults.status_code == 200
    assert len(defaults.json()) == 3

    created = client.post(
        "/api/governance/quality/rules",
        json={
            "name": "订单编号唯一性",
            "dataset_name": "purchase_orders",
            "rule_type": "unique",
            "field": "order_number",
        },
    )
    assert created.status_code == 201

    result = client.post(f"/api/governance/quality/rules/{created.json()['id']}/run")
    assert result.status_code == 200
    assert result.json()["status"] == "passed"
    assert result.json()["sample_rows"] == []

    rules = client.get("/api/governance/quality/rules")
    configured = next(rule for rule in rules.json() if rule["id"] == created.json()["id"])
    assert configured["latest_run"]["status"] == "passed"

    policy = client.get("/api/governance/permissions/preview", params={"role": "operator"})
    assert policy.status_code == 200
    assert "contract_unit_price" in policy.json()["hidden_fields"]

    lineage = client.get("/api/governance/lineage/metric/supplier_on_time_delivery_rate")
    assert lineage.status_code == 200
    assert lineage.json()["nodes"]
