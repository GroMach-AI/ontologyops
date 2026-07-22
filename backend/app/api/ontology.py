from typing import Any

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app.core.database import runtime_metadata_engine
from app.domain.ontology import OntologyService, serialize_ontology_version
from app.services.audit import write_audit_event
from app.domain.authorization import require_resource_access


router = APIRouter(prefix="/api/ontology", tags=["ontology"])


class CandidateRequest(BaseModel):
    datasets: list[str] = Field(default_factory=list)


class DraftRequest(BaseModel):
    definition: dict[str, Any]


@router.post("/publish-factory")
def publish_factory_ontology(x_demo_role: str = Header(default="modeler")) -> dict[str, object]:
    engine = runtime_metadata_engine()
    if not require_resource_access(engine, x_demo_role, "ontology", "publish_ontology"):
        raise HTTPException(status_code=403, detail="Role is not allowed to publish ontology")
    version = OntologyService(engine).publish_factory()
    write_audit_event(engine, actor=x_demo_role, event_type="ontology_published", resource_type="ontology_version", payload={"version_id": version.id, "mode": "factory"})
    return serialize_ontology_version(version)


@router.post("/candidates")
def generate_candidates(request: CandidateRequest) -> dict[str, object]:
    return OntologyService(runtime_metadata_engine()).generate_mock_candidates(request.datasets)


@router.patch("/draft")
def save_draft(request: DraftRequest, x_demo_role: str = Header(default="modeler")) -> dict[str, object]:
    engine = runtime_metadata_engine()
    if not require_resource_access(engine, x_demo_role, "ontology", "write"):
        raise HTTPException(status_code=403, detail="Role is not allowed to edit ontology")
    draft = OntologyService(engine).save_draft(request.definition)
    write_audit_event(engine, actor=x_demo_role, event_type="ontology_draft_saved", resource_type="ontology_draft", payload={"draft_id": draft["id"]})
    return draft


@router.get("/draft")
def get_draft() -> dict[str, object]:
    try:
        return OntologyService(runtime_metadata_engine()).get_draft()
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/draft/impact")
def get_draft_impact() -> dict[str, object]:
    try:
        return OntologyService(runtime_metadata_engine()).draft_impact()
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/publish")
def publish_draft(x_demo_role: str = Header(default="modeler")) -> dict[str, object]:
    engine = runtime_metadata_engine()
    if not require_resource_access(engine, x_demo_role, "ontology", "publish_ontology"):
        raise HTTPException(status_code=403, detail="Role is not allowed to publish ontology")
    try:
        version = OntologyService(engine).publish_draft()
        write_audit_event(engine, actor=x_demo_role, event_type="ontology_published", resource_type="ontology_version", payload={"version_id": version["id"]})
        return version
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/versions")
def list_versions() -> dict[str, object]:
    return OntologyService(runtime_metadata_engine()).list_versions()


@router.post("/versions/{version_id}/rollback")
def rollback_to_draft(version_id: str, x_demo_role: str = Header(default="modeler")) -> dict[str, object]:
    engine = runtime_metadata_engine()
    if not require_resource_access(engine, x_demo_role, "ontology", "write"):
        raise HTTPException(status_code=403, detail="Role is not allowed to rollback ontology")
    try:
        draft = OntologyService(engine).rollback_to_draft(version_id)
        write_audit_event(engine, actor=x_demo_role, event_type="ontology_rollback", resource_type="ontology_version", payload={"version_id": version_id})
        return draft
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
