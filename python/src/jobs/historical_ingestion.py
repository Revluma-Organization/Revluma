"""
Day 1 Cold-Start Historical Ingestion
=======================================
Runs once per store immediately after initial connection.
Scans the last N months of Shopify/WooCommerce order and customer
data and pre-populates all memory types so Rev starts smart.

Triggered by: POST /internal/sync/trigger (backend, after WooCommerce or Shopify sync)
Idempotent:   safe to re-run -- existing records are upserted, not duplicated.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import text

logger = logging.getLogger("rev.historical_ingestion")


def run_historical_ingestion(store_id: str, db, lookback_months: int = 12) -> dict:
    """
    Main entry point. Called once per store on Day 1.

    Runs four back-fill steps in order:
      1. RFM scoring for all existing customers
      2. Revenue and cart abandonment baseline computation
      3. Strategic Memory seeding (3 entries)
      4. Customer segment distribution snapshot

    Any single step may fail without aborting the others. The returned
    status reflects whether all, some, or none completed.

    Returns:
        dict -- summary:
        {
            "store_id": str,
            "customers_scored": int,
            "strategic_memories_seeded": int,
            "baseline_established": bool,
            "status": "complete" | "partial" | "failed"
        }
    """
    logger.info("historical_ingestion_start", extra={"store_id": store_id, "lookback_months": lookback_months})

    result = {
        "store_id": store_id,
        "customers_scored": 0,
        "strategic_memories_seeded": 0,
        "baseline_established": False,
        "status": "complete",
    }

    steps_completed = 0
    steps_total = 4

    try:
        result["customers_scored"] = _backfill_rfm_scores(store_id, db, lookback_months)
        steps_completed += 1
    except Exception as e:
        logger.error("rfm_backfill_failed", extra={"store_id": store_id, "error": str(e)}, exc_info=True)

    try:
        _establish_baselines(store_id, db, lookback_months)
        result["baseline_established"] = True
        steps_completed += 1
    except Exception as e:
        logger.error("baseline_failed", extra={"store_id": store_id, "error": str(e)}, exc_info=True)

    try:
        result["strategic_memories_seeded"] = _seed_strategic_memory(store_id, db, lookback_months)
        steps_completed += 1
    except Exception as e:
        logger.error("strategic_memory_seed_failed", extra={"store_id": store_id, "error": str(e)}, exc_info=True)

    try:
        _snapshot_segment_distribution(store_id, db)
        steps_completed += 1
    except Exception as e:
        logger.error("segment_snapshot_failed", extra={"store_id": store_id, "error": str(e)}, exc_info=True)

    if steps_completed == steps_total:
        result["status"] = "complete"
    elif steps_completed == 0:
        result["status"] = "failed"
    else:
        result["status"] = "partial"

    logger.info("historical_ingestion_complete", extra=result)
    return result


def _backfill_rfm_scores(store_id: str, db, lookback_months: int) -> int:
    cutoff = datetime.now(timezone.utc) - timedelta(days=lookback_months * 30)
    rows = db.execute(
        text("""
            SELECT c.id, MAX(o.created_at), COUNT(o.id), SUM(o.total_price)
            FROM customers c
            LEFT JOIN orders o ON o.customer_id = c.id
                               AND o.store_id = :store_id
                               AND o.created_at >= :cutoff
            WHERE c.store_id = :store_id
            GROUP BY c.id
        """),
        {"store_id": store_id, "cutoff": cutoff},
    ).fetchall()

    if not rows:
        return 0

    now = datetime.now(timezone.utc)
    scored = 0
    for row in rows:
        customer_id = str(row[0])
        last_order = row[1]
        order_count = int(row[2] or 0)
        total_spend = float(row[3] or 0)

        days_since = (now - last_order.replace(tzinfo=timezone.utc)).days if last_order else 999

        if days_since <= 30 and order_count >= 3 and total_spend >= 200:
            segment = "champion"
        elif days_since <= 60 and order_count >= 2:
            segment = "loyal"
        elif days_since > 180:
            segment = "at_risk"
        elif days_since > 365:
            segment = "lost"
        else:
            segment = "potential_loyalist"

        db.execute(
            text("UPDATE customers SET rfm_segment = :seg, rfm_updated_at = NOW() WHERE id = :cid AND store_id = :sid"),
            {"seg": segment, "cid": customer_id, "sid": store_id},
        )
        scored += 1

    db.commit()
    return scored


def _establish_baselines(store_id: str, db, lookback_months: int) -> None:
    cutoff_30d = datetime.now(timezone.utc) - timedelta(days=30)
    cutoff_90d = datetime.now(timezone.utc) - timedelta(days=90)

    row = db.execute(
        text("""
            SELECT
                AVG(CASE WHEN created_at >= :c30 THEN total_price END) AS rev_30d,
                AVG(CASE WHEN created_at >= :c90 THEN total_price END) AS rev_90d,
                COUNT(CASE WHEN created_at >= :c30 AND status = 'abandoned' THEN 1 END)::float
                    / NULLIF(COUNT(CASE WHEN created_at >= :c30 THEN 1 END), 0) AS abandon_rate
            FROM orders
            WHERE store_id = :sid
        """),
        {"sid": store_id, "c30": cutoff_30d, "c90": cutoff_90d},
    ).fetchone()

    db.execute(
        text("""
            INSERT INTO business_state_baselines (store_id, avg_revenue_30d, avg_revenue_90d, cart_abandonment_rate_30d, computed_at)
            VALUES (:sid, :r30, :r90, :cart, NOW())
            ON CONFLICT (store_id) DO UPDATE SET
                avg_revenue_30d           = EXCLUDED.avg_revenue_30d,
                avg_revenue_90d           = EXCLUDED.avg_revenue_90d,
                cart_abandonment_rate_30d = EXCLUDED.cart_abandonment_rate_30d,
                computed_at               = EXCLUDED.computed_at
        """),
        {"sid": store_id, "r30": float(row[0] or 0), "r90": float(row[1] or 0), "cart": float(row[2] or 0)},
    )
    db.commit()


def _seed_strategic_memory(store_id: str, db, lookback_months: int) -> int:
    cutoff = datetime.now(timezone.utc) - timedelta(days=lookback_months * 30)
    seeded = 0

    day_row = db.execute(
        text("""
            SELECT EXTRACT(DOW FROM created_at) AS dow, SUM(total_price) AS rev
            FROM orders WHERE store_id = :sid AND created_at >= :cutoff
            GROUP BY dow ORDER BY rev DESC LIMIT 1
        """),
        {"sid": store_id, "cutoff": cutoff},
    ).fetchone()
    if day_row:
        days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
        _upsert_memory(store_id, db, "best_revenue_day", {
            "day_of_week": days[int(day_row[0])],
            "avg_revenue": float(day_row[1]),
            "insight": f"Historically, {days[int(day_row[0])]} generates the highest revenue.",
        })
        seeded += 1

    cat_row = db.execute(
        text("""
            SELECT oi.product_type, COUNT(oi.id) AS cnt
            FROM order_items oi JOIN orders o ON o.id = oi.order_id
            WHERE o.store_id = :sid AND o.created_at >= :cutoff
            GROUP BY oi.product_type ORDER BY cnt DESC LIMIT 1
        """),
        {"sid": store_id, "cutoff": cutoff},
    ).fetchone()
    if cat_row:
        _upsert_memory(store_id, db, "best_product_category", {
            "category": cat_row[0],
            "order_count": int(cat_row[1]),
            "insight": f"'{cat_row[0]}' is the most frequently ordered product category.",
        })
        seeded += 1

    hour_row = db.execute(
        text("""
            SELECT EXTRACT(HOUR FROM created_at) AS hr, COUNT(*) AS cnt
            FROM orders WHERE store_id = :sid AND status = 'abandoned' AND created_at >= :cutoff
            GROUP BY hr ORDER BY cnt DESC LIMIT 1
        """),
        {"sid": store_id, "cutoff": cutoff},
    ).fetchone()
    if hour_row:
        peak = int(hour_row[0])
        _upsert_memory(store_id, db, "peak_abandonment_hour", {
            "hour_utc": peak,
            "abandon_count": int(hour_row[1]),
            "insight": f"Cart abandonment peaks at {peak:02d}:00 UTC.",
        })
        seeded += 1

    return seeded


def _upsert_memory(store_id: str, db, memory_type: str, payload: dict) -> None:
    db.execute(
        text("""
            INSERT INTO strategic_memory (store_id, memory_type, payload, created_at, updated_at)
            VALUES (:sid, :mt, :payload, NOW(), NOW())
            ON CONFLICT (store_id, memory_type) DO UPDATE SET
                payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at
        """),
        {"sid": store_id, "mt": memory_type, "payload": json.dumps(payload)},
    )
    db.commit()


def _snapshot_segment_distribution(store_id: str, db) -> None:
    rows = db.execute(
        text("""
            SELECT rfm_segment, COUNT(*) AS cnt
            FROM customers
            WHERE store_id = :sid AND rfm_segment IS NOT NULL
            GROUP BY rfm_segment
        """),
        {"sid": store_id},
    ).fetchall()

    for row in rows:
        db.execute(
            text("""
                INSERT INTO customer_segments (store_id, segment, customer_count, snapshotted_at)
                VALUES (:sid, :seg, :cnt, NOW())
                ON CONFLICT (store_id, segment) DO UPDATE SET
                    customer_count = EXCLUDED.customer_count,
                    snapshotted_at = EXCLUDED.snapshotted_at
            """),
            {"sid": store_id, "seg": row[0], "cnt": int(row[1])},
        )
    db.commit()
