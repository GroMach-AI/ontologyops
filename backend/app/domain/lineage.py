from __future__ import annotations


def metric_lineage(metric_id: str) -> dict[str, object]:
    if metric_id != "supplier_on_time_delivery_rate":
        raise KeyError(metric_id)
    return {
        "nodes": [
            {"id": "source", "type": "source", "label": "ERP / purchase_orders.csv"},
            {"id": "clean", "type": "dataset", "label": "purchase_orders_clean"},
            {"id": "property", "type": "property", "label": "PurchaseOrder.promised_at"},
            {"id": "metric", "type": "metric", "label": "供应商准时交付率"},
            {"id": "agent", "type": "application", "label": "智能问数 Agent"},
        ],
        "edges": [
            {"from": "source", "to": "clean"},
            {"from": "clean", "to": "property"},
            {"from": "property", "to": "metric"},
            {"from": "metric", "to": "agent"},
        ],
    }
