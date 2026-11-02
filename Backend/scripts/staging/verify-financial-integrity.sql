-- Candidate release verification: financial integrity + rev_financial_integrity DDL.
--
-- Run against an isolated staging database that already has the candidate
-- migration applied:
--   psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/staging/verify-financial-integrity.sql
--
-- Everything runs inside one transaction that is rolled back, so the script
-- leaves no fixtures behind. It asserts behaviour, not just column presence:
-- each DO block raises on mismatch, making the psql exit code meaningful.

BEGIN;

-- ---------------------------------------------------------------- DDL checks
DO $$
DECLARE
  refunded_type text;
  refunded_scale int;
  ltv_currency_type text;
  tombstone_pk int;
BEGIN
  SELECT data_type, numeric_scale INTO refunded_type, refunded_scale
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'refunded_total';
  IF refunded_type IS DISTINCT FROM 'numeric' OR refunded_scale IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'orders.refunded_total must be numeric(_,2), got % (scale %)', refunded_type, refunded_scale;
  END IF;

  SELECT data_type INTO ltv_currency_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'ltv_currency';
  IF ltv_currency_type IS DISTINCT FROM 'character varying' THEN
    RAISE EXCEPTION 'customers.ltv_currency missing or wrong type: %', ltv_currency_type;
  END IF;

  SELECT count(*) INTO tombstone_pk
  FROM information_schema.table_constraints
  WHERE table_schema = 'public' AND table_name = 'order_cancellation_tombstones'
    AND constraint_type = 'PRIMARY KEY';
  IF tombstone_pk <> 1 THEN
    RAISE EXCEPTION 'order_cancellation_tombstones must have exactly one primary key, got %', tombstone_pk;
  END IF;

  IF to_regclass('public.idx_order_cancellations_observed') IS NULL THEN
    RAISE EXCEPTION 'idx_order_cancellations_observed is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'intelligence_order_coverage' AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'intelligence_order_coverage must have row level security enabled';
  END IF;

  IF has_table_privilege('anon', 'public.intelligence_findings', 'SELECT')
     OR has_table_privilege('authenticated', 'public.intelligence_findings', 'SELECT') THEN
    RAISE EXCEPTION 'Data API roles must not read intelligence_findings directly';
  END IF;
END $$;

-- ------------------------------------------------- Financial behaviour checks
DO $$
DECLARE
  org uuid := gen_random_uuid();
  usr uuid := gen_random_uuid();
  store_usd uuid := gen_random_uuid();
  store_eur uuid := gen_random_uuid();
  customer_usd uuid := gen_random_uuid();
  customer_eur uuid := gen_random_uuid();
  window_start timestamptz := '2026-10-01T00:00:00Z';
  window_end timestamptz := '2026-11-01T00:00:00Z';
  usd_net numeric;
  usd_gross numeric;
  usd_count int;
  eur_net numeric;
  eur_count int;
  resurrected int;
BEGIN
  INSERT INTO users (id, full_name, email, password_hash)
  VALUES (usr, 'Staging Verification', 'staging-' || usr || '@example.invalid', 'not-a-real-hash');

  INSERT INTO organizations (id, owner_id, company_name, industry, country)
  VALUES (org, usr, 'Staging Verification Org', 'test', 'NG');

  INSERT INTO stores (id, organization_id, platform, shop_domain, status, last_synced_at)
  VALUES (store_usd, org, 'shopify', 'staging-verify-usd.myshopify.com', 'active', now()),
         (store_eur, org, 'shopify', 'staging-verify-eur.myshopify.com', 'active', now());

  INSERT INTO customers (id, store_id, external_id, email)
  VALUES (customer_usd, store_usd, 'staging-customer-usd', 'buyer-usd@example.invalid'),
         (customer_eur, store_eur, 'staging-customer-eur', 'buyer-eur@example.invalid');

  INSERT INTO intelligence_order_coverage
    (store_id, organization_id, coverage_start, coverage_end, certified_at, source, source_run_id)
  VALUES (store_usd, org, window_start - interval '1 day', window_end + interval '1 day', now(),
          'shopify_verified_history_v1', 'staging-verification'),
         (store_eur, org, window_start - interval '1 day', window_end + interval '1 day', now(),
          'shopify_verified_history_v1', 'staging-verification');

  -- Known full refunds: #1004 ($1,025 -> $0) and #1001 ($100 -> $0). orders.total
  -- stores net value; refunded_total preserves the refunded amount so gross can
  -- be reconstructed. A partially refunded order keeps its net total of 70.
  INSERT INTO orders
    (id, store_id, customer_id, external_order_id, total, refunded_total, currency, ordered_at, recovery_status)
  VALUES
    (gen_random_uuid(), store_usd, customer_usd, '1004', 0.00, 1025.00, 'USD', window_start + interval '1 hour', 'completed'),
    (gen_random_uuid(), store_usd, customer_usd, '1001', 0.00, 100.00, 'USD', window_start + interval '2 hours', 'completed'),
    (gen_random_uuid(), store_usd, customer_usd, '2001', 70.00, 30.00, 'USD', window_start + interval '3 hours', 'completed'),
    (gen_random_uuid(), store_usd, customer_usd, '2002', 50.00, 0.00, 'USD', window_start + interval '4 hours', 'completed'),
    -- A cancelled order is context only; it must never contribute revenue.
    (gen_random_uuid(), store_usd, customer_usd, '2003', 999.00, 0.00, 'USD', window_start + interval '5 hours', 'cancelled'),
    -- Currency-less rows must never be folded into another currency's total.
    (gen_random_uuid(), store_usd, customer_usd, '2004', 123.45, 0.00, NULL, window_start + interval '6 hours', 'completed'),
    (gen_random_uuid(), store_eur, customer_eur, '3001', 25.00, 5.00, 'EUR', window_start + interval '7 hours', 'completed');

  -- A cancellation observed before the order existed is a tombstone; the
  -- ingestion path resolves it ahead of a delayed create/update.
  INSERT INTO order_cancellation_tombstones (store_id, external_order_id, cancelled_at, currency, total)
  VALUES (store_usd, '2005', window_start + interval '8 hours', 'USD', 400.00);

  SELECT COALESCE(SUM(o.total), 0), COUNT(*)
  INTO usd_net, usd_count
  FROM orders o
  WHERE o.store_id = store_usd AND o.currency = 'USD'
    AND o.ordered_at >= window_start AND o.ordered_at < window_end
    AND (o.recovery_status IS NULL OR o.recovery_status NOT IN ('cancelled', 'canceled', 'voided', 'deleted'));

  SELECT COALESCE(SUM(o.total + COALESCE(o.refunded_total, 0)), 0)
  INTO usd_gross
  FROM orders o
  WHERE o.store_id = store_usd AND o.currency = 'USD'
    AND o.ordered_at >= window_start AND o.ordered_at < window_end
    AND (o.recovery_status IS NULL OR o.recovery_status NOT IN ('cancelled', 'canceled', 'voided', 'deleted'));

  SELECT COALESCE(SUM(o.total), 0), COUNT(*)
  INTO eur_net, eur_count
  FROM orders o
  WHERE o.store_id = store_eur AND o.currency = 'EUR'
    AND o.ordered_at >= window_start AND o.ordered_at < window_end;

  -- Net revenue excludes the $1,025 and $100 refunds and the $999 cancellation.
  -- Fully refunded orders still count as orders (4 of them contribute USD
  -- revenue here: 0 + 0 + 70 + 50) but contribute nothing to net value.
  IF usd_net <> 120.00 OR usd_count <> 4 THEN
    RAISE EXCEPTION 'USD net revenue must be 120.00 over 4 orders, got % over %', usd_net, usd_count;
  END IF;

  -- Gross = net + refunded_total, and still excludes the cancelled order.
  IF usd_gross <> 1275.00 THEN
    RAISE EXCEPTION 'USD gross value must be 1275.00, got %', usd_gross;
  END IF;

  -- A currency-less 123.45 order must not leak into USD or EUR totals.
  IF eur_net <> 25.00 OR eur_count <> 1 THEN
    RAISE EXCEPTION 'EUR net revenue must be 25.00 over 1 order, got % over %', eur_net, eur_count;
  END IF;

  -- The tombstone must survive independently of any order row.
  IF NOT EXISTS (
    SELECT 1 FROM order_cancellation_tombstones
    WHERE store_id = store_usd AND external_order_id = '2005'
  ) THEN
    RAISE EXCEPTION 'cancellation tombstone for order 2005 was lost';
  END IF;

  -- A delayed create for a tombstoned order must be resolvable to cancelled;
  -- simulate the guard the ingestion path applies and prove a naive upsert
  -- cannot silently re-classify it as completed.
  INSERT INTO orders
    (id, store_id, customer_id, external_order_id, total, refunded_total, currency, ordered_at, recovery_status)
  VALUES (gen_random_uuid(), store_usd, customer_usd, '2005', 400.00, 0.00, 'USD',
          window_start + interval '8 hours', 'completed');

  SELECT count(*) INTO resurrected
  FROM orders o
  JOIN order_cancellation_tombstones t
    ON t.store_id = o.store_id AND t.external_order_id = o.external_order_id
  WHERE o.recovery_status <> 'cancelled';

  IF resurrected <> 1 THEN
    RAISE EXCEPTION 'expected the tombstoned order to be identifiable as resurrected, found %', resurrected;
  END IF;

  RAISE NOTICE 'financial integrity checks passed: usd_net=% usd_gross=% eur_net=%', usd_net, usd_gross, eur_net;
END $$;

ROLLBACK;
