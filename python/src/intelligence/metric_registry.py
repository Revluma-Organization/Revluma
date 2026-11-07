"""Canonical metric definitions for Rev Intelligence.

Every metric Rev reports must have exactly one definition, and a caller must not
be able to substitute another one silently. Before this module the definitions
lived as free-text ``definition=`` arguments scattered across evidence builders,
so two answers could describe the same metric name with different formulas and
nothing would detect it. ``average_order_value`` was worse: it was computed
inline in :mod:`src.intelligence.seven_day_evidence` with no definition attached
at all.

The registry is also the place where Revluma states what it *cannot* compute.
That is a deliberate design choice, not an apology. The production schema has no
unit-cost field, no order-level tax or shipping amounts, no ``financial_status``
or ``cancelled_at`` on ``orders``, no refunds or cancellations table, and no
verified checkout-event vocabulary. A metric that depends on those inputs is
declared ``not_computable`` with the exact missing inputs and the connection that
would resolve them, so the conversation layer can disclose the gap instead of
inventing a plausible number.

Field provenance was verified against ``Backend/prisma/schema.prisma`` rather
than assumed:

* ``orders`` has ``total``, ``refunded_total``, ``subtotal``, ``discount_amount``,
  ``currency``, ``ordered_at``, ``customer_id``, ``recovery_status`` and
  ``attribution_channel``.
* ``orders`` does NOT have ``financial_status``, ``fulfillment_status``,
  ``cancelled_at``, or any tax, shipping or payment-fee amount.
* ``order_items.unit_price`` is the revenue-side line price, not a cost, so no
  COGS exists anywhere in the schema.
* ``products`` has ``stock_quantity``, ``stock_status`` and ``manage_stock``, so
  inventory availability is computable even though inventory *value* is not.
* ``abandoned_carts`` has ``cart_value``, ``currency``, ``abandoned_at`` and
  ``recovered_at``.
* ``events`` has ``session_id``, ``event_type`` and ``received_at``, but there is
  no enum constraining ``event_type``, so the checkout-stage vocabulary is
  unverified data rather than a schema guarantee.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

METRIC_REGISTRY_VERSION = "rev-metrics-v1"

#: The metric can be computed from fields that exist today.
COMPUTABLE = "computable"
#: The metric can be computed but carries a material caveat a merchant must see.
PARTIAL = "partial"
#: A required input does not exist in the authorized data. Must never be emitted.
NOT_COMPUTABLE = "not_computable"

METRIC_STATUSES = (COMPUTABLE, PARTIAL, NOT_COMPUTABLE)

UNIT_CURRENCY = "currency"
UNIT_COUNT = "count"
UNIT_RATIO = "ratio"
UNITS = (UNIT_CURRENCY, UNIT_COUNT, UNIT_RATIO)

TIMEZONE = "UTC"
WINDOW_SEMANTICS = "[start, end)"


class MetricDefinitionError(ValueError):
    """A metric was requested that this registry does not define."""


class MetricNotComputableError(MetricDefinitionError):
    """A metric was requested whose required inputs do not exist.

    Raised rather than returning a fabricated value: an unavailable metric must
    surface as a disclosed gap, never as a plausible-looking zero.
    """

    def __init__(self, definition: "MetricDefinition"):
        self.definition = definition
        super().__init__(
            f"metric '{definition.key}' is not computable: "
            f"missing {', '.join(definition.missing_inputs) or 'unknown inputs'}"
        )


class MetricDefinitionDriftError(AssertionError):
    """A caller supplied a definition that differs from the canonical one.

    This is the enforcement mechanism behind "never silently switch definitions
    between answers". Drift is a programming error, so it fails loudly in tests
    and at the boundary rather than degrading the merchant's answer.
    """


@dataclass(frozen=True)
class MetricDefinition:
    """One authoritative definition of one metric."""

    key: str
    label: str
    definition: str
    formula: str
    unit: str
    source_fields: tuple[str, ...]
    filters: str = ""
    exclusions: str = ""
    limitations: tuple[str, ...] = ()
    status: str = COMPUTABLE
    missing_inputs: tuple[str, ...] = ()
    resolution: str = ""
    requires_currency: bool = False
    version: str = METRIC_REGISTRY_VERSION
    timezone: str = TIMEZONE
    window_semantics: str = WINDOW_SEMANTICS

    def __post_init__(self) -> None:
        if self.unit not in UNITS:
            raise MetricDefinitionError(f"{self.key}: unsupported unit {self.unit!r}")
        if self.status not in METRIC_STATUSES:
            raise MetricDefinitionError(f"{self.key}: unsupported status {self.status!r}")
        if not self.definition or not self.formula:
            raise MetricDefinitionError(f"{self.key}: definition and formula are required")
        if self.unit == UNIT_CURRENCY and not self.requires_currency:
            raise MetricDefinitionError(
                f"{self.key}: a currency metric must declare requires_currency; "
                "unlike currencies must never be summed"
            )
        if self.status == NOT_COMPUTABLE and not self.missing_inputs:
            raise MetricDefinitionError(
                f"{self.key}: a not-computable metric must name its missing inputs"
            )
        if self.status == COMPUTABLE and self.missing_inputs:
            raise MetricDefinitionError(
                f"{self.key}: a computable metric must not list missing inputs"
            )

    @property
    def is_computable(self) -> bool:
        return self.status in (COMPUTABLE, PARTIAL)

    def explain_unavailable(self) -> str:
        """Merchant-facing explanation of a gap: what is missing and what resolves it."""
        if self.is_computable:
            return ""
        parts = [f"{self.label} cannot be calculated from the data Revluma is authorized to read."]
        if self.missing_inputs:
            parts.append("Missing: " + "; ".join(self.missing_inputs) + ".")
        if self.resolution:
            parts.append(self.resolution)
        return " ".join(parts)

    def as_evidence(self) -> dict:
        """The fields an evidence item must carry for this metric."""
        return {
            "metric": self.key,
            "label": self.label,
            "definition": self.definition,
            "formula": self.formula,
            "unit": self.unit,
            "currency_required": self.requires_currency,
            "limitations": list(self.limitations),
            "status": self.status,
            "calculation_version": self.version,
            "timezone": self.timezone,
            "window_semantics": self.window_semantics,
        }


def _m(**kwargs) -> MetricDefinition:
    return MetricDefinition(**kwargs)


# ---------------------------------------------------------------------------
# The registry. Names are the keys Rev and the evidence layer use.
# ---------------------------------------------------------------------------

REGISTRY: dict[str, MetricDefinition] = {
    d.key: d
    for d in (
        _m(
            key="order_count",
            label="Orders",
            definition="Number of recorded orders whose ordered_at falls inside the reporting window.",
            formula="COUNT(orders.id)",
            unit=UNIT_COUNT,
            source_fields=("orders.id", "orders.ordered_at", "orders.store_id"),
            filters="orders.store_id belongs to the authenticated organization; ordered_at in [start, end)",
            exclusions="None applied. The schema has no cancellation flag, so cancelled orders cannot be excluded.",
            limitations=(
                "Cannot exclude cancelled orders: orders has no financial_status or cancelled_at column.",
                "Counts orders Revluma has recorded, which depends on webhook and sync coverage.",
            ),
        ),
        _m(
            key="gross_recorded_order_value",
            label="Gross recorded order value",
            definition="Sum of orders.total for orders placed inside the reporting window, reported separately per currency.",
            formula="SUM(orders.total) GROUP BY orders.currency",
            unit=UNIT_CURRENCY,
            requires_currency=True,
            source_fields=("orders.total", "orders.currency", "orders.ordered_at"),
            filters="ordered_at in [start, end); grouped by currency",
            exclusions="None. Refunds are not subtracted here; see net_recorded_order_value.",
            limitations=(
                "This is recorded order value, not revenue recognised by the merchant's accounting system.",
                "orders.total semantics are supplied by the source platform; whether it is pre- or post-discount is not separately recorded.",
                "Values in different currencies are never summed together.",
            ),
        ),
        _m(
            key="net_recorded_order_value",
            label="Net recorded order value",
            definition="Gross recorded order value minus refunds recorded against those same orders, per currency.",
            formula="SUM(orders.total) - SUM(COALESCE(orders.refunded_total, 0)) GROUP BY orders.currency",
            unit=UNIT_CURRENCY,
            requires_currency=True,
            source_fields=("orders.total", "orders.refunded_total", "orders.currency", "orders.ordered_at"),
            filters="ordered_at in [start, end); grouped by currency",
            exclusions="None.",
            limitations=(
                "Refunds are attributed to the order's ordered_at because no refund timestamp exists, so a refund issued in this window against an older order is not visible here.",
                "This is not profit: no cost of goods, payment fees, shipping cost or advertising spend is available.",
            ),
        ),
        _m(
            key="refunded_order_value",
            label="Refunded order value",
            definition="Sum of refunds recorded against orders placed inside the reporting window, per currency.",
            formula="SUM(COALESCE(orders.refunded_total, 0)) GROUP BY orders.currency",
            unit=UNIT_CURRENCY,
            requires_currency=True,
            source_fields=("orders.refunded_total", "orders.currency", "orders.ordered_at"),
            filters="ordered_at in [start, end); grouped by currency",
            limitations=(
                "Attributed to order date, not refund date: no refund timestamp is stored.",
                "Full and partial refunds are indistinguishable; only the refunded amount is recorded.",
            ),
        ),
        _m(
            key="refund_rate",
            label="Refund rate",
            definition="Refunded order value as a proportion of gross recorded order value for the same window and currency.",
            formula="SUM(COALESCE(refunded_total,0)) / NULLIF(SUM(total), 0)",
            unit=UNIT_RATIO,
            source_fields=("orders.refunded_total", "orders.total", "orders.currency"),
            filters="ordered_at in [start, end); computed per currency",
            limitations=(
                "Denominator is gross recorded order value for orders placed in the window, not the value refunded in the window.",
                "Because refunds carry no timestamp, this measures refunds attached to the window's orders, which matures over time and will rise after the window closes.",
            ),
            status=PARTIAL,
        ),
        _m(
            key="discount_recorded_value",
            label="Recorded discount value",
            definition="Sum of order-level discount amounts recorded for orders placed inside the window, per currency.",
            formula="SUM(COALESCE(orders.discount_amount, 0)) GROUP BY orders.currency",
            unit=UNIT_CURRENCY,
            requires_currency=True,
            source_fields=("orders.discount_amount", "orders.currency", "orders.ordered_at"),
            filters="ordered_at in [start, end); grouped by currency",
            limitations=(
                "Line-item and promotion-level discounts are not separately attributed unless recorded in orders.discount_amount.",
                "Margin impact of a discount cannot be assessed: no unit cost exists.",
            ),
        ),
        _m(
            key="average_order_value",
            label="Average order value",
            definition="Net recorded order value divided by order count, for the same window and currency.",
            formula="(SUM(total) - SUM(COALESCE(refunded_total,0))) / NULLIF(COUNT(orders.id), 0)",
            unit=UNIT_CURRENCY,
            requires_currency=True,
            source_fields=("orders.total", "orders.refunded_total", "orders.currency", "orders.ordered_at"),
            filters="ordered_at in [start, end); computed per currency",
            exclusions="Orders with a zero count are reported as unavailable, never as zero.",
            limitations=(
                "Based on NET recorded order value. A gross-based AOV is a different metric and must not be labelled with this name.",
                "No rounding is applied at this layer: the value is exact decimal division, matching the existing seven-day evidence output.",
                "Inherits the refund-attribution limitation of net_recorded_order_value.",
            ),
        ),
        _m(
            key="repeat_purchase_rate",
            label="Repeat purchase rate",
            definition="Share of customers who placed their first recorded order inside the window and have at least one later recorded order.",
            formula="customers with >1 order / customers with >=1 order, over recorded orders",
            unit=UNIT_RATIO,
            source_fields=("orders.customer_id", "orders.ordered_at"),
            filters="orders scoped to the authenticated organization's stores",
            limitations=(
                "Reflects recorded order history only, which begins at the store's first successful sync; a long-tenured customer can appear new.",
                "Guest and duplicate customer records are not resolved into one identity.",
            ),
            status=PARTIAL,
        ),
        _m(
            key="abandoned_cart_count",
            label="Abandoned carts",
            definition="Number of abandoned carts whose abandoned_at falls inside the reporting window.",
            formula="COUNT(abandoned_carts.id) WHERE abandoned_at in [start, end)",
            unit=UNIT_COUNT,
            source_fields=("abandoned_carts.id", "abandoned_carts.abandoned_at", "abandoned_carts.store_id"),
            filters="abandoned_at in [start, end); store belongs to the authenticated organization",
            limitations=("Depends on checkout-event capture coverage, which varies by store and plan.",),
        ),
        _m(
            key="abandoned_cart_value",
            label="Abandoned cart value",
            definition="Sum of cart_value for abandoned carts created inside the window, per currency.",
            formula="SUM(abandoned_carts.cart_value) GROUP BY abandoned_carts.currency",
            unit=UNIT_CURRENCY,
            requires_currency=True,
            source_fields=("abandoned_carts.cart_value", "abandoned_carts.currency", "abandoned_carts.abandoned_at"),
            filters="abandoned_at in [start, end); grouped by currency",
            limitations=(
                "This is value at risk of not converting, not lost revenue. It must never be presented as money the merchant has lost.",
            ),
        ),
        _m(
            key="cart_recovery_rate",
            label="Cart recovery rate",
            definition="Share of abandoned carts in the window that have a recorded recovered_at.",
            formula="COUNT(recovered_at IS NOT NULL) / NULLIF(COUNT(*), 0)",
            unit=UNIT_RATIO,
            source_fields=("abandoned_carts.recovered_at", "abandoned_carts.abandoned_at"),
            filters="abandoned_at in [start, end)",
            limitations=(
                "Recovery is recorded, not attributed: a later purchase by the same customer may or may not have been caused by a recovery message.",
                "Carts abandoned near the end of the window have had less time to recover, so the rate is biased downward for recent windows.",
            ),
            status=PARTIAL,
        ),
        _m(
            key="inventory_availability",
            label="Inventory availability",
            definition="Product stock position as recorded by the source platform: stock_status and stock_quantity for products that manage stock.",
            formula="products.stock_status, products.stock_quantity WHERE products.manage_stock = true",
            unit=UNIT_COUNT,
            source_fields=("products.stock_quantity", "products.stock_status", "products.manage_stock"),
            filters="store belongs to the authenticated organization",
            limitations=(
                "A point-in-time snapshot of synced stock, not a live count; freshness depends on the last successful sync.",
                "Only products with manage_stock enabled carry a quantity.",
            ),
        ),
        _m(key="observed_checkout_count", label="Observed checkout records",
           definition="Unique stored checkout records whose source creation time is in the half-open reporting window; not universal checkout starts.",
           formula="COUNT(abandoned_carts.id) scoped by source_created_at and authorized store", unit=UNIT_COUNT,
           source_fields=("abandoned_carts.id", "abandoned_carts.source_created_at", "abandoned_carts.store_id"), status=PARTIAL),
        _m(key="completed_checkout_count", label="Completed observed checkouts",
           definition="Observed records with Shopify completedAt or a verified exact checkout-to-order relationship.",
           formula="COUNT(completed_at IS NOT NULL OR verified exact order relationship)", unit=UNIT_COUNT,
           source_fields=("abandoned_carts.completed_at", "orders.abandoned_cart_id"), status=PARTIAL),
        _m(key="abandoned_checkout_count", label="Explicitly observed abandoned checkouts",
           definition="Uncompleted records explicitly returned by Shopify abandonedCheckouts and available at the latest complete reconciliation.",
           formula="COUNT(source_resource = abandonedCheckouts AND source_state = available AND NOT completed)", unit=UNIT_COUNT,
           source_fields=("abandoned_carts.source_resource", "abandoned_carts.source_state", "abandoned_carts.completed_at"), status=PARTIAL),
        _m(key="unknown_lifecycle_count", label="Unknown checkout lifecycle",
           definition="Observed uncompleted records without explicit Shopify abandonedCheckouts evidence; inactivity alone never changes this state.",
           formula="COUNT(NOT completed AND NOT explicitly abandoned)", unit=UNIT_COUNT,
           source_fields=("abandoned_carts.source_resource", "abandoned_carts.completed_at"), status=PARTIAL),
        _m(key="observed_checkout_completion_rate", label="Observed checkout completion rate",
           definition="Completed observed records divided by completed-plus-explicitly-abandoned observed records; unknown lifecycle records are excluded.",
           formula="completed_checkout_count / NULLIF(completed_checkout_count + abandoned_checkout_count, 0)", unit=UNIT_RATIO,
           source_fields=("abandoned_carts.completed_at", "abandoned_carts.source_resource", "orders.abandoned_cart_id"),
           limitations=("Not a storewide conversion rate or a universal checkout-start rate.",), status=PARTIAL),
        _m(key="observed_checkout_abandonment_rate", label="Observed checkout abandonment rate",
           definition="Explicitly abandoned observed records divided by completed-plus-explicitly-abandoned observed records; unknown lifecycle records are excluded.",
           formula="abandoned_checkout_count / NULLIF(completed_checkout_count + abandoned_checkout_count, 0)", unit=UNIT_RATIO,
           source_fields=("abandoned_carts.source_resource", "abandoned_carts.source_state", "orders.abandoned_cart_id"),
           limitations=("Not a storewide abandonment rate or a universal checkout-start rate.",), status=PARTIAL),
        _m(key="abandoned_checkout_recorded_value", label="Recorded abandoned checkout value",
           definition="Sum of recorded totals for eligible observed abandoned checkouts in one currency; not lost, paid or recoverable revenue.",
           formula="SUM(abandoned_carts.cart_value) GROUP BY currency for eligible observed abandoned records", unit=UNIT_CURRENCY,
           requires_currency=True, source_fields=("abandoned_carts.cart_value", "abandoned_carts.currency"),
           limitations=("Shipping is unsupported by Shopify AbandonedCheckout; missing totals never become zero.",), status=PARTIAL),
        # ---------------- NOT COMPUTABLE: declared, never invented ----------------
        _m(
            key="cancellation_rate",
            label="Cancellation rate",
            definition="Proportion of orders cancelled inside the reporting window.",
            formula="cancelled orders / total orders",
            unit=UNIT_RATIO,
            source_fields=("orders.id",),
            status=NOT_COMPUTABLE,
            missing_inputs=(
                "orders.financial_status",
                "orders.cancelled_at",
                "a cancellations or refunds table",
            ),
            resolution=(
                "Resolvable by persisting the Shopify order financial_status and cancelled_at "
                "fields during order sync; until then cancellations are indistinguishable from "
                "ordinary orders and any cancellation figure would be fabricated."
            ),
        ),
        _m(
            key="conversion_rate",
            label="Conversion rate",
            definition="Sessions that resulted in a purchase, divided by sessions, inside the reporting window.",
            formula="purchasing sessions / sessions",
            unit=UNIT_RATIO,
            source_fields=("events.session_id", "events.event_type", "orders.session_id"),
            status=NOT_COMPUTABLE,
            missing_inputs=(
                "a verified event_type vocabulary identifying sessions, product views, checkout initiation and purchase",
                "a session denominator that is known to be complete",
            ),
            resolution=(
                "events.session_id and orders.session_id exist, but event_type is unconstrained "
                "data with no enum, so the checkout-stage vocabulary is unverified. Resolvable by "
                "confirming the emitted event_type values against the tracking source and recording "
                "the mapping; until then a conversion rate would rest on an assumed vocabulary."
            ),
        ),
        _m(
            key="checkout_completion_rate",
            label="Checkout completion rate",
            definition="Checkouts initiated that reached a completed purchase, inside the reporting window.",
            formula="completed checkouts / initiated checkouts",
            unit=UNIT_RATIO,
            source_fields=("events.event_type", "events.session_id", "abandoned_carts.source_checkout_id"),
            status=NOT_COMPUTABLE,
            missing_inputs=(
                "a verified checkout-initiation event",
                "checkout stage progression records",
            ),
            resolution=(
                "The existing seven-day evidence already reports this gap as "
                "'No verified checkout-event query is configured.' Device-level checkout "
                "analysis additionally requires a device dimension that no current source provides."
            ),
        ),
        _m(
            key="contribution_margin",
            label="Contribution margin",
            definition="Revenue remaining after cost of goods and directly attributable costs, per currency.",
            formula="net revenue - COGS - payment fees - shipping cost",
            unit=UNIT_CURRENCY,
            requires_currency=True,
            source_fields=("orders.total",),
            status=NOT_COMPUTABLE,
            missing_inputs=(
                "unit cost / COGS (no cost field exists on products; order_items.unit_price is the revenue-side line price)",
                "payment processing fees",
                "shipping cost actually paid",
            ),
            resolution=(
                "Resolvable by capturing product cost during sync and payment-fee data from the "
                "provider. Reporting a margin without cost data would state a profit figure that "
                "has no basis, which is the specific failure this registry exists to prevent."
            ),
        ),
        _m(
            key="net_profit",
            label="Net profit",
            definition="Revenue minus all costs for the reporting window.",
            formula="net revenue - COGS - fees - shipping - advertising - taxes",
            unit=UNIT_CURRENCY,
            requires_currency=True,
            source_fields=("orders.total", "orders.refunded_total"),
            status=NOT_COMPUTABLE,
            missing_inputs=(
                "cost of goods sold",
                "payment processing fees",
                "order-level tax and shipping amounts (products.tax_status is configuration, not an amount)",
                "advertising spend",
            ),
            resolution=(
                "Revenue is not profit and must never be presented as such. Resolvable only by "
                "connecting cost, fee and advertising sources."
            ),
        ),
        _m(
            key="return_on_ad_spend",
            label="Return on advertising spend",
            definition="Attributed revenue divided by advertising spend for the same window and channel.",
            formula="attributed revenue / ad spend",
            unit=UNIT_RATIO,
            source_fields=("orders.attribution_channel", "orders.total"),
            status=NOT_COMPUTABLE,
            missing_inputs=(
                "advertising spend (no campaign cost source is connected)",
                "an agreed attribution window matching the spend source",
            ),
            resolution=(
                "orders.attribution_channel records a channel but no cost is connected, so the "
                "denominator does not exist. Resolvable by connecting Meta Ads or Google Ads with "
                "an explicitly documented attribution window. Revenue attributed by a channel must "
                "not be added to Shopify revenue and presented as store revenue."
            ),
        ),
        _m(
            key="inventory_value",
            label="Inventory value",
            definition="Total cost value of stock on hand.",
            formula="SUM(stock_quantity * unit_cost)",
            unit=UNIT_CURRENCY,
            requires_currency=True,
            source_fields=("products.stock_quantity",),
            status=NOT_COMPUTABLE,
            missing_inputs=("unit cost per product or variant",),
            resolution=(
                "Quantity is available via products.stock_quantity, but no cost field exists, so "
                "stock can be reported in units and never in currency value."
            ),
        ),
        _m(
            key="customer_lifetime_value",
            label="Customer lifetime value",
            definition="Recorded revenue attributable to a customer across their whole recorded history, per currency.",
            formula="SUM(orders.total - COALESCE(refunded_total,0)) GROUP BY customer_id, currency",
            unit=UNIT_CURRENCY,
            requires_currency=True,
            source_fields=("orders.customer_id", "orders.total", "orders.refunded_total", "orders.currency"),
            filters="all recorded orders for the customer, not window-limited",
            limitations=(
                "This is HISTORICAL recorded value, not a predicted lifetime value. It must never be labelled as a forecast.",
                "History begins at the store's first successful sync, so it understates long-tenured customers.",
                "No predictive model, cohort or acquisition cost is applied.",
            ),
            status=PARTIAL,
        ),
    )
}


def get_metric(key: str) -> MetricDefinition:
    """Return the canonical definition, or raise rather than guess."""
    try:
        return REGISTRY[key]
    except KeyError:
        raise MetricDefinitionError(
            f"unknown metric {key!r}; the registry defines: {', '.join(sorted(REGISTRY))}"
        ) from None


def has_metric(key: str) -> bool:
    return key in REGISTRY


def definition_for(key: str) -> str:
    """The canonical definition string to attach to an evidence item."""
    return get_metric(key).definition


def limitations_for(key: str) -> list[str]:
    return list(get_metric(key).limitations)


def explain_unavailable_for(key: str) -> str:
    """Merchant-facing explanation of a gap, or "" when the metric is available.

    The conversation layer uses this to disclose what is missing and what would
    resolve it, instead of either inventing a value or going silent.
    """
    return get_metric(key).explain_unavailable()


def require_computable(key: str) -> MetricDefinition:
    """Return the definition if it can be computed; otherwise raise.

    Callers must go through this before emitting a value. A not-computable metric
    raises instead of returning zero, because a fabricated zero is indistinguishable
    from a real one downstream.
    """
    definition = get_metric(key)
    if not definition.is_computable:
        raise MetricNotComputableError(definition)
    return definition


def computable_metrics() -> tuple[str, ...]:
    return tuple(sorted(k for k, d in REGISTRY.items() if d.is_computable))


def unavailable_metrics() -> tuple[str, ...]:
    return tuple(sorted(k for k, d in REGISTRY.items() if not d.is_computable))


def assert_definition_matches(key: str, definition: str) -> None:
    """Enforce that a caller used the canonical definition.

    This is the guard behind "never silently switch definitions between answers".
    """
    canonical = definition_for(key)
    if definition != canonical:
        raise MetricDefinitionDriftError(
            f"metric {key!r} was reported with a non-canonical definition.\n"
            f"  canonical: {canonical}\n"
            f"  supplied:  {definition}"
        )


# ---------------------------------------------------------------------------
# Deterministic calculators.
#
# These exist so the arithmetic lives in one tested place instead of inline in a
# query formatter. They deliberately reproduce the existing seven-day evidence
# behaviour exactly - plain decimal division, no rounding - because changing the
# output format is a separate decision that must not ride along with introducing
# a registry.
# ---------------------------------------------------------------------------


def _decimal(value) -> Decimal | None:
    if value is None or value == "":
        return None
    if isinstance(value, Decimal):
        return value
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return None


def average_order_value(net_recorded_order_value, order_count) -> str | None:
    """Net recorded order value per order, or None when there are no orders.

    Returns None rather than "0" for an empty window: zero orders means the value
    is undefined, and reporting zero would imply orders existed and were free.
    """
    require_computable("average_order_value")
    count = int(order_count or 0)
    if count <= 0:
        return None
    total = _decimal(net_recorded_order_value)
    if total is None:
        return None
    return str(total / count)


def refund_rate(refunded_order_value, gross_recorded_order_value) -> str | None:
    """Refunds as a proportion of gross recorded order value, or None if undefined."""
    require_computable("refund_rate")
    gross = _decimal(gross_recorded_order_value)
    if gross is None or gross == 0:
        return None
    refunded = _decimal(refunded_order_value)
    if refunded is None:
        return None
    return str(refunded / gross)


def cart_recovery_rate(recovered_count, abandoned_count) -> str | None:
    require_computable("cart_recovery_rate")
    abandoned = int(abandoned_count or 0)
    if abandoned <= 0:
        return None
    return str(Decimal(int(recovered_count or 0)) / Decimal(abandoned))


def registry_manifest() -> dict:
    """The whole registry, for the conversation layer to disclose its own definitions."""
    return {
        "registry_version": METRIC_REGISTRY_VERSION,
        "timezone": TIMEZONE,
        "window_semantics": WINDOW_SEMANTICS,
        "metrics": {key: definition.as_evidence() for key, definition in sorted(REGISTRY.items())},
        "computable": list(computable_metrics()),
        "not_computable": list(unavailable_metrics()),
    }
