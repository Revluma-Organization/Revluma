"""
Unit tests for dynamic Business State refresh behavior.
Tests the _get_next_rebuild_interval function in business_state.py.
"""

import sys
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import pytest
from unittest.mock import MagicMock

from src.intelligence.business_state import (
    BusinessState,
    CUSTOMER_CONTEXT_LIMIT,
    LTV_APPROACH_BAND,
    LTV_THRESHOLDS,
    VIP_INACTIVE_DAYS,
    _acquire_business_state_lock,
    _get_next_rebuild_interval,
    _load_customer_ml_signals,
    _release_business_state_lock,
)


class TestBusinessStateRefresh:

    def test_normal_load_returns_15_minutes(self):
        result = _get_next_rebuild_interval(current_event_rate=10, baseline_rate=10)
        assert result == timedelta(minutes=15)

    def test_elevated_load_returns_5_minutes(self):
        result = _get_next_rebuild_interval(current_event_rate=20, baseline_rate=10)
        assert result == timedelta(minutes=5)

    def test_spike_load_returns_1_minute(self):
        result = _get_next_rebuild_interval(current_event_rate=50, baseline_rate=10)
        assert result == timedelta(minutes=1)

    def test_boundary_exactly_2x_baseline_returns_5_minutes(self):
        result = _get_next_rebuild_interval(current_event_rate=20, baseline_rate=10)
        assert result == timedelta(minutes=5)

    def test_boundary_exactly_5x_baseline_returns_1_minute(self):
        result = _get_next_rebuild_interval(current_event_rate=50, baseline_rate=10)
        assert result == timedelta(minutes=1)

    def test_zero_baseline_does_not_raise_division_error(self):
        # A new merchant with no history must not cause a ZeroDivisionError.
        result = _get_next_rebuild_interval(current_event_rate=0, baseline_rate=0)
        assert result == timedelta(minutes=15)

    def test_zero_baseline_with_live_traffic_stays_normal(self):
        result = _get_next_rebuild_interval(current_event_rate=100, baseline_rate=0)
        assert result == timedelta(minutes=15)

    def test_negative_baseline_stays_normal(self):
        result = _get_next_rebuild_interval(current_event_rate=100, baseline_rate=-5)
        assert result == timedelta(minutes=15)

    def test_just_below_2x_stays_normal(self):
        # 1.9x ratio should not trigger elevated
        result = _get_next_rebuild_interval(current_event_rate=19, baseline_rate=10)
        assert result == timedelta(minutes=15)

    def test_just_below_5x_stays_elevated(self):
        # 4.9x ratio should not trigger spike
        result = _get_next_rebuild_interval(current_event_rate=49, baseline_rate=10)
        assert result == timedelta(minutes=5)


def _complete_state() -> BusinessState:
    generated_at = datetime(2026, 8, 30, 12, 0, tzinfo=timezone.utc)
    return BusinessState(
        id="state-id",
        organization_id="organization-id",
        schema_version="1.1",
        generated_at=generated_at,
        data_freshness_at=generated_at,
        staleness_threshold_mins=15,
        computation_status="complete",
        warnings=[],
        revenue_today=Decimal("120.50"),
        revenue_yesterday=Decimal("100.00"),
        revenue_delta_pct=20.5,
        revenue_trend_7d=8.0,
        revenue_anomaly=False,
        abandoned_cart_count=2,
        abandoned_cart_value=Decimal("45.00"),
        cart_anomaly=False,
        churn_risk_count=3,
        vip_inactive_count=1,
        returning_customer_rate=0.4,
        returning_customer_rate_delta=5.0,
        opportunities=[],
        risks=[],
        anomalies=[],
        trends=[],
        ml_signals={},
        inventory_signals={"status": "unavailable"},
        anomaly_severity="normal",
        root_causes=[],
        current_event_rate=12.0,
        baseline_event_rate=10.0,
        next_rebuild_at=generated_at + timedelta(minutes=15),
        cart_delta_pct_vs_avg=25.0,
    )


class TestBusinessStateContract:

    def test_nested_contract_contains_each_health_domain(self):
        state = _complete_state().to_dict()

        assert state["sales_health"]["revenue_today"] == 120.5
        assert state["customer_health"]["returning_customer_rate_delta"] == 5.0
        assert state["inventory_health"] == {"status": "unavailable"}
        assert state["anomaly_summary"]["severity"] == "normal"
        assert state["traffic"]["baseline_event_rate_5m_30d"] == 10.0

    def test_flat_compatibility_keys_match_nested_values(self):
        state = _complete_state().to_dict()

        assert state["revenue_today"] == state["sales_health"]["revenue_today"]
        assert state["cart_anomaly"] == state["sales_health"]["cart_anomaly"]
        assert (
            state["returning_customer_rate"]
            == state["customer_health"]["returning_customer_rate"]
        )

    def test_assignment_canonical_contract_is_exposed_without_removing_compatibility(self):
        state = _complete_state().to_dict()

        assert state["snapshot_at"] == state["generated_at"]
        assert state["merchant_id"] == state["organization_id"]
        assert state["revenue"] == {
            "today": 120.5,
            "yesterday": 100.0,
            "delta_pct": 20.5,
            "trend_7d": 8.0,
            "anomaly": False,
            "severity": "low",
        }
        assert state["abandoned_carts"] == {
            "count": 2,
            "value": 45.0,
            "delta_pct_vs_avg": 25.0,
            "anomaly": False,
        }
        assert state["customers"]["vip_inactive_45d"] == 1
        assert state["inventory"] == {"status": "unavailable"}
        assert state["ml_outputs"] == {}
        assert state["top_opportunities"] == []
        assert state["active_concerns"] == []


class TestCustomerAgentContext:

    def test_context_uses_purchase_activity_and_contains_no_pii(self):
        db = MagicMock()
        db.execute.return_value.mappings.return_value.all.return_value = [
            {
                "customer_id": "customer-1",
                "rfm_segment": "champion",
                "past_orders_total": 3,
                "ltv": Decimal("520.00"),
                "previous_ltv": Decimal("480.00"),
                "ltv_currency": "USD",
                "days_inactive": 45,
            }
        ]

        payload = _load_customer_ml_signals(db, {"store_ids": ("store-1",)})

        statement, params = db.execute.call_args.args
        sql = str(statement)
        assert "latest.ordered_at" in sql
        assert "c.updated_at" not in sql
        assert "email" not in sql
        assert "full_name" not in sql
        assert "phone" not in sql
        assert params["context_limit"] == CUSTOMER_CONTEXT_LIMIT
        assert params["vip_days"] == VIP_INACTIVE_DAYS
        assert params["approach_floor"] == 1 - LTV_APPROACH_BAND
        assert tuple(params[f"ltv_{index}"] for index in range(len(LTV_THRESHOLDS))) == LTV_THRESHOLDS
        assert payload == {
            "customers": [
                {
                    "customer_id": "customer-1",
                    "rfm_segment": "champion",
                    "past_orders_total": 3,
                    "ltv": 520.0,
                    "previous_ltv": 480.0,
                    "ltv_currency": "USD",
                    "days_inactive": 45,
                }
            ],
            "limit": CUSTOMER_CONTEXT_LIMIT,
            "truncated": False,
        }

    def test_mixed_or_unlabelled_ltv_is_never_returned_as_a_number(self):
        db = MagicMock()
        db.execute.return_value.mappings.return_value.all.return_value = [
            {
                "customer_id": "customer-mixed",
                "rfm_segment": "champion",
                "past_orders_total": 3,
                "ltv": None,
                "previous_ltv": None,
                "ltv_currency": None,
                "days_inactive": 50,
            },
        ]

        payload = _load_customer_ml_signals(db, {"store_ids": ("store-1",)})

        # Row selection must not treat an unverified LTV as a money value.
        sql = str(db.execute.call_args.args[0])
        assert "c.ltv_mixed_currency = TRUE THEN NULL" in sql
        assert "c.ltv_currency IS NULL THEN NULL" in sql
        assert payload["customers"][0]["ltv"] is None
        assert payload["customers"][0]["previous_ltv"] is None
        assert payload["customers"][0]["ltv_currency"] is None

    def test_context_marks_a_full_page_as_possibly_truncated(self):
        db = MagicMock()
        rows = [
            {
                "customer_id": f"customer-{index}",
                "rfm_segment": "champion",
                "past_orders_total": 1,
                "ltv": Decimal("100.00"),
                "previous_ltv": Decimal("50.00"),
                "days_inactive": 45,
            }
            for index in range(CUSTOMER_CONTEXT_LIMIT)
        ]
        db.execute.return_value.mappings.return_value.all.return_value = rows

        payload = _load_customer_ml_signals(db, {"store_ids": ("store-1",)})

        assert payload["truncated"] is True


def test_daily_revenue_sql_excludes_cancelled_orders():
    from src.intelligence.business_state import DAILY_REVENUE_SQL

    assert "SUM(total)" in DAILY_REVENUE_SQL
    assert "recovery_status" in DAILY_REVENUE_SQL
    for status in ("cancelled", "canceled", "voided", "deleted"):
        assert status in DAILY_REVENUE_SQL


class FakeLockDB:
    """Minimal session double that records the lock SQL and its lifecycle."""

    #: Sentinal: fetchone() echoes the token this worker actually submitted,
    #: which is what the real RETURNING clause hands back when the claim wins.
    ECHO_TOKEN = "__echo_token__"

    def __init__(self, returning=None, fail=False):
        self.statements = []
        self.commits = 0
        self.rollbacks = 0
        self._returning = returning
        self._fail = fail
        self._last_params = {}

    def execute(self, statement, params=None):
        self.statements.append((str(statement), params or {}))
        self._last_params = params or {}
        if self._fail:
            raise RuntimeError("database unavailable")
        return self

    def fetchone(self):
        if self._returning == self.ECHO_TOKEN:
            return (self._last_params.get("token"),)
        return self._returning

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


def test_postgres_build_lock_is_organization_scoped_and_committed():
    from src.intelligence import business_state

    db = FakeLockDB(returning=FakeLockDB.ECHO_TOKEN)
    lock = _acquire_business_state_lock("org-123", db)

    assert lock is not None
    job_name, token = lock
    # Namespaced so it can never collide with a scheduler job row.
    assert job_name == "business-state-build:org-123"
    assert token
    assert db.commits == 1, "the claim must be committed so other instances see it"

    sql, params = db.statements[0]
    assert "INSERT INTO automation_job_state" in sql
    assert "ON CONFLICT (job_name) DO UPDATE" in sql
    assert params["job_name"] == job_name
    assert params["token"] == token
    # The returned token must be ours, proving this worker won the claim.
    assert params["token"] == token


def test_postgres_build_lock_lease_expires_so_a_killed_process_self_heals():
    from src.intelligence import business_state

    db = FakeLockDB(returning=FakeLockDB.ECHO_TOKEN)
    _acquire_business_state_lock("org-123", db)

    sql, params = db.statements[0]
    # A lease left behind by a killed process must be stealable after its TTL,
    # which is the property the previous Redis lease lacked in production.
    assert "make_interval(secs => :ttl)" in sql
    assert "last_started_at" in sql
    assert params["ttl"] == business_state.DEFAULT_BUILD_LOCK_TTL_SECONDS
    assert "IS DISTINCT FROM 'running'" in sql


def test_postgres_build_lock_returns_none_when_already_owned():
    db = FakeLockDB(returning=None)

    assert _acquire_business_state_lock("org-456", db) is None
    assert db.commits == 1


def test_postgres_build_lock_fails_closed_when_the_claim_errors():
    from src.intelligence.business_state import BusinessStateLockUnavailable

    db = FakeLockDB(fail=True)

    # Uncoordinated rebuilds are worse than no rebuild: fail closed.
    with pytest.raises(BusinessStateLockUnavailable):
        _acquire_business_state_lock("org-789", db)

    assert db.rollbacks == 1


def test_postgres_build_lock_release_is_token_owned():
    db = FakeLockDB()

    _release_business_state_lock(("business-state-build:org-123", "token-123"), db)

    sql, params = db.statements[0]
    assert "UPDATE automation_job_state" in sql
    # Token-matched: a worker whose lease expired and was re-claimed must never
    # release the new holder's lease.
    assert "last_result ->> 'lock_token' = :token" in sql
    assert params == {"job_name": "business-state-build:org-123", "token": "token-123"}
    assert db.commits == 1
    # The token must be cleared so the row does not look claimed forever.
    assert "- 'lock_token'" in sql


def test_postgres_build_lock_release_clears_the_token_and_marks_idle():
    db = FakeLockDB()

    _release_business_state_lock(("business-state-build:org-1", "tok"), db)

    sql, _ = db.statements[0]
    assert "status = 'idle'" in sql
    assert "last_completed_at = now()" in sql


def test_postgres_build_lock_release_tolerates_none_and_bad_handles():
    db = FakeLockDB()

    _release_business_state_lock(None, db)
    assert db.statements == []

    # A malformed handle must not raise inside the build's finally block.
    _release_business_state_lock("not-a-tuple", db)
    assert db.statements == []


def test_postgres_build_lock_release_swallows_failures():
    db = FakeLockDB(fail=True)

    # The lease expires on its own TTL; failing the build over cleanup is worse.
    _release_business_state_lock(("business-state-build:org-1", "tok"), db)
    assert db.rollbacks == 1


def test_build_lock_ttl_falls_back_on_garbage(monkeypatch):
    from src.intelligence import business_state

    default = business_state.DEFAULT_BUILD_LOCK_TTL_SECONDS

    for raw in ["", "   ", "not-a-number", "12.5"]:
        monkeypatch.setenv("BUSINESS_STATE_LOCK_TTL_SECONDS", raw)
        assert business_state._build_lock_ttl_seconds() == default, raw

    # A lease shorter than a build would let two builds overlap.
    monkeypatch.setenv("BUSINESS_STATE_LOCK_TTL_SECONDS", "5")
    assert business_state._build_lock_ttl_seconds() == default

    monkeypatch.setenv("BUSINESS_STATE_LOCK_TTL_SECONDS", "120")
    assert business_state._build_lock_ttl_seconds() == 120

    monkeypatch.delenv("BUSINESS_STATE_LOCK_TTL_SECONDS", raising=False)
    assert business_state._build_lock_ttl_seconds() == default


def test_business_state_module_has_no_redis_dependency():
    """The build lock was the module's only Redis use.

    Keeping Redis out of this module matters: the previous lease required a Lua
    EVAL that the managed Redis in use does not support, so leases were never
    released and rebuilds stayed blocked.
    """
    import inspect

    from src.intelligence import business_state

    source = inspect.getsource(business_state)
    assert "import redis" not in source
    assert "redis.from_url" not in source
    assert ".eval(" not in source


def test_a_claim_that_returns_someone_elses_token_is_not_treated_as_ours():
    """The RETURNING token must match, or this worker did not win the claim.

    Without that check a worker could believe it holds a lease that another
    builder actually owns, and both would write snapshots concurrently.
    """
    db = FakeLockDB(returning=("some-other-workers-token",))

    assert _acquire_business_state_lock("org-123", db) is None
