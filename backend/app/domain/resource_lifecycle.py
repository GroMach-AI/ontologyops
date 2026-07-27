from __future__ import annotations


ALLOWED_TRANSITIONS: dict[str, dict[str, set[str]]] = {
    "source_asset": {"registered": {"profiled", "rejected"}},
    "dataset_version": {
        "registered": {"profiled", "rejected"},
        "profiled": {"trusted", "rejected"},
    },
    "ontology_draft": {
        "editing": {"validation_failed", "ready_to_publish"},
        "validation_failed": {"editing"},
        "ready_to_publish": {"editing", "published"},
    },
}


class InvalidLifecycleTransition(ValueError):
    def __init__(self, resource_type: str, source: str, target: str) -> None:
        super().__init__(f"{resource_type} cannot transition from {source} to {target}")


def can_transition(resource_type: str, source: str, target: str) -> bool:
    return target in ALLOWED_TRANSITIONS.get(resource_type, {}).get(source, set())


def assert_transition(resource_type: str, source: str, target: str) -> None:
    if not can_transition(resource_type, source, target):
        raise InvalidLifecycleTransition(resource_type, source, target)
