from __future__ import annotations

from pathlib import Path
import os

from sqlalchemy import Engine, create_engine
from sqlalchemy import inspect, text

from app.models.platform import Base
from app.models import resources as resource_models


def create_engine_and_schema(path: Path) -> Engine:
    path.parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(f"sqlite:///{path}")
    Base.metadata.create_all(engine)
    _migrate_sqlite_schema(engine)
    return engine


def runtime_metadata_engine() -> Engine:
    path = Path(os.getenv("ONTOLOGYOPS_METADATA_PATH", "../data/metadata.db")).resolve()
    return create_engine_and_schema(path)


def _migrate_sqlite_schema(engine: Engine) -> None:
    inspector = inspect(engine)
    table_names = set(inspector.get_table_names())
    if "model_provider_configs" in table_names:
        existing = {column["name"] for column in inspector.get_columns("model_provider_configs")}
        additions = {
            "base_url": "VARCHAR(512)",
            "api_key_env": "VARCHAR(128)",
            "temperature": "VARCHAR(16) NOT NULL DEFAULT '0'",
            "max_tokens": "INTEGER NOT NULL DEFAULT 1024",
            "agent_enabled": "VARCHAR(8) NOT NULL DEFAULT 'true'",
            "modeling_enabled": "VARCHAR(8) NOT NULL DEFAULT 'true'",
        }
        with engine.begin() as connection:
            for name, definition in additions.items():
                if name not in existing:
                    connection.execute(text(f"ALTER TABLE model_provider_configs ADD COLUMN {name} {definition}"))
    if "quality_rules" in table_names:
        quality_columns = {column["name"] for column in inspector.get_columns("quality_rules")}
        if "config_json" not in quality_columns:
            with engine.begin() as connection:
                connection.execute(text("ALTER TABLE quality_rules ADD COLUMN config_json TEXT NOT NULL DEFAULT '{}'"))
    if "audit_events" in table_names:
        audit_columns = {column["name"] for column in inspector.get_columns("audit_events")}
        additions = {
            "resource_id": "VARCHAR(36)",
            "correlation_id": "VARCHAR(36)",
            "outcome": "VARCHAR(32)",
            "previous_hash": "VARCHAR(128)",
        }
        with engine.begin() as connection:
            for name, definition in additions.items():
                if name not in audit_columns:
                    connection.execute(text(f"ALTER TABLE audit_events ADD COLUMN {name} {definition}"))
