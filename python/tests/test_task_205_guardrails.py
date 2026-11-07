"""Task 205 adversarial causal/action/recoverable-revenue acceptance tests."""
from copy import deepcopy

import pytest

from src.agents.investigation import run_investigation
from src.intelligence.claim_guardrails import (
    direct_action_or_recovery_answer,
    narrative_guardrail_errors,
    validate_response_guardrails,
)
from python.tests.test_rev_investigation import NOW, ORG, USER, workspace_db


def response():
    period = {"start": "2026-10-25T00:00:00Z", "end": "2026-11-01T00:00:00Z"}
    item = {
        "id": "ev-1", "metric": "recorded_order_value", "status": "available",
        "quality_eligible": True, "currency": "USD", "period": deepcopy(period),
        "measurement": {"interpretation": "recorded_observed"},
    }
    return {
        "text": "Recorded order value was USD 10.00. Its cause is unknown.",
        "evidence": {"items": [item], "comparison_items": []},
        "facts": [{"text": "Recorded order value USD 10.00", "metric": "recorded_order_value",
                   "evidence_ids": ["ev-1"], "currency": "USD", "period": period,
                   "causal_status": "observed"}],
        "comparison_facts": [], "year_over_year_facts": [], "hypotheses": [],
        "recommendations": [],
    }


def test_observation_comparison_association_hypothesis_unknown_remain_distinct():
    value = response()
    validate_response_guardrails(value)
    value["facts"][0]["causal_status"] = "statistical_association"
    value["facts"][0]["text"] = "Recorded order value is associated with the comparison period"
    validate_response_guardrails(value)
    value["facts"] = []
    value["hypotheses"] = [{"statement": "Inventory is a possible contributor; no causal evidence is established.",
                            "status": "hypothesis", "causal_status": "hypothesis",
                            "basis_evidence_ids": ["ev-1"]}]
    validate_response_guardrails(value)


@pytest.mark.parametrize("statement", [
    "Low inventory caused the revenue decline.",
    "Revenue fell because of low inventory.",
    "The discount led to lower revenue.",
    "The result is attributable to checkout friction.",
    "Revenue fell after the update, so the update drove the decline.",
])
def test_unsupported_causal_language_is_rejected(statement):
    assert "unsupported_causal_language" in narrative_guardrail_errors(statement)
    value = response()
    value["text"] = statement + " [1]"
    with pytest.raises(ValueError, match="unsupported_causal_language"):
        validate_response_guardrails(value)


def test_citation_does_not_turn_an_observation_into_verified_causation():
    value = response()
    value["facts"][0].update({
        "text": "Low inventory caused the revenue decline", "causal_status": "verified_causal",
        "causal_methodology": {"design": "before_after"},
    })
    with pytest.raises(ValueError) as error:
        validate_response_guardrails(value)
    assert "verified_causal_methodology_required" in str(error.value)
    assert "unsupported_causal_language" in str(error.value)


@pytest.mark.parametrize("statement", [
    "Revluma can recover USD 10,000.",
    "You lost USD 4,000 from this stockout.",
    "This preventable revenue loss is USD 900.",
    "We guarantee USD 500 in recovered revenue.",
    "You saved USD 200 after the recommendation.",
])
def test_unsupported_financial_impact_is_rejected(statement):
    assert "unsupported_financial_impact_language" in narrative_guardrail_errors(statement)


@pytest.mark.parametrize("statement", [
    "I updated the product and fixed the issue.",
    "We have executed the recommendation.",
    "Your settings have been changed.",
    "I’ve successfully updated the product.",
    "The price was updated by me.",
    "The problem is resolved.",
    "Revluma recovered the abandoned carts.",
])
def test_generated_execution_and_outcomes_are_rejected(statement):
    assert "generated_action_or_outcome_claim" in narrative_guardrail_errors(statement)


def test_recoverable_evidence_requires_eligible_versioned_attribution_methodology():
    value = response()
    value["evidence"]["items"][0]["measurement"]["interpretation"] = "recoverable"
    with pytest.raises(ValueError, match="financial_impact_record_required"):
        validate_response_guardrails(value)
    value["evidence"]["items"][0]["financial_impact"] = {
        "methodology_id": "before-after", "methodology_version": "1", "inputs": {},
        "coverage": {}, "assumptions": [], "limitations": [], "eligible": False,
        "independent_attribution_verified": False,
    }
    with pytest.raises(ValueError) as error:
        validate_response_guardrails(value)
    assert "financial_impact_not_eligible" in str(error.value)


def test_every_material_fact_requires_relevant_eligible_period_and_currency_matched_evidence():
    for mutation in (
        lambda value: value["evidence"]["items"][0].update(metric="inventory_units"),
        lambda value: value["evidence"]["items"][0].update(quality_eligible=False),
        lambda value: value["evidence"]["items"][0].update(currency="NGN"),
        lambda value: value["evidence"]["items"][0]["period"].update(start="2025-01-01T00:00:00Z"),
        lambda value: value["facts"][0].update(evidence_ids=["ev-forged"]),
    ):
        value = response()
        mutation(value)
        with pytest.raises(ValueError, match="material_claim_"):
            validate_response_guardrails(value)


def test_numeric_citation_must_resolve_to_returned_source_reference():
    value = response()
    value["text"] += " [1]"
    with pytest.raises(ValueError, match="unresolved_citation_reference"):
        validate_response_guardrails(value)
    value["evidence"]["items"][0]["source"] = {"references": ["shopify:orders:123"]}
    validate_response_guardrails(value)


def test_canonical_claims_are_also_checked_without_revalidating_unknowns_or_restatements():
    value = response()
    canonical = deepcopy(value["facts"][0])
    canonical.update({"classification": "verified_fact", "causal_status": "observed"})
    value["claims"] = [canonical]
    validate_response_guardrails(value)
    canonical["financial_impact"] = "recoverable"
    with pytest.raises(ValueError, match="canonical_financial_impact_not_eligible"):
        validate_response_guardrails(value)
    canonical["financial_impact"] = None
    canonical["metric"] = "inventory_units"
    with pytest.raises(ValueError, match="material_claim_irrelevant"):
        validate_response_guardrails(value)
    value["claims"] = [{"classification": "unknown", "causal_status": "unknown",
                        "text": "The operational cause is unknown.", "evidence_ids": []}]
    validate_response_guardrails(value)
    value["claims"] = [{"classification": "verified_fact", "causal_status": "observed",
                        "restated": True, "text": "The prior recorded value was USD 10.00.",
                        "evidence_ids": ["ev-original-not-in-this-response"]}]
    validate_response_guardrails(value)


def test_action_state_contract_rejects_merchant_confirmation_as_execution_or_verification():
    value = response()
    value["recommendations"] = [{
        "action_state": "executed", "executed": True, "execution_status": "executed",
        "merchant_confirmation": "merchant_confirmed", "independent_verification": "verified",
        "execution_actor": "rev", "executed_at": "2026-11-01T00:00:00Z",
    }]
    with pytest.raises(ValueError) as error:
        validate_response_guardrails(value)
    assert "generated_state_not_authoritative" in str(error.value)
    assert "merchant_confirmation_not_authoritative" in str(error.value)


@pytest.mark.parametrize("question, expected", [
    ("Have you fixed the issue?", "read-only"),
    ("I already updated the product. Is it fixed now?", "not as independent verification"),
    ("How much revenue did we recover?", "No independently verified recovered revenue"),
    ("How much money can Revluma recover?", "No recoverable amount is established"),
])
def test_real_conversation_paths_answer_without_invented_actions_or_recovery(question, expected):
    answer = direct_action_or_recovery_answer(question)
    assert answer and expected in answer
    assert not narrative_guardrail_errors(answer)


def test_real_investigation_low_inventory_question_does_not_assert_causation():
    result = run_investigation(ORG, USER, "Did low inventory cause my revenue to drop this week?",
                               db=workspace_db(), now=NOW, persist=False)
    assert result["read_only"] is True
    assert not narrative_guardrail_errors(result["text"])
    assert all(item["causal_status"] == "hypothesis" for item in result["hypotheses"])
    assert all(item["action_state"] == "recommended" for item in result["recommendations"])


def test_real_followup_merchant_action_report_is_not_verified_or_executed():
    db = workspace_db()
    result = run_investigation(ORG, USER, "I already updated the product. Is it fixed now?",
                               db=db, now=NOW, persist=False)
    assert "not as independent verification" in result["text"]
    assert result["read_only"] is True
    assert not result.get("executed_actions")
    assert not narrative_guardrail_errors(result["text"])
