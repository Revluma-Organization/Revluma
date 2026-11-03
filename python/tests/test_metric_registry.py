"""Tests for the canonical metric registry (§13 of the Rev Intelligence 2.0 brief).

The registry exists to make two failures impossible:

1. Two answers describing the same metric name with different formulas.
2. Rev reporting a metric whose inputs do not exist in the authorized data.

The second matters more than it looks. The production schema has no unit cost, no
order-level tax or shipping amounts, no ``financial_status`` or ``cancelled_at`` on
``orders``, and no verified checkout-event vocabulary. A system that cannot say
"not computable" will produce a confident, plausible, fabricated number instead.
"""

from decimal import Decimal

import pytest

from src.intelligence import metric_registry as mr
from src.intelligence.metric_registry import (
    COMPUTABLE,
    NOT_COMPUTABLE,
    PARTIAL,
    MetricDefinition,
    MetricDefinitionDriftError,
    MetricDefinitionError,
    MetricNotComputableError,
    assert_definition_matches,
    average_order_value,
    cart_recovery_rate,
    computable_metrics,
    definition_for,
    explain_unavailable_for,
    get_metric,
    has_metric,
    limitations_for,
    refund_rate,
    registry_manifest,
    require_computable,
    unavailable_metrics,
)


# ---------------------------------------------------------------------------
# Registry integrity
# ---------------------------------------------------------------------------


def test_every_registered_metric_is_a_well_formed_definition():
    assert mr.REGISTRY, "the registry must not be empty"
    for key, definition in mr.REGISTRY.items():
        assert isinstance(definition, MetricDefinition)
        assert definition.key == key
        assert definition.label
        assert definition.definition
        assert definition.formula
        assert definition.version == mr.METRIC_REGISTRY_VERSION


def test_metric_keys_are_unique_and_lookup_is_by_key():
    keys = [d.key for d in mr.REGISTRY.values()]
    assert len(keys) == len(set(keys))
    for key in keys:
        assert get_metric(key).key == key
        assert has_metric(key)


def test_a_currency_metric_must_declare_that_it_needs_a_currency():
    """Unlike currencies must never be summed, so the requirement is structural."""
    for key, definition in mr.REGISTRY.items():
        if definition.unit == mr.UNIT_CURRENCY:
            assert definition.requires_currency, key


def test_constructing_a_currency_metric_without_the_flag_is_rejected():
    with pytest.raises(MetricDefinitionError):
        MetricDefinition(
            key="bad",
            label="Bad",
            definition="d",
            formula="f",
            unit=mr.UNIT_CURRENCY,
            source_fields=("orders.total",),
        )


def test_a_not_computable_metric_must_name_its_missing_inputs():
    for key, definition in mr.REGISTRY.items():
        if definition.status == NOT_COMPUTABLE:
            assert definition.missing_inputs, f"{key} declares a gap without naming it"
            assert not definition.is_computable


def test_a_computable_metric_must_not_claim_missing_inputs():
    for key, definition in mr.REGISTRY.items():
        if definition.status == COMPUTABLE:
            assert not definition.missing_inputs, key
            assert definition.is_computable


def test_an_unknown_unit_or_status_is_rejected():
    with pytest.raises(MetricDefinitionError):
        MetricDefinition(
            key="x", label="X", definition="d", formula="f",
            unit="furlongs", source_fields=("a",),
        )
    with pytest.raises(MetricDefinitionError):
        MetricDefinition(
            key="x", label="X", definition="d", formula="f",
            unit=mr.UNIT_COUNT, source_fields=("a",), status="probably_fine",
        )


def test_an_unknown_metric_raises_instead_of_returning_a_guess():
    with pytest.raises(MetricDefinitionError) as excinfo:
        get_metric("customer_happiness_index")
    # The error must be actionable: it lists what does exist.
    assert "order_count" in str(excinfo.value)
    assert not has_metric("customer_happiness_index")


# ---------------------------------------------------------------------------
# The honest declaration of what cannot be computed.
#
# Each of these was verified against Backend/prisma/schema.prisma, not assumed.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "key,expected_gap",
    [
        ("cancellation_rate", "cancelled_at"),
        ("conversion_rate", "event_type"),
        ("checkout_completion_rate", "checkout"),
        ("contribution_margin", "COGS"),
        ("net_profit", "cost of goods"),
        ("return_on_ad_spend", "advertising spend"),
        ("inventory_value", "unit cost"),
    ],
)
def test_metrics_without_source_data_are_declared_not_computable(key, expected_gap):
    definition = get_metric(key)
    assert definition.status == NOT_COMPUTABLE
    # Needle lowercased as well as the haystack: the registry text is correct and
    # an uppercase "COGS" needle against a lowercased string was a test bug, not a
    # gap in the definition.
    needle = expected_gap.lower()
    haystack = " ".join(definition.missing_inputs).lower() + " " + definition.resolution.lower()
    assert needle in haystack, f"{key} does not name its gap: {needle!r}"


def test_a_not_computable_metric_cannot_be_requested_as_a_value():
    with pytest.raises(MetricNotComputableError) as excinfo:
        require_computable("net_profit")
    # The error names the gap rather than returning zero.
    assert "cost of goods" in str(excinfo.value).lower()


def test_every_not_computable_metric_says_how_to_resolve_it():
    for key in unavailable_metrics():
        definition = get_metric(key)
        assert definition.resolution, f"{key} names a gap but no path to close it"


def test_explain_unavailable_is_merchant_readable_and_empty_when_available():
    text = explain_unavailable_for("contribution_margin")
    assert "cannot be calculated" in text
    assert "Missing:" in text
    assert explain_unavailable_for("order_count") == ""


def test_profit_metrics_are_not_confused_with_revenue():
    """Revenue is not profit; the registry must make that structural, not stylistic."""
    assert get_metric("net_recorded_order_value").status in (COMPUTABLE, PARTIAL)
    assert get_metric("net_profit").status == NOT_COMPUTABLE
    assert "not profit" in " ".join(
        get_metric("net_recorded_order_value").limitations
    ).lower()


def test_abandoned_cart_value_is_never_presented_as_lost_revenue():
    definition = get_metric("abandoned_cart_value")
    joined = " ".join(definition.limitations).lower()
    assert "not lost revenue" in joined or "never be presented as money" in joined


def test_customer_lifetime_value_is_historical_not_predicted():
    definition = get_metric("customer_lifetime_value")
    assert definition.status == PARTIAL
    joined = " ".join(definition.limitations).lower()
    assert "not a predicted lifetime value" in joined


def test_refund_rate_discloses_that_it_is_attributed_to_order_date():
    """No refund timestamp exists, so the metric matures after the window closes."""
    definition = get_metric("refund_rate")
    assert definition.status == PARTIAL
    joined = " ".join(definition.limitations).lower()
    assert "no timestamp" in joined, joined
    # And the consequence a merchant must understand: the figure is not final.
    assert "matures over time" in joined


def test_average_order_value_is_defined_on_net_not_gross():
    """Gross-based and net-based AOV are different metrics and must not share a name."""
    definition = get_metric("average_order_value")
    assert "net recorded order value" in definition.definition.lower()
    assert "NET recorded order value" in " ".join(definition.limitations)


# ---------------------------------------------------------------------------
# Definition drift enforcement
# ---------------------------------------------------------------------------


def test_the_canonical_definition_is_accepted():
    assert_definition_matches("order_count", definition_for("order_count"))


def test_a_different_definition_for_the_same_metric_is_rejected():
    """This is the guard behind 'never silently switch definitions'."""
    with pytest.raises(MetricDefinitionDriftError) as excinfo:
        assert_definition_matches(
            "average_order_value",
            "Sum of order totals divided by the number of orders.",
        )
    message = str(excinfo.value)
    assert "canonical" in message and "supplied" in message


def test_drift_detection_catches_a_gross_substituted_for_net():
    gross_definition = (
        "Gross recorded order value divided by order count for the same window."
    )
    with pytest.raises(MetricDefinitionDriftError):
        assert_definition_matches("average_order_value", gross_definition)


def test_limitations_are_returned_as_a_fresh_list():
    first = limitations_for("order_count")
    first.append("mutated")
    assert "mutated" not in limitations_for("order_count")


# ---------------------------------------------------------------------------
# Deterministic calculators
# ---------------------------------------------------------------------------


def test_average_order_value_reproduces_the_existing_evidence_output_exactly():
    """tests/test_seven_day_evidence.py pins this value; the registry must not change it."""
    assert average_order_value(Decimal("3000"), 2) == "1500"
    assert average_order_value("3000", 2) == "1500"


def test_average_order_value_is_undefined_for_zero_orders_not_zero():
    """Zero orders means no AOV. Reporting 0 would imply orders existed and were free."""
    assert average_order_value(Decimal("3000"), 0) is None
    assert average_order_value(None, None) is None


def test_average_order_value_uses_exact_decimal_division():
    # No rounding is applied at this layer; that is a documented, deliberate choice.
    assert average_order_value(Decimal("100"), 3) == str(Decimal("100") / 3)


def test_average_order_value_rejects_non_numeric_input():
    assert average_order_value("not-a-number", 2) is None


def test_refund_rate_is_a_ratio_of_refunds_to_gross():
    assert refund_rate(Decimal("250"), Decimal("1000")) == "0.25"


def test_refund_rate_is_undefined_when_gross_is_zero():
    assert refund_rate(Decimal("0"), Decimal("0")) is None
    assert refund_rate(None, None) is None


def test_cart_recovery_rate_counts_recovered_over_abandoned():
    assert cart_recovery_rate(3, 12) == "0.25"
    assert cart_recovery_rate(0, 0) is None


def test_calculators_refuse_to_run_for_a_not_computable_metric():
    """The calculators check the registry, so a gap cannot be papered over."""
    with pytest.raises(MetricNotComputableError):
        # net_profit has no calculator, but requesting one through the registry
        # guard must fail rather than silently compute revenue and call it profit.
        require_computable("net_profit")


# ---------------------------------------------------------------------------
# Manifest and wiring
# ---------------------------------------------------------------------------


def test_the_manifest_discloses_the_whole_registry():
    manifest = registry_manifest()
    assert manifest["registry_version"] == mr.METRIC_REGISTRY_VERSION
    assert manifest["timezone"] == "UTC"
    assert manifest["window_semantics"] == "[start, end)"
    assert set(manifest["metrics"]) == set(mr.REGISTRY)
    assert "order_count" in manifest["computable"]
    assert "net_profit" in manifest["not_computable"]


def test_every_metric_in_the_manifest_carries_its_definition_and_version():
    for entry in registry_manifest()["metrics"].values():
        assert entry["definition"]
        assert entry["formula"]
        assert entry["calculation_version"] == mr.METRIC_REGISTRY_VERSION


def test_computable_and_unavailable_partition_the_registry():
    both = set(computable_metrics()) | set(unavailable_metrics())
    assert both == set(mr.REGISTRY)
    assert not (set(computable_metrics()) & set(unavailable_metrics()))


def test_seven_day_evidence_travels_with_its_metric_definitions():
    """The numbers and the formula that produced them must not be separable."""
    from src.intelligence.seven_day_evidence import _rows_by_currency

    rows = _rows_by_currency(
        [{"currency": "NGN", "item_count": 2, "amount": Decimal("3000")}],
        "order_count",
        "net_recorded_order_value",
    )
    assert rows[0]["average_order_value"] == "1500"
    # Definition text is available to attach, and matches the registry exactly.
    assert_definition_matches("average_order_value", definition_for("average_order_value"))


def test_seven_day_evidence_omits_aov_when_there_are_no_orders():
    from src.intelligence.seven_day_evidence import _rows_by_currency

    rows = _rows_by_currency(
        [{"currency": "NGN", "item_count": 0, "amount": Decimal("0")}],
        "order_count",
        "net_recorded_order_value",
    )
    assert "average_order_value" not in rows[0]
