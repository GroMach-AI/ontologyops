from io import BytesIO

from docx import Document
from fastapi.testclient import TestClient

from app.main import app


def test_word_upload_extracts_document_text(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("ONTOLOGYOPS_DATA_DIR", str(tmp_path))
    document = Document()
    document.add_paragraph("供应商质量标准：关键物料到货前必须完成质检。")
    buffer = BytesIO()
    document.save(buffer)
    client = TestClient(app)

    response = client.post(
        "/api/sources/upload",
        files={
            "file": (
                "supplier-policy.docx",
                buffer.getvalue(),
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
    )

    assert response.status_code == 201
    assert response.json()["kind"] == "document"
    assert "关键物料" in response.json()["text_preview"]

    sources = client.get("/api/sources")
    assert any(source["name"] == "supplier-policy.docx" for source in sources.json()["sources"])
