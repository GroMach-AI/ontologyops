from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from sqlalchemy import Engine, select
from sqlalchemy.orm import Session

from app.domain.semantic_tools import SemanticTools
from app.models.platform import OntologyVersion
from app.services.audit import write_audit_event
from app.services.model_provider import ModelProviderService


class AgentService:
    def __init__(self, metadata_engine: Engine, data_dir: Path, role: str) -> None:
        self.metadata_engine = metadata_engine
        self.data_dir = data_dir
        self.role = role

    def chat(self, message: str) -> dict[str, Any]:
        version = self._published_version()
        tools = SemanticTools(self.data_dir, self.role, self.metadata_engine)
        if _is_knowledge_request(message):
            return self._answer_knowledge(message, version, tools)
        if _is_order_count_request(message):
            return self._answer_order_count(version, tools)
        risks = tools.critical_supply_risks()
        definition = json.loads(version.definition_json)
        fallback_answer = _build_answer(risks)
        completion = ModelProviderService(self.metadata_engine).complete_agent_answer(
            {"risks": _evidence_for_risks(risks), "ontology_version": version.semantic_version},
            fallback_answer,
        )
        payload = {
            "answer": completion.content,
            "objects": _objects_for_risks(risks),
            "evidence": _evidence_for_risks(risks),
            "provenance": {
                "sources": [
                    "purchase_orders",
                    "purchase_order_lines",
                    "materials",
                    "inventory",
                    "suppliers",
                ],
                "updated_at": "2026-06-20T09:00:00",
                "metric_definition": definition["metrics"][0]["definition"],
                "ontology_version": version.semantic_version,
            },
            "tool_calls": [
                {"name": "evaluate_rule", "rule": "critical_material_supply_risk", "status": "success"},
                {"name": "traverse_links", "link": "supplier_orders", "status": "success"},
                {"name": "compute_metric", "metric": "supplier_on_time_delivery_rate", "status": "success"},
            ],
            "model": {"provider": completion.provider, "model_name": completion.model_name, "mode": completion.mode},
        }
        write_audit_event(
            self.metadata_engine,
            actor=self.role,
            event_type="agent_tool_call",
            resource_type="ontology_version",
            payload={"message": message, "tool_calls": payload["tool_calls"]},
        )
        write_audit_event(
            self.metadata_engine,
            actor="system",
            event_type="model_call",
            resource_type="model_provider",
            payload={"provider": completion.provider, "model_name": completion.model_name, "mode": completion.mode, "input_tokens": completion.input_tokens, "output_tokens": completion.output_tokens, "status": "success"},
        )
        return payload

    def _answer_order_count(self, version: OntologyVersion, tools: SemanticTools) -> dict[str, Any]:
        count = tools.count_objects("PurchaseOrder")
        payload = {
            "answer": f"当前演示数据中共有 {count} 笔采购订单。该结果由 PurchaseOrder 对象的受控计数工具返回。",
            "objects": [{"type": "PurchaseOrder", "id": "collection", "label": f"{count} 笔采购订单"}],
            "evidence": [{"kind": "object_count", "object_type": "PurchaseOrder", "count": count, "source": "purchase_orders"}],
            "provenance": {"sources": ["purchase_orders"], "updated_at": "2026-06-20T09:00:00", "metric_definition": "采购订单对象总数", "ontology_version": version.semantic_version},
            "tool_calls": [{"name": "find_objects", "object_type": "PurchaseOrder", "operation": "count", "status": "success"}],
            "model": {"provider": "semantic-runtime", "model_name": "ontology-count", "mode": "deterministic"},
        }
        write_audit_event(self.metadata_engine, actor=self.role, event_type="agent_tool_call", resource_type="ontology_version", payload={"message": "order count", "tool_calls": payload["tool_calls"]})
        return payload

    def _answer_knowledge(
        self,
        message: str,
        version: OntologyVersion,
        tools: SemanticTools,
    ) -> dict[str, Any]:
        documents = tools.retrieve_knowledge(message)
        if documents:
            answer = f"根据《{documents[0]['filename']}》：{documents[0]['snippet']}"
        else:
            answer = "当前已授权的文档资产中没有找到可用于回答该问题的内容。"
        payload = {
            "answer": answer,
            "objects": [],
            "evidence": [{"kind": "document", **item} for item in documents],
            "provenance": {
                "sources": [item["filename"] for item in documents],
                "updated_at": "2026-06-20T09:00:00",
                "metric_definition": "文档检索不涉及经营指标计算",
                "ontology_version": version.semantic_version,
            },
            "tool_calls": [{"name": "retrieve_knowledge", "status": "success"}],
            "model": {"provider": "Mock Provider", "model_name": "ontologyops-mock", "mode": "mock"},
        }
        write_audit_event(self.metadata_engine, actor=self.role, event_type="agent_tool_call", resource_type="ontology_version", payload={"message": message, "tool_calls": payload["tool_calls"]})
        return payload

    def _published_version(self) -> OntologyVersion:
        with Session(self.metadata_engine) as session:
            version = session.scalar(
                select(OntologyVersion)
                .where(OntologyVersion.status == "published")
                .order_by(OntologyVersion.published_at.desc())
            )
            if version is None:
                raise ValueError("No published ontology version is available")
            session.expunge(version)
            return version


def _build_answer(risks: list[dict[str, Any]]) -> str:
    if not risks:
        return "当前没有发现同时满足延期、关键物料且低库存条件的供应风险。"
    names = "、".join(sorted({str(row["supplier_name"]) for row in risks}))
    first = risks[0]
    return (
        f"发现 {names} 存在关键物料供应风险：订单 {first['order_number']} 已超过应交日期，"
        f"关联物料 {first['material_name']} 当前库存 {first['quantity_on_hand']}，"
        f"低于安全库存 {first['safety_stock']}。建议业务人员优先核实交期并准备替代供货方案。"
    )


def _is_knowledge_request(message: str) -> bool:
    return any(token in message for token in ("规范", "标准", "制度", "文档", "要求"))


def _is_order_count_request(message: str) -> bool:
    return "订单" in message and any(token in message for token in ("多少", "数量", "几笔", "总数"))


def _objects_for_risks(risks: list[dict[str, Any]]) -> list[dict[str, str]]:
    objects: list[dict[str, str]] = []
    for row in risks:
        objects.extend(
            [
                {"type": "Supplier", "id": str(row["supplier_id"]), "label": str(row["supplier_name"])},
                {"type": "PurchaseOrder", "id": str(row["purchase_order_id"]), "label": str(row["order_number"])},
                {"type": "Material", "id": str(row["material_id"]), "label": str(row["material_name"])},
            ]
        )
    return objects


def _evidence_for_risks(risks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "kind": "critical_supply_risk",
            "supplier": row["supplier_name"],
            "order_number": row["order_number"],
            "material": row["material_name"],
            "quantity_on_hand": row["quantity_on_hand"],
            "safety_stock": row["safety_stock"],
            "promised_at": str(row["promised_at"]),
        }
        for row in risks
    ]
