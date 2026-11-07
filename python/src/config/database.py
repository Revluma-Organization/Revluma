"""Database engine construction.

The engine is built on first use, not at import time.  A missing or empty
``DATABASE_URL`` must not crash module import (which previously broke test
collection, CLI tooling and health endpoints); it must fail closed with an
explicit configuration error the first time a connection is actually needed.
"""

from __future__ import annotations

import logging
import os
import threading
import time
import traceback

from sqlalchemy import create_engine, event

from .settings import settings


class DatabaseNotConfigured(RuntimeError):
    """Raised when database access is attempted without a configured URL."""


def _int_env(name: str, default: int, *, minimum: int = 0) -> int:
    """Read a positive integer env var, falling back on garbage input.

    A malformed pool setting must never take the whole service down at import
    time; the documented default is safer than a crash or a zero-size pool.
    """
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return value if value >= minimum else default


def _pool_size() -> int:
    return _int_env("REV_DB_POOL_SIZE", 8, minimum=1)


def _max_overflow() -> int:
    return _int_env("REV_DB_MAX_OVERFLOW", 4, minimum=0)


def _pool_timeout() -> int:
    return _int_env("REV_DB_POOL_TIMEOUT_SECONDS", 30, minimum=1)


# Emitted at most once per band per window so a saturated pool cannot turn the
# log into a firehose while still recording the moment pressure began.
_PRESSURE_LOG_INTERVAL_SECONDS = 5.0


class _PoolPressure:
    """Rate-limited recorder of connection-pool checkout pressure.

    The pool ceiling (``pool_size + max_overflow``) is what turns a slow query
    into a 30-second ``QueuePool limit ... reached`` timeout. Counting how many
    connections are checked out, from which thread, at the moment the pool
    crosses into overflow is what distinguishes the two candidate causes of that
    saturation: many concurrent operations, or one operation holding more than
    one connection. Without it the only signal is the timeout itself, which
    arrives after the damage and names no caller.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._emitted: dict[str, float] = {}

    def _allow(self, band: str, now: float) -> bool:
        with self._lock:
            previous = self._emitted.get(band, 0.0)
            if now - previous < _PRESSURE_LOG_INTERVAL_SECONDS:
                return False
            self._emitted[band] = now
            return True


_pool_pressure = _PoolPressure()


def _caller_frames(limit: int = 5) -> str:
    """Summarise the application frames below the pool event handler.

    Frames outside this repository are dropped so the emitted value identifies
    the Revluma code path that requested the connection rather than SQLAlchemy
    internals. Never raises: this runs inside a pool event where an exception
    would surface as a connection failure.
    """
    try:
        if limit <= 0:
            return ""
        root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        frames = [
            frame
            for frame in traceback.extract_stack()[:-2]
            if frame.filename.startswith(root)
        ][-limit:]
        return " <- ".join(
            f"{os.path.basename(frame.filename)}:{frame.lineno} {frame.name}"
            for frame in frames
        )
    except Exception:  # pragma: no cover - instrumentation must never break a checkout
        return ""


def _report_pool_pressure(pool, phase: str) -> None:
    """Log checkout pressure, and always swallow its own failures."""
    try:
        checked_out = int(pool.checkedout())
        size = int(pool.size())
        overflow = int(pool.overflow())

        if checked_out <= size:
            return

        if checked_out >= size + _max_overflow():
            band = "exhausted"
            level = "error"
            event_name = "db_pool_exhaustion_imminent"
        else:
            band = "overflow"
            level = "warning"
            event_name = "db_pool_overflow_in_use"

        now = time.monotonic()
        if not _pool_pressure._allow(band, now):
            return

        payload = {
            "phase": phase,
            "pool_checked_out": checked_out,
            "pool_size": size,
            "pool_overflow": overflow,
            "pool_capacity": pool_capacity(),
            # `thread` is a reserved LogRecord attribute, so extra= would raise
            # KeyError; the name is carried under a non-reserved key.
            "thread_name": threading.current_thread().name,
            "caller": _caller_frames(),
        }

        logger = _get_logger()
        if logger is None:  # pragma: no cover - logging is optional at engine build
            return
        getattr(logger, level)(event_name, extra=payload)
    except Exception:  # pragma: no cover - instrumentation must never break a checkout
        return


def _get_logger():
    """Return the module logger.

    Uses the same ``logging.getLogger("rev.<area>")`` convention as the rest of
    the service, and never raises: this is called from inside a pool event where
    an exception would surface as a connection failure.
    """
    try:
        return logging.getLogger("rev.config.database")
    except Exception:  # pragma: no cover
        return None


def pool_capacity() -> int:
    """Maximum connections this service's pool can hand out.

    Published so the serving layer, tests and diagnostics all report the same
    number instead of each restating a literal that can drift.
    """
    return _pool_size() + _max_overflow()


class _LazyEngine:
    """Engine proxy that defers ``create_engine`` until first use."""

    def __init__(self, url: str | None):
        self._url = (url or "").strip()
        self._engine = None
        self._lock = threading.Lock()

    def configure(self, url: str | None) -> None:
        with self._lock:
            self._url = (url or "").strip()
            self._engine = None

    def _build(self):
        if self._engine is not None:
            return self._engine
        with self._lock:
            if self._engine is not None:
                return self._engine
            if not self._url:
                raise DatabaseNotConfigured(
                    "DATABASE_URL is not configured; database access is unavailable."
                )
            self._engine = create_engine(
                self._url,
                # Keep the Python service's connection footprint bounded. The
                # Node service and Supabase internal clients share the same
                # project connection budget. serving/api.py reads these same
                # variables so the capacity it advertises and logs is always
                # the capacity actually built here.
                pool_size=_pool_size(),
                max_overflow=_max_overflow(),
                pool_timeout=_pool_timeout(),
                pool_recycle=300,
                pool_pre_ping=True,
                pool_use_lifo=True,
                pool_reset_on_return="rollback",
                connect_args={
                    "connect_timeout": 10,
                    "keepalives": 1,
                    "keepalives_idle": 30,
                    "keepalives_interval": 10,
                    "keepalives_count": 3,
                },
                echo=settings.SQL_ECHO,
            )

            # Attach before the first checkout so the very first saturation is
            # recorded rather than discovered by a timeout.
            event.listen(
                self._engine,
                "checkout",
                lambda dbapi_conn, record, proxy: _report_pool_pressure(
                    self._engine.pool, "checkout"
                ),
            )
            event.listen(
                self._engine,
                "checkin",
                lambda dbapi_conn, record: _report_pool_pressure(
                    self._engine.pool, "checkin"
                ),
            )

            return self._engine

    @property
    def configured(self) -> bool:
        return bool(self._url)

    @property
    def url(self):
        return self._build().url

    @property
    def dialect(self):
        return self._build().dialect

    def connect(self, *args, **kwargs):
        return self._build().connect(*args, **kwargs)

    def begin(self, *args, **kwargs):
        return self._build().begin(*args, **kwargs)

    def dispose(self, *args, **kwargs):
        engine = self._engine
        if engine is not None:
            engine.dispose(*args, **kwargs)
        self._engine = None

    def __getattr__(self, name):
        return getattr(self._build(), name)


engine = _LazyEngine(getattr(settings, "DATABASE_URL", ""))


def get_engine():
    """Return the materialised SQLAlchemy engine."""
    return engine._build()
