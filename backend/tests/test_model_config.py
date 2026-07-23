from fastapi.testclient import TestClient

from app.main import app
from app.seed.factory_seed import seed_factory_demo


def test_model_provider_can_be_listed_and_switched(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("ONTOLOGYOPS_METADATA_PATH", str(tmp_path / "metadata.db"))
    client = TestClient(app)

    listed = client.get("/api/models")
    assert listed.status_code == 200
    providers = listed.json()["providers"]
    mock = next(provider for provider in providers if provider["provider"] == "Mock Provider")
    deepseek = next(provider for provider in providers if provider["provider"] == "DeepSeek")
    assert mock["is_default"] is True
    assert {"GPT", "DeepSeek"}.issubset({provider["provider"] for provider in providers})
    assert deepseek["model_name"] == "deepseek-v4-flash"
    assert deepseek["available_models"] == [
        {"id": "deepseek-v4-flash", "label": "DeepSeek V4 Flash"},
        {"id": "deepseek-v4-pro", "label": "DeepSeek V4 Pro"},
    ]
    assert deepseek["verification_status"] == "unconfigured"
    assert "api_key" not in deepseek

    updated = client.patch(
        f"/api/models/{mock['id']}",
        headers={"X-Demo-Role": "admin"},
        json={"enabled": True, "is_default": True},
    )
    assert updated.status_code == 200
    assert updated.json()["secret_policy"].startswith("API Key")


def test_real_provider_must_verify_before_becoming_default(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("ONTOLOGYOPS_METADATA_PATH", str(tmp_path / "metadata.db"))
    client = TestClient(app)
    deepseek = next(item for item in client.get("/api/models").json()["providers"] if item["provider"] == "DeepSeek")
    rejected = client.patch(
        f"/api/models/{deepseek['id']}",
        headers={"X-Demo-Role": "admin"},
        json={"enabled": True, "is_default": True, "model_name": "deepseek-v4-flash"},
    )
    assert rejected.status_code == 400
    assert "verified" in rejected.json()["detail"]


def test_verification_uses_env_key_without_returning_it(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("ONTOLOGYOPS_METADATA_PATH", str(tmp_path / "metadata.db"))
    monkeypatch.setenv("DEEPSEEK_API_KEY", "not-for-response")
    client = TestClient(app)
    deepseek = next(item for item in client.get("/api/models").json()["providers"] if item["provider"] == "DeepSeek")

    class FakeResponse:
        def raise_for_status(self): pass
        def json(self): return {"data": [{"id": "deepseek-v4-flash"}, {"id": "deepseek-v4-pro"}]}

    monkeypatch.setattr("app.services.model_provider.httpx.get", lambda *args, **kwargs: FakeResponse())
    verified = client.post(f"/api/models/{deepseek['id']}/verify", headers={"X-Demo-Role": "admin"})
    assert verified.status_code == 200
    assert verified.json()["verification_status"] == "verified"
    assert "not-for-response" not in str(verified.json())


def test_selected_real_model_never_falls_back_to_mock_when_key_disappears(tmp_path, monkeypatch) -> None:
    seed_factory_demo(tmp_path / "data")
    monkeypatch.setenv("ONTOLOGYOPS_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("ONTOLOGYOPS_METADATA_PATH", str(tmp_path / "metadata.db"))
    monkeypatch.setenv("DEEPSEEK_API_KEY", "temporary-key")
    client = TestClient(app)
    client.post("/api/ontology/publish-factory")
    deepseek = next(item for item in client.get("/api/models").json()["providers"] if item["provider"] == "DeepSeek")

    class VerifyResponse:
        def raise_for_status(self): pass
        def json(self): return {"data": [{"id": "deepseek-v4-flash"}]}

    monkeypatch.setattr("app.services.model_provider.httpx.get", lambda *args, **kwargs: VerifyResponse())
    assert client.post(f"/api/models/{deepseek['id']}/verify", headers={"X-Demo-Role": "admin"}).status_code == 200
    assert client.patch(f"/api/models/{deepseek['id']}", headers={"X-Demo-Role": "admin"}, json={"enabled": True, "is_default": True}).status_code == 200
    monkeypatch.delenv("DEEPSEEK_API_KEY")

    response = client.post("/api/agent/chat", headers={"X-Demo-Role": "operator"}, json={"message": "本月哪些供应商的订单最容易延期，且影响关键物料库存？"})
    assert response.status_code == 409
    assert "密钥" in response.json()["detail"]


def test_real_compatible_provider_is_used_for_safe_agent_summary(tmp_path, monkeypatch) -> None:
    seed_factory_demo(tmp_path / "data")
    monkeypatch.setenv("ONTOLOGYOPS_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("ONTOLOGYOPS_METADATA_PATH", str(tmp_path / "metadata.db"))
    monkeypatch.setenv("TEST_LLM_KEY", "test-key")
    client = TestClient(app)
    client.post("/api/ontology/publish-factory")

    created = client.post(
        "/api/models",
        headers={"X-Demo-Role": "admin"},
        json={"provider": "Test Compatible", "model_name": "test-model", "base_url": "https://llm.test/v1", "api_key_env": "TEST_LLM_KEY"},
    )
    assert created.status_code == 201

    class VerifyResponse:
        def raise_for_status(self): pass
        def json(self): return {"data": [{"id": "test-model"}]}

    monkeypatch.setattr("app.services.model_provider.httpx.get", lambda *args, **kwargs: VerifyResponse())
    verified = client.post(f"/api/models/{created.json()['id']}/verify", headers={"X-Demo-Role": "admin"})
    assert verified.status_code == 200
    assert verified.json()["verification_status"] == "verified"
    client.patch(
        f"/api/models/{created.json()['id']}",
        headers={"X-Demo-Role": "admin"},
        json={"enabled": True, "is_default": True, "base_url": "https://llm.test/v1", "api_key_env": "TEST_LLM_KEY"},
    )

    class FakeResponse:
        def raise_for_status(self): pass
        def json(self): return {"choices": [{"message": {"content": "真实兼容模型的受控总结"}}], "usage": {"prompt_tokens": 10, "completion_tokens": 5}}
    monkeypatch.setattr("app.services.model_provider.httpx.post", lambda *args, **kwargs: FakeResponse())
    answer = client.post("/api/agent/chat", headers={"X-Demo-Role": "operator"}, json={"message": "本月哪些供应商的订单最容易延期，且影响关键物料库存？"})

    assert answer.status_code == 200
    assert answer.json()["answer"] == "真实兼容模型的受控总结"
    assert answer.json()["model"]["mode"] == "real"
