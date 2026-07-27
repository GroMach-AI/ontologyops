"""Validation and immutable publication for ontology drafts."""
from __future__ import annotations

import json
from uuid import uuid4

from sqlalchemy import Engine, select
from sqlalchemy.orm import Session

from app.models.platform import CurrentOntologyRelease, Dataset, OntologyDraftRecord, OntologyReleaseRecord


class OntologyReleaseService:
    def __init__(self, engine: Engine) -> None:
        self.engine = engine

    def create_draft(self, definition: dict[str, object]) -> dict[str, object]:
        draft_id = str(uuid4())
        with Session(self.engine) as session:
            session.add(
                OntologyDraftRecord(
                    id=draft_id,
                    name=str(definition["name"]),
                    scope=str(definition["scope"]),
                    definition_json=json.dumps(definition, ensure_ascii=False),
                )
            )
            session.commit()
        return {"draft_id": draft_id, "status": "editing"}

    def validate(self, draft_id: str) -> dict[str, object]:
        with Session(self.engine) as session:
            draft = session.get(OntologyDraftRecord, draft_id)
            if draft is None:
                raise KeyError("Ontology draft not found")
            definition = json.loads(draft.definition_json)
            blockers = self._blockers(session, definition)
        return {"draft_id": draft_id, "valid": not blockers, "blockers": blockers}

    def _blockers(self, session: Session, definition: dict[str, object]) -> list[dict[str, str]]:
        blockers: list[dict[str, str]] = []
        entities = definition.get("entities", [])
        entity_ids = {str(entity.get("id", "")) for entity in entities if isinstance(entity, dict)}
        for entity in entities:
            if not isinstance(entity, dict):
                continue
            primary_key = str(entity.get("primary_key", ""))
            properties = entity.get("properties", [])
            if not primary_key or primary_key not in properties:
                blockers.append({
                    "code": "entity_primary_key_missing",
                    "message": "实体必须声明属于自身属性的主键。",
                    "resource_id": str(entity.get("id", "")),
                })
        for mapping in definition.get("mappings", []):
            if not isinstance(mapping, dict):
                continue
            dataset_id = str(mapping.get("dataset_version_id", ""))
            dataset = session.get(Dataset, dataset_id)
            if dataset is None or dataset.stage != "trusted":
                blockers.append({
                    "code": "mapping_dataset_not_trusted",
                    "message": "映射引用的数据集版本尚未可信。",
                    "resource_id": dataset_id,
                })
                continue
            schema = json.loads(dataset.schema_json)
            source_fields = {
                str(column.get("name")) if isinstance(column, dict) else str(column)
                for column in schema.get("columns", [])
            }
            for source_field in mapping.get("field_mappings", {}).values():
                if str(source_field) not in source_fields:
                    blockers.append({
                        "code": "mapping_source_field_missing",
                        "message": "映射引用的源字段不存在于数据集版本中。",
                        "resource_id": str(source_field),
                    })
        for relationship in definition.get("relationships", []):
            if not isinstance(relationship, dict):
                continue
            for endpoint in ("from_entity_id", "to_entity_id"):
                value = str(relationship.get(endpoint, ""))
                if value not in entity_ids:
                    blockers.append({
                        "code": "relationship_endpoint_missing",
                        "message": "关系必须引用草稿中的实体。",
                        "resource_id": value,
                    })
        return blockers

    def publish(self, draft_id: str) -> dict[str, object]:
        with Session(self.engine) as session:
            draft = session.get(OntologyDraftRecord, draft_id)
            if draft is None:
                raise KeyError("Ontology draft not found")
            definition = json.loads(draft.definition_json)
            blockers = self._blockers(session, definition)
            if blockers:
                raise ValueError(json.dumps(blockers, ensure_ascii=False))
            previous = session.get(CurrentOntologyRelease, draft.name)
            release_number = 1
            if previous is not None:
                prior_release = session.get(OntologyReleaseRecord, previous.release_id)
                if prior_release is not None:
                    release_number = int(prior_release.semantic_version.removeprefix("v")) + 1
                    prior_release.status = "superseded"
            release_id = str(uuid4())
            manifest = {
                "release_id": release_id,
                "draft_id": draft_id,
                "entities": definition.get("entities", []),
                "relationships": definition.get("relationships", []),
                "mappings": definition.get("mappings", []),
            }
            release = OntologyReleaseRecord(
                id=release_id,
                ontology_name=draft.name,
                draft_id=draft_id,
                semantic_version=f"v{release_number}",
                manifest_json=json.dumps(manifest, ensure_ascii=False),
            )
            semantic_version = release.semantic_version
            session.add(release)
            if previous is None:
                session.add(CurrentOntologyRelease(ontology_name=draft.name, release_id=release_id))
            else:
                previous.release_id = release_id
            draft.status = "published"
            session.commit()
        return {"release_id": release_id, "semantic_version": semantic_version, "manifest": manifest, "status": "published"}
