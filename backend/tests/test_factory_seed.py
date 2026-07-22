from pathlib import Path

from app.seed.factory_seed import seed_factory_demo


def test_factory_seed_creates_all_business_views(tmp_path: Path) -> None:
    summary = seed_factory_demo(tmp_path)

    assert set(summary.views) == {
        "suppliers",
        "materials",
        "purchase_orders",
        "purchase_order_lines",
        "inventory",
        "quality_inspections",
    }
    assert summary.rows["purchase_orders"] > 0
    assert summary.rows["quality_inspections"] > 0
