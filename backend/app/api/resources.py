from __future__ import annotations

import json
from typing import Literal

from fastapi import APIRouter, Header
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

from app.core.database import runtime_metadata_engine
from app.domain.resource_lifecycle import InvalidLifecycleTransition
from app.models.resources import ResourceRecord, ResourceRelationRecord
from app.services.resource_registry import InvalidResourceRelation, ResourceNotFoundError, ResourceRegistry


router = APIRouter(prefix="/api/v1/resources", tags=["resources"])

ResourceType = Literal[
    "source_asset", "dataset", "dataset_version", "pipeline", "pipeline_run",
    "quality_rule", "quality_run", "ontology", "ontology_draft", "ontology_release",
    "object_type", "property", "link_type", "mapping", "metric", "read_function",
    "business_rule", "access_policy", "tool_registry_entry", "tool_call", "agent_answer",
]


class CreateResourceRequest(BaseModel):
    resource_type: ResourceType
    display_name: str = Field(max_length=255)
    metadata: dict[str, object] = Field(default_factory=dict)
    content_hash: str | None = Field(default=None, max_length=128)

    @field_validator("display_name")
    @classmethod
    def display_name_must_not_be_blank(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("display_name must not be blank")
        return normalized


class TransitionResourceRequest(BaseModel):
    target_status: str = Field(min_length=1, max_length=32)
    correlation_id: str | None = Field(default=None, max_length=36)


class CreateRelationRequest(BaseModel):
    to_resource_id: str = Field(min_length=1, max_length=36)
    relation_type: str = Field(min_length=1, max_length=64)


@router.post("", status_code=201)
def create_resource(request: CreateResourceRequest, x_demo_role: str = Header(default="modeler")):
    denied = _require_writer(x_demo_role)
    if denied is not None:
        return denied
    resource = ResourceRegistry(runtime_metadata_engine()).create_resource(
        request.resource_type,
        request.display_name,
        x_demo_role,
        metadata=request.metadata,
        content_hash=request.content_hash,
    )
    return _serialize_resource(resource)


@router.get("/{resource_id}")
def get_resource(resource_id: str, x_demo_role: str = Header(default="modeler")):
    denied = _require_reader(x_demo_role, resource_id)
    if denied is not None:
        return denied
    try:
        return _serialize_resource(ResourceRegistry(runtime_metadata_engine()).get_resource(resource_id))
    except ResourceNotFoundError:
        return _error(404, "resource_not_found", "Resource was not found", resource_id=resource_id)


@router.post("/{resource_id}/transition")
def transition_resource(
    resource_id: str,
    request: TransitionResourceRequest,
    x_demo_role: str = Header(default="modeler"),
):
    denied = _require_writer(x_demo_role, resource_id)
    if denied is not None:
        return denied
    try:
        resource = ResourceRegistry(runtime_metadata_engine()).transition_resource(
            resource_id,
            request.target_status,
            x_demo_role,
            correlation_id=request.correlation_id,
        )
        return _serialize_resource(resource)
    except ResourceNotFoundError:
        return _error(404, "resource_not_found", "Resource was not found", resource_id=resource_id)
    except InvalidLifecycleTransition as error:
        return _error(409, "invalid_lifecycle_transition", str(error), resource_id=resource_id)


@router.post("/{resource_id}/relations", status_code=201)
def create_relation(
    resource_id: str,
    request: CreateRelationRequest,
    x_demo_role: str = Header(default="modeler"),
):
    denied = _require_writer(x_demo_role, resource_id)
    if denied is not None:
        return denied
    try:
        relation = ResourceRegistry(runtime_metadata_engine()).add_relation(
            resource_id,
            request.to_resource_id,
            request.relation_type,
            x_demo_role,
        )
        return _serialize_relation(relation)
    except ResourceNotFoundError:
        return _error(404, "resource_not_found", "Resource was not found", resource_id=resource_id)
    except InvalidResourceRelation as error:
        return _error(409, "invalid_resource_relation", str(error), resource_id=resource_id)


@router.get("/{resource_id}/relations")
def get_relations(
    resource_id: str,
    direction: Literal["incoming", "outgoing", "both"] = "both",
    x_demo_role: str = Header(default="modeler"),
):
    denied = _require_reader(x_demo_role, resource_id)
    if denied is not None:
        return denied
    try:
        relations = ResourceRegistry(runtime_metadata_engine()).get_relations(resource_id, direction)
        return {"resource_id": resource_id, "direction": direction, "relations": [_serialize_relation(item) for item in relations]}
    except ResourceNotFoundError:
        return _error(404, "resource_not_found", "Resource was not found", resource_id=resource_id)


def _require_writer(role: str, resource_id: str | None = None) -> JSONResponse | None:
    if role in {"modeler", "admin"}:
        return None
    return _error(403, "forbidden", "Role is not allowed to modify resources", resource_id=resource_id)


def _require_reader(role: str, resource_id: str) -> JSONResponse | None:
    if role in {"operator", "modeler", "admin"}:
        return None
    return _error(403, "forbidden", "Role is not allowed to read resources", resource_id=resource_id)


def _error(status_code: int, code: str, message: str, *, resource_id: str | None = None, correlation_id: str | None = None) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"code": code, "message": message, "resource_id": resource_id, "correlation_id": correlation_id, "details": []},
    )


def _serialize_resource(resource: ResourceRecord) -> dict[str, object]:
    return {
        "id": resource.id,
        "resource_type": resource.resource_type,
        "display_name": resource.display_name,
        "lifecycle_status": resource.lifecycle_status,
        "version": resource.version,
        "created_by": resource.created_by,
        "metadata": json.loads(resource.metadata_json),
        "content_hash": resource.content_hash,
        "created_at": resource.created_at.isoformat(),
        "updated_at": resource.updated_at.isoformat(),
    }


def _serialize_relation(relation: ResourceRelationRecord) -> dict[str, object]:
    return {
        "id": relation.id,
        "from_resource_id": relation.from_resource_id,
        "to_resource_id": relation.to_resource_id,
        "relation_type": relation.relation_type,
        "created_by": relation.created_by,
        "created_at": relation.created_at.isoformat(),
    }
