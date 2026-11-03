"""Whether a Business State build actually wrote a snapshot.

A duplicate build returns HTTP 200 carrying the previous snapshot, which used to
be indistinguishable from a real rebuild. The Node scheduler therefore counted a
ten-minute stuck lock as a series of healthy rebuilds. These tests pin the
outcome contract and the lock release guarantee.
"""

from __future__ import annotations

import pytest

from src.intelligence import business_state


class FakeState:
    def __init__(self, state_id: str = "state-1"):
        self.id = state_id
        self.organization_id = "org-1"


@pytest.fixture
def lock(monkeypatch):
    """Track lock acquisition and release."""
    calls = {"acquired": 0, "released": []}

    def fake_acquire(_organization_id, _db):
        calls["acquired"] += 1
        return ("business-state-build:org-1", "lock-token")

    def fake_release(handle, _db, **kwargs):
        # The build now reports its outcome when releasing; accept it so these
        # tests keep asserting the handle rather than the report shape.
        calls["released"].append(handle)

    monkeypatch.setattr(business_state, "_acquire_business_state_lock", fake_acquire)
    monkeypatch.setattr(business_state, "_release_business_state_lock", fake_release)
    return calls


def test_a_build_that_writes_a_snapshot_reports_rebuilt(monkeypatch, lock):
    built = FakeState("fresh")
    monkeypatch.setattr(
        business_state, "_build_business_state_unlocked", lambda _org, _db: built
    )
    monkeypatch.setattr(
        business_state,
        "load_current_business_state",
        lambda *_a, **_k: pytest.fail("must not fall back to a previous snapshot"),
    )

    state, outcome = business_state.build_business_state_with_status("org-1", db=None)

    assert outcome == business_state.OUTCOME_REBUILT
    assert state is built
    assert lock["released"] == [("business-state-build:org-1", "lock-token")]


def test_a_duplicate_build_reports_skipped_and_does_not_rebuild(monkeypatch, lock):
    monkeypatch.setattr(business_state, "_acquire_business_state_lock", lambda _o, _db: None)
    previous = FakeState("previous")
    monkeypatch.setattr(
        business_state, "load_current_business_state", lambda _org, _db: previous
    )
    monkeypatch.setattr(
        business_state,
        "_build_business_state_unlocked",
        lambda *_a, **_k: pytest.fail("a duplicate build must not write a snapshot"),
    )

    state, outcome = business_state.build_business_state_with_status("org-1", db=None)

    assert outcome == business_state.OUTCOME_DUPLICATE_SKIPPED
    assert state is previous
    # No lock was held, so nothing may be released.
    assert lock["released"] == []


def test_a_duplicate_build_with_no_previous_snapshot_raises(monkeypatch, lock):
    monkeypatch.setattr(business_state, "_acquire_business_state_lock", lambda _o, _db: None)
    monkeypatch.setattr(
        business_state, "load_current_business_state", lambda _org, _db: None
    )

    # Reporting success here would claim a snapshot exists when none does.
    with pytest.raises(business_state.BusinessStateBuildInProgress):
        business_state.build_business_state_with_status("org-1", db=None)

    assert lock["released"] == []


def test_the_lock_is_released_even_when_the_build_raises(monkeypatch, lock):
    def explode(_org, _db):
        raise RuntimeError("source query failed")

    monkeypatch.setattr(business_state, "_build_business_state_unlocked", explode)

    with pytest.raises(RuntimeError):
        business_state.build_business_state_with_status("org-1", db=None)

    # A leaked lock would block this organization for the full TTL.
    assert lock["released"] == [("business-state-build:org-1", "lock-token")]


def test_build_business_state_keeps_its_original_contract(monkeypatch, lock):
    built = FakeState("fresh")
    monkeypatch.setattr(
        business_state, "_build_business_state_unlocked", lambda _org, _db: built
    )

    # orchestrator.py and every other existing caller still get a bare state.
    result = business_state.build_business_state("org-1", db=None)

    assert result is built
    assert not isinstance(result, tuple)


def test_outcome_constants_are_distinct_stable_strings():
    assert business_state.OUTCOME_REBUILT == "rebuilt"
    assert business_state.OUTCOME_DUPLICATE_SKIPPED == "duplicate_skipped"
    assert business_state.OUTCOME_REBUILT != business_state.OUTCOME_DUPLICATE_SKIPPED


# ---------------------------------------------------------------------------
# A build must report its own outcome, because the orchestrator path swallows
# the exception and leaves no other trace an operator can see.
# ---------------------------------------------------------------------------


@pytest.fixture
def recorder(monkeypatch):
    """Capture what the build reports when it releases its lease."""
    calls = {"released": []}

    monkeypatch.setattr(
        business_state,
        "_acquire_business_state_lock",
        lambda _org, _db: ("business-state-build:org-1", "tok"),
    )

    def fake_release(handle, _db, **kwargs):
        calls["released"].append((handle, kwargs))

    monkeypatch.setattr(business_state, "_release_business_state_lock", fake_release)
    return calls


def test_a_successful_build_reports_its_state_and_duration(recorder, monkeypatch):
    built = FakeState("fresh-state")
    built.computation_status = "complete"
    monkeypatch.setattr(
        business_state, "_build_business_state_unlocked", lambda _org, _db: built
    )

    state, outcome = business_state.build_business_state_with_status("org-1", db=None)

    assert outcome == business_state.OUTCOME_REBUILT
    _handle, report = recorder["released"][0]
    assert report["outcome"] == "rebuilt"
    assert report["state_id"] == "fresh-state"
    assert report["computation_status"] == "complete"
    assert isinstance(report["duration_ms"], int)
    assert report["duration_ms"] >= 0
    assert report["error"] is None


def test_a_failed_build_reports_the_exception_itself(recorder, monkeypatch):
    def explode(_org, _db):
        raise RuntimeError("could not serialize snapshot")

    monkeypatch.setattr(business_state, "_build_business_state_unlocked", explode)

    with pytest.raises(RuntimeError):
        business_state.build_business_state_with_status("org-1", db=None)

    _handle, report = recorder["released"][0]
    # The orchestrator swallows this exception, so the report is the only trace.
    assert report["outcome"] is None
    assert "RuntimeError" in report["error"]
    assert "could not serialize snapshot" in report["error"]


def test_a_persistence_failure_is_reported_not_hidden(recorder, monkeypatch):
    def explode(_org, _db):
        raise business_state.BusinessStatePersistenceError(
            "Business-state snapshot persistence failed."
        )

    monkeypatch.setattr(business_state, "_build_business_state_unlocked", explode)

    with pytest.raises(business_state.BusinessStatePersistenceError):
        business_state.build_business_state_with_status("org-1", db=None)

    _handle, report = recorder["released"][0]
    assert "BusinessStatePersistenceError" in report["error"]


def test_the_reported_error_is_bounded(recorder, monkeypatch):
    def explode(_org, _db):
        raise RuntimeError("x" * 5000)

    monkeypatch.setattr(business_state, "_build_business_state_unlocked", explode)

    with pytest.raises(RuntimeError):
        business_state.build_business_state_with_status("org-1", db=None)

    _handle, report = recorder["released"][0]
    # Stored in a database column and read by operators: never unbounded.
    assert len(report["error"]) <= 320


def test_release_still_accepts_a_bare_two_argument_call():
    """Existing callers and tests must not break when no report is supplied."""
    from tests.test_business_state_refresh import FakeLockDB

    db = FakeLockDB()
    business_state._release_business_state_lock(("business-state-build:org-1", "tok"), db)

    sql, params = db.statements[0]
    assert params["outcome"] is None
    assert params["error"] is None
    assert db.commits == 1


def test_release_never_persists_the_lock_token():
    from tests.test_business_state_refresh import FakeLockDB

    db = FakeLockDB()
    business_state._release_business_state_lock(
        ("business-state-build:org-1", "tok"), db, outcome="rebuilt"
    )

    sql, _params = db.statements[0]
    # The token is removed from last_result so the row cannot look claimed.
    assert "- 'lock_token'" in sql
    assert "jsonb_strip_nulls" in sql, "null report fields must not be stored as noise"


def test_release_records_the_error_column():
    from tests.test_business_state_refresh import FakeLockDB

    db = FakeLockDB()
    business_state._release_business_state_lock(
        ("business-state-build:org-1", "tok"), db, error="ValueError: bad snapshot"
    )

    sql, params = db.statements[0]
    assert "last_error = :error" in sql
    assert params["error"] == "ValueError: bad snapshot"
