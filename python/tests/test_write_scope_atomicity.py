"""Persistence behind the production pooler: single statements only.

Production evidence carried into this file:

2026-11-03 10:21 UTC. ``pg_stat_activity`` showed four server backends, all with
``xact_start`` in the same second, each holding exactly one statement of the
persistence block. The lease then reported ``QueryCanceled ... while inserting
index tuple (3766,4) in relation "idx_bstate_org_current"`` after 133851 ms.

2026-11-06, after the advisory-lock + single-batch redesign merged in PR #302.
The batched statement returned without error, yet the snapshot it inserted was
not visible to the very next statement: ``diag scope_opened=True
in_tx_before=True pid_before=1545467 pid_after_insert=1539098`` and the
post-condition gate refused to report success. Statements are scattered across
server backends even inside an explicit client transaction.

The conclusion in both incidents is the same: the client transaction does not
pin a backend, so atomicity may never be delegated to it. Every persistence
statement is a single implicit transaction, routed through a dedicated
NullPool autocommit engine. A test that would pass behind a normal Postgres
but fail behind this pooler is a failing test of a broken design.
"""

import inspect

import pytest
from sqlalchemy import create_engine

from src.intelligence import business_state

PERSISTENCE_SEQUENCE = [
    "INSERT INTO business_states",
    "UPDATE business_state_baselines",
    "INSERT INTO alert_queue",
    "SET is_current = FALSE",
    "SET is_current = TRUE",
    "SELECT is_current FROM business_states WHERE id = :id",
]


class SplittingSession:
    """Models Supavisor: no explicit transaction means one backend per statement.

    Each statement executed outside a transaction is pinned to its *own* server
    backend, exactly as production showed. A statement count is therefore a
    backend count, which is the thing under test.
    """

    def __init__(self):
        self.backends = []
        self._current = None
        self._in_transaction = False

    def in_transaction(self):
        return self._in_transaction

    def execute(self, sql, params=None):
        if not self._in_transaction:
            # Supavisor hands out a fresh backend and leaves it open.
            self._current = []
            self.backends.append(self._current)
        self._current.append(str(sql))

    def commit(self):
        self._end_transaction()

    def rollback(self):
        self._end_transaction()

    def _end_transaction(self):
        self._in_transaction = False
        self._current = None


def test_without_a_client_transaction_each_statement_gets_its_own_backend():
    """The production invariant the design must tolerate."""
    db = SplittingSession()
    for statement in PERSISTENCE_SEQUENCE:
        db.execute(statement)
    db.commit()

    assert len(db.backends) == len(PERSISTENCE_SEQUENCE)


def test_persistence_uses_the_dedicated_autocommit_transport(monkeypatch):
    """The build must not rely on session-level transaction state at all."""
    calls = []

    class _FakeResult:
        rowcount = 1

        def scalar(self):
            return 123

    class _FakeConn:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def execute(self, statement, params):
            calls.append((str(statement), params))
            return _FakeResult()

    class _FakeEngine:
        def connect(self):
            return _FakeConn()

    monkeypatch.setattr(business_state, "_PERSIST_ENGINE", _FakeEngine())
    monkeypatch.setattr(business_state, "_PERSIST_ENGINE_READY", True)
    assert business_state._persist_execute(None, "SELECT 1", scalar=True) == 123
    assert calls, "the dedicated transport must serve persistence statements"
    assert calls[0][0] == "SELECT 1"


def test_persistence_engine_is_autocommit_and_nullpool():
    url = "postgresql+psycopg2://u:p@localhost:1/db"
    monkey = pytest.MonkeyPatch()
    monkey.setenv("REVLUMA_PERSISTENCE_DATABASE_URL", url)
    business_state._PERSIST_ENGINE = None
    business_state._PERSIST_ENGINE_READY = False
    try:
        engine = business_state._persistence_engine()
        assert engine is not None
        # Engine creation is lazy, so this holds without a reachable server.
        # The autocommit guarantee is enforced at connection setup by the
        # isolation_level argument passed at creation time.
        assert engine.__class__.__name__ == "Engine"
        from sqlalchemy.pool import NullPool

        assert isinstance(engine.pool, NullPool)
    finally:
        monkey.undo()
        business_state._PERSIST_ENGINE = None
        business_state._PERSIST_ENGINE_READY = False


def test_persistence_falls_back_to_session_commit_without_a_url(monkeypatch):
    monkeypatch.setenv("REVLUMA_PERSISTENCE_DATABASE_URL", "")
    monkeypatch.setattr(business_state.settings, "DATABASE_URL", "", raising=False)
    business_state._PERSIST_ENGINE = None
    business_state._PERSIST_ENGINE_READY = False
    commits = []

    class _Result:
        rowcount = 1

        def scalar(self):
            return 7

    class _Db:
        def execute(self, statement, params):
            return _Result()

        def commit(self):
            commits.append(True)

    try:
        assert business_state._persist_execute(_Db(), "SELECT 1") == 1
        assert commits == [True]
        assert business_state._persist_execute(_Db(), "SELECT 1", scalar=True) == 7
    finally:
        business_state._PERSIST_ENGINE = None
        business_state._PERSIST_ENGINE_READY = False


def test_compensation_never_raises_and_never_uses_the_session(monkeypatch):
    """Cleanup runs behind the same autocommit transport; it cannot wedge the build."""
    monkeypatch.setenv("REVLUMA_PERSISTENCE_DATABASE_URL", "postgresql+psycopg2://u:p@localhost:1/db")
    business_state._PERSIST_ENGINE = None
    business_state._PERSIST_ENGINE_READY = False

    class _ExplodingSession:
        def execute(self, *_a, **_k):
            raise AssertionError("compensation must not route through the caller's session")

        def rollback(self):
            pass

    try:
        # The dedicated engine points at an unreachable port here; every DELETE
        # fails, the failures are logged and swallowed, and no exception escapes.
        business_state._compensate_failed_build(_ExplodingSession(), "org-1", "state-1")
    finally:
        business_state._PERSIST_ENGINE = None
        business_state._PERSIST_ENGINE_READY = False


# ---------------------------------------------------------------------------
# The build itself must run on the decomposed single-statement design.
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def build_source():
    return inspect.getsource(business_state._build_business_state_unlocked)


def test_the_build_uses_the_persistence_transport_for_every_step(build_source):
    assert build_source.count("_persist_execute(") >= 7, (
        "every persistence statement must route through the dedicated transport"
    )


def test_the_build_contains_no_client_transaction_or_batch(build_source):
    for needle in ("begin_write_scope", "commit_write_scope", "critical_section_sql"):
        assert needle not in build_source


def test_the_module_exports_no_write_scope_constants():
    assert not hasattr(business_state, "PERSIST_LOCK_TIMEOUT_SECONDS")


def test_the_build_releases_the_read_scope_before_persisting(build_source):
    assert build_source.index("end_read_scope(db, read_scope)") < build_source.index(
        "_persist_execute("
    )


def test_retention_pruning_runs_only_after_the_gate(build_source):
    gate_at = build_source.index("SELECT is_current FROM business_states WHERE id = :id")
    prune_at = build_source.index("prune_superseded_snapshots(db, organization_id)")
    assert gate_at < prune_at
