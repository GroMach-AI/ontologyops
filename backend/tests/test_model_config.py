from fastapi.testclient import TestClient

from app.main import app


def test_model_profiles_include_an_openai_compatible_slot(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("ONTOLOGYOPS_METADATA_PATH", str(tmp_path / "metadata.db"))

    response = TestClient(app).get("/api/models")

    assert response.status_code == 200
    compatible = next(item for item in response.json()["providers"] if item["provider"] == "Compatible")
    assert compatible["model_name"] == "custom-model"
    assert compatible["base_url"] == ""
    assert compatible["api_key_env"] == "COMPATIBLE_API_KEY"
