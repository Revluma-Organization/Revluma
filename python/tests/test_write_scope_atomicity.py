"""The Business State persistence block must be one transaction.

Production evidence, 2026-11-03 10:21 UTC. ``pg_stat_activity`` showed four
server backends, all with ``xact_start`` in the same second, each holding exactly
one statement of the persistence block::

    1213110  idle in transaction  SELECT set_config('lock_timeout', '10s', true)
    1211439  idle in transaction  SELECT pg_advisory_xact_lock(hashtext(...)::bigint)
    1211443  idle in transaction  UPDATE business_states SET is_current = FALSE ...
    1183936  active Lock/txid     INSERT INTO business_states (...)

Four statements, four transactions. The lease row then reported::

    BusinessStatePersistenceError: ... (OperationalError:
    (psycopg2.errors.QueryCanceled) canceling statement due to statement timeout
    CONTEXT: while inserting index tuple (3766,4) in relation
    "idx_bstate_org_current")
    duration_ms: 133851

``idx_bstate_org_current`` is ``CREATE UNIQUE INDEX ... ON business_states
(organization_id) WHERE (is_current = true)`` and the database sets
``statement_timeout = 2min``. 133851 ms is that timeout plus the read phase.
"""

import inspect

import pytest

from src.intelligence import business_state
from src.intelligence.query import (
    begin_write_scope,
    commit_write_scope,
    end_read_scope,
)

PERSISTENCE_STATEMENTS = [
    "SELECT set_config('lock_timeout', :lock_timeout, true)",
    "SELECT pg_advisory_xact_lock(hashtext(:lock_key)::bigint)",
    "UPDATE business_states SET is_current = FALSE",
    "INSERT INTO business_states",
]


class _Scope:
    def __init__(self, session):
        self._session = session
        self.committed = False
        self.rolled_back = False

    def commit(self):
        self.committed = True
        self._session._end_transaction(commit=True)

    def rollback(self):
        self.rolled_back = True
        self._session._end_transaction(commit=False)


class SplittingSession:
    """Models Supavisor: no explicit transaction means one backend per statement.

    Each statement executed outside a transaction is pinned to its *own* server
    backend and left ``idle in transaction``, exactly as production showed. A
    statement count is therefore a backend count, which is the thing under test.
    """

    def __init__(self):
        self.backends = []
        self._current = None
        self._in_transaction = False

    def in_transaction(self):
        return self._in_transaction

    def begin(self):
        assert not self._in_transaction, "nested begin"
        self._in_transaction = True
        self._current = []
        self.backends.append(self._current)
        return _Scope(self)

    def _end_transaction(self, commit):
        self._in_transaction = False
        self._current = None

    def execute(self, sql, params=None):
        if not self._in_transaction:
            # Supavisor hands out a fresh backend and leaves it open.
            self._current = []
            self.backends.append(self._current)
        self._current.append(str(sql))

    def commit(self):
        self._end_transaction(commit=True)

    def rollback(self):
        self._end_transaction(commit=False)


def _run_persistence(db):
    """Execute the persistence statements the way the build does."""
    scope = begin_write_scope(db)
    for statement in PERSISTENCE_STATEMENTS:
        db.execute(statement)
    commit_write_scope(db, scope)
    return scope


def test_the_four_persistence_statements_share_one_backend():
    db = SplittingSession()
    _run_persistence(db)

    assert len(db.backends) == 1, (
        "each statement got its own server backend, so the advisory lock and the "
        "transaction-local lock_timeout were both inert"
    )
    assert db.backends[0] == PERSISTENCE_STATEMENTS


def test_without_the_scope_each_statement_gets_its_own_backend():
    """The counterfactual: this is precisely what production was doing."""
    db = SplittingSession()
    for statement in PERSISTENCE_STATEMENTS:
        db.execute(statement)
    db.commit()

    assert len(db.backends) == len(PERSISTENCE_STATEMENTS)


def test_the_update_and_insert_are_atomic():
    """The self-deadlock: a non-atomic UPDATE then INSERT on the unique index."""
    db = SplittingSession()
    _run_persistence(db)

    update_at = db.backends[0].index("UPDATE business_states SET is_current = FALSE")
    insert_at = db.backends[0].index("INSERT INTO business_states")
    # Same backend, same transaction: the INSERT sees the UPDATE's own change
    # instead of waiting on it as a competing uncommitted row.
    assert insert_at == update_at + 1


def test_the_advisory_lock_is_taken_after_lock_timeout_and_before_the_update():
    db = SplittingSession()
    _run_persistence(db)
    statements = db.backends[0]

    assert statements.index("SELECT set_config('lock_timeout', :lock_timeout, true)") < (
        statements.index("SELECT pg_advisory_xact_lock(hashtext(:lock_key)::bigint)")
    )
    assert statements.index(
        "SELECT pg_advisory_xact_lock(hashtext(:lock_key)::bigint)"
    ) < statements.index("UPDATE business_states SET is_current = FALSE")


def test_the_scope_is_committed_not_rolled_back():
    db = SplittingSession()
    scope = _run_persistence(db)
    assert scope.committed is True
    assert scope.rolled_back is False


def test_begin_returns_none_when_the_caller_owns_the_transaction():
    db = SplittingSession()
    db.begin()  # caller already inside a transaction
    outer = db.backends[0]

    scope = begin_write_scope(db)
    assert scope is None

    for statement in PERSISTENCE_STATEMENTS:
        db.execute(statement)
    # Statements join the caller's transaction rather than starting their own.
    assert db.backends == [outer]
    assert outer == PERSISTENCE_STATEMENTS


def test_commit_with_no_scope_falls_back_to_the_session():
    class Bare:
        def __init__(self):
            self.commits = 0

        def in_transaction(self):
            return True

        def execute(self, *_a, **_k):
            pass

        def commit(self):
            self.commits += 1

    db = Bare()
    assert begin_write_scope(db) is None
    assert commit_write_scope(db, None) is True
    assert db.commits == 1


def test_commit_failures_propagate_so_the_build_reports_failure():
    class FailingScope:
        def commit(self):
            raise RuntimeError("could not serialize access")

    class Db:
        def in_transaction(self):
            return False

        def begin(self):
            return FailingScope()

    db = Db()
    scope = begin_write_scope(db)
    with pytest.raises(RuntimeError):
        commit_write_scope(db, scope)


def test_a_session_without_begin_degrades_instead_of_failing():
    class NoBegin:
        def __init__(self):
            self.commits = 0

        def in_transaction(self):
            return False

        def execute(self, *_a, **_k):
            pass

        def commit(self):
            self.commits += 1

    db = NoBegin()
    assert begin_write_scope(db) is None
    commit_write_scope(db, None)
    assert db.commits == 1


# ---------------------------------------------------------------------------
# The build itself must actually use the scope.
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def build_source():
    return inspect.getsource(business_state._build_business_state_unlocked)


def test_the_build_opens_the_write_scope_before_any_persistence_statement(build_source):
    scope_at = build_source.index("write_scope = begin_write_scope(db)")
    # Needles are the executable SQL, not prose: the comments explaining this fix
    # quote the same statement names, and a needle matching a comment would make
    # this test pass no matter where the code actually sits.
    statements = (
        "SELECT set_config('lock_timeout'",
        "SELECT pg_advisory_xact_lock(",
        "SET is_current = FALSE",
        "INSERT INTO business_states (",
    )
    for statement in statements:
        assert statement in build_source, f"missing from the build: {statement}"
        assert scope_at < build_source.index(statement), statement


def test_the_build_opens_the_write_scope_after_releasing_the_read_scope(build_source):
    """The read scope is rolled back; persistence must start its own transaction."""
    assert build_source.index("end_read_scope(db, read_scope)") < build_source.index(
        "write_scope = begin_write_scope(db)"
    )


def test_the_build_commits_the_scope_and_not_the_session_directly(build_source):
    assert "commit_write_scope(db, write_scope)" in build_source
    # A bare db.commit() inside the block would end the transaction early and
    # re-split the remaining statements across backends.
    tail = build_source[build_source.index("write_scope = begin_write_scope(db)"):]
    assert "db.commit()" not in tail.split("prune_superseded_snapshots")[0]


def test_retention_pruning_still_runs_after_the_commit(build_source):
    assert build_source.index("commit_write_scope(db, write_scope)") < build_source.index(
        "prune_superseded_snapshots(db, organization_id)"
    )
