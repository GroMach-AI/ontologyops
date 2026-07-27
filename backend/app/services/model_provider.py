from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import UTC, datetime
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


class ModelProviderUnavailable(ValueError):
    """A selected real model cannot be used; callers must surface the reason."""


class ModelProviderService:


    def __init__(self, engine: Engine) -> None:
        self.engine = engine

    def complete_agent_answer(self, context: dict[str, Any], fallback: str) -> ModelCompletion:
        provider = self._default_agent_provider()
        if provider is None or provider.provider == "Mock Provider":
            return ModelCompletion(fallback, "Mock Provider", "ontologyops-mock", "mock")
        api_key = os.getenv(provider.api_key_env or "")
        if provider.verification_status != "verified":
            raise ModelProviderUnavailable("当前真实模型尚未通过连接验证。")
        if not api_key or not provider.base_url:
            raise ModelProviderUnavailable("当前真实模型的本机密钥或 Base URL 未配置。")
        payload = {
            "model": provider.model_name,
            "temperature": float(provider.temperature),
            "max_tokens": provider.max_tokens,
            "messages": [
                {"role": "system", "content": "你是企业本体智能助手。只能依据给定的受控本体查询结果作答；不得编造、补全或推断未提供的数据，不得生成 SQL、写回动作或审批建议。保留实体数量、名称和证据范围，使用简洁中文直接回答用户问题。"},
                {"role": "user", "content": f"请根据以下受控查询结果直接回答用户：{context}"},
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
        except (httpx.HTTPError, KeyError, IndexError, TypeError) as error:
            raise ModelProviderUnavailable("真实模型调用失败，请检查连接与服务状态后重试。") from error

    def verify(self, provider: ModelProviderConfig, api_key_override: str | None = None) -> tuple[bool, str | None]:
        """Verify credential reachability without sending a prompt or business data."""
        api_key = api_key_override or os.getenv(provider.api_key_env or "")
        if not api_key:
            return False, "未检测到本机环境变量中的 API Key。"
        if not provider.base_url:
            return False, "未配置 Base URL。"
        try:
            response = httpx.get(
                f"{provider.base_url.rstrip('/')}/models",
                headers={"Authorization": f"Bearer {api_key}"},
                timeout=10,
            )
            response.raise_for_status()
            model_ids = {str(item.get("id")) for item in response.json().get("data", [])}
            if provider.model_name not in model_ids:
                return False, "服务端未返回当前选择的模型。"
        except (httpx.HTTPError, ValueError, TypeError, AttributeError):
            return False, "无法验证连接，请检查 Key、Base URL 与网络。"
        return True, None

    def _chat_for_ontology(self, user_prompt: str) -> ModelCompletion:
        """Call the default model for ontology analysis with a long-form prompt."""
        provider = self._default_agent_provider()
        if provider is None or provider.provider == "Mock Provider":
            return ModelCompletion(
                '{"summary": "Mock 模式：未检测到可用的真实模型。请先在模型管理页验证 DeepSeek 或 GPT 连接。", "entities": [], "relationships": [], "questions": []}',
                "Mock Provider", "ontologyops-mock", "mock",
            )
        api_key = os.getenv(provider.api_key_env or "")
        if provider.verification_status != "verified" or not api_key or not provider.base_url:
            return ModelCompletion(
                '{"summary": "真实模型未验证或缺少凭据。", "entities": [], "relationships": [], "questions": []}',
                provider.provider, provider.model_name, "mock",
            )
        payload = {
            "model": provider.model_name,
            "temperature": 0,
            "max_tokens": 16384,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": "你是企业本体建模专家。基于实际数据做语义分析。不编造数据，不输出代码或 SQL。"},
                {"role": "user", "content": user_prompt},
            ],
        }
        try:
            response = httpx.post(
                f"{provider.base_url.rstrip('/')}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json=payload,
                timeout=120,
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
        except (httpx.HTTPError, KeyError, IndexError, TypeError) as error:
            raise ModelProviderUnavailable("LLM 调用失败：" + str(error)) from error

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
