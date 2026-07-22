from fastapi.testclient import TestClient
from io import BytesIO
from docx import Document

from app.main import app
from app.seed.factory_seed import seed_factory_demo


def test_agent_returns_trusted_supplier_delay_answer(tmp_path, monkeypatch) -> None:
    seed_factory_demo(tmp_path)
    monkeypatch.setenv("ONTOLOGYOPS_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("ONTOLOGYOPS_METADATA_PATH", str(tmp_path / "metadata.db"))
    client = TestClient(app)
    assert client.post("/api/ontology/publish-factory").status_code == 200

    response = client.post(
        "/api/agent/chat",
        headers={"X-Demo-Role": "operator"},
        json={"message": "本月哪些供应商的订单最容易延期，且影响关键物料库存？"},
    )

    assert response.status_code == 200
    answer = response.json()
    assert answer["provenance"]["ontology_version"] == "v1.0.0"
    assert answer["provenance"]["sources"] == [
        "purchase_orders",
        "purchase_order_lines",
        "materials",
        "inventory",
        "suppliers",
    ]
    assert answer["tool_calls"]
    assert answer["evidence"]
    assert "华东精铸" in answer["answer"]
    assert [item["order_number"] for item in answer["evidence"]] == ["PO-2026-001"]
    assert "contract_unit_price" not in str(answer)


def test_agent_retrieves_authorized_document_knowledge(tmp_path, monkeypatch) -> None:
    seed_factory_demo(tmp_path)
    monkeypatch.setenv("ONTOLOGYOPS_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("ONTOLOGYOPS_METADATA_PATH", str(tmp_path / "metadata.db"))
    client = TestClient(app)
    client.post("/api/ontology/publish-factory")
    document = Document()
    document.add_paragraph("关键物料到货前必须完成质检，质量不合格时应转质量负责人复核。")
    buffer = BytesIO(); document.save(buffer)
    client.post("/api/sources/upload", files={"file": ("policy.docx", buffer.getvalue(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")})

    response = client.post("/api/agent/chat", headers={"X-Demo-Role": "operator"}, json={"message": "关键物料的质检标准是什么？"})

    assert response.status_code == 200
    assert "必须完成质检" in response.json()["answer"]
    assert any(call["name"] == "retrieve_knowledge" for call in response.json()["tool_calls"])


def test_agent_uses_ontology_object_count_for_simple_question(tmp_path, monkeypatch) -> None:
    seed_factory_demo(tmp_path)
    monkeypatch.setenv("ONTOLOGYOPS_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("ONTOLOGYOPS_METADATA_PATH", str(tmp_path / "metadata.db"))
    client = TestClient(app)
    assert client.post("/api/ontology/publish-factory").status_code == 200

    response = client.post("/api/agent/chat", json={"message": "采购订单一共有多少？"})

    assert response.status_code == 200
    assert "4 笔采购订单" in response.json()["answer"]
    assert response.json()["tool_calls"][0]["name"] == "find_objects"
