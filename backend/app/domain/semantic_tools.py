from __future__ import annotations

from pathlib import Path
from typing import Any
import json

import duckdb
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session

from app.domain.authorization import apply_field_policy
from app.models.platform import DataSource


class SemanticTools:
    def __init__(self, data_dir: Path, role: str, metadata_engine: Engine | None = None) -> None:
        self.database_path = data_dir / "ontologyops.duckdb"
        self.role = role
        self.metadata_engine = metadata_engine

    def critical_supply_risks(self) -> list[dict[str, Any]]:
        connection = duckdb.connect(str(self.database_path), read_only=True)
        try:
            cursor = connection.execute(
                """
                SELECT
                    suppliers.supplier_id,
                    suppliers.name AS supplier_name,
                    suppliers.risk_level AS supplier_risk_level,
                    suppliers.on_time_delivery_rate,
                    suppliers.quality_pass_rate,
                    suppliers.contract_unit_price,
                    purchase_orders.purchase_order_id,
                    purchase_orders.order_number,
                    purchase_orders.promised_at,
                    materials.material_id,
                    materials.name AS material_name,
                    materials.criticality,
                    inventory.quantity_on_hand,
                    inventory.safety_stock
                FROM purchase_orders
                JOIN suppliers ON suppliers.supplier_id = purchase_orders.supplier_id
                JOIN purchase_order_lines
                    ON purchase_order_lines.purchase_order_id = purchase_orders.purchase_order_id
                JOIN materials ON materials.material_id = purchase_order_lines.material_id
                JOIN inventory ON inventory.material_id = materials.material_id
                WHERE purchase_orders.status = 'open'
                  AND purchase_orders.promised_at < DATE '2026-06-20'
                  AND materials.criticality = 'critical'
                  AND inventory.quantity_on_hand < inventory.safety_stock
                ORDER BY purchase_orders.promised_at ASC
                """
            )
            columns = [column[0] for column in cursor.description]
            rows = [dict(zip(columns, row, strict=True)) for row in cursor.fetchall()]
        finally:
            connection.close()

        return [self._apply_policies(row) for row in rows]

    def count_objects(self, object_type: str) -> int:
        tables = {"PurchaseOrder": "purchase_orders", "Supplier": "suppliers", "Material": "materials"}
        table = tables.get(object_type)
        if table is None:
            raise ValueError("Unsupported ontology object")
        connection = duckdb.connect(str(self.database_path), read_only=True)
        try:
            return int(connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
        finally:
            connection.close()

    def _apply_policies(self, row: dict[str, Any]) -> dict[str, Any]:
        supplier = apply_field_policy(
            self.role,
            "Supplier",
            {
                "supplier_id": row["supplier_id"],
                "supplier_name": row["supplier_name"],
                "contract_unit_price": row["contract_unit_price"],
            },
        )
        result = dict(row)
        result.pop("contract_unit_price", None)
        result.update(supplier)
        return result

    def retrieve_knowledge(self, query: str) -> list[dict[str, str]]:
        if self.metadata_engine is None:
            return []
        query_terms = {term for term in query.replace("？", " ").replace("，", " ").split() if len(term) > 1}
        with Session(self.metadata_engine) as session:
            documents = session.scalars(select(DataSource).where(DataSource.kind == "document")).all()
        matches: list[dict[str, str]] = []
        for document in documents:
            config = json.loads(document.config_json)
            text = str(config.get("text", ""))
            if not text:
                continue
            if query_terms and not any(term in text for term in query_terms):
                # Chinese questions often have no whitespace. Retain all documents as ranked context.
                pass
            matches.append({"source_id": document.id, "filename": document.name, "snippet": text[:800]})
        return matches[:5]
