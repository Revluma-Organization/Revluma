"""Task 198 — canonical financial metric definitions and calculations.

This module is the single source of truth for how Revluma turns persisted
Shopify financial records into the revenue metrics Rev reports. Every metric
carries an explicit formula and an explicit treatment of taxes, shipping,
discounts, refunds, cancellations and unavailable fields. The rules encoded
here are enforced by construction, not by documentation alone:

* money is Decimal, quantized to two decimals (minor units), never float;
* metrics are computed per ISO currency and never summed across currencies;
* a value whose source field is missing for some orders is either excluded
  with an explicit ``partial`` flag or left ``None`` — it is never filled
  with zero or a default currency;
* refunds are deducted exactly once. The persisted order total
  (``orders.total``) is Shopify's ``currentTotalPriceSet`` — already net of
  refunds — so the refund ledger is used to *describe* refunds, never
  subtracted a second time from the net total;
* gross value is reconstructed as ``total + refunded_total`` only where the
  refunded amount is recorded; orders without refund evidence contribute to
  the net total only and the metric is flagged partial;
* test orders (Shopify ``test`` flag) are excluded from every monetary
  metric and reported as a count so the exclusion is visible.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP

TWO_PLACES = Decimal("0.01")

# ── Explicit metric definitions ──────────────────────────────────────────────
# Each entry is what Rev may say about the metric: the exact formula over the
# persisted Shopify fields and how each financial dimension is treated.
METRIC_DEFINITIONS: dict[str, dict] = {
    "recorded_order_count": {
        "label": "Recorded order count",
        "formula": "COUNT(orders) with ordered_at in [start, end), non-cancelled, test orders excluded",
        "interpretation": "not_applicable",
        "tax": "not_applicable", "shipping": "not_applicable",
        "discounts": "not_applicable", "refunds": "not_applicable",
        "cancellations": "excluded",
        "definition": (
            "Number of non-cancelled orders placed in the period (ordered_at in the "
            "half-open window). Cancelled, voided and deleted orders and Shopify test "
            "orders are excluded."
        ),
    },
    "recorded_order_value": {
        "label": "Net sales (recorded order value)",
        "formula": "SUM(orders.total) — Shopify currentTotalPriceSet, already net of refunds",
        "interpretation": "net",
        "tax": "included", "shipping": "included",
        "discounts": "deducted", "refunds": "deducted",
        "cancellations": "excluded",
        "definition": (
            "Net sales: sum of the persisted order total, which Shopify stores as the "
            "current (refund-adjusted) order total. Discounts are already deducted, "
            "tax and shipping are already included, and refunds are reflected once — "
            "never subtracted again here. Cancelled and test orders are excluded. "
            "This is a recorded sales figure, not recognised or settled revenue."
        ),
    },
    "gross_sales": {
        "label": "Gross sales (value as ordered)",
        "formula": "SUM(orders.total + orders.refunded_total) where refunded_total is recorded",
        "interpretation": "gross",
        "tax": "included", "shipping": "included",
        "discounts": "deducted", "refunds": "excluded",
        "cancellations": "excluded",
        "definition": (
            "Gross sales: the value of orders as charged, before refunds. Reconstructed "
            "as net total plus recorded refunds (Shopify totalPriceSet = "
            "currentTotalPriceSet + totalRefundedSet). Discounts are already deducted, "
            "tax and shipping are included. Orders without a recorded refund amount do "
            "not contribute and the metric is flagged partial until their refund "
            "evidence is complete."
        ),
    },
    "discount_amount": {
        "label": "Discounts",
        "formula": "SUM(orders.discount_amount) — Shopify totalDiscountsSet",
        "interpretation": "affected",
        "tax": "not_applicable", "shipping": "not_applicable",
        "discounts": "deducted", "refunds": "not_applicable",
        "cancellations": "excluded",
        "definition": (
            "Total order-level discounts recorded on orders placed in the period "
            "(Shopify totalDiscountsSet). This is the amount deducted from the order; "
            "it is not a cost or a revenue figure on its own."
        ),
    },
    "line_items_value": {
        "label": "Line-item value (pre-discount)",
        "formula": "SUM(orders.subtotal) — Shopify subtotalPriceSet",
        "interpretation": "gross",
        "tax": "excluded", "shipping": "excluded",
        "discounts": "excluded", "refunds": "excluded",
        "cancellations": "excluded",
        "definition": (
            "Sum of recorded line-item subtotals before discounts, taxes and shipping "
            "(Shopify subtotalPriceSet). Excludes any effect of refunds."
        ),
    },
    "refund_amount": {
        "label": "Refunds issued in period",
        "formula": "SUM(order_refunds.refund_amount) where refund created_at in [start, end)",
        "interpretation": "affected",
        "tax": "unknown", "shipping": "unknown",
        "discounts": "not_applicable", "refunds": "deducted",
        "cancellations": "excluded",
        "definition": (
            "Refund money issued during the period, attributed to the refund date "
            "(refund created_at in the window) from the itemised Shopify refund "
            "ledger. This is when the money went back to the customer, which is not "
            "necessarily the same period the order was placed in. Refunds on "
            "cancelled orders are excluded."
        ),
    },
    "refund_amount_window_orders": {
        "label": "Refunds on orders placed in period",
        "formula": "SUM(orders.refunded_total) for orders placed in [start, end)",
        "interpretation": "affected",
        "tax": "unknown", "shipping": "unknown",
        "discounts": "not_applicable", "refunds": "deducted",
        "cancellations": "excluded",
        "definition": (
            "Total refunds recorded to date on orders *placed* in the period "
            "(orders.refunded_total, attributed to the order date). This bridges "
            "gross and net sales for the period's orders and includes refunds that "
            "were issued after the period ended."
        ),
    },
    "tax_amount": {
        "label": "Taxes",
        "formula": "SUM(orders.tax_amount) — Shopify totalTaxSet",
        "interpretation": "affected",
        "tax": "included", "shipping": "not_applicable",
        "discounts": "not_applicable", "refunds": "not_applicable",
        "cancellations": "excluded",
        "definition": (
            "Total tax recorded on orders placed in the period (Shopify totalTaxSet). "
            "Tax enrichment is a separate sync domain; orders without a recorded tax "
            "amount do not contribute and the metric is flagged partial."
        ),
    },
    "shipping_amount": {
        "label": "Shipping",
        "formula": "SUM(orders.shipping_amount) — Shopify totalShippingPriceSet",
        "interpretation": "affected",
        "tax": "not_applicable", "shipping": "included",
        "discounts": "not_applicable", "refunds": "not_applicable",
        "cancellations": "excluded",
        "definition": (
            "Total shipping recorded on orders placed in the period (Shopify "
            "totalShippingPriceSet). Orders without a recorded shipping amount do "
            "not contribute and the metric is flagged partial."
        ),
    },
    "captured_payment_amount": {
        "label": "Captured payments in period",
        "formula": (
            "SUM(order_transactions.amount) for SUCCESS transactions of kind "
            "SALE or CAPTURE with processed_at in [start, end)"
        ),
        "interpretation": "net",
        "tax": "included", "shipping": "included",
        "discounts": "deducted", "refunds": "deducted",
        "cancellations": "excluded",
        "definition": (
            "Payment money actually charged or captured during the period, from the "
            "Shopify order payment-transaction ledger (SUCCESS transactions of kind "
            "SALE or CAPTURE, attributed to processed_at). Authorizations, voids and "
            "failed attempts are not captured money. Captured payments are not the "
            "same as sales: timing and gateway differences are expected, and the "
            "transaction sync domain must be complete for the figure to be certified."
        ),
    },
    "outstanding_amount": {
        "label": "Outstanding order amounts",
        "formula": (
            "SUM(GREATEST(0, orders.total - orders.total_received)) for orders placed "
            "in [start, end) where both amounts are recorded"
        ),
        "interpretation": "affected",
        "tax": "unknown", "shipping": "unknown",
        "discounts": "unknown", "refunds": "unknown",
        "cancellations": "excluded",
        "definition": (
            "Order balance not yet received: net order total minus the amount Shopify "
            "records as received (totalReceivedSet), floored at zero, for orders "
            "placed in the period. Both amounts must be recorded; orders without "
            "either are excluded and the metric is flagged partial. This is a point-"
            "in-time balance, not a forecast of loss."
        ),
    },
}


def quantize(value: Decimal | None) -> Decimal | None:
    if value is None:
        return None
    return value.quantize(TWO_PLACES, rounding=ROUND_HALF_UP)


@dataclass(frozen=True)
class CurrencyAggregate:
    """One currency's verified aggregates for the reporting window.

    All ``*_verified`` counts are the number of orders for which the field was
    recorded; the matching sum covers exactly those orders. A sum with zero
    verified orders is ``None`` (unknown), never ``0`` (nothing to say).
    """

    currency: str
    order_count: int
    net_value: Decimal
    gross_value: Decimal | None
    gross_verified: int
    refunded_to_date_value: Decimal | None
    refunded_to_date_verified: int
    discount_value: Decimal | None
    discount_verified: int
    line_items_value: Decimal | None
    line_items_verified: int
    tax_value: Decimal | None
    tax_verified: int
    shipping_value: Decimal | None
    shipping_verified: int
    received_value: Decimal | None
    received_verified: int
    outstanding_value: Decimal | None
    outstanding_verified: int
    test_order_count: int
    currency_unverified_count: int
    negative_net_count: int

    @property
    def field_total(self) -> int:
        return self.order_count + self.test_order_count


def outstanding_for(
    net_value: Decimal | None,
    received_value: Decimal | None,
    *,
    verified: int,
) -> Decimal | None:
    """Outstanding balance for a currency group, or None when unverifiable.

    The order-level identity ``outstanding = max(0, net - received)`` must be
    computed per order before summing; this helper takes the per-order
    aggregate that the SQL layer computes with the same identity so the
    definition and the arithmetic cannot drift apart.
    """
    if net_value is None or received_value is None or verified <= 0:
        return None
    return quantize(max(Decimal(0), net_value - received_value))
