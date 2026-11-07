"""Disposable PostgreSQL integration coverage for Task 198 revenue retrieval.

Runs only where ``TASK198_DATABASE_URL`` is configured (GitHub CI supplies a
disposable postgres:16 service). The fixture schema mirrors the production
Prisma column names for the financial fields, so the SQL is exercised exactly
as it runs in production.
"""
import os
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from sqlalchemy import create_engine, text

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
                source_run_id text NOT NULL,
                customer_lifetime_verified boolean NOT NULL DEFAULT true
            )
        """))
        connection.execute(text("""
            CREATE TABLE orders (
                id uuid PRIMARY KEY,
                store_id uuid NOT NULL,
                external_order_id text NOT NULL,
                currency varchar(3),
                total numeric(10,2) NOT NULL,
                refunded_total numeric(10,2),
                subtotal numeric(10,2),
                discount_amount numeric(10,2),
                tax_amount numeric(12,2),
                shipping_amount numeric(12,2),
                total_received numeric(12,2),
                test_flag boolean,
                ordered_at timestamptz NOT NULL,
                recovery_status text
            )
        """))
        connection.execute(text("""
            CREATE TABLE order_refunds (
                id uuid PRIMARY KEY,
                store_id uuid NOT NULL,
                external_order_id text NOT NULL,
                external_id text NOT NULL,
                refund_amount numeric(12,2),
                refund_currency varchar(3),
                created_at timestamptz
            )
        """))
        connection.execute(text("""
            CREATE TABLE order_transactions (
                id uuid PRIMARY KEY,
                store_id uuid NOT NULL,
                external_order_id text NOT NULL,
                external_id text NOT NULL,
                kind varchar(64) NOT NULL,
                status varchar(32) NOT NULL,
                amount numeric(12,2),
                currency varchar(3),
                processed_at timestamptz
            )
        """))
        connection.execute(text("""
            CREATE TABLE store_sync_domain_states (
                id uuid PRIMARY KEY,
                store_id uuid NOT NULL,
                domain varchar(48) NOT NULL,
                status varchar(24) NOT NULL DEFAULT 'never_run',
                pagination_complete boolean NOT NULL DEFAULT false,
                last_succeeded_at timestamptz
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
    # (store, external, currency, total, refunded_to_date, subtotal, discount,
    #  tax, shipping, received, test_flag, ordered_at, recovery_status)
    orders = [
        (store_a1, "order-0", "USD", "10.10", "5.00", "9.40", "0.00", "0.70", "0.00", "10.10", False,
         start, "completed"),
        (store_a2, "order-1", "USD", "20.20", "2.00", "20.00", "0.00", "0.00", "0.20", "20.20", False,
         start + timedelta(hours=1), "completed"),
        (store_a1, "order-2", "USD", "0.01", None, "0.01", "0.00", None, None, None, False,
         start + timedelta(hours=2), None),
        (store_a1, "order-3", "NGN", "1000.00", "100.00", "1000.00", "0.00", None, None, None, False,
         start + timedelta(hours=3), "completed"),
        (store_a1, "order-4", "USD", "999.00", None, None, None, None, None, None, False,
         start + timedelta(hours=4), "cancelled"),
        (store_b, "order-5", "USD", "500.00", None, None, None, None, None, None, False,
         start + timedelta(hours=5), "completed"),
        (store_a1, "order-6", "USD", "30.00", None, None, None, None, None, None, False,
         end, "completed"),
        # A test-mode order: excluded from every monetary metric and count.
        (store_a1, "order-7", "USD", "77.00", None, None, None, None, None, None, True,
         start + timedelta(hours=6), "completed"),
    ]
    db.execute(text("""
        INSERT INTO orders
          (id, store_id, external_order_id, currency, total, refunded_total, subtotal,
           discount_amount, tax_amount, shipping_amount, total_received, test_flag,
           ordered_at, recovery_status)
        VALUES (:id, :store, :external, :currency, :total, :refunded, :subtotal,
                :discount, :tax, :shipping, :received, :test, :ordered, :status)
    """), [{
        "id": str(uuid.uuid4()), "store": sid, "external": external, "currency": currency,
        "total": Decimal(total), "refunded": Decimal(refunded) if refunded is not None else None,
        "subtotal": Decimal(subtotal) if subtotal is not None else None,
        "discount": Decimal(discount) if discount is not None else None,
        "tax": Decimal(tax) if tax is not None else None,
        "shipping": Decimal(shipping) if shipping is not None else None,
        "received": Decimal(received) if received is not None else None,
        "test": test, "ordered": ordered, "status": status,
    } for (sid, external, currency, total, refunded, subtotal, discount,
           tax, shipping, received, test, ordered, status) in orders])

    # Itemised refund ledger: the recorded per-order refunded totals must match
    # it exactly (reconciliation), and refund money is attributed to the
    # refund date, all inside the window.
    refunds = [
        (store_a1, "order-0", "refund-0", "5.00", "USD", start + timedelta(hours=2)),
        (store_a2, "order-1", "refund-1", "2.00", "USD", start + timedelta(hours=3)),
        (store_a1, "order-3", "refund-2", "100.00", "NGN", start + timedelta(hours=4)),
    ]
    db.execute(text("""
        INSERT INTO order_refunds
          (id, store_id, external_order_id, external_id, refund_amount, refund_currency, created_at)
        VALUES (:id, :store, :order, :external, :amount, :currency, :created)
    """), [{
        "id": str(uuid.uuid4()), "store": sid, "order": order, "external": external,
        "amount": Decimal(amount), "currency": currency, "created": created,
    } for (sid, order, external, amount, currency, created) in refunds])

    # Payment-transaction ledger: only successful SALE/CAPTURE with a recorded
    # processed_at in the window is captured money.
    transactions = [
        (store_a1, "order-0", "txn-0", "SALE", "SUCCESS", "10.10", "USD", start + timedelta(hours=1)),
        (store_a2, "order-1", "txn-1", "CAPTURE", "SUCCESS", "20.20", "USD", start + timedelta(hours=2)),
        (store_a1, "order-0", "txn-2", "AUTH", "SUCCESS", "50.00", "USD", start + timedelta(hours=1)),
        (store_a1, "order-3", "txn-3", "SALE", "SUCCESS", "1000.00", "NGN", start + timedelta(hours=3)),
        (store_a1, "order-0", "txn-4", "SALE", "SUCCESS", "9.99", "USD", start - timedelta(hours=1)),
        (store_a2, "order-1", "txn-5", "SALE", "SUCCESS", "1.00", "USD", None),
    ]
    db.execute(text("""
        INSERT INTO order_transactions
          (id, store_id, external_order_id, external_id, kind, status, amount, currency, processed_at)
        VALUES (:id, :store, :order, :external, :kind, :status, :amount, :currency, :processed)
    """), [{
        "id": str(uuid.uuid4()), "store": sid, "order": order, "external": external,
        "kind": kind, "status": status, "amount": Decimal(amount), "currency": currency,
        "processed": processed,
    } for (sid, order, external, kind, status, amount, currency, processed) in transactions])

    # Financial sub-domain sync ledger: both stores completed refunds and
    # transactions runs with full pagination, so those metrics are certified.
    domains = []
    for sid in (store_a1, store_a2):
        for domain in ("refunds", "transactions"):
            domains.append((sid, domain, "ok", True, now - timedelta(minutes=7)))
    db.execute(text("""
        INSERT INTO store_sync_domain_states
          (id, store_id, domain, status, pagination_complete, last_succeeded_at)
        VALUES (:id, :store, :domain, :status, :complete, :succeeded)
    """), [{
        "id": str(uuid.uuid4()), "store": sid, "domain": domain, "status": status,
        "complete": complete, "succeeded": succeeded,
    } for (sid, domain, status, complete, succeeded) in domains])
    db.commit()

    evidence = retrieve_revenue_evidence(org_a, db, start=start, end=end, now=now)
    assert evidence["overall_status"] == "available"
    assert evidence["organization_scope"]["store_count"] == 2
    values = {item["currency"]: item["value"] for item in evidence["items"]
              if item["metric"] == "recorded_order_value" and item["value"] is not None}
    counts = {item["currency"]: item["value"] for item in evidence["items"]
              if item["metric"] == "recorded_order_count"}
    # order-6 at exactly ``end`` is outside the half-open window, the
    # cancelled order and the other organization's order are excluded, and the
    # test-mode order is excluded from the count and every monetary metric.
    assert values == {"NGN": "1000.00", "USD": "30.31"}
    assert counts == {"NGN": 1, "USD": 3}
    assert "500.00" not in str(evidence)
    assert "999.00" not in str(evidence)
    assert "30.00" not in str(evidence)

    def money(metric, currency):
        return next(item for item in evidence["items"]
                    if item["metric"] == metric and item["currency"] == currency)

    # Refund ledger money, attributed to refund date, per currency. The refund
    # domain is certified for both stores, so the figure is available.
    assert money("refund_amount", "USD")["value"] == "7.00"
    assert money("refund_amount", "USD")["status"] == "available"
    assert money("refund_amount", "NGN")["value"] == "100.00"
    # gross = net + refunded, but only over orders whose refund total is
    # recorded: order-2 has no refund evidence, so gross is a partial 37.30
    # (15.10 + 22.20), never a fabricated 37.31.
    assert money("gross_sales", "USD")["value"] == "37.30"
    assert money("gross_sales", "USD")["status"] == "partial"
    assert money("gross_sales", "NGN")["value"] == "1100.00"
    assert money("gross_sales", "NGN")["status"] == "available"
    # Window-order refund totals bridge gross and net (deducted exactly once).
    assert money("refund_amount_window_orders", "USD")["value"] == "7.00"
    assert money("refund_amount_window_orders", "NGN")["value"] == "100.00"
    # Captured money: AUTH excluded, out-of-window and undated excluded.
    assert money("captured_payment_amount", "USD")["value"] == "30.30"
    assert money("captured_payment_amount", "USD")["status"] == "available"
    assert money("captured_payment_amount", "NGN")["value"] == "1000.00"
    # Field-level enrichment is partial where the source field is missing.
    assert money("tax_amount", "USD")["status"] == "partial"
    assert money("tax_amount", "USD")["value"] == "0.70"
    assert money("tax_amount", "NGN")["status"] == "unavailable"
    assert money("shipping_amount", "USD")["value"] == "0.20"
    assert money("shipping_amount", "USD")["status"] == "partial"
    assert money("discount_amount", "USD")["value"] == "0.00"
    assert money("line_items_value", "USD")["value"] == "29.41"
    assert money("outstanding_amount", "USD")["value"] == "0.00"
    # Test-mode order is reported as a count, never mixed into money.
    test_item = next(item for item in evidence["items"]
                     if item["metric"] == "test_order_count" and item["currency"] == "USD")
    assert test_item["value"] == 1
    # Reconciliation is clean: recorded refund totals match the ledger.
    recon = next(item for item in evidence["items"]
                 if item["metric"] == "reconciliation_discrepancy_count")
    assert recon["value"] == 0 and recon["status"] == "verified_zero"
    # The undated transaction is surfaced as a coverage gap, not a silent loss.
    assert any("processing date" in warning for warning in evidence["warnings"])
    assert evidence["domain_coverage"]["refunds"]["complete"] is True
    assert evidence["domain_coverage"]["transactions"]["complete"] is True


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
