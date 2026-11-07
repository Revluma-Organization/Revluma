"""Task 206: value decomposition (volume vs order-value effect).
Synthetic fixtures shaped exactly like the revenue comparison contract."""
from decimal import Decimal

from src.intelligence.revenue_evidence import decompose_value_change


def change(metric, currency, current, previous, cur_id="ev-cur", prev_id="ev-prev"):
    return {"metric": metric, "currency": currency, "current": current,
            "previous": previous, "current_evidence_id": cur_id,
            "previous_evidence_id": prev_id, "status": "available"}


def result(*changes):
    return {"comparison": {"changes": list(changes)}}


def test_volume_driven_decomposition():
    # 4 -> 2 orders, value 200 -> 139.36. AOV_prev 50. count_effect=-100, value_effect=+39.36.
    r = result(
        change("recorded_order_value", "USD", "139.36", "200.00"),
        change("recorded_order_count", "USD", "2", "4"))
    (entry,) = decompose_value_change(r)
    assert entry["status"] == "available"
    assert entry["average_order_value_previous"] == "50.00"
    assert entry["order_count_effect"] == "-100.00"
    assert entry["order_value_effect"] == "39.36"
    assert entry["driver"] == "mixed-offsetting"
    # Effects reconcile exactly with the recorded value change.
    assert (Decimal(entry["order_count_effect"]) + Decimal(entry["order_value_effect"])
            == Decimal(entry["value_change"]))
    assert entry["value_change"] == "-60.64"


def test_value_driven_decomposition():
    # Count flat, value up.
    r = result(
        change("recorded_order_value", "USD", "120.00", "100.00"),
        change("recorded_order_count", "USD", "5", "5"))
    (entry,) = decompose_value_change(r)
    assert entry["order_count_effect"] == "0.00"
    assert entry["order_value_effect"] == "20.00"
    assert entry["driver"] == "value-driven"


def test_count_growth_is_volume_driven():
    r = result(
        change("recorded_order_value", "USD", "300.00", "200.00"),
        change("recorded_order_count", "USD", "6", "4"))
    (entry,) = decompose_value_change(r)
    # AOV_prev 50; count_effect = 2*50 = 100; value_effect = 100-100 = 0.
    assert entry["order_count_effect"] == "100.00"
    assert entry["order_value_effect"] == "0.00"
    assert entry["driver"] == "volume-driven"


def test_equally_split():
    # AOV_prev 25 (100/4); count 4 -> 5 (count_effect 25); value 100 -> 150
    # (change 50); value_effect = 50 - 25 = 25 -> equal magnitudes, same sign.
    r = result(
        change("recorded_order_value", "USD", "150.00", "100.00"),
        change("recorded_order_count", "USD", "5", "4"))
    (entry,) = decompose_value_change(r)
    assert entry["order_count_effect"] == "25.00"
    assert entry["order_value_effect"] == "25.00"
    assert entry["driver"] == "equally-split"


def test_zero_previous_count_is_disclosed_not_divided():
    r = result(
        change("recorded_order_value", "USD", "100.00", "0"),
        change("recorded_order_count", "USD", "3", "0"))
    (entry,) = decompose_value_change(r)
    assert entry["status"] == "unsupported"
    assert entry["reason"] == "previous_order_count_not_positive"
    assert entry.get("order_count_effect") is None


def test_missing_count_change_is_unsupported():
    r = result(change("recorded_order_value", "USD", "100.00", "80.00"))
    (entry,) = decompose_value_change(r)
    assert entry["status"] == "unsupported"
    assert entry["reason"] == "order_count_change_missing"


def test_inputs_not_recorded_is_unsupported():
    r = result(
        change("recorded_order_value", "USD", "100.00", None),
        change("recorded_order_count", "USD", "3", "4"))
    (entry,) = decompose_value_change(r)
    assert entry["status"] == "unsupported"
    assert entry["reason"] == "inputs_not_recorded"


def test_no_comparison_yields_no_decomposition():
    assert decompose_value_change({}) == []
    assert decompose_value_change({"comparison": {"changes": []}}) == []


def test_currencies_are_never_mixed():
    r = result(
        change("recorded_order_value", "USD", "139.36", "200.00"),
        change("recorded_order_count", "USD", "2", "4"),
        change("recorded_order_value", "NGN", "500000", "600000"),
        change("recorded_order_count", "NGN", "3", "4"))
    entries = decompose_value_change(r)
    by_currency = {e["currency"]: e for e in entries}
    assert set(by_currency) == {"USD", "NGN"}
    assert by_currency["NGN"]["value_change"] == "-100000.00"
    # Each currency is independent.
    assert by_currency["USD"]["previous_order_count"] == "4"
    assert by_currency["NGN"]["previous_order_count"] == "4"


def test_no_composite_score_field_is_invented():
    r = result(
        change("recorded_order_value", "USD", "139.36", "200.00"),
        change("recorded_order_count", "USD", "2", "4"))
    (entry,) = decompose_value_change(r)
    blob = repr(entry)
    for phrase in ("score", "confidence", "priority_", "impact_usd"):
        assert phrase not in blob.lower()
