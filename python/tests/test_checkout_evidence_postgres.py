"""Disposable PostgreSQL execution of the Task 200 canonical SQL."""
import os
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from sqlalchemy import create_engine, text

from src.intelligence.checkout_evidence import retrieve_checkout_evidence
from src.intelligence.evidence import evidence_context

NOW = datetime(2026, 11, 7, 12, tzinfo=timezone.utc)
START = NOW - timedelta(days=7)


@pytest.fixture
def checkout_postgres():
    url = os.environ.get("TASK200_DATABASE_URL") or os.environ.get("TASK198_DATABASE_URL")
    if not url:
        pytest.skip("TASK200_DATABASE_URL is not configured; CI supplies disposable PostgreSQL.")
    schema = "task200_" + uuid.uuid4().hex
    admin = create_engine(url)
    with admin.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_engine(url, connect_args={"options": f"-csearch_path={schema}"})
    with engine.begin() as c:
        c.execute(text("""CREATE TABLE stores (id uuid PRIMARY KEY, organization_id uuid NOT NULL,
            platform text NOT NULL, status text NOT NULL, last_synced_at timestamptz)"""))
        c.execute(text("""CREATE TABLE abandoned_carts (
            id uuid PRIMARY KEY, store_id uuid NOT NULL, customer_id uuid, external_cart_id text,
            external_checkout_name text, source_resource text, source_state text NOT NULL DEFAULT 'available',
            source_created_at timestamptz, source_updated_at timestamptz, completed_at timestamptz,
            abandonment_observed_at timestamptz, retrieved_at timestamptz,
            source_checkout_id text, source_checkout_token text, source_cart_token text,
            cart_value numeric(10,2) NOT NULL, subtotal numeric(12,2), discount_amount numeric(12,2),
            tax_amount numeric(12,2), shipping_amount numeric(12,2), duties_amount numeric(12,2),
            taxes_included boolean, currency text, status text, abandoned_at timestamptz NOT NULL,
            recovered_at timestamptz, created_at timestamptz)"""))
        c.execute(text("""CREATE TABLE orders (id uuid PRIMARY KEY, store_id uuid NOT NULL,
            abandoned_cart_id uuid, external_order_id text, external_order_name text, ordered_at timestamptz)"""))
        c.execute(text("""CREATE TABLE order_checkout_reconciliation_cases (id uuid PRIMARY KEY,
            store_id uuid NOT NULL, order_id uuid, status text, source_identifier text)"""))
        c.execute(text("""CREATE TABLE abandoned_cart_items (id uuid PRIMARY KEY,
            abandoned_cart_id uuid NOT NULL, external_line_item_id text, external_product_id text,
            external_variant_id text, product_name text, variant_name text, sku text,
            quantity integer, price numeric(10,2), discounted_unit_price numeric(12,2),
            original_line_total numeric(12,2), discount_amount numeric(12,2),
            line_subtotal numeric(12,2), currency text)"""))
        c.execute(text("""CREATE TABLE store_sync_domain_states (store_id uuid NOT NULL,
            domain text NOT NULL, status text, pagination_complete boolean, records_discovered integer,
            last_succeeded_at timestamptz, last_checked_at timestamptz, error_code text, checkpoint json)"""))
    yield engine, schema
    engine.dispose()
    with admin.begin() as connection:
        connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
    admin.dispose()


def test_postgres_lifecycle_relationships_currency_and_tenant_isolation(checkout_postgres):
    engine, _schema = checkout_postgres
    org, other, store = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    completed, abandoned, pending, unavailable, outsider = [uuid.uuid4() for _ in range(5)]
    order = uuid.uuid4()
    with engine.begin() as c:
        c.execute(text("INSERT INTO stores VALUES (:id,:org,'shopify','active',:now)"),
                  [{"id": store, "org": org, "now": NOW}, {"id": uuid.uuid4(), "org": other, "now": NOW}])
        c.execute(text("""INSERT INTO abandoned_carts
            (id,store_id,external_cart_id,external_checkout_name,source_resource,source_state,
             source_created_at,completed_at,cart_value,subtotal,discount_amount,tax_amount,duties_amount,
             currency,status,abandoned_at,recovered_at,created_at)
            VALUES (:id,:store,:external,:name,:resource,:state,:created,:completed,75.50,70,5,10.5,0,
             'USD',:status,:created,:recovered,:created)"""), [
            {"id": completed, "store": store, "external": "1", "name": "#C1", "resource": "abandonedCheckouts", "state": "available", "created": START, "completed": None, "status": "recovered", "recovered": START + timedelta(days=1)},
            {"id": abandoned, "store": store, "external": "2", "name": "#C2", "resource": "abandonedCheckouts", "state": "available", "created": START + timedelta(days=1), "completed": None, "status": "abandoned", "recovered": None},
            {"id": pending, "store": store, "external": "3", "name": "#C3", "resource": "checkouts/create", "state": "available", "created": START + timedelta(days=2), "completed": None, "status": "pending", "recovered": None},
            {"id": unavailable, "store": store, "external": "4", "name": "#C4", "resource": "abandonedCheckouts", "state": "unavailable", "created": START + timedelta(days=3), "completed": None, "status": "abandoned", "recovered": None},
            {"id": outsider, "store": store, "external": "5", "name": "#OUT", "resource": "abandonedCheckouts", "state": "available", "created": START, "completed": None, "status": "abandoned", "recovered": None},
        ])
        # Move the final row to another tenant's store so it can never enter this result.
        other_store = c.execute(text("SELECT id FROM stores WHERE organization_id=:org"), {"org": other}).scalar()
        c.execute(text("UPDATE abandoned_carts SET store_id=:store WHERE id=:id"), {"store": other_store, "id": outsider})
        c.execute(text("INSERT INTO orders VALUES (:id,:store,:cart,'900','#900',:at)"),
                  {"id": order, "store": store, "cart": completed, "at": START + timedelta(days=1)})
        c.execute(text("""INSERT INTO abandoned_cart_items
            (id,abandoned_cart_id,external_line_item_id,external_product_id,external_variant_id,
             product_name,variant_name,sku,quantity,price,line_subtotal,currency)
            VALUES (:id,:cart,'line','product','variant','Historical product','Old size','OLD',2,50,70,'USD')"""),
                  {"id": uuid.uuid4(), "cart": abandoned})
        c.execute(text("""INSERT INTO store_sync_domain_states VALUES
            (:store,'abandoned_checkouts','ok',true,4,:now,:now,NULL,
             '{"unfiltered_root":true,"nested_complete":true,"scope_verified":true,"reconciliation_complete":true}')"""),
                  {"store": store, "now": NOW})
    with engine.connect() as db, evidence_context(str(org), [str(store)]):
        result = retrieve_checkout_evidence(str(org), db, start=START, end=NOW, now=NOW)
    metrics = {item["metric"]: item for item in result["items"]}
    assert metrics["observed_checkout_count"]["value"] == 4
    assert metrics["completed_checkout_count"]["value"] == 1
    assert metrics["completed_with_order_count"]["value"] == 1
    assert metrics["abandoned_checkout_count"]["value"] == 1
    assert metrics["unknown_lifecycle_count"]["value"] == 2
    assert metrics["source_unavailable_count"]["value"] == 1
    assert metrics["observed_checkout_completion_rate"]["value"] == 0.5
    assert metrics["abandoned_checkout_recorded_value"]["value"] == "75.50"
    assert metrics["abandoned_checkout_variant_lines"]["value"]["historical_skus"] == ["OLD"]
    assert "#OUT" not in str(result)
