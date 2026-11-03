"""Database-level serialization of the Business State persistence phase.

Production evidence, 2026-11-03 03:37 UTC. Two builds for one organization
reached persistence one second apart:

    pid 1179966  idle in transaction  ClientRead              tx age 64s
                 UPDATE business_states SET is_current = FALSE ...
    pid 1179967  active               Lock / transactionid    tx age 64s
                 INSERT INTO business_states (...)

Neither could finish. The caller timed out, the lease stayed held, and no
snapshot was written. The comments in this module always claimed an advisory
lock guarded the persistence transaction; no such call existed, so the
application-level lease was the only coordination.
"""

from __future__ import annotations

import inspect

import pytest

from src.intelligence import business_state
from src.intelligence.business_state import _build_business_state_unlocked


@pytest.fixture(scope="module")
def build_source() -> str:
    return inspect.getsource(_build_business_state_unlocked)


def test_the_advisory_lock_is_taken_before_the_first_write(build_source):
    lock_at = build_source.index("pg_advisory_xact_lock")
    update_at = build_source.index("UPDATE business_states")
    insert_at = build_source.index("INSERT INTO business_states")

    assert lock_at < update_at, "the lock must precede the UPDATE"
    assert lock_at < insert_at, "the lock must precede the INSERT"


def test_the_lock_is_transaction_scoped_so_it_cannot_leak(build_source):
    """A session-scoped lock would be inherited by an unrelated borrower.

    ``pg_advisory_lock`` is tied to the *connection*. With a pooled engine the
    connection returns to the pool after the transaction, so a lock that was not
    explicitly unlocked would be held by whatever borrows that connection next.
    ``pg_advisory_xact_lock`` is released by the transaction ending, on commit
    *and* on rollback, so it cannot outlive the build.
    """
    assert "pg_advisory_xact_lock" in build_source
    # Guard against a regression to the session-scoped variant.
    assert "pg_advisory_lock(" not in build_source
    assert "pg_try_advisory_lock" not in build_source


def test_lock_timeout_is_bounded_and_transaction_local(build_source):
    """Waiting for a stuck peer must fail loudly, not hang to the HTTP timeout."""
    assert "set_config('lock_timeout'" in build_source

    # The third argument makes the setting local to this transaction, so it
    # cannot leak into the session and silently apply to unrelated queries.
    idx = build_source.index("set_config('lock_timeout'")
    assert build_source[idx:idx + 90].count("true") >= 1

    assert business_state.PERSIST_LOCK_TIMEOUT_SECONDS > 0
    # Must be far below the caller's HTTP timeout, or the bound is meaningless.
    assert business_state.PERSIST_LOCK_TIMEOUT_SECONDS <= 30


def test_the_lock_timeout_is_set_before_the_lock_is_requested(build_source):
    """Otherwise the wait for the lock itself is unbounded."""
    assert build_source.index("set_config('lock_timeout'") < build_source.index(
        "pg_advisory_xact_lock"
    )


def test_the_lock_is_scoped_to_one_organization(build_source):
    """A global lock would serialize every merchant behind every other merchant."""
    idx = build_source.index("pg_advisory_xact_lock")
    statement = build_source[idx:idx + 120]
    assert "_build_lock_job_name(organization_id)" in statement or ":lock_key" in statement

    # The key must be derived from the organization, not a constant.
    assert "_build_lock_job_name" in statement or "organization_id" in statement


def test_lock_keys_are_stable_and_organization_scoped():
    assert business_state._build_lock_job_name("org-1") == "business-state-build:org-1"
    assert business_state._build_lock_job_name("org-1") != business_state._build_lock_job_name("org-2")
    # Namespaced so it can never collide with a scheduler job row in the same table.
    assert not business_state._build_lock_job_name("org-1").startswith("business-state\x00")
    assert business_state._build_lock_job_name("org-1") != "business-state"


def test_two_organizations_get_different_advisory_lock_keys():
    """hashtext collisions would serialize unrelated merchants."""
    key_a = business_state._build_lock_job_name("8148cda9-7d41-45b7-b66a-5339cb6286aa")
    key_b = business_state._build_lock_job_name("1dc6aa19-9737-4770-a340-ff812a8b139a")
    assert key_a != key_b


def test_the_lease_and_the_persistence_lock_share_one_key_space():
    """One key per organization, used by both coordination layers."""
    org = "org-shared"
    assert business_state._build_lock_job_name(org) == f"business-state-build:{org}"
    source = inspect.getsource(_build_business_state_unlocked)
    assert "_build_lock_job_name(organization_id)" in source
