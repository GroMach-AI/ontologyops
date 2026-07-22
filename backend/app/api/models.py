from uuid import uuid4

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import runtime_metadata_engine
from app.models.platform import ModelProviderConfig
from app.domain.authorization import require_resource_access
from app.services.audit import write_audit_event


router = APIRouter(prefix="/api/models", tags=["models"])


class ModelStateRequest(BaseModel):
    enabled: bool
    is_default: bool
    base_url: str | None = None
    api_key_env: str | None = None
    temperature: float = Field(default=0, ge=0, le=2)
    max_tokens: int = Field(default=1024, ge=64, le=16384)
    agent_enabled: bool = True
    modeling_enabled: bool = True


class CreateProviderRequest(BaseModel):
    provider: str = Field(min_length=1, max_length=64)
    model_name: str = Field(min_length=1, max_length=128)
    base_url: str
    api_key_env: str = Field(min_length=1, max_length=128)
    temperature: float = Field(default=0, ge=0, le=2)
    max_tokens: int = Field(default=1024, ge=64, le=16384)


def _ensure_defaults() -> list[ModelProviderConfig]:
    with Session(runtime_metadata_engine()) as session:
        items = session.scalars(select(ModelProviderConfig)).all()
        if not items:
            session.add_all(
                [
                    ModelProviderConfig(
                        id=str(uuid4()), provider="Mock Provider", model_name="ontologyops-mock", enabled="true", is_default="true", base_url=None, api_key_env=None, temperature="0", max_tokens=1024
                    ),
                    ModelProviderConfig(
                        id=str(uuid4()), provider="GPT", model_name="gpt-4.1-mini", enabled="false", is_default="false", base_url="https://api.openai.com/v1", api_key_env="OPENAI_API_KEY", temperature="0", max_tokens=1024
                    ),
                    ModelProviderConfig(
                        id=str(uuid4()), provider="DeepSeek", model_name="deepseek-chat", enabled="false", is_default="false", base_url="https://api.deepseek.com/v1", api_key_env="DEEPSEEK_API_KEY", temperature="0", max_tokens=1024
                    ),
                ]
            )
            session.commit()
            items = session.scalars(select(ModelProviderConfig)).all()
        existing = {item.provider for item in items}
        additions = []
        if "GPT" not in existing:
            additions.append(ModelProviderConfig(id=str(uuid4()), provider="GPT", model_name="gpt-4.1-mini", enabled="false", is_default="false", base_url="https://api.openai.com/v1", api_key_env="OPENAI_API_KEY", temperature="0", max_tokens=1024))
        if "DeepSeek" not in existing:
            additions.append(ModelProviderConfig(id=str(uuid4()), provider="DeepSeek", model_name="deepseek-chat", enabled="false", is_default="false", base_url="https://api.deepseek.com/v1", api_key_env="DEEPSEEK_API_KEY", temperature="0", max_tokens=1024))
        if additions:
            session.add_all(additions)
            session.commit()
            items = session.scalars(select(ModelProviderConfig)).all()
        for item in items:
            session.expunge(item)
        return items


def _serialize(item: ModelProviderConfig) -> dict[str, object]:
    return {
        "id": item.id,
        "provider": item.provider,
        "model_name": item.model_name,
        "enabled": item.enabled == "true",
        "is_default": item.is_default == "true",
        "base_url": item.base_url,
        "api_key_env": item.api_key_env,
        "temperature": float(item.temperature),
        "max_tokens": item.max_tokens,
        "agent_enabled": item.agent_enabled == "true",
        "modeling_enabled": item.modeling_enabled == "true",
        "secret_policy": "API Key 仅从服务端环境变量读取，不在本地数据库或浏览器保存。",
    }


@router.get("")
def list_models() -> dict[str, object]:
    return {"providers": [_serialize(item) for item in _ensure_defaults()]}


@router.post("", status_code=201)
def create_model(request: CreateProviderRequest, x_demo_role: str = Header(default="operator")) -> dict[str, object]:
    engine = runtime_metadata_engine()
    if not require_resource_access(engine, x_demo_role, "model_config", "create"):
        raise HTTPException(status_code=403, detail="Role is not allowed to create model configuration")
    with Session(engine) as session:
        item = ModelProviderConfig(
            id=str(uuid4()),
            provider=request.provider,
            model_name=request.model_name,
            enabled="false",
            is_default="false",
            base_url=request.base_url.rstrip("/"),
            api_key_env=request.api_key_env,
            temperature=str(request.temperature),
            max_tokens=request.max_tokens,
        )
        session.add(item)
        session.commit()
        session.refresh(item)
        result = _serialize(item)
    write_audit_event(engine, actor=x_demo_role, event_type="model_provider_created", resource_type="model_provider", payload={"provider_id": result["id"], "provider": result["provider"]})
    return result


@router.patch("/{provider_id}")
def update_model(provider_id: str, request: ModelStateRequest, x_demo_role: str = Header(default="operator")) -> dict[str, object]:
    engine = runtime_metadata_engine()
    if not require_resource_access(engine, x_demo_role, "model_config", "update"):
        raise HTTPException(status_code=403, detail="Role is not allowed to update model configuration")
    _ensure_defaults()
    with Session(engine) as session:
        item = session.get(ModelProviderConfig, provider_id)
        if item is None:
            raise HTTPException(status_code=404, detail="Model provider not found")
        if request.is_default and not request.enabled:
            raise HTTPException(status_code=400, detail="Default provider must be enabled")
        if request.is_default:
            for candidate in session.scalars(select(ModelProviderConfig)).all():
                candidate.is_default = "false"
        item.enabled = str(request.enabled).lower()
        item.is_default = str(request.is_default).lower()
        item.base_url = request.base_url.rstrip("/") if request.base_url else item.base_url
        item.api_key_env = request.api_key_env or item.api_key_env
        item.temperature = str(request.temperature)
        item.max_tokens = request.max_tokens
        item.agent_enabled = str(request.agent_enabled).lower()
        item.modeling_enabled = str(request.modeling_enabled).lower()
        session.commit()
        session.refresh(item)
        result = _serialize(item)
    write_audit_event(engine, actor=x_demo_role, event_type="model_provider_updated", resource_type="model_provider", payload={"provider_id": result["id"], "enabled": result["enabled"], "is_default": result["is_default"]})
    return result
