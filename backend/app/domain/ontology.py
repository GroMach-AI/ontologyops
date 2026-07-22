from __future__ import annotations

import json
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session

from app.models.platform import OntologyVersion


def factory_ontology_definition() -> dict[str, object]:
    return {
        "objects": [
            {"id": "Supplier", "label": "供应商", "key": "supplier_id", "attributes": [{"id": "supplier_name", "label": "名称", "type": "string"}, {"id": "risk_level", "label": "风险等级", "type": "string"}, {"id": "contract_unit_price", "label": "合同单价", "type": "number", "sensitive": True}]},
            {"id": "Material", "label": "物料", "key": "material_id", "attributes": [{"id": "material_name", "label": "名称", "type": "string"}, {"id": "is_critical", "label": "关键等级", "type": "boolean"}, {"id": "safety_stock", "label": "安全库存", "type": "number"}]},
            {"id": "PurchaseOrder", "label": "采购订单", "key": "purchase_order_id", "attributes": [{"id": "order_number", "label": "订单号", "type": "string"}, {"id": "promised_at", "label": "应交日期", "type": "date"}, {"id": "status", "label": "状态", "type": "string"}]},
            {"id": "PurchaseOrderLine", "label": "订单明细", "key": "purchase_order_line_id", "attributes": [{"id": "quantity", "label": "数量", "type": "number"}, {"id": "received_quantity", "label": "到货数量", "type": "number"}]},
            {"id": "Inventory", "label": "库存", "key": "inventory_id", "attributes": [{"id": "quantity_on_hand", "label": "现存量", "type": "number"}, {"id": "updated_at", "label": "更新时间", "type": "datetime"}]},
            {"id": "QualityInspection", "label": "质检记录", "key": "inspection_id", "attributes": [{"id": "result", "label": "检验结果", "type": "string"}, {"id": "defect_quantity", "label": "不合格数量", "type": "number"}]},
        ],
        "links": [
            {"name": "supplier_orders", "from": "Supplier", "to": "PurchaseOrder", "cardinality": "one_to_many", "direction": "outbound"},
            {"name": "order_lines", "from": "PurchaseOrder", "to": "PurchaseOrderLine", "cardinality": "one_to_many", "direction": "outbound"},
            {"name": "line_material", "from": "PurchaseOrderLine", "to": "Material", "cardinality": "many_to_one", "direction": "outbound"},
            {"name": "material_inventory", "from": "Material", "to": "Inventory", "cardinality": "one_to_many", "direction": "outbound"},
            {"name": "supplier_quality", "from": "Supplier", "to": "QualityInspection", "cardinality": "one_to_many", "direction": "outbound"},
        ],
        "mappings": [
            {"object": "Supplier", "dataset": "suppliers", "key": "supplier_id"},
            {"object": "Material", "dataset": "materials", "key": "material_id"},
            {"object": "PurchaseOrder", "dataset": "purchase_orders", "key": "purchase_order_id"},
            {"object": "PurchaseOrderLine", "dataset": "purchase_order_lines", "key": "purchase_order_line_id"},
            {"object": "Inventory", "dataset": "inventory", "key": "inventory_id"},
            {"object": "QualityInspection", "dataset": "quality_inspections", "key": "inspection_id"},
        ],
        "metrics": [
            {
                "id": "supplier_on_time_delivery_rate",
                "label": "供应商准时交付率",
                "definition": "按时交付订单数 / 应交付订单数",
                "object_scope": "Supplier",
                "inputs": ["PurchaseOrder.promised_at", "PurchaseOrder.actual_delivered_at"],
                "formula": "on_time_orders / due_orders",
                "owner": "采购负责人",
                "quality_status": "verified",
            },
            {
                "id": "supplier_quality_pass_rate",
                "label": "供应商质量合格率",
                "definition": "质检合格数量 / 已检验数量",
                "object_scope": "Supplier",
                "inputs": ["QualityInspection.result"],
                "formula": "passed_inspections / total_inspections",
                "owner": "质量负责人",
                "quality_status": "verified",
            },
        ],
        "rules": [
            {
                "id": "critical_material_supply_risk",
                "label": "关键物料供应风险",
                "definition": "延期订单关联关键物料且库存低于安全库存",
            },
            {
                "id": "quality_remediation_risk",
                "label": "质量整改风险",
                "definition": "质检不合格且供应商质量合格率低于阈值",
            },
        ],
        "functions": [
            {"id": "calculate_supplier_risk", "label": "计算供应商风险等级", "definition": "综合准时交付、质量与库存风险输出等级", "inputs": ["Supplier", "PurchaseOrder", "Inventory", "QualityInspection"]}
        ],
        "policies": {
            "operator": {"Supplier": {"hidden_fields": ["contract_unit_price"]}}
        },
    }


class OntologyService:
    def __init__(self, engine: Engine) -> None:
        self.engine = engine

    def publish_factory(self) -> OntologyVersion:
        return self.publish_definition(factory_ontology_definition())

    def generate_mock_candidates(self, datasets: list[str]) -> dict[str, object]:
        """Return a deterministic, editable starting point, annotated with source context."""
        definition = factory_ontology_definition()
        source_fields = {
            "purchase_orders": ["purchase_order_id", "supplier_id", "order_number", "promised_at", "status"],
            "purchase_order_lines": ["purchase_order_line_id", "purchase_order_id", "material_id", "quantity"],
            "suppliers": ["supplier_id", "supplier_name", "risk_level"],
            "inventory": ["inventory_id", "material_id", "quantity_on_hand", "updated_at"],
            "quality_inspections": ["inspection_id", "supplier_id", "result", "defect_quantity"],
        }
        return {
            "mode": "mock",
            "definition": definition,
            "dataset_context": [{"dataset": dataset, "fields": source_fields.get(dataset, []), "confidence": "needs_review"} for dataset in datasets],
            "questions": [
                "这些对象是否覆盖当前业务闭环？",
                "哪些字段应作为对象唯一标识？",
                "哪些指标和规则需要由业务负责人确认？",
            ],
        }

    def save_draft(self, definition: dict[str, object]) -> dict[str, object]:
        with Session(self.engine) as session:
            draft = session.scalar(
                select(OntologyVersion)
                .where(OntologyVersion.status == "draft")
                .order_by(OntologyVersion.published_at.desc())
            )
            if draft is None:
                draft = OntologyVersion(
                    id=str(uuid4()),
                    status="draft",
                    semantic_version="draft",
                    definition_json="{}",
                    published_at=datetime.now(UTC),
                )
                session.add(draft)
            draft.definition_json = json.dumps(definition, ensure_ascii=False)
            draft.published_at = datetime.now(UTC)
            session.commit()
            session.refresh(draft)
            return serialize_ontology_version(draft)

    def get_draft(self) -> dict[str, object]:
        with Session(self.engine) as session:
            draft = session.scalar(
                select(OntologyVersion)
                .where(OntologyVersion.status == "draft")
                .order_by(OntologyVersion.published_at.desc())
            )
            if draft is not None:
                return serialize_ontology_version(draft)
        # A new local workspace must be usable on first open. This is still a
        # draft: users explicitly publish only after reviewing the resources.
        return self.save_draft(factory_ontology_definition())

    def draft_impact(self) -> dict[str, object]:
        draft = self.get_draft()
        with Session(self.engine) as session:
            published = session.scalar(
                select(OntologyVersion)
                .where(OntologyVersion.status == "published")
                .order_by(OntologyVersion.published_at.desc())
            )
            published_definition = json.loads(published.definition_json) if published else {}
        definition = draft["definition"]
        categories = ("objects", "links", "mappings", "metrics", "functions", "rules")
        affected: dict[str, dict[str, list[str]]] = {}
        for category in categories:
            draft_items = definition.get(category, []) if isinstance(definition, dict) else []
            published_items = published_definition.get(category, [])
            key = "id" if category != "links" else "name"
            current_map = {str(item.get(key)): item for item in draft_items if isinstance(item, dict)}
            previous_map = {str(item.get(key)): item for item in published_items if isinstance(item, dict)}
            affected[category] = {
                "added": sorted(set(current_map) - set(previous_map)),
                "removed": sorted(set(previous_map) - set(current_map)),
                "changed": sorted(name for name in set(current_map) & set(previous_map) if current_map[name] != previous_map[name]),
            }
        return {
            "base_version": published.semantic_version if published else None,
            "affected": affected,
            "downstream": {"agent_tools": ["find_objects", "traverse_links", "compute_metric", "evaluate_rule", "retrieve_knowledge"], "pages": ["智能问数", "治理中心"]},
        }

    def publish_draft(self) -> dict[str, object]:
        with Session(self.engine) as session:
            draft = session.scalar(
                select(OntologyVersion)
                .where(OntologyVersion.status == "draft")
                .order_by(OntologyVersion.published_at.desc())
            )
            if draft is None:
                raise ValueError("No ontology draft is available")
            definition = json.loads(draft.definition_json)
        return serialize_ontology_version(self.publish_definition(definition))

    def publish_definition(self, definition: dict[str, object]) -> OntologyVersion:
        definition = normalize_definition(definition)
        _validate_publishable_definition(definition)
        with Session(self.engine) as session:
            published = session.scalars(
                select(OntologyVersion).where(OntologyVersion.status == "published")
            ).all()
            released_count = session.scalar(
                select(func.count())
                .select_from(OntologyVersion)
                .where(OntologyVersion.status.in_(("published", "archived")))
            ) or 0
            for current in published:
                current.status = "archived"
            semantic_version = f"v1.0.{released_count}"
            version = OntologyVersion(
                id=str(uuid4()),
                status="published",
                semantic_version=semantic_version,
                definition_json=json.dumps(definition, ensure_ascii=False),
                published_at=datetime.now(UTC),
            )
            session.add(version)
            session.commit()
            session.refresh(version)
            return version

    def list_versions(self) -> dict[str, object]:
        with Session(self.engine) as session:
            versions = session.scalars(
                select(OntologyVersion).order_by(OntologyVersion.published_at.desc())
            ).all()
            return {"versions": [serialize_ontology_version(version) for version in versions]}

    def rollback_to_draft(self, version_id: str) -> dict[str, object]:
        with Session(self.engine) as session:
            source = session.get(OntologyVersion, version_id)
            if source is None or source.status not in {"published", "archived"}:
                raise ValueError("Published ontology version not found")
            definition = json.loads(source.definition_json)
        return self.save_draft(definition)


def serialize_ontology_version(version: OntologyVersion) -> dict[str, object]:
    return {
        "id": version.id,
        "status": version.status,
        "semantic_version": version.semantic_version,
        "published_at": version.published_at.isoformat() if version.published_at else None,
        "definition": normalize_definition(json.loads(version.definition_json)),
    }


def normalize_definition(definition: dict[str, object]) -> dict[str, object]:
    """Make pre-MVP metadata readable by the current resource editor.

    The local demo existed before attributes, mappings and functions were added.
    Keep any user-defined resources and only fill missing canonical resources.
    """
    baseline = factory_ontology_definition()
    normalized = dict(definition)
    for field in ("objects", "links", "mappings", "metrics", "functions", "rules"):
        if not isinstance(normalized.get(field), list):
            normalized[field] = baseline[field]
    if not isinstance(normalized.get("policies"), dict):
        normalized["policies"] = baseline["policies"]

    baseline_objects = {item["id"]: item for item in baseline["objects"]}
    enriched_objects: list[dict[str, object]] = []
    for item in normalized["objects"]:
        if not isinstance(item, dict):
            continue
        enriched = dict(item)
        default = baseline_objects.get(str(enriched.get("id")))
        if default:
            enriched.setdefault("label", default["label"])
            enriched.setdefault("key", default["key"])
            enriched.setdefault("attributes", default["attributes"])
        enriched_objects.append(enriched)
    normalized["objects"] = enriched_objects

    baseline_links = {item["name"]: item for item in baseline["links"]}
    enriched_links: list[dict[str, object]] = []
    for item in normalized["links"]:
        if not isinstance(item, dict):
            continue
        enriched = dict(item)
        default = baseline_links.get(str(enriched.get("name")))
        if default:
            enriched.setdefault("cardinality", default["cardinality"])
            enriched.setdefault("direction", default["direction"])
        enriched_links.append(enriched)
    normalized["links"] = enriched_links
    return normalized


def _validate_publishable_definition(definition: dict[str, object]) -> None:
    objects = definition.get("objects", [])
    metrics = definition.get("metrics", [])
    rules = definition.get("rules", [])
    if not isinstance(objects, list) or len(objects) < 6:
        raise ValueError("Publishing requires six ontology objects")
    if not isinstance(metrics, list) or len(metrics) < 2:
        raise ValueError("Publishing requires two metrics")
    if not isinstance(rules, list) or len(rules) < 2:
        raise ValueError("Publishing requires two rules")
