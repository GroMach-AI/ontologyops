from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from uuid import uuid4

from docx import Document
from pypdf import PdfReader


@dataclass(frozen=True)
class DocumentAsset:
    source_id: str
    kind: str
    filename: str
    text_preview: str
    full_text: str
    path: str

    def to_dict(self) -> dict[str, str]:
        return {
            "source_id": self.source_id,
            "kind": self.kind,
            "filename": self.filename,
            "text_preview": self.text_preview,
            "path": self.path,
        }


def save_document_asset(data_dir: Path, filename: str, content: bytes) -> DocumentAsset:
    extension = Path(filename).suffix.lower()
    if extension not in {".docx", ".pdf"}:
        raise ValueError("Unsupported document type")
    source_id = str(uuid4())
    document_dir = data_dir / "documents"
    document_dir.mkdir(parents=True, exist_ok=True)
    safe_name = Path(filename).name.replace(" ", "_")
    path = document_dir / f"{source_id}-{safe_name}"
    path.write_bytes(content)
    text = _extract_word_text(content) if extension == ".docx" else _extract_pdf_text(content)
    return DocumentAsset(
        source_id=source_id,
        kind="document",
        filename=filename,
        text_preview=text[:800],
        full_text=text,
        path=str(path),
    )


def _extract_word_text(content: bytes) -> str:
    document = Document(BytesIO(content))
    return "\n".join(paragraph.text for paragraph in document.paragraphs if paragraph.text)


def _extract_pdf_text(content: bytes) -> str:
    reader = PdfReader(BytesIO(content))
    return "\n".join(page.extract_text() or "" for page in reader.pages)
