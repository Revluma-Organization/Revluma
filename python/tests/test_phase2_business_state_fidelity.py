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
