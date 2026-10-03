import inspect
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

from src.agents import responder
from src.agents.understanding import _safe_fallback
from src.intelligence.business_state import build_business_state
from src.lab.evaluator.evaluate import (
    DEFAULT_GROUND_TRUTH_DIR,
    _priority_present,
    evaluate,
    load_ground_truth,
    phrase_present,
    score_recommendation,
)
from src.lab.lume_seed import build_seed_sql


ORG_ID = "11111111-1111-1111-1111-111111111111"
STORE_ID = "22222222-2222-2222-2222-222222222222"
AS_OF = datetime(2026, 9, 16, 12, 0, tzinfo=timezone.utc)


def _small_seed_sql() -> str:
    return build_seed_sql(
        ORG_ID,
        STORE_ID,
        "baseline",
        as_of=AS_OF,
        customer_count=4,
        history_days=30,
        recent_event_count=2,
    )


def test_lab_seed_is_reproducible_and_uses_real_derivation_paths():
    first = _small_seed_sql()
    second = _small_seed_sql()

    assert first == second
    assert first.startswith("BEGIN;")
    assert "INSERT INTO events" in first
    assert "INSERT INTO business_state_baselines" in first
    assert "POST /internal/rfm-sync" in first
    assert "POST /internal/business-state/rebuild" in first
    assert "INSERT INTO business_states" not in first
    assert "INSERT INTO alert_queue" not in first
    assert "'champions'" not in first
    assert "'high'" not in first


def test_lab_seed_rejects_untrusted_identifiers_and_scenarios():
    with pytest.raises(ValueError, match="org_id"):
        build_seed_sql("not-a-uuid", STORE_ID)
    with pytest.raises(ValueError, match="Unsupported scenario"):
        build_seed_sql(ORG_ID, STORE_ID, "unknown")


def test_evaluator_loads_reviewed_ground_truth_from_its_own_directory():
    ground_truth = load_ground_truth("SCN-001")

    assert DEFAULT_GROUND_TRUTH_DIR.is_dir()
    assert ground_truth["scenario_id"] == "SCN-001"


def test_evaluator_matches_complete_tokens_instead_of_substrings():
    assert phrase_present("Revenue declined while traffic stayed stable.", "revenue decline")
    assert phrase_present("CPM increased sharply.", "CPM increased significantly")
    assert not _priority_present("Revenue is below plan.", "low")
    assert _priority_present("This is a low priority issue.", "low")


def test_evaluator_detects_short_domain_terms_in_trap_answers():
    ground_truth = load_ground_truth("SCN-001")

    score, _ = score_recommendation("Kill all mobile ads.", ground_truth)

    assert score == 0


def test_multisignal_ground_truth_can_score_detection():
    result = evaluate(
        "SCN-050",
        (
            "Paid traffic increased while revenue declined. Hero product conversion "
            "collapsed and mobile checkout completion deteriorated. Investigate the "
            "hero product and checkout before increasing paid spend."
        ),
    )

    assert result["breakdown"]["detection"]["score"] == 2


def test_registry_does_not_claim_pipeline_readiness_without_supported_signals():
    registry_path = Path(__file__).parents[1] / "src" / "lab" / "scenarios" / "registry.json"
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    ground_truth_ids = {path.stem for path in DEFAULT_GROUND_TRUTH_DIR.glob("SCN-*.json")}

    for scenario in registry["scenarios"]:
        if scenario["status"] == "ground_truth_ready":
            assert scenario["id"] in ground_truth_ids
        assert scenario["pipeline_ready"] is False
        assert scenario["blocker"]


def test_fallback_reasoning_requires_an_ecommerce_domain_for_broad_verbs():
    ecommerce = _safe_fallback("Why does cart abandonment increase?", [], "test")
    unrelated = _safe_fallback("Please improve team morale", [], "test")
    store_specific = _safe_fallback("Fix my checkout", [], "test")

    assert ecommerce.intent == "strategy"
    assert ecommerce.domains == ["carts"]
    assert unrelated.intent == "casual"
    assert store_specific.requires_store_data is True


def test_responder_failure_logs_only_the_exception_type(monkeypatch, caplog, capsys):
    def fail_call(*_args, **_kwargs):
        raise RuntimeError("private-customer@example.com")

    monkeypatch.setattr(responder, "_call", fail_call)
    caplog.set_level(logging.ERROR)
    result = responder.compose_analysis(
        "Why did revenue fall?",
        SimpleNamespace(goal="understand revenue"),
        "{}",
        "{}",
        "{}",
        "",
    )

    captured = capsys.readouterr()
    assert result["actions"] == []
    assert "private-customer@example.com" not in caplog.text
    assert "private-customer@example.com" not in captured.out
    assert {getattr(record, "error_type", None) for record in caplog.records} == {
        "RuntimeError"
    }


def test_business_state_alert_insert_matches_current_schema_column():
    source = inspect.getsource(build_business_state)

    assert "business_state_id" in source
    assert "source_state_id" not in source
