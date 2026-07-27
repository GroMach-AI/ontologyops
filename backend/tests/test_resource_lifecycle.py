from app.domain.resource_lifecycle import can_transition


def test_dataset_version_can_only_be_trusted_after_profiled():
    assert can_transition("dataset_version", "registered", "profiled") is True
    assert can_transition("dataset_version", "profiled", "trusted") is True
    assert can_transition("dataset_version", "registered", "trusted") is False


def test_unknown_resource_type_cannot_transition():
    assert can_transition("metric", "registered", "trusted") is False
