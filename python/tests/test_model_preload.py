"""Startup model preloading must never block the ASGI lifespan indefinitely.

The uvicorn listener binds only after the lifespan returns, so any preload
wait is also the deploy platform's port-scan budget. These tests pin the
ceiling: slow or broken model resolution degrades to fallback, never to a
hung startup.
"""
import time

import pytest

from src.serving import api as serving_api


def test_preload_step_returns_fallback_quickly_on_slow_loader():
    start = time.monotonic()
    result, elapsed = serving_api._preload_with_timeout(
        "slow_step", lambda: time.sleep(5), 0.2
    )
    wall = time.monotonic() - start
    assert result is None
    assert wall < 2.0
    assert elapsed < 2.0


def test_preload_step_swallows_loader_exceptions():
    def boom():
        raise RuntimeError("registry exploded")

    result, elapsed = serving_api._preload_with_timeout("exploding_step", boom, 1.0)
    assert result is None
    assert elapsed >= 0.0


def test_preload_step_returns_value_when_fast():
    result, elapsed = serving_api._preload_with_timeout(
        "fast_step", lambda: {"pss": None}, 1.0
    )
    assert result == {"pss": None}
    assert elapsed < 1.0


@pytest.mark.parametrize("budget", ["0.05"])
def test_sync_preload_completes_within_budget(monkeypatch, budget):
    monkeypatch.setattr(serving_api, "_MODEL_PRELOAD_TIMEOUT_SECONDS", float(budget))
    # Force every registry resolution to sleep well past the budget.
    monkeypatch.setattr(serving_api, "_load_model", lambda _name: time.sleep(5))
    monkeypatch.setattr(
        serving_api.churn_predict,
        "load_model",
        lambda _name: time.sleep(5),
    )
    monkeypatch.setattr(
        serving_api.churn_predict,
        "load_early_warning_model",
        lambda _name: time.sleep(5),
    )
    monkeypatch.setattr(
        serving_api.timing_predict,
        "load_model",
        lambda _name: time.sleep(5),
    )
    monkeypatch.setattr(
        serving_api.sensitivity_predict,
        "load_model",
        lambda _merchant_id: time.sleep(5),
    )
    monkeypatch.setattr(
        serving_api.offer_value_predict,
        "load_model",
        lambda _merchant_id: time.sleep(5),
    )
    # Registry version refresh would sleep too — pin it to an instant no-op.
    monkeypatch.setattr(
        serving_api,
        "_refresh_loaded_model_versions",
        lambda: None,
    )
    start = time.monotonic()
    serving_api._preload_models_sync()
    wall = time.monotonic() - start
    # 6 preload steps × 0.05s budget + refresh ~= a second — never minutes.
    assert wall < 5.0
