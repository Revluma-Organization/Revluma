"""Connection-pool checkout pressure instrumentation.

The pool ceiling turns a slow query into a 30-second
``QueuePool limit ... reached`` timeout. These tests pin the warning that makes
saturation visible *before* the timeout, and guarantee the instrumentation can
never itself break a connection checkout.
"""

from __future__ import annotations

import logging

import pytest

from src.config import database


class FakePool:
    def __init__(self, checked_out: int, size: int = 8, max_overflow: int = 4):
        self._checked_out = checked_out
        self._size = size
        self._max_overflow = max_overflow

    def checkedout(self) -> int:
        return self._checked_out

    def size(self) -> int:
        return self._size

    def overflow(self) -> int:
        return max(0, self._checked_out - self._size)


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    database._pool_pressure._emitted.clear()
    yield
    database._pool_pressure._emitted.clear()


def test_silent_while_within_pool_size(caplog):
    with caplog.at_level(logging.DEBUG, logger="rev.config.database"):
        database._report_pool_pressure(FakePool(1), "checkout")
        database._report_pool_pressure(FakePool(8), "checkout")

    assert caplog.records == []


def test_warns_when_overflow_connections_are_in_use(caplog):
    with caplog.at_level(logging.DEBUG, logger="rev.config.database"):
        database._report_pool_pressure(FakePool(9), "checkout")

    assert len(caplog.records) == 1
    record = caplog.records[0]
    assert record.levelno == logging.WARNING
    assert record.getMessage() == "db_pool_overflow_in_use"
    assert record.pool_checked_out == 9
    assert record.pool_size == 8
    assert record.pool_capacity == database.pool_capacity()
    # Identifies whether one thread or many are consuming the pool.
    assert record.thread_name


def test_errors_at_the_exhaustion_ceiling(caplog):
    with caplog.at_level(logging.DEBUG, logger="rev.config.database"):
        database._report_pool_pressure(FakePool(12), "checkout")

    assert len(caplog.records) == 1
    record = caplog.records[0]
    assert record.levelno == logging.ERROR
    assert record.getMessage() == "db_pool_exhaustion_imminent"
    assert record.pool_checked_out == 12


def test_above_the_ceiling_still_reports_exhaustion(caplog):
    with caplog.at_level(logging.DEBUG, logger="rev.config.database"):
        database._report_pool_pressure(FakePool(30), "checkout")

    assert caplog.records[0].getMessage() == "db_pool_exhaustion_imminent"


def test_repeated_pressure_is_rate_limited(caplog):
    with caplog.at_level(logging.DEBUG, logger="rev.config.database"):
        for _ in range(25):
            database._report_pool_pressure(FakePool(10), "checkout")

    # A saturated pool must not become a log firehose.
    assert len(caplog.records) == 1


def test_distinct_bands_are_recorded_separately(caplog):
    with caplog.at_level(logging.DEBUG, logger="rev.config.database"):
        database._report_pool_pressure(FakePool(10), "checkout")
        database._report_pool_pressure(FakePool(12), "checkout")

    names = [record.getMessage() for record in caplog.records]
    assert names == ["db_pool_overflow_in_use", "db_pool_exhaustion_imminent"]


def test_checkin_phase_is_labelled(caplog):
    with caplog.at_level(logging.DEBUG, logger="rev.config.database"):
        database._report_pool_pressure(FakePool(10), "checkin")

    assert caplog.records[0].phase == "checkin"


def test_never_raises_when_the_pool_is_broken(caplog):
    class BrokenPool:
        def checkedout(self):
            raise RuntimeError("pool introspection failed")

    with caplog.at_level(logging.DEBUG, logger="rev.config.database"):
        # An exception escaping a checkout event would fail the connection
        # itself, turning instrumentation into an outage.
        database._report_pool_pressure(BrokenPool(), "checkout")
        database._report_pool_pressure(None, "checkout")

    assert caplog.records == []


def test_caller_frames_is_always_a_string():
    value = database._caller_frames()
    assert isinstance(value, str)
    assert database._caller_frames(limit=0) == ""


def test_caller_frames_never_raises():
    original = database.traceback.extract_stack

    def explode():
        raise RuntimeError("stack unavailable")

    database.traceback.extract_stack = explode
    try:
        assert database._caller_frames() == ""
    finally:
        database.traceback.extract_stack = original


def test_pool_capacity_matches_the_documented_ceiling():
    assert database.pool_capacity() == database._pool_size() + database._max_overflow()


def test_pressure_state_is_thread_safe():
    import threading

    pool = FakePool(10)
    errors: list[BaseException] = []

    def hammer():
        try:
            for _ in range(200):
                database._report_pool_pressure(pool, "checkout")
        except BaseException as exc:  # pragma: no cover
            errors.append(exc)

    threads = [threading.Thread(target=hammer) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert errors == []
