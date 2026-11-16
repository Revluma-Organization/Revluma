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
    previous_period,
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
    # Bounded, privacy-safe operational diagnostics used by the Task 207
    # investigation-outcome composer. This is not merchant narrative and never
    # contains credentials or raw infrastructure exceptions.
    diagnostics: dict = field(default_factory=dict)

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
            "diagnostics": self.diagnostics,
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
_spec("integration_health", "Integration evidence and health",
      "Explicit integration states: connection, per-resource authorization and "
      "synchronization evidence, webhook health and deterministic overall health.",
      requires_period=False, data_sources=["stores", "store_sync_domain_states",
                                          "webhook_registrations",
                                          "webhook_deliveries",
                                          "intelligence_order_coverage"])
_spec("data_coverage", "Order data coverage",
      "Certified order coverage windows and provenance per store.",
      requires_period=False, data_sources=["stores", "intelligence_order_coverage"])
_spec("revenue_observations", "Revenue observations",
      "Refund-aware stored order count and value, separated by currency.",
      requires_period=True, data_sources=["stores", "orders", "intelligence_order_coverage"],
      params={"compare": {"type": "boolean", "required": False,
                          "description": "Include an equal-length previous-period comparison."}})
_spec("order_observations", "Order observations",
      "Order lifecycle, historical products/variants, individual orders and Task 198 financial semantics.",
      requires_period=True, data_sources=["stores", "orders", "order_items", "order_refunds", "order_fulfillments"],
      params={"order_reference": {"type": "string", "required": False},
              "latest": {"type": "boolean", "required": False},
              "financial_status": {"type": "string", "required": False},
              "fulfillment_status": {"type": "string", "required": False},
              "cancelled": {"type": "boolean", "required": False},
              "compare": {"type": "boolean", "required": False}})
_spec("cart_observations", "Observed abandoned checkout evidence",
      "Explicitly observed uncompleted abandoned checkouts, historical products and currency-separated recorded values—not lost or recoverable revenue.",
      requires_period=True, data_sources=["stores", "abandoned_carts", "abandoned_cart_items", "orders", "store_sync_domain_states"],
      params={"abandoned_only": {"type": "boolean", "required": False},
              "include_records": {"type": "boolean", "required": False},
              "compare": {"type": "boolean", "required": False}})
_spec("checkout_observations", "Canonical Shopify checkout evidence",
      "Observed checkout lifecycle, history, exact order links and coverage.",
      requires_period=True, data_sources=["stores", "abandoned_carts", "abandoned_cart_items", "orders", "store_sync_domain_states"],
      params={"checkout_reference": {"type": "string", "required": False},
              "latest": {"type": "boolean", "required": False},
              "abandoned_only": {"type": "boolean", "required": False},
              "include_records": {"type": "boolean", "required": False},
              "compare": {"type": "boolean", "required": False},
              "year_over_year": {"type": "boolean", "required": False}})
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


_INTEGRATION_STATUS_BY_STATE = {
    "healthy": STATUS_AVAILABLE,
    "disconnected": STATUS_UNAVAILABLE,
    "unauthorized": "unauthorized",
    "partially_operational": STATUS_PARTIAL,
    "degraded": STATUS_PARTIAL,
    "verification_pending": STATUS_PARTIAL,
    "attention_required": STATUS_PARTIAL,
    "unknown": STATUS_UNAVAILABLE,
}

# Task 213 — tool availability follows the canonical rev-integration-state-v1
# overall status (the authoritative product state), not the Task 201 health
# rollup. connected => the capabilities the integration advertises may be
# asserted; limited states => answer within covered capability and say what
# is limited; no data state => say the data is unavailable, never manufacture.
_CANONICAL_STATUS_BY_STATE = {
    "connected": STATUS_AVAILABLE,
    "synchronizing": STATUS_PARTIAL,
    "limited_access": STATUS_PARTIAL,
    "needs_attention": STATUS_PARTIAL,
    "sync_failed": STATUS_PARTIAL,
    "sync_partial": STATUS_PARTIAL,
    "disconnected": STATUS_UNAVAILABLE,
    "authorization_required": "unauthorized",
    "authorization_expired": "unauthorized",
    "authorization_revoked": "unauthorized",
    "unsupported": STATUS_UNAVAILABLE,
    "unknown": STATUS_UNAVAILABLE,
}


def _integration(org_id: str, db, params: dict, window: dict) -> ToolResult:
    """Task 201 — canonical integration evidence (connection, authorization,
    per-resource sync, webhooks, overall health) from persisted state only.

    A stored connection record, a granted scope, or an enqueued job is never
    reported as a working capability; every state is derived from evidence.
    """
    from ..intelligence.integration_evidence import retrieve_integration_evidence
    evidence = retrieve_integration_evidence(org_id, db, now=params.get("_now"))
    overall = evidence.get("overall_status", "unknown")
    # The canonical state (rev-integration-state-v1) governs the tool's
    # availability: a synchronizing/limited/partially-failed integration is
    # PARTIAL (answer within the covered capability, disclose the limit);
    # disconnected/revoked/unknown integrations are UNAVAILABLE (never
    # manufacture data).
    canonical = [st.get("integration_state") for st in evidence.get("stores", [])
                 if st.get("integration_state")]
    if canonical:
        # Multi-store orgs: the worst canonical state governs (a single
        # unavailable store prevents claiming the org's data is current).
        from ..intelligence.integration_state import STATE_SEVERITY, worst_state
        worst = worst_state([c.get("overall_status") for c in canonical])
        status = _CANONICAL_STATUS_BY_STATE.get(worst, STATUS_UNAVAILABLE)
    else:
        status = _INTEGRATION_STATUS_BY_STATE.get(overall, STATUS_UNAVAILABLE)
    return ToolResult(
        "integration_health",
        status,
        items=evidence.get("items", []),
        warnings=evidence.get("warnings", []),
        limitations=evidence.get("limitations", []),
        data_sources=["stores", "store_sync_domain_states", "webhook_registrations",
                      "webhook_deliveries", "intelligence_order_coverage"],
        row_count=len(evidence.get("items", [])),
        diagnostics={"integration": {
            "overall_status": evidence.get("overall_status"),
            "components": evidence.get("components"),
            "canonical_states": [
                {
                    "store_id": st.get("store_id"),
                    "shop_domain": st.get("shop_domain"),
                    "overall_status": c.get("overall_status"),
                    "status_reason": c.get("status_reason"),
                    "authorization": c.get("authorization"),
                    "synchronization": c.get("synchronization"),
                    "limited_capabilities": c.get("limited_capabilities"),
                    "merchant_action_required": c.get("merchant_action_required"),
                    "recommended_next_step": c.get("recommended_next_step"),
                } for st, c in zip(evidence.get("stores", []), canonical)
            ],
            "stores": evidence.get("stores", []),
        }},
    )


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
    from ..intelligence.order_evidence import retrieve_order_evidence
    comparison_start = params.get("comparison_start")
    comparison_end = params.get("comparison_end")
    result = retrieve_order_evidence(
        org_id, db,
        start=datetime.fromisoformat(window["start"].replace("Z", "+00:00")),
        end=datetime.fromisoformat(window["end"].replace("Z", "+00:00")),
        now=params.get("_now"), order_reference=params.get("order_reference"),
        latest=bool(params.get("latest")), financial_status=params.get("financial_status"),
        fulfillment_status=params.get("fulfillment_status"), cancelled=bool(params.get("cancelled")),
        compare=bool(params.get("compare")), year_over_year=bool(params.get("year_over_year")),
        timezone=params.get("timezone") or window.get("timezone") or "UTC",
        comparison_start=(datetime.fromisoformat(str(comparison_start).replace("Z", "+00:00"))
                          if comparison_start else None),
        comparison_end=(datetime.fromisoformat(str(comparison_end).replace("Z", "+00:00"))
                        if comparison_end else None),
    )
    comparison_items = [item for item in result.get("comparison_items", []) if item.get("domain") == "orders"]
    return ToolResult(
        "order_observations", result.get("overall_status", STATUS_UNAVAILABLE),
        items=result.get("items", []) + comparison_items, warnings=result.get("warnings", []),
        limitations=result.get("limitations", []),
        data_sources=["stores", "orders", "order_items", "order_refunds", "order_fulfillments", "store_sync_domain_states"],
        row_count=len(result.get("items", [])) + len(comparison_items), comparison=result.get("comparison"),
        year_over_year=result.get("year_over_year"),
    )

def _checkout_evidence(org_id: str, db, params: dict, window: dict, *, abandoned_only: bool) -> dict:
    from ..intelligence.checkout_evidence import retrieve_checkout_evidence
    comparison_start = params.get("comparison_start")
    comparison_end = params.get("comparison_end")
    return retrieve_checkout_evidence(
        org_id, db,
        start=datetime.fromisoformat(window["start"].replace("Z", "+00:00")),
        end=datetime.fromisoformat(window["end"].replace("Z", "+00:00")),
        now=params.get("_now"), timezone=params.get("timezone") or window.get("timezone") or "UTC",
        abandoned_only=abandoned_only or bool(params.get("abandoned_only")),
        checkout_reference=params.get("checkout_reference"), latest=bool(params.get("latest")),
        include_records=bool(params.get("include_records")), compare=bool(params.get("compare")),
        year_over_year=bool(params.get("year_over_year")),
        comparison_start=(datetime.fromisoformat(str(comparison_start).replace("Z", "+00:00")) if comparison_start else None),
        comparison_end=(datetime.fromisoformat(str(comparison_end).replace("Z", "+00:00")) if comparison_end else None),
    )


def _checkout_tool_result(tool_name: str, result: dict) -> ToolResult:
    comparison_items = result.get("comparison_items", [])
    return ToolResult(tool_name, result.get("overall_status", STATUS_UNAVAILABLE),
        items=result.get("items", []) + comparison_items,
        warnings=result.get("warnings", []), limitations=result.get("limitations", []),
        data_sources=["stores", "abandoned_carts", "abandoned_cart_items", "orders",
                      "order_checkout_reconciliation_cases", "store_sync_domain_states"],
        row_count=len(result.get("items", [])) + len(comparison_items),
        comparison=({"period": item.get("period") for item in comparison_items[:1]} if comparison_items else None),
        year_over_year=result.get("year_over_year"))


def _carts(org_id: str, db, params: dict, window: dict) -> ToolResult:
    result = _checkout_evidence(org_id, db, params, window, abandoned_only=True)
    return _checkout_tool_result("cart_observations", result)


def _checkout(org_id: str, db, params: dict, window: dict) -> ToolResult:
    result = _checkout_evidence(org_id, db, params, window, abandoned_only=False)
    return _checkout_tool_result("checkout_observations", result)

def _customers(org_id: str, db, params: dict, window: dict) -> ToolResult:
    from ..intelligence.retention_evidence import retrieve_retention_evidence, retention_comparison_changes
    start = datetime.fromisoformat(window["start"].replace("Z", "+00:00"))
    end = datetime.fromisoformat(window["end"].replace("Z", "+00:00"))
    timezone_name = params.get("timezone") or window.get("timezone") or "UTC"
    result = retrieve_retention_evidence(
        org_id, db, start=start, end=end, now=params.get("_now"), timezone=timezone_name)
    items = list(result.get("items", []))
    warnings = list(result.get("warnings", []))
    comparison = None
    if params.get("compare"):
        comparison_start = params.get("comparison_start")
        comparison_end = params.get("comparison_end")
        if comparison_start is None:
            comparison_start, comparison_end = previous_period(start, end)
        else:
            comparison_start = datetime.fromisoformat(str(comparison_start).replace("Z", "+00:00"))
            comparison_end = datetime.fromisoformat(str(comparison_end).replace("Z", "+00:00"))
        previous = retrieve_retention_evidence(
            org_id, db, start=comparison_start, end=comparison_end,
            now=params.get("_now"), timezone=timezone_name)
        comparison_items = [{**entry, "period": {**entry.get("period", {}), "label": "previous period"}}
                            for entry in previous.get("items", [])]
        items.extend(comparison_items)
        warnings.extend(f"comparison_{warning}" for warning in previous.get("warnings", []))
        comparison = {"items": comparison_items,
                      "period": items[0].get("period") if items else None,
                      "changes": retention_comparison_changes(result.get("items", []), comparison_items),
                      "overall_status": previous.get("overall_status")}
    return ToolResult("customer_observations", result.get("overall_status", STATUS_UNAVAILABLE),
        items=items, warnings=warnings, limitations=result.get("limitations", []),
        data_sources=["stores", "orders", "intelligence_order_coverage"],
        row_count=result.get("coverage", {}).get("certified_store_count", 0), comparison=comparison)

def _products(org_id: str, db: Any, params: dict, window: dict) -> ToolResult:
    from src.intelligence.product_evidence import retrieve_product_evidence
    comparison_start = params.get("comparison_start")
    comparison_end = params.get("comparison_end")
    result = retrieve_product_evidence(org_id, db, start=datetime.fromisoformat(window["start"].replace("Z", "+00:00")),
        end=datetime.fromisoformat(window["end"].replace("Z", "+00:00")), now=params.get("_now"),
        timezone_name=params.get("timezone") or window.get("timezone") or "UTC",
        product_reference=params.get("product_reference"), latest=bool(params.get("latest")),
        compare=bool(params.get("compare")),
        comparison_start=(datetime.fromisoformat(str(comparison_start).replace("Z", "+00:00"))
                          if comparison_start else None),
        comparison_end=(datetime.fromisoformat(str(comparison_end).replace("Z", "+00:00"))
                        if comparison_end else None))
    # Task 206: the comparison window's line items are part of the evidence so
    # a contribution answer cites both sides, exactly like the revenue tool.
    comparison = result.get("comparison")
    comparison_items = ([item for item in comparison.get("items", [])] if comparison else [])
    return ToolResult("product_observations", result["overall_status"],
        items=result["items"] + comparison_items,
        warnings=result["warnings"], limitations=result["limitations"],
        data_sources=["products", "product_variants", "inventory_items", "inventory_levels", "locations", "order_items", "intelligence_findings"],
        row_count=len(result["items"]) + len(comparison_items), comparison=comparison)


def _inventory(org_id: str, db: Any, params: dict, window: dict) -> ToolResult:
    result = _products(org_id, db, params, window)
    result.name = "inventory_observations"
    return result


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


def _findings(org_id: str, db: Any, params: dict, window: dict) -> ToolResult:
    from src.intelligence.finding_evidence import retrieve_finding_evidence
    result = retrieve_finding_evidence(org_id, db, now=params.get("_now"),
        timezone_name=params.get("timezone") or window.get("timezone") or "UTC",
        finding_reference=params.get("finding_reference"), latest=bool(params.get("latest")),
        include_history=bool(params.get("include_history")), lifecycle_status=params.get("lifecycle_status"))
    return ToolResult("findings", result["overall_status"], items=result["items"],
        warnings=result["warnings"], limitations=result["limitations"],
        data_sources=["intelligence_findings", "orders"], row_count=len(result["items"]))


_HANDLERS: dict[str, Callable[[str, Any, dict, dict], ToolResult]] = {
    "store_health": _store_health,
    "integration_health": _integration,
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
               "comparison_start", "comparison_end", "year_over_year",
               "order_reference", "checkout_reference", "latest", "financial_status", "fulfillment_status", "cancelled",
               "abandoned_only", "include_records", "product_reference", "finding_reference",
               "include_history", "lifecycle_status"}
    if set(params) - allowed:
        raise ToolAuthorizationError("Unsupported tool parameter")
    if params.get("financial_status") is not None and params["financial_status"] not in {
        "AUTHORIZED", "EXPIRED", "PAID", "PARTIALLY_PAID", "PARTIALLY_REFUNDED",
        "PENDING", "REFUNDED", "VOIDED", "CANCELLED",
    }:
        raise ToolAuthorizationError("Unsupported financial status filter")
    if params.get("fulfillment_status") is not None and params["fulfillment_status"] not in {
        "FULFILLED", "UNFULFILLED", "PARTIALLY_FULFILLED", "IN_PROGRESS",
        "ON_HOLD", "OPEN", "PENDING_FULFILLMENT", "RESTOCKED", "SCHEDULED",
    }:
        raise ToolAuthorizationError("Unsupported fulfillment status filter")
    for field_name in ("order_reference", "checkout_reference", "product_reference", "finding_reference"):
        if params.get(field_name) is not None and (
            not isinstance(params[field_name], str) or not params[field_name].strip() or len(params[field_name]) > 128
        ):
            raise ToolAuthorizationError("Invalid record reference")
    for flag in ("latest", "cancelled", "compare", "abandoned_only", "include_records", "year_over_year", "include_history"):
        if flag in params and not isinstance(params[flag], bool):
            raise ToolAuthorizationError("Invalid boolean tool parameter")
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
        from ..intelligence.trace_context import correlation_id_var, execution_id_var
        logger.warning("rev_tool_failed tool=%s error_type=%s correlation_id=%s execution_id=%s",
                       tool_name, type(exc).__name__, correlation_id_var.get(), execution_id_var.get())
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
