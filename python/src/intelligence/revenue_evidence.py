"""Currency-explicit revenue evidence (Task 198 / Rev Intelligence).

Only orders belonging to stores owned by the authenticated organization are
read.  Cancelled orders are excluded, the window is half-open, and currencies
are never summed together.  A verified zero is reported as ``0``; a monetary
total that cannot be attributed to a single currency is ``unsupported`` with a
``null`` value, never ``0`` and never a substituted USD figure.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

from .evidence import (
    STATUS_AVAILABLE,
    STATUS_PARTIAL,
    STATUS_UNAVAILABLE,
    STATUS_UNSUPPORTED,
    UNIT_COUNT,
    UNIT_CURRENCY,
    decimal_value,
    describe_period,
    ensure_utc,
    evidence_item,
    group_by_currency,
    iso,
    money,
    normalize_currency,
    period,
    previous_period,
    utc_now,
)
from .query import safe_query

ACTIVE_STORE_STATUSES = ("active", "connected", "syncing")
EXCLUDED_ORDER_STATUSES = ("cancelled", "canceled", "voided", "deleted")

_STORE_SQL = f"""
    SELECT id, last_synced_at, status
    FROM stores
    WHERE organization_id = :org_id
      AND status IN ({", ".join("'" + status + "'" for status in ACTIVE_STORE_STATUSES)})
"""

_COVERAGE_SQL = f"""
    SELECT c.store_id, c.coverage_start, c.coverage_end, c.certified_at,
           c.customer_lifetime_verified
    FROM intelligence_order_coverage c
    JOIN stores s ON s.id = c.store_id
    WHERE s.organization_id = :org_id
      AND s.status IN ({", ".join("'" + status + "'" for status in ACTIVE_STORE_STATUSES)})
"""

_ORDER_SQL = f"""
    SELECT o.currency,
           COUNT(*) AS order_count,
           COALESCE(SUM(o.total), 0) AS order_value
    FROM orders o
    JOIN stores s ON s.id = o.store_id
    WHERE s.organization_id = :org_id
      AND s.status IN ({", ".join("'" + status + "'" for status in ACTIVE_STORE_STATUSES)})
      AND o.ordered_at >= :start
      AND o.ordered_at < :end
      AND (o.recovery_status IS NULL
           OR o.recovery_status NOT IN ({", ".join("'" + status + "'" for status in EXCLUDED_ORDER_STATUSES)}))
    GROUP BY o.currency
    ORDER BY o.currency
"""


def _row_value(row: Any, key: str, default=None):
    try:
        return row[key]
    except (KeyError, IndexError, TypeError):
        return getattr(row, key, default)


def _freshness(stores: list, now: datetime) -> dict:
    timestamps = []
    for store in stores:
        value = _row_value(store, "last_synced_at")
        if isinstance(value, datetime):
            timestamps.append(ensure_utc(value))
    if not timestamps:
        return {"state": "unknown", "as_of": None,
                "note": "No completed store sync timestamp is available."}
    oldest = min(timestamps)
    age_minutes = max(0.0, (now - oldest).total_seconds() / 60)
    return {
        "state": "fresh" if age_minutes <= 60 else "stale",
        "as_of": iso(oldest),
        "age_minutes": round(age_minutes, 1),
        "note": "Age of the oldest completed store sync in scope.",
    }


def _coverage(stores: list, coverage_rows: list | None, start: datetime,
              end: datetime) -> dict:
    certified = []
    incomplete = []
    for row in coverage_rows or []:
        store_id = _row_value(row, "store_id")
        coverage_start = _row_value(row, "coverage_start")
        coverage_end = _row_value(row, "coverage_end")
        if not isinstance(coverage_start, datetime) or not isinstance(coverage_end, datetime):
            continue
        coverage_start = ensure_utc(coverage_start)
        coverage_end = ensure_utc(coverage_end)
        if coverage_start <= start and coverage_end >= end:
            certified.append(str(store_id))
        else:
            incomplete.append(str(store_id))
    total = len(stores)
    return {
        "store_count": total,
        "certified_store_count": len(certified),
        "incomplete_store_count": len(incomplete),
        "complete": total > 0 and len(certified) == total,
        "source": "intelligence_order_coverage",
        "note": ("Every store in scope certifies order coverage for this window."
                 if total and len(certified) == total
                 else "Order coverage is not certified for every store in this window."),
    }


def retrieve_revenue_evidence(
    organization_id: str,
    db,
    *,
    start: datetime,
    end: datetime,
    now: datetime | None = None,
    label: str | None = None,
    compare: bool = False,
) -> dict:
    """Return currency-separated revenue evidence for an organization.

    The caller must pass the organization taken from the authenticated request
    context.  A client-supplied organization or store identifier is never
    accepted here.
    """
    if not organization_id or not isinstance(organization_id, str):
        raise ValueError("Authenticated organization is required")
    start = ensure_utc(start, field="start")
    end = ensure_utc(end, field="end")
    if end <= start:
        raise ValueError("end must be after start")
    now = ensure_utc(now or utc_now(), field="now")
    window = period(start, end, label=label)
    warnings: list[str] = []
    items: list[dict] = []

    stores, store_error = safe_query(db, _STORE_SQL, {"org_id": organization_id})
    if store_error:
        warnings.append("Store scope could not be read; no revenue claim is possible.")
        return _empty_result(organization_id, window, now, warnings,
                            overall_status=STATUS_UNAVAILABLE,
                            reason="store_scope_query_failed")
    if not stores:
        warnings.append("No active or connected store is available for this organization.")
        return _empty_result(organization_id, window, now, warnings,
                            overall_status=STATUS_UNAVAILABLE,
                            reason="no_connected_store")

    freshness = _freshness(stores, now)
    coverage_rows, coverage_error = safe_query(db, _COVERAGE_SQL, {"org_id": organization_id})
    coverage = _coverage(stores, coverage_rows, start, end)
    if coverage_error:
        coverage["complete"] = False
        coverage["note"] = "Order coverage could not be read; totals are not certified."
        warnings.append("Order coverage certification is unavailable.")

    rows, order_error = safe_query(db, _ORDER_SQL, {
        "org_id": organization_id, "start": start, "end": end,
    })
    overall_status = STATUS_AVAILABLE
    if order_error:
        overall_status = STATUS_UNAVAILABLE
        warnings.append("Order records could not be read for this window.")
        items.append(evidence_item(
            "recorded_order_count", label="Recorded order count", value=None,
            unit=UNIT_COUNT, window=window, source="orders", status=STATUS_UNAVAILABLE,
            definition="Count of non-cancelled orders with ordered_at in [start, end).",
            coverage=coverage, freshness=freshness,
            limitations=["The order query failed, so no count is asserted."],
        ))
        items.append(evidence_item(
            "recorded_order_value", label="Recorded order value", value=None,
            unit=UNIT_CURRENCY, window=window, source="orders", status=STATUS_UNAVAILABLE,
            definition="Sum of persisted order totals for non-cancelled orders.",
            coverage=coverage, freshness=freshness,
            limitations=["The order query failed, so no monetary value is asserted."],
        ))
    else:
        currency_rows = []
        for row in rows:
            raw_currency = _row_value(row, "currency")
            code = normalize_currency(raw_currency)
            count = _row_value(row, "order_count", 0)
            value = _row_value(row, "order_value", 0)
            try:
                count = int(count)
            except (TypeError, ValueError):
                count = None
            if code is None:
                warnings.append(
                    "Orders without a valid ISO currency code were excluded from monetary totals."
                )
                continue
            if count is None or decimal_value(value) is None:
                warnings.append("An order aggregate could not be validated and was excluded.")
                continue
            currency_rows.append((code, count, value))

        if not currency_rows:
            verified_zero = sum(int(_row_value(row, "order_count", 0) or 0) for row in rows) == 0
            count_status = STATUS_AVAILABLE if verified_zero else STATUS_UNAVAILABLE
            items.append(evidence_item(
                "recorded_order_count", label="Recorded order count",
                value=0 if verified_zero else None, unit=UNIT_COUNT, window=window,
                source="orders", status=count_status,
                definition="Count of non-cancelled orders with ordered_at in [start, end).",
                coverage=coverage, freshness=freshness,
                limitations=["No non-cancelled orders are recorded in this window."],
            ))
            items.append(evidence_item(
                "recorded_order_value", label="Recorded order value", value=None,
                unit=UNIT_CURRENCY, window=window, source="orders",
                status=STATUS_UNSUPPORTED,
                definition="Sum of persisted order totals for non-cancelled orders.",
                coverage=coverage, freshness=freshness,
                limitations=["No currency can be attributed to an empty order set."],
                discriminator="currencyless-zero",
            ))
        else:
            for code, count, value in currency_rows:
                items.append(evidence_item(
                    "recorded_order_count", label=f"Recorded order count ({code})",
                    value=count, unit=UNIT_COUNT, window=window, source="orders",
                    coverage=coverage, freshness=freshness, currency=code,
                    definition="Count of non-cancelled orders with ordered_at in [start, end).",
                    discriminator=code,
                ))
                items.append(evidence_item(
                    "recorded_order_value", label=f"Recorded order value ({code})",
                    value=value, unit=UNIT_CURRENCY, currency=code, window=window,
                    source="orders", coverage=coverage, freshness=freshness,
                    definition=("Sum of persisted net order totals for non-cancelled orders. "
                                "Each order total is net of refunds: Shopify sync stores the "
                                "refund-adjusted current total, so full and partial refunds are "
                                "reflected once, not subtracted twice. Gross value is "
                                "total + refunded_total where refunded_total is recorded."),
                    limitations=["Recorded net order value (after refunds), not recognised or settled revenue."],
                ))
            if not coverage["complete"]:
                overall_status = STATUS_PARTIAL
        if order_error is None and coverage_error is None and not coverage["complete"]:
            overall_status = STATUS_PARTIAL
        # Refunds are folded into the persisted order total by ingestion. The
        # absence of an itemised refund ledger must be explicit.
        items.append(evidence_item(
            "refund_adjustment", label="Itemised refund ledger", value=None,
            unit=UNIT_CURRENCY, window=window, source="orders",
            status=STATUS_UNAVAILABLE,
            definition=("Per-order refunded amount (orders.refunded_total) recorded "
                        "alongside the net order total. Individual refund transactions "
                        "are not stored."),
            coverage=coverage, freshness=freshness,
            limitations=["Refunds are reflected inside persisted net order totals and a "
                         "per-order refunded_total; no per-transaction refund ledger is "
                         "stored, and no aggregate refund total is exposed yet."],
            discriminator="refund-ledger",
        ))

    comparison = None
    if compare:
        prev_start, prev_end = previous_period(start, end)
        previous = retrieve_revenue_evidence(
            organization_id, db, start=prev_start, end=prev_end, now=now,
            label="previous period", compare=False,
        )
        comparison = {
            "period": previous["period"],
            "overall_status": previous["overall_status"],
            "items": previous["items"],
            "changes": _changes(previous["items"], items),
        }

    result = {
        "schema_version": "rev-evidence-v1",
        "metric_family": "revenue",
        "organization_scope": {
            "type": "authenticated_organization",
            "store_count": len(stores),
            "coverage": coverage,
        },
        "period": window,
        "window_semantics": "[start, end)",
        "overall_status": overall_status,
        "items": items,
        "by_currency": group_by_currency(items),
        "freshness": freshness,
        "coverage": coverage,
        "warnings": list(dict.fromkeys(warnings)),
        "limitations": [
            "Persisted order totals are recorded values, not audited net revenue.",
            "Cancelled orders are excluded from both count and value.",
            "Currencies are reported separately and never summed.",
        ],
    }
    if comparison is not None:
        result["comparison"] = comparison
    return result


def _changes(previous_items: list[dict], current_items: list[dict]) -> list[dict]:
    """Currency-matched period changes; no cross-currency comparison."""
    def index(items: list[dict], metric: str) -> dict:
        result = {}
        for item in items:
            if item.get("metric") == metric and item.get("status") == STATUS_AVAILABLE:
                key = item.get("currency") or "__none__"
                result[key] = item
        return result

    changes = []
    current = index(current_items, "recorded_order_value")
    previous = index(previous_items, "recorded_order_value")
    for currency in sorted(set(current) & set(previous)):
        change = _percent(current[currency].get("value"), previous[currency].get("value"))
        if change["status"] != STATUS_AVAILABLE:
            continue
        changes.append({
            "metric": "recorded_order_value",
            "currency": currency,
            "current": current[currency]["value"],
            "previous": previous[currency]["value"],
            "percent": change["percent"],
            "direction": change["direction"],
            "status": STATUS_AVAILABLE,
            "definition": "Currency-matched change between equal-length periods.",
            "current_evidence_id": current[currency]["id"],
            "previous_evidence_id": previous[currency]["id"],
        })
    current_count = index(current_items, "recorded_order_count")
    previous_count = index(previous_items, "recorded_order_count")
    for currency in sorted(set(current_count) & set(previous_count)):
        change = _percent(current_count[currency].get("value"), previous_count[currency].get("value"))
        if change["status"] != STATUS_AVAILABLE:
            continue
        changes.append({
            "metric": "recorded_order_count",
            "currency": currency,
            "current": current_count[currency]["value"],
            "previous": previous_count[currency]["value"],
            "percent": change["percent"],
            "direction": change["direction"],
            "status": STATUS_AVAILABLE,
            "definition": "Currency-scoped order-count change between equal-length periods.",
            "current_evidence_id": current_count[currency]["id"],
            "previous_evidence_id": previous_count[currency]["id"],
        })
    return changes


def _percent(current: Any, previous: Any) -> dict:
    current_value = decimal_value(current)
    previous_value = decimal_value(previous)
    if current_value is None or previous_value is None or previous_value <= 0:
        return {"status": STATUS_UNSUPPORTED}
    change = (current_value - previous_value) / previous_value * Decimal(100)
    return {
        "status": STATUS_AVAILABLE,
        "percent": str(change.quantize(Decimal("0.1"))),
        "direction": "up" if change > 0 else "down" if change < 0 else "flat",
    }


def _empty_result(organization_id: str, window: dict, now: datetime,
                  warnings: list[str], *, overall_status: str, reason: str) -> dict:
    return {
        "schema_version": "rev-evidence-v1",
        "metric_family": "revenue",
        "organization_scope": {
            "type": "authenticated_organization",
            "store_count": 0,
            "coverage": {"complete": False, "store_count": 0, "certified_store_count": 0,
                         "reason": reason},
        },
        "period": window,
        "window_semantics": "[start, end)",
        "overall_status": overall_status,
        "items": [],
        "by_currency": {},
        "freshness": {"state": "unknown", "as_of": None},
        "coverage": {"complete": False},
        "warnings": warnings,
        "limitations": ["No verified store data is available, so no metric is asserted."],
        "reason": reason,
        "generated_at": iso(now),
    }
