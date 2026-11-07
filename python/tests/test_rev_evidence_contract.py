from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from src.intelligence.evidence import (
    STATUS_AVAILABLE,
    STATUS_UNSUPPORTED,
    UNIT_COUNT,
    UNIT_CURRENCY,
    describe_period,
    evidence_item,
    evidence_context,
    group_by_currency,
    money,
    money_percent_change,
    normalize_currency,
    period,
    previous_period,
    validate_attribution,
    validate_collection,
)

NOW = datetime(2026, 11, 1, 12, tzinfo=timezone.utc)
WINDOW = period(NOW - timedelta(days=7), NOW, label="Last seven days")
COMPLETE = {"status": "complete", "complete": True, "source": "orders", "note": "Certified test coverage."}


@pytest.fixture(autouse=True)
def authorized_evidence_scope():
    with evidence_context("org-a", ["store-a"]):
        yield


def test_currency_normalisation_never_substitutes_usd():
    assert normalize_currency("usd") == "USD"
    assert normalize_currency(" NGN ") == "NGN"
    for value in (None, "", "US", "USDT", 840, "$$$", True):
        assert normalize_currency(value) is None


def test_money_is_decimal_string_and_rejects_malformed_values():
    assert money("30.3") == "30.30"
    assert money(Decimal("1000")) == "1000.00"
    assert money("not-a-number") is None
    assert money(float("nan")) is None
    assert money(True) is None


def test_monetary_item_requires_currency_and_is_unsupported_otherwise():
    item = evidence_item(
        "recorded_order_value", label="Recorded order value", value="0",
        unit=UNIT_CURRENCY, currency=None, window=WINDOW, source="orders",
        definition="Sum of order totals.",
    )
    assert item["status"] == STATUS_UNSUPPORTED
    assert item["value"] is None
    assert item["currency"] is None

    with_currency = evidence_item(
        "recorded_order_value", label="Recorded order value", value="30.31",
        unit=UNIT_CURRENCY, currency="usd", window=WINDOW, source="orders",
        definition="Sum of order totals.",
    )
    assert with_currency["status"] == STATUS_AVAILABLE
    assert with_currency["value"] == "30.31"
    assert with_currency["currency"] == "USD"


def test_verified_count_zero_is_distinct_from_unsupported_value():
    count = evidence_item(
        "recorded_order_count", label="Orders", value=0, unit=UNIT_COUNT,
        window=WINDOW, source="orders", definition="Non-cancelled order count.", coverage=COMPLETE,
    )
    assert count["status"] == "verified_zero" and count["value"] == 0


def test_currency_grouping_never_sums_across_currencies():
    usd = evidence_item("v", label="USD value", value="10.10", unit=UNIT_CURRENCY,
                        currency="USD", window=WINDOW, source="orders",
                        definition="Recorded order value.")
    ngn = evidence_item("v", label="NGN value", value="1000", unit=UNIT_CURRENCY,
                        currency="NGN", window=WINDOW, source="orders",
                        definition="Recorded order value.")
    grouped = group_by_currency([usd, ngn])
    assert grouped["USD"]["value"] == "10.10"
    assert grouped["NGN"]["value"] == "1000.00"
    assert "1009.10" not in str(grouped)
    assert validate_collection([usd, ngn]) == []


def test_percent_change_refuses_invented_denominators():
    assert money_percent_change("0", "0")["status"] == STATUS_UNSUPPORTED
    assert money_percent_change("10", "0")["status"] == STATUS_UNSUPPORTED
    assert money_percent_change(None, "10")["status"] == STATUS_UNSUPPORTED
    change = money_percent_change("75", "100")
    assert change["status"] == STATUS_AVAILABLE
    assert change["percent"] == "-25.0"


def test_duplicate_evidence_ids_and_missing_provenance_are_reported():
    item = evidence_item("v", label="V", value="1", unit=UNIT_CURRENCY,
                         currency="USD", window=WINDOW, source="orders",
                         definition="Value.")
    assert "duplicate_evidence_id" in validate_collection([item, item])
    broken = {**item, "source": "", "definition": ""}
    assert "missing_provenance" in validate_collection([broken])


def test_period_helpers_are_half_open_and_comparable():
    window = period(NOW - timedelta(days=7), NOW,
                    comparison_start=None, comparison_end=None)
    assert window["semantics"] == "[start, end)"
    start, end = previous_period(NOW - timedelta(days=7), NOW)
    assert (end - start).total_seconds() == 7 * 24 * 3600
    assert end == NOW - timedelta(days=7)
    assert "7 days" in describe_period(window)


def test_evidence_requires_timezone_aware_period():
    with pytest.raises(ValueError):
        period(datetime(2026, 1, 1), datetime(2026, 1, 2))


def _item(metric="recorded_order_value", value="100.00", currency="USD"):
    return evidence_item(
        metric, label=metric, value=value, unit=UNIT_CURRENCY,
        window=WINDOW, source="orders", definition="Recorded orders.",
        currency=currency, discriminator=currency,
    )


def test_attribution_rejects_a_claim_without_evidence():
    items = [_item()]
    facts = [{"text": "Revenue fell 12%.", "evidence_ids": []}]
    assert "fact_without_evidence" in validate_attribution(facts, [], items)


def test_attribution_rejects_unknown_evidence_ids():
    items = [_item()]
    facts = [{"text": "Revenue fell 12%.", "evidence_ids": ["ev-does-not-exist"]}]
    assert "fact_cites_unknown_evidence" in validate_attribution(facts, [], items)


def test_attribution_accepts_a_calculated_observation_citing_both_periods():
    previous = _item()
    current = evidence_item(
        "recorded_order_value", label="recorded_order_value", value="80.00",
        unit=UNIT_CURRENCY, window=period(NOW, NOW + timedelta(days=7)),
        source="orders", definition="Recorded orders.", currency="USD", discriminator="USD",
    )
    facts = [{
        "text": "Recorded order value moved down 20.0% versus the previous period",
        "evidence_ids": [previous["id"], current["id"]],
        "unit": "percent",
        "currency": "USD",
    }]
    assert validate_attribution(facts, [], [previous, current]) == []


def test_attribution_rejects_a_currency_fact_without_a_currency():
    items = [_item()]
    facts = [{"text": "Revenue moved.", "evidence_ids": [items[0]["id"]], "unit": UNIT_CURRENCY}]
    assert "currency_fact_without_currency" in validate_attribution(facts, [], items)


def test_attribution_rejects_a_hypothesis_marked_verified():
    items = [_item()]
    hypotheses = [{"statement": "Checkout broke.", "verified": True, "basis_evidence_ids": []}]
    assert "hypothesis_claimed_verified" in validate_attribution([], hypotheses, items)
