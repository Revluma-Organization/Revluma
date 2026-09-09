"""
Rev Intelligence — Business State Builder
Queries real commerce data for an organisation and computes a structured
BusinessState that every specialist agent reads from. No agent queries the
database directly during a conversation — they all reason from this object.

Rebuilt every 15 minutes by the scheduler. On-demand rebuild triggered by
the Orchestrator when the state is stale.

Pipeline:
    build_business_state(org_id, db)
        → query orders, customers, carts, sequences
        → compute metrics, signals, opportunities, risks
        → write to business_states table (set old is_current=FALSE, insert new)
        → return BusinessState
"""

from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import bindparam, text

logger = logging.getLogger("rev.business_state")

SCHEMA_VERSION = "1.1"
DEFAULT_STALENESS_MINS = 30
VIP_INACTIVE_DAYS = 45
LTV_THRESHOLDS = (100.0, 500.0, 1000.0, 2500.0)
LTV_APPROACH_BAND = 0.15
CUSTOMER_CONTEXT_LIMIT = 500


def _store_query(statement: str):
    """Build a statement with a safely expanding store ID parameter."""
    return text(statement).bindparams(bindparam("store_ids", expanding=True))


def _table_exists(db, table_name: str) -> bool:
    """Allow Python to deploy before the matching backend migration is applied."""
    return bool(
        db.execute(
            text("SELECT to_regclass(:table_name) IS NOT NULL"),
            {"table_name": f"public.{table_name}"},
        ).scalar()
    )


def _rollback_quietly(db) -> None:
    try:
        db.rollback()
    except Exception:
        logger.exception("business_state_rollback_failed")


def _json_value(value: Any, default: Any) -> Any:
    if value is None:
        return default
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (TypeError, ValueError):
            return default
    return value


def _load_customer_ml_signals(db, store_params: dict[str, Any]) -> dict[str, Any]:
    """Build the bounded, PII-free customer context used by specialist agents."""
    threshold_rows = ", ".join(
        f"(:ltv_{index})" for index in range(len(LTV_THRESHOLDS))
    )
    statement = _store_query(f"""
        WITH customer_activity AS (
            SELECT
                c.id AS customer_id,
                c.rfm_segment,
                COALESCE(c.orders_count, 0) AS past_orders_total,
                COALESCE(c.ltv, 0) AS ltv,
                GREATEST(
                    COALESCE(c.ltv, 0) - COALESCE(latest.total, 0),
                    0
                ) AS previous_ltv,
                CASE
                    WHEN latest.ordered_at IS NULL THEN NULL
                    ELSE FLOOR(
                        EXTRACT(EPOCH FROM (NOW() - latest.ordered_at)) / 86400
                    )::integer
                END AS days_inactive
            FROM customers c
            LEFT JOIN LATERAL (
                SELECT o.total, o.ordered_at
                FROM orders o
                WHERE o.customer_id = c.id
                  AND o.store_id = c.store_id
                ORDER BY o.ordered_at DESC, o.id DESC
                LIMIT 1
            ) latest ON TRUE
            WHERE c.store_id IN :store_ids
              AND c.status = 'active'
        )
        SELECT
            customer_id,
            rfm_segment,
            past_orders_total,
            ltv,
            previous_ltv,
            days_inactive
        FROM customer_activity activity
        WHERE (
            activity.rfm_segment = 'champion'
            AND activity.days_inactive >= :vip_days
        )
        OR activity.past_orders_total = 1
        OR EXISTS (
            SELECT 1
            FROM (VALUES {threshold_rows}) AS thresholds(value)
            WHERE (
                activity.ltv >= thresholds.value * :approach_floor
                AND activity.ltv < thresholds.value
            )
            OR (
                activity.previous_ltv < thresholds.value
                AND activity.ltv >= thresholds.value
            )
        )
        ORDER BY
            CASE
                WHEN activity.rfm_segment = 'champion'
                     AND activity.days_inactive >= :vip_days THEN 0
                WHEN activity.past_orders_total = 1 THEN 1
                ELSE 2
            END,
            activity.ltv DESC,
            activity.customer_id
        LIMIT :context_limit
    """)
    params = {
        **store_params,
        "vip_days": VIP_INACTIVE_DAYS,
        "approach_floor": 1 - LTV_APPROACH_BAND,
        "context_limit": CUSTOMER_CONTEXT_LIMIT,
        **{
            f"ltv_{index}": threshold
            for index, threshold in enumerate(LTV_THRESHOLDS)
        },
    }
    rows = db.execute(statement, params).mappings().all()
    customers = [
        {
            "customer_id": str(row["customer_id"]),
            "rfm_segment": row["rfm_segment"],
            "past_orders_total": int(row["past_orders_total"] or 0),
            "ltv": float(row["ltv"] or 0),
            "previous_ltv": float(row["previous_ltv"] or 0),
            "days_inactive": (
                int(row["days_inactive"])
                if row["days_inactive"] is not None
                else None
            ),
        }
        for row in rows
    ]
    return {
        "customers": customers,
        "limit": CUSTOMER_CONTEXT_LIMIT,
        "truncated": len(customers) == CUSTOMER_CONTEXT_LIMIT,
    }


# ── BusinessState dataclass 

@dataclass
class BusinessState:
    # Identity
    id: str
    organization_id: str
    schema_version: str
    generated_at: datetime
    data_freshness_at: datetime | None
    staleness_threshold_mins: int
    computation_status: str          # complete | partial | failed
    warnings: list[str]

    # Structured metric columns (fast queries)
    revenue_today: Decimal | None
    revenue_yesterday: Decimal | None
    revenue_delta_pct: float | None
    revenue_trend_7d: float | None
    revenue_anomaly: bool
    abandoned_cart_count: int | None
    abandoned_cart_value: Decimal | None
    cart_anomaly: bool
    churn_risk_count: int | None
    vip_inactive_count: int | None
    returning_customer_rate: float | None
    returning_customer_rate_delta: float | None

    # JSONB intelligence payloads
    opportunities: list[dict]
    risks: list[dict]
    anomalies: list[dict]
    trends: list[dict]
    ml_signals: dict
    inventory_signals: dict
    anomaly_severity: str
    root_causes: list[str]
    current_event_rate: float
    baseline_event_rate: float
    next_rebuild_at: datetime
    cart_delta_pct_vs_avg: float | None = None

    def is_stale(self) -> bool:
        age_secs = (datetime.now(timezone.utc) - self.generated_at).total_seconds()
        return age_secs > self.staleness_threshold_mins * 60

    def age_minutes(self) -> float:
        return (datetime.now(timezone.utc) - self.generated_at).total_seconds() / 60

    def to_dict(self) -> dict:
        revenue_today = float(self.revenue_today) if self.revenue_today is not None else None
        revenue_yesterday = (
            float(self.revenue_yesterday) if self.revenue_yesterday is not None else None
        )
        abandoned_cart_value = (
            float(self.abandoned_cart_value)
            if self.abandoned_cart_value is not None
            else None
        )
        revenue_severity = "low"
        if self.revenue_anomaly:
            revenue_severity = (
                "high" if abs(self.revenue_delta_pct or 0.0) >= 30 else "med"
            )

        state = {
            "id": self.id,
            "organization_id": self.organization_id,
            "schema_version": self.schema_version,
            "generated_at": self.generated_at.isoformat(),
            "data_freshness_at": self.data_freshness_at.isoformat() if self.data_freshness_at else None,
            "staleness_threshold_mins": self.staleness_threshold_mins,
            "computation_status": self.computation_status,
            "warnings": self.warnings,
            "next_rebuild_at": self.next_rebuild_at.isoformat(),
            "sales_health": {
                "revenue_today": revenue_today,
                "revenue_yesterday": revenue_yesterday,
                "revenue_delta_pct": self.revenue_delta_pct,
                "revenue_trend_7d": self.revenue_trend_7d,
                "revenue_anomaly": self.revenue_anomaly,
                "abandoned_cart_count": self.abandoned_cart_count,
                "abandoned_cart_value": abandoned_cart_value,
                "cart_anomaly": self.cart_anomaly,
            },
            "customer_health": {
                "churn_risk_count": self.churn_risk_count,
                "vip_inactive_count": self.vip_inactive_count,
                "returning_customer_rate": self.returning_customer_rate,
                "returning_customer_rate_delta": self.returning_customer_rate_delta,
            },
            "inventory_health": self.inventory_signals,
            "anomaly_summary": {
                "severity": self.anomaly_severity,
                "items": self.anomalies,
                "root_causes": self.root_causes,
            },
            "traffic": {
                "current_event_rate_5m": self.current_event_rate,
                "baseline_event_rate_5m_30d": self.baseline_event_rate,
            },
            "opportunities": self.opportunities,
            "risks": self.risks,
            "trends": self.trends,
            "ml_signals": self.ml_signals,
            # Exact D6 assignment contract. Existing keys below remain for
            # consumers that adopted the richer 1.1 representation.
            "snapshot_at": self.generated_at.isoformat(),
            "merchant_id": self.organization_id,
            "revenue": {
                "today": revenue_today,
                "yesterday": revenue_yesterday,
                "delta_pct": self.revenue_delta_pct,
                "trend_7d": self.revenue_trend_7d,
                "anomaly": self.revenue_anomaly,
                "severity": revenue_severity,
            },
            "abandoned_carts": {
                "count": self.abandoned_cart_count,
                "value": abandoned_cart_value,
                "delta_pct_vs_avg": self.cart_delta_pct_vs_avg,
                "anomaly": self.cart_anomaly,
            },
            "customers": {
                "at_churn_risk": self.churn_risk_count,
                "vip_inactive_45d": self.vip_inactive_count,
                "returning_rate_delta": self.returning_customer_rate_delta,
            },
            "inventory": self.inventory_signals,
            "ml_outputs": self.ml_signals,
            "top_opportunities": self.opportunities,
            "active_concerns": self.risks,
        }

        # Boundary compatibility for consumers that still read the 1.0 flat keys.
        state.update({
            "revenue_today": revenue_today,
            "revenue_yesterday": revenue_yesterday,
            "revenue_delta_pct": self.revenue_delta_pct,
            "revenue_trend_7d": self.revenue_trend_7d,
            "revenue_anomaly": self.revenue_anomaly,
            "abandoned_cart_count": self.abandoned_cart_count,
            "abandoned_cart_value": abandoned_cart_value,
            "cart_anomaly": self.cart_anomaly,
            "churn_risk_count": self.churn_risk_count,
            "vip_inactive_count": self.vip_inactive_count,
            "returning_customer_rate": self.returning_customer_rate,
            "anomalies": self.anomalies,
        })
        return state


# ── Main builder 

def build_business_state(organization_id: str, db) -> BusinessState:
    """
    Builds a complete BusinessState for an organisation from real database data.

    Resilient to partial failures: if one data source fails, the state is
    marked partial and the failed section is None with a warning. The old
    current state is never overwritten until the new one is fully computed.

    Args:
        organization_id: The organisation's UUID string.
        db: SQLAlchemy connection or session.

    Returns:
        BusinessState — always. Never raises to caller.
    """
    state_id = str(uuid.uuid4())
    generated_at = datetime.now(timezone.utc)
    warnings: list[str] = []
    computation_status = "complete"
    previous_state = load_current_business_state(organization_id, db)

    logger.info("business_state_build_start", extra={
        "org_id": organization_id,
        "state_id": state_id,
    })

    # ── 1. Get stores for this organisation 
    try:
        stores_result = db.execute(
            text("""
                SELECT id, last_synced_at
                FROM stores
                WHERE organization_id = :org_id
                  AND status = 'connected'
                ORDER BY last_synced_at DESC NULLS LAST
            """),
            {"org_id": organization_id},
        ).fetchall()
        store_ids = [str(r[0]) for r in stores_result]
        last_synced_at = stores_result[0][1] if stores_result else None
    except Exception as exc:
        logger.exception(
            "business_state_stores_failed",
            extra={"org_id": organization_id, "error_type": type(exc).__name__},
        )
        _rollback_quietly(db)
        store_ids = []
        last_synced_at = None
        warnings.append("Could not load store data.")

    if not store_ids:
        warnings.append("No connected stores found. Business metrics unavailable.")
        if previous_state:
            previous_state.warnings.extend(warnings)
            previous_state.computation_status = "partial"
            return previous_state
        return _empty_state(state_id, organization_id, generated_at, warnings)

    store_params = {"store_ids": tuple(store_ids)}

    baseline: dict[str, Any] = {}
    baseline_table_available = False
    try:
        baseline_table_available = _table_exists(db, "business_state_baselines")
        if baseline_table_available:
            baseline_row = db.execute(
                text("""
                    SELECT event_rate_5m_30d, revenue_avg_30d,
                           cart_abandonment_rate_30d,
                           returning_customer_rate_30d,
                           day_of_week_baseline, seasonal_baseline
                    FROM business_state_baselines
                    WHERE organization_id = :org_id
                    LIMIT 1
                """),
                {"org_id": organization_id},
            ).mappings().first()
            baseline = dict(baseline_row) if baseline_row else {}
    except Exception as exc:
        logger.exception(
            "business_state_baseline_load_failed",
            extra={"org_id": organization_id, "error_type": type(exc).__name__},
        )
        _rollback_quietly(db)
        baseline_table_available = False
        warnings.append("Historical anomaly baseline is temporarily unavailable.")
        computation_status = "partial"

    current_event_rate = 0.0
    try:
        event_count = db.execute(
            _store_query("""
                SELECT COUNT(*)
                FROM events
                WHERE store_id IN :store_ids
                  AND created_at >= NOW() - INTERVAL '5 minutes'
            """),
            store_params,
        ).scalar()
        current_event_rate = float(event_count or 0)
    except Exception as exc:
        logger.exception(
            "business_state_event_rate_failed",
            extra={"org_id": organization_id, "error_type": type(exc).__name__},
        )
        _rollback_quietly(db)
        warnings.append("Current event rate could not be computed.")
        computation_status = "partial"

    baseline_event_rate = float(baseline.get("event_rate_5m_30d") or 0)
    next_interval = _get_next_rebuild_interval(current_event_rate, baseline_event_rate)
    next_rebuild_at = generated_at + next_interval
    staleness_threshold_mins = max(1, int(next_interval.total_seconds() / 60))

    # ── 2. Revenue metrics 
    revenue_today = None
    revenue_yesterday = None
    revenue_delta_pct = None
    revenue_trend_7d = None
    revenue_anomaly = False

    try:
        today = generated_at.date()
        yesterday = today - timedelta(days=1)
        seven_days_ago = today - timedelta(days=7)
        fourteen_days_ago = today - timedelta(days=14)

        rev_result = db.execute(
            _store_query("""
                SELECT
                    DATE(ordered_at AT TIME ZONE 'UTC') as order_date,
                    SUM(total) as daily_revenue,
                    COUNT(*) as order_count,
                    AVG(total) as avg_order_value
                FROM orders
                WHERE store_id IN :store_ids
                  AND ordered_at >= :cutoff
                GROUP BY DATE(ordered_at AT TIME ZONE 'UTC')
                ORDER BY order_date DESC
            """),
            {**store_params, "cutoff": fourteen_days_ago},
        ).fetchall()

        daily = {str(r[0]): {"revenue": Decimal(str(r[1])), "orders": r[2], "aov": Decimal(str(r[3]))} for r in rev_result}

        revenue_today = daily.get(str(today), {}).get("revenue", Decimal("0"))
        revenue_yesterday = daily.get(str(yesterday), {}).get("revenue", Decimal("0"))

        if revenue_yesterday and revenue_yesterday > 0:
            revenue_delta_pct = float((revenue_today - revenue_yesterday) / revenue_yesterday * 100)

        # 7d trend: compare last 7 days vs prior 7 days
        recent_7d = sum(v["revenue"] for k, v in daily.items() if str(seven_days_ago) <= k <= str(today))
        prior_7d  = sum(v["revenue"] for k, v in daily.items() if str(fourteen_days_ago) <= k < str(seven_days_ago))
        if prior_7d and prior_7d > 0:
            revenue_trend_7d = float((recent_7d - prior_7d) / prior_7d * 100)

        weekday_baselines = _json_value(baseline.get("day_of_week_baseline"), {})
        weekday_baseline = weekday_baselines.get(str(today.weekday()), {})
        expected_revenue = float(weekday_baseline.get("average_revenue") or 0)
        revenue_stddev = float(weekday_baseline.get("stddev_revenue") or 0)
        if expected_revenue > 0:
            baseline_delta = abs(float(revenue_today) - expected_revenue)
            revenue_anomaly = (
                baseline_delta > 2 * revenue_stddev
                if revenue_stddev > 0
                else baseline_delta / expected_revenue > 0.30
            )
        elif revenue_delta_pct is not None:
            revenue_anomaly = revenue_delta_pct < -20 or revenue_delta_pct > 50

    except Exception as exc:
        logger.exception(
            "business_state_revenue_failed",
            extra={"org_id": organization_id, "error_type": type(exc).__name__},
        )
        _rollback_quietly(db)
        warnings.append("Revenue metrics could not be computed.")
        computation_status = "partial"

    # ── 3. Cart abandonment metrics 
    abandoned_cart_count = None
    abandoned_cart_value = None
    cart_anomaly = False
    cart_delta_pct_vs_avg = None

    try:
        cart_result = db.execute(
            _store_query("""
                SELECT
                    COUNT(*) as abandoned_count,
                    COALESCE(SUM(cart_value), 0) as total_value
                FROM abandoned_carts
                WHERE store_id IN :store_ids
                  AND status = 'abandoned'
                  AND abandoned_at >= NOW() - INTERVAL '48 hours'
            """),
            store_params,
        ).fetchone()

        abandoned_cart_count = int(cart_result[0])
        abandoned_cart_value = Decimal(str(cart_result[1]))

        average_abandonment_rate = baseline.get("cart_abandonment_rate_30d")
        if average_abandonment_rate is None:
            cart_rate_result = db.execute(
                _store_query("""
                    SELECT
                        COUNT(CASE WHEN status = 'abandoned' THEN 1 END) as abandoned,
                        COUNT(*) as total
                    FROM abandoned_carts
                    WHERE store_id IN :store_ids
                      AND abandoned_at >= NOW() - INTERVAL '30 days'
                """),
                store_params,
            ).fetchone()
            if cart_rate_result and cart_rate_result[1] > 0:
                average_abandonment_rate = cart_rate_result[0] / cart_rate_result[1]

        if average_abandonment_rate is not None:
            today_cart_result = db.execute(
                _store_query("""
                    SELECT
                        COUNT(CASE WHEN status = 'abandoned' THEN 1 END) as abandoned,
                        COUNT(*) as total
                    FROM abandoned_carts
                    WHERE store_id IN :store_ids
                      AND abandoned_at >= NOW() - INTERVAL '24 hours'
                """),
                store_params,
            ).fetchone()
            if today_cart_result and today_cart_result[1] > 0:
                today_rate = today_cart_result[0] / today_cart_result[1]
                baseline_rate = float(average_abandonment_rate)
                cart_anomaly = (today_rate - baseline_rate) > 0.10
                if baseline_rate > 0:
                    cart_delta_pct_vs_avg = round(
                        (today_rate - baseline_rate) / baseline_rate * 100,
                        2,
                    )

    except Exception as exc:
        logger.exception(
            "business_state_carts_failed",
            extra={"org_id": organization_id, "error_type": type(exc).__name__},
        )
        _rollback_quietly(db)
        warnings.append("Cart abandonment metrics could not be computed.")
        computation_status = "partial"

    # ── 4. Customer health metrics 
    churn_risk_count = None
    vip_inactive_count = None
    returning_customer_rate = None
    returning_customer_rate_delta = None
    customer_ml_signals = {
        "customers": [],
        "limit": CUSTOMER_CONTEXT_LIMIT,
        "truncated": False,
    }

    try:
        customer_result = db.execute(
            _store_query("""
                SELECT
                    COUNT(CASE WHEN c.rfm_segment IN ('at_risk', 'hibernating') THEN 1 END) as churn_risk,
                    COUNT(CASE WHEN c.rfm_segment = 'champion'
                                    AND latest.ordered_at < NOW() - (:vip_days * INTERVAL '1 day')
                               THEN 1 END) as vip_inactive,
                    COUNT(CASE WHEN c.orders_count > 1 THEN 1 END)::float /
                        NULLIF(COUNT(*), 0) as returning_rate
                FROM customers c
                LEFT JOIN LATERAL (
                    SELECT o.ordered_at
                    FROM orders o
                    WHERE o.customer_id = c.id
                      AND o.store_id = c.store_id
                    ORDER BY o.ordered_at DESC, o.id DESC
                    LIMIT 1
                ) latest ON TRUE
                WHERE c.store_id IN :store_ids
                  AND c.status = 'active'
            """),
            {**store_params, "vip_days": VIP_INACTIVE_DAYS},
        ).fetchone()

        if customer_result:
            churn_risk_count = int(customer_result[0])
            vip_inactive_count = int(customer_result[1])
            returning_customer_rate = float(customer_result[2]) if customer_result[2] else None
            baseline_returning_rate = baseline.get("returning_customer_rate_30d")
            if returning_customer_rate is not None and baseline_returning_rate is not None:
                returning_customer_rate_delta = round(
                    (returning_customer_rate - float(baseline_returning_rate)) * 100,
                    2,
                )

    except Exception as exc:
        logger.exception(
            "business_state_customers_failed",
            extra={"org_id": organization_id, "error_type": type(exc).__name__},
        )
        _rollback_quietly(db)
        warnings.append("Customer health metrics could not be computed.")
        computation_status = "partial"

    try:
        customer_ml_signals = _load_customer_ml_signals(db, store_params)
    except Exception as exc:
        logger.exception(
            "business_state_customer_context_failed",
            extra={"org_id": organization_id, "error_type": type(exc).__name__},
        )
        _rollback_quietly(db)
        warnings.append("Customer-level agent context could not be computed.")
        computation_status = "partial"

    # ── 5. Build opportunities list 
    opportunities: list[dict] = []

    try:
        # High-value unrecovered carts
        top_carts = db.execute(
            _store_query("""
                SELECT id, cart_value, abandoned_at
                FROM abandoned_carts
                WHERE store_id IN :store_ids
                  AND status = 'abandoned'
                  AND abandoned_at >= NOW() - INTERVAL '24 hours'
                ORDER BY cart_value DESC
                LIMIT 5
            """),
            store_params,
        ).fetchall()

        for cart in top_carts:
            opportunities.append({
                "category": "cart_recovery",
                "description": f"Unrecovered cart worth ${float(cart[1]):.2f} abandoned {_time_ago(cart[2])}",
                "estimated_value": float(cart[1]),
                "urgency": "high" if float(cart[1]) > 100 else "medium",
                "action": "Trigger recovery sequence",
            })

        # Churn risk opportunity
        if churn_risk_count and churn_risk_count > 0:
            opportunities.append({
                "category": "churn_prevention",
                "description": f"{churn_risk_count} customers showing early churn signals",
                "estimated_value": None,
                "urgency": "high" if churn_risk_count > 10 else "medium",
                "action": "Launch win-back sequence",
            })

        # VIP re-engagement
        if vip_inactive_count and vip_inactive_count > 0:
            opportunities.append({
                "category": "retention",
                "description": f"{vip_inactive_count} VIP customers inactive for 45+ days",
                "estimated_value": None,
                "urgency": "medium",
                "action": "Send personalised re-engagement",
            })

    except Exception as exc:
        logger.exception(
            "business_state_opportunities_failed",
            extra={"org_id": organization_id, "error_type": type(exc).__name__},
        )
        _rollback_quietly(db)
        warnings.append("Business opportunities could not be computed.")
        computation_status = "partial"

    # ── 6. Build risks list 
    risks: list[dict] = []

    if revenue_anomaly and revenue_delta_pct is not None and revenue_delta_pct < -20:
        risks.append({
            "category": "revenue",
            "severity": "high",
            "description": f"Revenue dropped {abs(revenue_delta_pct):.1f}% vs yesterday",
            "metric": "revenue_delta_pct",
            "value": revenue_delta_pct,
        })

    if cart_anomaly:
        risks.append({
            "category": "cart_abandonment",
            "severity": "medium",
            "description": "Cart abandonment rate is significantly above 30-day average",
            "metric": "abandonment_rate",
        })

    # ── 7. Build anomalies and trends 
    anomalies: list[dict] = []
    trends: list[dict] = []
    root_causes: list[str] = []
    inventory_signals = {
        "status": "unavailable",
        "reason": "No inventory snapshot source is configured.",
    }

    if revenue_anomaly:
        anomalies.append({
            "metric": "revenue",
            "direction": "down" if (revenue_delta_pct or 0) < 0 else "up",
            "deviation": revenue_delta_pct,
            "period": "current day vs 30-day weekday baseline",
            "severity": "high" if abs(revenue_delta_pct or 0) >= 30 else "medium",
            "message": "Revenue is outside its expected weekday range.",
            "action_url": "/dashboard/rev-intell",
        })
        root_causes.append("Revenue deviated from its 30-day weekday baseline.")

    if cart_anomaly:
        anomalies.append({
            "metric": "cart_abandonment",
            "direction": "up",
            "deviation": None,
            "period": "24-hour vs 30-day baseline",
            "severity": "high",
            "message": "Cart abandonment is more than 10 percentage points above baseline.",
            "action_url": "/dashboard/cart-recovery",
        })
        root_causes.append("Cart abandonment exceeded its 30-day baseline.")

    if churn_risk_count is not None and churn_risk_count >= 10:
        anomalies.append({
            "metric": "churn_risk",
            "direction": "up",
            "deviation": churn_risk_count,
            "period": "current RFM population",
            "severity": "medium",
            "message": f"{churn_risk_count} customers are showing churn-risk signals.",
            "action_url": "/dashboard/customers",
        })
        root_causes.append("The at-risk and hibernating RFM segments are elevated.")

    if revenue_trend_7d is not None:
        trends.append({
            "metric": "revenue_7d",
            "direction": "up" if revenue_trend_7d > 0 else "down",
            "change_pct": revenue_trend_7d,
            "period": "7-day vs prior 7-day",
        })

    # ── 8. Write to database 
    severity_rank = {"normal": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}
    anomaly_severity = max(
        (item.get("severity", "low") for item in anomalies),
        key=lambda value: severity_rank.get(value, 0),
        default="normal",
    )
    source_data = {
        "current_event_rate_5m": current_event_rate,
        "baseline_event_rate_5m_30d": baseline_event_rate,
        "returning_customer_rate_delta": returning_customer_rate_delta,
        "cart_delta_pct_vs_avg": cart_delta_pct_vs_avg,
        "inventory_signals": inventory_signals,
    }
    state_metadata = {
        "warnings": warnings,
        "anomaly_severity": anomaly_severity,
        "root_causes": root_causes,
    }

    alert_table_available = False
    try:
        alert_table_available = _table_exists(db, "alert_queue")
    except Exception as exc:
        logger.exception(
            "business_state_alert_queue_check_failed",
            extra={"org_id": organization_id, "error_type": type(exc).__name__},
        )
        _rollback_quietly(db)
        warnings.append("Alert queue availability could not be checked.")
        computation_status = "partial"

    persistence_failed = False
    try:
        # Step 1: mark existing current state as historical
        db.execute(
            text("""
                UPDATE business_states
                SET is_current = FALSE
                WHERE organization_id = :org_id
                  AND is_current = TRUE
            """),
            {"org_id": organization_id},
        )

        # Step 2: insert new current state
        db.execute(
            text("""
                INSERT INTO business_states (
                    id, organization_id, is_current, schema_version,
                    generated_at, data_freshness_at, valid_until,
                    staleness_threshold_mins,
                    computation_status,
                    revenue_today, revenue_yesterday, revenue_delta_pct,
                    revenue_trend_7d, revenue_anomaly,
                    abandoned_cart_count, abandoned_cart_value, cart_anomaly,
                    churn_risk_count, vip_inactive_count, returning_customer_rate,
                    opportunities, risks, anomalies, trends, ml_signals,
                    source_data, metadata
                ) VALUES (
                    :id, :org_id, TRUE, :schema_version,
                    :generated_at, :data_freshness_at, :valid_until,
                    :staleness_mins,
                    :computation_status,
                    :revenue_today, :revenue_yesterday, :revenue_delta_pct,
                    :revenue_trend_7d, :revenue_anomaly,
                    :cart_count, :cart_value, :cart_anomaly,
                    :churn_risk_count, :vip_inactive_count, :returning_rate,
                    CAST(:opportunities AS JSONB), CAST(:risks AS JSONB),
                    CAST(:anomalies AS JSONB), CAST(:trends AS JSONB),
                    CAST(:ml_signals AS JSONB), CAST(:source_data AS JSONB),
                    CAST(:metadata AS JSONB)
                )
            """),
            {
                "id": state_id,
                "org_id": organization_id,
                "schema_version": SCHEMA_VERSION,
                "generated_at": generated_at,
                "data_freshness_at": last_synced_at,
                "valid_until": next_rebuild_at,
                "staleness_mins": staleness_threshold_mins,
                "computation_status": computation_status,
                "revenue_today": revenue_today,
                "revenue_yesterday": revenue_yesterday,
                "revenue_delta_pct": revenue_delta_pct,
                "revenue_trend_7d": revenue_trend_7d,
                "revenue_anomaly": revenue_anomaly,
                "cart_count": abandoned_cart_count,
                "cart_value": abandoned_cart_value,
                "cart_anomaly": cart_anomaly,
                "churn_risk_count": churn_risk_count,
                "vip_inactive_count": vip_inactive_count,
                "returning_rate": returning_customer_rate,
                "opportunities": json.dumps(opportunities),
                "risks": json.dumps(risks),
                "anomalies": json.dumps(anomalies),
                "trends": json.dumps(trends),
                "ml_signals": json.dumps({"customer": customer_ml_signals}),
                "source_data": json.dumps(source_data),
                "metadata": json.dumps(state_metadata),
            },
        )

        if baseline_table_available:
            db.execute(
                text("""
                    UPDATE business_state_baselines
                    SET next_rebuild_at = :next_rebuild_at,
                        updated_at = NOW()
                    WHERE organization_id = :org_id
                """),
                {
                    "next_rebuild_at": next_rebuild_at,
                    "org_id": organization_id,
                },
            )

        if alert_table_available:
            for anomaly in anomalies:
                db.execute(
                    text("""
                        INSERT INTO alert_queue (
                            id, organization_id, source_state_id, alert_type,
                            severity, message, action_url, payload, status,
                            dedupe_key, available_at, created_at, updated_at
                        ) VALUES (
                            :id, :org_id, :state_id, :alert_type,
                            :severity, :message, :action_url,
                            CAST(:payload AS JSONB), 'pending', :dedupe_key,
                            NOW(), NOW(), NOW()
                        )
                        ON CONFLICT (organization_id, dedupe_key) DO NOTHING
                    """),
                    {
                        "id": str(uuid.uuid4()),
                        "org_id": organization_id,
                        "state_id": state_id,
                        "alert_type": anomaly["metric"],
                        "severity": anomaly["severity"],
                        "message": anomaly["message"],
                        "action_url": anomaly["action_url"],
                        "payload": json.dumps(anomaly),
                        "dedupe_key": f"{state_id}:{anomaly['metric']}",
                    },
                )
        db.commit()

        logger.info("business_state_written", extra={
            "org_id": organization_id,
            "state_id": state_id,
            "status": computation_status,
            "warnings": len(warnings),
        })

    except Exception as exc:
        logger.exception(
            "business_state_write_failed",
            extra={"org_id": organization_id, "error_type": type(exc).__name__},
        )
        _rollback_quietly(db)
        warnings.append("Failed to persist business state to database.")
        computation_status = "partial"
        persistence_failed = True

    if persistence_failed and previous_state:
        previous_state.warnings.extend(warnings)
        previous_state.computation_status = "partial"
        return previous_state

    return BusinessState(
        id=state_id,
        organization_id=organization_id,
        schema_version=SCHEMA_VERSION,
        generated_at=generated_at,
        data_freshness_at=last_synced_at,
        staleness_threshold_mins=staleness_threshold_mins,
        computation_status=computation_status,
        warnings=warnings,
        revenue_today=revenue_today,
        revenue_yesterday=revenue_yesterday,
        revenue_delta_pct=revenue_delta_pct,
        revenue_trend_7d=revenue_trend_7d,
        revenue_anomaly=revenue_anomaly,
        abandoned_cart_count=abandoned_cart_count,
        abandoned_cart_value=abandoned_cart_value,
        cart_anomaly=cart_anomaly,
        churn_risk_count=churn_risk_count,
        vip_inactive_count=vip_inactive_count,
        returning_customer_rate=returning_customer_rate,
        returning_customer_rate_delta=returning_customer_rate_delta,
        opportunities=opportunities,
        risks=risks,
        anomalies=anomalies,
        trends=trends,
        ml_signals={"customer": customer_ml_signals},
        inventory_signals=inventory_signals,
        anomaly_severity=anomaly_severity,
        root_causes=root_causes,
        current_event_rate=current_event_rate,
        baseline_event_rate=baseline_event_rate,
        next_rebuild_at=next_rebuild_at,
        cart_delta_pct_vs_avg=cart_delta_pct_vs_avg,
    )


def load_current_business_state(organization_id: str, db) -> BusinessState | None:
    """
    Loads the current business state from the database.
    Returns None if no state exists yet.
    """
    try:
        row = db.execute(
            text("""
                SELECT
                    id, organization_id, schema_version, generated_at,
                    data_freshness_at, staleness_threshold_mins, computation_status,
                    revenue_today, revenue_yesterday, revenue_delta_pct,
                    revenue_trend_7d, revenue_anomaly,
                    abandoned_cart_count, abandoned_cart_value, cart_anomaly,
                    churn_risk_count, vip_inactive_count, returning_customer_rate,
                    opportunities, risks, anomalies, trends, ml_signals,
                    source_data, metadata, valid_until
                FROM business_states
                WHERE organization_id = :org_id
                  AND is_current = TRUE
                LIMIT 1
            """),
            {"org_id": organization_id},
        ).fetchone()

        if not row:
            return None

        source_data = _json_value(row[23], {})
        metadata = _json_value(row[24], {})
        generated_at = (
            row[3].replace(tzinfo=timezone.utc)
            if row[3] and row[3].tzinfo is None
            else row[3] or datetime.now(timezone.utc)
        )
        staleness_mins = row[5] or DEFAULT_STALENESS_MINS
        next_rebuild_at = row[25] or generated_at + timedelta(minutes=staleness_mins)

        return BusinessState(
            id=str(row[0]),
            organization_id=str(row[1]),
            schema_version=row[2] or SCHEMA_VERSION,
            generated_at=generated_at,
            data_freshness_at=row[4],
            staleness_threshold_mins=staleness_mins,
            computation_status=row[6] or "complete",
            warnings=[],
            revenue_today=Decimal(str(row[7])) if row[7] is not None else None,
            revenue_yesterday=Decimal(str(row[8])) if row[8] is not None else None,
            revenue_delta_pct=float(row[9]) if row[9] is not None else None,
            revenue_trend_7d=float(row[10]) if row[10] is not None else None,
            revenue_anomaly=bool(row[11]),
            abandoned_cart_count=int(row[12]) if row[12] is not None else None,
            abandoned_cart_value=Decimal(str(row[13])) if row[13] is not None else None,
            cart_anomaly=bool(row[14]),
            churn_risk_count=int(row[15]) if row[15] is not None else None,
            vip_inactive_count=int(row[16]) if row[16] is not None else None,
            returning_customer_rate=float(row[17]) if row[17] is not None else None,
            returning_customer_rate_delta=source_data.get("returning_customer_rate_delta"),
            opportunities=_json_value(row[18], []),
            risks=_json_value(row[19], []),
            anomalies=_json_value(row[20], []),
            trends=_json_value(row[21], []),
            ml_signals=_json_value(row[22], {}),
            inventory_signals=source_data.get("inventory_signals", {
                "status": "unavailable",
                "reason": "No inventory snapshot source is configured.",
            }),
            anomaly_severity=metadata.get("anomaly_severity", "normal"),
            root_causes=metadata.get("root_causes", []),
            current_event_rate=float(source_data.get("current_event_rate_5m") or 0),
            baseline_event_rate=float(source_data.get("baseline_event_rate_5m_30d") or 0),
            next_rebuild_at=next_rebuild_at,
            cart_delta_pct_vs_avg=source_data.get("cart_delta_pct_vs_avg"),
        )
    except Exception as exc:
        logger.exception(
            "business_state_load_failed",
            extra={"org_id": organization_id, "error_type": type(exc).__name__},
        )
        _rollback_quietly(db)
        return None


# ── Helpers 

def _empty_state(state_id: str, org_id: str, generated_at: datetime, warnings: list[str]) -> BusinessState:
    return BusinessState(
        id=state_id,
        organization_id=org_id,
        schema_version=SCHEMA_VERSION,
        generated_at=generated_at,
        data_freshness_at=None,
        staleness_threshold_mins=DEFAULT_STALENESS_MINS,
        computation_status="failed",
        warnings=warnings,
        revenue_today=None, revenue_yesterday=None,
        revenue_delta_pct=None, revenue_trend_7d=None,
        revenue_anomaly=False,
        abandoned_cart_count=None, abandoned_cart_value=None,
        cart_anomaly=False,
        churn_risk_count=None, vip_inactive_count=None,
        returning_customer_rate=None,
        returning_customer_rate_delta=None,
        opportunities=[], risks=[], anomalies=[], trends=[], ml_signals={},
        inventory_signals={
            "status": "unavailable",
            "reason": "No inventory snapshot source is configured.",
        },
        anomaly_severity="normal",
        root_causes=[],
        current_event_rate=0.0,
        baseline_event_rate=0.0,
        next_rebuild_at=generated_at + TRAFFIC_THRESHOLDS["normal"],
        cart_delta_pct_vs_avg=None,
    )


def _time_ago(dt: datetime) -> str:
    if dt is None:
        return "recently"
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    mins = int((datetime.now(timezone.utc) - dt).total_seconds() / 60)
    if mins < 60:
        return f"{mins} minutes ago"
    hours = mins // 60
    return f"{hours} hour{'s' if hours != 1 else ''} ago"


# ── P2-A: Dynamic Rebuild Interval ────────────────────────────────────────────

# Maps traffic load level to the delay before the next rebuild is triggered.
# Under a spike (>5x baseline), we rebuild every minute to keep the state fresh.
TRAFFIC_THRESHOLDS = {
    "normal":   timedelta(minutes=15),
    "elevated": timedelta(minutes=5),   # > 2x baseline event rate
    "spike":    timedelta(minutes=1),   # > 5x baseline event rate
}


def _get_next_rebuild_interval(current_event_rate: float, baseline_rate: float) -> timedelta:
    """
    Returns the correct rebuild interval based on current vs baseline event rate.
    Called at the end of every successful build_business_state() run.

    Guards against division by zero when a new merchant has no baseline yet —
    we default to normal (15 minutes) in that case.

    Args:
        current_event_rate: Number of store events in the last 5 minutes.
        baseline_rate:      30-day rolling average of events per 5-minute window.

    Returns:
        timedelta — the delay before the next rebuild should be triggered.
    """
    # A new merchant has no trustworthy comparison; keep the normal cadence.
    if baseline_rate <= 0:
        return TRAFFIC_THRESHOLDS["normal"]

    ratio = current_event_rate / baseline_rate

    if ratio >= 5.0:
        return TRAFFIC_THRESHOLDS["spike"]
    elif ratio >= 2.0:
        return TRAFFIC_THRESHOLDS["elevated"]
    return TRAFFIC_THRESHOLDS["normal"]
