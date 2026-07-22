from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

import httpx
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session

from app.models.platform import ModelProviderConfig


@dataclass(frozen=True)
class ModelCompletion:
    content: str
    provider: str
    model_name: str
    mode: str
    input_tokens: int | None = None
    output_tokens: int | None = None


class ModelProviderService:
    def __init__(self, engine: Engine) -> None:
        self.engine = engine

    def complete_agent_answer(self, context: dict[str, Any], fallback: str) -> ModelCompletion:
        provider = self._default_agent_provider()
        if provider is None or provider.provider == "Mock Provider":
            return ModelCompletion(fallback, "Mock Provider", "ontologyops-mock", "mock")
        api_key = os.getenv(provider.api_key_env or "")
        if not api_key or not provider.base_url:
            return ModelCompletion(fallback, "Mock Provider", "ontologyops-mock", "mock")
        payload = {
            "model": provider.model_name,
            "temperature": float(provider.temperature),
            "max_tokens": provider.max_tokens,
            "messages": [
                {"role": "system", "content": "你是企业供应链分析助手。只能基于给定的受控本体证据作答，不要编造数据，不要给出写回动作。"},
                {"role": "user", "content": f"请用简洁中文总结以下证据并给出人工处置建议：{context}"},
            ],
        }
        try:
            response = httpx.post(
                f"{provider.base_url.rstrip('/')}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json=payload,
                timeout=20,
            )
            response.raise_for_status()
            data = response.json()
            content = str(data["choices"][0]["message"]["content"])
            usage = data.get("usage", {})
            return ModelCompletion(
                content=content,
                provider=provider.provider,
                model_name=provider.model_name,
                mode="real",
                input_tokens=usage.get("prompt_tokens"),
                output_tokens=usage.get("completion_tokens"),
            )
        except (httpx.HTTPError, KeyError, IndexError, TypeError):
            return ModelCompletion(fallback, "Mock Provider", "ontologyops-mock", "mock")

    def _default_agent_provider(self) -> ModelProviderConfig | None:
        with Session(self.engine) as session:
            provider = session.scalar(
                select(ModelProviderConfig)
                .where(ModelProviderConfig.enabled == "true")
                .where(ModelProviderConfig.agent_enabled == "true")
                .where(ModelProviderConfig.is_default == "true")
            )
            if provider is not None:
                session.expunge(provider)
            return provider
