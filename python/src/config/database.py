"""Database engine construction.

The engine is built on first use, not at import time.  A missing or empty
``DATABASE_URL`` must not crash module import (which previously broke test
collection, CLI tooling and health endpoints); it must fail closed with an
explicit configuration error the first time a connection is actually needed.
"""

from __future__ import annotations

import threading

from sqlalchemy import create_engine

from .settings import settings


class DatabaseNotConfigured(RuntimeError):
    """Raised when database access is attempted without a configured URL."""


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
                pool_size=10,
                max_overflow=20,
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
