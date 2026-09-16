"""Generate deterministic source-table SQL for the Rev Intelligence lab.

The generated SQL seeds only source data. After it is applied, the backend
must run RFM sync and the Business State rebuild endpoints so the same
production code path creates derived records.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path


STORE_NAME = "Lumé Skincare"
SHOP_DOMAIN = "lume-skincare.myshopify.com"
CANONICAL_SEED = 20260925
DEFAULT_CUSTOMER_COUNT = 10_200
DEFAULT_HISTORY_DAYS = 180
DEFAULT_RECENT_EVENT_COUNT = 120

PRODUCTS = [
    {"name": "Lumé Glow Serum 30ml", "price": 68.00, "weight": 0.43},
    {"name": "Lumé Hydra Moisturiser 50ml", "price": 52.00, "weight": 0.38},
    {"name": "Lumé Eye Revival Cream 15ml", "price": 44.00, "weight": 0.22},
    {"name": "Lumé Daily SPF 40 50ml", "price": 38.00, "weight": 0.35},
    {"name": "Lumé Brightening Mask 75ml", "price": 56.00, "weight": 0.45},
    {"name": "Lumé Starter Kit", "price": 89.00, "weight": 0.90},
    {"name": "Lumé Complete Routine Bundle", "price": 148.00, "weight": 1.40},
]
PRODUCT_WEIGHTS = [0.38, 0.20, 0.12, 0.10, 0.08, 0.07, 0.05]
CHANNELS = ["meta_ads", "google_ads", "email", "organic", "direct"]
CHANNEL_WEIGHTS = [0.38, 0.16, 0.22, 0.18, 0.06]
RFM_SEGMENTS = ["champion", "loyal", "at_risk", "hibernating", "lost"]
RFM_WEIGHTS = [12, 28, 22, 23, 15]
SCENARIOS = {
    "baseline",
    "mobile_checkout_failure",
    "ad_creative_fatigue",
    "discount_margin_erosion",
    "hero_product_collapse",
    "shipping_threshold_change",
    "vip_churn_signal",
}
PIPELINE_LIMITATIONS = {
    "mobile_checkout_failure": "device-level checkout completion is not in Business State",
    "ad_creative_fatigue": "campaign delivery and creative metrics are not in Business State",
    "discount_margin_erosion": "margin and discount-dependency aggregates are not in Business State",
    "hero_product_collapse": "product-level conversion is not in Business State",
    "shipping_threshold_change": "Business State can detect the cart spike but not its shipping cause",
}


def _validated_uuid(value: str, field_name: str) -> str:
    try:
        return str(uuid.UUID(value))
    except (AttributeError, TypeError, ValueError) as exc:
        raise ValueError(f"{field_name} must be a valid UUID.") from exc


def _scenario_rng(seed: int, scenario: str) -> random.Random:
    digest = hashlib.sha256(f"{seed}:{scenario}".encode("utf-8")).digest()
    return random.Random(int.from_bytes(digest[:8], "big"))


def _stable_uuid(namespace: uuid.UUID, label: str) -> str:
    return str(uuid.uuid5(namespace, label))


def _days_ago(
    as_of: datetime,
    rng: random.Random,
    days: int,
    jitter_hours: float = 0,
) -> datetime:
    return as_of - timedelta(days=days) + timedelta(
        hours=rng.uniform(-jitter_hours, jitter_hours)
    )


def _daily_revenue_target(
    day_offset: int,
    scenario: str,
    rng: random.Random,
    as_of: datetime,
) -> float:
    base = 1_733.0
    weekday = (as_of - timedelta(days=day_offset)).weekday()
    weekday_multiplier = {
        0: 0.90,
        1: 1.00,
        2: 1.05,
        3: 1.05,
        4: 1.10,
        5: 1.15,
        6: 1.12,
    }[weekday]
    growth_multiplier = 1.0 + (DEFAULT_HISTORY_DAYS - day_offset) * 0.001
    revenue = base * weekday_multiplier * growth_multiplier * rng.uniform(0.82, 1.18)

    if scenario == "mobile_checkout_failure" and day_offset <= 5:
        revenue *= 0.81
    elif scenario == "ad_creative_fatigue" and day_offset <= 7:
        revenue *= 0.86
    elif scenario == "discount_margin_erosion" and day_offset <= 21:
        revenue *= 1.08
    elif scenario == "hero_product_collapse" and day_offset <= 10:
        revenue *= 1 - 0.38 * 0.41
    elif scenario == "shipping_threshold_change" and day_offset <= 6:
        revenue *= 0.79
    return max(revenue, 0)


def _churn_tier(probability: float) -> str:
    if probability < 0.25:
        return "HEALTHY"
    if probability < 0.50:
        return "AT_RISK"
    if probability < 0.75:
        return "HIGH_RISK"
    return "CRITICAL"


def build_seed_sql(
    org_id: str,
    store_id: str,
    scenario: str = "baseline",
    *,
    seed: int = CANONICAL_SEED,
    as_of: datetime | None = None,
    customer_count: int = DEFAULT_CUSTOMER_COUNT,
    history_days: int = DEFAULT_HISTORY_DAYS,
    recent_event_count: int = DEFAULT_RECENT_EVENT_COUNT,
) -> str:
    """Build idempotent SQL compatible with the current Prisma/Python contracts."""
    org_id = _validated_uuid(org_id, "org_id")
    store_id = _validated_uuid(store_id, "store_id")
    if scenario not in SCENARIOS:
        raise ValueError(f"Unsupported scenario: {scenario}.")
    if customer_count < 1 or history_days < 30 or recent_event_count < 0:
        raise ValueError(
            "customer_count must be positive, history_days must be at least 30, "
            "and recent_event_count cannot be negative."
        )

    anchor = as_of or datetime.now(timezone.utc)
    if anchor.tzinfo is None:
        anchor = anchor.replace(tzinfo=timezone.utc)
    else:
        anchor = anchor.astimezone(timezone.utc)
    rng = _scenario_rng(seed, scenario)
    namespace = uuid.UUID(store_id)
    daily_targets = {
        day: _daily_revenue_target(day, scenario, rng, anchor)
        for day in range(history_days, -1, -1)
    }
    scenario_domain = (
        SHOP_DOMAIN
        if scenario == "baseline"
        else f"lume-{scenario.replace('_', '-')}.myshopify.com"
    )
    lines = [
        "BEGIN;",
        "",
        f"-- {STORE_NAME.upper()} — REVLUMA LAB SOURCE DATA ({scenario.upper()})",
        f"-- Generated at {anchor.isoformat()} with deterministic seed {seed}.",
        "-- The organization row must already exist; use a dedicated store UUID per scenario.",
        *(
            [f"-- Current limitation: {PIPELINE_LIMITATIONS[scenario]}."]
            if scenario in PIPELINE_LIMITATIONS
            else []
        ),
        "",
        "INSERT INTO stores",
        "  (id, organization_id, platform, shop_domain, status, installed_at, last_synced_at)",
        f"VALUES ('{store_id}', '{org_id}', 'shopify', '{scenario_domain}',",
        "  'connected', NOW() - INTERVAL '180 days', NOW())",
        "ON CONFLICT (id) DO UPDATE SET",
        "  organization_id = EXCLUDED.organization_id,",
        "  status = 'connected',",
        "  last_synced_at = NOW();",
        "",
        "-- Synthetic customers use reserved .test addresses and canonical labels.",
    ]

    customer_ids: list[str] = []
    vip_count = min(200, customer_count) if scenario == "vip_churn_signal" else 0
    for index in range(customer_count):
        customer_id = _stable_uuid(namespace, f"{scenario}:customer:{index}")
        customer_ids.append(customer_id)
        created_at = _days_ago(anchor, rng, rng.randint(5, history_days), 12)
        rfm_segment = rng.choices(RFM_SEGMENTS, weights=RFM_WEIGHTS)[0]
        churn_probability = round(rng.uniform(0.02, 0.90), 4)
        if index < vip_count:
            rfm_segment = "champion"
            churn_probability = round(rng.uniform(0.55, 0.78), 4)
        lines.extend(
            [
                "INSERT INTO customers",
                "  (id, store_id, external_id, email, full_name, ltv, orders_count,",
                "   rfm_segment, churn_probability, churn_tier, status, created_at)",
                f"VALUES ('{customer_id}', '{store_id}', 'LUME-{scenario}-{index:05d}',",
                f"  'customer{index}@lume-lab.test', 'Lumé Customer {index}', 0, 0,",
                f"  '{rfm_segment}', {churn_probability}, '{_churn_tier(churn_probability)}',",
                f"  'active', '{created_at.isoformat()}')",
                "ON CONFLICT (store_id, external_id) DO UPDATE SET",
                "  rfm_segment = EXCLUDED.rfm_segment,",
                "  churn_probability = EXCLUDED.churn_probability,",
                "  churn_tier = EXCLUDED.churn_tier,",
                "  status = 'active';",
            ]
        )

    lines.extend(["", "-- Completed orders across the requested history window."])
    order_index = 0
    non_vip_ids = customer_ids[vip_count:] or customer_ids
    for day in range(history_days, -1, -1):
        order_count = max(1, int(daily_targets[day] / 58))
        eligible_customers = (
            non_vip_ids
            if scenario == "vip_churn_signal" and day < 60
            else customer_ids
        )
        for _ in range(order_count):
            order_id = _stable_uuid(namespace, f"{scenario}:order:{order_index}")
            customer_id = rng.choice(eligible_customers)
            product = rng.choices(PRODUCTS, weights=PRODUCT_WEIGHTS)[0]
            channel = rng.choices(CHANNELS, weights=CHANNEL_WEIGHTS)[0]
            ordered_at = _days_ago(anchor, rng, day, 10)
            discount_fraction = 0.0
            if scenario == "discount_margin_erosion" and day <= 21:
                if rng.random() < 0.34:
                    discount_fraction = rng.uniform(0.10, 0.20)
            elif rng.random() < 0.12:
                discount_fraction = rng.uniform(0.05, 0.15)
            total = round(
                product["price"] * (1 - discount_fraction) * rng.uniform(0.9, 1.6),
                2,
            )
            subtotal = round(total / max(1 - discount_fraction, 0.01), 2)
            discount_amount = round(subtotal - total, 2)
            lines.extend(
                [
                    "INSERT INTO orders",
                    "  (id, store_id, customer_id, external_order_id, total, subtotal,",
                    "   discount_amount, coupon_used, attribution_channel, ordered_at, discount_pct)",
                    f"VALUES ('{order_id}', '{store_id}', '{customer_id}',",
                    f"  'LUME-{scenario}-{order_index:06d}', {total}, {subtotal},",
                    f"  {discount_amount}, {str(discount_fraction > 0).lower()}, '{channel}',",
                    f"  '{ordered_at.isoformat()}', {round(discount_fraction * 100, 2)})",
                    "ON CONFLICT (store_id, external_order_id) DO NOTHING;",
                ]
            )
            order_index += 1

    lines.extend(
        [
            "",
            "-- Keep customer aggregates consistent with the generated orders.",
            "UPDATE customers AS customer SET",
            "  orders_count = aggregate.order_count,",
            "  ltv = aggregate.lifetime_value",
            "FROM (",
            "  SELECT customer_id, COUNT(*)::integer AS order_count,",
            "         COALESCE(SUM(total), 0) AS lifetime_value",
            "  FROM orders",
            f"  WHERE store_id = '{store_id}'",
            "  GROUP BY customer_id",
            ") AS aggregate",
            "WHERE customer.id = aggregate.customer_id",
            f"  AND customer.store_id = '{store_id}';",
            "",
            "-- Abandoned carts cover the 30-day Business State baseline.",
        ]
    )
    cart_index = 0
    for day in range(min(30, history_days), -1, -1):
        cart_count = int(daily_targets[day] / 58 * 2.23)
        abandonment_rate = 0.69
        if scenario == "shipping_threshold_change" and day <= 6:
            cart_count = round(cart_count * 1.35)
            abandonment_rate = 0.84
        for _ in range(cart_count):
            cart_id = _stable_uuid(namespace, f"{scenario}:cart:{cart_index}")
            customer_id = rng.choice(customer_ids) if rng.random() > 0.3 else None
            value = (
                rng.uniform(28, 68)
                if scenario == "shipping_threshold_change" and day <= 6
                else rng.uniform(28, 220)
            )
            abandoned_at = _days_ago(anchor, rng, day, 10)
            status = "abandoned" if rng.random() < abandonment_rate else "recovered"
            customer_sql = f"'{customer_id}'" if customer_id else "NULL"
            lines.extend(
                [
                    "INSERT INTO abandoned_carts",
                    "  (id, store_id, customer_id, cart_value, currency, status, abandoned_at)",
                    f"VALUES ('{cart_id}', '{store_id}', {customer_sql},",
                    f"  {round(value, 2)}, 'USD', '{status}', '{abandoned_at.isoformat()}')",
                    "ON CONFLICT (id) DO NOTHING;",
                ]
            )
            cart_index += 1

    lines.extend(["", "-- Recent events drive the five-minute traffic signal."])
    for index in range(recent_event_count):
        event_id = _stable_uuid(namespace, f"{scenario}:event:{index}")
        created_at = anchor - timedelta(seconds=rng.uniform(0, 299))
        lines.extend(
            [
                "INSERT INTO events",
                "  (id, store_id, event_type, payload, created_at, source, source_event_id)",
                f"VALUES ('{event_id}', '{store_id}', 'page_view', '{{}}'::jsonb,",
                f"  '{created_at.isoformat()}', 'lab', 'LUME-{scenario}-{index:05d}')",
                "ON CONFLICT (store_id, source, source_event_id) DO NOTHING;",
            ]
        )

    recent_30 = list(daily_targets.values())[-min(30, len(daily_targets)) :]
    recent_90 = list(daily_targets.values())[-min(90, len(daily_targets)) :]
    average_30 = round(sum(recent_30) / len(recent_30), 2)
    average_90 = round(sum(recent_90) / len(recent_90), 2)
    weekday_baseline = {
        str(weekday): {
            "average_revenue": round(average_30 * multiplier, 2),
            "stddev_revenue": round(average_30 * 0.18, 2),
        }
        for weekday, multiplier in {
            0: 0.90,
            1: 1.00,
            2: 1.05,
            3: 1.05,
            4: 1.10,
            5: 1.15,
            6: 1.12,
        }.items()
    }
    weekday_json = json.dumps(weekday_baseline, separators=(",", ":"))
    seasonal_json = json.dumps(
        {"source": "synthetic_lab", "scenario": scenario},
        separators=(",", ":"),
    )
    lines.extend(
        [
            "",
            "-- Historical baseline used by the adaptive Business State builder.",
            "INSERT INTO business_state_baselines",
            "  (id, organization_id, event_rate_5m_30d, revenue_avg_30d,",
            "   revenue_avg_90d, cart_abandonment_rate_30d,",
            "   returning_customer_rate_30d, day_of_week_baseline,",
            "   seasonal_baseline, observation_started_at, observation_ended_at,",
            "   computed_at, next_rebuild_at)",
            f"VALUES ('{_stable_uuid(namespace, f'{scenario}:baseline')}', '{org_id}',",
            f"  {float(recent_event_count)}, {average_30}, {average_90}, 0.69, 0.38,",
            f"  '{weekday_json}'::jsonb, '{seasonal_json}'::jsonb,",
            f"  '{(anchor - timedelta(days=30)).isoformat()}', '{anchor.isoformat()}',",
            "  NOW(), NOW())",
            "ON CONFLICT (organization_id) DO UPDATE SET",
            "  event_rate_5m_30d = EXCLUDED.event_rate_5m_30d,",
            "  revenue_avg_30d = EXCLUDED.revenue_avg_30d,",
            "  revenue_avg_90d = EXCLUDED.revenue_avg_90d,",
            "  cart_abandonment_rate_30d = EXCLUDED.cart_abandonment_rate_30d,",
            "  returning_customer_rate_30d = EXCLUDED.returning_customer_rate_30d,",
            "  day_of_week_baseline = EXCLUDED.day_of_week_baseline,",
            "  seasonal_baseline = EXCLUDED.seasonal_baseline,",
            "  observation_started_at = EXCLUDED.observation_started_at,",
            "  observation_ended_at = EXCLUDED.observation_ended_at,",
            "  computed_at = NOW(),",
            "  next_rebuild_at = NOW();",
            "",
            "COMMIT;",
            "",
            "-- After this transaction commits, call these authenticated Python routes:",
            f"-- 1. POST /internal/rfm-sync {{\"store_id\":\"{store_id}\"}}",
            f"-- 2. POST /internal/business-state/rebuild {{\"organization_id\":\"{org_id}\"}}",
            "-- Do not insert business_states or alert_queue rows manually.",
        ]
    )
    return "\n".join(lines) + "\n"


def _parse_as_of(value: str | None) -> datetime | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed Lumé Skincare lab source data")
    parser.add_argument("--org-id", required=True, help="Existing organization UUID")
    parser.add_argument("--store-id", required=True, help="Lab store UUID")
    parser.add_argument("--scenario", default="baseline", choices=sorted(SCENARIOS))
    parser.add_argument("--seed", type=int, default=CANONICAL_SEED)
    parser.add_argument(
        "--as-of",
        help="Optional ISO-8601 anchor time for fully reproducible output",
    )
    parser.add_argument("--output", default="lume_seed.sql", help="Output SQL path")
    args = parser.parse_args()

    sql = build_seed_sql(
        args.org_id,
        args.store_id,
        args.scenario,
        seed=args.seed,
        as_of=_parse_as_of(args.as_of),
    )
    output_path = Path(args.output)
    output_path.write_text(sql, encoding="utf-8", newline="\n")
    print(f"Seed SQL written to {output_path}")
    print(f"Scenario : {args.scenario}")
    print(f"Org ID   : {args.org_id}")
    print(f"Store ID : {args.store_id}")
    print(f"Lines    : {len(sql.splitlines()):,}")
    if args.scenario in PIPELINE_LIMITATIONS:
        print(f"Warning  : {PIPELINE_LIMITATIONS[args.scenario]}.")


if __name__ == "__main__":
    main()
