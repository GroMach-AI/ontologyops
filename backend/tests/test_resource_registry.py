from sqlalchemy import inspect

from app.core.database import create_engine_and_schema
from app.services.resource_registry import ResourceRegistry


def test_schema_creates_resource_and_relation_tables(tmp_path):
    engine = create_engine_and_schema(tmp_path / "metadata.db")

    table_names = set(inspect(engine).get_table_names())
    assert {"resources", "resource_relations", "audit_events"} <= table_names

    audit_columns = {column["name"] for column in inspect(engine).get_columns("audit_events")}
    assert {"resource_id", "correlation_id", "outcome", "previous_hash"} <= audit_columns


def test_registry_records_relation_and_audit(tmp_path):
    registry = ResourceRegistry(create_engine_and_schema(tmp_path / "metadata.db"))
    source = registry.create_resource("source_asset", "供应商文件", "modeler")
    dataset = registry.create_resource("dataset_version", "供应商 v1", "modeler")

    relation = registry.add_relation(source.id, dataset.id, "produced_by", "modeler")

    assert source.lifecycle_status == "registered"
    assert relation.from_resource_id == source.id
    assert registry.get_relations(source.id, "outgoing")[0].to_resource_id == dataset.id


def test_resource_transition_writes_chained_audit_event(tmp_path):
    registry = ResourceRegistry(create_engine_and_schema(tmp_path / "metadata.db"))
    resource = registry.create_resource("dataset_version", "供应商 v1", "modeler")

    registry.transition_resource(resource.id, "profiled", "modeler", correlation_id="run-01")

    event = registry.list_audit_events(resource.id)[-1]
    assert event.resource_id == resource.id
    assert event.correlation_id == "run-01"
    assert event.outcome == "succeeded"
    assert event.previous_hash
