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

    def fake_acquire(_organization_id):
        calls["acquired"] += 1
        return {"token": "lock-token"}

    def fake_release(handle):
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
    assert lock["released"] == [{"token": "lock-token"}]


def test_a_duplicate_build_reports_skipped_and_does_not_rebuild(monkeypatch, lock):
    monkeypatch.setattr(business_state, "_acquire_business_state_lock", lambda _o: None)
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
    monkeypatch.setattr(business_state, "_acquire_business_state_lock", lambda _o: None)
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
    assert lock["released"] == [{"token": "lock-token"}]


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
