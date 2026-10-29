"""Merchant-scoped, currency-safe rolling-week comparisons from verified records."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from sqlalchemy import text


def retrieve_multi_period_evidence(organization_id: str, db, *, now: datetime | None = None, weeks: int = 4) -> dict:
    if not organization_id:
        raise ValueError("Authenticated organization is required")
    if not 2 <= weeks <= 8:
        raise ValueError("weeks must be between 2 and 8")
    end = now or datetime.now(timezone.utc)
    if end.tzinfo is None or end.utcoffset() is None:
        raise ValueError("now must be timezone-aware")
    end = end.astimezone(timezone.utc)
    start = end - timedelta(days=7 * weeks)
    params = {"org_id": organization_id, "start": start, "end": end}
    result = {"organization_id": organization_id, "as_of_utc": end.isoformat(),
              "period_type": "rolling_7_day_utc", "weeks": [], "warnings": [
                  "Order totals are recorded order values, not verified net sales. Refunds, reversals and cancellations are not reconciled.",
                  "Traffic, conversion and product sales are not included without verified source queries. Returning purchaser classification depends on available order history.",
                  "Rolling seven-day periods are not Shopify Admin calendar-week reports.",
              ]}
    for index in range(weeks):
        period_end = end - timedelta(days=7 * index)
        period_start = period_end - timedelta(days=7)
        result["weeks"].append({"start_utc": period_start.isoformat(), "end_utc": period_end.isoformat(),
                                "orders": {"status": "unavailable", "by_currency": []},
                                "abandoned_carts": {"status": "unavailable", "by_currency": []},
                                "customers": {"status": "unavailable"},
                                "purchasers": {"status": "unavailable"}})
    try:
        rows = db.execute(text("""
            SELECT o.currency, o.ordered_at AS occurred_at, o.total AS amount, o.discount_amount AS discount_amount
            FROM orders o JOIN stores s ON s.id = o.store_id
            WHERE s.organization_id = :org_id
              AND s.status IN ('active','connected','syncing')
              AND o.ordered_at >= :start AND o.ordered_at < :end
        """), params).mappings().all()
        for period in result["weeks"]:
            totals = {}
            for row in rows:
                if not period["start_utc"] <= row["occurred_at"].astimezone(timezone.utc).isoformat() < period["end_utc"]:
                    continue
                currency = row["currency"] or "UNKNOWN"
                count, amount = totals.get(currency, (0, Decimal("0")))
                totals[currency] = (count + 1, amount + Decimal(str(row["amount"] or 0)))
            discounts = {}
            for row in rows:
                if period["start_utc"] <= row["occurred_at"].astimezone(timezone.utc).isoformat() < period["end_utc"]:
                    currency = row["currency"] or "UNKNOWN"
                    discounts[currency] = discounts.get(currency, Decimal("0")) + Decimal(str(row["discount_amount"] or 0))
            period["orders"] = {"status": "available", "by_currency": [
                {"currency": currency, "order_count": count, "recorded_order_value": str(amount),
                 "recorded_discount_amount": str(discounts.get(currency, Decimal("0")))}
                for currency, (count, amount) in sorted(totals.items())]}
    except Exception:
        db.rollback()
        result["warnings"].append("Order history could not be retrieved.")
    # Full merchant-scoped order history is needed to classify returning buyers.
    try:
        history = db.execute(text("""
            SELECT o.customer_id, o.ordered_at, o.id
            FROM orders o JOIN stores s ON s.id = o.store_id
            WHERE s.organization_id = :org_id
              AND s.status IN ('active','connected','syncing')
              AND o.customer_id IS NOT NULL AND o.ordered_at < :end
            ORDER BY o.ordered_at, o.id
        """), params).mappings().all()
        seen = set()
        for period in result["weeks"]:
            period["purchasers"] = {"status": "available", "first_time_orders": 0, "returning_orders": 0}
        for row in history:
            customer = str(row["customer_id"])
            occurred = row["ordered_at"].astimezone(timezone.utc).isoformat()
            for period in result["weeks"]:
                if period["start_utc"] <= occurred < period["end_utc"]:
                    field = "returning_orders" if customer in seen else "first_time_orders"
                    period["purchasers"][field] += 1
                    break
            seen.add(customer)
    except Exception:
        db.rollback()
        result["warnings"].append("Purchaser history could not be retrieved.")
    try:
        customers = db.execute(text("""
            SELECT c.created_at FROM customers c JOIN stores s ON s.id = c.store_id
            WHERE s.organization_id = :org_id
              AND s.status IN ('active','connected','syncing')
              AND c.created_at >= :start AND c.created_at < :end
        """), params).mappings().all()
        for period in result["weeks"]:
            count = sum(1 for row in customers if period["start_utc"] <= row["created_at"].astimezone(timezone.utc).isoformat() < period["end_utc"])
            period["customers"] = {"status": "available", "new_customer_records": count}
    except Exception:
        db.rollback()
        result["warnings"].append("Customer acquisition records could not be retrieved.")
    try:
        rows = db.execute(text("""
            SELECT c.store_id, c.external_cart_id, c.id, c.currency, c.cart_value,
                   c.abandoned_at, c.updated_at, c.created_at
            FROM abandoned_carts c JOIN stores s ON s.id = c.store_id
            WHERE s.organization_id = :org_id
              AND s.status IN ('active','connected','syncing')
              AND c.abandoned_at >= :start AND c.abandoned_at < :end
              AND c.status = 'abandoned' AND c.recovered_at IS NULL
        """), params).mappings().all()
        for period in result["weeks"]:
            unique = {}
            for row in rows:
                occurred = row["abandoned_at"].astimezone(timezone.utc).isoformat()
                if not period["start_utc"] <= occurred < period["end_utc"]:
                    continue
                key = (str(row["store_id"]), str(row["external_cart_id"] or row["id"]))
                previous = unique.get(key)
                if previous is None or (row["updated_at"] or row["created_at"], str(row["id"])) > (previous["updated_at"] or previous["created_at"], str(previous["id"])):
                    unique[key] = row
            totals = {}
            for row in unique.values():
                currency = row["currency"] or "UNKNOWN"
                count, amount = totals.get(currency, (0, Decimal("0")))
                totals[currency] = (count + 1, amount + Decimal(str(row["cart_value"] or 0)))
            period["abandoned_carts"] = {"status": "available", "by_currency": [
                {"currency": currency, "cart_count": count, "recorded_cart_value": str(amount)}
                for currency, (count, amount) in sorted(totals.items())]}
    except Exception:
        db.rollback()
        result["warnings"].append("Abandoned-cart history could not be retrieved.")
    return result


def format_multi_period_comparison(evidence: dict) -> str:
    periods = evidence["weeks"]
    lines = ["I compared your latest rolling seven days with the three preceding seven-day periods using recorded store data.",
             "These periods are UTC-based; they are not Shopify's calendar-week reports."]
    for index, period in enumerate(periods):
        lines.append(f'**{"Latest period" if index == 0 else "Previous period " + str(index)}** ({period["start_utc"][:10]} to {period["end_utc"][:10]}, end exclusive):')
        for label, key, count_key, value_key in (
            ("Orders", "orders", "order_count", "recorded_order_value"),
            ("Unrecovered abandoned carts", "abandoned_carts", "cart_count", "recorded_cart_value"),
        ):
            section = period[key]
            if section["status"] != "available":
                lines.append(f"- {label}: unavailable.")
            elif not section["by_currency"]:
                lines.append(f"- {label}: 0 recorded.")
            else:
                for entry in section["by_currency"]:
                    lines.append(f'- {label}: {entry[count_key]} recorded; {entry[value_key]} {entry["currency"]}.')
        customer_data = period.get("customers", {})
        purchaser_data = period.get("purchasers", {})
        if customer_data.get("status") == "available":
            lines.append(f'- Newly recorded customer profiles: {customer_data["new_customer_records"]}.')
        if purchaser_data.get("status") == "available":
            lines.append(f'- First-time purchaser orders: {purchaser_data["first_time_orders"]}; returning purchaser orders: {purchaser_data["returning_orders"]}.')
        if period["orders"]["status"] == "available":
            for entry in period["orders"]["by_currency"]:
                lines.append(f'- Recorded order discounts: {entry.get("recorded_discount_amount", "unavailable")} {entry["currency"]}.')
    lines.append("**What changed:**")
    for label, key, count_key in (("Orders", "orders", "order_count"), ("Unrecovered abandoned carts", "abandoned_carts", "cart_count")):
        latest, previous = periods[0][key], periods[1][key]
        if latest["status"] != "available" or previous["status"] != "available":
            lines.append(f"- {label}: comparison unavailable.")
            continue
        a = sum(x[count_key] for x in latest["by_currency"])
        b = sum(x[count_key] for x in previous["by_currency"])
        lines.append(f"- {label}: {a} versus {b} in the preceding period (change: {a-b:+d}).")
    lines.extend(["**Evidence limitations:**"] + [f"- {warning}" for warning in evidence["warnings"]])
    lines.append("**Next investigation:** Review any unusual order changes and reconcile refunds in Shopify Admin before drawing net-revenue conclusions.")
    return "\n\n".join(lines)
