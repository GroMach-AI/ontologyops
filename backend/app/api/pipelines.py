import os
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app.core.database import runtime_metadata_engine
from app.domain.pipeline import PipelineService
from app.services.audit import write_audit_event
from app.domain.authorization import require_resource_access


router = APIRouter(prefix="/api/pipelines", tags=["pipelines"])


class PipelineRunRequest(BaseModel):
    transforms: list[dict[str, Any]] = Field(default_factory=list)


@router.post("/{pipeline_id}/run")
def run_pipeline(pipeline_id: str, request: PipelineRunRequest, x_demo_role: str = Header(default="modeler")) -> dict[str, object]:
    data_dir = Path(os.getenv("ONTOLOGYOPS_DATA_DIR", "../data")).resolve()
    engine = runtime_metadata_engine()
    if not require_resource_access(engine, x_demo_role, "pipeline", "run"):
        raise HTTPException(status_code=403, detail="Role is not allowed to run pipelines")
    try:
        result = PipelineService(data_dir).run_registered_pipeline(engine, pipeline_id, request.transforms)
    except KeyError as error:
        write_audit_event(engine, actor=x_demo_role, event_type="pipeline_run_failed", resource_type="pipeline", payload={"pipeline_id": pipeline_id, "reason": str(error)})
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        write_audit_event(engine, actor=x_demo_role, event_type="pipeline_run_failed", resource_type="pipeline", payload={"pipeline_id": pipeline_id, "reason": str(error)})
        raise HTTPException(status_code=400, detail=str(error)) from error
    write_audit_event(
        engine,
        actor=x_demo_role,
        event_type="pipeline_run",
        resource_type="pipeline",
        payload={"pipeline_id": pipeline_id, "run_id": result["id"], "status": result["status"]},
    )
    return result


@router.get("/{pipeline_id}/runs")
def list_pipeline_runs(pipeline_id: str) -> dict[str, object]:
    data_dir = Path(os.getenv("ONTOLOGYOPS_DATA_DIR", "../data")).resolve()
    return PipelineService(data_dir).list_pipeline_runs(runtime_metadata_engine(), pipeline_id)
