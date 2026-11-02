"""Read-query isolation and connection-lifecycle regressions.

The first two tests come from PR #244 (savepoint cleanup on success and on
failure). The rest cover the defect that actually exhausted the production
pool: a standalone read used to leave the session ``in_transaction`` with a
pooled connection checked out, and Rev then carried that connection across an
up-to-25s model call. These tests assert against a real SQLAlchemy engine so
the pool accounting is genuine rather than modelled by a double.
"""

from __future__ import annotations

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import QueuePool

from src.intelligence.query import release_read_transaction, safe_query


class FakeSavepoint:
    def __init__(self):
        self.exit_args = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        self.exit_args = (exc_type, exc, traceback)
        return False


class FakeDB:
    def __init__(self, result=None, error=None, in_transaction=True):
        self.savepoint = FakeSavepoint()
        self.result = result if result is not None else [{"id": 1}]
        self.error = error
        self.rollback_calls = 0
        self._in_transaction = in_transaction

    def in_transaction(self):
        return self._in_transaction

    def begin_nested(self):
        return self.savepoint

    def execute(self, statement, params):
        if self.error:
            raise self.error
        return self.result

    def rollback(self):
        self.rollback_calls += 1


def test_safe_query_releases_successful_savepoint():
    db = FakeDB(result=[{"id": 1}])

    rows, error = safe_query(db, "SELECT 1")

    assert rows == [{"id": 1}]
    assert error is None
    assert db.savepoint.exit_args == (None, None, None)


def test_safe_query_rolls_back_failed_savepoint():
    failure = RuntimeError("query failed")
    db = FakeDB(error=failure)

    rows, error = safe_query(db, "SELECT broken")

    assert rows == []
    assert error == "query_failed"
    assert db.savepoint.exit_args[0] is RuntimeError
    assert db.savepoint.exit_args[1] is failure


# ---------------------------------------------------------------------------
# Real-engine connection lifecycle
# ---------------------------------------------------------------------------

@pytest.fixture()
def session_factory():
    # QueuePool because SQLite's default singleton pool cannot report
    # checked-out connections, and checked-out count is the whole point.
    engine = create_engine("sqlite://", poolclass=QueuePool)
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE orders (id INTEGER, total REAL)"))
        connection.execute(text("INSERT INTO orders VALUES (1, 10.0), (2, 20.0)"))
    yield sessionmaker(bind=engine)
    engine.dispose()


def test_successful_read_returns_connection_to_pool(session_factory):
    """A read must not leave a connection checked out or idle-in-transaction."""
    db = session_factory()
    try:
        rows, error = safe_query(db, "SELECT count(*) AS n FROM orders")

        assert error is None
        assert rows[0]["n"] == 2
        assert db.in_transaction() is False
        assert db.get_bind().pool.checkedout() == 0
    finally:
        db.close()


def test_failed_read_returns_connection_to_pool(session_factory):
    """A failing statement must roll back and hand the connection back."""
    db = session_factory()
    try:
        rows, error = safe_query(db, "SELECT * FROM table_that_does_not_exist")

        assert rows == []
        assert error == "query_failed"
        assert db.in_transaction() is False
        assert db.get_bind().pool.checkedout() == 0
    finally:
        db.close()


def test_many_reads_never_accumulate_checked_out_connections(session_factory):
    """One investigation issues many reads; they must share a single slot."""
    db = session_factory()
    try:
        for _ in range(25):
            _, error = safe_query(db, "SELECT count(*) AS n FROM orders")
            assert error is None

        assert db.get_bind().pool.checkedout() == 0
    finally:
        db.close()


def test_read_inside_caller_transaction_keeps_connection_and_uses_savepoint(
    session_factory,
):
    """A caller-owned transaction must survive a failed nested read."""
    db = session_factory()
    try:
        with db.begin():
            good_rows, good_error = safe_query(db, "SELECT count(*) AS n FROM orders")
            assert good_error is None
            assert good_rows[0]["n"] == 2

            # Fails inside the caller transaction: only the savepoint rolls
            # back, so the outer transaction stays usable.
            bad_rows, bad_error = safe_query(db, "SELECT * FROM nope")
            assert bad_rows == []
            assert bad_error == "query_failed"

            after_rows, after_error = safe_query(db, "SELECT count(*) AS n FROM orders")
            assert after_error is None
            assert after_rows[0]["n"] == 2
            assert db.in_transaction() is True

        # Exiting the caller transaction releases the connection.
        assert db.get_bind().pool.checkedout() == 0
    finally:
        db.close()


def test_release_read_transaction_reports_no_leak_when_clean(session_factory):
    db = session_factory()
    try:
        _, error = safe_query(db, "SELECT count(*) AS n FROM orders")
        assert error is None

        assert release_read_transaction(db) is False
    finally:
        db.close()


def test_release_read_transaction_releases_a_leaked_transaction(session_factory):
    """Guards the invariant enforced before any model provider call."""
    db = session_factory()
    try:
        db.execute(text("SELECT count(*) FROM orders"))
        assert db.in_transaction() is True
        assert db.get_bind().pool.checkedout() == 1

        assert release_read_transaction(db) is True
        assert db.in_transaction() is False
        assert db.get_bind().pool.checkedout() == 0
    finally:
        db.close()
