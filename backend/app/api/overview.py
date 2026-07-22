import json

from fastapi import APIRouter
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.models import _ensure_defaults, _serialize
from app.core.database import runtime_metadata_engine
from app.models.platform import AuditEvent, ModelProviderConfig, OntologyVersion, PipelineRun, QualityRuleRecord


router = APIRouter(prefix="/api/overview", tags=["overview"])


@router.get("")
def get_overview() -> dict[str, object]:
    engine = runtime_metadata_engine()
    _ensure_defaults()
    with Session(engine) as session:
        published = session.scalar(
            select(OntologyVersion).where(OntologyVersion.status == "published").order_by(OntologyVersion.published_at.desc())
        )
        latest_pipeline = session.scalar(select(PipelineRun).order_by(PipelineRun.created_at.desc()))
        quality_rules = session.scalar(select(func.count()).select_from(QualityRuleRecord)) or 0
        agent_queries = session.scalar(select(func.count()).select_from(AuditEvent).where(AuditEvent.event_type == "agent_tool_call")) or 0
        events = session.scalars(select(AuditEvent).order_by(AuditEvent.created_at.desc()).limit(8)).all()
        default_model = session.scalar(select(ModelProviderConfig).where(ModelProviderConfig.is_default == "true"))
        return {
            "published_ontology": (
                {"semantic_version": published.semantic_version, "object_count": len(json.loads(published.definition_json).get("objects", [])), "link_count": len(json.loads(published.definition_json).get("links", []))}
                if published else None
            ),
            "latest_pipeline": (
                {"status": latest_pipeline.status, "input_rows": latest_pipeline.input_rows, "output_rows": latest_pipeline.output_rows, "created_at": latest_pipeline.created_at.isoformat()}
                if latest_pipeline else None
            ),
            "quality_rule_count": quality_rules,
            "agent_query_count": agent_queries,
            "default_model": _serialize(default_model) if default_model else None,
            "recent_activity": [
                {"id": event.id, "actor": event.actor, "event_type": event.event_type, "resource_type": event.resource_type, "created_at": event.created_at.isoformat(), "payload": json.loads(event.payload_json)}
                for event in events
            ],
        }
