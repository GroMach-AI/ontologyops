from datetime import UTC, datetime
import os
from pathlib import Path
import re
from uuid import uuid4

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import runtime_metadata_engine
from app.models.platform import ModelProviderConfig
from app.domain.authorization import require_resource_access
from app.services.audit import write_audit_event
from app.services.model_provider import ModelProviderService


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
    model_name: str | None = Field(default=None, min_length=1, max_length=128)


class CreateProviderRequest(BaseModel):
    provider: str = Field(min_length=1, max_length=64)
    model_name: str = Field(min_length=1, max_length=128)
    base_url: str
    api_key_env: str = Field(min_length=1, max_length=128)
    temperature: float = Field(default=0, ge=0, le=2)
    max_tokens: int = Field(default=1024, ge=64, le=16384)


class LocalSecretRequest(BaseModel):
    api_key: str = Field(min_length=8, max_length=1024)


class VerifyModelRequest(BaseModel):
    api_key: str | None = Field(default=None, min_length=8, max_length=1024)


def _ensure_defaults() -> list[ModelProviderConfig]:
    with Session(runtime_metadata_engine()) as session:
        items = session.scalars(select(ModelProviderConfig)).all()
        if not items:
            session.add_all(
                [
                    ModelProviderConfig(
                        id=str(uuid4()), provider="Mock Provider", model_name="ontologyops-mock", enabled="true", is_default="true", base_url=None, api_key_env=None, temperature="0", max_tokens=1024, verification_status="verified"
                    ),
                    ModelProviderConfig(
                        id=str(uuid4()), provider="GPT", model_name="gpt-4.1-mini", enabled="false", is_default="false", base_url="https://api.openai.com/v1", api_key_env="OPENAI_API_KEY", temperature="0", max_tokens=1024
                    ),
                    ModelProviderConfig(
                        id=str(uuid4()), provider="DeepSeek", model_name="deepseek-v4-flash", enabled="false", is_default="false", base_url="https://api.deepseek.com", api_key_env="DEEPSEEK_API_KEY", temperature="0", max_tokens=4096
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
            additions.append(ModelProviderConfig(id=str(uuid4()), provider="DeepSeek", model_name="deepseek-v4-flash", enabled="false", is_default="false", base_url="https://api.deepseek.com", api_key_env="DEEPSEEK_API_KEY", temperature="0", max_tokens=4096))
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
        "verification_status": item.verification_status,
        "last_verified_at": item.last_verified_at.isoformat() if item.last_verified_at else None,
        "last_error": item.last_error,
        "available_models": _available_models(item.provider),
        "secret_policy": "API Key 仅从服务端环境变量读取，不在本地数据库或浏览器保存。",
    }


def _available_models(provider: str) -> list[dict[str, str]]:
    if provider == "DeepSeek":
        return [
            {"id": "deepseek-v4-flash", "label": "DeepSeek V4 Flash"},
            {"id": "deepseek-v4-pro", "label": "DeepSeek V4 Pro"},
        ]
    if provider == "GPT":
        return [{"id": "gpt-4.1-mini", "label": "GPT-4.1 mini"}]
    return []


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
        verification_status="unconfigured",
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
        if request.is_default and (not request.enabled or item.verification_status != "verified"):
            raise HTTPException(status_code=400, detail="Default provider must be enabled and verified")
        if request.enabled and item.provider != "Mock Provider" and item.verification_status != "verified":
            raise HTTPException(status_code=400, detail="Real provider must be verified before enabling")
        if request.is_default:
            for candidate in session.scalars(select(ModelProviderConfig)).all():
                candidate.is_default = "false"
        item.enabled = str(request.enabled).lower()
        item.is_default = str(request.is_default).lower()
        item.base_url = request.base_url.rstrip("/") if request.base_url else item.base_url
        item.api_key_env = request.api_key_env or item.api_key_env
        item.temperature = str(request.temperature)
        item.max_tokens = request.max_tokens
        if request.model_name and request.model_name != item.model_name:
            item.model_name = request.model_name
            item.verification_status = "pending"
            item.last_verified_at = None
            item.last_error = None
        item.agent_enabled = str(request.agent_enabled).lower()
        item.modeling_enabled = str(request.modeling_enabled).lower()
        session.commit()
        session.refresh(item)
        result = _serialize(item)
    write_audit_event(engine, actor=x_demo_role, event_type="model_provider_updated", resource_type="model_provider", payload={"provider_id": result["id"], "enabled": result["enabled"], "is_default": result["is_default"]})
    return result


@router.post("/{provider_id}/verify")
def verify_model(provider_id: str, request: VerifyModelRequest | None = None, x_demo_role: str = Header(default="operator")) -> dict[str, object]:
    engine = runtime_metadata_engine()
    if not require_resource_access(engine, x_demo_role, "model_config", "update"):
        raise HTTPException(status_code=403, detail="Role is not allowed to verify model configuration")
    _ensure_defaults()
    with Session(engine) as session:
        item = session.get(ModelProviderConfig, provider_id)
        if item is None:
            raise HTTPException(status_code=404, detail="Model provider not found")
        if item.provider == "Mock Provider":
            item.verification_status = "verified"
            item.last_error = None
            item.last_verified_at = datetime.now(UTC)
            success, error = True, None
        else:
            success, error = ModelProviderService(engine).verify(item, request.api_key if request else None)
            item.verification_status = "verified" if success else "failed"
            item.last_error = error
            item.last_verified_at = datetime.now(UTC) if success else None
        session.commit()
        session.refresh(item)
        result = _serialize(item)
    write_audit_event(engine, actor=x_demo_role, event_type="model_provider_verified", resource_type="model_provider", payload={"provider_id": provider_id, "provider": result["provider"], "model_name": result["model_name"], "status": result["verification_status"]}, outcome="succeeded" if success else "failed")
    return result


@router.put("/{provider_id}/local-secret")
def set_local_secret(provider_id: str, request: LocalSecretRequest, x_demo_role: str = Header(default="operator")) -> dict[str, str]:
    """Local-MVP convenience endpoint: persist only to ignored .env, never metadata."""
    engine = runtime_metadata_engine()
    if not require_resource_access(engine, x_demo_role, "model_config", "update"):
        raise HTTPException(status_code=403, detail="Role is not allowed to set local model secret")
    _ensure_defaults()
    with Session(engine) as session:
        item = session.get(ModelProviderConfig, provider_id)
        if item is None or item.provider == "Mock Provider" or not item.api_key_env:
            raise HTTPException(status_code=400, detail="This provider does not accept a local API key")
        secret_ref = item.api_key_env
    _store_local_secret(secret_ref, request.api_key)
    write_audit_event(engine, actor=x_demo_role, event_type="model_local_secret_set", resource_type="model_provider", payload={"provider_id": provider_id, "secret_ref": secret_ref})
    return {"secret_ref": secret_ref, "status": "stored_locally"}


def _store_local_secret(secret_ref: str, api_key: str) -> None:
    env_path = Path(os.getenv("ONTOLOGYOPS_ENV_FILE", "../.env")).resolve()
    env_path.parent.mkdir(parents=True, exist_ok=True)
    existing = env_path.read_text() if env_path.exists() else ""
    matcher = re.compile(rf"^{re.escape(secret_ref)}=.*$", re.MULTILINE)
    line = f"{secret_ref}={api_key}"
    updated = matcher.sub(line, existing) if matcher.search(existing) else f"{existing.rstrip()}\n{line}\n"
    env_path.write_text(updated.lstrip())
    os.chmod(env_path, 0o600)
    os.environ[secret_ref] = api_key
