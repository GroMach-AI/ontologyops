from __future__ import annotations

import json
from uuid import uuid4

from sqlalchemy import Engine, or_, select
from sqlalchemy.orm import Session

from app.domain.resource_lifecycle import assert_transition
from app.models.resources import ResourceRecord, ResourceRelationRecord
from app.services.audit import write_audit_event


class ResourceNotFoundError(LookupError):
    pass


class InvalidResourceRelation(ValueError):
    pass


class ResourceRegistry:
    def __init__(self, engine: Engine) -> None:
        self.engine = engine

    def create_resource(
        self,
        resource_type: str,
        display_name: str,
        created_by: str,
        *,
        metadata: dict[str, object] | None = None,
        content_hash: str | None = None,
    ) -> ResourceRecord:
        resource = ResourceRecord(
            id=str(uuid4()),
            resource_type=resource_type,
            display_name=display_name,
            lifecycle_status="editing" if resource_type == "ontology_draft" else "registered",
            version=1,
            created_by=created_by,
            metadata_json=json.dumps(metadata or {}, ensure_ascii=False),
            content_hash=content_hash,
        )
        with Session(self.engine) as session:
            session.add(resource)
            session.commit()
            session.refresh(resource)
        write_audit_event(
            self.engine,
            actor=created_by,
            event_type="resource_created",
            resource_type=resource_type,
            payload={"resource_id": resource.id, "display_name": display_name},
        )
        return resource

    def transition_resource(self, resource_id: str, target_status: str, actor: str) -> ResourceRecord:
        with Session(self.engine) as session:
            resource = self._require_resource(session, resource_id)
            source_status = resource.lifecycle_status
            assert_transition(resource.resource_type, source_status, target_status)
            resource.lifecycle_status = target_status
            resource.version += 1
            session.commit()
            session.refresh(resource)
        write_audit_event(
            self.engine,
            actor=actor,
            event_type="resource_status_changed",
            resource_type=resource.resource_type,
            payload={"resource_id": resource.id, "from": source_status, "to": target_status},
        )
        return resource

    def add_relation(
        self,
        from_resource_id: str,
        to_resource_id: str,
        relation_type: str,
        actor: str,
    ) -> ResourceRelationRecord:
        if from_resource_id == to_resource_id:
            raise InvalidResourceRelation("resource relations cannot be self-referential")
        with Session(self.engine) as session:
            self._require_resource(session, from_resource_id)
            self._require_resource(session, to_resource_id)
            relation = ResourceRelationRecord(
                id=str(uuid4()),
                from_resource_id=from_resource_id,
                to_resource_id=to_resource_id,
                relation_type=relation_type,
                created_by=actor,
            )
            session.add(relation)
            session.commit()
            session.refresh(relation)
        write_audit_event(
            self.engine,
            actor=actor,
            event_type="resource_relation_created",
            resource_type="resource_relation",
            payload={
                "relation_id": relation.id,
                "from_resource_id": from_resource_id,
                "to_resource_id": to_resource_id,
                "relation_type": relation_type,
            },
        )
        return relation

    def get_relations(self, resource_id: str, direction: str = "both") -> list[ResourceRelationRecord]:
        if direction not in {"incoming", "outgoing", "both"}:
            raise ValueError("direction must be incoming, outgoing, or both")
        with Session(self.engine) as session:
            self._require_resource(session, resource_id)
            statement = select(ResourceRelationRecord).order_by(ResourceRelationRecord.created_at)
            if direction == "incoming":
                statement = statement.where(ResourceRelationRecord.to_resource_id == resource_id)
            elif direction == "outgoing":
                statement = statement.where(ResourceRelationRecord.from_resource_id == resource_id)
            else:
                statement = statement.where(
                    or_(
                        ResourceRelationRecord.from_resource_id == resource_id,
                        ResourceRelationRecord.to_resource_id == resource_id,
                    )
                )
            return list(session.scalars(statement))

    @staticmethod
    def _require_resource(session: Session, resource_id: str) -> ResourceRecord:
        resource = session.get(ResourceRecord, resource_id)
        if resource is None:
            raise ResourceNotFoundError(resource_id)
        return resource
