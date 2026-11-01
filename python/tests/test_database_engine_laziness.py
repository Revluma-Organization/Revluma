"""The database engine must not be built at import time.

An empty ``DATABASE_URL`` previously crashed module import, which broke test
collection, CLI tooling and health endpoints. Construction is now lazy and
fails closed only when a connection is actually requested.
"""

import importlib

import pytest

from src.config import database


def test_module_import_does_not_build_an_engine(monkeypatch):
    monkeypatch.setattr(database.settings, "DATABASE_URL", "", raising=False)
    reloaded = importlib.reload(database)
    try:
        assert reloaded.engine.configured is False
        assert reloaded.engine._engine is None
    finally:
        importlib.reload(database)


def test_missing_url_fails_closed_on_first_use():
    lazy = database._LazyEngine(None)
    with pytest.raises(database.DatabaseNotConfigured):
        lazy._build()
    assert lazy.configured is False


def test_configure_replaces_a_disposed_engine():
    lazy = database._LazyEngine("")
    lazy.configure("")
    assert lazy._engine is None
    with pytest.raises(database.DatabaseNotConfigured):
        lazy.connect()
