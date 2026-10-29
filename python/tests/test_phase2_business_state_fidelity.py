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
