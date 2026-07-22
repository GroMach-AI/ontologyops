#!/usr/bin/env python3
"""Run the smallest complete OntologyOps acceptance flow without external services."""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.seed.factory_seed import seed_factory_demo  # noqa: E402


def require(response, expected: int, step: str) -> dict:
    if response.status_code != expected:
        raise RuntimeError(f"{step} failed: {response.status_code} {response.text}")
    return response.json()


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="ontologyops-acceptance-") as workspace:
        root = Path(workspace)
        data_dir = root / "data"
        os.environ["ONTOLOGYOPS_DATA_DIR"] = str(data_dir)
        os.environ["ONTOLOGYOPS_METADATA_PATH"] = str(root / "metadata.db")
        seed_factory_demo(data_dir)
        client = TestClient(app)

        # 1. Data ingestion, raw/trusted storage, cleaning and pipeline history.
        upload = require(
            client.post(
                "/api/sources/upload",
                files={"file": ("orders.csv", b"order_no,qty\nPO-1,1\nPO-1,1\n", "text/csv")},
                headers={"X-Demo-Role": "modeler"},
            ),
            201,
            "upload CSV",
        )
        run = require(
            client.post(
                f"/api/pipelines/{upload['pipeline_id']}/run",
                json={"transforms": [{"type": "rename", "from": "order_no", "to": "order_number"}]},
                headers={"X-Demo-Role": "modeler"},
            ),
            200,
            "run pipeline",
        )
        assert run["input_rows"] == 2 and run["output_rows"] == 1
        preview = require(client.get(f"/api/datasets/{run['dataset_id']}/preview"), 200, "preview trusted dataset")
        assert preview["rows"][0]["order_number"] == "PO-1"
        history = require(client.get(f"/api/pipelines/{upload['pipeline_id']}/runs"), 200, "pipeline history")
        assert history["runs"][0]["status"] == "success"

        # 2. Ontology candidate, manual draft, impact check, immutable publication and rollback.
        candidate = require(client.post("/api/ontology/candidates", json={"datasets": ["purchase_orders", "inventory", "suppliers"]}), 200, "generate candidate")
        draft = require(client.patch("/api/ontology/draft", json={"definition": candidate["definition"]}, headers={"X-Demo-Role": "modeler"}), 200, "save ontology draft")
        impact = require(client.get("/api/ontology/draft/impact"), 200, "draft impact")
        assert impact["affected"]["objects"]["added"]
        published = require(client.post("/api/ontology/publish", headers={"X-Demo-Role": "modeler"}), 200, "publish ontology")
        versions = require(client.get("/api/ontology/versions"), 200, "version history")
        require(client.post(f"/api/ontology/versions/{published['id']}/rollback", headers={"X-Demo-Role": "modeler"}), 200, "rollback to draft")
        assert versions["versions"]

        # 3. Governance and role enforcement.
        rules = require(client.get("/api/governance/quality/rules"), 200, "load quality rules")
        rule_run = require(client.post(f"/api/governance/quality/rules/{rules[0]['id']}/run", headers={"X-Demo-Role": "modeler"}), 200, "run quality rule")
        assert "sample_rows" in rule_run
        denied = client.post("/api/ontology/publish", headers={"X-Demo-Role": "operator"})
        assert denied.status_code == 403

        # 4. Model configuration switch stays server-side; no real key is persisted.
        provider = require(
            client.post(
                "/api/models",
                headers={"X-Demo-Role": "admin"},
                json={"provider": "DeepSeek", "model_name": "deepseek-chat", "base_url": "https://api.deepseek.com/v1", "api_key_env": "DEEPSEEK_API_KEY"},
            ),
            201,
            "create DeepSeek configuration",
        )
        switched = require(
            client.patch(
                f"/api/models/{provider['id']}",
                headers={"X-Demo-Role": "admin"},
                json={"enabled": True, "is_default": True, "base_url": provider["base_url"], "api_key_env": provider["api_key_env"]},
            ),
            200,
            "switch default model",
        )
        assert switched["provider"] == "DeepSeek" and switched["api_key_env"] == "DEEPSEEK_API_KEY"

        # 5. Controlled semantic Q&A is backed by the published version and source evidence.
        require(client.post("/api/ontology/publish", headers={"X-Demo-Role": "modeler"}), 200, "republish ontology")
        answer = require(
            client.post(
                "/api/agent/chat",
                headers={"X-Demo-Role": "operator"},
                json={"message": "哪些供应商的订单延期并影响关键物料库存？"},
            ),
            200,
            "semantic agent query",
        )
        assert answer["evidence"] and answer["tool_calls"] and answer["provenance"]["ontology_version"]
        audit = require(client.get("/api/governance/audit"), 200, "audit trail")
        assert any(event["event_type"] == "pipeline_run" for event in audit)
        assert any(event["event_type"] == "permission_denied" for event in audit)

    print("ACCEPTANCE PASSED: ingest -> clean -> ontology -> version -> governance -> model -> agent")


if __name__ == "__main__":
    main()
