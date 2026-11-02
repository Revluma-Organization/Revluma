"""Database/stream diagnostics endpoint regressions.

Pool exhaustion used to be diagnosable only from crash logs after the fact.
These tests pin the contract operators and the Node gateway rely on: the
endpoint is authenticated, reports real pool geometry, exposes live request-gate
counters, flags a saturated pool, and reports an unavailable database honestly
instead of implying everything is idle.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from src.serving import api as serving_api
from src.serving.api import app, verify_internal_caller

INTERNAL_KEY = "diagnostics-test-key"


@pytest.fixture()
def client(monkeypatch):
    """A client with real authentication, unlike tests/test_api.py's override."""
    monkeypatch.setattr(serving_api, "ML_INTERNAL_KEY", INTERNAL_KEY)
    previous = dict(app.dependency_overrides)
    app.dependency_overrides.pop(verify_internal_caller, None)
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous)


def _auth():
    return {"x-internal-key": INTERNAL_KEY}


def test_diagnostics_requires_the_internal_key(client):
    response = client.get("/internal/db/diagnostics")

    assert response.status_code == 401


def test_diagnostics_rejects_a_wrong_internal_key(client):
    response = client.get(
        "/internal/db/diagnostics", headers={"x-internal-key": "not-the-key"}
    )

    assert response.status_code == 401


def test_diagnostics_reports_pool_geometry_and_gate_counters(client):
    response = client.get("/internal/db/diagnostics", headers=_auth())

    assert response.status_code == 200
    body = response.json()

    pool = body["pool"]
    assert pool["capacity"] == serving_api._db_pool_capacity()
    assert pool["pool_size"] + pool["overflow"] + pool["checked_out"] >= 0
    assert isinstance(pool["checked_out"], int)

    gate = body["request_gate"]
    assert gate["limit"] == serving_api._REQUEST_CONCURRENCY_LIMIT
    assert gate["total_requests"] >= 1
    # This request is in flight while the snapshot is taken.
    assert gate["active_requests"] >= 1


def test_diagnostics_reports_an_unreachable_database_honestly(client):
    """A failed pg_stat_activity read must not masquerade as an idle database."""
    response = client.get("/internal/db/diagnostics", headers=_auth())

    assert response.status_code == 200
    activity = response.json()["database_activity"]

    # No reachable PostgreSQL in this test run, so the reason is surfaced
    # rather than zero-filled counters.
    assert activity == {"unavailable": True, "reason": "query_failed"}


def test_diagnostics_flags_a_saturated_pool(client, monkeypatch):
    monkeypatch.setattr(
        serving_api, "_pool_telemetry",
        lambda: {"pool_size": 8, "checked_out": 12, "checked_in": 0,
                 "overflow": 4, "capacity": 12},
    )

    body = client.get("/internal/db/diagnostics", headers=_auth()).json()

    assert body["saturated"] is True


def test_diagnostics_reports_a_capacity_budget_violation(client, monkeypatch):
    """Misconfiguration must be visible at runtime, not only at boot."""
    monkeypatch.setattr(serving_api, "_REQUEST_CONCURRENCY_LIMIT", 20)
    monkeypatch.setattr(serving_api, "_RESERVED_BACKGROUND_DB_CONNECTIONS", 2)

    body = client.get("/internal/db/diagnostics", headers=_auth()).json()

    assert body["capacity_budget_violation"] is not None
    assert "exceeds db_pool_capacity" in body["capacity_budget_violation"]


def test_capacity_budget_is_satisfied_by_the_shipped_defaults():
    assert serving_api._capacity_budget_violation() is None


def test_diagnostics_never_leaks_the_connection_string(client):
    body = client.get("/internal/db/diagnostics", headers=_auth()).text

    assert "postgresql" not in body.lower()
    assert "password" not in body.lower()
