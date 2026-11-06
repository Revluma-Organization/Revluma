"""Deterministic commerce metric computation (Rev Intelligence).

This module is the single, authoritative place where Rev's computable commerce
metrics are calculated. It implements only the metrics whose inputs exist in the
authorized production schema (see ``metric_registry``); requesting anything else
raises ``MetricNotComputableError`` instead of producing a plausible number.

Guarantees:

* All arithmetic uses ``Decimal`` with ``ROUND_HALF_UP``; floats never enter
  monetary paths.
* Currencies are never mixed: every aggregation is either per-currency or
  explicitly currency-gated.
* A half-open reporting window ``[start, end)`` is enforced on every row.
* Missing data is ``None`` — never silently coerced to zero. A verified zero
  (rows exist, sums to zero) is a real ``0.00``.
* Zero denominators yield ``None`` with a ``reason``, never a divide error
  and never an invented ratio.
* Unparseable source values raise ``MetricDataError`` (fail loud) rather than
  producing a subtly wrong aggregate.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any, Iterable

from src.intelligence import metric_registry as mr

CENTS = Decimal("0.01")
ZERO = Decimal("0")


class MetricDataError(ValueError):
    """A source row carried a value that cannot be used in a financial metric."""


def _require_known_metric(key: str):
    definition = mr.REGISTRY.get(key)
    if definition is None:
        raise mr.MetricDefinitionError(f"unknown metric: {key}")
    return definition


def require_computable(key: str) -> mr.MetricDefinition:
    """Gate every entry point: not-computable metrics can never be emitted."""
    definition = _require_known_metric(key)
    if definition.status == mr.NOT_COMPUTABLE:
        raise mr.MetricNotComputableError(definition)
    return definition


def _dec(value: Any, *, field: str) -> Decimal | None:
    if value is None:
        return None
    if isinstance(value, bool):
        raise MetricDataError(f"{field}: boolean is not a monetary value")
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise MetricDataError(f"{field}: unparseable monetary value {value!r}") from exc
    if not amount.is_finite():
        raise MetricDataError(f"{field}: non-finite monetary value {value!r}")
    return amount


def _parse_timestamp(value: Any, *, field: str) -> datetime:
    if isinstance(value, datetime):
        ts = value
    else:
        try:
            ts = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError as exc:
            raise MetricDataError(f"{field}: unparseable timestamp {value!r}") from exc
    if ts.tzinfo is None or ts.utcoffset() is None:
        raise MetricDataError(f"{field}: timestamp must be timezone-aware")
    return ts


def _windowed(rows: Iterable[dict], start: datetime, end: datetime) -> list[dict]:
    start = _parse_timestamp(start, field="period start")
    end = _parse_timestamp(end, field="period end")
    if end <= start:
        raise ValueError("period end must be after start")
    selected = []
    for row in rows:
        ordered = row.get("ordered_at")
        if ordered is None:
            raise MetricDataError("ordered_at is required on every order row")
        ts = _parse_timestamp(ordered, field="ordered_at")
        if start <= ts < end:
            selected.append(row)
    return selected


def _currency_gate(rows: Iterable[dict], currency: str) -> tuple[list[dict], int]:
    code = (currency or "").strip().upper()
    if len(code) != 3 or not code.isalpha():
        raise MetricDataError(f"invalid ISO-4217 currency code: {currency!r}")
    selected = [row for row in rows if str(row.get("currency") or "").strip().upper() == code]
    skipped = sum(1 for row in rows if str(row.get("currency") or "").strip().upper() != code)
    return selected, skipped


def _money_str(amount: Decimal) -> str:
    return str(amount.quantize(CENTS, rounding=ROUND_HALF_UP))


def _sum(rows: list[dict], field: str) -> Decimal:
    total = ZERO
    for row in rows:
        amount = _dec(row.get(field), field=field)
        if amount is not None:
            total += amount
    return total


@dataclass(frozen=True)
class OrderSummary:
    currency: str
    order_count: int
    gross_order_value: str
    net_order_value: str
    refunded_order_value: str
    discount_value: str
    average_order_value: str | None
    rows_skipped_other_currency: int

    def as_dict(self) -> dict[str, Any]:
        return {
            "currency": self.currency,
            "order_count": self.order_count,
            "gross_order_value": self.gross_order_value,
            "net_order_value": self.net_order_value,
            "refunded_order_value": self.refunded_order_value,
            "discount_value": self.discount_value,
            "average_order_value": self.average_order_value,
            "rows_skipped_other_currency": self.rows_skipped_other_currency,
        }


def summarize_orders(rows: Iterable[dict], *, currency: str,
                     start: datetime, end: datetime) -> OrderSummary | None:
    """Aggregate the registered order metrics for one currency and window.

    Returns ``None`` when there are no rows for the currency in the window
    (no data), which is deliberately distinct from a verified zero.
    """
    require_computable("gross_recorded_order_value")
    require_computable("net_recorded_order_value")
    require_computable("refunded_order_value")
    require_computable("discount_recorded_value")
    windowed = _windowed(rows, start, end)
    selected, skipped = _currency_gate(windowed, currency)
    if not selected and not windowed:
        return None
    if not selected:
        return None
    gross = _sum(selected, "total")
    refunded = _sum(selected, "refunded_total")
    discount = _sum(selected, "discount_amount")
    net = gross - refunded
    count = len(selected)
    aov = _money_str(net / count) if count else None
    return OrderSummary(
        currency=currency.strip().upper(),
        order_count=count,
        gross_order_value=_money_str(gross),
        net_order_value=_money_str(net),
        refunded_order_value=_money_str(refunded),
        discount_value=_money_str(discount),
        average_order_value=aov,
        rows_skipped_other_currency=skipped,
    )


def summarize_all_currencies(rows: Iterable[dict], *, start: datetime,
                             end: datetime) -> dict[str, OrderSummary]:
    """Per-currency summaries; currencies are never summed together."""
    windowed = _windowed(rows, start, end)
    currencies = sorted({str(row.get("currency") or "").strip().upper()
                         for row in windowed if row.get("currency")})
    result: dict[str, OrderSummary] = {}
    for code in currencies:
        summary = summarize_orders(windowed, currency=code, start=start, end=end)
        if summary is not None:
            result[code] = summary
    return result


def refund_rate(rows: Iterable[dict], *, currency: str,
                start: datetime, end: datetime) -> dict:
    """Refunded value / gross value for one currency; None denominator → None."""
    require_computable("refund_rate")
    summary = summarize_orders(rows, currency=currency, start=start, end=end)
    if summary is None:
        return {"value": None, "reason": "no_data"}
    gross = Decimal(summary.gross_order_value)
    if gross == ZERO:
        return {"value": None, "reason": "zero_denominator"}
    refunded = Decimal(summary.refunded_order_value)
    return {"value": str((refunded / gross).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)),
            "reason": None}


def repeat_purchase_rate(rows: Iterable[dict], *, start: datetime, end: datetime) -> dict:
    """Customers with ≥2 orders in the window ÷ customers with ≥1 order."""
    require_computable("repeat_purchase_rate")
    windowed = _windowed(rows, start, end)
    per_customer: dict[str, int] = {}
    for row in windowed:
        customer = row.get("customer_id")
        if customer is None:
            continue
        per_customer[str(customer)] = per_customer.get(str(customer), 0) + 1
    if not per_customer:
        return {"value": None, "reason": "no_data"}
    repeat = sum(1 for count in per_customer.values() if count >= 2)
    return {"value": str((Decimal(repeat) / Decimal(len(per_customer))).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)),
            "reason": None,
            "customers_with_orders": len(per_customer),
            "repeat_customers": repeat}


def cart_recovery_rate(carts: Iterable[dict]) -> dict:
    """Recovered abandoned carts ÷ abandoned carts; None denominator → None."""
    require_computable("cart_recovery_rate")
    total = 0
    recovered = 0
    for cart in carts:
        total += 1
        if cart.get("recovered_at") is not None:
            recovered += 1
    if total == 0:
        return {"value": None, "reason": "no_data"}
    return {"value": str((Decimal(recovered) / Decimal(total)).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)),
            "reason": None,
            "abandoned": total,
            "recovered": recovered}


def revenue_by_period(rows: Iterable[dict], *, currency: str, bucket: str,
                      start: datetime, end: datetime) -> dict[str, dict]:
    """Deterministic revenue rollup by UTC calendar bucket ('day'|'month')."""
    if bucket not in ("day", "month"):
        raise ValueError("bucket must be 'day' or 'month'")
    require_computable("gross_recorded_order_value")
    windowed = _windowed(rows, start, end)
    selected, _ = _currency_gate(windowed, currency)
    buckets: dict[str, list[dict]] = {}
    for row in selected:
        ts = _parse_timestamp(row["ordered_at"], field="ordered_at")
        key = ts.strftime("%Y-%m-%d") if bucket == "day" else ts.strftime("%Y-%m")
        buckets.setdefault(key, []).append(row)
    return {
        key: {
            "currency": currency.strip().upper(),
            "order_count": len(bucket_rows),
            "gross_order_value": _money_str(_sum(bucket_rows, "total")),
            "net_order_value": _money_str(_sum(bucket_rows, "total") - _sum(bucket_rows, "refunded_total")),
            "refunded_order_value": _money_str(_sum(bucket_rows, "refunded_total")),
            "discount_value": _money_str(_sum(bucket_rows, "discount_amount")),
        }
        for key, bucket_rows in sorted(buckets.items())
    }


def units_sold(line_items: Iterable[dict], *, start: datetime | None = None,
               end: datetime | None = None) -> int:
    """Total units across order line items in an optional window."""
    total = 0
    for item in line_items:
        ordered = item.get("ordered_at")
        if start is not None and end is not None:
            ts = _parse_timestamp(ordered, field="ordered_at")
            if not (_parse_timestamp(start, field="period start") <= ts < _parse_timestamp(end, field="period end")):
                continue
        try:
            quantity = int(item.get("quantity"))
        except (TypeError, ValueError) as exc:
            raise MetricDataError(f"quantity: unparseable value {item.get('quantity')!r}") from exc
        if quantity < 0:
            raise MetricDataError("quantity cannot be negative")
        total += quantity
    return total
