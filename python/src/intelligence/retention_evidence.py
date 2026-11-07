"""Task 208 — privacy-safe customer retention and cohort evidence.

Every metric is an aggregate over authorized Shopify order/customer identity
associations. No customer contact field, name, address or customer-level record
is returned. Certified lifetime order coverage is required before a newly
observed customer can be called first-time, or before lifetime returning/cohort
conclusions are made.
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

from .evidence import (
    EVIDENCE_SCHEMA_VERSION, STATUS_AVAILABLE, STATUS_PARTIAL, STATUS_UNAVAILABLE,
    UNIT_RATIO, decimal_value, ensure_utc, evidence_item, iso, period, previous_period, utc_now,
)
from .query import safe_query
from .revenue_evidence import _COVERAGE_SQL, _STORE_SQL, _coverage, _freshness

_NOT_CANCELLED = "(o.recovery_status IS NULL OR o.recovery_status NOT IN ('cancelled','canceled','voided','deleted'))"
_SCOPE = "s.organization_id = :org_id AND s.status IN ('active','connected','syncing')"

# Counts are intentionally defined independently: a customer who repeats within
# the window need not be a first-time customer, and a returning customer need
# not place two orders inside the window.
_AGGREGATE_SQL = f"""
SELECT COUNT(DISTINCT o.customer_id) AS ordering_customers,
 COUNT(*) AS customer_associated_orders,
 COUNT(DISTINCT CASE WHEN (SELECT COUNT(*) FROM orders w
   WHERE w.store_id=o.store_id AND w.customer_id=o.customer_id
    AND w.ordered_at>=:start AND w.ordered_at<:end
    AND (w.recovery_status IS NULL OR w.recovery_status NOT IN ('cancelled','canceled','voided','deleted'))
 ) > 1 THEN o.customer_id END) AS repeat_within_window_customers,
 COUNT(DISTINCT CASE WHEN EXISTS (SELECT 1 FROM orders p
   WHERE p.store_id=o.store_id AND p.customer_id=o.customer_id AND p.ordered_at<:start
    AND (p.recovery_status IS NULL OR p.recovery_status NOT IN ('cancelled','canceled','voided','deleted'))
 ) THEN o.customer_id END) AS returning_customers,
 COUNT(DISTINCT CASE WHEN NOT EXISTS (SELECT 1 FROM orders p
   WHERE p.store_id=o.store_id AND p.customer_id=o.customer_id AND p.ordered_at<:start
    AND (p.recovery_status IS NULL OR p.recovery_status NOT IN ('cancelled','canceled','voided','deleted'))
 ) THEN o.customer_id END) AS first_time_customers
FROM orders o JOIN stores s ON s.id=o.store_id
WHERE {_SCOPE} AND o.ordered_at>=:start AND o.ordered_at<:end AND {_NOT_CANCELLED}
"""

_INTERVAL_SQL = f"""
WITH eligible AS (
 SELECT o.store_id,o.customer_id,o.ordered_at,
  ROW_NUMBER() OVER (PARTITION BY o.store_id,o.customer_id ORDER BY o.ordered_at,o.id) AS sequence
 FROM orders o JOIN stores s ON s.id=o.store_id
 WHERE {_SCOPE} AND o.ordered_at<:end AND {_NOT_CANCELLED}
), intervals AS (
 SELECT EXTRACT(EPOCH FROM (second.ordered_at-first.ordered_at))/86400.0 AS days
 FROM eligible first JOIN eligible second
  ON second.store_id=first.store_id AND second.customer_id=first.customer_id AND second.sequence=2
 WHERE first.sequence=1 AND second.ordered_at>=:start AND second.ordered_at<:end
)
SELECT COUNT(*) AS observed_second_purchases,
 AVG(days) AS mean_days,
 percentile_cont(0.5) WITHIN GROUP (ORDER BY days) AS median_days
FROM intervals
"""

_COHORT_SQL = f"""
WITH eligible AS (
 SELECT o.store_id,o.customer_id,o.ordered_at,
  ROW_NUMBER() OVER (PARTITION BY o.store_id,o.customer_id ORDER BY o.ordered_at,o.id) AS sequence
 FROM orders o JOIN stores s ON s.id=o.store_id
 WHERE {_SCOPE} AND o.ordered_at<:end AND {_NOT_CANCELLED}
), entry AS (
 SELECT store_id,customer_id,ordered_at AS entered_at FROM eligible WHERE sequence=1
), repeats AS (
 SELECT store_id,customer_id,MIN(ordered_at) AS second_at FROM eligible WHERE sequence>1 GROUP BY store_id,customer_id
)
SELECT to_char(date_trunc('month',e.entered_at AT TIME ZONE :timezone),'YYYY-MM') AS cohort,
 COUNT(*) AS entered_customers,
 COUNT(*) FILTER (WHERE r.second_at IS NOT NULL AND r.second_at<e.entered_at+INTERVAL '90 days'
                  AND e.entered_at+INTERVAL '90 days'<:end) AS repeat_within_90d_customers,
 COUNT(*) FILTER (WHERE e.entered_at+INTERVAL '90 days'>=:end) AS immature_customers,
 MIN(e.entered_at) AS first_entry_at,MAX(e.entered_at) AS last_entry_at
FROM entry e LEFT JOIN repeats r ON r.store_id=e.store_id AND r.customer_id=e.customer_id
WHERE e.entered_at>=:start AND e.entered_at<:end
GROUP BY 1 ORDER BY 1 LIMIT 24
"""


def _get(row: Any, key: str, default=None):
    try:
        return row[key]
    except (KeyError, IndexError, TypeError):
        return getattr(row, key, default)


def _int(row: Any, key: str) -> int | None:
    value = _get(row, key)
    if isinstance(value, bool):
        return None
    try:
        result = int(value)
    except (TypeError, ValueError):
        return None
    return result if result >= 0 else None


def _ratio(numerator: int | None, denominator: int | None) -> Decimal | None:
    if numerator is None or not denominator:
        return None
    return Decimal(numerator) / Decimal(denominator)


def _item(metric: str, label: str, value: Any, *, window: dict, definition: str,
          coverage: dict, freshness: dict, unit: str = "count", status: str = STATUS_AVAILABLE,
          limitations: list[str] | None = None, discriminator: str = "") -> dict:
    return evidence_item(metric, label=label, value=value, unit=unit, window=window,
        source="orders", definition=definition, coverage=coverage, freshness=freshness,
        status=status, limitations=limitations or [], domain="customers", discriminator=discriminator,
        classification="deterministic_calculation",
        provenance={"retrieval": "aggregate", "transformation": definition,
                    "calculation_version": "retention-v1", "lineage": ["orders.customer_id", "orders.ordered_at"],
                    "reproducible": True})


def retention_comparison_changes(current_items: list[dict], previous_items: list[dict]) -> list[dict]:
    """Currency-free, same-definition percent changes for retention trends."""
    metrics = {"ordering_customer_count", "repeat_within_window_customer_count",
               "repeat_within_window_customer_rate", "returning_customer_count", "returning_customer_rate"}
    changes: list[dict] = []
    for current in current_items:
        metric = current.get("metric")
        if metric not in metrics or current.get("status") not in {STATUS_AVAILABLE, "verified_zero"}:
            continue
        previous = next((item for item in previous_items if item.get("metric") == metric
                         and item.get("status") in {STATUS_AVAILABLE, "verified_zero"}), None)
        if not previous:
            continue
        try:
            current_value, previous_value = Decimal(str(current["value"])), Decimal(str(previous["value"]))
        except Exception:
            continue
        percent = ((current_value - previous_value) / previous_value * 100) if previous_value else None
        changes.append({"metric": metric, "current": current_value, "previous": previous_value,
            "percent": percent, "direction": "up" if percent is not None and percent > 0 else "down" if percent is not None and percent < 0 else "flat",
            "status": STATUS_AVAILABLE if percent is not None else STATUS_UNAVAILABLE,
            "current_evidence_id": current["id"], "previous_evidence_id": previous["id"], "currency": None})
    return changes


def retrieve_retention_evidence(organization_id: str, db, *, start: datetime, end: datetime,
                                now: datetime | None = None, timezone: str = "UTC") -> dict:
    start, end = ensure_utc(start), ensure_utc(end)
    if end <= start:
        raise ValueError("end must be after start")
    now = ensure_utc(now or utc_now())
    window = period(start, end, timezone_label=timezone)
    stores, store_error = safe_query(db, _STORE_SQL, {"org_id": organization_id})
    if store_error or not stores:
        return {"items": [], "warnings": ["authorized_store_scope_unavailable" if store_error else "no_authorized_store"],
                "limitations": [], "overall_status": STATUS_UNAVAILABLE, "coverage": {"complete": False}}
    coverage_rows, coverage_error = safe_query(db, _COVERAGE_SQL, {"org_id": organization_id})
    coverage = _coverage(stores, coverage_rows, start, end)
    freshness = _freshness(stores, now)
    lifetime_verified = (not coverage_error and coverage.get("complete") and len(coverage_rows or []) >= len(stores)
                         and all(_get(row, "customer_lifetime_verified") is True for row in coverage_rows))
    params = {"org_id": organization_id, "start": start, "end": end, "timezone": timezone}
    rows, error = safe_query(db, _AGGREGATE_SQL, params)
    warnings: list[str] = []
    limitations = [
        "Customer identity is the stable store/customer association on non-cancelled orders; anonymous activity is excluded.",
        "Repeat behavior is not satisfaction, loyalty, churn probability, purchase intent or campaign effectiveness.",
    ]
    if error:
        return {"items": [], "warnings": ["retention_aggregate_unavailable"], "limitations": limitations,
                "overall_status": STATUS_UNAVAILABLE, "coverage": coverage}
    # A single production row is expected. Summing fixture/partition rows is safe
    # only because production customer UUIDs are globally unique and not grouped
    # by currency; currency never partitions a retention population.
    total = {key: sum(value for row in rows if (value := _int(row, key)) is not None)
             for key in ("ordering_customers", "customer_associated_orders", "repeat_within_window_customers",
                         "returning_customers", "first_time_customers")}
    invalid = any(_int(row, "ordering_customers") is None for row in rows)
    if invalid:
        return {"items": [], "warnings": ["retention_aggregate_invalid"], "limitations": limitations,
                "overall_status": STATUS_UNAVAILABLE, "coverage": coverage}
    items: list[dict] = []
    items.append(_item("ordering_customer_count", "Ordering customers", total["ordering_customers"],
        window=window, definition="Distinct stable customer identities with at least one non-cancelled order in [start,end).",
        coverage=coverage, freshness=freshness))
    items.append(_item("customer_associated_order_count", "Customer-associated orders", total["customer_associated_orders"],
        window=window, definition="Non-cancelled orders in the window with a stable customer association.",
        coverage=coverage, freshness=freshness))
    items.append(_item("repeat_within_window_customer_count", "Customers repeating within this window",
        total["repeat_within_window_customers"], window=window,
        definition="Distinct ordering customers with at least two non-cancelled orders inside the same window.",
        coverage=coverage, freshness=freshness))
    repeat_rate = _ratio(total["repeat_within_window_customers"], total["ordering_customers"])
    items.append(_item("repeat_within_window_customer_rate", "Within-window repeat-purchase rate",
        repeat_rate, window=window, unit=UNIT_RATIO,
        definition="repeat_within_window_customer_count / ordering_customer_count for the same window; the rate is undefined when the denominator is zero.",
        coverage=coverage, freshness=freshness,
        status=STATUS_UNAVAILABLE if not total["ordering_customers"] else STATUS_AVAILABLE if coverage.get("complete") else STATUS_PARTIAL,
        limitations=["No ordering customers are in the eligible population, so the rate denominator is zero."] if not total["ordering_customers"] else []))
    historical_status = STATUS_AVAILABLE if lifetime_verified else STATUS_UNAVAILABLE
    historical_limit = [] if lifetime_verified else [
        "Certified lifetime customer-order history is incomplete; newly observed is not first-time and absence of an earlier order is not proof of acquisition or churn."
    ]
    for metric, label, key, definition in (
        ("returning_customer_count", "Returning customers", "returning_customers",
         "Ordering customers with a non-cancelled order before the window; requires certified lifetime history."),
        ("first_time_customer_count", "First-time customers", "first_time_customers",
         "Ordering customers whose first lifetime non-cancelled order is in the window; requires certified lifetime history."),
    ):
        items.append(_item(metric, label, total[key] if lifetime_verified else None, window=window,
            definition=definition, coverage=coverage, freshness=freshness, status=historical_status,
            limitations=historical_limit))
    returning_rate = _ratio(total["returning_customers"], total["ordering_customers"]) if lifetime_verified else None
    items.append(_item("returning_customer_rate", "Returning-customer rate", returning_rate,
        window=window, unit=UNIT_RATIO, definition="returning_customer_count / ordering_customer_count; not a repeat-order rate and undefined when the denominator is zero.",
        coverage=coverage, freshness=freshness,
        status=STATUS_UNAVAILABLE if not total["ordering_customers"] else historical_status,
        limitations=historical_limit + (["No ordering customers are in the eligible population, so the rate denominator is zero."] if not total["ordering_customers"] else [])))
    if not lifetime_verified:
        warnings.append("customer_lifetime_history_uncertified")
        items.append(_item("newly_observed_customer_count", "Newly observed customers",
            total["first_time_customers"], window=window,
            definition="Customers with no earlier retained order; not necessarily genuinely first-time when lifetime history is incomplete.",
            coverage=coverage, freshness=freshness, status=STATUS_PARTIAL, limitations=historical_limit))

    if lifetime_verified:
        interval_rows, interval_error = safe_query(db, _INTERVAL_SQL, params)
        if interval_error:
            warnings.append("repeat_interval_unavailable")
        else:
            row = interval_rows[0] if interval_rows else {}
            count = _int(row, "observed_second_purchases") or 0
            items.append(_item("repeat_purchase_interval_days", "First-to-second purchase interval",
                {"observed_second_purchases": count,
                 "mean_days": str(decimal_value(_get(row, "mean_days"))) if decimal_value(_get(row, "mean_days")) is not None else None,
                 "median_days": str(decimal_value(_get(row, "median_days"))) if decimal_value(_get(row, "median_days")) is not None else None,
                 "maturity": "Only customers with an observed second purchase contribute; no-repeat and right-censored customers are not assigned an interval."},
                window=window, unit="record", definition="Elapsed UTC days between each customer's first and second lifetime non-cancelled orders, where the second order is in the window.",
                coverage=coverage, freshness=freshness))
        cohort_rows, cohort_error = safe_query(db, _COHORT_SQL, params)
        if cohort_error:
            warnings.append("customer_cohorts_unavailable")
        else:
            for row in cohort_rows:
                entered, repeated, immature = _int(row, "entered_customers"), _int(row, "repeat_within_90d_customers"), _int(row, "immature_customers")
                if entered is None or repeated is None or immature is None:
                    continue
                mature = entered - immature
                items.append(_item("customer_cohort_90d", f"Acquisition cohort {_get(row, 'cohort')}",
                    {"cohort": _get(row, "cohort"), "entered_customers": entered,
                     "repeat_within_90d_customers": repeated, "mature_customers": mature,
                     "immature_customers": immature,
                     "repeat_within_90d_rate": str(_ratio(repeated, mature)) if mature else None,
                     "observation_window_days": 90,
                     "entry_rule": "First lifetime non-cancelled order in the merchant-calendar month."},
                    window=window, unit="record", definition="First-order monthly cohorts; rate denominator is customers with a complete 90-day observation window, not all entered customers.",
                    coverage=coverage, freshness=freshness, discriminator=str(_get(row, "cohort")),
                    limitations=["Cohorts with different maturity are not directly comparable; no campaign effect or future LTV is inferred."]))
    status = STATUS_AVAILABLE if not warnings and all(item["status"] == STATUS_AVAILABLE for item in items) else STATUS_PARTIAL
    return {"schema_version": EVIDENCE_SCHEMA_VERSION, "items": items, "warnings": warnings,
            "limitations": limitations, "coverage": {**coverage, "customer_lifetime_verified": lifetime_verified},
            "freshness": freshness, "overall_status": status, "generated_at": iso(now)}
