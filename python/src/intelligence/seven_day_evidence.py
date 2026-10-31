"""Read-only, organization-scoped evidence for Rev's seven-day store briefing.

All timestamps use a half-open UTC window [start, end). Monetary values are
reported separately per currency; unlike currencies must never be summed.
A successful query returning zero is distinct from a failed query.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from sqlalchemy import text


def _money(value):
    return str(Decimal(str(value or 0)))


def _rows_by_currency(rows, count_key, total_key):
    result = []
    for row in rows:
        count = int(row["item_count"])
        total = Decimal(str(row["amount"] or 0))
        result.append({
            "currency": row["currency"] or "UNKNOWN",
            count_key: count,
            total_key: str(total),
            **({"average_order_value": str(total / count)} if count_key == "order_count" and count else {}),
        })
    return result


def retrieve_seven_day_evidence(organization_id: str, db, *, now: datetime | None = None) -> dict:
    """Query only stores belonging to the server-authenticated organization.

    organization_id must come from the authenticated API context, never from a
    chat message or client-selected store ID. No customer PII is returned.
    """
    if not organization_id:
        raise ValueError("Authenticated organization is required")
    end = now or datetime.now(timezone.utc)
    if end.tzinfo is None or end.utcoffset() is None:
        raise ValueError("now must be timezone-aware")
    end = end.astimezone(timezone.utc)
    start = end - timedelta(days=7)
    params = {"org_id": organization_id, "start": start, "end": end}
    evidence = {
        "period_start_utc": start.isoformat(),
        "period_end_utc": end.isoformat(),
        "window_semantics": "[start, end)",
        "store_count": 0,
        "last_store_sync_at": None,
        "orders": {"status": "unavailable", "by_currency": []},
        "abandoned_carts": {"status": "unavailable", "by_currency": []},
        "recovered_carts": {"status": "unavailable", "count": None},
        "checkout_activity": {"status": "unavailable", "reason": "No verified checkout-event query is configured."},
        "warnings": [],
    }
    stores = db.execute(text("""
        SELECT id, last_synced_at FROM stores
        WHERE organization_id = :org_id AND status IN ('active', 'connected', 'syncing')
    """), {"org_id": organization_id}).mappings().all()
    evidence["store_count"] = len(stores)
    syncs = [r["last_synced_at"] for r in stores if r["last_synced_at"] is not None]
    if syncs:
        evidence["last_store_sync_at"] = min(syncs).isoformat()
    else:
        evidence["warnings"].append("No completed store sync timestamp is available.")
    if not stores:
        evidence["warnings"].append("No active or connected stores found for this organization.")
        return evidence

    # Query through the stores table in each statement, not a caller-supplied
    # list of store IDs. This prevents cross-tenant reads if parameters change.
    try:
        rows = db.execute(text("""
            SELECT o.currency, COUNT(*) AS item_count, COALESCE(SUM(o.total), 0) AS amount
            FROM orders o JOIN stores s ON s.id = o.store_id
            WHERE s.organization_id = :org_id
              AND s.status IN ('active', 'connected', 'syncing')
              AND o.ordered_at >= :start AND o.ordered_at < :end
            GROUP BY o.currency ORDER BY o.currency
        """), params).mappings().all()
        evidence["orders"] = {"status": "available", "by_currency": _rows_by_currency(rows, "order_count", "gross_recorded_order_value")}
        evidence["warnings"].append("Order totals are recorded values; refunds/cancellations are not verified as net revenue.")
    except Exception:
        evidence["warnings"].append("Order data could not be retrieved.")
        db.rollback()

    try:
        rows = db.execute(text("""
            WITH ranked AS (
                SELECT c.store_id, c.currency, c.cart_value,
                       ROW_NUMBER() OVER (
                           PARTITION BY c.store_id,
                             COALESCE(NULLIF(c.external_cart_id, ''), c.id::text)
                           ORDER BY c.updated_at DESC NULLS LAST,
                                    c.created_at DESC NULLS LAST, c.id DESC
                       ) AS rn
                FROM abandoned_carts c JOIN stores s ON s.id = c.store_id
                WHERE s.organization_id = :org_id
                  AND s.status IN ('active', 'connected', 'syncing')
                  AND c.abandoned_at >= :start AND c.abandoned_at < :end
                  AND c.status = 'abandoned' AND c.recovered_at IS NULL
            )
            SELECT currency, COUNT(*) AS item_count,
                   COALESCE(SUM(cart_value), 0) AS amount
            FROM ranked WHERE rn = 1
            GROUP BY currency ORDER BY currency
        """), params).mappings().all()
        evidence["abandoned_carts"] = {"status": "available", "by_currency": _rows_by_currency(rows, "cart_count", "cart_value"), "definition": "Unique unrecovered abandoned carts per store and external cart ID; most recently updated record retained."}
        evidence["warnings"].append("Cart totals are deduplicated recorded values, not verified recoverable revenue; reconcile with Shopify Admin.")
    except Exception:
        evidence["warnings"].append("Abandoned-cart data could not be retrieved.")
        db.rollback()

    try:
        count = db.execute(text("""
            SELECT COUNT(*) FROM abandoned_carts c JOIN stores s ON s.id = c.store_id
            WHERE s.organization_id = :org_id
              AND s.status IN ('active', 'connected', 'syncing')
              AND c.recovered_at >= :start AND c.recovered_at < :end
        """), params).scalar()
        evidence["recovered_carts"] = {"status": "available", "count": int(count or 0),
            "definition": "Carts with recovered_at in the seven-day window, regardless of abandonment date."}
    except Exception:
        evidence["warnings"].append("Recovered-cart data could not be retrieved.")
        db.rollback()
    return evidence


# Task 198: revenue-specific contract evidence. Kept beside the existing seven-day
# evidence retrieval so callers share the established organization-scoped source.
from uuid import uuid4

REVENUE_FRESHNESS_THRESHOLD_SECONDS = 30 * 60
TRUSTED_ORDER_COVERAGE_SOURCE = "shopify_verified_history_v1"


def retrieve_revenue_evidence(
    organization_id: str,
    db,
    *,
    start: datetime,
    end: datetime,
    now: datetime | None = None,
) -> dict:
    """Retrieve contract-shaped recorded-order evidence for authorized Shopify stores.

    This function deliberately does not call recorded order value gross or net
    revenue. orders.total is the persisted Shopify current/refund-adjusted order
    total where source synchronization supplied that field. Coverage is
    available only when every selected store has a trusted attestation for the
    complete half-open period and a known fresh sync timestamp.
    """
    if not organization_id:
        raise ValueError("Authenticated organization is required")
    if not isinstance(start, datetime) or not isinstance(end, datetime):
        raise ValueError("Revenue period boundaries must be datetimes")
    if start.tzinfo is None or start.utcoffset() is None or end.tzinfo is None or end.utcoffset() is None:
        raise ValueError("Revenue period boundaries must be timezone-aware")
    start = start.astimezone(timezone.utc)
    end = end.astimezone(timezone.utc)
    if end <= start:
        raise ValueError("Revenue period end must be after start")
    observed_at = now or datetime.now(timezone.utc)
    if observed_at.tzinfo is None or observed_at.utcoffset() is None:
        raise ValueError("now must be timezone-aware")
    observed_at = observed_at.astimezone(timezone.utc)
    period = {
        "start": start.isoformat(),
        "end": end.isoformat(),
        "timezone": "UTC",
        "semantics": "[start,end)",
    }
    envelope = {
        "contract_version": "1.0",
        "request_id": str(uuid4()),
        "organization_scope": {"scope": "authorized_organization", "store_count": 0},
        "generated_at": observed_at.isoformat(),
        "overall_status": "unavailable",
        "period": period,
        "items": [],
        "warnings": [
            "Values are recorded Shopify order totals, not independently verified gross revenue or net revenue.",
            "Refunds are reflected in the persisted total when Shopify currentTotalPriceSet or successful refund transactions were received; no separate refund ledger is persisted for independent refund-value reporting.",
            "Cancelled orders are excluded using the persisted recovery_status. Payment/financial status is not a persisted orders column, so recorded orders are not asserted to be captured/settled payments.",
            "No store timezone is persisted. This retrieval accepts explicit UTC boundaries only; merchant-local calendar days and daylight-saving interpretation are unsupported.",
        ],
        "errors": [],
    }

    try:
        stores = db.execute(text("""
            SELECT id, status, last_synced_at
            FROM stores
            WHERE organization_id = :org_id
              AND platform = 'shopify'
              AND status IN ('active', 'connected', 'syncing')
            ORDER BY id
        """), {"org_id": organization_id}).mappings().all()
    except Exception:
        db.rollback()
        envelope["errors"].append({"code": "REVENUE_STORE_SCOPE_UNAVAILABLE"})
        envelope["warnings"].append("Authorized Shopify store scope could not be retrieved.")
        return envelope

    envelope["organization_scope"]["store_count"] = len(stores)
    if not stores:
        envelope["warnings"].append("No active or connected Shopify stores were found for this organization.")
        return envelope

    store_ids = [str(row["id"]) for row in stores]
    sync_times = []
    for row in stores:
        value = row["last_synced_at"]
        if value is not None:
            if value.tzinfo is None:
                value = value.replace(tzinfo=timezone.utc)
            sync_times.append(value.astimezone(timezone.utc))
    oldest_sync = min(sync_times) if len(sync_times) == len(stores) else None
    age_seconds = max(0, int((observed_at - oldest_sync).total_seconds())) if oldest_sync else None

    coverage_rows = []
    coverage_query_ok = False
    try:
        coverage_rows = db.execute(text("""
            SELECT store_id, coverage_start, coverage_end, certified_at, source, source_run_id
            FROM intelligence_order_coverage
            WHERE organization_id = :org_id
              AND store_id = ANY(CAST(:store_ids AS uuid[]))
              AND source = :trusted_source
        """), {
            "org_id": organization_id,
            "store_ids": store_ids,
            "trusted_source": TRUSTED_ORDER_COVERAGE_SOURCE,
        }).mappings().all()
        coverage_query_ok = True
    except Exception:
        db.rollback()
        envelope["warnings"].append("Trusted order-coverage attestations could not be retrieved.")

    coverage_by_store = {str(row["store_id"]): row for row in coverage_rows}
    fully_covered = []
    for store_id in store_ids:
        attestation = coverage_by_store.get(store_id)
        if not attestation:
            fully_covered.append(False)
            continue
        covered_start = attestation["coverage_start"]
        covered_end = attestation["coverage_end"]
        if covered_start.tzinfo is None:
            covered_start = covered_start.replace(tzinfo=timezone.utc)
        if covered_end.tzinfo is None:
            covered_end = covered_end.replace(tzinfo=timezone.utc)
        fully_covered.append(
            covered_start.astimezone(timezone.utc) <= start
            and covered_end.astimezone(timezone.utc) >= end
        )

    try:
        rows = db.execute(text("""
            SELECT
                COALESCE(NULLIF(UPPER(o.currency), ''), 'UNKNOWN') AS currency,
                COUNT(DISTINCT o.id) AS item_count,
                COALESCE(SUM(o.total), 0) AS amount
            FROM orders o
            JOIN stores s ON s.id = o.store_id
            WHERE s.organization_id = :org_id
              AND s.platform = 'shopify'
              AND s.status IN ('active', 'connected', 'syncing')
              AND o.ordered_at >= :start
              AND o.ordered_at < :end
              AND o.recovery_status IS DISTINCT FROM 'cancelled'
            GROUP BY COALESCE(NULLIF(UPPER(o.currency), ''), 'UNKNOWN')
            ORDER BY currency
        """), {"org_id": organization_id, "start": start, "end": end}).mappings().all()
    except Exception:
        db.rollback()
        envelope["errors"].append({"code": "REVENUE_ORDER_QUERY_FAILED"})
        envelope["warnings"].append("Order totals could not be retrieved; no zero value has been inferred.")
        return envelope

    if oldest_sync is None:
        status = "unknown"
        completeness = "unknown"
    elif age_seconds is not None and age_seconds > REVENUE_FRESHNESS_THRESHOLD_SECONDS:
        status = "stale"
        completeness = "known" if all(fully_covered) else "partial"
    elif coverage_query_ok and all(fully_covered):
        status = "available"
        completeness = "known"
    elif coverage_query_ok and not coverage_rows:
        status = "unknown"
        completeness = "unknown"
    elif coverage_rows and len(coverage_by_store) == len(store_ids) and start < min(
        (row["coverage_start"].replace(tzinfo=timezone.utc)
         if row["coverage_start"].tzinfo is None else row["coverage_start"]).astimezone(timezone.utc)
        for row in coverage_rows
    ) and end <= max(
        (row["coverage_end"].replace(tzinfo=timezone.utc)
         if row["coverage_end"].tzinfo is None else row["coverage_end"]).astimezone(timezone.utc)
        for row in coverage_rows
    ):
        status = "insufficient_history"
        completeness = "partial"
    elif coverage_query_ok:
        status = "partial"
        completeness = "partial"
    else:
        status = "unknown"
        completeness = "unknown"

    freshness = {
        "observed_at": observed_at.isoformat(),
        "source_synced_at": oldest_sync.isoformat() if oldest_sync else None,
        "age_seconds": age_seconds,
    }
    limitations = [
        "Only persisted orders with recovery_status other than cancelled are included.",
        "No payment/financial status is stored; pending/authorized orders cannot be separated from captured payments.",
        "Refund value is not independently itemized; use recorded_order_value only.",
    ]
    if status != "available":
        limitations.append("Complete source coverage for the entire requested period is not currently certified.")
    if status == "stale":
        limitations.append("The oldest selected Shopify store sync exceeds the 30-minute business-state freshness threshold.")
    if not coverage_query_ok:
        limitations.append("Coverage attestation lookup failed.")

    source = {
        "system": "shopify",
        "entity": "orders",
        "fields": ["orders.total", "orders.currency", "orders.ordered_at", "orders.recovery_status"],
        "record_count": sum(int(row["item_count"]) for row in rows),
    }
    scope = {"store_count": len(stores)}
    warnings = list(envelope["warnings"])
    if status != "available":
        warnings.append(f"Revenue evidence availability is {status}; values must not be presented as complete period totals.")
    if any(row["currency"] == "UNKNOWN" for row in rows):
        warnings.append("At least one order has no usable persisted currency; its value is isolated under UNKNOWN and is not combined with other currencies.")

    if not rows and status == "available":
        envelope["items"].append({
            "evidence_id": str(uuid4()),
            "domain": "revenue",
            "metric": "recorded_order_count",
            "value": 0,
            "unit": "orders",
            "status": "available",
            "epistemic_type": "observed",
            "source": {**source, "record_count": 0},
            "scope": scope,
            "period": period,
            "freshness": freshness,
            "coverage": {"completeness": "known", "is_truncated": False, "limitations": limitations},
            "calculation": None,
            "warnings": [],
        })
        envelope["items"].append({
            "evidence_id": str(uuid4()),
            "domain": "revenue",
            "metric": "recorded_order_value",
            "value": None,
            "unit": "money",
            "currency": None,
            "status": "unsupported",
            "epistemic_type": "observed",
            "source": {**source, "record_count": 0},
            "scope": scope,
            "period": period,
            "freshness": freshness,
            "coverage": {"completeness": "known", "is_truncated": False, "limitations": ["Store base currency is not persisted, so a zero monetary value cannot be assigned a verified currency."]},
            "calculation": None,
            "warnings": ["No qualifying orders were recorded in a fully covered period; the store currency is unknown."],
        })
    else:
        for row in rows:
            currency = row["currency"]
            count = int(row["item_count"])
            amount = Decimal(str(row["amount"] or 0))
            count_id = str(uuid4())
            value_id = str(uuid4())
            envelope["items"].append({
                "evidence_id": count_id,
                "domain": "revenue",
                "metric": "recorded_order_count",
                "value": count,
                "unit": "orders",
                "status": status,
                "epistemic_type": "observed",
                "source": source,
                "scope": scope,
                "period": period,
                "freshness": freshness,
                "coverage": {"completeness": completeness, "is_truncated": False, "limitations": limitations},
                "calculation": None,
                "warnings": [],
            })
            envelope["items"].append({
                "evidence_id": value_id,
                "domain": "revenue",
                "metric": "recorded_order_value",
                "value": str(amount),
                "unit": "money",
                "currency": currency,
                "status": status,
                "epistemic_type": "observed",
                "source": source,
                "scope": scope,
                "period": period,
                "freshness": freshness,
                "coverage": {"completeness": completeness, "is_truncated": False, "limitations": limitations},
                "calculation": None,
                "warnings": ["This is a recorded order total, not gross revenue or independently verified net revenue."],
            })
            if count:
                envelope["items"].append({
                    "evidence_id": str(uuid4()),
                    "domain": "revenue",
                    "metric": "average_order_value",
                    "value": str(amount / Decimal(count)),
                    "unit": "money",
                    "currency": currency,
                    "status": status,
                    "epistemic_type": "calculated",
                    "source": source,
                    "scope": scope,
                    "period": period,
                    "freshness": freshness,
                    "coverage": {"completeness": completeness, "is_truncated": False, "limitations": limitations},
                    "calculation": {
                        "formula": "sum(orders.total) / count(distinct orders.id)",
                        "input_evidence_ids": [value_id, count_id],
                        "rounding": "No rounding applied; decimal string retained.",
                        "exclusions": ["recovery_status = cancelled"],
                    },
                    "warnings": ["Average is calculated separately within this currency; currencies are never combined."],
                })

    # Unsupported financial measures remain explicit rather than being inferred from order totals.
    for metric in ("gross_revenue", "net_revenue", "refund_value"):
        envelope["items"].append({
            "evidence_id": str(uuid4()),
            "domain": "revenue",
            "metric": metric,
            "value": None,
            "unit": "money",
            "currency": None,
            "status": "unsupported",
            "epistemic_type": "observed",
            "source": {"system": "shopify", "entity": "orders", "fields": [], "record_count": 0},
            "scope": scope,
            "period": period,
            "freshness": freshness,
            "coverage": {"completeness": completeness, "is_truncated": False, "limitations": limitations},
            "calculation": None,
            "warnings": ["The persisted schema does not contain an independent gross/refund ledger or payment-status evidence."],
        })

    envelope["overall_status"] = status
    envelope["warnings"] = warnings
    if status != "available":
        envelope["errors"].append({"code": f"REVENUE_EVIDENCE_{status.upper()}"})
    return envelope


def format_revenue_evidence(evidence: dict) -> str:
    """Present only claims supported by the revenue evidence envelope."""
    period = evidence["period"]
    lines = [
        "## Recorded Shopify order evidence",
        f"**Reporting window:** {period['start']} to {period['end']} (UTC, start inclusive; end exclusive).",
        f"**Evidence status:** {evidence['overall_status']}.",
    ]
    if evidence["overall_status"] != "available":
        lines.append("This period is not fully verified. Treat any returned figures as incomplete or stale, not as complete revenue.")
    values = [item for item in evidence["items"] if item["metric"] == "recorded_order_value"]
    counts = [item for item in evidence["items"] if item["metric"] == "recorded_order_count"]
    if not values or all(item.get("value") is None for item in values):
        lines.append("**Recorded order value:** Unavailable or unsupported. I won't turn missing evidence into zero.")
    else:
        for item in values:
            if item.get("value") is not None:
                count = next((entry["value"] for entry in counts if entry["currency"] == item.get("currency")), None)
                lines.append(f"**Recorded order value ({item['currency']}):** {item['value']} {item['currency']} across {count} recorded orders.")
            else:
                lines.append("**Recorded order value:** Unsupported because the store currency is not known.")
    lines.append("This is not a gross-sales or net-revenue report. Persisted order totals reflect the source total available at ingestion; refund value is not separately itemized, and payment capture status is not stored.")
    if evidence.get("warnings"):
        lines.append("**Limitations:**")
        lines.extend(f"- {warning}" for warning in evidence["warnings"])
    return "\n\n".join(lines)


def resolve_revenue_period(message: str, *, now: datetime | None = None) -> dict:
    """Resolve supported revenue windows without guessing a merchant timezone.

    Rolling windows and explicit ISO calendar dates are UTC. Merchant-local
    today/yesterday are unsupported because the store timezone is not stored.
    """
    import re
    from datetime import date

    if not isinstance(message, str):
        raise ValueError("Revenue request must be text")
    end = now or datetime.now(timezone.utc)
    if end.tzinfo is None or end.utcoffset() is None:
        raise ValueError("now must be timezone-aware")
    end = end.astimezone(timezone.utc)
    lowered = message.lower()
    if re.search(r"\b(today|yesterday|this morning|last night)\b", lowered):
        return {
            "status": "unsupported",
            "reason": "Merchant-local calendar periods cannot be resolved because the Shopify store timezone is not persisted.",
            "timezone": None,
        }
    match = re.search(
        r"\b(?:between|from)\s+(\d{4}-\d{2}-\d{2})\s+(?:and|to)\s+(\d{4}-\d{2}-\d{2})\b",
        lowered,
    )
    if match:
        first = date.fromisoformat(match.group(1))
        last = date.fromisoformat(match.group(2))
        if last < first:
            raise ValueError("Custom revenue period end must not precede start")
        start_at = datetime.combine(first, datetime.min.time(), tzinfo=timezone.utc)
        end_at = datetime.combine(last + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)
        return {"status": "supported", "start": start_at, "end": end_at, "timezone": "UTC", "label": "custom UTC calendar dates"}
    days = 30 if re.search(r"\b(last|past)\s+30\s+days?\b", lowered) else 7
    start_at = end - timedelta(days=days)
    return {
        "status": "supported",
        "start": start_at,
        "end": end,
        "timezone": "UTC",
        "label": f"rolling {days}-day UTC window",
    }
