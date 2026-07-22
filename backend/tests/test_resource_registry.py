from sqlalchemy import inspect

from app.core.database import create_engine_and_schema


def test_schema_creates_resource_and_relation_tables(tmp_path):
    engine = create_engine_and_schema(tmp_path / "metadata.db")

    table_names = set(inspect(engine).get_table_names())
    assert {"resources", "resource_relations", "audit_events"} <= table_names

    audit_columns = {column["name"] for column in inspect(engine).get_columns("audit_events")}
    assert {"resource_id", "correlation_id", "outcome", "previous_hash"} <= audit_columns
