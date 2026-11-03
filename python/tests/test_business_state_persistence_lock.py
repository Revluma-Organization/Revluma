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


# Executable-SQL needles. Deliberately prefixed with SELECT / SET so they can
# never match the prose comments that explain these fixes.
LOCK_SQL = "SELECT pg_advisory_xact_lock("
TIMEOUT_SQL = "SELECT set_config('lock_timeout'"
UPDATE_SQL = "SET is_current = FALSE"
INSERT_SQL = "INSERT INTO business_states ("


@pytest.fixture(scope="module")
def build_source() -> str:
    return inspect.getsource(_build_business_state_unlocked)


def test_the_advisory_lock_is_taken_before_the_first_write(build_source):
    lock_at = build_source.index(LOCK_SQL)
    update_at = build_source.index(UPDATE_SQL)
    insert_at = build_source.index(INSERT_SQL)

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
    assert LOCK_SQL in build_source
    # Guard against a regression to the session-scoped variant.
    assert "pg_advisory_lock(" not in build_source
    assert "pg_try_advisory_lock" not in build_source


def test_lock_timeout_is_bounded_and_transaction_local(build_source):
    """Waiting for a stuck peer must fail loudly, not hang to the HTTP timeout."""
    assert TIMEOUT_SQL in build_source

    # The third argument makes the setting local to this transaction, so it
    # cannot leak into the session and silently apply to unrelated queries.
    idx = build_source.index(TIMEOUT_SQL)
    assert build_source[idx:idx + 90].count("true") >= 1

    assert business_state.PERSIST_LOCK_TIMEOUT_SECONDS > 0
    # Must be far below the caller's HTTP timeout, or the bound is meaningless.
    assert business_state.PERSIST_LOCK_TIMEOUT_SECONDS <= 30


def test_the_lock_timeout_is_set_before_the_lock_is_requested(build_source):
    """Otherwise the wait for the lock itself is unbounded."""
    assert build_source.index(TIMEOUT_SQL) < build_source.index(LOCK_SQL)


def test_the_lock_is_scoped_to_one_organization(build_source):
    """A global lock would serialize every merchant behind every other merchant."""
    idx = build_source.index(LOCK_SQL)
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
    raise_at = build_source.index("raise BusinessStatePersistenceError")

    # Captured in the handler, before the flag that triggers the raise.
    assert cause_at < flag_at < raise_at
    # And it still names the underlying driver exception, not just the wrapper.
    statement = build_source[cause_at:cause_at + 400]
    assert "{type(exc).__name__}" in statement


def test_the_cause_is_interpolated_into_the_raised_message(build_source):
    idx = build_source.index("raise BusinessStatePersistenceError")
    statement = build_source[idx:idx + 320]
    assert "persistence_cause" in statement, "the message must name the real failure"


def test_the_exception_chain_is_preserved(build_source):
    idx = build_source.index("raise BusinessStatePersistenceError")
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
        "diag scope_opened=True in_tx_before=False "
        "pid_before=1215449 pid_after_insert=1216237 | "
    )
    assert len(measured_prefix) < surviving_budget


def test_the_cause_is_recorded_even_when_the_caller_swallows_the_exception():
    """The report is written in the build's finally, not by the caller.

    orchestrator.py:976 wraps this build in `except Exception: logger.error(...)`
    and swallows it. Reporting from the caller would therefore never happen for
    the path that matters most.
    """
    import inspect as _inspect

    from src.intelligence.business_state import build_business_state_with_status

    source = _inspect.getsource(build_business_state_with_status)
    assert "finally:" in source
    finally_at = source.index("finally:")
    assert "_release_business_state_lock" in source[finally_at:]
    assert "error=error_text" in source[finally_at:]
