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

import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import text

logger = logging.getLogger("rev.business_state")

SCHEMA_VERSION = "1.0"
DEFAULT_STALENESS_MINS = 30


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

    # JSONB intelligence payloads
    opportunities: list[dict]
    risks: list[dict]
    anomalies: list[dict]
    trends: list[dict]
    ml_signals: dict

    def is_stale(self) -> bool:
        age_secs = (datetime.now(timezone.utc) - self.generated_at).total_seconds()
        return age_secs > self.staleness_threshold_mins * 60

    def age_minutes(self) -> float:
        return (datetime.now(timezone.utc) - self.generated_at).total_seconds() / 60

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "organization_id": self.organization_id,
            "schema_version": self.schema_version,
            "generated_at": self.generated_at.isoformat(),
            "data_freshness_at": self.data_freshness_at.isoformat() if self.data_freshness_at else None,
            "staleness_threshold_mins": self.staleness_threshold_mins,
            "computation_status": self.computation_status,
            "warnings": self.warnings,
            "revenue_today": float(self.revenue_today) if self.revenue_today is not None else None,
            "revenue_yesterday": float(self.revenue_yesterday) if self.revenue_yesterday is not None else None,
            "revenue_delta_pct": self.revenue_delta_pct,
            "revenue_trend_7d": self.revenue_trend_7d,
            "revenue_anomaly": self.revenue_anomaly,
            "abandoned_cart_count": self.abandoned_cart_count,
            "abandoned_cart_value": float(self.abandoned_cart_value) if self.abandoned_cart_value is not None else None,
            "cart_anomaly": self.cart_anomaly,
            "churn_risk_count": self.churn_risk_count,
            "vip_inactive_count": self.vip_inactive_count,
            "returning_customer_rate": self.returning_customer_rate,
            "opportunities": self.opportunities,
            "risks": self.risks,
            "anomalies": self.anomalies,
            "trends": self.trends,
            "ml_signals": self.ml_signals,
        }


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
    except Exception as e:
        logger.error("business_state_stores_failed", extra={"org_id": organization_id, "error": str(e)})
        store_ids = []
        last_synced_at = None
        warnings.append("Could not load store data.")

    if not store_ids:
        warnings.append("No connected stores found. Business metrics unavailable.")
        return _empty_state(state_id, organization_id, generated_at, warnings)

    store_ids_sql = tuple(store_ids) if len(store_ids) > 1 else f"('{store_ids[0]}')"

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
            text(f"""
                SELECT
                    DATE(ordered_at AT TIME ZONE 'UTC') as order_date,
                    SUM(total) as daily_revenue,
                    COUNT(*) as order_count,
                    AVG(total) as avg_order_value
                FROM orders
                WHERE store_id IN {store_ids_sql}
                  AND ordered_at >= :cutoff
                GROUP BY DATE(ordered_at AT TIME ZONE 'UTC')
                ORDER BY order_date DESC
            """),
            {"cutoff": fourteen_days_ago},
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

        # Anomaly: day-over-day drop > 20% or gain > 50%
        if revenue_delta_pct is not None:
            revenue_anomaly = revenue_delta_pct < -20 or revenue_delta_pct > 50

    except Exception as e:
        logger.error("business_state_revenue_failed", extra={"org_id": organization_id, "error": str(e)})
        warnings.append("Revenue metrics could not be computed.")
        computation_status = "partial"

    # ── 3. Cart abandonment metrics 
    abandoned_cart_count = None
    abandoned_cart_value = None
    cart_anomaly = False

    try:
        cart_result = db.execute(
            text(f"""
                SELECT
                    COUNT(*) as abandoned_count,
                    COALESCE(SUM(cart_value), 0) as total_value
                FROM abandoned_carts
                WHERE store_id IN {store_ids_sql}
                  AND status = 'abandoned'
                  AND abandoned_at >= NOW() - INTERVAL '48 hours'
            """),
        ).fetchone()

        abandoned_cart_count = int(cart_result[0])
        abandoned_cart_value = Decimal(str(cart_result[1]))

        # Check 30-day average abandonment rate for anomaly detection
        cart_rate_result = db.execute(
            text(f"""
                SELECT
                    COUNT(CASE WHEN status = 'abandoned' THEN 1 END) as abandoned,
                    COUNT(*) as total
                FROM abandoned_carts
                WHERE store_id IN {store_ids_sql}
                  AND abandoned_at >= NOW() - INTERVAL '30 days'
            """),
        ).fetchone()

        if cart_rate_result and cart_rate_result[1] > 0:
            avg_abandonment_rate = cart_rate_result[0] / cart_rate_result[1]
            # Get today's rate
            today_cart_result = db.execute(
                text(f"""
                    SELECT
                        COUNT(CASE WHEN status = 'abandoned' THEN 1 END) as abandoned,
                        COUNT(*) as total
                    FROM abandoned_carts
                    WHERE store_id IN {store_ids_sql}
                      AND abandoned_at >= NOW() - INTERVAL '24 hours'
                """),
            ).fetchone()
            if today_cart_result and today_cart_result[1] > 0:
                today_rate = today_cart_result[0] / today_cart_result[1]
                cart_anomaly = (today_rate - avg_abandonment_rate) > 0.10  # 10-point spike

    except Exception as e:
        logger.error("business_state_carts_failed", extra={"org_id": organization_id, "error": str(e)})
        warnings.append("Cart abandonment metrics could not be computed.")
        computation_status = "partial"

    # ── 4. Customer health metrics 
    churn_risk_count = None
    vip_inactive_count = None
    returning_customer_rate = None

    try:
        customer_result = db.execute(
            text(f"""
                SELECT
                    COUNT(CASE WHEN rfm_segment IN ('at_risk', 'hibernating') THEN 1 END) as churn_risk,
                    COUNT(CASE WHEN rfm_segment = 'champion' AND updated_at < NOW() - INTERVAL '30 days' THEN 1 END) as vip_inactive,
                    COUNT(CASE WHEN orders_count > 1 THEN 1 END)::float /
                        NULLIF(COUNT(*), 0) as returning_rate
                FROM customers
                WHERE store_id IN {store_ids_sql}
                  AND status = 'active'
            """),
        ).fetchone()

        if customer_result:
            churn_risk_count = int(customer_result[0])
            vip_inactive_count = int(customer_result[1])
            returning_customer_rate = float(customer_result[2]) if customer_result[2] else None

    except Exception as e:
        logger.error("business_state_customers_failed", extra={"org_id": organization_id, "error": str(e)})
        warnings.append("Customer health metrics could not be computed.")
        computation_status = "partial"

    # ── 5. Build opportunities list 
    opportunities: list[dict] = []

    try:
        # High-value unrecovered carts
        top_carts = db.execute(
            text(f"""
                SELECT id, cart_value, abandoned_at
                FROM abandoned_carts
                WHERE store_id IN {store_ids_sql}
                  AND status = 'abandoned'
                  AND abandoned_at >= NOW() - INTERVAL '24 hours'
                ORDER BY cart_value DESC
                LIMIT 5
            """),
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
                "description": f"{vip_inactive_count} VIP customers inactive for 30+ days",
                "estimated_value": None,
                "urgency": "medium",
                "action": "Send personalised re-engagement",
            })

    except Exception as e:
        logger.warning("business_state_opportunities_failed", extra={"error": str(e)})

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

    if revenue_anomaly:
        anomalies.append({
            "metric": "revenue",
            "direction": "down" if (revenue_delta_pct or 0) < 0 else "up",
            "deviation": revenue_delta_pct,
            "period": "day-over-day",
        })

    if revenue_trend_7d is not None:
        trends.append({
            "metric": "revenue_7d",
            "direction": "up" if revenue_trend_7d > 0 else "down",
            "change_pct": revenue_trend_7d,
            "period": "7-day vs prior 7-day",
        })

    # ── 8. Write to database 
    import json

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
                    generated_at, data_freshness_at, staleness_threshold_mins,
                    computation_status,
                    revenue_today, revenue_yesterday, revenue_delta_pct,
                    revenue_trend_7d, revenue_anomaly,
                    abandoned_cart_count, abandoned_cart_value, cart_anomaly,
                    churn_risk_count, vip_inactive_count, returning_customer_rate,
                    opportunities, risks, anomalies, trends, ml_signals
                ) VALUES (
                    :id, :org_id, TRUE, :schema_version,
                    :generated_at, :data_freshness_at, :staleness_mins,
                    :computation_status,
                    :revenue_today, :revenue_yesterday, :revenue_delta_pct,
                    :revenue_trend_7d, :revenue_anomaly,
                    :cart_count, :cart_value, :cart_anomaly,
                    :churn_risk_count, :vip_inactive_count, :returning_rate,
                    :opportunities, :risks, :anomalies, :trends, :ml_signals
                )
            """),
            {
                "id": state_id,
                "org_id": organization_id,
                "schema_version": SCHEMA_VERSION,
                "generated_at": generated_at,
                "data_freshness_at": last_synced_at,
                "staleness_mins": DEFAULT_STALENESS_MINS,
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
                "ml_signals": json.dumps({}),
            },
        )
        db.commit()

        logger.info("business_state_written", extra={
            "org_id": organization_id,
            "state_id": state_id,
            "status": computation_status,
            "warnings": len(warnings),
        })

    except Exception as e:
        logger.error("business_state_write_failed", extra={"org_id": organization_id, "error": str(e)})
        try:
            db.rollback()
        except Exception:
            pass
        warnings.append("Failed to persist business state to database.")
        computation_status = "partial"

    return BusinessState(
        id=state_id,
        organization_id=organization_id,
        schema_version=SCHEMA_VERSION,
        generated_at=generated_at,
        data_freshness_at=last_synced_at,
        staleness_threshold_mins=DEFAULT_STALENESS_MINS,
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
        opportunities=opportunities,
        risks=risks,
        anomalies=anomalies,
        trends=trends,
        ml_signals={},
    )


def load_current_business_state(organization_id: str, db) -> BusinessState | None:
    """
    Loads the current business state from the database.
    Returns None if no state exists yet.
    """
    import json
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
                    opportunities, risks, anomalies, trends, ml_signals
                FROM business_states
                WHERE organization_id = :org_id
                  AND is_current = TRUE
                LIMIT 1
            """),
            {"org_id": organization_id},
        ).fetchone()

        if not row:
            return None

        def _parse_json(v):
            if isinstance(v, str):
                return json.loads(v)
            return v or []

        return BusinessState(
            id=str(row[0]),
            organization_id=str(row[1]),
            schema_version=row[2] or SCHEMA_VERSION,
            generated_at=row[3].replace(tzinfo=timezone.utc) if row[3] else datetime.now(timezone.utc),
            data_freshness_at=row[4],
            staleness_threshold_mins=row[5] or DEFAULT_STALENESS_MINS,
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
            opportunities=_parse_json(row[18]),
            risks=_parse_json(row[19]),
            anomalies=_parse_json(row[20]),
            trends=_parse_json(row[21]),
            ml_signals=_parse_json(row[22]) if isinstance(_parse_json(row[22]), dict) else {},
        )
    except Exception as e:
        logger.error("business_state_load_failed", extra={"org_id": organization_id, "error": str(e)})
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
        opportunities=[], risks=[], anomalies=[], trends=[], ml_signals={},
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
    # Protect against zero-division for brand-new merchants with no history.
    ratio = current_event_rate / max(baseline_rate, 1)

    if ratio >= 5.0:
        return TRAFFIC_THRESHOLDS["spike"]
    elif ratio >= 2.0:
        return TRAFFIC_THRESHOLDS["elevated"]
    return TRAFFIC_THRESHOLDS["normal"]