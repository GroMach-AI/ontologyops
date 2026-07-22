from app.domain.authorization import apply_field_policy
from app.domain.quality import QualityRule, run_quality_rule


def test_business_operator_cannot_receive_contract_price() -> None:
    record = {"name": "华东精铸", "contract_unit_price": 188.0}

    filtered = apply_field_policy("operator", "Supplier", record)

    assert filtered == {"name": "华东精铸"}


def test_unique_order_rule_returns_exception_samples() -> None:
    result = run_quality_rule(
        QualityRule(id="order-number-unique", rule_type="unique", field="order_number"),
        [
            {"order_number": "PO-1"},
            {"order_number": "PO-1"},
            {"order_number": "PO-2"},
        ],
    )

    assert result.status == "failed"
    assert result.pass_rate == 2 / 3
    assert result.sample_rows == [{"order_number": "PO-1"}]


def test_timely_and_cross_field_quality_rules_are_supported() -> None:
    timely = run_quality_rule(
        QualityRule(id="fresh", rule_type="timely", field="updated_at", config={"now": "2026-06-20", "max_age_days": 1}),
        [{"updated_at": "2026-06-18"}],
    )
    consistent = run_quality_rule(
        QualityRule(id="match", rule_type="cross_field_equal", field="expected", config={"other_field": "actual"}),
        [{"expected": 3, "actual": 2}],
    )
    assert timely.status == "failed"
    assert consistent.status == "failed"
