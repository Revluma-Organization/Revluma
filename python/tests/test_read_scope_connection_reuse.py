"""A multi-stage read must not consume one pooled connection per statement.

Production evidence (2026-11-03): a single Business State build occupied twelve
server backends simultaneously - one per read stage, transactions opened about a
second apart, each holding exactly one statement and waiting on ``ClientRead``.
Twelve is the Python pool ceiling (pool_size 8 + max_overflow 4), so the build
exhausted its own pool before reaching persistence and surfaced as
``QueuePool limit of size 8 overflow 4 reached, timeout 30.00``.

The cause: ``safe_query`` and ``read_row`` end their own transaction when no
outer transaction exists, which is right for a lone read and wrong for a
multi-stage job. These tests count connection acquisitions directly.
"""

from __future__ import annotations

import pytest

from src.intelligence.query import (
    begin_read_scope,
    end_read_scope,
    read_row,
    safe_query,
)


class FakeTransaction:
    def __init__(self, session):
        self._session = session

    def rollback(self):
        self._session.rollback()

    def commit(self):
        self._session.commit()


class FakeSavepoint:
    def __init__(self, session):
        self._session = session
        session.savepoints += 1

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


class FakeResult:
    def mappings(self):
        return self

    def all(self):
        return []

    def fetchone(self):
        return None

    def scalar(self):
        return True


class FakeSession:
    """Models the connection-acquisition behaviour that matters here.

    ``acquisitions`` counts how many times a statement had to obtain a
    connection because none was held in an open transaction. That is the number
    a transaction-pooling proxy turns into distinct pinned server backends.
    """

    def __init__(self, fail_on: str | None = None):
        self.in_tx = False
        self.acquisitions = 0
        self.executes = 0
        self.begins = 0
        self.rollbacks = 0
        self.commits = 0
        self.savepoints = 0
        self.fail_on = fail_on

    def in_transaction(self):
        return self.in_tx

    def begin(self):
        # Session.begin() checks a connection out of the pool, so it is exactly
        # one acquisition - the one the whole scope is meant to share.
        self.begins += 1
        self.in_tx = True
        self.acquisitions += 1
        return FakeTransaction(self)

    def begin_nested(self):
        return FakeSavepoint(self)

    def execute(self, statement, params=None):
        self.executes += 1
        sql = str(statement)
        if not self.in_tx:
            # SQLAlchemy implicitly BEGINs, which means checking a connection
            # out of the pool - and behind Supavisor, pinning a server backend.
            self.in_tx = True
            self.acquisitions += 1
        if self.fail_on and self.fail_on in sql:
            raise RuntimeError("stage failed")
        return FakeResult()

    def rollback(self):
        self.rollbacks += 1
        self.in_tx = False

    def commit(self):
        self.commits += 1
        self.in_tx = False


STAGES = 12  # the number of source reads in a real Business State build


def test_without_a_scope_every_read_acquires_its_own_connection():
    db = FakeSession()

    for i in range(STAGES):
        safe_query(db, f"SELECT {i}")

    # This is the production behaviour: one acquisition per stage.
    assert db.acquisitions == STAGES


def test_a_read_scope_collapses_every_stage_onto_one_connection():
    db = FakeSession()

    scope = begin_read_scope(db)
    try:
        for i in range(STAGES):
            safe_query(db, f"SELECT {i}")
    finally:
        end_read_scope(db, scope)

    assert db.acquisitions == 1, "all stages must share one connection"
    assert db.executes == STAGES, "no stage may be skipped"
    assert db.begins == 1


def test_read_row_also_shares_the_scoped_connection():
    db = FakeSession()

    scope = begin_read_scope(db)
    try:
        for i in range(STAGES):
            read_row(db, f"SELECT {i}")
    finally:
        end_read_scope(db, scope)

    assert db.acquisitions == 1


def test_a_mixed_build_shares_one_connection():
    db = FakeSession()

    scope = begin_read_scope(db)
    try:
        for i in range(6):
            safe_query(db, f"SELECT {i}")
        for i in range(6):
            read_row(db, f"SELECT row {i}")
    finally:
        end_read_scope(db, scope)

    assert db.acquisitions == 1
    assert db.executes == 12


def test_the_scope_is_released_so_the_connection_returns_to_the_pool():
    db = FakeSession()

    scope = begin_read_scope(db)
    safe_query(db, "SELECT 1")
    assert db.in_tx is True

    assert end_read_scope(db, scope) is True
    assert db.in_tx is False, "the connection must be handed back"


def test_a_failing_stage_is_isolated_by_a_savepoint_not_the_whole_scope():
    db = FakeSession(fail_on="boom")

    scope = begin_read_scope(db)
    try:
        rows, error = safe_query(db, "SELECT boom")
        assert error == "query_failed"
        assert rows == []

        # The scope must survive the failure so later stages still share it.
        assert db.in_tx is True
        assert db.savepoints >= 1
        safe_query(db, "SELECT after_failure")
    finally:
        end_read_scope(db, scope)

    # One acquisition: the scope's own begin(). Every stage after the failure
    # reused it instead of checking out another connection.
    assert db.acquisitions == 1
    assert db.begins == 1


def test_an_existing_caller_transaction_is_left_alone():
    db = FakeSession()
    db.in_tx = True  # caller already owns a transaction

    scope = begin_read_scope(db)
    assert scope is None, "must not nest a second transaction on the caller's"

    safe_query(db, "SELECT 1")
    assert end_read_scope(db, scope) is False
    assert db.begins == 0
    assert db.in_tx is True, "the caller's transaction must still be open"


def test_end_read_scope_tolerates_none():
    db = FakeSession()
    assert end_read_scope(db, None) is False


def test_a_session_that_cannot_begin_falls_back_rather_than_failing():
    class NoBegin:
        def in_transaction(self):
            return False

        def execute(self, *a, **k):
            return FakeResult()

        def rollback(self):
            pass

    db = NoBegin()
    # Falling back to per-read behaviour is safe; failing the job is not.
    assert begin_read_scope(db) is None
    assert end_read_scope(db, None) is False


def test_begin_failure_is_swallowed():
    class ExplodingBegin:
        def in_transaction(self):
            return False

        def begin(self):
            raise RuntimeError("cannot begin")

        def execute(self, *a, **k):
            return FakeResult()

        def rollback(self):
            pass

    assert begin_read_scope(ExplodingBegin()) is None


def test_release_failure_still_rolls_back_the_session():
    class ExplodingTx(FakeTransaction):
        def rollback(self):
            raise RuntimeError("rollback failed")

    db = FakeSession()
    scope = ExplodingTx(db)
    db.in_tx = True

    # A failed scope release must not leave the connection pinned.
    assert end_read_scope(db, scope) is False
    assert db.in_tx is False
