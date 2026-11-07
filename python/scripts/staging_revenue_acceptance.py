"""Staging acceptance: revenue evidence against a real PostgreSQL database.

Seeds synthetic, isolated fixtures inside one transaction, exercises the
production evidence service against them, asserts the verified values, then
rolls everything back. Nothing is written permanently and no merchant data is
used.

The seed is two-phase on purpose:

1. Orders carry persisted ``refunded_total`` values while the itemised refund
   ledger and the financial sub-domain sync ledger are empty.  The service
   must refuse to certify (overall ``partial``), flag every unreconciled
   order, and mark refund/transaction money ``not_synchronized`` — a ledger
   gap is a visible gap, never a silent zero.

2. The itemised ``order_refunds`` rows matching each order's recorded refund
   total are seeded, and both stores complete fully paginated refunds and
   transactions synchronizations.  The service must now certify the window:
   overall ``available``, reconciliation clean (``verified_zero``), refund
   money attributed to the refund date and separated by currency, cancelled
   orders excluded, and currencies never summed.

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


def _item(items: list[dict], metric: str, currency: str | None = None) -> dict:
    for item in items:
        if item["metric"] == metric and item.get("currency") == currency:
            return item
    raise AssertionError(f"evidence item not found: {metric} ({currency})")


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
            text("INSERT INTO organizations (id, owner_id, company_name, industry, country, slug) "
                 "VALUES (:id, :owner, 'Staging Acceptance Org', 'test', 'NG', :slug)"),
            {"id": org, "owner": user, "slug": f"staging-acceptance-{org}"},
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
        # partially refunded; #2002 is clean; #2003 is cancelled and must be
        # excluded from every metric. Refund money is recorded on the order
        # rows (persisted refunded_total) while the itemised ledger below is
        # still empty in phase 1.
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

        failures: list[str] = []

        # ── Phase 1: ledger uncertified. Gaps must be visible, not silent. ──
        uncertified = retrieve_revenue_evidence(
            org, connection, start=start, end=end, now=now)
        net = _money(uncertified["items"], "recorded_order_value")
        counts = {
            item["currency"]: item["value"]
            for item in uncertified["items"]
            if item["metric"] == "recorded_order_count"
        }
        print(f"[phase 1] overall_status={uncertified['overall_status']}")
        print(f"[phase 1] recorded_order_value={net}")
        print(f"[phase 1] recorded_order_count={counts}")
        if net != {"EUR": "25.00", "USD": "120.00"}:
            failures.append(f"phase 1 net value mismatch: {net}")
        if counts != {"EUR": 1, "USD": 4}:
            failures.append(f"phase 1 order count mismatch: {counts}")
        if uncertified["overall_status"] != "partial":
            failures.append(
                f"phase 1 must not certify with an unreconciled ledger: "
                f"{uncertified['overall_status']}")
        recon = _item(uncertified["items"], "reconciliation_discrepancy_count")
        if recon["value"] != 4:
            failures.append(
                f"phase 1 must flag the 4 orders whose recorded refund total "
                f"has no itemised ledger row, got {recon['value']}")
        for metric in ("refund_amount", "captured_payment_amount"):
            if _item(uncertified["items"], metric)["status"] != "not_synchronized":
                failures.append(
                    f"phase 1 {metric} must be not_synchronized without a "
                    f"completed sub-domain synchronization")

        # ── Phase 2: ledger reconciled and sub-domains certified. ──
        # Itemised refund rows matching each order's recorded refund total
        # (2002's 0.00 needs no row; 2003 is cancelled and has none).
        connection.execute(
            text("INSERT INTO order_refunds (id, store_id, external_order_id, external_id, "
                 "refund_amount, refund_currency, created_at) VALUES "
                 "(:id, :store, '1004', 'acc-refund-1004', 1025.00, 'USD', :at), "
                 "(:id2, :store, '1001', 'acc-refund-1001', 100.00, 'USD', :at2), "
                 "(:id3, :store, '2001', 'acc-refund-2001', 30.00, 'USD', :at3), "
                 "(:id4, :eur_store, '3001', 'acc-refund-3001', 5.00, 'EUR', :at4)"),
            {"id": str(uuid.uuid4()), "id2": str(uuid.uuid4()), "id3": str(uuid.uuid4()),
             "id4": str(uuid.uuid4()), "store": usd_store, "eur_store": eur_store,
             "at": start + timedelta(hours=2), "at2": start + timedelta(hours=3),
             "at3": start + timedelta(hours=4), "at4": start + timedelta(hours=7)},
        )
        # Both stores completed fully paginated refunds and transactions runs.
        for sid in (usd_store, eur_store):
            for domain in ("refunds", "transactions"):
                connection.execute(
                    text("INSERT INTO store_sync_domain_states (id, store_id, domain, status, "
                         "pagination_complete, last_succeeded_at) VALUES "
                         "(:id, :store, :domain, 'ok', true, :succeeded)"),
                    {"id": str(uuid.uuid4()), "store": sid, "domain": domain,
                     "succeeded": now - timedelta(minutes=5)},
                )

        evidence = retrieve_revenue_evidence(org, connection, start=start, end=end, now=now)
        net = _money(evidence["items"], "recorded_order_value")
        counts = {
            item["currency"]: item["value"]
            for item in evidence["items"]
            if item["metric"] == "recorded_order_count"
        }
        print(f"[phase 2] overall_status={evidence['overall_status']}")
        print(f"[phase 2] recorded_order_value={net}")
        print(f"[phase 2] recorded_order_count={counts}")
        if net != {"EUR": "25.00", "USD": "120.00"}:
            failures.append(f"net value mismatch: {net}")
        if counts != {"EUR": 1, "USD": 4}:
            failures.append(f"order count mismatch: {counts}")
        if "999.00" in str(evidence) or "1025.00" in str(evidence):
            failures.append("cancelled or refunded gross value leaked into evidence")
        if evidence["overall_status"] != "available":
            failures.append(f"coverage not verified: {evidence['overall_status']}")
        if not evidence["domain_coverage"]["refunds"]["complete"] \
                or not evidence["domain_coverage"]["transactions"]["complete"]:
            failures.append("financial sub-domain coverage is not certified")
        # Refunds are netted exactly once: net + itemised refund ledger rows
        # reconstruct gross, per currency, attributed to the refund date.
        refunds = _money(evidence["items"], "refund_amount")
        if refunds != {"EUR": "5.00", "USD": "1155.00"}:
            failures.append(f"refund ledger mismatch: {refunds}")
        if _item(evidence["items"], "refund_amount", "USD")["status"] != "available" \
                or _item(evidence["items"], "refund_amount", "EUR")["status"] != "available":
            failures.append("refunded sub-domain is certified but refund_amount is not available")
        if _money(evidence["items"], "gross_sales") != {"EUR": "30.00", "USD": "1275.00"}:
            failures.append(
                f"gross (net + refunded) mismatch: {_money(evidence['items'], 'gross_sales')}")
        if _money(evidence["items"], "refund_amount_window_orders") != {
                "EUR": "5.00", "USD": "1155.00"}:
            failures.append(
                "window-order refund totals do not bridge gross and net")
        # Captured payments: the certified ledger recorded none, so the
        # per-currency figure is a verified zero — never an unknown.
        if _money(evidence["items"], "captured_payment_amount") != {
                "EUR": "0.00", "USD": "0.00"}:
            failures.append(
                f"captured payment mismatch: {_money(evidence['items'], 'captured_payment_amount')}")
        recon = _item(evidence["items"], "reconciliation_discrepancy_count")
        if recon["value"] != 0 or recon["status"] != "verified_zero":
            failures.append(
                f"reconciliation must be a verified zero once the ledger "
                f"matches, got value={recon['value']} status={recon['status']}")

        if failures:
            for failure in failures:
                print(f"FAIL: {failure}")
            return 1
        print("PASS: ledger gaps visible when uncertified, refunds netted exactly "
              "once when certified, cancellations excluded, currencies separated, "
              "coverage verified, reconciliation a verified zero")
        return 0
    finally:
        transaction.rollback()
        connection.close()
        engine.dispose()


if __name__ == "__main__":
    sys.exit(main())
