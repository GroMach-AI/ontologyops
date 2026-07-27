from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app.core.database import runtime_metadata_engine
from app.domain.agent import AgentService


router = APIRouter(prefix="/api/agent", tags=["agent"])


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)


@router.post("/chat")
def chat(
    request: ChatRequest,
    x_demo_role: str = Header(default="operator"),
) -> dict[str, object]:
    if x_demo_role not in {"admin", "modeler", "operator"}:
        raise HTTPException(status_code=400, detail="Unknown demo role")
    try:
        return AgentService(runtime_metadata_engine(), x_demo_role).chat(request.message)
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
