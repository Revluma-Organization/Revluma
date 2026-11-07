"""Disposable PostgreSQL validation for Task 202 finding/product evidence."""
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, text

from src.intelligence.evidence import evidence_context
from src.intelligence.finding_evidence import retrieve_finding_evidence
from src.intelligence.product_evidence import retrieve_product_evidence

NOW = datetime(2026, 11, 7, 12, tzinfo=timezone.utc)


@pytest.fixture
def task202_postgres():
    url = os.environ.get("TASK198_DATABASE_URL")
    if not url:
        pytest.skip("Disposable PostgreSQL is supplied by CI.")
    schema = "task202_" + uuid.uuid4().hex
    admin = create_engine(url)
    with admin.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_engine(url, connect_args={"options": f"-csearch_path={schema}"})
    with engine.begin() as db:
        db.execute(text("""
        CREATE TABLE stores(id uuid PRIMARY KEY,organization_id uuid NOT NULL,status text NOT NULL);
        CREATE TABLE intelligence_findings(
          id uuid PRIMARY KEY,organization_id uuid NOT NULL,store_id uuid NOT NULL,
          type text,severity text,status text,title text,description text,evidence jsonb,
          action jsonb,dedupe_key text,detected_at timestamptz,acknowledged_at timestamptz,
          resolved_at timestamptz,dismissed_at timestamptz,updated_at timestamptz);
        CREATE TABLE orders(id uuid PRIMARY KEY,store_id uuid NOT NULL,external_order_id text,
          external_order_name text,ordered_at timestamptz,total numeric,refunded_total numeric,
          currency text,recovery_status text);
        CREATE TABLE products(id uuid PRIMARY KEY,store_id uuid NOT NULL,external_id text,
          name text,type text,status text,vendor text,sku text,created_at timestamptz,
          updated_at timestamptz,created_at_auto timestamptz,updated_at_auto timestamptz,
          manage_stock boolean,stock_quantity integer,stock_status text);
        CREATE TABLE product_variants(id uuid PRIMARY KEY,store_id uuid NOT NULL,
          product_external_id text,external_id text,title text,sku text,barcode text,
          inventory_item_external_id text,price numeric,compare_at_price numeric,
          selected_options jsonb,position integer,tracked boolean,available_for_sale boolean,
          created_at timestamptz,updated_at timestamptz,synced_at timestamptz);
        CREATE TABLE inventory_items(id uuid PRIMARY KEY,store_id uuid NOT NULL,external_id text,
          sku text,tracked boolean);
        CREATE TABLE locations(id uuid PRIMARY KEY,store_id uuid NOT NULL,external_id text,
          name text,is_active boolean);
        CREATE TABLE inventory_levels(id uuid PRIMARY KEY,store_id uuid NOT NULL,
          inventory_item_external_id text,location_external_id text,quantities jsonb,
          synced_at timestamptz);
        CREATE TABLE store_sync_domain_states(id uuid PRIMARY KEY,store_id uuid NOT NULL,
          domain text,status text,pagination_complete boolean,last_succeeded_at timestamptz,
          error_code text);
        CREATE TABLE order_items(id uuid PRIMARY KEY,store_id uuid NOT NULL,order_id uuid NOT NULL,
          external_product_id text,external_variant_id text,ordered_at timestamptz,
          quantity integer,line_total numeric,product_name text);
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


def test_postgres_task202_direct_identity_and_cross_tenant_isolation(task202_postgres):
    db = task202_postgres
    org_a, org_b = str(uuid.uuid4()), str(uuid.uuid4())
    store_a, store_b = str(uuid.uuid4()), str(uuid.uuid4())
    finding_a, finding_b = str(uuid.uuid4()), str(uuid.uuid4())
    product_a, product_b = str(uuid.uuid4()), str(uuid.uuid4())
    variant_id, item_id, location_id, order_id, line_id = [str(uuid.uuid4()) for _ in range(5)]
    db.execute(text("INSERT INTO stores VALUES (:id,:org,'active')"), [
        {"id": store_a, "org": org_a}, {"id": store_b, "org": org_b}])
    evidence = {"verified": True, "complete": True, "currency": "USD", "currentCount": 1,
        "previousCount": 1, "currentRevenue": 10, "previousRevenue": 20,
        "currentStart": "2026-11-06T00:00:00Z", "currentEnd": "2026-11-07T00:00:00Z",
        "previousStart": "2026-11-05T00:00:00Z", "previousEnd": "2026-11-06T00:00:00Z",
        "coverage_source": "shopify_verified_history_v1", "coverage_run_id": "postgres-task202"}
    import json
    db.execute(text("""INSERT INTO intelligence_findings
      (id,organization_id,store_id,type,severity,status,title,description,evidence,action,
       detected_at,updated_at) VALUES (:id,:org,:store,'revenue_drop','high','open','Finding','Evidence',
       CAST(:evidence AS jsonb),'{}'::jsonb,:detected,:updated)"""), [
        {"id": finding_a, "org": org_a, "store": store_a, "evidence": json.dumps(evidence), "detected": NOW, "updated": NOW},
        {"id": finding_b, "org": org_b, "store": store_b, "evidence": json.dumps(evidence), "detected": NOW, "updated": NOW}])
    db.execute(text("""INSERT INTO orders VALUES
      (:id,:store,'order-a','#1001',:ordered,10,0,'USD','paid')"""),
      {"id": order_id, "store": store_a, "ordered": datetime(2026, 11, 6, 12, tzinfo=timezone.utc)})
    db.execute(text("""INSERT INTO products
      (id,store_id,external_id,name,type,status,vendor,sku,updated_at,manage_stock,stock_quantity,stock_status)
      VALUES (:id,:store,'shared-product','PostgreSQL product','Physical','ACTIVE','Vendor','BASE',:updated,true,0,'outofstock')"""), [
        {"id": product_a, "store": store_a, "updated": NOW}, {"id": product_b, "store": store_b, "updated": NOW}])
    db.execute(text("""INSERT INTO product_variants
      (id,store_id,product_external_id,external_id,title,sku,inventory_item_external_id,price,
       selected_options,position,tracked,available_for_sale,synced_at) VALUES
      (:id,:store,'shared-product','shared-variant','Small','SMALL','shared-item',10,'[]',1,true,true,:synced)"""),
      {"id": variant_id, "store": store_a, "synced": NOW})
    db.execute(text("INSERT INTO inventory_items VALUES (:id,:store,'shared-item','SMALL',true)"),
               {"id": item_id, "store": store_a})
    db.execute(text("INSERT INTO locations VALUES (:id,:store,'shared-location','Main',true)"),
               {"id": location_id, "store": store_a})
    db.execute(text("""INSERT INTO inventory_levels VALUES
      (:id,:store,'shared-item','shared-location',CAST(:quantities AS jsonb),:synced)"""),
      {"id": str(uuid.uuid4()), "store": store_a, "quantities": json.dumps({"available": 3}), "synced": NOW})
    for domain in ("products", "inventory_items", "inventory_levels", "locations"):
        db.execute(text("""INSERT INTO store_sync_domain_states VALUES
          (:id,:store,:domain,'ok',true,:synced,NULL)"""),
          {"id": str(uuid.uuid4()), "store": store_a, "domain": domain, "synced": NOW})
    db.execute(text("""INSERT INTO order_items VALUES
      (:id,:store,:order,'shared-product','shared-variant',:ordered,2,20,'PostgreSQL product')"""),
      {"id": line_id, "store": store_a, "order": order_id, "ordered": NOW-timedelta(hours=2)})
    with evidence_context(org_a, [store_a]):
        finding = retrieve_finding_evidence(org_a, db, now=NOW, finding_reference=finding_a)
        forbidden = retrieve_finding_evidence(org_a, db, now=NOW, finding_reference=finding_b)
        product = retrieve_product_evidence(org_a, db, start=NOW-timedelta(days=7), end=NOW,
                                           now=NOW, product_reference="shared-product")
    assert finding["items"][0]["value"]["underlying_order_records"][0]["order_name"] == "#1001"
    assert not forbidden["items"]
    record = product["items"][0]["value"]
    assert record["variants"][0]["inventory_levels"][0]["quantities"] == {"available": 3}
    assert record["order_line_evidence"][0]["recorded_line_value"] == "20"
    assert record["store_id"] == store_a
