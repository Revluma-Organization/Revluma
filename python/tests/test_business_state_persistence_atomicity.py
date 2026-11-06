"""Business-state persistence atomicity against a real PostgreSQL.

Production evidence, 2026-11-06 ~06:29 UTC:

    job_name: business-state-build:1dc6aa19-…
    last_error: BusinessStatePersistenceError: … (diag scope_opened=True
        in_tx_before=True pid_before=1534270 pid_after_insert=1517450 |
        IntegrityError: (psycopg2.errors.ForeignKeyViolation) insert or update
        on table "alert_queue" violates foreign key constraint
        "alert_queue_business_s…")
    business_states: no row newer than 2026-11-05 23:59:53 (nothing committed
        for six days, although three organizations reported a rebuilt snapshot)
    alert_queue:     zero rows in 24h; latest 2026-10-31

The persistence block used to write the snapshot, the baselines row and the
dependent alerts as separate round trips. Behind the production pooler those
round trips are not guaranteed to land on one server backend inside one
transaction, so the uncommitted snapshot INSERT was invisible to the dependent
alert INSERT and the foreign key rejected it. The whole block then rolled
back, every two minutes, forever.

These tests exercise the fixed implementation against a real PostgreSQL 16.
The database is throwaway either way (CI provides a disposable instance; the
fixture also self-provisions its schema when the instance is empty).

Gate: TASK198_DATABASE_URL, REVLUMA_TEST_DATABASE_URL or DATABASE_URL without
a "placeholder" host. Skips cleanly when no real database is reachable.
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import date, datetime, timezone

import pytest
import sqlalchemy as sa
from sqlalchemy import text
from sqlalchemy.orm import Session

from src.intelligence.business_state import (
    OUTCOME_REBUILT,
    BusinessStateBuildInProgress,
    BusinessStatePersistenceError,
    build_business_state_with_status,
    _build_lock_job_name,
)


def _candidate_urls() -> list[str]:
    urls: list[str] = []
    for name in ("TASK198_DATABASE_URL", "REVLUMA_TEST_DATABASE_URL", "DATABASE_URL"):
        value = (os.environ.get(name) or "").strip()
        if value and "placeholder" not in value and value not in urls:
            urls.append(value)
    return urls


def _reachable(url: str) -> bool:
    try:
        engine = sa.create_engine(url, connect_args={"connect_timeout": 3})
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        engine.dispose()
        return True
    except Exception:
        return False


_DB_URL = next((url for url in _candidate_urls() if _reachable(url)), None)
pytestmark = pytest.mark.skipif(
    _DB_URL is None,
    reason="no reachable PostgreSQL (set TASK198_DATABASE_URL or REVLUMA_TEST_DATABASE_URL)",
)

def _required_columns(engine, table: str) -> list[tuple[str, str]]:
    """Columns that are NOT NULL with no default, identity or generation.

    Production (prisma db push) and the local migration replay drift apart -
    for example migrations lack organizations.slug while the pushed schema
    requires it. The seeds must survive either.
    """
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT column_name, data_type FROM information_schema.columns"
                " WHERE table_schema = 'public' AND table_name = :t"
                " AND is_nullable = 'NO' AND column_default IS NULL"
                " AND is_identity = 'NO' AND is_generated = 'NEVER'"
            ),
            {"t": table},
        ).fetchall()
    return [(r[0], r[1]) for r in rows]


def _type_filler(data_type: str):
    if data_type == "uuid":
        return str(uuid.uuid4())
    if data_type in ("text", "character varying", "character"):
        return f"test-{uuid.uuid4().hex[:12]}"
    if data_type in ("integer", "bigint", "smallint", "numeric", "double precision", "real"):
        return 1
    if data_type == "boolean":
        return False
    if data_type.startswith("timestamp"):
        return datetime.now(timezone.utc)
    if data_type == "date":
        return date.today()
    if data_type in ("json", "jsonb"):
        return "{}"
    return f"test-{uuid.uuid4().hex[:12]}"


def _insert(engine, table: str, values: dict) -> None:
    fill = dict(values)
    for column, data_type in _required_columns(engine, table):
        if column not in fill:
            fill[column] = _type_filler(data_type)
    cols = ", ".join(fill)
    params = ", ".join(f":{c}" for c in fill)
    with engine.begin() as conn:
        conn.execute(text(f"INSERT INTO {table} ({cols}) VALUES ({params})"), fill)


_SCHEMA = [
    """CREATE TABLE IF NOT EXISTS organizations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id UUID,
        company_name TEXT NOT NULL DEFAULT 'test-org',
        industry TEXT NOT NULL DEFAULT 'general',
        country TEXT NOT NULL DEFAULT 'NG',
        slug TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )""",
    """CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        full_name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        accepted_terms BOOLEAN NOT NULL DEFAULT false,
        accepted_privacy_policy BOOLEAN NOT NULL DEFAULT false,
        status TEXT DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
    )""",
    """CREATE TABLE IF NOT EXISTS stores (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        platform TEXT NOT NULL DEFAULT 'shopify',
        shop_domain TEXT NOT NULL,
        access_token TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        installed_at TIMESTAMPTZ,
        last_synced_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
    )""",
    """CREATE TABLE IF NOT EXISTS business_states (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        is_current BOOLEAN NOT NULL DEFAULT true,
        schema_version TEXT NOT NULL DEFAULT '1.0',
        generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        data_freshness_at TIMESTAMPTZ,
        valid_until TIMESTAMPTZ,
        staleness_threshold_mins INTEGER NOT NULL DEFAULT 30,
        computation_status TEXT NOT NULL DEFAULT 'complete',
        computation_duration_ms INTEGER,
        revenue_today NUMERIC(12,2),
        revenue_yesterday NUMERIC(12,2),
        revenue_delta_pct DOUBLE PRECISION,
        revenue_trend_7d DOUBLE PRECISION,
        revenue_anomaly BOOLEAN NOT NULL DEFAULT false,
        abandoned_cart_count INTEGER,
        abandoned_cart_value NUMERIC(12,2),
        cart_anomaly BOOLEAN NOT NULL DEFAULT false,
        churn_risk_count INTEGER,
        vip_inactive_count INTEGER,
        returning_customer_rate DOUBLE PRECISION,
        opportunities JSONB,
        risks JSONB,
        anomalies JSONB,
        trends JSONB,
        ml_signals JSONB,
        source_data JSONB,
        metadata JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )""",
    """CREATE UNIQUE INDEX IF NOT EXISTS idx_bstate_org_current
        ON business_states (organization_id) WHERE is_current = true""",
    """CREATE TABLE IF NOT EXISTS orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id UUID NOT NULL,
        ordered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        total NUMERIC(12,2) NOT NULL DEFAULT 0,
        recovery_status TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )""",
    """CREATE TABLE IF NOT EXISTS business_state_baselines (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
        revenue_avg_30d NUMERIC(12,2),
        event_rate_5m_30d DOUBLE PRECISION,
        cart_abandonment_rate_30d DOUBLE PRECISION,
        returning_customer_rate_30d DOUBLE PRECISION,
        day_of_week_baseline JSONB,
        seasonal_baseline JSONB,
        next_rebuild_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )""",
    """CREATE TABLE IF NOT EXISTS alert_queue (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        business_state_id UUID REFERENCES business_states(id) ON DELETE SET NULL,
        alert_type VARCHAR(80) NOT NULL,
        severity VARCHAR(40) NOT NULL,
        message VARCHAR(500) NOT NULL,
        action_url VARCHAR(500),
        payload JSONB,
        status VARCHAR(40) NOT NULL DEFAULT 'pending',
        dedupe_key VARCHAR(200) NOT NULL,
        available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT alert_queue_org_dedupe_key UNIQUE (organization_id, dedupe_key)
    )""",
    """CREATE TABLE IF NOT EXISTS automation_job_state (
        job_name TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'idle',
        last_started_at TIMESTAMPTZ,
        last_completed_at TIMESTAMPTZ,
        next_run_at TIMESTAMPTZ,
        last_result JSONB,
        last_error TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )""",
]


@pytest.fixture(scope="module")
def engine():
    engine = sa.create_engine(_DB_URL, pool_size=2, max_overflow=2, pool_pre_ping=True)
    with engine.begin() as conn:
        for statement in _SCHEMA:
            conn.execute(text(statement))
    yield engine
    engine.dispose()


@pytest.fixture()
def org(engine):
    org_id = str(uuid.uuid4())
    user_id = str(uuid.uuid4())
    store_id = str(uuid.uuid4())
    # Insert through the schema itself: any NOT NULL column without a default
    # (production pushed schema and the local migration replay disagree) is
    # filled from the live information_schema, so the seed works on both.
    _insert(
        engine,
        "users",
        {
            "id": user_id,
            "full_name": "test merchant",
            "email": f"test-{uuid.uuid4().hex[:12]}@example.invalid",
            "password_hash": "x",
            "accepted_terms": True,
            "accepted_privacy_policy": True,
        },
    )
    _insert(
        engine,
        "organizations",
        {
            "id": org_id,
            "owner_id": user_id,
            "company_name": "test-org",
            "industry": "general",
            "country": "NG",
        },
    )
    _insert(
        engine,
        "stores",
        {
            "id": store_id,
            "organization_id": org_id,
            "platform": "shopify",
            "shop_domain": f"test-{uuid.uuid4().hex[:12]}.myshopify.com",
            "status": "active",
            "last_synced_at": datetime.now(timezone.utc),
        },
    )
    return {"org_id": org_id, "store_id": store_id}


def _seed_anomalous_baseline(engine, org_id: str) -> None:
    """Make revenue_anomaly deterministic: today's revenue (0) vs a baseline of
    1000 ± 10 must trigger the >2σ deviation branch."""
    dow = {str(i): {"average_revenue": 1000.0, "stddev_revenue": 10.0} for i in range(7)}
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO business_state_baselines (organization_id, revenue_avg_30d,"
                " day_of_week_baseline)"
                " VALUES (:org, 1000, CAST(:dow AS JSONB))"
                " ON CONFLICT (organization_id) DO UPDATE SET"
                " day_of_week_baseline = EXCLUDED.day_of_week_baseline,"
                " revenue_avg_30d = EXCLUDED.revenue_avg_30d"
            ),
            {"org": org_id, "dow": json.dumps(dow)},
        )


def _install_failing_alert_trigger(engine, org_id: str) -> None:
    """Test-only trigger that aborts every alert insert for this organization."""
    with engine.begin() as conn:
        conn.execute(text(
            f'CREATE OR REPLACE FUNCTION alert_queue_test_fail_{org_id.replace("-", "")}()'
            " RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN"
            " RAISE EXCEPTION 'forced alert failure'; END $$;"
        ))
        conn.execute(text(
            f'DROP TRIGGER IF EXISTS alert_queue_test_fail ON alert_queue;'
            f'CREATE TRIGGER alert_queue_test_fail BEFORE INSERT ON alert_queue'
            f' FOR EACH ROW WHEN (NEW.organization_id = \'{org_id}\'::uuid)'
            f' EXECUTE FUNCTION alert_queue_test_fail_{org_id.replace("-", "")}();'
        ))


def _drop_failing_alert_trigger(engine, org_id: str) -> None:
    with engine.begin() as conn:
        conn.execute(text("DROP TRIGGER IF EXISTS alert_queue_test_fail ON alert_queue"))
        conn.execute(text(f'DROP FUNCTION IF EXISTS alert_queue_test_fail_{org_id.replace("-", "")}()'))


def _counts(engine, org_id: str) -> dict:
    with engine.connect() as conn:
        states = conn.execute(
            text("SELECT count(*), bool_or(is_current) FROM business_states WHERE organization_id = :org"),
            {"org": org_id},
        ).one()
        alerts = conn.execute(
            text("SELECT count(*) FROM alert_queue WHERE organization_id = :org"),
            {"org": org_id},
        ).scalar()
        job = conn.execute(
            text("SELECT last_error FROM automation_job_state WHERE job_name = :name"),
            {"name": _build_lock_job_name(org_id)},
        ).scalar()
    return {"states": states[0], "has_current": bool(states[1]), "alerts": alerts, "lock_error": job}


def test_successful_build_commits_parent_and_dependents_atomically(engine, org):
    """The invariant production violated for six days, checked end to end."""
    org_id = org["org_id"]
    _seed_anomalous_baseline(engine, org_id)

    # Pre-existing current snapshot must be superseded, not duplicated.
    with engine.begin() as conn:
        old_id = conn.execute(
            text(
                "INSERT INTO business_states (organization_id, is_current)"
                " VALUES (:org, true) RETURNING id"
            ),
            {"org": org_id},
        ).scalar()

    session = Session(bind=engine)
    try:
        state, outcome = build_business_state_with_status(org_id, session)
    finally:
        session.close()

    assert outcome == OUTCOME_REBUILT
    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT id FROM business_states WHERE organization_id = :org AND is_current"),
            {"org": org_id},
        ).fetchall()
        assert len(rows) == 1, "exactly one snapshot may be current"
        assert str(rows[0][0]) == str(state.id)
        old_current = conn.execute(
            text("SELECT is_current FROM business_states WHERE id = :id"),
            {"id": old_id},
        ).scalar()
        assert old_current is False, "previous snapshot must be superseded in the same transaction"
        alerts = conn.execute(
            text("SELECT business_state_id FROM alert_queue WHERE organization_id = :org"),
            {"org": org_id},
        ).fetchall()
        assert alerts, "the anomalous baseline must produce alerts"
        assert all(str(a[0]) == str(state.id) for a in alerts), (
            "every dependent alert must reference the committed snapshot"
        )


def test_failing_alert_write_leaves_no_partial_state(engine, org):
    """If any dependent write fails, the snapshot must not persist either."""
    org_id = org["org_id"]
    _seed_anomalous_baseline(engine, org_id)
    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO business_states (organization_id, is_current) VALUES (:org, true)"),
            {"org": org_id},
        )
    _install_failing_alert_trigger(engine, org_id)
    session = Session(bind=engine)
    try:
        with pytest.raises(BusinessStatePersistenceError):
            build_business_state_with_status(org_id, session)
    finally:
        session.close()
        _drop_failing_alert_trigger(engine, org_id)

    counts = _counts(engine, org_id)
    assert counts["states"] == 1, "the failed build must not persist a new snapshot"
    assert counts["has_current"] is True, "the previous snapshot must survive intact"
    assert counts["alerts"] == 0, "no dependent write may survive a failed batch"


def test_backend_death_between_diagnostic_and_write_leaves_no_partial_state(engine, org):
    """The connection is discarded after the pid diagnostic, before the write.

    Simulates what production observed: the backend serving the session's
    transaction is destroyed between statements, so the write proceeds without
    the protection the surrounding session transaction was assumed to provide.
    Whether the build fails or the write lands, it must never leave a partial
    snapshot behind - and the failure must surface, not report success.
    """
    org_id = org["org_id"]
    _seed_anomalous_baseline(engine, org_id)

    killed = {"done": False}

    @sa.event.listens_for(sa.engine.Connection, "after_cursor_execute")
    def _kill_after_pid_diagnostic(conn, cursor, statement, parameters, context, executemany):
        if killed["done"]:
            return
        if "pg_backend_pid()" in statement and "pg_advisory_xact_lock" not in statement:
            killed["done"] = True
            watcher = engine.raw_connection()
            try:
                wcur = watcher.cursor()
                # Terminate every other backend on this database: the build's
                # pinned backend and any idle fixture backends. The watcher
                # excludes itself. This database is disposable.
                wcur.execute(
                    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity"
                    " WHERE datname = current_database() AND pid <> pg_backend_pid()"
                )
                watcher.commit()
            finally:
                watcher.close()

    try:
        session = Session(bind=engine)
        try:
            try:
                state, outcome = build_business_state_with_status(org_id, session)
                killed["result"] = "rebuilt"
            except BusinessStatePersistenceError:
                killed["result"] = "failed"
        finally:
            session.close()
    finally:
        try:
            sa.event.remove(sa.engine.Connection, "after_cursor_execute", _kill_after_pid_diagnostic)
        except Exception:
            pass

    counts = _counts(engine, org_id)
    # The invariant that matters: never a partial state. Either the build
    # failed loudly with nothing persisted, or the driver transparently
    # retried on a fresh backend and the batch landed whole (it is atomic).
    if killed.get("result") == "failed":
        assert counts["states"] == 0, "a killed backend must not leave a snapshot behind"
        assert counts["alerts"] == 0
    else:
        assert counts["states"] == 1, "a transparent retry must persist exactly one snapshot"
        assert counts["has_current"] is True
        assert counts["alerts"] >= 1, "a successful build must persist its dependents"


def test_concurrent_build_fails_loudly_and_writes_nothing(engine, org):
    """Advisory-lock contention: one build holds, the other must lose cleanly."""
    org_id = org["org_id"]
    _seed_anomalous_baseline(engine, org_id)

    lock_conn = engine.connect()
    trans = lock_conn.begin()
    lock_conn.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:key)::bigint)"),
        {"key": _build_lock_job_name(org_id)},
    )
    try:
        session = Session(bind=engine)
        try:
            with pytest.raises(BusinessStateBuildInProgress):
                build_business_state_with_status(org_id, session)
        finally:
            session.close()
        counts = _counts(engine, org_id)
        assert counts["states"] == 0
        assert counts["alerts"] == 0
    finally:
        trans.rollback()
        lock_conn.close()


def test_retry_after_failure_completes_cleanly(engine, org):
    """A failed attempt followed by a retry must leave exactly one snapshot."""
    org_id = org["org_id"]
    _seed_anomalous_baseline(engine, org_id)
    _install_failing_alert_trigger(engine, org_id)
    session = Session(bind=engine)
    try:
        with pytest.raises(BusinessStatePersistenceError):
            build_business_state_with_status(org_id, session)
    finally:
        session.close()
        _drop_failing_alert_trigger(engine, org_id)

    session = Session(bind=engine)
    try:
        state, outcome = build_business_state_with_status(org_id, session)
    finally:
        session.close()

    assert outcome == OUTCOME_REBUILT
    counts = _counts(engine, org_id)
    assert counts["states"] == 1
    assert counts["has_current"] is True
    assert counts["alerts"] >= 1


def test_persistence_block_is_a_single_round_trip():
    """Source-level guard: the whole critical section is one db.execute call."""
    import inspect

    from src.intelligence import business_state

    source = inspect.getsource(business_state._build_business_state_unlocked)
    exec_at = source.index('db.execute(text(critical_section_sql), persistence_params)')
    assignments = source[:exec_at]
    assert 'critical_section_sql = """' in assignments
    # The dependent writes are composed into the same statement.
    assert "baseline_sql" in assignments
    assert "alerts_sql" in assignments
    assert '""" + baseline_sql + alerts_sql' in assignments
    # And no separate dependent writes survive outside the batch.
    after = source[exec_at:]
    assert 'INSERT INTO alert_queue' not in after
    assert "UPDATE business_state_baselines" not in after.split("diag_pid_after_insert")[0]
