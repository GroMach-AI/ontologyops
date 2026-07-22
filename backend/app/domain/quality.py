from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class QualityRule:
    id: str
    rule_type: str
    field: str
    config: dict[str, Any] | None = None


@dataclass(frozen=True)
class QualityResult:
    status: str
    pass_rate: float
    sample_rows: list[dict[str, Any]]


def run_quality_rule(
    rule: QualityRule, rows: list[dict[str, Any]]
) -> QualityResult:
    if not rows:
        return QualityResult(status="warning", pass_rate=1.0, sample_rows=[])

    invalid_rows = _invalid_rows(rule, rows)
    valid_count = len(rows) - len(invalid_rows)
    return QualityResult(
        status="passed" if not invalid_rows else "failed",
        pass_rate=valid_count / len(rows),
        sample_rows=invalid_rows[:20],
    )


def _invalid_rows(
    rule: QualityRule, rows: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    if rule.rule_type == "unique":
        values = Counter(row.get(rule.field) for row in rows)
        duplicates = {value for value, count in values.items() if count > 1}
        seen: set[object] = set()
        result: list[dict[str, Any]] = []
        for row in rows:
            value = row.get(rule.field)
            if value in duplicates and value not in seen:
                result.append(row)
                seen.add(value)
        return result
    if rule.rule_type == "not_null":
        return [row for row in rows if row.get(rule.field) in {None, ""}]
    if rule.rule_type == "non_negative":
        return [row for row in rows if (row.get(rule.field) or 0) < 0]
    if rule.rule_type == "timely":
        max_age_days = int((rule.config or {}).get("max_age_days", 1))
        now = (rule.config or {}).get("now", "2026-06-20")
        from datetime import date
        reference = date.fromisoformat(str(now))
        invalid: list[dict[str, Any]] = []
        for row in rows:
            value = row.get(rule.field)
            if value in {None, ""}:
                invalid.append(row); continue
            try:
                observed = date.fromisoformat(str(value)[:10])
                if (reference - observed).days > max_age_days:
                    invalid.append(row)
            except ValueError:
                invalid.append(row)
        return invalid
    if rule.rule_type == "cross_field_equal":
        other_field = str((rule.config or {}).get("other_field", ""))
        if not other_field:
            raise ValueError("cross_field_equal requires other_field")
        return [row for row in rows if row.get(rule.field) != row.get(other_field)]
    raise ValueError(f"Unsupported rule type: {rule.rule_type}")
