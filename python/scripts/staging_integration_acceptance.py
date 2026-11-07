"""Staging acceptance: integration evidence against a real PostgreSQL database.

Seeds synthetic, isolated fixtures inside one transaction (two organizations,
one healthy store each, with sync ledgers, webhook registrations/deliveries
and order-coverage rows), exercises the production integration evidence
service against them, then rolls everything back.  Nothing is written
permanently and no merchant data is used.

Scenarios:

1. Healthy store: overall ``healthy``, contract-valid items, explicit
   connection/webhook states, and no token value anywhere in the output.
2. Tenant isolation: organization A's evidence never mentions organization
   B's store, and a foreign ``store_id`` is unreadable (``disconnected``).
3. Real failure visibility: after the orders ledger fails, the store is
   ``partially_operational`` with a named critical failure.

Run against the local zero-cost staging database (not production):

    DATABASE_URL="postgresql+psycopg2://postgres:postgres@127.0.0.1:5432/revluma_rc" \
        python scripts/staging_integration_acceptance.py
"""
from __future__ import annotations

import json
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import create_engine, text

from src.intelligence.evidence import validate_collection
from src.intelligence.integration_evidence import retrieve_integration_evidence

TOKEN_A = "shpat_staging_secret_" + uuid.uuid4().hex
TOKEN_B = "shpat_staging_secret_" + uuid.uuid4().hex
FULL_SCOPES = (
    "read_products,read_orders,read_inventory,read_customers,read_checkouts,"
    "read_locations,read_discounts,read_content,read_themes,read_shipping,read_returns"
)
DOMAINS = [
    "store_domains", "products", "variants", "orders", "refunds", "inventory",
    "locations", "transactions", "fulfillments", "customers",
    "abandoned_checkouts", "webhooks",
]


def _item(items: list[dict], metric: str, resource: str | None = None) -> dict:
    target = metric if not resource else f"integration.resource.{resource}"
    for entry in items:
        if entry["metric"] == target:
            return entry
    raise AssertionError(f"evidence item not found: {target}")


def _seed_ledgers(conn, store_id: str, at: datetime) -> None:
    conn.execute(
        text(
            "INSERT INTO store_sync_domain_states "
            "(id, store_id, domain, status, records_discovered, records_inserted, "
            "records_updated, pages_completed, pagination_complete, retry_count, "
            "last_attempted_at, last_succeeded_at, last_checked_at, checkpoint) "
            "VALUES (:id, :store, :domain, 'ok', 50, 40, 10, 1, true, 0, "
            ":at, :at, :at, '{}'::jsonb)"
        ),
        [{"id": str(uuid.uuid4()), "store": store_id, "domain": domain, "at": at}
         for domain in DOMAINS],
    )


def _seed_webhooks(conn, store_id: str, at: datetime) -> None:
    conn.execute(
        text(
            "INSERT INTO webhook_registrations "
            "(store_id, external_id, topic, delivery_url, status) "
            "VALUES (:store, :external, 'orders/create', "
            "'https://example.invalid/webhooks/shopify', 'active')"
        ),
        {"store": store_id, "external": f"wh-{store_id[:8]}"},
    )
    conn.execute(
        text(
            "INSERT INTO webhook_deliveries "
            "(provider, delivery_id, store_id, topic, status, received_at, processed_at) "
            "VALUES ('shopify', :delivery, :store, 'orders/create', 'processed', :at, :at)"
        ),
        {"delivery": f"dlv-{store_id[:8]}", "store": store_id, "at": at},
    )


def main() -> int:
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("DATABASE_URL is required (use the staging DSN, never production).")
        return 2
    engine = create_engine(url)
    now = datetime(2026, 11, 7, 12, 0, 0, tzinfo=timezone.utc)
    recent = now - timedelta(minutes=5)
    user_a, user_b = str(uuid.uuid4()), str(uuid.uuid4())
    org_a, org_b = str(uuid.uuid4()), str(uuid.uuid4())
    store_a, store_b = str(uuid.uuid4()), str(uuid.uuid4())

    connection = engine.connect()
    transaction = connection.begin()
    try:
        connection.execute(
            text("INSERT INTO users (id, full_name, email, password_hash) "
                 "VALUES (:id, 'Staging Integration', :email, 'staging-only')"),
            [{"id": user_a, "email": f"staging-int-a-{user_a}@example.invalid"},
             {"id": user_b, "email": f"staging-int-b-{user_b}@example.invalid"}],
        )
        connection.execute(
            text("INSERT INTO organizations (id, owner_id, company_name, industry, "
                 "country, slug) VALUES (:id, :owner, 'Staging Integration Org', "
                 "'test', 'NG', :slug)"),
            [{"id": org_a, "owner": user_a, "slug": f"staging-int-a-{org_a[:8]}"},
             {"id": org_b, "owner": user_b, "slug": f"staging-int-b-{org_b[:8]}"}],
        )
        connection.execute(
            text("INSERT INTO stores (id, organization_id, platform, shop_domain, "
                 "access_token, granted_scopes, status, installed_at, last_synced_at) "
                 "VALUES (:id, :org, 'shopify', :domain, :token, :scopes, 'active', "
                 ":installed, :synced)"),
            [
                {"id": store_a, "org": org_a, "domain": "staging-int-a.myshopify.com",
                 "token": TOKEN_A, "scopes": FULL_SCOPES,
                 "installed": now - timedelta(days=30), "synced": recent},
                # store_b intentionally carries NO granted scopes (the
                # production data gap): fresh syncs must still make it
                # healthy, and the gap must stay visible as a warning.
                {"id": store_b, "org": org_b, "domain": "staging-int-b.myshopify.com",
                 "token": TOKEN_B, "scopes": None,
                 "installed": now - timedelta(days=30), "synced": recent},
            ],
        )
        _seed_ledgers(connection, store_a, recent)
        _seed_ledgers(connection, store_b, recent)
        _seed_webhooks(connection, store_a, recent)
        _seed_webhooks(connection, store_b, recent)
        connection.execute(
            text("INSERT INTO intelligence_order_coverage (store_id, organization_id, "
                 "coverage_start, coverage_end, certified_at, source, source_run_id) "
                 "VALUES (:store, :org, :start, :end, now(), "
                 "'staging_integration_acceptance', 'staging-acceptance')"),
            [
                {"store": store_a, "org": org_a, "start": now - timedelta(days=30), "end": now},
                {"store": store_b, "org": org_b, "start": now - timedelta(days=30), "end": now},
            ],
        )

        # Scenario 1 — healthy store: explicit states, valid contract, no secrets.
        evidence = retrieve_integration_evidence(org_a, connection, now=now)
        assert evidence["overall_status"] == "healthy", evidence["overall_status"]
        assert len(evidence["items"]) > 0, "healthy store must emit items"
        problems = validate_collection(evidence["items"])
        assert problems == [], problems
        assert evidence["stores"][0]["connection"]["state"] == "authenticated"
        assert evidence["stores"][0]["webhooks"]["state"] == "healthy"
        assert _item(evidence["items"], "integration.health_overall")["value"] == "healthy"
        payload = json.dumps(evidence)
        assert TOKEN_A not in payload, "token value must never appear in evidence"
        assert TOKEN_B not in payload, "other org's token must never appear in evidence"
        assert store_b not in payload, "other org's store id must never appear in evidence"
        print(f"ok - healthy store: contract-valid items, no secrets ({len(evidence['items'])} items)")

        # Scenario 2 — tenant isolation + the unrecorded-scopes data gap.
        # store_b has granted_scopes = NULL: fresh syncs must still make it
        # healthy, and the gap must surface as a visible warning, never as a
        # false "unauthorized".
        other = retrieve_integration_evidence(org_b, connection, now=now)
        assert other["overall_status"] == "healthy", other["overall_status"]
        assert any("No granted Shopify scopes are recorded" in w
                   for w in other["stores"][0]["health"]["warnings"])
        assert store_a not in json.dumps(other), "org B evidence must not mention org A store"
        foreign = retrieve_integration_evidence(org_a, connection, store_id=store_b, now=now)
        assert foreign["overall_status"] == "disconnected", foreign["overall_status"]
        assert foreign["stores"] == []
        print("ok - tenant isolation: foreign org and store id invisible")

        # Scenario 3 — real failure visibility: fail the orders ledger.
        connection.execute(
            text("UPDATE store_sync_domain_states SET status = 'failed', "
                 "error_code = 'SHOPIFY_API 500', error_details = 'internal detail', "
                 "last_attempted_at = :at WHERE store_id = :store AND domain = 'orders'"),
            {"store": store_a, "at": recent},
        )
        degraded = retrieve_integration_evidence(org_a, connection, now=now)
        assert degraded["overall_status"] == "partially_operational", degraded["overall_status"]
        orders = _item(degraded["items"], "integration.resource", "orders")
        assert orders["value"] == "failed", orders["value"]
        store_view = degraded["stores"][0]
        assert any(f["resource_id"] == "orders" for f in store_view["health"]["critical_failures"])
        assert "internal detail" not in json.dumps(degraded), "error_details must never leak"
        print("ok - failed orders sync: partially_operational with named critical failure")
    finally:
        transaction.rollback()
        connection.close()

    print("staging integration acceptance: all scenarios passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
