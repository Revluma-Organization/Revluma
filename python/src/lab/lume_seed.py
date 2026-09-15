"""
Lumé Skincare — Revluma Lab Seed Script
Generates 6 months of realistic synthetic ecommerce data
for the Revluma Ecommerce Lab demonstration environment.

Run: python lume_seed.py --org-id <uuid> --store-id <uuid> --db-url <url>
"""

import argparse
import random
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

# ── Store profile ─────────────────────────────────────────────────────────────

STORE_NAME   = "Lumé Skincare"
SHOP_DOMAIN  = "lume-skincare.myshopify.com"
CURRENCY     = "USD"

PRODUCTS = [
    {"name": "Lumé Glow Serum 30ml",        "price": 68.00, "sku": "LGS-30",  "weight": 0.43},
    {"name": "Lumé Hydra Moisturiser 50ml",  "price": 52.00, "sku": "LHM-50",  "weight": 0.38},
    {"name": "Lumé Eye Revival Cream 15ml",  "price": 44.00, "sku": "LER-15",  "weight": 0.22},
    {"name": "Lumé Daily SPF 40 50ml",       "price": 38.00, "sku": "LSP-50",  "weight": 0.35},
    {"name": "Lumé Brightening Mask 75ml",   "price": 56.00, "sku": "LBM-75",  "weight": 0.45},
    {"name": "Lumé Starter Kit",             "price": 89.00, "sku": "LSK-01",  "weight": 0.90},
    {"name": "Lumé Complete Routine Bundle", "price": 148.00,"sku": "LCR-01",  "weight": 1.40},
]

# Revenue share per product (must sum to 1.0)
PRODUCT_WEIGHTS = [0.38, 0.20, 0.12, 0.10, 0.08, 0.07, 0.05]

CHANNELS = ["meta_ads", "google_ads", "email", "organic", "direct"]
CHANNEL_WEIGHTS = [0.38, 0.16, 0.22, 0.18, 0.06]

RFM_SEGMENTS = ["champions", "loyal", "at_risk", "new_customers",
                 "potential_loyalists", "cant_lose", "hibernating"]

def rand_uuid(): return str(uuid.uuid4())
def now_utc():   return datetime.now(timezone.utc)

def days_ago(n, jitter_hours=0):
    base = now_utc() - timedelta(days=n)
    return base + timedelta(hours=random.uniform(-jitter_hours, jitter_hours))

def clamp(val, lo, hi): return max(lo, min(hi, val))


# ── Revenue model ─────────────────────────────────────────────────────────────

def daily_revenue_target(day_offset: int, scenario: str = "baseline") -> float:
    """
    Returns target daily revenue for a given day (0 = today, 180 = 6 months ago).
    Applies scenario modifiers on top of the baseline.
    """
    # Base: $52k/month → ~$1,733/day
    base = 1_733.0

    # Day-of-week multiplier (weekends +15%, Monday -10%)
    dow = (now_utc() - timedelta(days=day_offset)).weekday()
    dow_mult = {0: 0.90, 1: 1.00, 2: 1.05, 3: 1.05, 4: 1.10, 5: 1.15, 6: 1.12}.get(dow, 1.0)

    # Natural growth trend (older days slightly lower)
    growth_mult = 1.0 + (180 - day_offset) * 0.001

    # Random daily variance ±18%
    noise = random.uniform(0.82, 1.18)

    revenue = base * dow_mult * growth_mult * noise

    # ── Scenario injections ───────────────────────────────────────────────────
    if scenario == "mobile_checkout_failure" and day_offset <= 5:
        # Mobile is ~55% of traffic; mobile conversion drops 34%
        # Net revenue impact: -(0.55 * 0.34) = -18.7%
        revenue *= 0.81

    elif scenario == "ad_creative_fatigue" and day_offset <= 7:
        # Meta traffic drops 38% (38% of channel mix * high fatigue)
        revenue *= 0.86

    elif scenario == "discount_margin_erosion":
        # Revenue grows 8% but margin shrinks (modelled in orders)
        if day_offset <= 21:
            revenue *= 1.08

    elif scenario == "hero_product_collapse" and day_offset <= 10:
        # Hero product (38% of revenue) conversion drops 41%
        revenue *= (1 - 0.38 * 0.41)

    elif scenario == "shipping_threshold_change" and day_offset <= 6:
        # Cart abandonment rises; checkout completion drops
        revenue *= 0.79

    return max(revenue, 0)


# ── SQL generation ────────────────────────────────────────────────────────────

def build_seed_sql(org_id: str, store_id: str, scenario: str = "baseline") -> str:
    lines = []

    # ── Organisation & Store (idempotent) ────────────────────────────────────
    lines.append(f"""
-- ════════════════════════════════════════════════════════════════════════════
-- LUMÉ SKINCARE — REVLUMA LAB SEED  ({scenario.upper()})
-- Generated: {now_utc().isoformat()}
-- ════════════════════════════════════════════════════════════════════════════

-- Store record (upsert — safe to re-run)
INSERT INTO stores (id, organization_id, platform, shop_domain, status, installed_at)
VALUES ('{store_id}', '{org_id}', 'shopify', '{SHOP_DOMAIN}', 'connected', NOW() - INTERVAL '180 days')
ON CONFLICT (organization_id, shop_domain) DO NOTHING;
""")

    # ── Customers (10,200 total) ──────────────────────────────────────────────
    lines.append("-- Customers")
    customer_ids = []
    for i in range(10_200):
        cid      = rand_uuid()
        customer_ids.append(cid)
        created  = days_ago(random.randint(5, 180), jitter_hours=12)
        orders_n = random.choices([1,2,3,4,5,6], weights=[45,25,14,8,5,3])[0]
        ltv      = round(random.uniform(42, 380) * orders_n * 0.6, 2)
        rfm_seg  = random.choices(RFM_SEGMENTS, weights=[12,18,14,22,16,8,10])[0]
        churn_p  = round(random.uniform(0.02, 0.65), 4)
        churn_t  = "high" if churn_p > 0.55 else "medium" if churn_p > 0.30 else "low"

        # Scenario 07: top 200 VIP customers show churn signal
        if scenario == "vip_churn_signal" and i < 200:
            churn_p = round(random.uniform(0.45, 0.72), 4)
            churn_t = "high"
            rfm_seg = "champions"

        lines.append(f"""INSERT INTO customers
  (id, store_id, external_id, email, full_name, ltv, orders_count,
   rfm_segment, churn_probability, churn_tier, status, created_at)
VALUES ('{cid}', '{store_id}', 'EXT-{i:05d}',
  'customer{i}@lume-lab.test', 'Lumé Customer {i}',
  {ltv}, {orders_n}, '{rfm_seg}', {churn_p}, '{churn_t}',
  'active', '{created.isoformat()}')
ON CONFLICT DO NOTHING;""")

    lines.append("")

    # ── Orders (≈5,400 over 180 days) ────────────────────────────────────────
    lines.append("-- Orders")
    order_count = 0
    for day in range(180, -1, -1):
        target   = daily_revenue_target(day, scenario)
        n_orders = max(1, int(target / 58))   # AOV ≈ $58

        for _ in range(n_orders):
            oid     = rand_uuid()
            cid     = random.choice(customer_ids)
            prod    = random.choices(PRODUCTS, weights=PRODUCT_WEIGHTS)[0]
            channel = random.choices(CHANNELS, weights=CHANNEL_WEIGHTS)[0]
            ordered = days_ago(day, jitter_hours=10)

            # Scenario 03: inflate discount usage
            disc_pct = 0.0
            coupon   = "false"
            if scenario == "discount_margin_erosion" and day <= 21:
                if random.random() < 0.34:
                    disc_pct = random.uniform(0.10, 0.20)
                    coupon   = "true"
            elif random.random() < 0.12:
                disc_pct = random.uniform(0.05, 0.15)
                coupon   = "true"

            total    = round(prod["price"] * (1 - disc_pct) * random.uniform(0.9, 1.6), 2)
            subtotal = round(total * 1.08, 2)

            lines.append(f"""INSERT INTO orders
  (id, store_id, customer_id, external_order_id, total, subtotal,
   discount_amount, coupon_used, attribution_channel, ordered_at, discount_pct)
VALUES ('{oid}', '{store_id}', '{cid}', 'LUME-{order_count:06d}',
  {total}, {subtotal}, {round(total * disc_pct, 2)}, {coupon},
  '{channel}', '{ordered.isoformat()}', {round(disc_pct * 100, 2)})
ON CONFLICT DO NOTHING;""")
            order_count += 1

    lines.append("")

    # ── Abandoned carts (abandonment rate 69%) ────────────────────────────────
    lines.append("-- Abandoned carts")
    for day in range(30, -1, -1):
        n_carts  = int(daily_revenue_target(day, scenario) / 58 * 2.23)  # 69% ABR
        for _ in range(n_carts):
            acid   = rand_uuid()
            cid    = random.choice(customer_ids) if random.random() > 0.3 else None
            value  = round(random.uniform(28, 220), 2)
            abnd   = days_ago(day, jitter_hours=10)
            status = "abandoned"

            # Scenario 06: spike abandonment when shipping threshold raised
            if scenario == "shipping_threshold_change" and day <= 6:
                value  = round(random.uniform(28, 68), 2)  # below new $75 threshold
                status = "abandoned"

            cid_val = f"'{cid}'" if cid else "NULL"
            lines.append(f"""INSERT INTO abandoned_carts
  (id, store_id, customer_id, cart_value, currency, status, abandoned_at)
VALUES ('{acid}', '{store_id}', {cid_val},
  {value}, 'USD', '{status}', '{abnd.isoformat()}')
ON CONFLICT DO NOTHING;""")

    lines.append("")

    # ── Business state snapshot ───────────────────────────────────────────────
    lines.append("-- Business state (current snapshot)")
    rev_today     = round(daily_revenue_target(0, scenario), 2)
    rev_yesterday = round(daily_revenue_target(1, scenario), 2)
    delta_pct     = round((rev_today - rev_yesterday) / max(rev_yesterday, 1) * 100, 2)
    trend_7d      = round(sum(daily_revenue_target(d, scenario) for d in range(7)) / 7, 2)
    anomaly       = abs(delta_pct) > 20
    cart_count    = random.randint(18, 65)
    cart_value    = round(cart_count * random.uniform(48, 95), 2)
    churn_count   = random.randint(8, 28)

    # Scenario-specific overrides
    if scenario == "mobile_checkout_failure":
        anomaly = True; delta_pct = -19.4
    elif scenario == "hero_product_collapse":
        anomaly = True; delta_pct = -15.6
    elif scenario == "shipping_threshold_change":
        anomaly = True; cart_count = 94; cart_value = round(cart_count * 52, 2)
    elif scenario == "vip_churn_signal":
        churn_count = 47

    lines.append(f"""
-- Expire previous state
UPDATE business_states
SET is_current = false
WHERE organization_id = '{org_id}' AND is_current = true;

INSERT INTO business_states
  (id, organization_id, is_current, schema_version, generated_at,
   revenue_today, revenue_yesterday, revenue_delta_pct, revenue_trend_7d,
   revenue_anomaly, abandoned_cart_count, abandoned_cart_value,
   churn_risk_count, computation_status)
VALUES
  ('{rand_uuid()}', '{org_id}', true, '1.0', NOW(),
   {rev_today}, {rev_yesterday}, {delta_pct}, {trend_7d},
   {str(anomaly).lower()}, {cart_count}, {cart_value},
   {churn_count}, 'complete');
""")

    return "\n".join(lines)


# ── CLI ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed Lumé Skincare lab data")
    parser.add_argument("--org-id",   required=True, help="Organization UUID")
    parser.add_argument("--store-id", required=True, help="Store UUID")
    parser.add_argument("--scenario", default="baseline",
        choices=["baseline","mobile_checkout_failure","ad_creative_fatigue",
                 "discount_margin_erosion","hero_product_collapse",
                 "shipping_threshold_change","vip_churn_signal"],
        help="Which scenario to inject")
    parser.add_argument("--output", default="lume_seed.sql",
        help="Output SQL file path")
    args = parser.parse_args()

    sql = build_seed_sql(args.org_id, args.store_id, args.scenario)

    with open(args.output, "w") as f:
        f.write(sql)

    print(f"Seed SQL written to {args.output}")
    print(f"Scenario : {args.scenario}")
    print(f"Org ID   : {args.org_id}")
    print(f"Store ID : {args.store_id}")
    print(f"Lines    : {len(sql.splitlines()):,}")