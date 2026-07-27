from __future__ import annotations

import json

from fastapi import APIRouter, Header, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import runtime_metadata_engine
from app.domain.authorization import apply_field_policy, require_resource_access
from app.models.platform import OntologyEntityInstanceRecord, UserOntology


router = APIRouter(prefix="/api/ontologies", tags=["ontology-instances"])


@router.get("/{ontology_id}/entities/{entity_id}/instances")
def list_entity_instances(
    ontology_id: str,
    entity_id: str,
    limit: int = 50,
    offset: int = 0,
    x_demo_role: str = Header(default="modeler"),
) -> dict[str, object]:
    engine = runtime_metadata_engine()
    if not require_resource_access(engine, x_demo_role, "ontology", "read"):
        raise HTTPException(status_code=403, detail="Role is not allowed to read ontology instances")
    bounded_limit = min(max(limit, 1), 100)
    with Session(engine) as session:
        ontology = session.get(UserOntology, ontology_id)
        if ontology is None:
            raise HTTPException(status_code=404, detail="Ontology not found")
        entity_exists = any(item.get("name") == entity_id for item in json.loads(ontology.entities_json))
        if not entity_exists:
            raise HTTPException(status_code=404, detail="Entity type not found")
        base = select(OntologyEntityInstanceRecord).where(
            OntologyEntityInstanceRecord.ontology_id == ontology_id,
            OntologyEntityInstanceRecord.entity_id == entity_id,
        )
        total = session.scalar(select(func.count()).select_from(base.subquery())) or 0
        records = session.scalars(base.order_by(OntologyEntityInstanceRecord.entity_key).offset(offset).limit(bounded_limit)).all()
    return {
        "ontology_id": ontology_id,
        "entity_id": entity_id,
        "total": total,
        "items": [
            {
                "id": item.id,
                "entity_key": item.entity_key,
                "properties": apply_field_policy(x_demo_role, entity_id, json.loads(item.properties_json)),
                "source_dataset_id": item.source_dataset_id,
                "mapping_id": item.mapping_id,
                "pipeline_run_id": item.pipeline_run_id,
                "evidence": {
                    "dataset_id": item.source_dataset_id,
                    "mapping_id": item.mapping_id,
                    "pipeline_run_id": item.pipeline_run_id,
                },
                "updated_at": item.updated_at.isoformat(),
            }
            for item in records
        ],
    }
