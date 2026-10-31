"""
Rev Intelligence — Business State Builder
Queries real commerce data for an organization and computes a structured
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


def load_business_change_history(organization_id: str, db, *, limit: int = 24) -> dict:
    """Read bounded historical snapshots for the authenticated merchant only.

    This is observed change history, not a causal explanation. We compare
    snapshot values, not aggregate repeated snapshots into fictitious revenue.
    """
    safe_limit = max(1, min(int(limit), 48))
    rows = db.execute(text("""
        SELECT id, generated_at, revenue_today, abandoned_cart_count,
               churn_risk_count, computation_status
        FROM business_states
        WHERE organization_id = :org_id
          AND computation_status IN ('complete', 'partial')
        ORDER BY generated_at DESC, id DESC
        LIMIT :history_limit
    """), {"org_id": organization_id, "history_limit": safe_limit}).mappings().all()
    snapshots = [
        {
            "snapshot_id": str(row["id"]),
            "generated_at": row["generated_at"].isoformat(),
            "revenue_today": float(row["revenue_today"]) if row["revenue_today"] is not None else None,
            "abandoned_cart_count": row["abandoned_cart_count"],
            "churn_risk_count": row["churn_risk_count"],
            "computation_status": row["computation_status"],
        }
        for row in rows
    ]
    changes = []
    for recent, earlier in zip(snapshots, snapshots[1:]):
        for metric in ("revenue_today", "abandoned_cart_count", "churn_risk_count"):
            current, previous = recent[metric], earlier[metric]
            if current is None or previous is None or current == previous:
                continue
            changes.append({
                "metric": metric,
                "from": previous,
                "to": current,
                "delta": round(current - previous, 2),
                "observed_at": recent["generated_at"],
                "comparison_snapshot_at": earlier["generated_at"],
                "causality": "unverified",
            })
    return {
        "organization_id": organization_id,
        "snapshots": snapshots,
        "observed_changes": changes[:48],
        "history_limit": safe_limit,
        "truncated": len(snapshots) == safe_limit,
        "interpretation": "Snapshot-to-snapshot observations; not independent daily totals or verified causes.",
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
    observed_drivers: list[dict] = field(default_factory=list)
    revenue_currency: str | None = None
    revenue_evidence: dict = field(default_factory=dict)

    def is_stale(self) -> bool:
        age_secs = (datetime.now(timezone.utc) - self.generated_at).total_seconds()
        return age_secs > self.staleness_threshold_mins * 60

    def age_minutes(self) -> float:
        return (datetime.now(timezone.utc) - self.generated_at).total_seconds() / 60

    def reliability(self) -> dict:
        """Explain how much of the merchant snapshot can be trusted.

        Confidence is a completeness/freshness indicator, not a probability
        that any individual recommendation is correct.
        """
        now = datetime.now(timezone.utc)
        generated = self.generated_at
        if generated.tzinfo is None:
            generated = generated.replace(tzinfo=timezone.utc)
        age_minutes = max(0.0, (now - generated).total_seconds() / 60)
        source_at = self.data_freshness_at
        if source_at is not None and source_at.tzinfo is None:
            source_at = source_at.replace(tzinfo=timezone.utc)
        source_age_minutes = (
            max(0.0, (now - source_at).total_seconds() / 60)
            if source_at is not None else None
        )
        stale = age_minutes > self.staleness_threshold_mins
        if self.computation_status == "failed":
            level = "unavailable"
        elif self.computation_status != "complete" or self.warnings or stale:
            level = "limited"
        elif source_age_minutes is None:
            level = "unknown"
        elif source_age_minutes > self.staleness_threshold_mins:
            level = "limited"
        else:
            level = "high"
        return {
            "level": level,
            "meaning": "Data completeness and freshness; not prediction accuracy.",
            "snapshot_age_minutes": round(age_minutes, 1),
            "source_age_minutes": round(source_age_minutes, 1) if source_age_minutes is not None else None,
            "snapshot_stale": stale,
            "source_freshness_known": source_age_minutes is not None,
            "computation_status": self.computation_status,
            "warnings": list(self.warnings),
        }

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
            "reliability": self.reliability(),
            "next_rebuild_at": self.next_rebuild_at.isoformat(),
            "sales_health": {
                "revenue_today": revenue_today,
                "revenue_yesterday": revenue_yesterday,
                "revenue_delta_pct": self.revenue_delta_pct,
                "revenue_trend_7d": self.revenue_trend_7d,
                "revenue_anomaly": self.revenue_anomaly,
                "currency": self.revenue_currency,
                "reporting_timezone": "UTC",
                "evidence": self.revenue_evidence,
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
                "observed_drivers": self.observed_drivers,
                "root_cause_verification": "not_established",
            },
            "traffic": {
                "current_event_rate_5m": self.current_event_rate,
                "baseline_event_rate_5m_30d": self.baseline_event_rate,
            },
            "opportunities": self.opportunities,
            "risks": self.risks,
            "trends": self.trends,
            "ml_signals": self.ml_signals,
            # Stable business-state contract. Existing keys below remain for
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
                "currency": self.revenue_currency,
                "reporting_timezone": "UTC",
                "evidence": self.revenue_evidence,
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
    Builds a complete BusinessState for an organization from real database data.

    Resilient to partial failures: if one data source fails, the state is
    marked partial and the failed section is None with a warning. The old
    current state is never overwritten until the new one is fully computed.

    Args:
        organization_id: The organization's UUID string.
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

    # ── 1. Get stores for this organization
    try:
        stores_result = db.execute(
            text("""
                SELECT id, last_synced_at, platform, status
                FROM stores
                WHERE organization_id = :org_id
                  AND (status IN ('active', 'syncing', 'error') OR status = 'connected')
                ORDER BY last_synced_at DESC NULLS LAST
            """),
            {"org_id": organization_id},
        ).fetchall()
        store_ids = [str(r[0]) for r in stores_result]
        shopify_store_ids = [str(r[0]) for r in stores_result if str(r[2] or "").lower() == "shopify" and str(r[3] or "").lower() in {"active", "connected", "syncing"}]
        sync_times = [r[1] for r in stores_result if r[1] is not None]
        shopify_sync_times = [r[1] for r in stores_result if str(r[2] or "").lower() == "shopify" and str(r[3] or "").lower() in {"active", "connected", "syncing"} and r[1] is not None]
        last_synced_at = min(sync_times) if sync_times else None
        shopify_last_synced_at = min(shopify_sync_times) if shopify_sync_times else None
        if shopify_last_synced_at is not None and shopify_last_synced_at.tzinfo is None:
            shopify_last_synced_at = shopify_last_synced_at.replace(tzinfo=timezone.utc)
    except Exception as exc:
        logger.exception(
            "business_state_stores_failed",
            extra={"org_id": organization_id, "error_type": type(exc).__name__},
        )
        _rollback_quietly(db)
        store_ids = []
        shopify_store_ids = []
        last_synced_at = None
        shopify_last_synced_at = None
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
    revenue_currency = None
    revenue_evidence = {
        "contract_version": "1.0",
        "overall_status": "unknown",
        "generated_at": generated_at.isoformat(),
        "period": {"timezone": "UTC", "semantics": "[start,end)"},
        "organization_scope": {"scope": "authorized_organization", "store_count": 0},
        "items": [],
        "warnings": ["Revenue evidence has not been verified for this snapshot."],
        "errors": [],
    }

    try:
        today = generated_at.astimezone(timezone.utc).date()
        yesterday = today - timedelta(days=1)
        seven_days_ago = today - timedelta(days=7)
        fourteen_days_ago = today - timedelta(days=14)
        period_start = datetime.combine(fourteen_days_ago, datetime.min.time(), tzinfo=timezone.utc)
        period_end = datetime.combine(today, datetime.min.time(), tzinfo=timezone.utc)

        revenue_evidence["period"].update({"start": period_start.isoformat(), "end": period_end.isoformat()})
        revenue_evidence["organization_scope"]["store_count"] = len(shopify_store_ids)
        if not shopify_store_ids:
            revenue_evidence["overall_status"] = "unavailable"
            revenue_evidence["warnings"] = ["No active Shopify store scope was found."]
            warnings.append("Revenue specialist metrics are unavailable: no active Shopify store scope was found.")
        else:
            coverage_rows = db.execute(
                _store_query("""
                    SELECT store_id, coverage_start, coverage_end, certified_at, source
                    FROM intelligence_order_coverage
                    WHERE organization_id = :org_id
                      AND store_id IN :store_ids
                      AND source = 'shopify_verified_history_v1'
                """),
                {"org_id": organization_id, "store_ids": tuple(shopify_store_ids)},
            ).mappings().all()
            coverage_by_store = {str(row["store_id"]): row for row in coverage_rows}
            coverage_complete = len(coverage_by_store) == len(shopify_store_ids)
            if coverage_complete:
                for store_id in shopify_store_ids:
                    attestation = coverage_by_store[store_id]
                    coverage_start = attestation["coverage_start"]
                    coverage_end = attestation["coverage_end"]
                    certified_at = attestation["certified_at"]
                    if coverage_start.tzinfo is None:
                        coverage_start = coverage_start.replace(tzinfo=timezone.utc)
                    if coverage_end.tzinfo is None:
                        coverage_end = coverage_end.replace(tzinfo=timezone.utc)
                    if certified_at.tzinfo is None:
                        certified_at = certified_at.replace(tzinfo=timezone.utc)
                    if (coverage_start.astimezone(timezone.utc) > period_start
                            or coverage_end.astimezone(timezone.utc) < period_end
                            or (generated_at - certified_at.astimezone(timezone.utc)).total_seconds() > DEFAULT_STALENESS_MINS * 60):
                        coverage_complete = False
                        break
            if shopify_last_synced_at is None:
                coverage_complete = False
            else:
                sync_at = shopify_last_synced_at
                if sync_at.tzinfo is None:
                    sync_at = sync_at.replace(tzinfo=timezone.utc)
                if (generated_at - sync_at.astimezone(timezone.utc)).total_seconds() > DEFAULT_STALENESS_MINS * 60:
                    coverage_complete = False

            rev_result = db.execute(
                _store_query("""
                    SELECT currency,
                           DATE(ordered_at AT TIME ZONE 'UTC') AS order_date,
                           SUM(total) AS daily_revenue,
                           COUNT(DISTINCT id) AS order_count,
                           AVG(total) AS avg_order_value
                    FROM orders
                    WHERE store_id IN :store_ids
                      AND ordered_at >= :cutoff
                      AND ordered_at < :period_end
                      AND recovery_status IS DISTINCT FROM 'cancelled'
                    GROUP BY currency, DATE(ordered_at AT TIME ZONE 'UTC')
                    ORDER BY order_date DESC, currency
                """),
                {
                    "store_ids": tuple(shopify_store_ids),
                    "cutoff": period_start,
                    "period_end": period_end,
                },
            ).fetchall()

            currencies = {str(row[0] or "UNKNOWN").upper() for row in rev_result}
            if not coverage_complete:
                coverage_status = "partial" if coverage_rows else "unknown"
                if shopify_last_synced_at is None:
                    coverage_status = "unknown"
                elif (generated_at - shopify_last_synced_at.astimezone(timezone.utc)).total_seconds() > DEFAULT_STALENESS_MINS * 60:
                    coverage_status = "stale"
                elif coverage_rows and len(coverage_by_store) == len(shopify_store_ids):
                    earliest_coverage_start = min(
                        row["coverage_start"].replace(tzinfo=timezone.utc)
                        if row["coverage_start"].tzinfo is None else row["coverage_start"]
                        for row in coverage_rows
                    )
                    if period_start < earliest_coverage_start.astimezone(timezone.utc):
                        coverage_status = "insufficient_history"
                    elif any(
                        (generated_at - (row["certified_at"].replace(tzinfo=timezone.utc)
                         if row["certified_at"].tzinfo is None else row["certified_at"]).astimezone(timezone.utc)).total_seconds()
                        > DEFAULT_STALENESS_MINS * 60
                        for row in coverage_rows
                    ):
                        coverage_status = "stale"
                revenue_evidence["overall_status"] = coverage_status
                revenue_evidence["warnings"] = ["Complete, fresh Shopify order coverage for the last 14 full UTC days is not certified."]
                warnings.append("Revenue specialist metrics are withheld because complete, fresh Shopify order coverage for the last 14 full UTC days is not certified.")
            elif len(currencies) > 1 or "UNKNOWN" in currencies:
                revenue_evidence["overall_status"] = "unsupported"
                revenue_evidence["warnings"] = ["Revenue totals cannot be combined because the authorized store scope contains mixed or unknown currencies."]
                warnings.append("Revenue specialist metrics are withheld because the Shopify order scope contains mixed or unknown currencies.")
            elif len(currencies) == 1:
                revenue_currency = next(iter(currencies))
                daily = {
                    str(row[1]): {
                        "value": Decimal(str(row[2])),
                        "count": int(row[3]),
                    }
                    for row in rev_result
                }
                # The current UTC day is incomplete. Never report it as a full day.
                yesterday_row = daily.get(str(yesterday), {"value": Decimal("0"), "count": 0})
                revenue_yesterday = yesterday_row["value"]
                recent_7d = sum(
                    (entry["value"] for day, entry in daily.items()
                     if str(seven_days_ago) <= day < str(today)),
                    Decimal("0"),
                )
                prior_7d = sum(
                    (entry["value"] for day, entry in daily.items()
                     if str(fourteen_days_ago) <= day < str(seven_days_ago)),
                    Decimal("0"),
                )
                revenue_evidence["overall_status"] = "available"
                revenue_evidence["warnings"] = [
                    "Recorded order values are not gross revenue or independently verified net revenue.",
                    "The current UTC day is incomplete and is intentionally omitted.",
                ]
                source = {
                    "system": "shopify",
                    "entity": "orders",
                    "fields": ["orders.total", "orders.currency", "orders.ordered_at", "orders.recovery_status"],
                    "record_count": yesterday_row["count"],
                }
                freshness_age = max(0, int((generated_at - shopify_last_synced_at).total_seconds()))
                coverage_run_ids = [str(row["source_run_id"]) for row in coverage_rows]
                coverage = {
                    "completeness": "known",
                    "is_truncated": False,
                    "source": "shopify_verified_history_v1",
                    "attestation_run_ids": coverage_run_ids,
                    "limitations": [
                        "Cancelled orders are excluded.",
                        "Payment capture status is not persisted.",
                        "Refund value is not independently itemized.",
                    ],
                }
                yesterday_start = datetime.combine(yesterday, datetime.min.time(), tzinfo=timezone.utc)
                today_start = datetime.combine(today, datetime.min.time(), tzinfo=timezone.utc)
                yesterday_value_id = str(uuid.uuid4())
                yesterday_count_id = str(uuid.uuid4())
                revenue_evidence["items"].extend([
                    {
                        "evidence_id": yesterday_value_id,
                        "domain": "revenue",
                        "metric": "recorded_order_value",
                        "value": str(revenue_yesterday),
                        "unit": "money",
                        "currency": revenue_currency,
                        "status": "available",
                        "epistemic_type": "observed",
                        "source": source,
                        "scope": {"store_count": len(shopify_store_ids)},
                        "period": {"start": yesterday_start.isoformat(), "end": today_start.isoformat(), "timezone": "UTC", "semantics": "[start,end)"},
                        "freshness": {"observed_at": generated_at.isoformat(), "source_synced_at": shopify_last_synced_at.isoformat(), "age_seconds": freshness_age},
                        "coverage": coverage,
                        "calculation": None,
                        "warnings": [],
                    },
                    {
                        "evidence_id": yesterday_count_id,
                        "domain": "revenue",
                        "metric": "recorded_order_count",
                        "value": yesterday_row["count"],
                        "unit": "orders",
                        "currency": revenue_currency,
                        "status": "available",
                        "epistemic_type": "observed",
                        "source": {**source, "record_count": yesterday_row["count"]},
                        "scope": {"store_count": len(shopify_store_ids)},
                        "period": {"start": yesterday_start.isoformat(), "end": today_start.isoformat(), "timezone": "UTC", "semantics": "[start,end)"},
                        "freshness": {"observed_at": generated_at.isoformat(), "source_synced_at": shopify_last_synced_at.isoformat(), "age_seconds": freshness_age},
                        "coverage": coverage,
                        "calculation": None,
                        "warnings": [],
                    },
                ])
                if yesterday_row["count"]:
                    revenue_evidence["items"].append({
                        "evidence_id": str(uuid.uuid4()),
                        "domain": "revenue",
                        "metric": "average_order_value",
                        "value": str(revenue_yesterday / Decimal(yesterday_row["count"])),
                        "unit": "money",
                        "currency": revenue_currency,
                        "status": "available",
                        "epistemic_type": "calculated",
                        "source": source,
                        "scope": {"store_count": len(shopify_store_ids)},
                        "period": {"start": yesterday_start.isoformat(), "end": today_start.isoformat(), "timezone": "UTC", "semantics": "[start,end)"},
                        "freshness": {"observed_at": generated_at.isoformat(), "source_synced_at": shopify_last_synced_at.isoformat(), "age_seconds": freshness_age},
                        "coverage": coverage,
                        "calculation": {
                            "formula_id": "recorded_order_average_v1",
                            "formula": "sum(orders.total) / count(distinct orders.id)",
                            "input_evidence_ids": [yesterday_value_id, yesterday_count_id],
                            "rounding": "Decimal arithmetic; no display rounding applied.",
                            "exclusions": ["recovery_status = cancelled"],
                        },
                        "warnings": [],
                    })
                current_7d_id = str(uuid.uuid4())
                previous_7d_id = str(uuid.uuid4())
                current_7d_start = datetime.combine(seven_days_ago, datetime.min.time(), tzinfo=timezone.utc)
                previous_7d_start = datetime.combine(fourteen_days_ago, datetime.min.time(), tzinfo=timezone.utc)
                revenue_evidence["items"].extend([
                    {
                        "evidence_id": current_7d_id,
                        "domain": "revenue",
                        "metric": "recorded_order_value_7d",
                        "value": str(recent_7d),
                        "unit": "money",
                        "currency": revenue_currency,
                        "status": "available",
                        "epistemic_type": "observed",
                        "source": {**source, "record_count": sum(entry["count"] for day, entry in daily.items() if str(seven_days_ago) <= day < str(today))},
                        "scope": {"store_count": len(shopify_store_ids)},
                        "period": {"start": current_7d_start.isoformat(), "end": today_start.isoformat(), "timezone": "UTC", "semantics": "[start,end)"},
                        "freshness": {"observed_at": generated_at.isoformat(), "source_synced_at": shopify_last_synced_at.isoformat(), "age_seconds": freshness_age},
                        "coverage": coverage,
                        "calculation": None,
                        "warnings": [],
                    },
                    {
                        "evidence_id": previous_7d_id,
                        "domain": "revenue",
                        "metric": "recorded_order_value_7d",
                        "value": str(prior_7d),
                        "unit": "money",
                        "currency": revenue_currency,
                        "status": "available",
                        "epistemic_type": "observed",
                        "source": {**source, "record_count": sum(entry["count"] for day, entry in daily.items() if str(fourteen_days_ago) <= day < str(seven_days_ago))},
                        "scope": {"store_count": len(shopify_store_ids)},
                        "period": {"start": previous_7d_start.isoformat(), "end": current_7d_start.isoformat(), "timezone": "UTC", "semantics": "[start,end)"},
                        "freshness": {"observed_at": generated_at.isoformat(), "source_synced_at": shopify_last_synced_at.isoformat(), "age_seconds": freshness_age},
                        "coverage": coverage,
                        "calculation": None,
                        "warnings": [],
                    },
                ])
                if prior_7d > 0:
                    revenue_trend_7d = float((recent_7d - prior_7d) / prior_7d * 100)
                    revenue_evidence["items"].append({
                        "evidence_id": str(uuid.uuid4()),
                        "domain": "revenue",
                        "metric": "revenue_trend_7d",
                        "value": str(revenue_trend_7d),
                        "unit": "percent",
                        "status": "available",
                        "epistemic_type": "calculated",
                        "source": source,
                        "scope": {"store_count": len(shopify_store_ids)},
                        "period": {"start": previous_7d_start.isoformat(), "end": today_start.isoformat(), "timezone": "UTC", "semantics": "[start,end)"},
                        "freshness": {"observed_at": generated_at.isoformat(), "source_synced_at": shopify_last_synced_at.isoformat(), "age_seconds": freshness_age},
                        "coverage": coverage,
                        "calculation": {
                            "formula_id": "recorded_order_value_change_pct_v1",
                            "formula": "(current_7d - previous_7d) / previous_7d * 100",
                            "input_evidence_ids": [current_7d_id, previous_7d_id],
                            "rounding": "Decimal division; output serialized as finite percentage.",
                            "exclusions": ["recovery_status = cancelled"],
                        },
                        "warnings": [],
                    })
            else:
                revenue_evidence["overall_status"] = "unsupported"
                revenue_evidence["warnings"] = ["No currency-bearing order records exist in the verified window; a monetary zero cannot be assigned a store currency."]
                warnings.append("Revenue specialist metrics are unavailable because no currency-bearing order records exist in the verified window.")

            for unsupported_metric in ("gross_revenue", "net_revenue", "refund_value"):
                revenue_evidence["items"].append({
                    "evidence_id": str(uuid.uuid4()),
                    "domain": "revenue",
                    "metric": unsupported_metric,
                    "value": None,
                    "unit": "money",
                    "currency": None,
                    "status": "unsupported",
                    "epistemic_type": "observed",
                    "source": {"system": "shopify", "entity": "orders", "fields": [], "record_count": 0},
                    "scope": {"store_count": len(shopify_store_ids)},
                    "period": revenue_evidence["period"],
                    "freshness": {"observed_at": generated_at.isoformat(),
                                  "source_synced_at": shopify_last_synced_at.isoformat() if shopify_last_synced_at else None,
                                  "age_seconds": max(0, int((generated_at - shopify_last_synced_at).total_seconds())) if shopify_last_synced_at else None},
                    "coverage": {"completeness": "known" if coverage_complete else "unknown",
                                 "is_truncated": False,
                                 "attestation_run_ids": [str(row["source_run_id"]) for row in coverage_rows]},
                    "calculation": None,
                    "warnings": ["No independent gross-sales or refund ledger/payment-status evidence is persisted."],
                })
    except Exception as exc:
        logger.exception(
            "business_state_revenue_failed",
            extra={"org_id": organization_id, "error_type": type(exc).__name__},
        )
        _rollback_quietly(db)
        warnings.append("Revenue metrics could not be computed or coverage could not be verified.")
        computation_status = "partial"
        revenue_today = None
        revenue_yesterday = None
        revenue_delta_pct = None
        revenue_trend_7d = None
        revenue_currency = None
        revenue_evidence["overall_status"] = "unavailable"
        revenue_evidence["items"] = []
        revenue_evidence["errors"] = [{"code": "REVENUE_BUSINESS_STATE_QUERY_FAILED"}]
        revenue_evidence["warnings"] = ["Revenue evidence could not be computed or its coverage could not be verified."]
        revenue_evidence["items"] = []

    # ── 3. Cart abandonment metrics 
    abandoned_cart_count = None
    abandoned_cart_value = None
    cart_anomaly = False
    cart_delta_pct_vs_avg = None

    try:
        cart_result = db.execute(
            _store_query("""
                WITH ranked AS (
                    SELECT store_id, cart_value,
                           ROW_NUMBER() OVER (
                               PARTITION BY store_id,
                                 COALESCE(NULLIF(external_cart_id, ''), id::text)
                               ORDER BY updated_at DESC NULLS LAST,
                                        created_at DESC NULLS LAST, id DESC
                           ) AS rn
                    FROM abandoned_carts
                    WHERE store_id IN :store_ids
                      AND status = 'abandoned' AND recovered_at IS NULL
                      AND abandoned_at >= NOW() - INTERVAL '48 hours'
                )
                SELECT COUNT(*) as abandoned_count,
                       COALESCE(SUM(cart_value), 0) as total_value
                FROM ranked WHERE rn = 1
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
                WITH ranked AS (
                    SELECT id, cart_value, abandoned_at,
                           ROW_NUMBER() OVER (
                               PARTITION BY store_id,
                                 COALESCE(NULLIF(external_cart_id, ''), id::text)
                               ORDER BY updated_at DESC NULLS LAST,
                                        created_at DESC NULLS LAST, id DESC
                           ) AS rn
                    FROM abandoned_carts
                    WHERE store_id IN :store_ids
                      AND status = 'abandoned' AND recovered_at IS NULL
                      AND abandoned_at >= NOW() - INTERVAL '24 hours'
                )
                SELECT id, cart_value, abandoned_at FROM ranked
                WHERE rn = 1 ORDER BY cart_value DESC LIMIT 5
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
                "action": "Send personalized re-engagement",
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
    # Anomalies are observations, not proven causes. Preserve evidence separately.
    root_causes: list[str] = []
    observed_drivers: list[dict] = []
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
        observed_drivers.append({"metric": "revenue_delta_pct", "observed_change_pct": revenue_delta_pct, "comparison": "current day vs 30-day weekday baseline", "causality": "unverified"})

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
        observed_drivers.append({"metric": "cart_abandonment", "comparison": "24-hour vs 30-day baseline", "causality": "unverified"})

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
        observed_drivers.append({"metric": "churn_risk_count", "observed_count": churn_risk_count, "comparison": "current RFM population", "causality": "unverified"})

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
        "revenue_currency": revenue_currency,
        "revenue_evidence": revenue_evidence,
        "revenue_reporting_timezone": "UTC",
        "revenue_period_start": period_start.isoformat() if "period_start" in locals() else None,
        "revenue_period_end": period_end.isoformat() if "period_end" in locals() else None,
    }
    state_metadata = {
        "warnings": warnings,
        "anomaly_severity": anomaly_severity,
        "root_causes": root_causes,
        "observed_drivers": observed_drivers,
        "root_cause_verification": "not_established",
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

    # Capture warnings raised during availability checks as well as metric collection.
    state_metadata["warnings"] = list(warnings)

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
                            id, organization_id, business_state_id, alert_type,
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
        observed_drivers=observed_drivers,
        revenue_currency=revenue_currency,
        revenue_evidence=revenue_evidence,
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
            warnings=metadata.get("warnings", []) if isinstance(metadata.get("warnings", []), list) else [],
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
            observed_drivers=metadata.get("observed_drivers", []) if isinstance(metadata.get("observed_drivers", []), list) else [],
            revenue_currency=source_data.get("revenue_currency"),
            revenue_evidence=source_data.get("revenue_evidence") or {},
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


# Dynamic rebuild interval

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
