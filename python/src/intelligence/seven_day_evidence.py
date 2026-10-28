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
            SELECT c.currency, COUNT(*) AS item_count, COALESCE(SUM(c.cart_value), 0) AS amount
            FROM abandoned_carts c JOIN stores s ON s.id = c.store_id
            WHERE s.organization_id = :org_id
              AND s.status IN ('active', 'connected', 'syncing')
              AND c.abandoned_at >= :start AND c.abandoned_at < :end
            GROUP BY c.currency ORDER BY c.currency
        """), params).mappings().all()
        evidence["abandoned_carts"] = {"status": "available", "by_currency": _rows_by_currency(rows, "cart_count", "cart_value")}
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
