from __future__ import annotations

import json
from hashlib import sha256
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import Engine, select
from sqlalchemy.orm import Session

from app.models.platform import AuditEvent


def write_audit_event(
    engine: Engine,
    *,
    actor: str,
    event_type: str,
    resource_type: str,
    payload: dict[str, object],
    resource_id: str | None = None,
    correlation_id: str | None = None,
    outcome: str = "succeeded",
) -> AuditEvent:
    with Session(engine) as session:
        previous = session.scalar(select(AuditEvent).order_by(AuditEvent.created_at.desc()).limit(1))
        event = AuditEvent(
            id=str(uuid4()),
            actor=actor,
            event_type=event_type,
            resource_type=resource_type,
            resource_id=resource_id,
            correlation_id=correlation_id,
            outcome=outcome,
            previous_hash=_event_hash(previous) if previous is not None else None,
            payload_json=json.dumps(payload, ensure_ascii=False),
            created_at=datetime.now(UTC),
        )
        session.add(event)
        session.commit()
        session.refresh(event)
    return event


def _event_hash(event: AuditEvent) -> str:
    material = {
        "id": event.id,
        "actor": event.actor,
        "event_type": event.event_type,
        "resource_type": event.resource_type,
        "resource_id": event.resource_id,
        "correlation_id": event.correlation_id,
        "outcome": event.outcome,
        "previous_hash": event.previous_hash,
        "payload_json": event.payload_json,
        "created_at": event.created_at.isoformat(),
    }
    return sha256(json.dumps(material, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
