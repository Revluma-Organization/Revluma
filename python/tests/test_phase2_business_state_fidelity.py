"""Phase 2: reloaded merchant business state retains source reliability warnings."""
from datetime import datetime, timezone

from src.intelligence.business_state import load_current_business_state


def test_load_business_state_retains_persisted_warnings():
    now = datetime.now(timezone.utc)
    row = [None] * 26
    row[0] = "state-1"
    row[1] = "merchant-1"
    row[2] = "1.1"
    row[3] = now
    row[5] = 30
    row[6] = "partial"
    row[23] = {}
    row[24] = {"warnings": ["Order data temporarily unavailable."], "anomaly_severity": "normal"}
    row[25] = now

    class Result:
        def fetchone(self):
            return tuple(row)

    class Session:
        def execute(self, statement, params):
            assert params["org_id"] == "merchant-1"
            assert "WHERE organization_id = :org_id" in str(statement)
            return Result()

    state = load_current_business_state("merchant-1", Session())
    assert state is not None
    assert state.computation_status == "partial"
    assert state.warnings == ["Order data temporarily unavailable."]
    assert state.to_dict()["warnings"] == ["Order data temporarily unavailable."]


def test_load_business_state_rejects_malformed_warning_metadata():
    now = datetime.now(timezone.utc)
    row = [None] * 26
    row[0], row[1], row[2], row[3] = "state-2", "merchant-2", "1.1", now
    row[23], row[24], row[25] = {}, {"warnings": "invalid"}, now

    class Session:
        def execute(self, statement, params):
            class Result:
                def fetchone(self):
                    return tuple(row)
            return Result()

    state = load_current_business_state("merchant-2", Session())
    assert state is not None
    assert state.warnings == []


def test_reliability_never_calls_missing_source_high_confidence():
    from datetime import timedelta
    from src.intelligence.business_state import _empty_state

    now = datetime.now(timezone.utc)
    state = _empty_state("state-3", "merchant-3", now, [])
    state.computation_status = "complete"
    assert state.to_dict()["reliability"]["level"] == "unknown"
    assert state.to_dict()["reliability"]["source_freshness_known"] is False

    state.data_freshness_at = now
    assert state.to_dict()["reliability"]["level"] == "high"

    state.warnings = ["Orders unavailable"]
    assert state.to_dict()["reliability"]["level"] == "limited"

    state.warnings = []
    state.generated_at = now - timedelta(minutes=60)
    assert state.to_dict()["reliability"]["snapshot_stale"] is True
    assert state.to_dict()["reliability"]["level"] == "limited"

    state.computation_status = "failed"
    assert state.to_dict()["reliability"]["level"] == "unavailable"


def test_observed_drivers_never_masquerade_as_verified_root_causes():
    from src.intelligence.business_state import _empty_state

    state = _empty_state("state-4", "merchant-4", datetime.now(timezone.utc), [])
    state.observed_drivers = [{"metric": "revenue_delta_pct", "causality": "unverified"}]
    summary = state.to_dict()["anomaly_summary"]
    assert summary["root_causes"] == []
    assert summary["observed_drivers"][0]["causality"] == "unverified"
    assert summary["root_cause_verification"] == "not_established"


def test_historical_business_changes_are_tenant_scoped_bounded_and_noncausal():
    from datetime import timedelta
    from src.intelligence.business_state import load_business_change_history

    now = datetime.now(timezone.utc)
    seen = {}

    class Result:
        def mappings(self):
            return self

        def all(self):
            return [
                {"id": "new", "generated_at": now, "revenue_today": 120,
                 "abandoned_cart_count": 4, "churn_risk_count": None,
                 "computation_status": "complete"},
                {"id": "old", "generated_at": now - timedelta(minutes=15),
                 "revenue_today": 100, "abandoned_cart_count": 6,
                 "churn_risk_count": None, "computation_status": "partial"},
            ]

    class Session:
        def execute(self, statement, params):
            seen.update(params)
            assert "organization_id = :org_id" in str(statement)
            assert "LIMIT :history_limit" in str(statement)
            return Result()

    history = load_business_change_history("merchant-a", Session(), limit=1000)
    assert seen == {"org_id": "merchant-a", "history_limit": 48}
    assert len(history["snapshots"]) == 2
    assert {item["metric"] for item in history["observed_changes"]} == {
        "revenue_today", "abandoned_cart_count"
    }
    assert all(item["causality"] == "unverified" for item in history["observed_changes"])
    assert all(item["metric"] != "churn_risk_count" for item in history["observed_changes"])


def test_scheduler_briefing_uses_verified_evidence_without_model(monkeypatch):
    from src.agents import orchestrator as module
    from src.intelligence import seven_day_evidence, seven_day_briefing

    monkeypatch.setattr(module, "_get_or_create_conversation", lambda *args: ("conversation-a", False))
    monkeypatch.setattr(module, "_persist_messages", lambda *args, **kwargs: None)
    monkeypatch.setattr(seven_day_evidence, "retrieve_seven_day_evidence",
                        lambda org, db: {"organization_id": org, "store_count": 0})
    monkeypatch.setattr(seven_day_briefing, "compose_seven_day_briefing",
                        lambda evidence: "Verified briefing for " + evidence["organization_id"])
    monkeypatch.setattr(module, "understand", lambda *args, **kwargs: (_ for _ in ()).throw(
        AssertionError("Scheduler must not call the model")))

    result = module._run(
        "merchant-a", "user-a", "Prepare briefing", None, object(), "corr-a",
        trigger_type="scheduler",
    )
    assert result.success is True
    assert result.orchestrator_mode == "Briefing"
    assert result.intent == "scheduled_evidence_briefing"
    assert result.text == "Verified briefing for merchant-a"


def test_new_chat_greeting_is_generated(monkeypatch):
    from src.agents import orchestrator as module
    monkeypatch.setattr(module, "_get_or_create_conversation", lambda *args: ("conversation-test", True))
    monkeypatch.setattr(module, "_persist_messages", lambda *args, **kwargs: None)
    monkeypatch.setattr(module, "understand", lambda *args, **kwargs: (_ for _ in ()).throw(
        AssertionError("Greeting must not call provider")))
    from src.agents import model_gateway
    monkeypatch.setattr(model_gateway, "generate", lambda *args, **kwargs: "Hey! How are things?")
    result = module._run("merchant-a", "user-a", "hey chat how's it going?", None, object(), "corr")
    assert result.success is True
    assert result.intent == "greeting"
    assert "temporarily unable" not in result.text.lower()


def test_existing_chat_hello_chat_is_generated(monkeypatch):
    from src.agents import orchestrator as module
    monkeypatch.setattr(module, "_get_or_create_conversation", lambda *args: ("existing-conversation", False))
    monkeypatch.setattr(module, "_persist_messages", lambda *args, **kwargs: None)
    monkeypatch.setattr(module, "understand", lambda *args, **kwargs: (_ for _ in ()).throw(
        AssertionError("Plain greeting must not call model")))
    from src.agents import model_gateway
    monkeypatch.setattr(model_gateway, "generate", lambda *args, **kwargs: "Hey! How are things?")
    result = module._run("merchant-a", "user-a", "Hello chat", "existing-conversation",
                         object(), "corr-a")
    assert result.success is True
    assert result.intent == "greeting"
    assert result.conversation_id == "existing-conversation"
    assert "temporarily unable" not in result.text.lower()


def test_generated_greeting_provider_outage_is_explicit_failure(monkeypatch):
    from src.agents import orchestrator as module, model_gateway
    monkeypatch.setattr(module, "_get_or_create_conversation", lambda *args: ("conversation-test", True))
    monkeypatch.setattr(module, "_persist_messages", lambda *args, **kwargs: None)
    monkeypatch.setattr(model_gateway, "generate", lambda *args, **kwargs: (_ for _ in ()).throw(TimeoutError()))
    result = module._run("merchant-a", "user-a", "hey rev", None, object(), "corr")
    assert result.success is False
    assert result.response_type == "error"


def test_briefing_date_range_is_readable_without_utc():
    from src.intelligence.seven_day_briefing import compose_seven_day_briefing
    evidence = {"period_start_utc": "2026-07-01T00:00:00Z", "period_end_utc": "2026-07-07T23:59:59Z", "store_count": 0}
    answer = compose_seven_day_briefing(evidence)
    assert "1 July 2026 - 7 July 2026" in answer
    assert "UTC" not in answer


def test_verified_cart_value_answer_bypasses_unavailable_model(monkeypatch):
    from src.agents import orchestrator as module
    from src.intelligence import seven_day_evidence
    monkeypatch.setattr(module, "_get_or_create_conversation", lambda *args: ("conversation-test", True))
    monkeypatch.setattr(module, "_persist_messages", lambda *args, **kwargs: None)
    monkeypatch.setattr(module, "understand", lambda *args, **kwargs: (_ for _ in ()).throw(TimeoutError()))
    monkeypatch.setattr(seven_day_evidence, "retrieve_seven_day_evidence", lambda *args: {
        "abandoned_carts": {"status": "available", "by_currency": [
            {"cart_value": "14831.25", "currency": "USD", "cart_count": 13}]},
        "last_store_sync_at": None,
    })
    result = module._run("merchant-a", "user-a",
        "How much recorded abandoned-cart value does my store have, and how many checkouts need review?",
        None, object(), "corr")
    assert result.success is True
    assert "14831.25 USD" in result.text
    assert "13 carts" in result.text
    assert "Not yet verified" in result.text
    assert "No completed sync" in result.text


def test_verified_historical_comparison_survives_model_outage(monkeypatch):
    from src.agents import orchestrator as module
    monkeypatch.setattr(module, "_get_or_create_conversation", lambda *args: ("conversation-test", True))
    monkeypatch.setattr(module, "_persist_messages", lambda *args, **kwargs: None)
    monkeypatch.setattr(module, "understand", lambda *args, **kwargs: (_ for _ in ()).throw(TimeoutError()))
    monkeypatch.setattr(module, "load_business_change_history", lambda *args, **kwargs: {
        "snapshots": [{"snapshot_id": "new"}, {"snapshot_id": "old"}],
        "observed_changes": [{"metric": "abandoned_cart_count", "from": 4, "to": 7, "delta": 3}],
    })
    result = module._run("merchant-a", "user-a",
        "What has changed in my store recently? Compare my current performance with previous records.",
        None, object(), "corr")
    assert result.success is True
    assert "4 to 7" in result.text
    assert "not cumulative sales or verified causes" in result.text
