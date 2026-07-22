from __future__ import annotations

import json
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import Engine
from sqlalchemy.orm import Session

from app.models.platform import AuditEvent


def write_audit_event(
    engine: Engine,
    *,
    actor: str,
    event_type: str,
    resource_type: str,
    payload: dict[str, object],
) -> AuditEvent:
    event = AuditEvent(
        id=str(uuid4()),
        actor=actor,
        event_type=event_type,
        resource_type=resource_type,
        payload_json=json.dumps(payload, ensure_ascii=False),
        created_at=datetime.now(UTC),
    )
    with Session(engine) as session:
        session.add(event)
        session.commit()
        session.refresh(event)
    return event
