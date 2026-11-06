"""Coordination and failure diagnostics for the Business State persistence path.

Two production incidents define what belongs here:

2026-11-03 03:37 UTC. Two builds for one organization reached persistence one
second apart and mutually deadlocked on ``idx_bstate_org_current``. Application
lease rows in ``automation_job_state`` are the mutual-exclusion layer for a
build; the unique partial index remains the database-level backstop that turns
an unserialized write into a catchable 23505 instead of a torn state.

2026-11-06. The persisted error string was "Business-state snapshot persistence
failed." - true, but useless. The driver error was logged and discarded. The
failure-reporting contract (cause captured, diagnostics first, bounded string,
exception chain preserved) is what made the 2026-11-06 incident diagnosable; it
is pinned here so it cannot silently regress.

Atomicity itself is covered by test_business_state_persistence_atomicity.py.
This file must not re-introduce client-transaction or advisory-lock needles for
a pooler that scatters statements; they were removed after production disproved
them (see test_write_scope_atomicity.py).
"""

from __future__ import annotations

import inspect

import pytest

from src.intelligence import business_state
from src.intelligence.business_state import _build_business_state_unlocked


@pytest.fixture(scope="module")
def build_source() -> str:
    return inspect.getsource(_build_business_state_unlocked)


# ---------------------------------------------------------------------------
# Application lease: one row per organization, namespaced job name, TTL-bound.
# ---------------------------------------------------------------------------


def test_lease_job_name_is_organization_scoped_and_stable():
    assert business_state._build_lock_job_name("org-1") == "business-state-build:org-1"
    assert business_state._build_lock_job_name("org-1") == business_state._build_lock_job_name("org-1")
    assert business_state._build_lock_job_name("org-1") != business_state._build_lock_job_name("org-2")


def test_lease_job_name_cannot_collide_with_other_job_namespaces():
    name = business_state._build_lock_job_name("org-1")
    assert name.startswith("business-state-build:")
    assert not name.startswith("business-state\x00")
    assert name != "business-state"


def test_lease_job_names_differ_across_real_organizations():
    key_a = business_state._build_lock_job_name("8148cda9-7d41-45b7-b66a-5339cb6286aa")
    key_b = business_state._build_lock_job_name("1dc6aa19-9737-4770-a340-ff812a8b139a")
    assert key_a != key_b


def test_the_lease_claim_commits_so_peers_observe_it(build_source):
    """An uncommitted lease would let two builders claim the same organization."""
    lock_source = inspect.getsource(business_state._acquire_business_state_lock)
    assert "db.commit()" in lock_source


def test_the_lease_release_commits_so_the_outcome_is_durable(build_source):
    release_source = inspect.getsource(business_state._release_business_state_lock)
    assert "db.commit()" in release_source


def test_the_lease_write_races_are_guarded(build_source):
    """The claim must be atomic against stale holders; TTL reclaims dead leases."""
    lock_source = inspect.getsource(business_state._acquire_business_state_lock)
    assert "last_started_at" in lock_source and "make_interval(secs => :ttl)" in lock_source
    assert "status IS DISTINCT FROM 'running'" in lock_source


# ---------------------------------------------------------------------------
# No client-side coordination primitives remain in the persistence path.
# ---------------------------------------------------------------------------


def test_the_persistence_path_uses_no_advisory_lock(build_source):
    assert "pg_advisory" not in build_source
    assert "lock_timeout" not in build_source


def test_the_module_no_longer_defines_a_persistence_lock_timeout():
    assert not hasattr(business_state, "PERSIST_LOCK_TIMEOUT_SECONDS")


def test_the_build_relies_on_the_unique_partial_index_as_db_backstop(build_source):
    # The 23505 mapping turns an unserialized is_current race into a readable
    # BuildInProgress outcome instead of a torn row.
    except_at = build_source.index("except Exception as exc:")
    tail = build_source[except_at:]
    assert "23505" in tail


# ---------------------------------------------------------------------------
# The persistence failure must name its underlying cause.
#
# Production proved why: the lease row reported
# "BusinessStatePersistenceError: Business-state snapshot persistence failed."
# - true, but useless. The driver error that caused it was logged and discarded,
# so the only record of *why* was a log line nobody could read.
# ---------------------------------------------------------------------------


def test_the_persistence_failure_carries_its_underlying_cause(build_source):
    cause_at = build_source.index("persistence_cause = (")
    flag_at = build_source.index("persistence_failed = True")
    raise_at = build_source.rindex("raise BusinessStatePersistenceError")

    # Captured in the handler, before the flag that triggers the raise.
    assert cause_at < flag_at < raise_at
    # And it still names the underlying driver exception, not just the wrapper.
    statement = build_source[cause_at:cause_at + 400]
    assert "{type(exc).__name__}" in statement


def test_the_cause_is_interpolated_into_the_raised_message(build_source):
    idx = build_source.rindex("raise BusinessStatePersistenceError")
    statement = build_source[idx:idx + 320]
    assert "persistence_cause" in statement, "the message must name the real failure"


def test_the_exception_chain_is_preserved(build_source):
    idx = build_source.rindex("raise BusinessStatePersistenceError")
    statement = build_source[idx:idx + 320]
    # `from` keeps __cause__ so a traceback shows the driver error, not just the
    # wrapper. Without it the original exception is lost entirely.
    assert "from persistence_exc" in statement


def test_the_cause_is_bounded_before_it_reaches_a_database_column(build_source):
    idx = build_source.index("persistence_cause = (")
    statement = build_source[idx:idx + 400]
    # Stored in automation_job_state.last_error and read by operators.
    assert any(bound in statement for bound in ("[:200]", "[:280]", "[:300]"))


def test_diagnostics_precede_the_driver_message_so_truncation_cannot_eat_them(build_source):
    """The lesson from production, encoded as a test.

    The caller bounds the reported string to 280 characters before it reaches
    automation_job_state.last_error. The first run of the backend-pid diagnostic
    put the measurements at the END, so production recorded a 311-character string
    ending mid-word at "in_tx_befo": scope_opened survived and the two backend
    pids - the only decisive values - were truncated away.
    """
    idx = build_source.index("persistence_cause = (")
    statement = build_source[idx:idx + 400]

    diag_at = statement.index("diag scope_opened=")
    driver_at = statement.index("{type(exc).__name__}")
    assert diag_at < driver_at, "diagnostics must come first to survive the 280-char bound"

    # The prefix has to fit inside what actually survives truncation.
    wrapper = "Business-state snapshot persistence failed ("
    surviving_budget = 280 - len(wrapper)
    measured_prefix = (
        "diag scope_opened=False in_tx_before=False "
        "pid_before=1215449 pid_after_insert=1216237 | "
    )
    assert len(measured_prefix) < surviving_budget


def test_the_cause_is_recorded_even_when_the_caller_swallows_the_exception():
    """The report is written in the build's finally, not by the caller.

    orchestrator.py wraps the build in `except Exception: logger.error(...)` and
    swallows it. Reporting from the caller would therefore never happen for the
    path that matters most.
    """
    source = inspect.getsource(business_state.build_business_state_with_status)
    assert "finally:" in source
    finally_at = source.index("finally:")
    assert "_release_business_state_lock" in source[finally_at:]
    assert "error=error_text" in source[finally_at:]


def test_a_failed_build_still_releases_its_lease(build_source):
    source = inspect.getsource(business_state.build_business_state_with_status)
    finally_at = source.index("finally:")
    assert "_release_business_state_lock" in source[finally_at:]
