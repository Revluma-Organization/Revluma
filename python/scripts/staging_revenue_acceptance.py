"""Staging acceptance: revenue evidence against a real PostgreSQL database.

Seeds synthetic, isolated fixtures inside one transaction, asks the production
evidence service for a revenue window, asserts the verified values, then rolls
everything back. Nothing is written permanently and no merchant data is used.

Run against the local zero-cost staging database (not production):

    DATABASE_URL="postgresql+psycopg2://postgres@127.0.0.1:55432/revluma_staging" \
        python scripts/staging_revenue_acceptance.py
"""
from __future__ import annotations

import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import create_engine, text

from src.intelligence.seven_day_evidence import retrieve_revenue_evidence


def _money(items: list[dict], metric: str) -> dict[str, str]:
    return {
        item["currency"]: str(item["value"])
        for item in items
        if item["metric"] == metric and item.get("currency") and item.get("value") is not None
    }


def main() -> int:
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("DATABASE_URL is required (use the staging DSN, never production).")
        return 2
    engine = create_engine(url)
    org = str(uuid.uuid4())
    user = str(uuid.uuid4())
    usd_store, eur_store = str(uuid.uuid4()), str(uuid.uuid4())
    usd_customer, eur_customer = str(uuid.uuid4()), str(uuid.uuid4())
    now = datetime(2026, 11, 1, 12, tzinfo=timezone.utc)
    start, end = now - timedelta(days=7), now

    connection = engine.connect()
    transaction = connection.begin()
    try:
        connection.execute(
            text("INSERT INTO users (id, full_name, email, password_hash) "
                 "VALUES (:id, 'Staging Acceptance', :email, 'staging-only')"),
            {"id": user, "email": f"staging-{user}@example.invalid"},
        )
        connection.execute(
            text("INSERT INTO organizations (id, owner_id, company_name, industry, country) "
                 "VALUES (:id, :owner, 'Staging Acceptance Org', 'test', 'NG')"),
            {"id": org, "owner": user},
        )
        connection.execute(
            text("INSERT INTO stores (id, organization_id, platform, shop_domain, status, last_synced_at) "
                 "VALUES (:usd, :org, 'shopify', 'acceptance-usd.myshopify.com', 'active', now()), "
                        "(:eur, :org, 'shopify', 'acceptance-eur.myshopify.com', 'active', now())"),
            {"usd": usd_store, "eur": eur_store, "org": org},
        )
        connection.execute(
            text("INSERT INTO customers (id, store_id, external_id, email) VALUES "
                 "(:usd, :usd_store, 'acceptance-usd', 'usd@example.invalid'), "
                 "(:eur, :eur_store, 'acceptance-eur', 'eur@example.invalid')"),
            {"usd": usd_customer, "eur": eur_customer,
             "usd_store": usd_store, "eur_store": eur_store},
        )
        connection.execute(
            text("INSERT INTO intelligence_order_coverage (store_id, organization_id, coverage_start, "
                 "coverage_end, certified_at, source, source_run_id) VALUES "
                 "(:usd, :org, :start, :end, now(), 'shopify_verified_history_v1', 'staging-acceptance'), "
                 "(:eur, :org, :start, :end, now(), 'shopify_verified_history_v1', 'staging-acceptance')"),
            {"usd": usd_store, "eur": eur_store, "org": org,
             "start": start - timedelta(days=1), "end": end + timedelta(days=1)},
        )
        # #1004 ($1,025 -> $0) and #1001 ($100 -> $0) are fully refunded; #2001 is
        # partially refunded; #2003 is cancelled and must be excluded.
        rows = [
            (usd_store, usd_customer, "1004", "0.00", "1025.00", "USD", 1, "completed"),
            (usd_store, usd_customer, "1001", "0.00", "100.00", "USD", 2, "completed"),
            (usd_store, usd_customer, "2001", "70.00", "30.00", "USD", 3, "completed"),
            (usd_store, usd_customer, "2002", "50.00", "0.00", "USD", 4, "completed"),
            (usd_store, usd_customer, "2003", "999.00", "0.00", "USD", 5, "cancelled"),
            (eur_store, eur_customer, "3001", "25.00", "5.00", "EUR", 6, "completed"),
        ]
        connection.execute(
            text("INSERT INTO orders (id, store_id, customer_id, external_order_id, total, "
                 "refunded_total, currency, ordered_at, recovery_status) VALUES "
                 "(:id, :store, :customer, :external, :total, :refunded, :currency, :ordered, :status)"),
            [{"id": str(uuid.uuid4()), "store": store, "customer": customer, "external": external,
              "total": total, "refunded": refunded, "currency": currency,
              "ordered": start + timedelta(hours=hours), "status": status}
             for store, customer, external, total, refunded, currency, hours, status in rows],
        )

        evidence = retrieve_revenue_evidence(org, connection, start=start, end=end, now=now)
        net = _money(evidence["items"], "recorded_order_value")
        counts = {
            item["currency"]: item["value"]
            for item in evidence["items"]
            if item["metric"] == "recorded_order_count"
        }
        print(f"overall_status={evidence['overall_status']}")
        print(f"recorded_order_value={net}")
        print(f"recorded_order_count={counts}")

        failures = []
        if net != {"EUR": "25.00", "USD": "120.00"}:
            failures.append(f"net revenue mismatch: {net}")
        if counts != {"EUR": 1, "USD": 4}:
            failures.append(f"order count mismatch: {counts}")
        if "999.00" in str(evidence) or "1025.00" in str(evidence):
            failures.append("cancelled or refunded gross value leaked into evidence")
        if evidence["overall_status"] != "available":
            failures.append(f"coverage not verified: {evidence['overall_status']}")

        refund_items = [i for i in evidence["items"] if i["metric"] == "refund_adjustment"]
        if not refund_items or refund_items[0]["status"] not in ("unavailable", "unsupported"):
            failures.append("refund ledger limitation is not stated")

        if failures:
            for failure in failures:
                print(f"FAIL: {failure}")
            return 1
        print("PASS: refunds netted once, cancellations excluded, currencies separated, "
              "coverage verified, refund limitation stated")
        return 0
    finally:
        transaction.rollback()
        connection.close()
        engine.dispose()


if __name__ == "__main__":
    sys.exit(main())
