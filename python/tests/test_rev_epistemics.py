"""Task 204: unit tests for the canonical epistemic claim contract.

Exercises ``src.intelligence.epistemics`` directly - builders, the
fail-closed validator (stable error codes), the financial-impact guard,
rollup, promotion, correction and reference resolution. No database, no
model: the contract must hold deterministically.
"""
from decimal import Decimal

import pytest

from src.intelligence.epistemics import (
    CLAIM_CONTRACT_VERSION,
    IMPACT_ASSERTED,
    IMPACT_KINDS,
    build_calculation_claim,
    build_fact_claim,
    build_hypothesis_claim,
    build_unknown_claim,
    can_promote,
    claim_reference,
    correct_claim,
    epistemic_rollup,
    validate_claim,
    validate_claims,
)

ORG = "11111111-1111-1111-1111-111111111111"
STORES = ["store-a1"]
INVEST = "inv-1"


def item(iid="ev-aaaa", currency="USD", status="available"):
    return {
        "id": iid, "status": status, "currency": currency,
        "retrieved_at": "2026-11-07T12:00:00Z",
        "source": {"system": "shopify", "resource": "orders"},
        "quality": {"schema_version": "rev-evidence-quality-v1", "availability": "available",
                    "coverage": "complete", "freshness": "fresh", "value_state": "observed_nonzero",
                    "consistency": "consistent", "currency_integrity": "single_verified_currency",
                    "sufficiency": "sufficient", "reasons": []},
        "limitations": [],
    }


PERIOD = {"start": "2026-11-06T12:00:00Z", "end": "2026-11-07T12:00:00Z",
          "timezone": "UTC", "label": "the last 24 hours"}


def count_fact(**over):
    fact = {"text": "4 non-cancelled orders recorded", "evidence_ids": ["ev-aaaa"],
            "metric": "recorded_order_count", "value": 4, "unit": "count",
            "currency": None, "period": PERIOD, "source": "orders"}
    fact.update(over)
    return fact


def money_fact(**over):
    fact = {"text": "Recorded order value USD 30.31", "evidence_ids": ["ev-aaaa"],
            "metric": "recorded_order_value", "value": "30.31", "unit": "currency",
            "currency": "usd", "period": PERIOD, "source": "orders"}
    fact.update(over)
    return fact


def change(**over):
    c = {"metric": "recorded_order_value", "currency": "USD", "current": "30.31",
         "previous": "20.00", "percent": "51.55", "direction": "up",
         "current_evidence_id": "ev-aaaa", "previous_evidence_id": "ev-bbbb"}
    c.update(over)
    return c


def build_count_claim():
    return build_fact_claim(count_fact(), organization_id=ORG, store_ids=STORES,
                            investigation_id=INVEST, item=item())


def build_money_claim():
    return build_fact_claim(money_fact(), organization_id=ORG, store_ids=STORES,
                            investigation_id=INVEST, item=item())


def build_calc_claim():
    k2 = {"ev-aaaa": item("ev-aaaa"), "ev-bbbb": item("ev-bbbb")}
    return build_calculation_claim(
        change=change(), fact=count_fact(evidence_ids=["ev-aaaa", "ev-bbbb"]),
        organization_id=ORG, store_ids=STORES, investigation_id=INVEST, items_by_id=k2), k2


def build_hypo_claim():
    return build_hypothesis_claim(
        {"statement": "Possible contributor, not established.", "verified": False,
         "confidence": 0.2, "basis_evidence_ids": ["ev-aaaa"], "note": "Not a finding."},
        organization_id=ORG, store_ids=STORES, investigation_id=INVEST)


def make_unknown_claim():
    return build_unknown_claim(
        "Abandonment reason not recorded.", organization_id=ORG, store_ids=STORES,
        investigation_id=INVEST, attempts=["checkout_observations"],
        missing_capability="abandonment reason capture")


# ── Contract identity ────────────────────────────────────────────────────────

def test_contract_version_is_fixed():
    assert CLAIM_CONTRACT_VERSION == "rev-claim-v1"


@pytest.mark.parametrize("builder", [build_count_claim, build_money_claim,
                                     build_hypo_claim, make_unknown_claim])
def test_all_builders_stamp_the_contract(builder):
    claim = builder()
    assert claim["contract_version"] == CLAIM_CONTRACT_VERSION
    assert claim["claim_id"].startswith("clm-")
    assert claim["organization_id"] == ORG
    assert claim["store_ids"] == STORES


def test_claim_id_is_deterministic_across_rederivation():
    assert build_count_claim()["claim_id"] == build_count_claim()["claim_id"]
    assert build_money_claim()["claim_id"] != build_count_claim()["claim_id"]


# ── Verified facts ───────────────────────────────────────────────────────────

def test_count_fact_validates():
    claim = build_count_claim()
    assert validate_claim(claim, known_evidence={"ev-aaaa": item()},
                          organization_id=ORG, store_ids=STORES) == []


def test_money_fact_validates_and_carries_quality():
    claim = build_money_claim()
    assert validate_claim(claim, known_evidence={"ev-aaaa": item()},
                          organization_id=ORG, store_ids=STORES) == []
    assert claim["quality"]["currency_integrity"] == "single_verified_currency"
    assert claim["rounding"] == "2dp_money"


def test_money_fact_false_precision_is_rejected():
    claim = build_fact_claim(money_fact(value="30.315"), organization_id=ORG,
                             store_ids=STORES, investigation_id=INVEST, item=item())
    assert "currency_claim_false_precision" in validate_claim(
        claim, known_evidence={"ev-aaaa": item()}, organization_id=ORG, store_ids=STORES)


def test_money_fact_without_currency_is_rejected():
    claim = build_fact_claim(money_fact(currency=None), organization_id=ORG,
                             store_ids=STORES, investigation_id=INVEST, item=item())
    errors = validate_claim(claim, known_evidence={"ev-aaaa": item()},
                            organization_id=ORG, store_ids=STORES)
    assert "currency_claim_without_currency" in errors


def test_fact_citing_unknown_evidence_is_rejected():
    claim = build_count_claim()
    errors = validate_claim(claim, known_evidence={}, organization_id=ORG, store_ids=STORES)
    assert "verified_fact_cites_unknown_evidence" in errors


def test_fact_citing_unavailable_evidence_is_rejected():
    claim = build_count_claim()
    errors = validate_claim(claim, known_evidence={"ev-aaaa": item(status="unavailable")},
                            organization_id=ORG, store_ids=STORES)
    assert "verified_fact_cites_unavailable_evidence" in errors


def test_fact_currency_mismatch_is_rejected():
    claim = build_fact_claim(money_fact(), organization_id=ORG, store_ids=STORES,
                             investigation_id=INVEST, item=item(currency="NGN"))
    errors = validate_claim(claim, known_evidence={"ev-aaaa": item(currency="NGN")},
                            organization_id=ORG, store_ids=STORES)
    assert "verified_fact_currency_mismatch" in errors


def test_null_value_is_never_treated_as_zero():
    claim = build_fact_claim(count_fact(value=None), organization_id=ORG,
                             store_ids=STORES, investigation_id=INVEST, item=item())
    errors = validate_claim(claim, known_evidence={"ev-aaaa": item()},
                            organization_id=ORG, store_ids=STORES)
    assert "established_claim_without_value" in errors


def test_cross_tenant_claim_is_rejected():
    claim = build_count_claim()
    assert "cross_tenant_claim" in validate_claim(
        claim, known_evidence={"ev-aaaa": item()}, organization_id="other-org",
        store_ids=STORES)


def test_cross_store_claim_is_rejected():
    claim = build_count_claim()
    assert "cross_store_claim" in validate_claim(
        claim, known_evidence={"ev-aaaa": item()}, organization_id=ORG,
        store_ids=["store-b2"])


# ── Calculated observations ─────────────────────────────────────────────────

def test_calculated_observation_is_valid_and_reproducible():
    claim, k2 = build_calc_claim()
    assert claim["classification"] == "calculated_observation"
    # The stored value is the declared-rounding form (1 dp), matching its text.
    assert claim["value"] == "51.6"
    calc = claim["calculation"]
    assert calc["method"] == "percent_change"
    assert calc["formula"]
    assert calc["version"]
    assert {entry["evidence_id"] for entry in calc["inputs"]} == {"ev-aaaa", "ev-bbbb"}
    assert validate_claim(claim, known_evidence=k2, organization_id=ORG, store_ids=STORES) == []


def test_calculated_observation_requires_a_calculation_block():
    claim, k2 = build_calc_claim()
    claim = dict(claim, calculation=None)
    assert "calculated_observation_without_calculation" in validate_claim(
        claim, known_evidence=k2, organization_id=ORG, store_ids=STORES)


def test_zero_denominator_is_rejected():
    claim, k2 = build_calc_claim()
    claim = dict(claim, calculation={
        **claim["calculation"], "inputs": [
            {"role": "current", "evidence_id": "ev-aaaa", "value": "30.31", "currency": "USD"},
            {"role": "previous", "evidence_id": "ev-bbbb", "value": 0, "currency": "USD"}]})
    assert "calculation_zero_or_missing_denominator" in validate_claim(
        claim, known_evidence=k2, organization_id=ORG, store_ids=STORES)


def test_missing_denominator_input_is_rejected():
    claim, k2 = build_calc_claim()
    claim = dict(claim, calculation={
        **claim["calculation"], "inputs": [
            {"role": "current", "evidence_id": "ev-aaaa", "value": "30.31", "currency": "USD"},
            {"role": "previous", "evidence_id": "ev-bbbb", "value": None, "currency": "USD"}]})
    errors = validate_claim(claim, known_evidence=k2, organization_id=ORG, store_ids=STORES)
    assert "calculation_zero_or_missing_denominator" in errors
    assert "calculation_input_missing_value" in errors


def test_mixed_currencies_are_rejected():
    claim, k2 = build_calc_claim()
    claim = dict(claim, calculation={
        **claim["calculation"], "inputs": [
            {"role": "current", "evidence_id": "ev-aaaa", "value": "30.31", "currency": "USD"},
            {"role": "previous", "evidence_id": "ev-bbbb", "value": "1000.00", "currency": "NGN"}]})
    assert "calculation_mixes_currencies" in validate_claim(
        claim, known_evidence=k2, organization_id=ORG, store_ids=STORES)


def test_unknown_calculation_input_evidence_is_rejected():
    claim, k2 = build_calc_claim()
    claim = dict(claim, calculation={
        **claim["calculation"], "inputs": [
            {"role": "current", "evidence_id": "ev-missing", "value": "30.31", "currency": "USD"}]})
    assert "calculation_input_cites_unknown_evidence" in validate_claim(
        claim, known_evidence=k2, organization_id=ORG, store_ids=STORES)


# ── Hypotheses and unknowns ─────────────────────────────────────────────────

def test_hypothesis_is_valid_and_never_verified():
    claim = build_hypo_claim()
    assert claim["hypothesis"]["verified"] is False
    assert validate_claim(claim, known_evidence={"ev-aaaa": item()},
                          organization_id=ORG, store_ids=STORES) == []


def test_hypothesis_marked_verified_is_rejected():
    claim = build_hypo_claim()
    claim = dict(claim, hypothesis={**claim["hypothesis"], "verified": True})
    assert "hypothesis_claimed_verified" in validate_claim(
        claim, known_evidence={"ev-aaaa": item()}, organization_id=ORG, store_ids=STORES)


def test_hypothesis_without_missing_evidence_is_rejected():
    claim = build_hypo_claim()
    claim = dict(claim, hypothesis={**claim["hypothesis"], "missing_evidence": []})
    assert "hypothesis_without_missing_evidence" in validate_claim(
        claim, known_evidence={"ev-aaaa": item()}, organization_id=ORG, store_ids=STORES)


def test_hypothesis_carrying_financial_impact_is_rejected():
    claim = build_hypo_claim()
    claim = dict(claim, financial_impact="lost")
    assert "hypothesis_carries_financial_impact" in validate_claim(
        claim, known_evidence={"ev-aaaa": item()}, organization_id=ORG, store_ids=STORES)


def test_unknown_is_valid_and_carries_no_value():
    claim = make_unknown_claim()
    assert claim["value"] is None
    assert validate_claim(claim, known_evidence={}, organization_id=ORG, store_ids=STORES) == []


def test_unknown_carrying_a_value_is_rejected():
    claim = make_unknown_claim()
    claim = dict(claim, value=0)
    assert "unknown_claim_carries_value" in validate_claim(
        claim, known_evidence={}, organization_id=ORG, store_ids=STORES)


# ── Financial-impact guard (revenue/loss integrity) ─────────────────────────

@pytest.mark.parametrize("kind", IMPACT_ASSERTED)
def test_asserted_impact_without_a_method_is_rejected(kind):
    claim = build_money_claim()
    claim = dict(claim, financial_impact=kind)
    assert "asserted_impact_without_method" in validate_claim(
        claim, known_evidence={"ev-aaaa": item()}, organization_id=ORG, store_ids=STORES)


def test_potential_impact_is_admissible_on_an_observed_claim():
    claim = build_money_claim()
    claim = dict(claim, financial_impact="potential")
    assert validate_claim(claim, known_evidence={"ev-aaaa": item()},
                          organization_id=ORG, store_ids=STORES) == []


def test_recoverable_impact_is_admissible_on_a_calculated_observation():
    claim, k2 = build_calc_claim()
    claim = dict(claim, financial_impact="recoverable")
    assert validate_claim(claim, known_evidence=k2, organization_id=ORG, store_ids=STORES) == []


def test_recoverable_impact_is_rejected_on_a_plain_fact():
    claim = build_money_claim()
    claim = dict(claim, financial_impact="recoverable")
    assert "asserted_impact_without_method" in validate_claim(
        claim, known_evidence={"ev-aaaa": item()}, organization_id=ORG, store_ids=STORES)


def test_unknown_impact_kind_is_rejected():
    claim = build_money_claim()
    claim = dict(claim, financial_impact="windfall")
    errors = validate_claim(claim, known_evidence={"ev-aaaa": item()},
                            organization_id=ORG, store_ids=STORES)
    assert "unknown_impact_kind:windfall" in errors


def test_impact_kind_vocabulary_is_closed():
    assert set(IMPACT_KINDS) == {"observed", "potential", *set(IMPACT_ASSERTED)}


# ── Rollup, promotion, correction, reference ────────────────────────────────

def test_rollup_counts_each_grade_and_never_upgrades():
    claims = [build_count_claim(), build_calc_claim()[0], build_hypo_claim(), make_unknown_claim()]
    rollup = epistemic_rollup(claims)
    assert rollup["contract_version"] == CLAIM_CONTRACT_VERSION
    assert rollup["total"] == 4
    assert rollup["counts"]["verified_fact"] == 1
    assert rollup["counts"]["calculated_observation"] == 1
    assert rollup["counts"]["hypothesis"] == 1
    assert rollup["counts"]["unknown"] == 1


def test_rollup_reports_per_metric_posture_without_blending():
    rollup = epistemic_rollup([build_count_claim(), build_hypo_claim()])
    assert "recorded_order_count" in rollup["metrics"]


def test_hypothesis_promotes_only_with_new_evidence():
    claim = build_hypo_claim()
    assert can_promote(claim, []) is False
    # Re-citing the same basis is not verification.
    assert can_promote(claim, ["ev-aaaa"]) is False
    # A genuinely new evidence id is.
    assert can_promote(claim, ["ev-new-1"]) is True


def test_non_hypothesis_cannot_be_promoted():
    assert can_promote(build_count_claim(), ["ev-new-1"]) is False


def test_correction_supersedes_and_names_the_original():
    original = build_money_claim()
    superseded, correction = correct_claim(original, reason="merchant challenged the figure")
    assert superseded["superseded"] is True
    assert superseded["superseded_reason"] == "merchant challenged the figure"
    # The original id and text are preserved so the change is visible.
    assert superseded["claim_id"] == original["claim_id"]
    assert superseded["text"] == original["text"]
    assert correction["corrects_claim_id"] == original["claim_id"]
    assert correction["classification"] == "unknown"
    assert correction["value"] is None
    # The correction itself validates (it is an acknowledged unknown).
    assert validate_claim(correction, known_evidence={"ev-aaaa": item()},
                          organization_id=ORG, store_ids=STORES) == []


# ── Follow-up reference resolution ──────────────────────────────────────────

def test_reference_resolves_a_specifically_mentioned_number():
    money = build_money_claim()
    calc, _ = build_calc_claim()
    unknown = make_unknown_claim()
    assert claim_reference([unknown, money, calc], mentioned_values=[30.31])["claim_id"] \
        == money["claim_id"]


def test_reference_falls_back_to_the_most_recent_quantitative_claim():
    money = build_money_claim()
    calc, _ = build_calc_claim()
    unknown = make_unknown_claim()
    # No number mentioned: a calculated observation is preferred over a fact.
    assert claim_reference([unknown, money, calc])["claim_id"] == calc["claim_id"]


def test_reference_returns_none_when_nothing_is_quantitative():
    assert claim_reference([build_hypo_claim(), make_unknown_claim()]) is None


# ── Restated claims (follow-up provenance) ──────────────────────────────────

def test_restated_claim_is_validated_under_restatement_rules():
    claim = build_money_claim()
    claim["restated"] = True
    claim["source_investigation"] = "inv-0"
    # Not re-derived against fresh evidence: the originating investigation is
    # what makes it admissible.
    assert validate_claim(claim, known_evidence={}, organization_id=ORG, store_ids=STORES) == []


def test_restated_claim_without_source_investigation_is_rejected():
    claim = build_money_claim()
    claim["restated"] = True
    errors = validate_claim(claim, known_evidence={}, organization_id=ORG, store_ids=STORES)
    assert "restated_claim_without_source_investigation" in errors


# ── validate_claims (set level) ─────────────────────────────────────────────

def test_validate_claims_aggregates_errors_and_rejects_non_objects():
    k2 = {"ev-aaaa": item("ev-aaaa"), "ev-bbbb": item("ev-bbbb")}
    good, _ = build_calc_claim()
    bad = build_money_claim()
    errors = validate_claims([good, bad, "not-a-dict"], [item("ev-aaaa"), item("ev-bbbb")],
                             organization_id=ORG, store_ids=STORES)
    assert "claim_not_an_object" in errors
    # The good calculated claim passes even though 'ev-bbbb' is known.
    assert "calculated_observation_without_calculation" not in errors


def test_decimal_value_round_trips_through_money_fact():
    claim = build_fact_claim(money_fact(value=Decimal("30.31")), organization_id=ORG,
                             store_ids=STORES, investigation_id=INVEST, item=item())
    assert validate_claim(claim, known_evidence={"ev-aaaa": item()},
                          organization_id=ORG, store_ids=STORES) == []
