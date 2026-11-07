"""Currency-explicit revenue evidence (Task 198 / Rev Intelligence).

Only orders belonging to stores owned by the authenticated organization are
read. Cancelled orders are excluded, test orders are excluded from every
monetary metric (and reported as a count), the window is half-open, and
currencies are never summed together. A verified zero is reported as ``0``; a
monetary total that cannot be attributed to a single currency is
``unsupported`` with a ``null`` value, never ``0`` and never a substituted
USD figure.

Financial measures are defined once in
:mod:`src.intelligence.financial_metrics` and every evidence item carries the
formula and the treatment of taxes, shipping, discounts, refunds and
cancellations. Refunds are deducted exactly once: the persisted order total is
Shopify's refund-adjusted current total, so the itemised refund ledger is used
to describe refund money, never subtracted a second time.

Coverage and freshness travel with every result: order coverage from the
certified ``intelligence_order_coverage`` ledger, refund and payment-
transaction coverage from the per-domain sync ledger, and store sync
freshness from ``stores.last_synced_at``. A zero is only ``verified_zero``
when the certified coverage contains the whole window.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Any

from .evidence import (
    EVIDENCE_SCHEMA_VERSION,
    STATUS_AVAILABLE,
    STATUS_PARTIAL,
    STATUS_UNAVAILABLE,
    STATUS_UNSUPPORTED,
    UNIT_COUNT,
    UNIT_CURRENCY,
    decimal_value,
    evidence_context,
    evidence_item,
    ensure_utc,
    group_by_currency,
    iso,
    normalize_currency,
    period,
    previous_period,
    utc_now,
)
from .financial_metrics import METRIC_DEFINITIONS, quantize
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

_STORE_FILTER = (
    "s.organization_id = :org_id AND s.status IN ("
    + ", ".join("'" + status + "'" for status in ACTIVE_STORE_STATUSES)
    + ")"
)
_NOT_CANCELLED = (
    "(o.recovery_status IS NULL OR o.recovery_status NOT IN ("
    + ", ".join("'" + status + "'" for status in EXCLUDED_ORDER_STATUSES)
    + "))"
)

# Order money in the window, aggregated per currency. Monetary sums carry the
# verified-row count they were computed over so a metric whose source field is
# missing for some orders can be flagged partial instead of silently treated
# as complete. Gross value only covers orders whose refund amount is recorded.
_ORDER_SQL = f"""
    SELECT o.currency,
           COUNT(*) FILTER (WHERE o.test_flag IS NOT TRUE) AS order_count,
           COALESCE(SUM(o.total) FILTER (WHERE o.test_flag IS NOT TRUE), 0) AS net_value,
           SUM(o.total + o.refunded_total)
               FILTER (WHERE o.refunded_total IS NOT NULL AND o.test_flag IS NOT TRUE) AS gross_value,
           COUNT(*) FILTER (WHERE o.refunded_total IS NOT NULL AND o.test_flag IS NOT TRUE) AS gross_verified,
           SUM(o.refunded_total) FILTER (WHERE o.test_flag IS NOT TRUE) AS refunded_to_date_value,
           COUNT(*) FILTER (WHERE o.refunded_total IS NOT NULL AND o.test_flag IS NOT TRUE) AS refunded_to_date_verified,
           SUM(o.discount_amount) FILTER (WHERE o.test_flag IS NOT TRUE) AS discount_value,
           COUNT(*) FILTER (WHERE o.discount_amount IS NOT NULL AND o.test_flag IS NOT TRUE) AS discount_verified,
           SUM(o.subtotal) FILTER (WHERE o.test_flag IS NOT TRUE) AS line_items_value,
           COUNT(*) FILTER (WHERE o.subtotal IS NOT NULL AND o.test_flag IS NOT TRUE) AS line_items_verified,
           SUM(o.tax_amount) FILTER (WHERE o.test_flag IS NOT TRUE) AS tax_value,
           COUNT(*) FILTER (WHERE o.tax_amount IS NOT NULL AND o.test_flag IS NOT TRUE) AS tax_verified,
           SUM(o.shipping_amount) FILTER (WHERE o.test_flag IS NOT TRUE) AS shipping_value,
           COUNT(*) FILTER (WHERE o.shipping_amount IS NOT NULL AND o.test_flag IS NOT TRUE) AS shipping_verified,
           SUM(o.total_received) FILTER (WHERE o.test_flag IS NOT TRUE) AS received_value,
           COUNT(*) FILTER (WHERE o.total_received IS NOT NULL AND o.test_flag IS NOT TRUE) AS received_verified,
           SUM(GREATEST(0, o.total - o.total_received))
               FILTER (WHERE o.total_received IS NOT NULL AND o.test_flag IS NOT TRUE) AS outstanding_value,
           COUNT(*) FILTER (WHERE o.total_received IS NOT NULL AND o.test_flag IS NOT TRUE) AS outstanding_verified,
           COUNT(*) FILTER (WHERE o.test_flag IS TRUE) AS test_order_count,
           COUNT(*) FILTER (WHERE o.currency IS NULL OR o.currency !~ '^[A-Z]{3}$') AS currency_unverified_count,
           COUNT(*) FILTER (WHERE o.total < 0) AS negative_net_count
    FROM orders o
    JOIN stores s ON s.id = o.store_id
    WHERE {_STORE_FILTER}
      AND o.ordered_at >= :start AND o.ordered_at < :end
      AND {_NOT_CANCELLED}
    GROUP BY o.currency
    ORDER BY o.currency
"""

# Refund money issued in the window, attributed to the refund date, from the
# itemised Shopify refund ledger. The join through orders enforces tenant
# scope, store status and the cancelled-order exclusion.
_REFUND_SQL = f"""
    SELECT COALESCE(NULLIF(r.refund_currency, ''), o.currency) AS currency,
           COUNT(*) AS refund_count,
           SUM(r.refund_amount) AS refund_value,
           COUNT(*) FILTER (WHERE r.refund_amount IS NOT NULL) AS refund_verified
    FROM order_refunds r
    JOIN orders o ON o.store_id = r.store_id AND o.external_order_id = r.external_order_id
    JOIN stores s ON s.id = o.store_id
    WHERE {_STORE_FILTER}
      AND r.created_at >= :start AND r.created_at < :end
      AND {_NOT_CANCELLED}
    GROUP BY COALESCE(NULLIF(r.refund_currency, ''), o.currency)
    ORDER BY 1
"""

# Refunds without a recorded date cannot be attributed to any reporting
# window; counting them (store-wide, not window-scoped) makes that coverage
# gap visible instead of letting the window total pretend to be complete.
_REFUND_UNDATED_SQL = f"""
    SELECT COUNT(*) AS undated_count
    FROM order_refunds r
    JOIN orders o ON o.store_id = r.store_id AND o.external_order_id = r.external_order_id
    JOIN stores s ON s.id = o.store_id
    WHERE {_STORE_FILTER}
      AND r.created_at IS NULL
      AND {_NOT_CANCELLED}
"""

# Captured payment money in the window, attributed to the transaction date,
# from the Shopify order payment-transaction ledger. Only successful SALE and
# CAPTURE transactions are captured money; authorizations, voids and failed
# attempts are not.
_TXN_SQL = f"""
    SELECT t.currency,
           COUNT(*) AS captured_transaction_count,
           SUM(t.amount) AS captured_value,
           COUNT(*) FILTER (WHERE t.amount IS NOT NULL) AS captured_verified
    FROM order_transactions t
    JOIN orders o ON o.store_id = t.store_id AND o.external_order_id = t.external_order_id
    JOIN stores s ON s.id = o.store_id
    WHERE {_STORE_FILTER}
      AND t.kind IN ('SALE', 'CAPTURE')
      AND t.status = 'SUCCESS'
      AND t.processed_at >= :start AND t.processed_at < :end
      AND {_NOT_CANCELLED}
    GROUP BY t.currency
    ORDER BY t.currency
"""

_TXN_UNDATED_SQL = f"""
    SELECT COUNT(*) AS undated_count
    FROM order_transactions t
    JOIN orders o ON o.store_id = t.store_id AND o.external_order_id = t.external_order_id
    JOIN stores s ON s.id = o.store_id
    WHERE {_STORE_FILTER}
      AND t.kind IN ('SALE', 'CAPTURE')
      AND t.status = 'SUCCESS'
      AND t.processed_at IS NULL
      AND {_NOT_CANCELLED}
"""

# Reconciliation between the persisted ledger and the persisted order rows.
# Duplicates are impossible by unique constraint in a healthy store, but the
# check runs anyway so a constraint regression or a manual import never hides.
# The ledger/order refund mismatch compares each in-window order's recorded
# lifetime refunds against the itemised refund rows for the same order.
_RECON_SQL = f"""
    SELECT
      (SELECT COUNT(*) FROM (
          SELECT r.store_id, r.external_id
          FROM order_refunds r
          JOIN stores s ON s.id = r.store_id
          WHERE {_STORE_FILTER}
          GROUP BY r.store_id, r.external_id
          HAVING COUNT(*) > 1
      ) d) AS duplicate_refund_groups,
      (SELECT COUNT(*) FROM (
          SELECT t.store_id, t.external_id
          FROM order_transactions t
          JOIN stores s ON s.id = t.store_id
          WHERE {_STORE_FILTER}
          GROUP BY t.store_id, t.external_id
          HAVING COUNT(*) > 1
      ) d) AS duplicate_transaction_groups,
      (SELECT COUNT(*) FROM (
          SELECT o.store_id, o.external_order_id
          FROM orders o
          JOIN stores s ON s.id = o.store_id
          WHERE {_STORE_FILTER}
            AND o.ordered_at >= :start AND o.ordered_at < :end
            AND {_NOT_CANCELLED}
            AND o.refunded_total IS NOT NULL
          GROUP BY o.store_id, o.external_order_id
          HAVING ABS(SUM(o.refunded_total) - COALESCE((
                  SELECT SUM(r.refund_amount)
                  FROM order_refunds r
                  WHERE r.store_id = o.store_id
                    AND r.external_order_id = o.external_order_id
              ), 0)) > 0.01
      ) d) AS refund_ledger_mismatches
"""

# Per-domain sync ledger for the financial sub-domains. A domain is covered
# for a store only when its ledger completed a fully paginated run.
_DOMAIN_SQL = f"""
    SELECT d.store_id, d.domain, d.status, d.pagination_complete, d.last_succeeded_at
    FROM store_sync_domain_states d
    JOIN stores s ON s.id = d.store_id
    WHERE {_STORE_FILTER}
      AND d.domain IN ('refunds', 'transactions')
    ORDER BY d.domain, d.store_id
"""

_DOMAIN_FRESH_SECONDS = 3600


def _row_value(row: Any, key: str, default=None):
    try:
        return row[key]
    except (KeyError, IndexError, TypeError):
        return getattr(row, key, default)


def _int(value: Any) -> int | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _dec(value: Any) -> Decimal | None:
    return decimal_value(value)


def _safe_zoneinfo(name: str | None):
    if not name:
        return None
    try:
        from zoneinfo import ZoneInfo

        return ZoneInfo(name)
    except Exception:
        return None


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
    age_seconds = max(0, (now - oldest).total_seconds())
    state = "fresh" if age_seconds <= _DOMAIN_FRESH_SECONDS else (
        "aging" if age_seconds <= _DOMAIN_FRESH_SECONDS * 2 else "stale")
    return {
        "state": state,
        "as_of": iso(oldest),
        "age_seconds": int(age_seconds),
        "policy": f"{_DOMAIN_FRESH_SECONDS}s",
        "note": "Age of the oldest completed store sync in scope.",
    }


def _domain_freshness(rows: list, domain: str, store_ids: set[str], now: datetime) -> dict:
    covered = [
        ensure_utc(_row_value(row, "last_succeeded_at"))
        for row in rows
        if _row_value(row, "domain") == domain
        and str(_row_value(row, "store_id")) in store_ids
        and _row_value(row, "status") == "ok"
        and _row_value(row, "pagination_complete") is True
        and isinstance(_row_value(row, "last_succeeded_at"), datetime)
    ]
    if not covered:
        return {"state": "unknown", "as_of": None,
                "note": f"No completed {domain} synchronization timestamp is available."}
    oldest = min(covered)
    age_seconds = max(0, (now - oldest).total_seconds())
    state = "fresh" if age_seconds <= _DOMAIN_FRESH_SECONDS else (
        "aging" if age_seconds <= _DOMAIN_FRESH_SECONDS * 2 else "stale")
    return {
        "state": state,
        "as_of": iso(oldest),
        "age_seconds": int(age_seconds),
        "policy": f"{_DOMAIN_FRESH_SECONDS}s",
        "note": f"Oldest completed {domain} sync across the stores in scope.",
    }


def _domain_coverage(rows: list, domain: str, store_ids: set[str]) -> tuple[bool, int, str]:
    covered = {
        str(_row_value(row, "store_id"))
        for row in rows
        if _row_value(row, "domain") == domain
        and _row_value(row, "status") == "ok"
        and _row_value(row, "pagination_complete") is True
    }
    covered_in_scope = store_ids & covered
    missing = len(store_ids - covered)
    if missing == 0:
        return True, 0, f"Every store in scope completed a fully paginated {domain} synchronization."
    return False, missing, (
        f"{missing} store(s) in scope have no completed fully paginated {domain} "
        f"synchronization; the {domain} metric is not certified for them.")


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
        "status": "complete" if total and len(certified) == total else "partial",
        "period_status": "covered" if total and len(certified) == total else "partial",
        "store_count": total,
        "certified_store_count": len(certified),
        "incomplete_store_count": len(incomplete),
        "complete": total > 0 and len(certified) == total,
        "source": "intelligence_order_coverage",
        "note": ("Every store in scope certifies order coverage for this window."
                 if total and len(certified) == total
                 else "Order coverage is not certified for every store in this window."),
    }


def _with_evidence_ownership(function):
    def owned(organization_id: str, db, **kwargs):
        from .evidence import current_evidence_context

        current = current_evidence_context()
        if current and current.get("organization_id") == organization_id:
            return function(organization_id, db, **kwargs)
        rows, error = safe_query(db, _STORE_SQL, {"org_id": organization_id})
        store_ids = [str(_row_value(row, "id")) for row in rows if _row_value(row, "id")]
        if error or not store_ids:
            now = ensure_utc(kwargs.get("now") or utc_now())
            start = ensure_utc(kwargs["start"])
            end = ensure_utc(kwargs["end"])
            return _empty_result(organization_id, period(start, end), now,
                                 ["Store scope could not be read; no revenue claim is possible." if error else "No active or connected store is available for this organization."],
                                 overall_status="storage_failure" if error else STATUS_UNAVAILABLE,
                                 reason="store_scope_query_failed" if error else "no_connected_store")
        with evidence_context(organization_id, store_ids):
            return function(organization_id, db, **kwargs)
    return owned


def _money_item(metric: str, currency: str, window: dict, *, value: Decimal | None,
                verified: int, total: int, coverage: dict, freshness: dict,
                limitations: list[str] | None = None, status: str | None = None,
                discriminant_suffix: str = "") -> dict:
    """Build one per-currency monetary evidence item with explicit semantics.

    ``verified``/``total`` express how many of the window's orders carry the
    source field. Full coverage -> available; some -> partial with the
    limitation stated; none (but orders exist) -> unavailable. A zero under
    complete coverage becomes ``verified_zero`` through the shared builder.
    """
    spec = METRIC_DEFINITIONS[metric]
    limits = list(limitations or [])
    if status is None:
        if total <= 0 or value is None:
            status = STATUS_UNAVAILABLE
        elif verified >= total:
            status = STATUS_AVAILABLE
        else:
            status = STATUS_PARTIAL
            limits.append(
                f"Source field recorded for {verified} of {total} orders; this "
                f"figure covers only those orders.")
    elif status in (STATUS_AVAILABLE, "verified_zero") and verified < total:
        status = STATUS_PARTIAL
        limits.append(
            f"Source field recorded for {verified} of {total} orders; this "
            f"figure covers only those orders.")
    amount = quantize(value)
    if status == STATUS_AVAILABLE and amount is not None and amount == 0 \
            and not (coverage or {}).get("complete", True):
        # A zero over the recorded orders cannot be certified as "no money"
        # while coverage is incomplete: keep the figure as an explicit floor,
        # never as an available zero.
        status = STATUS_PARTIAL
        limits.append(
            "Order coverage is incomplete; this zero is a floor over the "
            "recorded orders, not a certified absence of money.")
    return evidence_item(
        metric, label=spec["label"] + (f" ({currency})" if currency else ""),
        value=str(amount) if amount is not None else None,
        unit=UNIT_CURRENCY, currency=currency, window=window, source="orders",
        status=status, coverage=coverage, freshness=freshness,
        limitations=limits, discriminator=f"{currency}{discriminant_suffix}",
        measurement={
            "amount": str(amount) if amount is not None else None,
            "currency": currency,
            "interpretation": spec["interpretation"],
            "tax": spec["tax"], "shipping": spec["shipping"],
            "discounts": spec["discounts"], "refunds": spec["refunds"],
            "cancellations": spec["cancellations"],
            "numerator": None, "denominator": None, "formula": spec["formula"],
        },
        definition=spec["definition"],
    )


def _domain_money_item(metric: str, currency: str, window: dict, *,
                       value: Decimal | None, verified: int, total: int,
                       covered: bool, uncovered_note: str, coverage: dict,
                       freshness: dict) -> dict:
    """A monetary item sourced from the refund or transaction sub-ledger.

    ``covered`` is the per-domain sync-ledger coverage: without it the figure
    is at best a floor, so the item is partial (rows exist) or the caller
    emits ``not_synchronized`` (no rows, no certification).
    """
    spec = METRIC_DEFINITIONS[metric]
    source = "order_refunds" if metric == "refund_amount" else "order_transactions"
    limits: list[str] = []
    if not covered:
        status = STATUS_PARTIAL
        limits.append(uncovered_note)
    elif verified >= total:
        status = STATUS_AVAILABLE
    else:
        status = STATUS_PARTIAL
        limits.append(
            f"Amounts verified for {verified} of {total} records; this figure "
            f"covers only those records.")
    amount = quantize(value)
    if status == STATUS_AVAILABLE and amount is not None and amount == 0 \
            and not (coverage or {}).get("complete", True):
        # A certified-zero ledger figure still cannot be asserted as "no
        # money" while order coverage is incomplete: keep the floor, label it.
        status = STATUS_PARTIAL
        limits.append(
            "Order coverage is incomplete; this zero is a floor over the "
            "recorded orders, not a certified absence of money.")
    return evidence_item(
        metric, label=spec["label"] + (f" ({currency})" if currency else ""),
        value=str(amount) if amount is not None else None,
        unit=UNIT_CURRENCY, currency=currency, window=window, source=source,
        status=status, coverage=coverage, freshness=freshness,
        limitations=limits, discriminator=f"{metric}:{currency}",
        measurement={
            "amount": str(amount) if amount is not None else None,
            "currency": currency,
            "interpretation": spec["interpretation"],
            "tax": spec["tax"], "shipping": spec["shipping"],
            "discounts": spec["discounts"], "refunds": spec["refunds"],
            "cancellations": spec["cancellations"],
            "numerator": None, "denominator": None, "formula": spec["formula"],
        },
        definition=spec["definition"],
    )


def _count_item(metric: str, label: str, value: int, window: dict, *,
                source: str = "orders", coverage: dict, freshness: dict,
                definition: str, limitations: list[str] | None = None,
                status: str | None = None, discriminator: str = "",
                currency: str | None = None) -> dict:
    return evidence_item(
        metric, label=label, value=value, unit=UNIT_COUNT, currency=currency,
        window=window, source=source, status=status or STATUS_AVAILABLE,
        coverage=coverage, freshness=freshness,
        limitations=list(limitations or []),
        definition=definition, discriminator=discriminator,
    )


@_with_evidence_ownership
def retrieve_revenue_evidence(
    organization_id: str,
    db,
    *,
    start: datetime,
    end: datetime,
    now: datetime | None = None,
    label: str | None = None,
    compare: bool = False,
    year_over_year: bool = False,
    timezone: str = "UTC",
    comparison_start: datetime | None = None,
    comparison_end: datetime | None = None,
) -> dict:
    """Return currency-separated revenue evidence for an organization.

    The caller must pass the organization taken from the authenticated request
    context.  A client-supplied organization or store identifier is never
    accepted here.

    ``start``/``end`` are the already-resolved reporting window (the merchant
    timezone resolution happens upstream in ``resolve_reporting_period``); the
    ``timezone`` label is preserved in every evidence period. When
    ``comparison_start``/``comparison_end`` are supplied (the resolved
    comparison window, e.g. the previous calendar month) they define the
    comparison period; otherwise the equal-length immediately preceding
    period is used.
    """
    if not organization_id or not isinstance(organization_id, str):
        raise ValueError("Authenticated organization is required")
    start = ensure_utc(start, field="start")
    end = ensure_utc(end, field="end")
    if end <= start:
        raise ValueError("end must be after start")
    now = ensure_utc(now or utc_now(), field="now")
    window = period(start, end, label=label, timezone_label=timezone)
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

    store_ids = {str(_row_value(store, "id")) for store in stores}
    freshness = _freshness(stores, now)
    coverage_rows, coverage_error = safe_query(db, _COVERAGE_SQL, {"org_id": organization_id})
    coverage = _coverage(stores, coverage_rows, start, end)
    if coverage_error:
        coverage["complete"] = False
        coverage["status"] = "partial"
        coverage["note"] = "Order coverage could not be read; totals are not certified."
        warnings.append("Order coverage certification is unavailable.")

    domain_rows, domain_error = safe_query(db, _DOMAIN_SQL, {"org_id": organization_id})
    if domain_error:
        domain_rows = []
    refunds_covered, refunds_missing, refunds_note = _domain_coverage(domain_rows, "refunds", store_ids)
    txns_covered, txns_missing, txns_note = _domain_coverage(domain_rows, "transactions", store_ids)
    refunds_freshness = _domain_freshness(domain_rows, "refunds", store_ids, now)
    txns_freshness = _domain_freshness(domain_rows, "transactions", store_ids, now)

    rows, order_error = safe_query(db, _ORDER_SQL, {
        "org_id": organization_id, "start": start, "end": end,
    })
    overall_status = STATUS_AVAILABLE
    degraded = False

    refund_rows: list = []
    refund_query_error = None
    refund_rows, refund_query_error = safe_query(db, _REFUND_SQL, {
        "org_id": organization_id, "start": start, "end": end,
    })
    if refund_query_error:
        warnings.append("The refund ledger could not be read; refund totals are unavailable.")
    txn_rows: list = []
    txn_query_error = None
    txn_rows, txn_query_error = safe_query(db, _TXN_SQL, {
        "org_id": organization_id, "start": start, "end": end,
    })
    if txn_query_error:
        warnings.append("The payment-transaction ledger could not be read; captured payment totals are unavailable.")

    recon: dict[str, int] = {}
    recon_rows, recon_error = safe_query(db, _RECON_SQL, {
        "org_id": organization_id, "start": start, "end": end,
    })
    if recon_error:
        warnings.append("Reconciliation checks could not be completed.")
    elif recon_rows:
        row = recon_rows[0]
        for key in ("duplicate_refund_groups", "duplicate_transaction_groups",
                    "refund_ledger_mismatches"):
            recon[key] = _int(_row_value(row, key)) or 0

    if order_error:
        overall_status = STATUS_UNAVAILABLE
        warnings.append("Order records could not be read for this window.")
        items.append(evidence_item(
            "recorded_order_count", label="Recorded order count", value=None,
            unit=UNIT_COUNT, window=window, source="orders", status=STATUS_UNAVAILABLE,
            definition=METRIC_DEFINITIONS["recorded_order_count"]["definition"],
            coverage=coverage, freshness=freshness,
            limitations=["The order query failed, so no count is asserted."],
        ))
        items.append(evidence_item(
            "recorded_order_value", label="Net sales (recorded order value)", value=None,
            unit=UNIT_CURRENCY, window=window, source="orders", status=STATUS_UNAVAILABLE,
            definition=METRIC_DEFINITIONS["recorded_order_value"]["definition"],
            coverage=coverage, freshness=freshness,
            limitations=["The order query failed, so no monetary value is asserted."],
        ))
    else:
        currency_rows = []
        for row in rows:
            raw_currency = _row_value(row, "currency")
            code = normalize_currency(raw_currency)
            if code is None:
                unverified = _int(_row_value(row, "currency_unverified_count")) or 0
                if unverified:
                    warnings.append(
                        f"{unverified} order(s) without a valid ISO currency code were "
                        "excluded from monetary totals.")
                continue
            count = _int(_row_value(row, "order_count"))
            net = _dec(_row_value(row, "net_value"))
            if count is None or net is None:
                warnings.append("An order aggregate could not be validated and was excluded.")
                continue
            currency_rows.append((code, row, count))

        if not currency_rows:
            if coverage["complete"] and not any(
                    _int(_row_value(row, "test_order_count")) for row in rows):
                count_status = STATUS_AVAILABLE
                zero_count = 0
            else:
                count_status = STATUS_PARTIAL
                zero_count = None
            items.append(_count_item(
                "recorded_order_count", "Recorded order count",
                zero_count if zero_count is not None else 0,
                window, coverage=coverage, freshness=freshness,
                definition=METRIC_DEFINITIONS["recorded_order_count"]["definition"],
                status=count_status if zero_count is None else None,
                limitations=["No non-cancelled orders are recorded in this window."]
                if zero_count == 0 else ["No currency-verified orders are recorded in this window."],
            ))
            items.append(evidence_item(
                "recorded_order_value", label="Net sales (recorded order value)", value=None,
                unit=UNIT_CURRENCY, window=window, source="orders",
                status=STATUS_UNSUPPORTED,
                definition=METRIC_DEFINITIONS["recorded_order_value"]["definition"],
                coverage=coverage, freshness=freshness,
                limitations=["No currency can be attributed to an empty order set."],
                discriminator="currencyless-zero",
            ))
        else:
            for code, row, count in currency_rows:
                test_count = _int(_row_value(row, "test_order_count")) or 0
                if count == 0:
                    # No real orders in this currency (only test orders, which
                    # are excluded): the count is certified, money is not.
                    items.append(_count_item(
                        "recorded_order_count", f"Recorded order count ({code})", 0,
                        window, coverage=coverage, freshness=freshness,
                        definition=METRIC_DEFINITIONS["recorded_order_count"]["definition"],
                        discriminator=code, currency=code,
                    ))
                    if test_count:
                        items.append(_count_item(
                            "test_order_count", f"Test orders excluded ({code})", test_count,
                            window, coverage=coverage, freshness=freshness,
                            definition=("Shopify test-mode orders recorded in the window. "
                                        "They are excluded from every revenue metric."),
                            discriminator=code, currency=code,
                            limitations=["Test orders are excluded from all monetary metrics."],
                        ))
                    continue
                net = _dec(_row_value(row, "net_value"))
                items.append(_money_item(
                    "recorded_order_value", code, window,
                    value=net, verified=count, total=count,
                    coverage=coverage, freshness=freshness,
                    limitations=["Recorded net order value (after refunds), not recognised or settled revenue."],
                ))
                gross = _dec(_row_value(row, "gross_value"))
                gross_verified = _int(_row_value(row, "gross_verified")) or 0
                items.append(_money_item(
                    "gross_sales", code, window,
                    value=gross, verified=gross_verified, total=count,
                    coverage=coverage, freshness=freshness,
                ))
                refunded_to_date = _dec(_row_value(row, "refunded_to_date_value"))
                refunded_verified = _int(_row_value(row, "refunded_to_date_verified")) or 0
                items.append(_money_item(
                    "refund_amount_window_orders", code, window,
                    value=refunded_to_date, verified=refunded_verified, total=count,
                    coverage=coverage, freshness=freshness,
                ))
                discount = _dec(_row_value(row, "discount_value"))
                discount_verified = _int(_row_value(row, "discount_verified")) or 0
                items.append(_money_item(
                    "discount_amount", code, window,
                    value=discount, verified=discount_verified, total=count,
                    coverage=coverage, freshness=freshness,
                ))
                line_items = _dec(_row_value(row, "line_items_value"))
                line_items_verified = _int(_row_value(row, "line_items_verified")) or 0
                items.append(_money_item(
                    "line_items_value", code, window,
                    value=line_items, verified=line_items_verified, total=count,
                    coverage=coverage, freshness=freshness,
                ))
                tax = _dec(_row_value(row, "tax_value"))
                tax_verified = _int(_row_value(row, "tax_verified")) or 0
                items.append(_money_item(
                    "tax_amount", code, window,
                    value=tax, verified=tax_verified, total=count,
                    coverage=coverage, freshness=freshness,
                ))
                shipping = _dec(_row_value(row, "shipping_value"))
                shipping_verified = _int(_row_value(row, "shipping_verified")) or 0
                items.append(_money_item(
                    "shipping_amount", code, window,
                    value=shipping, verified=shipping_verified, total=count,
                    coverage=coverage, freshness=freshness,
                ))
                outstanding = _dec(_row_value(row, "outstanding_value"))
                outstanding_verified = _int(_row_value(row, "outstanding_verified")) or 0
                items.append(_money_item(
                    "outstanding_amount", code, window,
                    value=outstanding, verified=outstanding_verified, total=count,
                    coverage=coverage, freshness=freshness,
                ))
                items.append(_count_item(
                    "recorded_order_count", f"Recorded order count ({code})", count,
                    window, coverage=coverage, freshness=freshness,
                    definition=METRIC_DEFINITIONS["recorded_order_count"]["definition"],
                    discriminator=code, currency=code,
                ))
                if test_count:
                    items.append(_count_item(
                        "test_order_count", f"Test orders excluded ({code})", test_count,
                        window, coverage=coverage, freshness=freshness,
                        definition=("Shopify test-mode orders recorded in the window. "
                                    "They are excluded from every revenue metric."),
                        discriminator=code, currency=code,
                        limitations=["Test orders are excluded from all monetary metrics."],
                    ))
                if (_int(_row_value(row, "negative_net_count")) or 0) > 0:
                    warnings.append(
                        f"{_row_value(row, 'negative_net_count')} order(s) in {code} carry a "
                        "negative net total; review the order records.")

            # Refund money issued in the window (refund-date attribution).
            refund_item_added = False
            for row in refund_rows:
                code = normalize_currency(_row_value(row, "currency"))
                if code is None:
                    warnings.append("A refund aggregate without a valid currency was excluded.")
                    continue
                count = _int(_row_value(row, "refund_count"))
                value = _dec(_row_value(row, "refund_value"))
                verified = _int(_row_value(row, "refund_verified")) or 0
                if count is None or value is None:
                    warnings.append("A refund aggregate could not be validated and was excluded.")
                    continue
                refund_item_added = True
                items.append(_domain_money_item(
                    "refund_amount", code, window,
                    value=value, verified=verified, total=count,
                    covered=refunds_covered, uncovered_note=refunds_note,
                    coverage=coverage, freshness=refunds_freshness,
                ))
            if refund_query_error is None and not refund_item_added:
                if refunds_covered:
                    # Certified: no refund money was issued in the window.
                    if currency_rows:
                        for code, _, _ in currency_rows:
                            items.append(_domain_money_item(
                                "refund_amount", code, window,
                                value=Decimal("0"), verified=0, total=0,
                                covered=True, uncovered_note="",
                                coverage=coverage, freshness=refunds_freshness,
                            ))
                    else:
                        items.append(evidence_item(
                            "refund_amount", label="Refunds issued in period", value=None,
                            unit=UNIT_CURRENCY, window=window, source="order_refunds",
                            status=STATUS_UNSUPPORTED, coverage=coverage,
                            freshness=refunds_freshness,
                            limitations=["No currency can be attributed to an empty order set."],
                            definition=METRIC_DEFINITIONS["refund_amount"]["definition"],
                            discriminator="refund:currencyless-zero",
                        ))
                else:
                    items.append(evidence_item(
                        "refund_amount", label="Refunds issued in period", value=None,
                        unit=UNIT_CURRENCY, window=window, source="order_refunds",
                        status="not_synchronized", coverage=coverage,
                        freshness=refunds_freshness,
                        limitations=[refunds_note],
                        definition=METRIC_DEFINITIONS["refund_amount"]["definition"],
                        discriminator="refund:uncovered",
                    ))

            # Captured payment money in the window (transaction-date attribution).
            txn_item_added = False
            for row in txn_rows:
                code = normalize_currency(_row_value(row, "currency"))
                if code is None:
                    warnings.append("A payment-transaction aggregate without a valid currency was excluded.")
                    continue
                count = _int(_row_value(row, "captured_transaction_count"))
                value = _dec(_row_value(row, "captured_value"))
                verified = _int(_row_value(row, "captured_verified")) or 0
                if count is None or value is None:
                    warnings.append("A payment-transaction aggregate could not be validated and was excluded.")
                    continue
                txn_item_added = True
                items.append(_domain_money_item(
                    "captured_payment_amount", code, window,
                    value=value, verified=verified, total=count,
                    covered=txns_covered, uncovered_note=txns_note,
                    coverage=coverage, freshness=txns_freshness,
                ))
            if txn_query_error is None and not txn_item_added:
                if txns_covered:
                    if currency_rows:
                        for code, _, _ in currency_rows:
                            items.append(_domain_money_item(
                                "captured_payment_amount", code, window,
                                value=Decimal("0"), verified=0, total=0,
                                covered=True, uncovered_note="",
                                coverage=coverage, freshness=txns_freshness,
                            ))
                    else:
                        items.append(evidence_item(
                            "captured_payment_amount",
                            label=METRIC_DEFINITIONS["captured_payment_amount"]["label"],
                            value=None, unit=UNIT_CURRENCY, window=window,
                            source="order_transactions", status=STATUS_UNSUPPORTED,
                            coverage=coverage, freshness=txns_freshness,
                            limitations=["No currency can be attributed to an empty order set."],
                            definition=METRIC_DEFINITIONS["captured_payment_amount"]["definition"],
                            discriminator="captured:currencyless-zero",
                        ))
                else:
                    items.append(evidence_item(
                        "captured_payment_amount",
                        label=METRIC_DEFINITIONS["captured_payment_amount"]["label"],
                        value=None, unit=UNIT_CURRENCY, window=window,
                        source="order_transactions", status="not_synchronized",
                        coverage=coverage, freshness=txns_freshness,
                        limitations=[txns_note],
                        definition=METRIC_DEFINITIONS["captured_payment_amount"]["definition"],
                        discriminator="captured:uncovered",
                    ))

            # Reconciliation diagnostics: visible, never hidden.
            if not recon_error:
                discrepancies = recon.get("duplicate_refund_groups", 0) \
                    + recon.get("duplicate_transaction_groups", 0) \
                    + recon.get("refund_ledger_mismatches", 0)
                recon_limits = []
                if recon.get("duplicate_refund_groups", 0):
                    recon_limits.append(f"{recon['duplicate_refund_groups']} duplicate refund group(s) detected.")
                if recon.get("duplicate_transaction_groups", 0):
                    recon_limits.append(f"{recon['duplicate_transaction_groups']} duplicate payment-transaction group(s) detected.")
                if recon.get("refund_ledger_mismatches", 0):
                    recon_limits.append(
                        f"{recon['refund_ledger_mismatches']} order(s) whose recorded refund total "
                        "does not match the itemised refund ledger.")
                items.append(_count_item(
                    "reconciliation_discrepancy_count",
                    "Reconciliation discrepancies", discrepancies,
                    window, source="orders", coverage=coverage, freshness=freshness,
                    definition=(
                        "Discrepancies between the persisted financial ledger and the "
                        "persisted order rows: duplicate refund or payment-transaction "
                        "groups, and orders whose recorded refund total does not match "
                        "the itemised refund ledger."),
                    limitations=recon_limits or ["No reconciliation discrepancies were found."],
                    status=STATUS_AVAILABLE,
                ))
                if discrepancies:
                    degraded = True
                    warnings.append(
                        "Reconciliation found discrepancies in the persisted financial "
                        "records; the affected figures may need review.")

        # Field-coverage gaps for window-attributed metrics.
        undated_refunds = None
        if refund_query_error is None:
            undated_rows, undated_error = safe_query(db, _REFUND_UNDATED_SQL, {"org_id": organization_id})
            if undated_error is None and undated_rows:
                undated_refunds = _int(_row_value(undated_rows[0], "undated_count")) or 0
                if undated_refunds:
                    warnings.append(
                        f"{undated_refunds} refund(s) lack a recorded date and cannot be "
                        "attributed to any reporting window.")
        undated_txns = None
        if txn_query_error is None:
            undated_rows, undated_error = safe_query(db, _TXN_UNDATED_SQL, {"org_id": organization_id})
            if undated_error is None and undated_rows:
                undated_txns = _int(_row_value(undated_rows[0], "undated_count")) or 0
                if undated_txns:
                    warnings.append(
                        f"{undated_txns} successful payment transaction(s) lack a recorded "
                        "processing date and cannot be attributed to any reporting window.")

        # Overall status is the certification of the primary answer: certified
        # order coverage over a validated, complete order aggregate. Sub-metric
        # gaps (refunds domain, tax enrichment, ...) are reported per metric,
        # per domain coverage and as limitations; reconciliation discrepancies
        # degrade every figure and therefore the whole result.
        if not coverage["complete"] or degraded:
            overall_status = STATUS_PARTIAL

    comparison = None
    if compare:
        if comparison_start is not None and comparison_end is not None:
            prev_start = ensure_utc(comparison_start, field="comparison_start")
            prev_end = ensure_utc(comparison_end, field="comparison_end")
            if not (prev_start < prev_end <= start):
                raise ValueError("comparison window must precede the reporting window")
        else:
            prev_start, prev_end = previous_period(start, end)
        previous = retrieve_revenue_evidence(
            organization_id, db, start=prev_start, end=prev_end, now=now,
            label="previous period", compare=False, timezone=timezone,
        )
        comparison = {
            "period": previous["period"],
            "overall_status": previous["overall_status"],
            "items": previous["items"],
            "changes": _changes(previous["items"], items),
        }

    year_ago = None
    if year_over_year:
        year_ago = _year_over_year(organization_id, db, start, end, now,
                                   timezone_name=timezone, coverage_rows=coverage_rows,
                                   stores=stores)

    result = {
        "schema_version": EVIDENCE_SCHEMA_VERSION,
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
        "domain_coverage": {
            "refunds": {"complete": refunds_covered, "note": refunds_note},
            "transactions": {"complete": txns_covered, "note": txns_note},
        },
        "warnings": list(dict.fromkeys(warnings)),
        "limitations": [
            "Persisted order totals are recorded values, not audited net revenue.",
            "Cancelled orders and Shopify test orders are excluded from monetary metrics.",
            "Currencies are reported separately and never summed.",
            "Refunds are deducted exactly once through the persisted refund-adjusted order total.",
        ],
    }
    if comparison is not None:
        result["comparison"] = comparison
    if year_ago is not None:
        result["year_over_year"] = year_ago
    return result


def _year_over_year(organization_id: str, db, start: datetime, end: datetime,
                    now: datetime, *, timezone_name: str,
                    coverage_rows: list, stores: list) -> dict:
    """Equal-calendar-window comparison against the prior year.

    The prior-year window is the same local-calendar dates shifted back one
    year in the merchant timezone (DST-safe: boundaries are wall-clock dates).
    If the certified coverage does not contain that window, the result says so
    explicitly instead of comparing against unverified history.
    """
    tz = _safe_zoneinfo(timezone_name) or timezone.utc

    def shift(dt: datetime) -> datetime:
        local = dt.astimezone(tz)
        try:
            shifted = local.replace(year=local.year - 1)
        except ValueError:  # 29 February in a non-leap prior year
            shifted = local.replace(year=local.year - 1, day=28)
        return shifted.astimezone(timezone.utc)

    yoy_start, yoy_end = shift(start), shift(end)
    yoy_coverage = _coverage(stores, coverage_rows, yoy_start, yoy_end)
    if not yoy_coverage["complete"]:
        return {
            "status": "insufficient_history",
            "period": period(yoy_start, yoy_end, label="same period last year",
                             timezone_label=timezone_name),
            "changes": None,
            "note": ("Certified order coverage does not contain the prior-year "
                     "window, so no year-over-year comparison is asserted."),
        }
    previous = retrieve_revenue_evidence(
        organization_id, db, start=yoy_start, end=yoy_end, now=now,
        label="same period last year", compare=False, timezone=timezone_name,
    )
    current = retrieve_revenue_evidence(
        organization_id, db, start=start, end=end, now=now,
        compare=False, timezone=timezone_name,
    )
    return {
        "status": STATUS_AVAILABLE if previous["overall_status"] == STATUS_AVAILABLE else previous["overall_status"],
        "period": previous["period"],
        "overall_status": previous["overall_status"],
        "items": previous["items"],
        "changes": _changes(previous["items"], current["items"]),
    }


def _changes(previous_items: list[dict], current_items: list[dict]) -> list[dict]:
    """Currency-matched period changes; no cross-currency comparison."""
    def index(items: list[dict], metric: str) -> dict:
        result = {}
        for item in items:
            if item.get("metric") == metric and item.get("status") in (STATUS_AVAILABLE, "verified_zero"):
                key = item.get("currency") or ("__count__" if item.get("unit") == UNIT_COUNT else "__none__")
                if key not in result:
                    result[key] = item
        return result

    changes = []
    for metric in ("recorded_order_value", "gross_sales", "refund_amount",
                   "captured_payment_amount", "recorded_order_count"):
        current = index(current_items, metric)
        previous = index(previous_items, metric)
        for currency in sorted(set(current) & set(previous)):
            change = _percent(current[currency].get("value"), previous[currency].get("value"))
            if change["status"] != STATUS_AVAILABLE:
                continue
            changes.append({
                "metric": metric,
                "currency": None if currency == "__count__" else currency,
                "current": current[currency]["value"],
                "previous": previous[currency]["value"],
                "percent": change["percent"],
                "direction": change["direction"],
                "status": STATUS_AVAILABLE,
                "definition": "Currency-matched change between equal-length periods.",
                "current_evidence_id": current[currency]["id"],
                "previous_evidence_id": previous[currency]["id"],
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
        "schema_version": EVIDENCE_SCHEMA_VERSION,
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
        "domain_coverage": {"refunds": {"complete": False, "note": "No stores in scope."},
                            "transactions": {"complete": False, "note": "No stores in scope."}},
        "warnings": warnings,
        "limitations": ["No verified store data is available, so no metric is asserted."],
        "reason": reason,
        "generated_at": iso(now),
    }
