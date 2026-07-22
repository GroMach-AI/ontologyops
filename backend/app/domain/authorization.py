from __future__ import annotations

from collections.abc import Mapping

from sqlalchemy import Engine

from app.services.audit import write_audit_event


RESTRICTED_FIELDS: dict[str, dict[str, set[str]]] = {
    "operator": {"Supplier": {"contract_unit_price"}},
    "modeler": {},
    "admin": {},
}


def apply_field_policy(
    role: str, object_type: str, record: Mapping[str, object]
) -> dict[str, object]:
    hidden_fields = RESTRICTED_FIELDS.get(role, {}).get(object_type, set())
    return {key: value for key, value in record.items() if key not in hidden_fields}


def can_access_resource(role: str, resource: str, operation: str) -> bool:
    if role == "admin":
        return True
    if role not in {"modeler", "operator"}:
        return False
    if resource == "model_config":
        return False
    if resource == "ontology":
        return role == "modeler" or operation == "read"
    if resource in {"data_source", "pipeline"}:
        return role == "modeler" or operation == "read"
    if resource == "governance":
        return role == "modeler" or operation == "read"
    return True


def require_resource_access(engine: Engine, role: str, resource: str, operation: str) -> bool:
    allowed = can_access_resource(role, resource, operation)
    if not allowed:
        write_audit_event(
            engine,
            actor=role,
            event_type="permission_denied",
            resource_type=resource,
            payload={"operation": operation},
        )
    return allowed
