from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import Engine, select
from sqlalchemy.orm import Session

from app.domain.authorization import apply_field_policy
from app.models.platform import (
    DataSource,
    Dataset,
    OntologyEntityInstanceRecord,
    UserOntology,
)
from app.services.audit import write_audit_event
from app.services.model_provider import ModelCompletion, ModelProviderService, ModelProviderUnavailable


ENTITY_ALIASES: dict[str, tuple[str, ...]] = {
    "SalesOrder": ("销售订单", "订单", "销售"),
    "Supplier": ("供应商", "供货商"),
    "Customer": ("客户",),
    "Product": ("产品", "成品"),
    "Material": ("物料", "材料", "原料"),
    "InventoryLot": ("库存", "库存批次", "批次"),
    "BomLine": ("bom", "物料清单", "清单"),
    "ProductionPlan": ("生产计划", "生产工单", "工单"),
}
COUNT_TERMS = ("多少", "数量", "总数", "统计", "几家", "几条", "几笔")
LIST_TERMS = ("哪些", "分别", "明细", "列表", "哪几")


class AgentService:
    """Controlled natural-language access to published ontology entity instances.

    The service resolves a user question to an entity declared by the published
    ontology, then reads only its materialized instances. A model may summarize
    that already-authorized result, but it never chooses a table or runs SQL.
    """

    def __init__(self, metadata_engine: Engine, role: str) -> None:
        self.metadata_engine = metadata_engine
        self.role = role

    def chat(self, message: str, *, context_entity_id: str | None = None) -> dict[str, Any]:
        ontology = self._published_ontology()
        entities = self._entities(ontology)
        entity = self._resolve_entity(message, entities)
        if entity is None and _is_follow_up_question(message):
            entity = self._entity_from_context(context_entity_id, entities)
        if entity is None:
            return self._general_knowledge_answer(ontology, message)

        entity_id = str(entity["name"])
        entity_label = str(entity.get("label") or entity_id)
        records = self._instances(ontology.id, entity_id)
        operation = "count" if _is_count_request(message) else "list"
        if not records:
            return self._no_data_answer(ontology, entity_id, entity_label, message, operation)

        payload = self._answer_with_data(
            ontology=ontology,
            entity=entity,
            records=records,
            operation=operation,
            message=message,
        )
        self._write_audit(message, payload["tool_calls"], ontology.id)
        return payload

    @staticmethod
    def _entity_from_context(entity_id: str | None, entities: list[dict[str, Any]]) -> dict[str, Any] | None:
        if not entity_id:
            return None
        return next((entity for entity in entities if entity.get("name") == entity_id), None)

    def _published_ontology(self) -> UserOntology:
        with Session(self.metadata_engine) as session:
            ontology = session.scalar(
                select(UserOntology)
                .where(UserOntology.status == "published")
                .order_by(UserOntology.created_at.desc())
            )
            if ontology is None:
                raise ValueError("当前没有已发布本体，无法进行智能问数。")
            session.expunge(ontology)
            return ontology

    def _instances(self, ontology_id: str, entity_id: str) -> list[OntologyEntityInstanceRecord]:
        with Session(self.metadata_engine) as session:
            records = session.scalars(
                select(OntologyEntityInstanceRecord)
                .where(OntologyEntityInstanceRecord.ontology_id == ontology_id)
                .where(OntologyEntityInstanceRecord.entity_id == entity_id)
                .order_by(OntologyEntityInstanceRecord.entity_key)
            ).all()
            for record in records:
                session.expunge(record)
            return records

    @staticmethod
    def _entities(ontology: UserOntology) -> list[dict[str, Any]]:
        return [item for item in json.loads(ontology.entities_json) if isinstance(item, dict) and item.get("name")]

    @staticmethod
    def _resolve_entity(message: str, entities: list[dict[str, Any]]) -> dict[str, Any] | None:
        normalized = message.lower().replace(" ", "")
        matches: list[tuple[int, dict[str, Any]]] = []
        for entity in entities:
            entity_id = str(entity["name"])
            label = str(entity.get("label") or "")
            aliases = (label, entity_id.lower(), *ENTITY_ALIASES.get(entity_id, ()))
            score = max((len(alias) for alias in aliases if alias and alias.lower() in normalized), default=0)
            if score:
                matches.append((score, entity))
        return max(matches, key=lambda item: item[0])[1] if matches else None

    def _answer_with_data(
        self,
        *,
        ontology: UserOntology,
        entity: dict[str, Any],
        records: list[OntologyEntityInstanceRecord],
        operation: str,
        message: str,
    ) -> dict[str, Any]:
        entity_id = str(entity["name"])
        entity_label = str(entity.get("label") or entity_id)
        properties = [self._visible_properties(record, entity_id) for record in records]
        evidence = self._instance_evidence(records, properties, operation)
        sources = self._source_names(records)
        updated_at = max((record.updated_at for record in records), default=datetime.now(UTC))
        fallback = self._fallback_answer(entity_label, properties, operation)
        completion = self._summarize(
            message=message,
            ontology=ontology,
            entity=entity,
            operation=operation,
            count=len(records),
            evidence=evidence,
            fallback=fallback,
        )
        return {
            "route": "ontology",
            "answer": completion.content,
            "objects": self._objects(records, properties, entity_id, entity_label),
            "evidence": evidence,
            "provenance": {
                "sources": sources,
                "updated_at": updated_at.isoformat(),
                "metric_definition": f"已发布本体中「{entity_label}」的已映射实体实例{len(records)}条",
                "ontology_version": self._version_label(ontology),
            },
            "tool_calls": [{"name": "query_entity_instances", "entity_id": entity_id, "operation": operation, "status": "success"}],
            "model": self._model_payload(completion),
        }

    def _no_data_answer(
        self,
        ontology: UserOntology,
        entity_id: str,
        entity_label: str,
        message: str,
        operation: str,
    ) -> dict[str, Any]:
        tool_calls = [{"name": "query_entity_instances", "entity_id": entity_id, "operation": operation, "status": "success"}]
        payload = {
            "route": "ontology",
            "answer": f"当前已发布本体中的「{entity_label}」尚无已映射数据，无法基于该实体给出结论。请先在数据与管道中完成可信数据集映射与实体填充。",
            "objects": [],
            "evidence": [{"kind": "entity_no_data", "entity_id": entity_id, "entity_label": entity_label}],
            "provenance": {
                "sources": [],
                "updated_at": datetime.now(UTC).isoformat(),
                "metric_definition": f"「{entity_label}」实体实例数为 0",
                "ontology_version": self._version_label(ontology),
            },
            "tool_calls": tool_calls,
            "model": {"provider": "受控查询引擎", "model_name": "ontology-instance-query", "mode": "deterministic"},
        }
        self._write_audit(message, tool_calls, ontology.id)
        return payload

    def _general_knowledge_answer(self, ontology: UserOntology, message: str) -> dict[str, Any]:
        model_service = ModelProviderService(self.metadata_engine)
        profile = model_service.agent_profile()
        if _is_model_identity_question(message):
            completion = ModelCompletion(
                _model_identity_message(profile),
                profile["provider"],
                profile["model_name"],
                profile["mode"],
            )
        else:
            try:
                completion = model_service.complete_general_answer(message)
            except ModelProviderUnavailable:
                completion = ModelCompletion(
                    "当前没有可用的已验证大模型，因此暂时无法回答通用知识问题。请先在模型管理中验证并启用 DeepSeek、GPT 或兼容模型。",
                    profile["provider"],
                    profile["model_name"],
                    "deterministic",
                )
        payload = {
            "route": "knowledge",
            "answer": completion.content,
            "objects": [],
            "evidence": [],
            "provenance": {
                "sources": ["大模型通用知识"],
                "updated_at": datetime.now(UTC).isoformat(),
                "metric_definition": "通用知识回答不读取企业本体数据，也不提供企业数据证据。",
                "ontology_version": self._version_label(ontology),
            },
            "tool_calls": [],
            "model": self._model_payload(completion),
        }
        self._write_audit(message, [], ontology.id)
        return payload

    def _summarize(
        self,
        *,
        message: str,
        ontology: UserOntology,
        entity: dict[str, Any],
        operation: str,
        count: int,
        evidence: list[dict[str, Any]],
        fallback: str,
    ) -> ModelCompletion:
        context = {
            "user_question": message,
            "ontology": ontology.name,
            "ontology_version": self._version_label(ontology),
            "entity": {"id": entity["name"], "label": entity.get("label")},
            "operation": operation,
            "count": count,
            "evidence": evidence,
        }
        try:
            return ModelProviderService(self.metadata_engine).complete_agent_answer(context, fallback)
        except ModelProviderUnavailable:
            return ModelCompletion(fallback, "受控查询引擎", "ontology-instance-query", "deterministic")

    def _source_names(self, records: list[OntologyEntityInstanceRecord]) -> list[str]:
        dataset_ids = sorted({record.source_dataset_id for record in records})
        if not dataset_ids:
            return []
        with Session(self.metadata_engine) as session:
            datasets = {item.id: item for item in session.scalars(select(Dataset).where(Dataset.id.in_(dataset_ids))).all()}
            source_ids = {item.source_id for item in datasets.values()}
            sources = {item.id: item.name for item in session.scalars(select(DataSource).where(DataSource.id.in_(source_ids))).all()}
        return [sources.get(datasets[dataset_id].source_id, dataset_id) if dataset_id in datasets else dataset_id for dataset_id in dataset_ids]

    def _visible_properties(self, record: OntologyEntityInstanceRecord, entity_id: str) -> dict[str, Any]:
        return apply_field_policy(self.role, entity_id, json.loads(record.properties_json))

    @staticmethod
    def _instance_evidence(
        records: list[OntologyEntityInstanceRecord], properties: list[dict[str, Any]], operation: str
    ) -> list[dict[str, Any]]:
        if operation == "count":
            first = records[0]
            return [{
                "kind": "entity_count",
                "entity_id": first.entity_id,
                "count": len(records),
                "dataset_id": first.source_dataset_id,
                "mapping_id": first.mapping_id,
                "pipeline_run_id": first.pipeline_run_id,
            }]
        return [
            {
                "kind": "entity_instance",
                "entity_id": record.entity_id,
                "entity_key": record.entity_key,
                "properties": values,
                "dataset_id": record.source_dataset_id,
                "mapping_id": record.mapping_id,
                "pipeline_run_id": record.pipeline_run_id,
            }
            for record, values in zip(records[:10], properties[:10], strict=True)
        ]

    @staticmethod
    def _objects(
        records: list[OntologyEntityInstanceRecord], properties: list[dict[str, Any]], entity_id: str, entity_label: str
    ) -> list[dict[str, str]]:
        return [
            {"type": entity_id, "id": record.entity_key, "label": _object_label(values, entity_label, record.entity_key)}
            for record, values in zip(records[:10], properties[:10], strict=True)
        ]

    @staticmethod
    def _fallback_answer(entity_label: str, properties: list[dict[str, Any]], operation: str) -> str:
        if operation == "count":
            return f"当前已发布本体中已映射 {len(properties)} 条「{entity_label}」实体数据。"
        labels = "、".join(_object_label(item, entity_label, str(index + 1)) for index, item in enumerate(properties[:10]))
        suffix = "（仅展示前 10 条）" if len(properties) > 10 else ""
        return f"当前已发布本体中共有 {len(properties)} 条「{entity_label}」实体数据：{labels}{suffix}。"

    @staticmethod
    def _version_label(ontology: UserOntology) -> str:
        return f"v{ontology.version.lstrip('v')}"

    @staticmethod
    def _model_payload(completion: ModelCompletion) -> dict[str, str]:
        return {"provider": completion.provider, "model_name": completion.model_name, "mode": completion.mode}

    def _write_audit(self, message: str, tool_calls: list[dict[str, str]], ontology_id: str) -> None:
        write_audit_event(
            self.metadata_engine,
            actor=self.role,
            event_type="agent_tool_call",
            resource_type="ontology",
            resource_id=ontology_id,
            payload={"message": message, "tool_calls": tool_calls},
        )


def _object_label(properties: dict[str, Any], entity_label: str, fallback: str) -> str:
    for key in ("name", "order_id", "sales_order_no", "code", "supplier_id", "product_id", "material_id"):
        value = properties.get(key)
        if value not in (None, ""):
            return str(value)
    return f"{entity_label} {fallback}"


def _is_model_identity_question(message: str) -> bool:
    normalized = message.replace(" ", "")
    return any(token in normalized for token in ("哪个模型", "什么模型", "你是谁", "模型身份"))


def _is_count_request(message: str) -> bool:
    return not any(term in message for term in LIST_TERMS) and any(term in message for term in COUNT_TERMS)


def _is_follow_up_question(message: str) -> bool:
    normalized = message.replace(" ", "")
    return any(term in normalized for term in ("分别", "哪些", "明细", "列表", "哪几", "它们", "这些", "这几"))


def _model_identity_message(profile: dict[str, str]) -> str:
    if profile["mode"] == "real":
        return f"当前智能助手配置使用 {profile['provider']} 的 {profile['model_name']}。企业数据问题会先经过本体受控查询，再由该模型组织回答；通用问题不读取企业本体数据。"
    return "当前智能助手未启用已验证的真实大模型。本体数据问题仍可返回受控查询结果；通用知识回答需要先在模型管理中验证并启用模型。"
