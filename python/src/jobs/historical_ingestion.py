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
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from sqlalchemy import text

from .rfm_sync import run as run_rfm_sync

logger = logging.getLogger("rev.historical_ingestion")


class OptionalTableUnavailable(RuntimeError):
    """Raised when backend-owned Phase 2 persistence has not been migrated yet."""


def run_historical_ingestion(store_id: str, db, lookback_months: int = 12) -> dict:
    """Backfill RFM, baselines, strategic memories, and segment distribution.

    Each step is idempotent and commits independently. A failed step is rolled
    back before the next begins, so one optional backend table cannot poison the
    SQLAlchemy session or hide successful work from the other steps.
    """
    result = {
        "store_id": store_id,
        "customers_scored": 0,
        "strategic_memories_seeded": 0,
        "baseline_established": False,
        "status": "complete",
        "warnings": [],
    }

    if not isinstance(lookback_months, int) or not 1 <= lookback_months <= 60:
        result["status"] = "failed"
        result["warnings"].append("lookback_months must be an integer from 1 to 60.")
        return result

    logger.info(
        "historical_ingestion_start",
        extra={"store_id": store_id, "lookback_months": lookback_months},
    )

    completed = 0
    attempted = 4

    try:
        result["customers_scored"] = _backfill_rfm_scores(store_id)
        completed += 1
    except Exception as exc:
        _record_step_failure(db, result, "rfm_backfill_failed", exc)

    completed += _run_db_step(
        db,
        result,
        "baseline_failed",
        lambda: _establish_baselines(store_id, db, lookback_months),
        on_success=lambda _value: result.update(baseline_established=True),
    )

    completed += _run_db_step(
        db,
        result,
        "strategic_memory_seed_failed",
        lambda: _seed_strategic_memory(store_id, db, lookback_months),
        on_success=lambda value: result.update(strategic_memories_seeded=int(value)),
    )

    completed += _run_db_step(
        db,
        result,
        "segment_snapshot_failed",
        lambda: _snapshot_segment_distribution(store_id, db),
    )

    result["status"] = (
        "complete" if completed == attempted
        else "failed" if completed == 0
        else "partial"
    )
    logger.info(
        "historical_ingestion_complete",
        extra={
            "store_id": store_id,
            "status": result["status"],
            "customers_scored": result["customers_scored"],
            "strategic_memories_seeded": result["strategic_memories_seeded"],
            "baseline_established": result["baseline_established"],
            "warning_count": len(result["warnings"]),
        },
    )
    return result


def _run_db_step(
    db,
    result: dict,
    event_name: str,
    operation: Callable[[], Any],
    on_success: Callable[[Any], None] | None = None,
) -> int:
    try:
        value = operation()
        db.commit()
        if on_success:
            on_success(value)
        return 1
    except Exception as exc:
        _record_step_failure(db, result, event_name, exc)
        return 0


def _record_step_failure(db, result: dict, event_name: str, exc: Exception) -> None:
    try:
        db.rollback()
    except Exception:
        logger.exception("historical_ingestion_rollback_failed")
    logger.exception(event_name, extra={"error_type": type(exc).__name__})
    if isinstance(exc, OptionalTableUnavailable):
        result["warnings"].append(str(exc))
    else:
        result["warnings"].append(f"{event_name}: {type(exc).__name__}")


def _backfill_rfm_scores(store_id: str) -> int:
    summary = run_rfm_sync(store_id)
    failed_ids = summary.get("failed_customer_ids", [])
    if failed_ids:
        raise RuntimeError(f"RFM refresh failed for {len(failed_ids)} customers.")
    return int(summary.get("processed_count", 0))


def _establish_baselines(store_id: str, db, lookback_months: int) -> bool:
    if not _table_exists(db, "business_state_baselines"):
        raise OptionalTableUnavailable(
            "business_state_baselines is pending the backend Phase 2 migration."
        )

    organization_id = _get_organization_id(store_id, db)
    now = datetime.now(timezone.utc)
    cutoff_30d = now - timedelta(days=30)
    cutoff_90d = now - timedelta(days=90)
    observation_start = now - timedelta(days=lookback_months * 30)

    revenue_row = db.execute(
        text("""
            WITH daily_revenue AS (
                SELECT DATE(ordered_at AT TIME ZONE 'UTC') AS order_day,
                       SUM(total) AS revenue
                FROM orders
                WHERE store_id = :store_id
                  AND ordered_at >= :cutoff_90d
                GROUP BY DATE(ordered_at AT TIME ZONE 'UTC')
            )
            SELECT
                AVG(revenue) FILTER (WHERE order_day >= DATE(:cutoff_30d)),
                AVG(revenue)
            FROM daily_revenue
        """),
        {
            "store_id": store_id,
            "cutoff_30d": cutoff_30d,
            "cutoff_90d": cutoff_90d,
        },
    ).fetchone()

    cart_rate = db.execute(
        text("""
            SELECT
                COUNT(*) FILTER (WHERE status = 'abandoned')::float
                / NULLIF(COUNT(*), 0)
            FROM abandoned_carts
            WHERE store_id = :store_id
              AND abandoned_at >= :cutoff_30d
        """),
        {"store_id": store_id, "cutoff_30d": cutoff_30d},
    ).scalar()

    event_rate = db.execute(
        text("""
            SELECT COUNT(*)::float / (30 * 24 * 12)
            FROM events
            WHERE store_id = :store_id
              AND created_at >= :cutoff_30d
        """),
        {"store_id": store_id, "cutoff_30d": cutoff_30d},
    ).scalar()

    returning_rate = db.execute(
        text("""
            SELECT COUNT(*) FILTER (WHERE orders_count > 1)::float
                   / NULLIF(COUNT(*), 0)
            FROM customers
            WHERE store_id = :store_id
              AND status = 'active'
        """),
        {"store_id": store_id},
    ).scalar()

    weekday_rows = db.execute(
        text("""
            WITH daily_revenue AS (
                SELECT DATE(ordered_at AT TIME ZONE 'UTC') AS order_day,
                       SUM(total)::float AS revenue
                FROM orders
                WHERE store_id = :store_id
                  AND ordered_at >= :cutoff_90d
                GROUP BY DATE(ordered_at AT TIME ZONE 'UTC')
            )
            SELECT EXTRACT(DOW FROM order_day)::int AS day_of_week,
                   AVG(revenue), COALESCE(STDDEV_SAMP(revenue), 0), COUNT(*)
            FROM daily_revenue
            GROUP BY day_of_week
            ORDER BY day_of_week
        """),
        {"store_id": store_id, "cutoff_90d": cutoff_90d},
    ).fetchall()
    weekday_baseline = {
        str(int(row[0])): {
            "average_revenue": float(row[1] or 0),
            "stddev_revenue": float(row[2] or 0),
            "sample_days": int(row[3] or 0),
        }
        for row in weekday_rows
    }

    db.execute(
        text("""
            INSERT INTO business_state_baselines (
                id, organization_id, event_rate_5m_30d, revenue_avg_30d,
                revenue_avg_90d, cart_abandonment_rate_30d,
                returning_customer_rate_30d, day_of_week_baseline,
                seasonal_baseline, observation_started_at,
                observation_ended_at, computed_at, metadata,
                created_at, updated_at
            ) VALUES (
                :id, :organization_id, :event_rate, :revenue_30d,
                :revenue_90d, :cart_rate, :returning_rate,
                CAST(:weekday_baseline AS JSONB), '{}'::JSONB,
                :observation_start, :observation_end, :computed_at,
                CAST(:metadata AS JSONB), NOW(), NOW()
            )
            ON CONFLICT (organization_id) DO UPDATE SET
                event_rate_5m_30d = EXCLUDED.event_rate_5m_30d,
                revenue_avg_30d = EXCLUDED.revenue_avg_30d,
                revenue_avg_90d = EXCLUDED.revenue_avg_90d,
                cart_abandonment_rate_30d = EXCLUDED.cart_abandonment_rate_30d,
                returning_customer_rate_30d = EXCLUDED.returning_customer_rate_30d,
                day_of_week_baseline = EXCLUDED.day_of_week_baseline,
                observation_started_at = EXCLUDED.observation_started_at,
                observation_ended_at = EXCLUDED.observation_ended_at,
                computed_at = EXCLUDED.computed_at,
                metadata = EXCLUDED.metadata,
                updated_at = NOW()
        """),
        {
            "id": str(uuid.uuid4()),
            "organization_id": organization_id,
            "event_rate": float(event_rate or 0),
            "revenue_30d": float(revenue_row[0] or 0) if revenue_row else 0.0,
            "revenue_90d": float(revenue_row[1] or 0) if revenue_row else 0.0,
            "cart_rate": float(cart_rate or 0),
            "returning_rate": float(returning_rate or 0),
            "weekday_baseline": json.dumps(weekday_baseline),
            "observation_start": observation_start,
            "observation_end": now,
            "computed_at": now,
            "metadata": json.dumps({"store_id": store_id, "lookback_months": lookback_months}),
        },
    )
    return True


def _seed_strategic_memory(store_id: str, db, lookback_months: int) -> int:
    organization_id = _get_organization_id(store_id, db)
    cutoff = datetime.now(timezone.utc) - timedelta(days=lookback_months * 30)
    seeded = 0

    day_row = db.execute(
        text("""
            SELECT EXTRACT(DOW FROM ordered_at)::int AS day_of_week,
                   SUM(total) AS revenue
            FROM orders
            WHERE store_id = :store_id
              AND ordered_at >= :cutoff
            GROUP BY day_of_week
            ORDER BY revenue DESC
            LIMIT 1
        """),
        {"store_id": store_id, "cutoff": cutoff},
    ).fetchone()
    if day_row:
        days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
        day_name = days[int(day_row[0])]
        _upsert_memory(
            organization_id,
            db,
            "historical.best_revenue_day",
            {
                "day_of_week": day_name,
                "revenue": float(day_row[1] or 0),
                "insight": f"Historically, {day_name} generates the highest revenue.",
            },
        )
        seeded += 1

    if _table_exists(db, "order_items"):
        category_row = db.execute(
            text("""
                SELECT product_type, COUNT(*) AS item_count
                FROM order_items
                WHERE store_id = :store_id
                  AND ordered_at >= :cutoff
                  AND product_type IS NOT NULL
                GROUP BY product_type
                ORDER BY item_count DESC
                LIMIT 1
            """),
            {"store_id": store_id, "cutoff": cutoff},
        ).fetchone()
        if category_row:
            _upsert_memory(
                organization_id,
                db,
                "historical.best_product_category",
                {
                    "category": category_row[0],
                    "item_count": int(category_row[1]),
                    "insight": f"'{category_row[0]}' is the most frequently ordered category.",
                },
            )
            seeded += 1

    hour_row = db.execute(
        text("""
            SELECT EXTRACT(HOUR FROM abandoned_at)::int AS hour_utc,
                   COUNT(*) AS abandoned_count
            FROM abandoned_carts
            WHERE store_id = :store_id
              AND abandoned_at >= :cutoff
            GROUP BY hour_utc
            ORDER BY abandoned_count DESC
            LIMIT 1
        """),
        {"store_id": store_id, "cutoff": cutoff},
    ).fetchone()
    if hour_row:
        peak_hour = int(hour_row[0])
        _upsert_memory(
            organization_id,
            db,
            "historical.peak_abandonment_hour",
            {
                "hour_utc": peak_hour,
                "abandon_count": int(hour_row[1]),
                "insight": f"Cart abandonment peaks at {peak_hour:02d}:00 UTC.",
            },
        )
        seeded += 1

    return seeded


def _upsert_memory(organization_id: str, db, memory_key: str, payload: dict) -> None:
    db.execute(
        text("""
            INSERT INTO merchant_memories (
                id, organization_id, memory_type, memory_key, memory_value,
                memory_source, authority_level, confidence, importance,
                is_active, use_count, created_at, updated_at
            ) VALUES (
                :id, :organization_id, 'strategic', :memory_key,
                CAST(:memory_value AS JSONB), 'historical_ingestion',
                2, 0.8, 3, TRUE, 0, NOW(), NOW()
            )
            ON CONFLICT (organization_id, memory_key) DO UPDATE SET
                memory_value = EXCLUDED.memory_value,
                confidence = EXCLUDED.confidence,
                is_active = TRUE,
                updated_at = NOW()
        """),
        {
            "id": str(uuid.uuid4()),
            "organization_id": organization_id,
            "memory_key": memory_key,
            "memory_value": json.dumps(payload),
        },
    )


def _snapshot_segment_distribution(store_id: str, db) -> None:
    if not _table_exists(db, "business_state_baselines"):
        raise OptionalTableUnavailable(
            "business_state_baselines is pending the backend Phase 2 migration."
        )

    organization_id = _get_organization_id(store_id, db)
    rows = db.execute(
        text("""
            SELECT rfm_segment, COUNT(*)
            FROM customers
            WHERE store_id = :store_id
              AND rfm_segment IS NOT NULL
            GROUP BY rfm_segment
        """),
        {"store_id": store_id},
    ).fetchall()
    distribution = {str(row[0]): int(row[1]) for row in rows}

    updated = db.execute(
        text("""
            UPDATE business_state_baselines
            SET segment_distribution = CAST(:distribution AS JSONB),
                updated_at = NOW()
            WHERE organization_id = :organization_id
        """),
        {
            "distribution": json.dumps(distribution),
            "organization_id": organization_id,
        },
    )
    if getattr(updated, "rowcount", 0) == 0:
        raise RuntimeError("A baseline must be established before its segment snapshot.")


def _get_organization_id(store_id: str, db) -> str:
    organization_id = db.execute(
        text("SELECT organization_id FROM stores WHERE id = :store_id LIMIT 1"),
        {"store_id": store_id},
    ).scalar()
    if not organization_id:
        raise ValueError("Store does not exist or has no organisation.")
    return str(organization_id)


def _table_exists(db, table_name: str) -> bool:
    return bool(
        db.execute(
            text("SELECT to_regclass(:table_name) IS NOT NULL"),
            {"table_name": f"public.{table_name}"},
        ).scalar()
    )
