"""Business State snapshot retention regressions.

Production accumulated 33,717 snapshots in five days while only 5 were current,
so every read of the observed-change history had to work through 33 MB of
superseded rows. These tests pin the guarantees that make retention safe:
the current snapshot is never eligible, the retained window is respected, the
delete is batched, and a retention failure can never fail a successful build.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from src.intelligence.business_state import prune_superseded_snapshots

ORG = "11111111-1111-1111-1111-111111111111"
OTHER_ORG = "22222222-2222-2222-2222-222222222222"
BASE = datetime(2026, 11, 1, 0, tzinfo=timezone.utc)


@pytest.fixture()
def db():
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(text("""
            CREATE TABLE business_states (
                id TEXT PRIMARY KEY,
                organization_id TEXT NOT NULL,
                is_current INTEGER NOT NULL DEFAULT 0,
                generated_at TIMESTAMP NOT NULL,
                computation_status TEXT NOT NULL DEFAULT 'complete'
            )
        """))
    session = sessionmaker(bind=engine)()
    yield session
    session.close()
    engine.dispose()


def _insert(db, organization_id, *, index, is_current=False):
    db.execute(
        text("""
            INSERT INTO business_states
                (id, organization_id, is_current, generated_at, computation_status)
            VALUES (:id, :org, :current, :generated, 'complete')
        """),
        {
            "id": str(uuid.uuid4()),
            "org": organization_id,
            "current": 1 if is_current else 0,
            "generated": BASE + timedelta(minutes=index),
        },
    )
    db.commit()


def _counts(db, organization_id=ORG):
    rows = db.execute(
        text("""
            SELECT is_current, count(*) AS n FROM business_states
            WHERE organization_id = :org GROUP BY is_current
        """),
        {"org": organization_id},
    ).mappings().all()
    current = sum(r["n"] for r in rows if r["is_current"])
    superseded = sum(r["n"] for r in rows if not r["is_current"])
    return current, superseded


def test_prune_is_a_no_op_below_the_retention_window(db):
    for index in range(10):
        _insert(db, ORG, index=index)
    _insert(db, ORG, index=99, is_current=True)

    deleted = prune_superseded_snapshots(db, ORG, keep=200, batch=500)

    assert deleted == 0
    assert _counts(db) == (1, 10)


def test_prune_keeps_the_newest_superseded_snapshots(db):
    for index in range(60):
        _insert(db, ORG, index=index)
    _insert(db, ORG, index=999, is_current=True)

    deleted = prune_superseded_snapshots(db, ORG, keep=48, batch=500)

    assert deleted == 12
    current, superseded = _counts(db)
    assert current == 1
    assert superseded == 48
    # The retained window is the most recent history, not an arbitrary slice:
    # index 0-11 are gone, 12-59 remain. SQLite returns timestamps as strings,
    # so compare on the stored text form.
    oldest = db.execute(
        text("""
            SELECT min(generated_at) AS oldest FROM business_states
            WHERE organization_id = :org AND is_current = 0
        """),
        {"org": ORG},
    ).mappings().one()
    assert str(oldest["oldest"]) == str(BASE + timedelta(minutes=12))


def test_prune_never_deletes_the_current_snapshot(db):
    for index in range(5):
        _insert(db, ORG, index=index)
    _insert(db, ORG, index=999, is_current=True)

    # keep below the floor still cannot make the live snapshot eligible.
    deleted = prune_superseded_snapshots(db, ORG, keep=1, batch=500)

    current, superseded = _counts(db)
    assert current == 1
    assert superseded == 5
    assert deleted == 0


def test_prune_respects_the_batch_limit(db):
    for index in range(300):
        _insert(db, ORG, index=index)

    deleted = prune_superseded_snapshots(db, ORG, keep=48, batch=50)

    assert deleted == 50
    assert _counts(db) == (0, 250)


def test_prune_drains_a_backlog_across_repeated_calls(db):
    """The backlog converges without one long-running delete."""
    for index in range(250):
        _insert(db, ORG, index=index)

    total = 0
    for _ in range(10):
        total += prune_superseded_snapshots(db, ORG, keep=48, batch=50)
        if _counts(db)[1] <= 48:
            break

    assert _counts(db) == (0, 48)
    assert total == 202


def test_prune_only_touches_the_requested_organization(db):
    for index in range(80):
        _insert(db, ORG, index=index)
    for index in range(80):
        _insert(db, OTHER_ORG, index=index)

    deleted = prune_superseded_snapshots(db, ORG, keep=48, batch=500)

    assert deleted == 32
    assert _counts(db, ORG) == (0, 48)
    # Tenant isolation: another organization's history is untouched.
    assert _counts(db, OTHER_ORG) == (0, 80)


def test_prune_swallows_failure_so_a_good_build_is_not_reported_failed(db):
    for index in range(5):
        _insert(db, ORG, index=index)

    # Drop the table out from under the delete.
    db.execute(text("DROP TABLE business_states"))
    db.commit()

    assert prune_superseded_snapshots(db, ORG, keep=48, batch=500) == 0
    # The session is usable again afterwards, not left in a broken transaction.
    assert db.in_transaction() is False
