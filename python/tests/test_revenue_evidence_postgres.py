"""Disposable PostgreSQL integration coverage for Task 198 revenue retrieval."""
import os
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError

from src.intelligence.seven_day_evidence import retrieve_revenue_evidence


@pytest.fixture
def revenue_postgres():
    url = os.environ.get("TASK198_DATABASE_URL")
    if not url:
        pytest.skip("TASK198_DATABASE_URL is not configured; CI supplies disposable PostgreSQL.")
    schema = "task198_" + uuid.uuid4().hex
    admin = create_engine(url)
    with admin.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_engine(url, connect_args={"options": f"-csearch_path={schema}"})
    with engine.begin() as connection:
        connection.execute(text("""
            CREATE TABLE stores (
                id uuid PRIMARY KEY,
                organization_id uuid NOT NULL,
                platform text NOT NULL,
                status text NOT NULL,
                last_synced_at timestamptz
            )
        """))
        connection.execute(text("""
            CREATE TABLE intelligence_order_coverage (
                store_id uuid PRIMARY KEY,
                organization_id uuid NOT NULL,
                coverage_start timestamptz NOT NULL,
                coverage_end timestamptz NOT NULL,
                certified_at timestamptz NOT NULL,
                source text NOT NULL,
                source_run_id text NOT NULL
            )
        """))
        connection.execute(text("""
            CREATE TABLE orders (
                id uuid PRIMARY KEY,
                store_id uuid NOT NULL,
                external_order_id text NOT NULL,
                currency varchar(3),
                total numeric(10,2) NOT NULL,
                ordered_at timestamptz NOT NULL,
                recovery_status text,
                UNIQUE (store_id, external_order_id)
            )
        """))
    connection = engine.connect()
    try:
        yield connection
    finally:
        connection.close()
        engine.dispose()
        with admin.begin() as cleanup:
            cleanup.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        admin.dispose()


def test_postgres_revenue_retrieval_is_currency_separated_tenant_scoped_and_period_exact(revenue_postgres):
    db = revenue_postgres
    org_a = str(uuid.uuid4())
    org_b = str(uuid.uuid4())
    store_a1, store_a2, store_b = [str(uuid.uuid4()) for _ in range(3)]
    now = datetime(2026, 10, 31, 12, tzinfo=timezone.utc)
    start, end = now - timedelta(days=7), now
    fresh = now - timedelta(minutes=5)
    stores = [
        (store_a1, org_a, "active", fresh),
        (store_a2, org_a, "connected", fresh),
        (store_b, org_b, "active", fresh),
    ]
    db.execute(text("""
        INSERT INTO stores (id, organization_id, platform, status, last_synced_at)
        VALUES (:id, :org, 'shopify', :status, :sync)
    """), [{"id": sid, "org": org, "status": status, "sync": sync} for sid, org, status, sync in stores])
    coverage = [
        (store_a1, org_a), (store_a2, org_a), (store_b, org_b),
    ]
    db.execute(text("""
        INSERT INTO intelligence_order_coverage
          (store_id, organization_id, coverage_start, coverage_end, certified_at, source, source_run_id)
        VALUES (:store, :org, :start, :end, :now, 'shopify_verified_history_v1', 'task198-fixture-run')
    """), [{
        "store": sid, "org": org, "start": start - timedelta(days=1),
        "end": end + timedelta(days=1), "now": now,
    } for sid, org in coverage])
    orders = [
        (store_a1, "USD", "10.10", start, "completed"),
        (store_a2, "USD", "20.20", start + timedelta(hours=1), "completed"),
        (store_a1, "USD", "0.01", start + timedelta(hours=2), None),
        (store_a1, "NGN", "1000.00", start + timedelta(hours=3), "completed"),
        (store_a1, "USD", "999.00", start + timedelta(hours=4), "cancelled"),
        (store_b, "USD", "500.00", start + timedelta(hours=5), "completed"),
        (store_a1, "USD", "30.00", end, "completed"),
    ]
    db.execute(text("""
        INSERT INTO orders (id, store_id, external_order_id, currency, total, ordered_at, recovery_status)
        VALUES (:id, :store, :external, :currency, :total, :ordered, :status)
    """), [{
        "id": str(uuid.uuid4()), "store": sid, "external": f"order-{index}",
        "currency": currency, "total": Decimal(amount), "ordered": ordered, "status": status,
    } for index, (sid, currency, amount, ordered, status) in enumerate(orders)])
    db.commit()

    evidence = retrieve_revenue_evidence(org_a, db, start=start, end=end, now=now)
    assert evidence["overall_status"] == "available"
    assert evidence["organization_scope"]["store_count"] == 2
    values = {item["currency"]: item["value"] for item in evidence["items"]
              if item["metric"] == "recorded_order_value" and item["value"] is not None}
    counts = {item["currency"]: item["value"] for item in evidence["items"]
              if item["metric"] == "recorded_order_count"}
    assert values == {"NGN": "1000.00", "USD": "30.31"}
    assert counts == {"NGN": 1, "USD": 3}
    assert "500.00" not in str(evidence)
    assert "999.00" not in str(evidence)
    assert "30.00" not in str(evidence)
    with pytest.raises(IntegrityError):
        with db.begin_nested():
            db.execute(text("""
                INSERT INTO orders (id, store_id, external_order_id, currency, total, ordered_at, recovery_status)
                VALUES (:id, :store, :external, 'USD', 1.00, :ordered, 'completed')
            """), {
                "id": str(uuid.uuid4()), "store": store_a1,
                "external": "order-0", "ordered": start,
            })


def test_postgres_verified_zero_is_distinct_from_currencyless_zero(revenue_postgres):
    db = revenue_postgres
    org = str(uuid.uuid4())
    store = str(uuid.uuid4())
    now = datetime(2026, 10, 31, 12, tzinfo=timezone.utc)
    start, end = now - timedelta(days=7), now
    db.execute(text("""
        INSERT INTO stores (id, organization_id, platform, status, last_synced_at)
        VALUES (:store, :org, 'shopify', 'active', :sync)
    """), {"store": store, "org": org, "sync": now - timedelta(minutes=1)})
    db.execute(text("""
        INSERT INTO intelligence_order_coverage
          (store_id, organization_id, coverage_start, coverage_end, certified_at, source, source_run_id)
        VALUES (:store, :org, :start, :end, :now, 'shopify_verified_history_v1', 'task198-zero-fixture')
    """), {"store": store, "org": org, "start": start, "end": end, "now": now})
    db.commit()
    evidence = retrieve_revenue_evidence(org, db, start=start, end=end, now=now)
    assert evidence["overall_status"] == "available"
    count = next(item for item in evidence["items"] if item["metric"] == "recorded_order_count")
    value = next(item for item in evidence["items"] if item["metric"] == "recorded_order_value")
    assert count["value"] == 0
    assert value["status"] == "unsupported" and value["value"] is None and value["currency"] is None
