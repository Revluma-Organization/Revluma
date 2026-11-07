"""Canonical, tenant-scoped Shopify order lifecycle evidence.

Order activity is intentionally separate from revenue, payment transactions,
checkout activity and fulfilment events. Monetary values and AOV are derived
only from Task 198 revenue evidence; this module owns order identity,
lifecycle, relationships and deterministic counts.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any

from .evidence import (
    STATUS_AVAILABLE, STATUS_PARTIAL, STATUS_UNAVAILABLE, UNIT_COUNT,
    UNIT_CURRENCY, availability_of, ensure_utc, evidence_item, iso, period,
    utc_now,
)
from .query import safe_query
from .revenue_evidence import (
    _STORE_SQL, _COVERAGE_SQL, _coverage, _freshness, retrieve_revenue_evidence,
)

_ORDER_AGGREGATE_SQL = """
    SELECT COUNT(*) AS order_count,
           COUNT(*) FILTER (WHERE o.financial_status = 'PAID') AS paid_count,
           COUNT(*) FILTER (WHERE o.financial_status = 'PENDING') AS pending_payment_count,
           COUNT(*) FILTER (WHERE o.financial_status = 'PARTIALLY_PAID') AS partially_paid_count,
           COUNT(*) FILTER (WHERE o.financial_status = 'REFUNDED') AS refunded_count,
           COUNT(*) FILTER (WHERE o.financial_status = 'PARTIALLY_REFUNDED') AS partially_refunded_count,
           COUNT(*) FILTER (WHERE o.financial_status IN ('VOIDED', 'AUTHORIZED', 'EXPIRED')) AS other_financial_count,
           COUNT(*) FILTER (WHERE o.recovery_status IN ('cancelled', 'canceled') OR o.financial_status = 'CANCELLED') AS cancelled_count,
           COUNT(*) FILTER (WHERE o.display_fulfillment_status = 'FULFILLED') AS fulfilled_count,
           COUNT(*) FILTER (WHERE o.display_fulfillment_status = 'UNFULFILLED') AS unfulfilled_count,
           COUNT(*) FILTER (WHERE o.display_fulfillment_status = 'PARTIALLY_FULFILLED') AS partially_fulfilled_count,
           COUNT(*) FILTER (WHERE o.display_fulfillment_status IS NULL) AS fulfillment_unknown_count,
           COUNT(*) FILTER (WHERE o.closed_at IS NULL AND COALESCE(o.recovery_status, '') NOT IN ('cancelled', 'canceled')) AS open_count,
           COUNT(*) FILTER (WHERE o.closed_at IS NOT NULL) AS closed_count
    FROM orders o JOIN stores s ON s.id = o.store_id
    WHERE s.organization_id = :org_id AND s.status IN ('active', 'connected', 'syncing')
      AND o.ordered_at >= :start AND o.ordered_at < :end
"""

_STATUS_SQL = """
    SELECT 'financial' AS dimension, o.financial_status AS source_status, COUNT(*) AS status_count
    FROM orders o JOIN stores s ON s.id = o.store_id
    WHERE s.organization_id = :org_id AND s.status IN ('active', 'connected', 'syncing')
      AND o.ordered_at >= :start AND o.ordered_at < :end
    GROUP BY o.financial_status
    UNION ALL
    SELECT 'fulfillment', o.display_fulfillment_status, COUNT(*)
    FROM orders o JOIN stores s ON s.id = o.store_id
    WHERE s.organization_id = :org_id AND s.status IN ('active', 'connected', 'syncing')
      AND o.ordered_at >= :start AND o.ordered_at < :end
    GROUP BY o.display_fulfillment_status
"""

_LEDGER_SQL = """
    SELECT d.store_id, d.domain, d.status, d.pagination_complete,
           d.last_succeeded_at, d.last_checked_at, d.error_code
    FROM store_sync_domain_states d JOIN stores s ON s.id = d.store_id
    WHERE s.organization_id = :org_id AND s.status IN ('active', 'connected', 'syncing')
      AND d.domain IN ('orders', 'transactions', 'refunds', 'fulfillments')
"""

_ORDER_RECORD_SQL = """
    SELECT o.id, o.store_id, o.external_order_id, o.external_order_name,
           o.ordered_at, o.source_updated_at, o.processed_at,
           o.closed_at, o.recovery_status, o.cancel_reason,
           o.financial_status, o.display_fulfillment_status,
           o.total, o.refunded_total, o.currency, o.presentment_currency,
           o.test_flag, o.source_name
    FROM orders o JOIN stores s ON s.id = o.store_id
    WHERE s.organization_id = :org_id AND s.status IN ('active', 'connected', 'syncing')
"""

_LINE_ITEM_SQL = """
    SELECT oi.order_id, oi.id, oi.external_line_item_id, oi.external_product_id,
           oi.external_variant_id, oi.product_name, oi.variant_title, oi.sku,
           oi.quantity, oi.quantity_fulfilled, oi.quantity_remaining,
           oi.unit_price, oi.discounted_unit_price, oi.original_line_total,
           oi.discount_amount, oi.currency, oi.line_total
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id AND o.store_id = oi.store_id
    JOIN stores s ON s.id = oi.store_id
    WHERE s.organization_id = :org_id AND s.status IN ('active', 'connected', 'syncing')
      AND oi.order_id = ANY(:order_ids::uuid[])
"""

_RELATION_SQL = """
    SELECT 'refund' AS relation_type, r.store_id, r.external_order_id, r.external_id,
           r.created_at, r.source_updated_at AS updated_at, r.refund_amount AS amount,
           r.refund_currency AS currency, NULL AS status,
           NULL AS display_status, NULL AS delivered_at, NULL AS fulfillment_events,
           r.order_adjustments AS adjustments,
           r.refund_line_items AS line_items, r.transactions AS tracking_info
    FROM order_refunds r JOIN stores s ON s.id = r.store_id
    WHERE s.organization_id = :org_id AND s.status IN ('active', 'connected', 'syncing')
      AND r.external_order_id = ANY(:external_ids)
    UNION ALL
    SELECT 'fulfillment', f.store_id, f.external_order_id, f.external_id, f.created_at,
           f.updated_at, NULL, NULL, f.status, f.display_status, f.delivered_at,
           f.fulfillment_events, NULL AS adjustments, f.line_items, f.tracking_info
    FROM order_fulfillments f JOIN stores s ON s.id = f.store_id
    WHERE s.organization_id = :org_id AND s.status IN ('active', 'connected', 'syncing')
      AND f.external_order_id = ANY(:external_ids)
"""

_PRODUCT_AGGREGATE_SQL = """
    SELECT oi.external_product_id AS product_id, oi.external_variant_id AS variant_id,
           ARRAY_AGG(DISTINCT oi.product_name) FILTER (WHERE oi.product_name IS NOT NULL) AS historical_product_titles,
           ARRAY_AGG(DISTINCT oi.variant_title) FILTER (WHERE oi.variant_title IS NOT NULL) AS historical_variant_titles,
           ARRAY_AGG(DISTINCT oi.sku) FILTER (WHERE oi.sku IS NOT NULL) AS historical_skus,
           oi.currency, SUM(oi.quantity) AS quantity,
           COUNT(*) FILTER (WHERE oi.quantity IS NULL) AS missing_quantity_count,
           SUM(oi.line_total) AS historical_line_value,
           COUNT(*) FILTER (WHERE oi.line_total IS NULL OR oi.currency IS NULL) AS incomplete_value_count,
           COUNT(DISTINCT oi.order_id) AS order_count,
           ARRAY_AGG(DISTINCT oi.order_id) AS order_ids
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id AND o.store_id = oi.store_id
    JOIN stores s ON s.id = oi.store_id
    WHERE s.organization_id = :org_id AND s.status IN ('active', 'connected', 'syncing')
      AND o.ordered_at >= :start AND o.ordered_at < :end
    GROUP BY oi.external_product_id, oi.external_variant_id, oi.currency
    ORDER BY oi.external_product_id NULLS LAST, oi.external_variant_id NULLS LAST, oi.currency NULLS LAST
    LIMIT 500
"""

_COUNT_DEFINITIONS = {
    "order_count": "All orders whose ordered_at falls in [start, end), including orders later cancelled or refunded.",
    "paid_count": "Orders with Shopify displayFinancialStatus PAID. This is not a settlement or revenue measure.",
    "pending_payment_count": "Orders with Shopify displayFinancialStatus PENDING; awaiting payment is not an unfulfilled status.",
    "partially_paid_count": "Orders with Shopify displayFinancialStatus PARTIALLY_PAID.",
    "refunded_count": "Orders with Shopify displayFinancialStatus REFUNDED.",
    "partially_refunded_count": "Orders with Shopify displayFinancialStatus PARTIALLY_REFUNDED.",
    "cancelled_count": "Orders with a persisted cancellation state or Shopify financial status CANCELLED.",
    "fulfilled_count": "Orders with Shopify displayFulfillmentStatus FULFILLED; delivery is not asserted.",
    "unfulfilled_count": "Orders with Shopify displayFulfillmentStatus UNFULFILLED; no cause or delay reason is inferred.",
    "partially_fulfilled_count": "Orders with Shopify displayFulfillmentStatus PARTIALLY_FULFILLED.",
    "open_count": "Orders with no closedAt and no persisted cancellation state.",
    "closed_count": "Orders with a Shopify closedAt timestamp.",
}


def _row(row: Any, key: str, default=None):
    try:
        return row[key]
    except (KeyError, IndexError, TypeError):
        return getattr(row, key, default)


def _int(row: Any, key: str) -> int | None:
    value = _row(row, key, 0)
    if isinstance(value, bool):
        return None
    try:
        result = int(value)
    except (TypeError, ValueError):
        return None
    return result if result >= 0 else None


def _json(value: Any, fallback):
    if value is None:
        return fallback
    if isinstance(value, (list, dict)):
        return value
    try:
        import json
        return json.loads(str(value))
    except (TypeError, ValueError):
        return fallback


def _record(row: Any, items: list, relations: list) -> dict:
    external_id = str(_row(row, "external_order_id"))
    cancelled = _row(row, "recovery_status") in ("cancelled", "canceled") or _row(row, "financial_status") == "CANCELLED"
    order_items = []
    for item in items:
        if str(_row(item, "order_id")) != str(_row(row, "id")):
            continue
        order_items.append({
            "id": str(_row(item, "id")), "external_line_item_id": _row(item, "external_line_item_id"),
            "product_id": _row(item, "external_product_id"), "variant_id": _row(item, "external_variant_id"),
            "product_title_at_order": _row(item, "product_name"), "variant_title_at_order": _row(item, "variant_title"),
            "sku_at_order": _row(item, "sku"), "quantity": _int(item, "quantity"),
            "quantity_fulfilled": _int(item, "quantity_fulfilled"),
            "quantity_remaining": _int(item, "quantity_remaining"),
            "unit_price": str(_row(item, "unit_price")) if _row(item, "unit_price") is not None else None,
            "discounted_unit_price": str(_row(item, "discounted_unit_price")) if _row(item, "discounted_unit_price") is not None else None,
            "original_line_total": str(_row(item, "original_line_total")) if _row(item, "original_line_total") is not None else None,
            "discount_amount": str(_row(item, "discount_amount")) if _row(item, "discount_amount") is not None else None,
            "line_total": str(_row(item, "line_total")) if _row(item, "line_total") is not None else None,
            "currency": _row(item, "currency"),
        })
    related = []
    for relation in relations:
        if (str(_row(relation, "external_order_id")) != external_id
                or str(_row(relation, "store_id")) != str(_row(row, "store_id"))):
            continue
        entry = {
            "type": _row(relation, "relation_type"), "external_id": _row(relation, "external_id"),
            "status": _row(relation, "status"), "display_status": _row(relation, "display_status"),
            "delivered_at": iso(_row(relation, "delivered_at")),
            "created_at": iso(_row(relation, "created_at")), "updated_at": iso(_row(relation, "updated_at")),
            "line_items": _json(_row(relation, "line_items"), []),
        }
        if _row(relation, "relation_type") == "refund":
            entry.update({"amount": str(_row(relation, "amount")) if _row(relation, "amount") is not None else None,
                          "currency": _row(relation, "currency"),
                          "transactions": _json(_row(relation, "tracking_info"), []),
                          "order_adjustments": _json(_row(relation, "adjustments"), [])})
        else:
            entry["tracking"] = _json(_row(relation, "tracking_info"), [])
            entry["events"] = _json(_row(relation, "fulfillment_events"), [])
        related.append(entry)
    return {
        "id": str(_row(row, "id")), "store_id": str(_row(row, "store_id")),
        "external_order_id": external_id, "name": _row(row, "external_order_name"),
        "created_at": iso(_row(row, "ordered_at")), "updated_at": iso(_row(row, "source_updated_at")),
        "processed_at": iso(_row(row, "processed_at")), "closed_at": iso(_row(row, "closed_at")),
        "cancelled": cancelled, "cancel_reason": _row(row, "cancel_reason"),
        "lifecycle_status": "cancelled" if cancelled else ("closed" if _row(row, "closed_at") else "open"),
        "financial_status": _row(row, "financial_status"),
        "fulfillment_status": _row(row, "display_fulfillment_status"),
        "total": str(_row(row, "total")) if _row(row, "total") is not None else None,
        "refunded_total": str(_row(row, "refunded_total")) if _row(row, "refunded_total") is not None else None,
        "currency": _row(row, "currency"), "presentment_currency": _row(row, "presentment_currency"),
        "test": _row(row, "test_flag"), "source_name": _row(row, "source_name"),
        "line_items": order_items, "relationships": related,
        "delivery_verified": any(entry["type"] == "fulfillment" and (entry.get("delivered_at") or entry.get("display_status") == "DELIVERED") for entry in related),
    }


def _product_evidence(organization_id: str, db, *, start: datetime, end: datetime,
                      coverage: dict, freshness: dict, limitations: list[str],
                      filter_sql: str = "", extra_params: dict | None = None) -> tuple[list[dict], str | None]:
    """Historical product/variant line evidence; never substitutes current catalog data."""
    sql = _PRODUCT_AGGREGATE_SQL.replace("LIMIT 500", "LIMIT 501")
    if filter_sql:
        sql = sql.replace("    GROUP BY", filter_sql + "\n    GROUP BY")
    rows, error = safe_query(db, sql, {"org_id": organization_id, "start": start, "end": end, **(extra_params or {})})
    if error or len(rows) > 500:
        return [], "product_aggregate_unavailable" if error else "product_aggregate_limit_exceeded"
    window = period(start, end)
    items: list[dict] = []
    products: dict[tuple, dict] = {}
    definition = ("Historical order-line quantities, distinct order count and discounted line totals grouped by source product, "
                  "variant and currency. Line totals are not net revenue, payment, refund or current catalog evidence.")
    for row in rows:
        product_id, variant_id = _row(row, "product_id"), _row(row, "variant_id")
        currency = _row(row, "currency")
        missing_quantity = (_int(row, "missing_quantity_count") or 0) > 0
        incomplete_value = (_int(row, "incomplete_value_count") or 0) > 0
        value = {
            "quantity": None if missing_quantity else _int(row, "quantity"),
            "order_count": _int(row, "order_count"),
            "historical_line_value": None if incomplete_value or _row(row, "historical_line_value") is None else str(_row(row, "historical_line_value")),
            "currency": currency,
            "historical_product_titles": sorted(str(v) for v in (_row(row, "historical_product_titles") or [])),
            "historical_variant_titles": sorted(str(v) for v in (_row(row, "historical_variant_titles") or [])),
            "historical_skus": sorted(str(v) for v in (_row(row, "historical_skus") or [])),
        }
        variant_key = f"{product_id or 'unidentified'}:{variant_id or 'no-variant'}:{currency or 'unknown'}"
        title = value["historical_product_titles"][0] if value["historical_product_titles"] else "Unidentified historical product"
        items.append(evidence_item("variant_order_lines", label=f"{title} — variant {variant_id or 'unidentified'}",
            value=value, unit="record", window=window, source="order_items", definition=definition,
            coverage=coverage, freshness=freshness, limitations=limitations, domain="orders",
            discriminator=variant_key, classification="deterministic_calculation",
            provenance={"retrieval": "aggregate", "transformation": "Group historical lines by product, variant and currency; null components remain unavailable.",
                        "calculation_version": "order-lines-v1", "lineage": ["order_items"], "reproducible": True}))
        key = (product_id, currency)
        product = products.setdefault(key, {"quantity": 0, "quantity_complete": True, "order_ids": set(),
            "value": Decimal("0"), "value_complete": True, "titles": set(), "variant_count": 0})
        product["variant_count"] += 1
        product["titles"].update(value["historical_product_titles"])
        product["order_ids"].update(str(order_id) for order_id in (_row(row, "order_ids") or []))
        if value["quantity"] is None:
            product["quantity_complete"] = False
        else:
            product["quantity"] += value["quantity"]
        if value["historical_line_value"] is None:
            product["value_complete"] = False
        else:
            product["value"] += Decimal(value["historical_line_value"])
    for (product_id, currency), product in products.items():
        title = sorted(product["titles"])[0] if product["titles"] else "Unidentified historical product"
        items.append(evidence_item("product_order_lines", label=title,
            value={"quantity": product["quantity"] if product["quantity_complete"] else None,
                   "order_count": len(product["order_ids"]),
                   "historical_line_value": str(product["value"]) if product["value_complete"] else None,
                   "currency": currency, "historical_product_titles": sorted(product["titles"]),
                   "variant_group_count": product["variant_count"]},
            unit="record", window=window, source="order_items",
            definition=definition + " Product rollup order counts are distinct internal order IDs across variant groups.",
            coverage=coverage, freshness=freshness, limitations=limitations, domain="orders",
            discriminator=f"{product_id or 'unidentified'}:{currency or 'unknown'}",
            classification="deterministic_calculation",
            provenance={"retrieval": "aggregate", "transformation": "Deterministic rollup of complete variant groups.",
                        "calculation_version": "order-lines-v1", "lineage": ["order_items"], "reproducible": True}))
    return items, None


def retrieve_order_evidence(organization_id: str, db, *, start: datetime, end: datetime,
                            now: datetime | None = None, order_reference: str | None = None,
                            latest: bool = False, financial_status: str | None = None,
                            fulfillment_status: str | None = None, cancelled: bool = False,
                            compare: bool = False) -> dict:
    """Retrieve deterministic order evidence using only authenticated org scope."""
    if not organization_id or not isinstance(organization_id, str):
        raise ValueError("Authenticated organization is required")
    if order_reference and latest:
        raise ValueError("latest cannot be combined with an order reference")
    start, end = ensure_utc(start, field="start"), ensure_utc(end, field="end")
    if end <= start:
        raise ValueError("end must be after start")
    now = ensure_utc(now or utc_now(), field="now")
    window = period(start, end)
    stores, store_error = safe_query(db, _STORE_SQL, {"org_id": organization_id})
    if store_error or not stores:
        return {"items": [], "warnings": ["authorized_store_scope_unavailable" if store_error else "no_authorized_store"],
                "limitations": [], "coverage": {"complete": False}, "overall_status": STATUS_UNAVAILABLE}
    freshness = _freshness(stores, now)
    coverage_rows, coverage_error = safe_query(db, _COVERAGE_SQL, {"org_id": organization_id})
    coverage = _coverage(stores, coverage_rows, start, end)
    ledger_rows, ledger_error = safe_query(db, _LEDGER_SQL, {"org_id": organization_id})
    warnings: list[str] = []
    limitations = [
        "Order activity, payment, checkout, fulfillment and delivery are distinct domains.",
        "Protected customer contact and address fields are not sent to Rev.",
    ]
    if coverage_error or ledger_error:
        coverage = {**coverage, "complete": False, "status": "unknown", "period_status": "unavailable",
                    "note": "Order coverage or synchronization ledger evidence could not be read."}
        warnings.append("order_coverage_or_ledger_unavailable")
    order_ledgers = [row for row in ledger_rows if _row(row, "domain") == "orders"]
    if len(order_ledgers) != len(stores) or any(
        _row(row, "status") != "ok" or _row(row, "pagination_complete") is not True for row in order_ledgers
    ):
        coverage = {**coverage, "complete": False, "status": "partial", "period_status": "partial",
                    "note": "At least one store lacks a complete, reconciled order synchronization ledger."}
        warnings.append("order_pagination_or_sync_incomplete")
    sync_dates = [_row(row, "last_succeeded_at") or _row(row, "last_checked_at") for row in order_ledgers]
    sync_dates = [value for value in sync_dates if isinstance(value, datetime)]
    if sync_dates:
        age = max(0, int((now - min(ensure_utc(value) for value in sync_dates)).total_seconds()))
        freshness = {"state": "fresh" if age <= 3600 else "aging" if age <= 7200 else "stale",
                     "as_of": iso(min(sync_dates)), "age_seconds": age, "policy": "3600s",
                     "note": "Oldest successful order-domain synchronization in scope."}
    for relation in ("transactions", "refunds", "fulfillments"):
        rows = [row for row in ledger_rows if _row(row, "domain") == relation]
        if len(rows) != len(stores) or any(
            _row(row, "status") != "ok" or _row(row, "pagination_complete") is not True for row in rows
        ):
            limitations.append(f"{relation} relationship evidence is incomplete; lifecycle statuses are not substituted for complete relationships.")

    clauses = ""
    params: dict[str, Any] = {"org_id": organization_id, "start": start, "end": end}
    record_mode = bool(order_reference or latest)
    if order_reference:
        reference = str(order_reference).strip()[:128]
        if not reference:
            raise ValueError("order reference cannot be empty")
        clauses += " AND (o.id::text = :reference OR o.external_order_id = :reference OR o.external_order_name = :reference)"
        params["reference"] = reference
    else:
        clauses += " AND o.ordered_at >= :start AND o.ordered_at < :end"
    if financial_status:
        clauses += " AND o.financial_status = :financial_status"
        params["financial_status"] = financial_status
    if fulfillment_status:
        clauses += " AND o.display_fulfillment_status = :fulfillment_status"
        params["fulfillment_status"] = fulfillment_status
    if cancelled:
        clauses += " AND (o.recovery_status IN ('cancelled', 'canceled') OR o.financial_status = 'CANCELLED')"
    items: list[dict] = []

    if record_mode:
        sql = _ORDER_RECORD_SQL + clauses + " ORDER BY o.ordered_at DESC, o.id DESC LIMIT 100"
        rows, error = safe_query(db, sql, params)
        if error:
            return {"items": [evidence_item("order_record", label="Order record", value=None, unit="record",
                    window=window, source="orders", status=STATUS_UNAVAILABLE,
                    definition="Authorized Shopify order record and relationships.", coverage=coverage,
                    freshness=freshness, limitations=["Order retrieval failed."])],
                    "warnings": ["order_record_query_failed"], "limitations": limitations,
                    "coverage": coverage, "overall_status": STATUS_UNAVAILABLE}
        records = rows[:1] if latest else rows
        if order_reference and len(records) > 1 and not str(order_reference).isdigit():
            return {"items": [evidence_item("order_record", label="Ambiguous order reference", value=None,
                    unit="record", window=window, source="orders", status="contradictory",
                    definition="Order names are display references, not stable global identities.",
                    coverage=coverage, freshness=freshness,
                    limitations=["Use the stable Shopify order ID or internal UUID to disambiguate."])],
                    "warnings": ["ambiguous_order_reference"], "limitations": limitations,
                    "coverage": coverage, "overall_status": STATUS_PARTIAL}
        if not records:
            items.append(evidence_item("order_record", label="Order record unavailable", value=None,
                unit="record", window=window, source="orders", status=STATUS_PARTIAL,
                definition="No authorized stored order matches the requested stable or display reference.",
                coverage=coverage, freshness=freshness,
                limitations=["Missing stored evidence does not prove the Shopify order does not exist."]))
        else:
            order_ids = [str(_row(row, "id")) for row in records]
            line_params = {"org_id": organization_id}
            line_sql = _LINE_ITEM_SQL + " ORDER BY oi.order_id, oi.external_line_item_id LIMIT 5000"
            line_params["order_ids"] = order_ids
            line_rows, line_error = safe_query(db, line_sql, line_params)
            relation_params = {"org_id": organization_id, "external_ids": [str(_row(row, "external_order_id")) for row in records]}
            relation_sql = _RELATION_SQL + " LIMIT 5000"
            relation_rows, relation_error = safe_query(db, relation_sql, relation_params)
            if line_error or relation_error:
                warnings.append("order_relationships_incomplete")
            for row in records:
                record = _record(row, [] if line_error else line_rows, [] if relation_error else relation_rows)
                items.append(evidence_item("order_record", label=record["name"] or f"Shopify order {record['external_order_id']}",
                    value=record, unit="record", window=window, source="orders",
                    definition="Authorized stored Shopify order with independent lifecycle, financial and fulfillment statuses, historical line items, refunds and fulfillments.",
                    coverage=coverage, freshness=freshness, limitations=limitations + (["Some relationships could not be loaded."] if line_error or relation_error else []),
                    classification="verified_fact", evidence_type="order_record", domain="orders",
                    discriminator=record["id"],
                    source_references=[{"source_id": record["external_order_id"], "resource": "orders", "sync_run_id": None}],
                    provenance={"retrieval": "direct", "transformation": "Tenant-scoped order and relationship resolution without customer PII.",
                                "calculation_version": "order-record-v1", "lineage": [f"order:{record['external_order_id']}"], "reproducible": True}))
        return {"items": items, "warnings": warnings, "limitations": limitations,
                "coverage": coverage, "overall_status": availability_of(items)}

    aggregate_sql = _ORDER_AGGREGATE_SQL
    aggregate_params = dict(params)
    order_filter_sql = ""
    if financial_status or fulfillment_status or cancelled:
        # Fixed allowlisted filters modify the same canonical aggregate, never caller SQL.
        order_filter_sql += (" AND o.financial_status = :financial_status" if financial_status else "")
        order_filter_sql += (" AND o.display_fulfillment_status = :fulfillment_status" if fulfillment_status else "")
        order_filter_sql += (" AND (o.recovery_status IN ('cancelled', 'canceled') OR o.financial_status = 'CANCELLED')" if cancelled else "")
        aggregate_sql += order_filter_sql
    rows, error = safe_query(db, aggregate_sql, aggregate_params)
    if error:
        items.append(evidence_item("order_count", label="Order count", value=None, window=window,
            source="orders", status=STATUS_UNAVAILABLE, definition=_COUNT_DEFINITIONS["order_count"],
            coverage=coverage, freshness=freshness, limitations=["The order aggregate query failed."]))
        return {"items": items, "warnings": ["order_query_failed"], "limitations": limitations,
                "coverage": coverage, "overall_status": STATUS_UNAVAILABLE}
    totals = {key: sum(value for row in rows if (value := _int(row, key)) is not None) for key in _COUNT_DEFINITIONS}
    invalid = any(_int(row, "order_count") is None for row in rows) or (not rows and not coverage.get("complete"))
    for key, definition in _COUNT_DEFINITIONS.items():
        value = None if invalid else totals[key]
        items.append(evidence_item(key, label=key.replace("_", " ").capitalize(), value=value,
            window=window, source="orders", definition=definition,
            status=STATUS_PARTIAL if invalid else STATUS_AVAILABLE,
            coverage=coverage, freshness=freshness, limitations=limitations,
            classification="deterministic_calculation", domain="orders",
            provenance={"retrieval": "aggregate", "transformation": definition,
                        "calculation_version": "order-lifecycle-v1", "lineage": ["orders"], "reproducible": True}))
    status_sql = _STATUS_SQL
    if order_filter_sql:
        status_sql += order_filter_sql
    status_rows, status_error = safe_query(db, status_sql, aggregate_params)
    if not status_error:
        for row in status_rows:
            source_status = _row(row, "source_status")
            dimension = _row(row, "dimension")
            count = _int(row, "status_count")
            if count is None:
                continue
            normalized = str(source_status) if source_status else "UNAVAILABLE"
            metric = f"orders_by_{dimension}_{normalized.lower()}"
            items.append(evidence_item(metric, label=f"{dimension.title()} status {normalized}", value=count,
                window=window, source="orders", definition=f"Orders grouped by source Shopify {dimension} status; UNAVAILABLE means the source field is null.",
                coverage=coverage, freshness=freshness, classification="deterministic_calculation",
                domain="orders", discriminator=f"{dimension}:{normalized}"))
    else:
        warnings.append("order_status_breakdown_unavailable")

    product_items, product_error = _product_evidence(organization_id, db, start=start, end=end,
        coverage=coverage, freshness=freshness, limitations=limitations,
        filter_sql=order_filter_sql, extra_params=aggregate_params)
    items.extend(product_items)
    if product_error:
        warnings.append(product_error)

    # Reuse Task 198 for money and average order value; never recalculate revenue here.
    revenue = ({} if order_filter_sql else retrieve_revenue_evidence(
        organization_id, db, start=start, end=end, now=now, compare=compare))
    current = [item for item in revenue.get("items", []) if item.get("period", {}).get("start") == window["start"]]
    counts = [item for item in current if item.get("metric") == "recorded_order_count" and item.get("status") in ("available", "verified_zero")]
    values = [item for item in current if item.get("metric") == "recorded_order_value" and item.get("status") == "available"]
    for count in counts:
        value = next((entry for entry in values if entry.get("currency") == count.get("currency")), None)
        if not value or not count.get("value"):
            continue
        average = Decimal(str(value["value"])) / Decimal(count["value"])
        items.append(evidence_item("average_order_value", label=f"Average order value ({count['currency']})",
            value=average, unit=UNIT_CURRENCY, currency=count["currency"], window=window, source="orders",
            definition="Task 198 net recorded order value divided by its non-cancelled order count for the same currency and period.",
            coverage=coverage, freshness=freshness, discriminator=count["currency"],
            classification="deterministic_calculation", measurement={**value["measurement"], "amount": str(average),
                "numerator": value["definition"], "denominator": count["definition"],
                "formula": "net_recorded_order_value / non_cancelled_order_count"},
            provenance={"retrieval": "calculation", "transformation": "Divide Task 198 value by its matching order count.",
                        "calculation_version": "task198-aov-v1", "lineage": [value["id"], count["id"]], "reproducible": True}))
    comparison_items = list(revenue.get("comparison_items", []))
    if compare:
        comparison_start, comparison_end = start - (end - start), start
        comparison_window = period(comparison_start, comparison_end)
        comparison_coverage = _coverage(stores, coverage_rows, comparison_start, comparison_end)
        comparison_params = {**aggregate_params, "start": comparison_start, "end": comparison_end}
        previous_rows, previous_error = safe_query(db, aggregate_sql, comparison_params)
        if previous_error:
            warnings.append("order_comparison_query_failed")
        else:
            previous_totals = {key: sum(value for row in previous_rows if (value := _int(row, key)) is not None)
                               for key in _COUNT_DEFINITIONS}
            previous_invalid = any(_int(row, "order_count") is None for row in previous_rows) or not previous_rows
            for key, definition in _COUNT_DEFINITIONS.items():
                comparison_items.append(evidence_item(key, label=f"Comparison {key.replace('_', ' ')}",
                    value=None if previous_invalid else previous_totals[key], window=comparison_window,
                    source="orders", status=STATUS_UNAVAILABLE if previous_invalid else STATUS_AVAILABLE,
                    definition=definition, coverage=comparison_coverage, freshness=freshness,
                    limitations=limitations, domain="orders", classification="deterministic_calculation",
                    provenance={"retrieval": "aggregate", "transformation": definition,
                                "calculation_version": "order-lifecycle-v1", "lineage": ["orders"], "reproducible": True}))
        previous_products, previous_product_error = _product_evidence(organization_id, db,
            start=comparison_start, end=comparison_end, coverage=comparison_coverage,
            freshness=freshness, limitations=limitations,
            filter_sql=order_filter_sql, extra_params=comparison_params)
        comparison_items.extend(previous_products)
        if previous_product_error:
            warnings.append(f"comparison_{previous_product_error}")
    return {"items": items, "warnings": warnings + revenue.get("warnings", []),
            "limitations": limitations, "coverage": coverage,
            "overall_status": availability_of(items), "comparison": revenue.get("comparison"),
            "revenue_items": revenue.get("items", []), "comparison_items": comparison_items}
