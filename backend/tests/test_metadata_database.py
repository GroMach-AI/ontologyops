from pathlib import Path

from sqlalchemy import inspect

from app.core.database import create_engine_and_schema


def test_metadata_database_creates_core_tables(tmp_path: Path) -> None:
    engine = create_engine_and_schema(tmp_path / "metadata.db")

    assert {"data_sources", "datasets", "ontology_versions", "audit_events"}.issubset(
        inspect(engine).get_table_names()
    )
