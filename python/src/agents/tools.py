"""Typed, read-only commerce tool catalog for Rev Intelligence.

Every tool:

* is organization-scoped from the authenticated request context;
* is read-only (no INSERT/UPDATE/DELETE statement is ever issued here);
* returns evidence items built through :mod:`src.intelligence.evidence`;
* reports ``unavailable``/``unsupported`` instead of inventing values;
* never mixes currencies into a single total.

The model may select a tool, but it can never author SQL, supply an
organization or store identifier, or bypass this registry.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Callable

from ..intelligence.evidence import (
    EVIDENCE_SCHEMA_VERSION,
    STATUS_AVAILABLE,
    STATUS_PARTIAL,
    STATUS_UNAVAILABLE,
    STATUS_UNSUPPORTED,
    UNIT_COUNT,
    UNIT_CURRENCY,
    decimal_value,
    ensure_utc,
    evidence_item,
    evidence_context,
    group_by_currency,
    iso,
    money,
    normalize_currency,
    period,
    utc_now,
)
from ..intelligence.query import safe_query
from ..intelligence.revenue_evidence import ACTIVE_STORE_STATUSES, retrieve_revenue_evidence

logger = logging.getLogger("rev.tools")

READ_ONLY = True

_STORE_FILTER = (
    "s.organization_id = :org_id AND s.status IN ("
    + ", ".join("'" + status + "'" for status in ACTIVE_STORE_STATUSES)
    + ")"
)


@dataclass
class ToolResult:
    tool: str
    status: str
    items: list[dict] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    limitations: list[str] = field(default_factory=list)
    data_sources: list[str] = field(default_factory=list)
    row_count: int = 0
    comparison: dict | None = None
    year_over_year: dict | None = None
    store_ids: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "tool": self.tool,
            "status": self.status,
            "items": self.items,
            "warnings": self.warnings,
            "limitations": self.limitations,
            "data_sources": self.data_sources,
            "row_count": self.row_count,
            "comparison": self.comparison,
            "year_over_year": self.year_over_year,
            "store_ids": self.store_ids,
            "read_only": READ_ONLY,
            "schema_version": EVIDENCE_SCHEMA_VERSION,
        }


class ToolAuthorizationError(PermissionError):
    """Raised when a caller requests a tool or scope it may not use."""


def _row(row: Any, key: str, default=None):
    try:
        return row[key]
    except (KeyError, IndexError, TypeError):
        return getattr(row, key, default)


class _ToolSpec:
    def __init__(self, name: str, label: str, description: str, *,
                 requires_period: bool, data_sources: list[str],
                 params: dict | None = None):
        self.name = name
        self.label = label
        self.description = description
        self.requires_period = requires_period
        self.data_sources = data_sources
        self.params = params or {}

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "label": self.label,
            "description": self.description,
            "requires_period": self.requires_period,
            "data_sources": self.data_sources,
            "params": self.params,
            "read_only": READ_ONLY,
            "scope": "authenticated_organization",
        }


_SPECS: dict[str, _ToolSpec] = {}


def _spec(*args, **kwargs):
    spec = _ToolSpec(*args, **kwargs)
    _SPECS[spec.name] = spec
    return spec


_spec("store_health", "Store connection health",
      "Connection status and sync freshness for the organization's stores.",
      requires_period=False, data_sources=["stores"])
_spec("data_coverage", "Order data coverage",
      "Certified order coverage windows and provenance per store.",
      requires_period=False, data_sources=["stores", "intelligence_order_coverage"])
_spec("revenue_observations", "Revenue observations",
      "Refund-aware stored order count and value, separated by currency.",
      requires_period=True, data_sources=["stores", "orders", "intelligence_order_coverage"],
      params={"compare": {"type": "boolean", "required": False,
                          "description": "Include an equal-length previous-period comparison."}})
_spec("order_observations", "Order observations",
      "Order volume, value and customer mix, separated by currency.",
      requires_period=True, data_sources=["stores", "orders"])
_spec("cart_observations", "Checkout cart observations",
      "Deduplicated unrecovered cart count and recorded value per currency.",
      requires_period=True, data_sources=["stores", "abandoned_carts"])
_spec("checkout_observations", "Checkout observations",
      "Recorded checkout events and cart completion observations.",
      requires_period=True, data_sources=["stores", "events", "abandoned_carts"])
_spec("customer_observations", "Customer observations",
      "Ordering customers, first-time share and lifetime value by currency.",
      requires_period=True, data_sources=["stores", "customers", "orders"])
_spec("product_observations", "Product observations",
      "Best-selling products by recorded line-item value per currency.",
      requires_period=True, data_sources=["stores", "order_items", "orders"])
_spec("inventory_observations", "Inventory observations",
      "Products recorded out of stock or below their low-stock threshold.",
      requires_period=False, data_sources=["stores", "products"])
_spec("traffic_observations", "Traffic and event observations",
      "Recorded storefront event counts in the period. Absence does not prove no traffic.",
      requires_period=True, data_sources=["stores", "events"])
_spec("refund_observations", "Refund observations",
      "Refund provenance available for monetary reconciliation.",
      requires_period=True, data_sources=["stores", "orders"])
_spec("findings", "Verified findings",
      "Open, evidence-gated operational findings for the organization.",
      requires_period=False, data_sources=["intelligence_findings"])


def catalog() -> list[dict]:
    return [spec.to_dict() for spec in _SPECS.values()]


# ── Handlers ──────────────────────────────────────────────────────────────────

def _store_health(org_id: str, db, params: dict, window: dict) -> ToolResult:
    rows, error = safe_query(db, f"""
        SELECT id, platform, status, last_synced_at
        FROM stores s WHERE {_STORE_FILTER}
        ORDER BY id
    """, {"org_id": org_id})
    if error:
        return ToolResult("store_health", STATUS_UNAVAILABLE, warnings=["store_query_failed"],
                          data_sources=["stores"])
    items: list[dict] = []
    connected = len(rows)
    synced = [r for r in rows if isinstance(_row(r, "last_synced_at"), datetime)]
    items.append(evidence_item(
        "connected_store_count", label="Connected stores", value=connected,
        window=window, source="stores", status=STATUS_AVAILABLE,
        definition="Stores owned by the organization in an active, connected or syncing state.",
        freshness={"state": "fresh" if rows else "unknown", "as_of": iso(utc_now())},
    ))
    items.append(evidence_item(
        "stores_with_sync", label="Stores with a completed sync", value=len(synced),
        window=window, source="stores", status=STATUS_AVAILABLE,
        definition="Stores in scope with a completed last_synced_at timestamp.",
        limitations=["A completed sync does not by itself certify complete order coverage."],
    ))
    if rows and not synced:
        return ToolResult("store_health", STATUS_PARTIAL, items=items,
                          warnings=["No store has completed an initial sync."],
                          data_sources=["stores"], row_count=len(rows))
    return ToolResult("store_health", STATUS_AVAILABLE, items=items,
                      data_sources=["stores"], row_count=len(rows))


def _data_coverage(org_id: str, db, params: dict, window: dict) -> ToolResult:
    rows, error = safe_query(db, f"""
        SELECT c.store_id, c.coverage_start, c.coverage_end, c.certified_at,
               c.source, c.customer_lifetime_verified
        FROM intelligence_order_coverage c
        JOIN stores s ON s.id = c.store_id
        WHERE {_STORE_FILTER}
    """, {"org_id": org_id})
    if error:
        return ToolResult("data_coverage", STATUS_UNAVAILABLE,
                          warnings=["coverage_query_failed"],
                          data_sources=["intelligence_order_coverage"])
    start = datetime.fromisoformat(window["start"].replace("Z", "+00:00"))
    end = datetime.fromisoformat(window["end"].replace("Z", "+00:00"))
    covered = 0
    for row in rows:
        coverage_start = _row(row, "coverage_start")
        coverage_end = _row(row, "coverage_end")
        if isinstance(coverage_start, datetime) and isinstance(coverage_end, datetime):
            if ensure_utc(coverage_start) <= start and ensure_utc(coverage_end) >= end:
                covered += 1
    items = [evidence_item(
        "certified_store_count", label="Stores certifying this window", value=covered,
        window=window, source="intelligence_order_coverage", status=STATUS_AVAILABLE,
        definition="Stores whose certified coverage window fully contains the reporting window.",
    )]
    status = STATUS_AVAILABLE if covered else STATUS_PARTIAL
    return ToolResult("data_coverage", status, items=items,
                      warnings=[] if covered else ["No store certifies coverage for this window."],
                      data_sources=["intelligence_order_coverage"], row_count=len(rows))


def _revenue(org_id: str, db, params: dict, window: dict) -> ToolResult:
    comparison_start = params.get("comparison_start")
    comparison_end = params.get("comparison_end")
    result = retrieve_revenue_evidence(
        org_id, db,
        start=datetime.fromisoformat(window["start"].replace("Z", "+00:00")),
        end=datetime.fromisoformat(window["end"].replace("Z", "+00:00")),
        now=params.get("_now"),
        compare=bool(params.get("compare")),
        year_over_year=bool(params.get("year_over_year")),
        timezone=params.get("timezone") or window.get("timezone") or "UTC",
        comparison_start=(datetime.fromisoformat(str(comparison_start).replace("Z", "+00:00"))
                          if comparison_start else None),
        comparison_end=(datetime.fromisoformat(str(comparison_end).replace("Z", "+00:00"))
                        if comparison_end else None),
    )
    return ToolResult(
        "revenue_observations",
        result.get("overall_status", STATUS_UNAVAILABLE),
        items=result.get("items", []),
        warnings=result.get("warnings", []),
        limitations=result.get("limitations", []),
        data_sources=["stores", "orders", "intelligence_order_coverage",
                      "order_refunds", "order_transactions",
                      "store_sync_domain_states"],
        row_count=len(result.get("items", [])),
        comparison=result.get("comparison"),
        year_over_year=result.get("year_over_year"),
    )


def _money_rows(rows: list, *, metric_prefix: str, count_key: str, value_key: str,
                label_count: str, label_value: str, window: dict, source: str,
                definition_count: str, definition_value: str,
                coverage: dict | None = None, limitations: list[str] | None = None) -> tuple[list[dict], list[str]]:
    """Convert currency-grouped SQL rows into validated evidence items."""
    items: list[dict] = []
    warnings: list[str] = []
    for row in rows:
        currency = normalize_currency(_row(row, "currency"))
        count = _row(row, count_key)
        value = _row(row, value_key)
        if currency is None:
            warnings.append("Rows without a valid ISO currency were excluded from monetary totals.")
            continue
        try:
            count = int(count)
        except (TypeError, ValueError):
            count = None
        if count is None or decimal_value(value) is None:
            warnings.append("An unvalidated monetary aggregate was excluded.")
            continue
        suffix = f" ({currency})"
        items.append(evidence_item(
            f"{metric_prefix}_count", label=label_count + suffix, value=count,
            window=window, source=source, definition=definition_count,
            coverage=coverage, currency=currency, discriminator=currency,
        ))
        items.append(evidence_item(
            f"{metric_prefix}_value", label=label_value + suffix, value=value,
            unit=UNIT_CURRENCY, currency=currency, window=window, source=source,
            definition=definition_value, coverage=coverage,
            limitations=limitations, discriminator=currency,
        ))
    return items, warnings


def _orders(org_id: str, db, params: dict, window: dict) -> ToolResult:
    rows, error = safe_query(db, f"""
        SELECT o.currency,
               COUNT(*) AS order_count,
               COALESCE(SUM(o.total), 0) AS order_value,
               COUNT(DISTINCT o.customer_id) AS ordering_customers
        FROM orders o JOIN stores s ON s.id = o.store_id
        WHERE {_STORE_FILTER}
          AND o.ordered_at >= :start AND o.ordered_at < :end
          AND (o.recovery_status IS NULL OR o.recovery_status NOT IN
               ('cancelled', 'canceled', 'voided', 'deleted'))
        GROUP BY o.currency ORDER BY o.currency
    """, {"org_id": org_id, "start": window["start"], "end": window["end"]})
    if error:
        return ToolResult("order_observations", STATUS_UNAVAILABLE,
                          warnings=["order_query_failed"], data_sources=["orders"])
    items, warnings = _money_rows(
        rows, metric_prefix="recorded_order", count_key="order_count",
        value_key="order_value", label_count="Recorded order count",
        label_value="Recorded order value", window=window, source="orders",
        definition_count="Non-cancelled orders with ordered_at in [start, end).",
        definition_value="Sum of persisted non-cancelled order totals.",
        limitations=["Recorded order total, not audited net revenue."],
    )
    if not rows:
        items.append(evidence_item(
            "recorded_order_count", label="Recorded order count", value=0,
            window=window, source="orders",
            definition="Non-cancelled orders with ordered_at in [start, end).",
            limitations=["The query succeeded and returned no orders."],
        ))
        items.append(evidence_item(
            "recorded_order_value", label="Recorded order value", value=None,
            unit=UNIT_CURRENCY, window=window, source="orders", status=STATUS_UNSUPPORTED,
            definition="Sum of persisted non-cancelled order totals.",
            limitations=["No currency can be attributed to an empty order set."],
            discriminator="currencyless-zero",
        ))
    for row in rows:
        currency = normalize_currency(_row(row, "currency"))
        customers = _row(row, "ordering_customers")
        if currency and isinstance(customers, int):
            items.append(evidence_item(
                "ordering_customer_count", label=f"Ordering customers ({currency})",
                value=customers, window=window, source="orders",
                definition="Distinct customers with a non-cancelled order in the window.",
                discriminator=currency,
            ))
    return ToolResult("order_observations", STATUS_AVAILABLE if not error else STATUS_UNAVAILABLE,
                      items=items, warnings=warnings,
                      limitations=["Order totals are recorded values, not settled revenue."],
                      data_sources=["stores", "orders"], row_count=len(rows))


def _carts(org_id: str, db, params: dict, window: dict) -> ToolResult:
    rows, error = safe_query(db, f"""
        WITH ranked AS (
            SELECT c.store_id, c.currency, c.cart_value,
                   ROW_NUMBER() OVER (
                       PARTITION BY c.store_id,
                         COALESCE(NULLIF(c.external_cart_id, ''), c.id::text)
                       ORDER BY c.updated_at DESC NULLS LAST,
                                c.created_at DESC NULLS LAST, c.id DESC
                   ) AS rn
            FROM abandoned_carts c JOIN stores s ON s.id = c.store_id
            WHERE {_STORE_FILTER}
              AND c.abandoned_at >= :start AND c.abandoned_at < :end
              AND c.status = 'abandoned' AND c.recovered_at IS NULL
        )
        SELECT currency, COUNT(*) AS cart_count, COALESCE(SUM(cart_value), 0) AS cart_value
        FROM ranked WHERE rn = 1
        GROUP BY currency ORDER BY currency
    """, {"org_id": org_id, "start": window["start"], "end": window["end"]})
    if error:
        return ToolResult("cart_observations", STATUS_UNAVAILABLE,
                          warnings=["cart_query_failed"], data_sources=["abandoned_carts"])
    items, warnings = _money_rows(
        rows, metric_prefix="unrecovered_cart", count_key="cart_count",
        value_key="cart_value", label_count="Unrecovered abandoned carts",
        label_value="Recorded abandoned-cart value", window=window,
        source="abandoned_carts",
        definition_count="Deduplicated unrecovered carts abandoned in [start, end).",
        definition_value="Deduplicated recorded cart value; not recoverable revenue.",
        limitations=["Recorded cart value is not guaranteed recoverable revenue."],
    )
    if not rows:
        items.append(evidence_item(
            "unrecovered_cart_count", label="Unrecovered abandoned carts", value=0,
            window=window, source="abandoned_carts",
            definition="Deduplicated unrecovered carts abandoned in [start, end).",
            limitations=["No unrecovered carts are recorded; tracking completeness is unverified."],
        ))
    return ToolResult("cart_observations", STATUS_AVAILABLE, items=items, warnings=warnings,
                      limitations=["Cart value is recorded merchant data, never verified loss."],
                      data_sources=["stores", "abandoned_carts"], row_count=len(rows))


def _checkout(org_id: str, db, params: dict, window: dict) -> ToolResult:
    event_rows, event_error = safe_query(db, f"""
        SELECT e.event_type, COUNT(*) AS event_count
        FROM events e JOIN stores s ON s.id = e.store_id
        WHERE {_STORE_FILTER}
          AND e.created_at >= :start AND e.created_at < :end
          AND e.event_type IN ('checkout_started', 'checkout_completed',
                               'checkout_abandoned', 'checkout_step_viewed',
                               'payment_info_submitted')
        GROUP BY e.event_type ORDER BY e.event_type
    """, {"org_id": org_id, "start": window["start"], "end": window["end"]})
    completed, completed_error = safe_query(db, f"""
        SELECT COUNT(*) AS completed_count
        FROM abandoned_carts c JOIN stores s ON s.id = c.store_id
        WHERE {_STORE_FILTER}
          AND c.recovered_at >= :start AND c.recovered_at < :end
    """, {"org_id": org_id, "start": window["start"], "end": window["end"]})
    items: list[dict] = []
    warnings: list[str] = []
    limitations: list[str] = []
    status = STATUS_AVAILABLE

    if event_error:
        status = STATUS_PARTIAL
        warnings.append("Checkout event query failed; no checkout-stage claim is possible.")
        items.append(evidence_item(
            "checkout_event_count", label="Recorded checkout events", value=None,
            window=window, source="events", status=STATUS_UNAVAILABLE,
            definition="Storefront checkout events received from the tracked pixel.",
            limitations=["The event query failed."],
        ))
    else:
        for row in event_rows:
            event_type = str(_row(row, "event_type") or "")
            count = _row(row, "event_count")
            if not event_type or not isinstance(count, int):
                continue
            items.append(evidence_item(
                f"event_{event_type}", label=f"Recorded {event_type.replace('_', ' ')} events",
                value=count, window=window, source="events", discriminator=event_type,
                definition="Events of this type received from the tracked storefront pixel.",
                limitations=["Pixel coverage is not certified; absence is not proof of zero traffic."],
            ))
        if not event_rows:
            status = STATUS_PARTIAL
            limitations.append("No checkout events were recorded in this window. "
                               "This does not prove that no checkouts occurred.")
    if completed_error:
        status = STATUS_PARTIAL
        warnings.append("Checkout completion query failed.")
    else:
        count = _row(completed[0], "completed_count") if completed else 0
        if isinstance(count, int):
            items.append(evidence_item(
                "recorded_checkout_completion_count", label="Recorded checkout completions",
                value=count, window=window, source="abandoned_carts",
                definition="Carts with a recovered_at timestamp in the window.",
                limitations=["Only carts previously tracked as abandoned are counted."],
            ))
    return ToolResult("checkout_observations", status, items=items, warnings=warnings,
                      limitations=limitations,
                      data_sources=["stores", "events", "abandoned_carts"],
                      row_count=len(event_rows))


def _customers(org_id: str, db, params: dict, window: dict) -> ToolResult:
    rows, error = safe_query(db, f"""
        SELECT o.currency,
               COUNT(DISTINCT o.customer_id) AS ordering_customers,
               COUNT(DISTINCT CASE WHEN NOT EXISTS (
                   SELECT 1 FROM orders p
                   WHERE p.store_id = o.store_id AND p.customer_id = o.customer_id
                     AND p.ordered_at < :start
                     AND (p.recovery_status IS NULL OR p.recovery_status NOT IN
                          ('cancelled', 'canceled', 'voided', 'deleted'))
               ) THEN o.customer_id END) AS first_time_customers
        FROM orders o JOIN stores s ON s.id = o.store_id
        WHERE {_STORE_FILTER}
          AND o.ordered_at >= :start AND o.ordered_at < :end
          AND (o.recovery_status IS NULL OR o.recovery_status NOT IN
               ('cancelled', 'canceled', 'voided', 'deleted'))
        GROUP BY o.currency ORDER BY o.currency
    """, {"org_id": org_id, "start": window["start"], "end": window["end"]})
    ltv_rows, ltv_error = safe_query(db, f"""
        SELECT c.ltv, COUNT(*) AS customer_count
        FROM customers c JOIN stores s ON s.id = c.store_id
        WHERE {_STORE_FILTER} AND c.ltv IS NOT NULL
        GROUP BY c.ltv
    """, {"org_id": org_id})
    items: list[dict] = []
    warnings: list[str] = []
    if error:
        return ToolResult("customer_observations", STATUS_UNAVAILABLE,
                          warnings=["customer_query_failed"],
                          data_sources=["stores", "customers", "orders"])
    for row in rows:
        currency = normalize_currency(_row(row, "currency"))
        customers = _row(row, "ordering_customers")
        first_time = _row(row, "first_time_customers")
        if currency is None:
            warnings.append("Customer rows without a currency code were excluded.")
            continue
        if isinstance(customers, int):
            items.append(evidence_item(
                "ordering_customer_count", label=f"Ordering customers ({currency})",
                value=customers, window=window, source="orders", discriminator=currency,
                definition="Distinct customers with a non-cancelled order in the window.",
            ))
        if isinstance(first_time, int):
            items.append(evidence_item(
                "first_time_customer_count", label=f"First-time ordering customers ({currency})",
                value=first_time, window=window, source="orders", discriminator=currency,
                definition="Ordering customers with no earlier non-cancelled order in the store.",
            ))
    if not rows:
        items.append(evidence_item(
            "ordering_customer_count", label="Ordering customers", value=0,
            window=window, source="orders",
            definition="Distinct customers with a non-cancelled order in the window.",
            limitations=["No orders are recorded in this window."],
        ))
    if ltv_error:
        items.append(evidence_item(
            "customer_lifetime_value", label="Customer lifetime value", value=None,
            unit=UNIT_CURRENCY, window=window, source="customers", status=STATUS_UNAVAILABLE,
            definition="Stored customer lifetime value per customer.",
            limitations=["The customer lifetime value query failed."],
        ))
    else:
        currencies_unverified = True
        items.append(evidence_item(
            "customer_lifetime_value", label="Customer lifetime value", value=None,
            unit=UNIT_CURRENCY, window=window, source="customers", status=STATUS_UNSUPPORTED,
            definition=("Stored per-customer lifetime value in the store's own currency. "
                        "It cannot be totalled here because the customer currency is not "
                        "stored with the lifetime value."),
            coverage={"mixed_currency_totals": "forbidden"},
            limitations=["LTV totals are not reported without a per-customer currency."],
        ))
        if currencies_unverified and ltv_rows:
            warnings.append("Customer lifetime value is stored without a currency and is "
                            "therefore never totalled or compared across currencies.")
    return ToolResult("customer_observations", STATUS_PARTIAL if warnings else STATUS_AVAILABLE,
                      items=items, warnings=warnings,
                      limitations=["Customer lifetime value is a stored merchant value, not a forecast."],
                      data_sources=["stores", "customers", "orders"], row_count=len(rows))


def _products(org_id: str, db, params: dict, window: dict) -> ToolResult:
    rows, error = safe_query(db, f"""
        SELECT oi.product_name, o.currency,
               SUM(oi.quantity) AS units,
               SUM(oi.line_total) AS line_value
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        JOIN stores s ON s.id = oi.store_id
        WHERE {_STORE_FILTER}
          AND oi.ordered_at >= :start AND oi.ordered_at < :end
          AND (o.recovery_status IS NULL OR o.recovery_status NOT IN
               ('cancelled', 'canceled', 'voided', 'deleted'))
        GROUP BY oi.product_name, o.currency
        ORDER BY line_value DESC
        LIMIT 5
    """, {"org_id": org_id, "start": window["start"], "end": window["end"]})
    if error:
        return ToolResult("product_observations", STATUS_UNAVAILABLE,
                          warnings=["product_query_failed"], data_sources=["order_items"])
    items: list[dict] = []
    warnings: list[str] = []
    for row in rows:
        currency = normalize_currency(_row(row, "currency"))
        name = str(_row(row, "product_name") or "").strip()[:120]
        units = _row(row, "units")
        value = _row(row, "line_value")
        if not name or currency is None or not isinstance(units, int):
            warnings.append("An unvalidated product aggregate was excluded.")
            continue
        if decimal_value(value) is None:
            continue
        items.append(evidence_item(
            "product_units_sold", label=f"Units sold: {name} ({currency})", value=units,
            window=window, source="order_items", discriminator=f"{name}:{currency}",
            definition="Units recorded on non-cancelled order line items in the window.",
        ))
        items.append(evidence_item(
            "product_recorded_value", label=f"Recorded value: {name} ({currency})",
            value=value, unit=UNIT_CURRENCY, currency=currency, window=window,
            source="order_items", discriminator=f"{name}:{currency}",
            definition="Recorded line-item value, not profit.",
            limitations=["Line-item value excludes refunds recorded after the order snapshot."],
        ))
    return ToolResult("product_observations", STATUS_AVAILABLE if items else STATUS_PARTIAL,
                      items=items, warnings=warnings,
                      limitations=["Product value is recorded line-item value, not margin."],
                      data_sources=["stores", "order_items", "orders"], row_count=len(rows))


def _inventory(org_id: str, db, params: dict, window: dict) -> ToolResult:
    rows, error = safe_query(db, f"""
        SELECT
          COUNT(*) FILTER (WHERE p.stock_status IN ('outofstock', 'out_of_stock')) AS out_of_stock,
          COUNT(*) FILTER (WHERE p.manage_stock = true AND p.stock_quantity IS NOT NULL
                            AND p.low_stock_amount IS NOT NULL
                            AND p.stock_quantity <= p.low_stock_amount
                            AND p.stock_quantity > 0) AS low_stock,
          COUNT(*) AS tracked_products
        FROM products p JOIN stores s ON s.id = p.store_id
        WHERE {_STORE_FILTER}
    """, {"org_id": org_id})
    if error or not rows:
        return ToolResult("inventory_observations", STATUS_UNAVAILABLE,
                          warnings=["inventory_query_failed"], data_sources=["products"])
    row = rows[0]
    out_of_stock = _row(row, "out_of_stock")
    low_stock = _row(row, "low_stock")
    tracked = _row(row, "tracked_products")
    items = [
        evidence_item("products_out_of_stock", label="Products recorded out of stock",
                      value=out_of_stock if isinstance(out_of_stock, int) else None,
                      window=window, source="products",
                      definition="Products whose stored stock status is out of stock.",
                      status=STATUS_AVAILABLE if isinstance(out_of_stock, int) else STATUS_UNAVAILABLE,
                      limitations=["Inventory sync completeness is not certified."]),
        evidence_item("products_low_stock", label="Products at or below low-stock threshold",
                      value=low_stock if isinstance(low_stock, int) else None,
                      window=window, source="products",
                      definition="Products with managed stock at or below their low-stock amount.",
                      status=STATUS_AVAILABLE if isinstance(low_stock, int) else STATUS_UNAVAILABLE,
                      limitations=["Only products with a configured low-stock amount are counted."]),
    ]
    return ToolResult("inventory_observations", STATUS_PARTIAL if tracked == 0 else STATUS_AVAILABLE,
                      items=items,
                      warnings=[] if tracked else ["No products are recorded for this organization."],
                      data_sources=["stores", "products"], row_count=tracked or 0)


def _traffic(org_id: str, db, params: dict, window: dict) -> ToolResult:
    rows, error = safe_query(db, f"""
        SELECT e.event_type, COUNT(*) AS event_count
        FROM events e JOIN stores s ON s.id = e.store_id
        WHERE {_STORE_FILTER}
          AND e.created_at >= :start AND e.created_at < :end
        GROUP BY e.event_type ORDER BY event_count DESC LIMIT 20
    """, {"org_id": org_id, "start": window["start"], "end": window["end"]})
    if error:
        return ToolResult("traffic_observations", STATUS_UNAVAILABLE,
                          warnings=["event_query_failed"], data_sources=["events"])
    items = []
    for row in rows:
        event_type = str(_row(row, "event_type") or "")
        count = _row(row, "event_count")
        if not event_type or not isinstance(count, int):
            continue
        items.append(evidence_item(
            f"event_{event_type}" if len(event_type) < 40 else "event_other",
            label=f"Recorded {event_type} events", value=count, window=window,
            source="events", discriminator=event_type,
            definition="Events received from tracked storefront sessions.",
        ))
    if not items:
        return ToolResult("traffic_observations", STATUS_PARTIAL, items=[],
                          warnings=["No storefront events are recorded in this window; "
                                    "pixel coverage is not certified."],
                          limitations=["Absence of events is not evidence of no traffic."],
                          data_sources=["events"])
    return ToolResult("traffic_observations", STATUS_PARTIAL, items=items,
                      limitations=["Pixel coverage is not certified; event counts are a floor, not a total."],
                      data_sources=["stores", "events"], row_count=len(rows))


def _refunds(org_id: str, db, params: dict, window: dict) -> ToolResult:
    """Itemised refund-ledger observations (Task 198).

    Delegates to the single revenue-evidence pipeline so tenant scope,
    window, coverage and refund semantics are identical to the revenue
    figures: refund money is never computed a second way. The persisted
    ``order_refunds`` ledger is attributed to the refund date; the
    per-domain sync ledger decides whether the figure is certified.
    """
    result = retrieve_revenue_evidence(
        org_id, db,
        start=datetime.fromisoformat(window["start"].replace("Z", "+00:00")),
        end=datetime.fromisoformat(window["end"].replace("Z", "+00:00")),
        now=params.get("_now"),
        compare=False,
        timezone=params.get("timezone") or window.get("timezone") or "UTC",
    )
    warnings = list(result.get("warnings", []))
    if result.get("overall_status") == "unavailable":
        return ToolResult("refund_observations", STATUS_UNAVAILABLE,
                          warnings=warnings or ["No store scope available."],
                          data_sources=["stores", "orders", "order_refunds"])
    refund_items = [item for item in result.get("items", [])
                    if item["metric"] in ("refund_amount", "refund_amount_window_orders")]
    if not refund_items:
        return ToolResult("refund_observations", STATUS_UNAVAILABLE,
                          warnings=warnings or ["No refund evidence could be retrieved."],
                          data_sources=["stores", "orders", "order_refunds"])
    statuses = {item.get("status") for item in refund_items}
    if statuses <= {STATUS_AVAILABLE, "verified_zero"}:
        status = STATUS_AVAILABLE
    elif statuses == {"not_synchronized"}:
        status = STATUS_UNAVAILABLE
        warnings.append("The refund ledger has not been synchronized for every "
                        "store; refund money for this window cannot be reported.")
    elif statuses <= {STATUS_UNAVAILABLE, STATUS_UNSUPPORTED, "not_synchronized"}:
        status = STATUS_UNAVAILABLE
    else:
        status = STATUS_PARTIAL
    return ToolResult("refund_observations", status, items=refund_items,
                      warnings=warnings,
                      data_sources=["stores", "orders", "order_refunds"],
                      row_count=len(refund_items))


def _findings(org_id: str, db, params: dict, window: dict) -> ToolResult:
    rows, error = safe_query(db, f"""
        SELECT f.id, f.type, f.severity, f.title, f.description, f.evidence, f.detected_at
        FROM intelligence_findings f
        JOIN stores s ON s.id = f.store_id
        WHERE {_STORE_FILTER} AND f.status = 'open'
        ORDER BY f.detected_at DESC LIMIT 10
    """, {"org_id": org_id})
    if error:
        return ToolResult("findings", STATUS_UNAVAILABLE, warnings=["findings_query_failed"],
                          data_sources=["intelligence_findings"])
    items = [evidence_item(
        "open_finding_count", label="Open verified findings", value=len(rows),
        window=window, source="intelligence_findings",
        definition="Evidence-gated findings currently open for the organization.",
        status=STATUS_AVAILABLE,
        limitations=["No findings does not prove there is no operational issue."],
    )]
    return ToolResult("findings", STATUS_AVAILABLE if rows else STATUS_PARTIAL,
                      items=items, data_sources=["intelligence_findings"], row_count=len(rows))


_HANDLERS: dict[str, Callable[[str, Any, dict, dict], ToolResult]] = {
    "store_health": _store_health,
    "data_coverage": _data_coverage,
    "revenue_observations": _revenue,
    "order_observations": _orders,
    "cart_observations": _carts,
    "checkout_observations": _checkout,
    "customer_observations": _customers,
    "product_observations": _products,
    "inventory_observations": _inventory,
    "traffic_observations": _traffic,
    "refund_observations": _refunds,
    "findings": _findings,
}


def run_tool(tool_name: str, organization_id: str, db: Any, params: dict | None = None,
             *, now: datetime | None = None) -> ToolResult:
    """Execute one authorised read-only tool.

    Unknown tools and missing organization context are rejected.  A handler
    failure becomes ``unavailable`` evidence; it never becomes a zero.
    """
    if tool_name not in _HANDLERS:
        raise ToolAuthorizationError(f"Unknown or unauthorised tool: {tool_name}")
    if not organization_id or not isinstance(organization_id, str):
        raise ToolAuthorizationError("Authenticated organization context is required")
    params = dict(params or {})
    allowed = {"start", "end", "segment", "compare", "timezone",
               "comparison_start", "comparison_end", "year_over_year"}
    if set(params) - allowed:
        raise ToolAuthorizationError("Unsupported tool parameter")
    now = ensure_utc(now or utc_now(), field="now")
    spec = _SPECS[tool_name]
    if spec.requires_period:
        start = params.get("start")
        end = params.get("end")
        if not start or not end:
            raise ToolAuthorizationError("This tool requires an explicit period")
        window = period(datetime.fromisoformat(str(start).replace("Z", "+00:00")),
                        datetime.fromisoformat(str(end).replace("Z", "+00:00")),
                        timezone_label=params.get("timezone") or "UTC")
    else:
        # Undated tools still need an explicit, non-monetary evidence window.
        snapshot = now.replace(microsecond=0)
        window = period(snapshot - timedelta(seconds=1), snapshot)
    scope_rows, scope_error = safe_query(db, f"""
        SELECT s.id FROM stores s WHERE {_STORE_FILTER} ORDER BY s.id
    """, {"org_id": organization_id})
    if scope_error:
        return ToolResult(tool_name, "storage_failure", warnings=["authorized_store_scope_query_failed"], data_sources=["stores"])
    store_ids = [str(_row(row, "id")) for row in scope_rows if _row(row, "id")]
    if not store_ids:
        return ToolResult(tool_name, STATUS_UNAVAILABLE, warnings=["no_authorized_store"], data_sources=["stores"])
    try:
        with evidence_context(organization_id, store_ids):
            result = _HANDLERS[tool_name](organization_id, db, {**params, "_now": now}, window)
        result.store_ids = store_ids
    except Exception as exc:  # defensive: a tool must never abort the investigation
        logger.warning("rev_tool_failed tool=%s error_type=%s", tool_name, type(exc).__name__)
        result = ToolResult(tool_name, STATUS_UNAVAILABLE,
                            warnings=["tool_execution_failed"],
                            data_sources=spec.data_sources)
    if not isinstance(result, ToolResult):
        result = ToolResult(tool_name, STATUS_UNAVAILABLE,
                            warnings=["tool_contract_violation"],
                            data_sources=spec.data_sources)
    if result.status not in (STATUS_AVAILABLE, STATUS_PARTIAL, STATUS_UNAVAILABLE, STATUS_UNSUPPORTED):
        result.status = STATUS_UNAVAILABLE
    return result
