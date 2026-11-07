"""Canonical, tenant-scoped Shopify checkout evidence.

Shopify's Admin ``abandonedCheckouts`` connection is an incomplete-checkout
resource, not a universal checkout-start feed. This module therefore reports
*observed checkout records* and definitive observed lifecycle populations. It
never presents that population as all checkout starts, lost sales or revenue.
"""
from __future__ import annotations

from datetime import datetime, timezone as datetime_timezone
from decimal import Decimal
from typing import Any

from .evidence import (
    EVIDENCE_SCHEMA_VERSION, STATUS_AVAILABLE, STATUS_PARTIAL, STATUS_UNAVAILABLE,
    UNIT_CURRENCY, UNIT_RATIO, availability_of, ensure_utc, evidence_item,
    iso, period, previous_period, utc_now,
)
from .query import safe_query
from .revenue_evidence import _safe_zoneinfo

_COMPLETED = "(c.completed_at IS NOT NULL OR c.recovered_at IS NOT NULL OR EXISTS (SELECT 1 FROM orders co WHERE co.store_id = c.store_id AND co.abandoned_cart_id = c.id))"
_ABANDONED = f"(c.source_resource = 'abandonedCheckouts' AND c.source_state = 'available' AND NOT {_COMPLETED})"
_PERIOD = "COALESCE(c.source_created_at, c.abandoned_at, c.created_at) >= :start AND COALESCE(c.source_created_at, c.abandoned_at, c.created_at) < :end"
_SCOPE = "s.organization_id = :org_id AND s.status IN ('active', 'connected', 'syncing')"
_STORE_SQL = f"SELECT s.id, s.platform, s.status, s.last_synced_at FROM stores s WHERE {_SCOPE} ORDER BY s.id"

_AGGREGATE_SQL = f"""
SELECT COUNT(*) AS observed_checkout_count,
 COUNT(*) FILTER (WHERE {_COMPLETED}) AS completed_checkout_count,
 COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM orders co WHERE co.store_id = c.store_id AND co.abandoned_cart_id = c.id)) AS completed_with_order_count,
 COUNT(*) FILTER (WHERE {_ABANDONED}) AS abandoned_checkout_count,
 COUNT(*) FILTER (WHERE NOT {_COMPLETED} AND NOT {_ABANDONED}) AS unknown_lifecycle_count,
 COUNT(*) FILTER (WHERE c.external_cart_id IS NULL OR COALESCE(c.source_created_at, c.abandoned_at, c.created_at) IS NULL
                  OR c.cart_value IS NULL OR c.currency IS NULL OR c.source_state <> 'available') AS incomplete_checkout_count,
 COUNT(*) FILTER (WHERE c.source_state <> 'available') AS source_unavailable_count,
 COUNT(*) FILTER (WHERE EXISTS (
   SELECT 1 FROM order_checkout_reconciliation_cases rc JOIN orders ro ON ro.store_id = rc.store_id AND ro.id = rc.order_id
   WHERE rc.store_id = c.store_id AND rc.status = 'UNRESOLVED'
     AND rc.source_identifier IN (c.source_checkout_id, c.source_checkout_token, c.source_cart_token)
 )) AS conflicting_relationship_count
FROM abandoned_carts c JOIN stores s ON s.id = c.store_id
WHERE {_SCOPE} AND {_PERIOD}
"""

_VALUE_SQL = f"""
SELECT c.currency, COUNT(*) AS checkout_count,
 COUNT(*) FILTER (WHERE c.cart_value IS NULL) AS missing_value_count,
 SUM(c.cart_value) AS recorded_value,
 SUM(c.subtotal) AS subtotal, SUM(c.discount_amount) AS discounts,
 SUM(c.tax_amount) AS taxes, SUM(c.duties_amount) AS duties,
 COUNT(*) FILTER (WHERE c.subtotal IS NULL) AS missing_subtotal_count,
 COUNT(*) FILTER (WHERE c.discount_amount IS NULL) AS missing_discount_count,
 COUNT(*) FILTER (WHERE c.tax_amount IS NULL) AS missing_tax_count,
 COUNT(*) FILTER (WHERE c.shipping_amount IS NULL) AS missing_shipping_count
FROM abandoned_carts c JOIN stores s ON s.id = c.store_id
WHERE {_SCOPE} AND {_PERIOD} AND {_ABANDONED}
GROUP BY c.currency ORDER BY c.currency
"""

_DAILY_SQL = f"""
SELECT TO_CHAR(COALESCE(c.source_created_at, c.abandoned_at, c.created_at) AT TIME ZONE :timezone, 'YYYY-MM-DD') AS activity_date,
 COUNT(*) AS observed_checkout_count,
 COUNT(*) FILTER (WHERE {_COMPLETED}) AS completed_checkout_count,
 COUNT(*) FILTER (WHERE {_ABANDONED}) AS abandoned_checkout_count
FROM abandoned_carts c JOIN stores s ON s.id = c.store_id
WHERE {_SCOPE} AND {_PERIOD}
GROUP BY activity_date ORDER BY activity_date
"""

_PRODUCT_SQL = f"""
SELECT i.external_product_id AS product_id, i.external_variant_id AS variant_id,
 ARRAY_AGG(DISTINCT i.product_name) FILTER (WHERE i.product_name IS NOT NULL) AS historical_product_titles,
 ARRAY_AGG(DISTINCT i.variant_name) FILTER (WHERE i.variant_name IS NOT NULL) AS historical_variant_titles,
 ARRAY_AGG(DISTINCT i.sku) FILTER (WHERE i.sku IS NOT NULL) AS historical_skus,
 i.currency, SUM(i.quantity) AS quantity, COUNT(DISTINCT c.id) AS checkout_count,
 SUM(i.line_subtotal) AS historical_line_value,
 COUNT(*) FILTER (WHERE i.quantity IS NULL) AS missing_quantity_count,
 COUNT(*) FILTER (WHERE i.line_subtotal IS NULL OR i.currency IS NULL) AS incomplete_value_count
FROM abandoned_cart_items i
JOIN abandoned_carts c ON c.id = i.abandoned_cart_id
JOIN stores s ON s.id = c.store_id
WHERE {_SCOPE} AND {_PERIOD} AND {_ABANDONED}
GROUP BY i.external_product_id, i.external_variant_id, i.currency
ORDER BY i.external_product_id NULLS LAST, i.external_variant_id NULLS LAST, i.currency NULLS LAST
LIMIT 501
"""

_LEDGER_SQL = """
SELECT d.store_id, d.domain, d.status, d.pagination_complete, d.records_discovered,
 d.last_succeeded_at, d.last_checked_at, d.error_code, d.checkpoint
FROM store_sync_domain_states d JOIN stores s ON s.id = d.store_id
WHERE s.organization_id = :org_id AND s.status IN ('active', 'connected', 'syncing')
 AND d.domain = 'abandoned_checkouts'
"""

_RECORD_SQL = f"""
SELECT c.id, c.store_id, c.external_cart_id, c.external_checkout_name, c.source_resource,
 c.source_state, c.source_created_at, c.source_updated_at, c.completed_at,
 c.abandonment_observed_at, c.retrieved_at, c.status, c.recovered_at,
 c.cart_value, c.subtotal, c.discount_amount, c.tax_amount, c.shipping_amount,
 c.duties_amount, c.taxes_included, c.currency,
 EXISTS (SELECT 1 FROM orders co WHERE co.store_id = c.store_id AND co.abandoned_cart_id = c.id) AS has_verified_order,
 (SELECT json_agg(json_build_object('internal_order_id', co.id, 'external_order_id', co.external_order_id,
   'order_name', co.external_order_name, 'ordered_at', co.ordered_at))
  FROM orders co WHERE co.store_id = c.store_id AND co.abandoned_cart_id = c.id) AS orders
FROM abandoned_carts c JOIN stores s ON s.id = c.store_id
WHERE {_SCOPE}
"""

_LINE_RECORD_SQL = """
SELECT i.abandoned_cart_id, i.id, i.external_line_item_id, i.external_product_id,
 i.external_variant_id, i.product_name, i.variant_name, i.sku, i.quantity,
 i.price, i.discounted_unit_price, i.original_line_total, i.discount_amount,
 i.line_subtotal, i.currency
FROM abandoned_cart_items i JOIN abandoned_carts c ON c.id = i.abandoned_cart_id
JOIN stores s ON s.id = c.store_id
WHERE s.organization_id = :org_id AND s.status IN ('active', 'connected', 'syncing')
 AND i.abandoned_cart_id = ANY(:checkout_ids::uuid[])
ORDER BY i.abandoned_cart_id, i.external_line_item_id, i.id LIMIT 5000
"""

_DEFINITIONS = {
    "observed_checkout_count": "Unique stored checkout records whose source creation time is in [start, end). This is not a universal checkout-start count.",
    "completed_checkout_count": "Observed records with Shopify completedAt or a verified exact checkout-to-order relationship.",
    "completed_with_order_count": "Observed records linked to an order through the exact identifier reconciliation pipeline.",
    "abandoned_checkout_count": "Uncompleted records explicitly returned by Shopify abandonedCheckouts and still available at the latest complete reconciliation.",
    "unknown_lifecycle_count": "Observed uncompleted records without explicit Shopify abandonedCheckouts evidence. Pending webhooks and legacy age-based records remain unknown.",
    "incomplete_checkout_count": "Observed records missing stable/source/financial fields or no longer present in the latest complete source reconciliation.",
    "source_unavailable_count": "Previously observed Shopify records absent from the latest complete source reconciliation; they are retained as historical evidence, not deleted.",
    "conflicting_relationship_count": "Observed records with an unresolved exact-identifier order reconciliation case; no conversion is inferred from weak similarity.",
}

_LIMITATIONS = [
    "Shopify abandonedCheckouts is not a universal checkout-start feed; observed checkout counts are not storewide checkout-start counts.",
    "Observed abandoned checkouts and their recorded values are not confirmed lost sales, recoverable revenue, paid revenue or guaranteed opportunities.",
    "An inactive or old checkout is not inferred to be abandoned. No abandonment cause is inferred without source evidence.",
    "Shipping amount is not exposed by Shopify's AbandonedCheckout object and remains unavailable rather than zero.",
    "Customer contact, address, access-token, recovery-token and session fields are excluded from Rev evidence.",
]


def _row(row: Any, key: str, default=None):
    try:
        return row[key]
    except (KeyError, IndexError, TypeError):
        return getattr(row, key, default)


def _int(row: Any, key: str) -> int | None:
    value = _row(row, key)
    if isinstance(value, bool):
        return None
    try:
        result = int(value)
    except (TypeError, ValueError):
        return None
    return result if result >= 0 else None


def _json(value, fallback):
    if value is None:
        return fallback
    if isinstance(value, (dict, list)):
        return value
    try:
        import json
        return json.loads(str(value))
    except (TypeError, ValueError):
        return fallback


def _money(value):
    return str(value) if value is not None else None


def _coverage(stores: list, ledgers: list, ledger_error: str | None, now: datetime, period_end: datetime) -> tuple[dict, dict, list[str]]:
    warnings: list[str] = []
    by_store = {str(_row(row, "store_id")): row for row in ledgers}
    details = []
    complete = not ledger_error and bool(stores)
    sync_dates = []
    for store in stores:
        store_id = str(_row(store, "id"))
        ledger = by_store.get(store_id)
        checkpoint = _json(_row(ledger, "checkpoint"), {}) if ledger else {}
        platform = str(_row(store, "platform") or "").lower()
        reasons = []
        if ledger_error:
            reasons.append("synchronization_ledger_unavailable")
        elif not ledger:
            reasons.append("resource_not_synchronized")
        else:
            if _row(ledger, "status") == "running":
                reasons.append("synchronization_in_progress")
            elif _row(ledger, "status") != "ok":
                reasons.append("retrieval_failed")
            if _row(ledger, "pagination_complete") is not True:
                reasons.append("pagination_incomplete")
            for key, reason in (("unfiltered_root", "historical_scope_unverified"),
                                ("nested_complete", "line_item_pagination_incomplete"),
                                ("scope_verified", "effective_authorization_unverified"),
                                ("reconciliation_complete", "source_reconciliation_incomplete")):
                if checkpoint.get(key) is not True:
                    reasons.append(reason)
            error_code = str(_row(ledger, "error_code") or "")
            if "READ_ORDERS" in error_code:
                reasons.append("missing_shopify_authorization")
            if "ACCESS" in error_code or "PERMISSION" in error_code:
                reasons.append("merchant_consent_or_staff_permission_unavailable")
        if platform != "shopify":
            reasons.append("unsupported_resource")
        if reasons:
            complete = False
        succeeded = _row(ledger, "last_succeeded_at") if ledger else None
        checked = _row(ledger, "last_checked_at") if ledger else None
        if isinstance(succeeded, datetime):
            sync_dates.append(succeeded)
            if ensure_utc(succeeded) < period_end:
                reasons.append("period_end_precedes_latest_complete_retrieval")
                complete = False
        details.append({"store_id": store_id, "platform": platform,
                        "status": "complete" if not reasons else "partial",
                        "reasons": sorted(set(reasons)),
                        "source_record_count": _int(ledger, "records_discovered") if ledger else None,
                        "last_successful_synchronization": iso(succeeded),
                        "last_checked_at": iso(checked)})
    if sync_dates:
        oldest = min(ensure_utc(value) for value in sync_dates)
        age = max(0, int((now - oldest).total_seconds()))
        freshness = {"state": "fresh" if age <= 3600 else "aging" if age <= 7200 else "stale",
                     "as_of": iso(oldest), "age_seconds": age, "policy": "3600s"}
    else:
        freshness = {"state": "unknown", "as_of": None, "age_seconds": None, "policy": "3600s"}
    if not complete:
        warnings.append("checkout_coverage_incomplete")
    return ({"complete": complete, "status": "complete" if complete else "partial",
             "resource": "Shopify abandonedCheckouts plus exact order relationships",
             "period_semantics": "The latest successful unfiltered source traversal covers only records exposed by Shopify at that retrieval time.",
             "stores": details}, freshness, warnings)


def _record(row: Any, items: list) -> dict:
    checkout_id = str(_row(row, "id"))
    completed = bool(_row(row, "completed_at") or _row(row, "recovered_at") or _row(row, "has_verified_order"))
    abandoned = bool(_row(row, "source_resource") == "abandonedCheckouts" and _row(row, "source_state") == "available" and not completed)
    line_items = []
    for item in items:
        if str(_row(item, "abandoned_cart_id")) != checkout_id:
            continue
        line_items.append({
            "id": str(_row(item, "id")), "external_line_item_id": _row(item, "external_line_item_id"),
            "product_id": _row(item, "external_product_id"), "variant_id": _row(item, "external_variant_id"),
            "product_title_at_checkout": _row(item, "product_name"),
            "variant_title_at_checkout": _row(item, "variant_name"), "sku_at_checkout": _row(item, "sku"),
            "quantity": _int(item, "quantity"), "unit_price": _money(_row(item, "price")),
            "discounted_unit_price": _money(_row(item, "discounted_unit_price")),
            "original_line_total": _money(_row(item, "original_line_total")),
            "discount_amount": _money(_row(item, "discount_amount")),
            "line_subtotal": _money(_row(item, "line_subtotal")), "currency": _row(item, "currency"),
        })
    return {
        "id": checkout_id, "store_id": str(_row(row, "store_id")),
        "external_checkout_id": _row(row, "external_cart_id"), "name": _row(row, "external_checkout_name"),
        "source_resource": _row(row, "source_resource"), "source_state": _row(row, "source_state"),
        "created_at": iso(_row(row, "source_created_at")), "updated_at": iso(_row(row, "source_updated_at")),
        "completed_at": iso(_row(row, "completed_at")),
        "abandonment_observed_at": iso(_row(row, "abandonment_observed_at")),
        "retrieved_at": iso(_row(row, "retrieved_at")),
        "lifecycle": "completed" if completed else "abandoned" if abandoned else "unknown",
        "verified_order_relationship": bool(_row(row, "has_verified_order")),
        "orders": _json(_row(row, "orders"), []),
        "financial": {"total": _money(_row(row, "cart_value")), "subtotal": _money(_row(row, "subtotal")),
                      "discounts": _money(_row(row, "discount_amount")), "taxes": _money(_row(row, "tax_amount")),
                      "shipping": _money(_row(row, "shipping_amount")), "duties": _money(_row(row, "duties_amount")),
                      "taxes_included": _row(row, "taxes_included"), "currency": _row(row, "currency")},
        "line_items": line_items,
    }


def _product_items(org_id: str, db, start: datetime, end: datetime, timezone: str,
                   coverage: dict, freshness: dict) -> tuple[list[dict], str | None]:
    rows, error = safe_query(db, _PRODUCT_SQL, {"org_id": org_id, "start": start, "end": end})
    if error or len(rows) > 500:
        return [], "checkout_product_aggregate_unavailable" if error else "checkout_product_aggregate_limit_exceeded"
    window = period(start, end, timezone_label=timezone)
    items = []
    for row in rows:
        titles = sorted(str(value) for value in (_row(row, "historical_product_titles") or []))
        value = {"quantity": None if (_int(row, "missing_quantity_count") or 0) else _int(row, "quantity"),
                 "checkout_count": _int(row, "checkout_count"),
                 "historical_line_value": None if (_int(row, "incomplete_value_count") or 0) else _money(_row(row, "historical_line_value")),
                 "currency": _row(row, "currency"), "historical_product_titles": titles,
                 "historical_variant_titles": sorted(str(v) for v in (_row(row, "historical_variant_titles") or [])),
                 "historical_skus": sorted(str(v) for v in (_row(row, "historical_skus") or []))}
        product_id, variant_id = _row(row, "product_id"), _row(row, "variant_id")
        items.append(evidence_item("abandoned_checkout_variant_lines",
            label=f"{titles[0] if titles else 'Unidentified historical product'} — {variant_id or 'unidentified variant'}",
            value=value, unit="record", window=window, source="abandoned_cart_items",
            definition="Historical line quantities, distinct checkout count and discounted line values for eligible observed abandoned checkouts; not current catalog, revenue or loss evidence.",
            coverage=coverage, freshness=freshness, limitations=_LIMITATIONS, domain="checkouts",
            discriminator=f"{product_id or 'unknown'}:{variant_id or 'unknown'}:{_row(row, 'currency') or 'unknown'}",
            classification="deterministic_calculation",
            provenance={"retrieval": "aggregate", "transformation": "Group exact-checkout lines by historical product, variant and currency.",
                        "calculation_version": "checkout-lines-v1", "lineage": ["abandoned_cart_items"], "reproducible": True}))
    return items, None


def retrieve_checkout_evidence(organization_id: str, db, *, start: datetime, end: datetime,
                               now: datetime | None = None, timezone: str = "UTC",
                               abandoned_only: bool = False, checkout_reference: str | None = None,
                               latest: bool = False, include_records: bool = False,
                               compare: bool = False, year_over_year: bool = False,
                               comparison_start: datetime | None = None,
                               comparison_end: datetime | None = None) -> dict:
    if not organization_id or not isinstance(organization_id, str):
        raise ValueError("Authenticated organization is required")
    if checkout_reference and latest:
        raise ValueError("latest cannot be combined with a checkout reference")
    start, end = ensure_utc(start, field="start"), ensure_utc(end, field="end")
    if end <= start:
        raise ValueError("end must be after start")
    now = ensure_utc(now or utc_now(), field="now")
    window = period(start, end, timezone_label=timezone)
    stores, store_error = safe_query(db, _STORE_SQL, {"org_id": organization_id})
    if store_error or not stores:
        return {"schema_version": EVIDENCE_SCHEMA_VERSION, "items": [], "coverage": {"complete": False},
                "freshness": {"state": "unknown"}, "warnings": ["authorized_store_scope_unavailable" if store_error else "no_authorized_store"],
                "limitations": _LIMITATIONS, "overall_status": STATUS_UNAVAILABLE, "generated_at": iso(now)}
    ledgers, ledger_error = safe_query(db, _LEDGER_SQL, {"org_id": organization_id})
    coverage, freshness, warnings = _coverage(stores, ledgers, ledger_error, now, end)
    params = {"org_id": organization_id, "start": start, "end": end, "timezone": timezone}
    record_mode = bool(checkout_reference or latest or include_records)
    items: list[dict] = []

    if record_mode:
        sql = _RECORD_SQL
        record_params = dict(params)
        if checkout_reference:
            reference = str(checkout_reference).strip()[:128]
            if not reference:
                raise ValueError("checkout reference cannot be empty")
            sql += " AND (c.id::text = :reference OR c.external_cart_id = :reference OR c.external_checkout_name = :reference)"
            record_params["reference"] = reference
        else:
            sql += f" AND {_PERIOD}"
            if abandoned_only:
                sql += f" AND {_ABANDONED}"
        sql += " ORDER BY COALESCE(c.source_created_at, c.abandoned_at, c.created_at) DESC, c.id DESC LIMIT 101"
        rows, error = safe_query(db, sql, record_params)
        if error:
            return {"schema_version": EVIDENCE_SCHEMA_VERSION, "items": [], "coverage": coverage, "freshness": freshness,
                    "warnings": warnings + ["checkout_record_query_failed"], "limitations": _LIMITATIONS,
                    "overall_status": STATUS_UNAVAILABLE, "generated_at": iso(now)}
        if len(rows) > 100:
            warnings.append("checkout_record_result_truncated")
            rows = rows[:100]
        if checkout_reference and len(rows) > 1 and not str(checkout_reference).isdigit():
            return {"schema_version": EVIDENCE_SCHEMA_VERSION, "items": [], "coverage": coverage, "freshness": freshness,
                    "warnings": warnings + ["ambiguous_checkout_reference"],
                    "limitations": _LIMITATIONS + ["Use the stable Shopify checkout ID or internal UUID."],
                    "overall_status": STATUS_PARTIAL, "generated_at": iso(now)}
        if latest:
            rows = rows[:1]
        if rows:
            line_rows, line_error = safe_query(db, _LINE_RECORD_SQL,
                {"org_id": organization_id, "checkout_ids": [str(_row(row, "id")) for row in rows]})
            if line_error:
                warnings.append("checkout_line_items_incomplete")
            for row in rows:
                value = _record(row, [] if line_error else line_rows)
                items.append(evidence_item("checkout_record", label=value["name"] or f"Shopify checkout {value['external_checkout_id']}",
                    value=value, unit="record", window=window, source="abandoned_carts",
                    definition="Authorized stored checkout with source lifecycle, historical lines, financial fields and exact order relationships; no customer PII.",
                    coverage=coverage, freshness=freshness, limitations=_LIMITATIONS,
                    status=STATUS_PARTIAL if line_error else STATUS_AVAILABLE,
                    classification="verified_fact", evidence_type="checkout_record", domain="checkouts",
                    discriminator=value["id"],
                    source_references=[{"source_id": value["external_checkout_id"], "resource": value["source_resource"] or "unknown", "sync_run_id": None}],
                    provenance={"retrieval": "direct", "transformation": "Tenant/store-scoped source record and exact relationship resolution.",
                                "calculation_version": "checkout-record-v1", "lineage": [f"checkout:{value['id']}"], "reproducible": True}))
        else:
            items.append(evidence_item("checkout_record", label="Checkout record unavailable", value=None,
                unit="record", window=window, source="abandoned_carts", status=STATUS_PARTIAL,
                definition="No authorized stored checkout matches the requested reference or observed lifecycle population.",
                coverage=coverage, freshness=freshness,
                limitations=_LIMITATIONS + ["Missing stored evidence does not prove the Shopify checkout does not exist."]))
        return {"schema_version": EVIDENCE_SCHEMA_VERSION, "items": items, "coverage": coverage,
                "freshness": freshness, "warnings": warnings, "limitations": _LIMITATIONS,
                "overall_status": availability_of(items), "generated_at": iso(now)}

    aggregate_sql = _AGGREGATE_SQL + (f" AND {_ABANDONED}" if abandoned_only else "")
    rows, error = safe_query(db, aggregate_sql, params)
    if error or not rows:
        return {"schema_version": EVIDENCE_SCHEMA_VERSION, "items": [], "coverage": coverage,
                "freshness": freshness, "warnings": warnings + ["checkout_aggregate_query_failed"],
                "limitations": _LIMITATIONS, "overall_status": STATUS_UNAVAILABLE, "generated_at": iso(now)}
    totals = {key: sum(value for row in rows if (value := _int(row, key)) is not None) for key in _DEFINITIONS}
    invalid = any(_int(row, "observed_checkout_count") is None for row in rows)
    for key, definition in _DEFINITIONS.items():
        items.append(evidence_item(key, label=key.replace("_", " ").capitalize(),
            value=None if invalid else totals[key], window=window, source="abandoned_carts",
            definition=definition, coverage=coverage, freshness=freshness, limitations=_LIMITATIONS,
            domain="checkouts", classification="deterministic_calculation",
            provenance={"retrieval": "aggregate", "transformation": definition,
                        "calculation_version": "checkout-lifecycle-v1", "lineage": ["abandoned_carts", "orders"], "reproducible": True}))

    if not abandoned_only:
        eligible = totals["completed_checkout_count"] + totals["abandoned_checkout_count"]
        for metric, numerator, label in (("observed_checkout_completion_rate", totals["completed_checkout_count"], "Observed checkout completion rate"),
                                         ("observed_checkout_abandonment_rate", totals["abandoned_checkout_count"], "Observed checkout abandonment rate")):
            value = Decimal("0") if eligible == 0 else Decimal(numerator) / Decimal(eligible)
            items.append(evidence_item(metric, label=label, value=value, unit=UNIT_RATIO,
                window=window, source="abandoned_carts", status=STATUS_UNAVAILABLE if eligible == 0 else STATUS_AVAILABLE,
                definition=f"{label}: {numerator} definitive observed records / {eligible} completed-plus-explicitly-abandoned records × 100; unknown/incomplete lifecycle records are excluded from this denominator.",
                coverage=coverage, freshness=freshness, limitations=_LIMITATIONS,
                domain="checkouts", classification="deterministic_calculation",
                measurement={"amount": None, "currency": None, "interpretation": "not_applicable",
                             "tax": "not_applicable", "shipping": "not_applicable", "discounts": "not_applicable",
                             "refunds": "not_applicable", "cancellations": "not_applicable",
                             "numerator": f"{metric}:{numerator}", "denominator": f"completed_plus_abandoned:{eligible}",
                             "formula": "numerator / eligible_observed_checkouts * 100"},
                provenance={"retrieval": "calculation", "transformation": "Divide definitive lifecycle populations only; zero denominator is unavailable.",
                            "calculation_version": "checkout-rates-v1", "lineage": ["abandoned_carts", "orders"], "reproducible": True}))

    value_rows, value_error = safe_query(db, _VALUE_SQL, params)
    if value_error:
        warnings.append("abandoned_checkout_value_unavailable")
    for row in value_rows:
        currency = _row(row, "currency")
        missing = (_int(row, "missing_value_count") or 0) > 0
        items.append(evidence_item("abandoned_checkout_recorded_value", label=f"Recorded abandoned checkout value ({currency or 'unknown'})",
            value=None if missing or not currency else _row(row, "recorded_value"), unit=UNIT_CURRENCY,
            currency=currency, window=window, source="abandoned_carts",
            definition="Sum of recorded totals for eligible observed abandoned checkouts in one currency; not lost, paid or recoverable revenue.",
            status=STATUS_PARTIAL if missing or not currency else STATUS_AVAILABLE,
            coverage=coverage, freshness=freshness, limitations=_LIMITATIONS,
            domain="checkouts", discriminator=currency or "unknown", classification="deterministic_calculation",
            measurement={"amount": _money(_row(row, "recorded_value")), "currency": currency,
                         "interpretation": "gross", "tax": "unknown", "shipping": "unknown",
                         "discounts": "deducted" if _row(row, "discounts") is not None else "unknown",
                         "refunds": "not_applicable", "cancellations": "not_applicable",
                         "numerator": f"eligible_observed_abandoned_checkouts:{_int(row, 'checkout_count')};missing_values:{_int(row, 'missing_value_count')}",
                         "denominator": None, "formula": "SUM(recorded checkout total) BY currency; shipping is unsupported"},
            provenance={"retrieval": "aggregate", "transformation": "Currency-separated decimal sum over eligible observed abandoned records.",
                        "calculation_version": "checkout-values-v1", "lineage": ["abandoned_carts"], "reproducible": True}))

    daily_rows, daily_error = safe_query(db, _DAILY_SQL, params)
    if daily_error:
        warnings.append("checkout_daily_activity_unavailable")
    for row in daily_rows:
        date = str(_row(row, "activity_date"))
        items.append(evidence_item("checkout_activity_by_date", label=f"Observed checkout activity {date}",
            value={"observed": _int(row, "observed_checkout_count"), "completed": _int(row, "completed_checkout_count"),
                   "abandoned": _int(row, "abandoned_checkout_count"), "timezone": timezone},
            unit="record", window=window, source="abandoned_carts",
            definition="Observed records grouped by source checkout creation date in the merchant timezone; not universal checkout starts.",
            coverage=coverage, freshness=freshness, limitations=_LIMITATIONS,
            domain="checkouts", discriminator=date, classification="deterministic_calculation"))

    product_items, product_error = _product_items(organization_id, db, start, end, timezone, coverage, freshness)
    items.extend(product_items)
    if product_error:
        warnings.append(product_error)

    comparison_items = []
    if compare:
        if (comparison_start is None) != (comparison_end is None):
            raise ValueError("comparison_start and comparison_end must be supplied together")
        if comparison_start is not None:
            comparison_start = ensure_utc(comparison_start, field="comparison_start")
            comparison_end = ensure_utc(comparison_end, field="comparison_end")
            if not (comparison_start < comparison_end <= start):
                raise ValueError("comparison window must precede the reporting window")
        else:
            comparison_start, comparison_end = previous_period(start, end)
        previous = retrieve_checkout_evidence(organization_id, db, start=comparison_start, end=comparison_end,
            now=now, timezone=timezone, abandoned_only=abandoned_only)
        comparison_items = previous["items"]
    year_ago = None
    if year_over_year:
        tz = _safe_zoneinfo(timezone) or datetime_timezone.utc
        def shift(value):
            local = value.astimezone(tz)
            try:
                shifted = local.replace(year=local.year - 1)
            except ValueError:
                shifted = local.replace(year=local.year - 1, day=28)
            return shifted.astimezone(datetime_timezone.utc)
        year_start, year_end = shift(start), shift(end)
        previous_year = retrieve_checkout_evidence(organization_id, db, start=year_start, end=year_end,
            now=now, timezone=timezone, abandoned_only=abandoned_only)
        year_ago = {"period": previous_year.get("period") or period(year_start, year_end, timezone_label=timezone),
                    "overall_status": previous_year["overall_status"], "items": previous_year["items"]}
    return {"schema_version": EVIDENCE_SCHEMA_VERSION, "metric_family": "checkouts",
            "organization_scope": {"type": "authenticated_organization", "store_count": len(stores)},
            "period": window, "generated_at": iso(now), "retrieved_at": iso(now),
            "items": items, "comparison_items": comparison_items, "year_over_year": year_ago,
            "coverage": coverage, "freshness": freshness, "warnings": warnings,
            "limitations": _LIMITATIONS,
            "overall_status": STATUS_PARTIAL if (value_error or daily_error or product_error) else availability_of(items)}
