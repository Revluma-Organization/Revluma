"""Database engine construction.

The engine is built on first use, not at import time.  A missing or empty
``DATABASE_URL`` must not crash module import (which previously broke test
collection, CLI tooling and health endpoints); it must fail closed with an
explicit configuration error the first time a connection is actually needed.
"""

from __future__ import annotations

import os
import threading

from sqlalchemy import create_engine

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
