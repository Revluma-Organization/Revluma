from src.config import model_registry


def test_beta_channel_prefers_production_then_uses_beta_alias(monkeypatch):
    calls = []
    beta_model = object()

    def fake_load_model(uri):
        calls.append(uri)
        if uri.endswith("@production"):
            raise RuntimeError("production model unavailable")
        return beta_model

    monkeypatch.setenv("MODEL_RELEASE_CHANNEL", "beta")
    monkeypatch.setattr(model_registry.mlflow.sklearn, "load_model", fake_load_model)
    model_registry._loaded_model_channels.clear()

    assert model_registry.load_registered_model("send_time") is beta_model
    assert calls == ["models:/send_time@production", "models:/send_time@beta"]
    assert model_registry.get_loaded_model_channel("send_time") == "beta"


def test_production_channel_never_loads_beta(monkeypatch):
    calls = []

    def unavailable(uri):
        calls.append(uri)
        raise RuntimeError("unavailable")

    monkeypatch.setenv("MODEL_RELEASE_CHANNEL", "production")
    monkeypatch.setattr(model_registry.mlflow.sklearn, "load_model", unavailable)
    model_registry._loaded_model_channels.clear()

    assert model_registry.load_registered_model("abandonment") is None
    assert calls == ["models:/abandonment@production"]
    assert model_registry.get_loaded_model_channel("abandonment") is None


def test_invalid_release_channel_fails_closed(monkeypatch):
    monkeypatch.setenv("MODEL_RELEASE_CHANNEL", "anything")

    assert model_registry.configured_release_channel() == "production"
    assert model_registry.candidate_model_uris("offer_value") == [
        ("production", "models:/offer_value@production")
    ]


def test_missing_release_channel_defaults_to_production(monkeypatch):
    monkeypatch.delenv("MODEL_RELEASE_CHANNEL", raising=False)

    assert model_registry.configured_release_channel() == "production"
