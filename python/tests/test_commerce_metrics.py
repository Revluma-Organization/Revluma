"""Tests for the deterministic commerce metrics layer.

Fixtures are hand-built and controlled; every expected number is computed by
hand inside the test so the assertions verify the implementation, not vice
versa.
"""

from datetime import datetime, timezone
from decimal import Decimal

import pytest

from src.intelligence import commerce_metrics as cm
from src.intelligence import metric_registry as mr

START = datetime(2026, 9, 1, tzinfo=timezone.utc)
END = datetime(2026, 10, 1, tzinfo=timezone.utc)


def order(total, *, currency="USD", ordered_at=datetime(2026, 9, 10, tzinfo=timezone.utc),
          customer_id="c1", refunded_total=None, discount_amount=None):
    return {
        "total": total,
        "currency": currency,
        "ordered_at": ordered_at,
        "customer_id": customer_id,
        "refunded_total": refunded_total,
        "discount_amount": discount_amount,
    }


class TestSummarizeOrders:
    def test_gross_net_refund_discount_and_aov_usd(self):
        rows = [
            order("100.00", customer_id="c1"),
            order("50.00", customer_id="c2", refunded_total="10.00", discount_amount="5.00"),
            order("25.00", customer_id="c2", discount_amount="2.50"),
        ]
        summary = cm.summarize_orders(rows, currency="USD", start=START, end=END)
        assert summary is not None
        assert summary.order_count == 3
        assert summary.gross_order_value == "175.00"
        assert summary.refunded_order_value == "10.00"
        assert summary.net_order_value == "165.00"
        assert summary.discount_value == "7.50"
        # AOV = net / orders = 165 / 3
        assert summary.average_order_value == "55.00"

    def test_currencies_never_mix(self):
        rows = [order("100.00", currency="USD"), order("200.00", currency="EUR")]
        usd = cm.summarize_orders(rows, currency="USD", start=START, end=END)
        result = cm.summarize_all_currencies(rows, start=START, end=END)
        assert usd.gross_order_value == "100.00"
        assert set(result) == {"USD", "EUR"}
        assert result["EUR"].gross_order_value == "200.00"

    def test_window_is_half_open(self):
        rows = [
            order("10.00", ordered_at=datetime(2026, 8, 31, 23, 59, 59, tzinfo=timezone.utc)),
            order("20.00", ordered_at=datetime(2026, 9, 1, 0, 0, 0, tzinfo=timezone.utc)),
            order("40.00", ordered_at=datetime(2026, 9, 30, 23, 59, 59, tzinfo=timezone.utc)),
            order("80.00", ordered_at=datetime(2026, 10, 1, 0, 0, 0, tzinfo=timezone.utc)),
        ]
        summary = cm.summarize_orders(rows, currency="USD", start=START, end=END)
        assert summary.order_count == 2
        assert summary.gross_order_value == "60.00"

    def test_missing_data_returns_none_not_zero(self):
        assert cm.summarize_orders([], currency="USD", start=START, end=END) is None

    def test_verified_zero_is_a_real_zero(self):
        rows = [order("0.00")]
        summary = cm.summarize_orders(rows, currency="USD", start=START, end=END)
        assert summary.gross_order_value == "0.00"
        assert summary.average_order_value == "0.00"

    def test_unparseable_money_fails_loud(self):
        with pytest.raises(cm.MetricDataError):
            cm.summarize_orders([order("not-money")], currency="USD", start=START, end=END)

    def test_naive_timestamps_rejected(self):
        with pytest.raises(cm.MetricDataError):
            cm.summarize_orders([order("1.00", ordered_at=datetime(2026, 9, 10))],
                                currency="USD", start=START, end=END)

    def test_partial_refund_counts_full_amount(self):
        rows = [order("100.00", refunded_total="33.33")]
        summary = cm.summarize_orders(rows, currency="USD", start=START, end=END)
        assert summary.net_order_value == "66.67"


class TestRatios:
    def test_refund_rate(self):
        rows = [order("100.00", refunded_total="25.00")]
        assert cm.refund_rate(rows, currency="USD", start=START, end=END)["value"] == "0.2500"

    def test_refund_rate_zero_denominator_is_none_not_crash(self):
        rows = [order("0.00")]
        assert cm.refund_rate(rows, currency="USD", start=START, end=END) == {"value": None, "reason": "zero_denominator"}

    def test_refund_rate_no_data(self):
        assert cm.refund_rate([], currency="USD", start=START, end=END) == {"value": None, "reason": "no_data"}

    def test_repeat_purchase_rate(self):
        rows = [
            order("10.00", customer_id="a"), order("10.00", customer_id="a"),
            order("10.00", customer_id="b"),
        ]
        result = cm.repeat_purchase_rate(rows, start=START, end=END)
        assert result["value"] == "0.5000"
        assert result["repeat_customers"] == 1

    def test_repeat_purchase_rate_no_customers(self):
        assert cm.repeat_purchase_rate([], start=START, end=END)["value"] is None

    def test_cart_recovery_rate(self):
        carts = [{"recovered_at": datetime(2026, 9, 2, tzinfo=timezone.utc)}, {"recovered_at": None}, {"recovered_at": None}, {"recovered_at": None}]
        result = cm.cart_recovery_rate(carts)
        assert result["value"] == "0.2500"
        assert result["abandoned"] == 4

    def test_cart_recovery_rate_empty(self):
        assert cm.cart_recovery_rate([])["value"] is None


class TestUnitsSold:
    def test_units_summed(self):
        items = [{"quantity": 2, "ordered_at": datetime(2026, 9, 10, tzinfo=timezone.utc)},
                 {"quantity": "3", "ordered_at": datetime(2026, 9, 11, tzinfo=timezone.utc)}]
        assert cm.units_sold(items) == 5

    def test_negative_quantity_rejected(self):
        with pytest.raises(cm.MetricDataError):
            cm.units_sold([{"quantity": -1}])


class TestRevenueByPeriod:
    def test_daily_buckets_sorted(self):
        rows = [
            order("30.00", ordered_at=datetime(2026, 9, 2, tzinfo=timezone.utc)),
            order("10.00", ordered_at=datetime(2026, 9, 1, tzinfo=timezone.utc)),
            order("20.00", ordered_at=datetime(2026, 9, 1, tzinfo=timezone.utc)),
        ]
        result = cm.revenue_by_period(rows, currency="USD", bucket="day", start=START, end=END)
        assert list(result) == ["2026-09-01", "2026-09-02"]
        assert result["2026-09-01"]["gross_order_value"] == "30.00"
        assert result["2026-09-01"]["order_count"] == 2

    def test_invalid_bucket_rejected(self):
        with pytest.raises(ValueError):
            cm.revenue_by_period([], currency="USD", bucket="week", start=START, end=END)


class TestNotComputableMetrics:
    @pytest.mark.parametrize("key", mr.not_computable_keys() if hasattr(mr, "not_computable_keys") else [k for k, v in mr.REGISTRY.items() if v.status == mr.NOT_COMPUTABLE])
    def test_not_computable_metrics_raise_instead_of_inventing(self, key):
        with pytest.raises(mr.MetricNotComputableError):
            cm.require_computable(key)


class TestClaimGrades:
    from src.intelligence import evidence as ev

    def item(self, identifier="ev-1", status="available", currency=None):
        base = {"id": identifier, "status": status, "unit": "count",
                "period": {"start": "2026-09-01T00:00:00Z", "end": "2026-10-01T00:00:00Z"},
                "source": "orders", "definition": "d"}
        if currency:
            base["unit"] = "currency"
            base["currency"] = currency
            base["value"] = "10.00"
        return base

    def test_verified_fact_requires_resolvable_available_evidence(self):
        ev = self.ev
        assert ev.validate_claim_grades([{"grade": "verified_fact", "evidence_ids": ["ev-1"]}], [self.item()]) == []
        assert "verified_fact_without_evidence" in ev.validate_claim_grades([{"grade": "verified_fact"}], [])
        assert "verified_fact_cites_unknown_evidence" in ev.validate_claim_grades(
            [{"grade": "verified_fact", "evidence_ids": ["nope"]}], [self.item()])
        assert "verified_fact_cites_unavailable_evidence" in ev.validate_claim_grades(
            [{"grade": "verified_fact", "evidence_ids": ["ev-1"]}], [self.item(status="partial")])

    def test_verified_fact_currency_must_match_citations(self):
        ev = self.ev
        errors = ev.validate_claim_grades(
            [{"grade": "verified_fact", "evidence_ids": ["ev-1"], "unit": "currency", "currency": "EUR"}],
            [self.item(currency="USD")])
        assert "verified_fact_currency_mismatch" in errors

    def test_calculated_observation_requires_definition_and_resolvable_evidence(self):
        ev = self.ev
        assert "calculated_observation_without_definition" in ev.validate_claim_grades(
            [{"grade": "calculated_observation", "evidence_ids": ["ev-1"]}], [self.item()])
        assert ev.validate_claim_grades(
            [{"grade": "calculated_observation", "evidence_ids": ["ev-1"], "definition": "SUM(total)"}],
            [self.item(status="partial")]) == []

    def test_hypothesis_can_never_be_verified(self):
        ev = self.ev
        assert "hypothesis_claimed_verified" in ev.validate_claim_grades(
            [{"grade": "hypothesis", "verified": True, "evidence_ids": ["ev-1"]}], [self.item()])

    def test_unknown_claim_may_not_carry_value(self):
        ev = self.ev
        assert "unknown_claim_carries_value" in ev.validate_claim_grades(
            [{"grade": "unknown", "value": 42}], [])
        assert ev.validate_claim_grades([{"grade": "unknown"}], []) == []

    def test_invalid_grade_rejected(self):
        ev = self.ev
        assert "invalid_claim_grade" in ev.validate_claim_grades([{"grade": "strong_feeling"}], [])
