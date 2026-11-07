"""Task 210: unit tests for the response adaptation keystone.

Covers the consolidated acceptance matrix at the unit level:
adaptive structure (1–12), confidence integrity (13–22), conversation
follow-ups (29–36) and contract invariants (no fabricated numbers,
coverage ≠ confidence, closed vocabularies, stable ordering).

Integration through the real pipeline lives in
``test_rev_adaptive_response.py``.
"""
import json
import re

import pytest

from src.intelligence.response_adaptation import (
    ADAPTATION_CONTRACT_VERSION,
    CONFIDENCE_CATEGORIES,
    COMPLEXITIES,
    EXPLANATION_DEPTHS,
    RESPONSE_ELEMENTS,
    RESPONSE_INTENTS,
    classify_response_profile,
    confidence_language,
    compose_ordinal_explanation,
    compose_simplification,
    compose_verification,
    coverage_summary,
    derive_claim_confidence,
    response_confidence_category,
    resolve_meta_followup,
    select_elements,
)

# ── helpers ──────────────────────────────────────────────────────────────────

def item(sufficiency, *reasons):
    return {"quality": {"sufficiency": sufficiency, "reasons": list(reasons)}}


def verified_fact(*evidence_ids):
    return {"classification": "verified_fact", "evidence_ids": list(evidence_ids)}


def calculation_claim(current_id, previous_id):
    return {
        "classification": "calculated_observation",
        "evidence_ids": [current_id],
        "calculation": {
            "inputs": [
                {"role": "current", "evidence_id": current_id, "value": "10"},
                {"role": "previous", "evidence_id": previous_id, "value": "8"},
            ],
        },
    }


def hypothesis(*evidence_ids):
    return {"classification": "hypothesis", "evidence_ids": list(evidence_ids)}


def unknown():
    return {"classification": "unknown", "evidence_ids": []}


def items(*specs):
    """specs: (id, sufficiency, reasons...) tuples."""
    return {spec[0]: item(spec[1], *spec[2:]) for spec in specs}


def recorded_claim(value=42, unit="orders", category="high", text="You recorded 42 orders",
                   classification="verified_fact", limitations=None):
    return {
        "claim_id": "clm-test-1",
        "contract_version": "rev-claim-v1",
        "classification": classification,
        "value": value, "unit": unit, "currency": None,
        "text": text,
        "period": {"label": "yesterday", "start": "2026-11-01", "end": "2026-11-02",
                   "timezone": "UTC"},
        "confidence": {"category": category, "basis": [],
                       "limitations": limitations or []},
        "organization_id": "org-a",
    }


# ── confidence integrity (matrix 13–22) ─────────────────────────────────────

class TestClaimConfidenceDerivation:
    def test_complete_comparable_data_is_high(self):
        # 13: complete, comparable, fresh data → high, no filler.
        result = derive_claim_confidence(verified_fact("ev-1"),
                                         items(("ev-1", "sufficient")))
        assert result["category"] == "high"
        assert result["basis"] == []
        assert result["limitations"] == []

    def test_partial_coverage_caps_at_moderate(self):
        # 14: partial coverage → moderate, with the limitation named.
        result = derive_claim_confidence(verified_fact("ev-1"),
                                         items(("ev-1", "partial", "partial_coverage")))
        assert result["category"] == "moderate"
        assert "partial_coverage" in result["basis"]
        assert any("missing from the source" in p for p in result["limitations"])

    def test_stale_data_caps_at_limited_and_says_so(self):
        # 15: stale source → limited, and the communication names the age.
        result = derive_claim_confidence(
            verified_fact("ev-1"),
            items(("ev-1", "partial", "stale_for_current_claim")))
        assert result["category"] == "limited"
        assert any("sync" in p for p in result["limitations"])

    def test_conflicting_sources_cap_at_limited(self):
        # 16: conflicting evidence → limited, never high.
        result = derive_claim_confidence(
            verified_fact("ev-1"),
            items(("ev-1", "partial", "conflicting_evidence")))
        assert result["category"] == "limited"

    def test_unavailable_source_is_insufficient_not_low_confidence(self):
        # 17: missing data → insufficient ("cannot determine"), never a
        # low-confidence certainty.
        result = derive_claim_confidence(
            verified_fact("ev-1"),
            items(("ev-1", "unavailable", "source_unavailable")))
        assert result["category"] == "insufficient"

    def test_mixed_currencies_make_a_comparison_insufficient(self):
        # 18: non-comparable currencies on a comparison input → insufficient.
        result = derive_claim_confidence(
            calculation_claim("ev-1", "ev-2"),
            items(("ev-1", "sufficient"),
                  ("ev-2", "partial", "mixed_currencies_not_comparable")))
        assert result["category"] == "insufficient"

    def test_hypothesis_is_never_high(self):
        # 19: a hypothesis stays a hypothesis — capped at limited even with
        # perfect evidence.
        result = derive_claim_confidence(hypothesis("ev-1"),
                                         items(("ev-1", "sufficient")))
        assert result["category"] == "limited"
        assert "hypothesis_unverified" in result["basis"]

    def test_unknown_claim_is_insufficient(self):
        result = derive_claim_confidence(unknown(), {})
        assert result["category"] == "insufficient"

    def test_claim_specific_categories_diverge_in_one_response(self):
        # 20: two claims, two categories — the derivation is per-claim.
        ev = items(("ev-1", "sufficient"),
                   ("ev-2", "partial", "stale_for_current_claim"))
        strong = derive_claim_confidence(verified_fact("ev-1"), ev)
        weak = derive_claim_confidence(verified_fact("ev-2"), ev)
        assert strong["category"] == "high"
        assert weak["category"] == "limited"
        assert strong["category"] != weak["category"]

    def test_calculation_claim_uses_both_period_inputs(self):
        # 21: a calculated observation stands on BOTH cited records.
        ok = derive_claim_confidence(
            calculation_claim("ev-1", "ev-2"),
            items(("ev-1", "sufficient"), ("ev-2", "sufficient")))
        degraded = derive_claim_confidence(
            calculation_claim("ev-1", "ev-2"),
            items(("ev-1", "sufficient"), ("ev-2", "partial", "partial_coverage")))
        missing = derive_claim_confidence(
            calculation_claim("ev-1", "ev-2"), {"ev-1": item("sufficient")})
        assert ok["category"] == "high"
        assert degraded["category"] == "moderate"
        assert missing["category"] == "insufficient"
        assert "evidence_reference_missing" in missing["basis"]

    def test_no_number_is_ever_emitted(self):
        # 22: categories only. No step may produce a numeric confidence.
        probe = {
            "classification": "calculated_observation",
            "evidence_ids": ["ev-1", "ev-2"],
            "calculation": {"inputs": [
                {"role": "current", "evidence_id": "ev-1", "value": "12.5"},
                {"role": "previous", "evidence_id": "ev-2", "value": "40"}]},
        }
        result = derive_claim_confidence(
            probe, items(("ev-1", "partial", "partial_coverage",
                          "conflicting_evidence"),
                         ("ev-2", "partial", "stale_for_current_claim")))
        for key, value in result.items():
            assert not (isinstance(value, (int, float)) and not isinstance(value, bool)), \
                f"numeric value in confidence output: {key}"
        assert result["category"] in CONFIDENCE_CATEGORIES
        assert not re.search(r"\d+(\.\d+)?\s*%", json.dumps(result))

    def test_unrecognised_grade_fails_closed(self):
        result = derive_claim_confidence(
            {"classification": "bogus_grade", "evidence_ids": ["ev-1"]},
            items(("ev-1", "sufficient")))
        assert result["category"] == "insufficient"


class TestResponseCategory:
    def test_response_category_is_worst_load_bearing_claim(self):
        claims = [
            {**recorded_claim(category="high"), "claim_id": "clm-1"},
            {**recorded_claim(category="limited"), "claim_id": "clm-2"},
        ]
        assert response_confidence_category(claims) == "limited"

    def test_unknown_claims_do_not_drag_a_claim_backed_answer(self):
        claims = [
            {**recorded_claim(category="high"), "claim_id": "clm-1"},
            {"classification": "unknown", "evidence_ids": [],
             "confidence": {"category": "insufficient", "basis": [],
                            "limitations": []}, "claim_id": "clm-u"},
        ]
        assert response_confidence_category(claims) == "high"

    def test_no_answer_claim_with_evidence_falls_back_to_items(self):
        # Claim-less direct verification: the evidence sufficiency carries it.
        items_by_id = items(("ev-1", "sufficient"), ("ev-2", "sufficient"))
        assert response_confidence_category([], items_by_id) == "high"
        degraded = items(("ev-1", "partial", "partial_coverage"))
        assert response_confidence_category([], degraded) == "moderate"

    def test_no_claims_no_items_is_insufficient(self):
        assert response_confidence_category([], {}) == "insufficient"
        assert response_confidence_category([]) == "insufficient"


# ── adaptive structure (matrix 1–12) ────────────────────────────────────────

class TestResponseProfileClassification:
    def test_casual_is_a(self):
        for intent in ("greeting", "social", "identity", "capability",
                       "knowledge", "general"):
            profile = classify_response_profile(intent=intent, message="hi there")
            assert profile["response_intent"] == "casual_conversation"
            assert profile["complexity"] == "simple"
            assert profile["confidence_communication"] == "implicit"

    def test_direct_factual_is_b(self):
        profile = classify_response_profile(
            intent="revenue_investigation",
            message="How many orders did I get yesterday?")
        assert profile["response_intent"] == "direct_factual"
        assert profile["explanation_depth"] == "concise"

    def test_explanation_is_c(self):
        profile = classify_response_profile(
            intent="revenue_investigation", message="Why did my revenue drop?")
        assert profile["response_intent"] == "explanation"

    def test_comparative_is_d(self):
        profile = classify_response_profile(
            intent="revenue_investigation",
            message="How did this week compare with last week?",
            has_comparison=True)
        assert profile["response_intent"] == "comparative"

    def test_investigation_is_e(self):
        profile = classify_response_profile(
            intent="checkout_investigation",
            message="What is going on with my checkouts?")
        assert profile["response_intent"] == "investigation"

    def test_multi_domain_is_f(self):
        profile = classify_response_profile(
            intent="store_overview", message="How is my store doing?",
            domains=["revenue", "products"])
        assert profile["response_intent"] == "multi_domain"
        assert profile["complexity"] == "complex"
        assert profile["explanation_depth"] == "detailed"

    def test_recommendation_is_g(self):
        profile = classify_response_profile(
            intent="finding_investigation", message="What should I fix first?",
            is_priority_question=True)
        assert profile["response_intent"] == "recommendation"

    def test_clarification_is_h(self):
        profile = classify_response_profile(
            intent="clarify", message="Which store are you asking about?")
        assert profile["response_intent"] == "clarification"
        assert profile["clarification_required"] is True

    def test_profile_uses_closed_vocabulary(self):
        profile = classify_response_profile(
            intent="store_overview", message="How is my store doing?")
        assert profile["contract_version"] == ADAPTATION_CONTRACT_VERSION
        assert profile["response_intent"] in RESPONSE_INTENTS
        assert profile["complexity"] in COMPLEXITIES
        assert profile["explanation_depth"] in EXPLANATION_DEPTHS
        assert isinstance(profile["recommendation_appropriate"], bool)
        assert isinstance(profile["clarification_required"], bool)
        assert profile["confidence_communication"] in (
            "implicit", "inline", "explicit")

    def test_degraded_status_forces_concise_depth(self):
        profile = classify_response_profile(
            intent="store_overview", message="How is my store doing?",
            status="insufficient_data")
        assert profile["explanation_depth"] == "concise"

    def test_invalid_override_raises(self):
        with pytest.raises(ValueError):
            classify_response_profile(intent="general", response_intent="bogus")
        with pytest.raises(ValueError):
            classify_response_profile(intent="general", explanation_depth="verbose")

    def test_coverage_question_is_direct(self):
        profile = classify_response_profile(
            intent="data_coverage", message="Is my store connected?")
        assert profile["response_intent"] == "direct_factual"


class TestElementSelection:
    def test_casual_gets_no_sections(self):
        # 1: a greeting never gets report scaffolding.
        profile = classify_response_profile(intent="greeting", message="hi")
        elements = select_elements(profile, has_facts=True, has_evidence=True)
        assert elements == []

    def test_direct_question_gets_only_what_answers_it(self):
        # 2: direct answer + evidence, no situation/insight/implication.
        profile = classify_response_profile(
            intent="revenue_investigation",
            message="How many orders did I get yesterday?",
            claim_categories=["high"])
        elements = select_elements(profile, has_facts=True, has_evidence=True,
                                   has_hypotheses=True)
        assert elements == ["direct_answer", "evidence"]

    def test_empty_elements_are_never_selected(self):
        # 3: an element with no content is omitted.
        profile = classify_response_profile(
            intent="checkout_investigation", message="What is going on?")
        elements = select_elements(profile, has_facts=True, has_evidence=True,
                                   has_hypotheses=False, has_recommendations=True,
                                   has_unknowns=False)
        assert "implication" not in elements
        assert "recommendation" in elements
        assert "unknowns" not in elements

    def test_clarification_leads_with_the_question_and_the_gap(self):
        # 4: clarification keeps the question, the gap and the next step,
        # and leads with the question.
        profile = classify_response_profile(
            intent="clarify", message="Which store?")
        elements = select_elements(profile, has_unknowns=True,
                                   insufficient_next_step="Connect the store.")
        assert elements == ["direct_answer", "confidence", "unknowns",
                            "suggested_investigation"]

    def test_comparison_keeps_the_period_comparison_element(self):
        # 5: a comparison keeps the period-comparison element in order.
        profile = classify_response_profile(
            intent="revenue_investigation", message="Compared with last week?",
            has_comparison=True, claim_categories=["high"])
        elements = select_elements(profile, has_facts=True, has_comparison=True,
                                   has_evidence=True)
        assert "period_comparison" in elements
        assert elements.index("period_comparison") < elements.index("evidence")

    def test_insufficient_leads_with_limitation_and_next_step(self):
        # 6: the degraded answer leads with what is missing and the smallest
        # useful next step — and never a speculative conclusion.
        profile = classify_response_profile(
            intent="revenue_investigation", message="Why did revenue drop?",
            status="insufficient_data", claim_categories=["insufficient"])
        elements = select_elements(profile, has_evidence=False,
                                   insufficient_next_step="Connect Shopify.")
        assert elements[0] in ("direct_answer", "confidence")
        assert "confidence" in elements
        assert "suggested_investigation" in elements
        assert "recommendation" not in elements
        assert "implication" not in elements

    def test_recommendation_only_when_appropriate(self):
        # 7/8: recommendation appears only when the intent allows it and a
        # recommendation exists.
        profile = classify_response_profile(
            intent="revenue_investigation",
            message="How many orders did I get yesterday?",
            claim_categories=["high"])
        elements = select_elements(profile, has_facts=True, has_evidence=True,
                                   has_recommendations=True,
                                   recommendation_appropriate=False)
        assert "recommendation" not in elements

    def test_confidence_element_follows_the_communication_requirement(self):
        # 9: implicit → no confidence element; inline/explicit → present.
        implicit = classify_response_profile(
            intent="revenue_investigation",
            message="How many orders did I get yesterday?",
            claim_categories=["high"])
        assert "confidence" not in select_elements(
            implicit, has_facts=True, has_evidence=True)
        inline = classify_response_profile(
            intent="revenue_investigation",
            message="How many orders did I get yesterday?",
            claim_categories=["moderate"])
        assert "confidence" in select_elements(
            inline, has_facts=True, has_evidence=True)

    def test_elements_are_ordered_and_stable(self):
        # 10: the same inputs always produce the same ordered element list.
        profile = classify_response_profile(
            intent="store_overview", message="How is my store doing?",
            domains=["revenue", "products"])
        kwargs = dict(has_facts=True, has_comparison=True, has_evidence=True,
                      has_hypotheses=True, has_recommendations=True,
                      has_unknowns=True, has_limitations=True,
                      has_follow_ups=True)
        first = select_elements(profile, **kwargs)
        second = select_elements(profile, **kwargs)
        assert first == second
        assert all(e in RESPONSE_ELEMENTS for e in first)
        # canonical order: evidence before recommendation, follow-up last
        assert first.index("evidence") < first.index("recommendation")
        if "follow_up" in first:
            assert first.index("follow_up") == len(first) - 1

    def test_explanation_carries_situation_and_insight(self):
        # 11: an explanation keeps situation/insight when it has facts.
        profile = classify_response_profile(
            intent="revenue_investigation", message="Why did my revenue drop?",
            claim_categories=["high", "moderate"])
        elements = select_elements(profile, has_facts=True, has_evidence=True)
        assert "situation" in elements
        assert "insight" in elements or "confidence" in elements

    def test_simple_question_never_gets_the_full_report_skeleton(self):
        # 12: B-profile with one fact — at most a handful of elements, never
        # the full S/I/I/R investigation skeleton.
        profile = classify_response_profile(
            intent="revenue_investigation",
            message="How many orders did I get yesterday?",
            claim_categories=["high"])
        elements = select_elements(profile, has_facts=True, has_evidence=True)
        assert len(elements) <= 3
        for element in ("situation", "implication", "alternatives",
                        "suggested_investigation"):
            assert element not in elements


# ── coverage ≠ confidence (5.D) ─────────────────────────────────────────────

class TestCoverageSummary:
    def test_complete_fresh_single_currency(self):
        cov = coverage_summary([
            {"quality": {"coverage": "complete", "freshness": "fresh",
                         "currency_integrity": "single_verified_currency"}},
        ], window={"label": "yesterday", "timezone": "UTC"})
        assert cov["coverage"] == "complete"
        assert cov["freshness"] == "fresh"
        assert cov["currency_comparable"] is True
        assert cov["limits"] == []
        assert cov["window"]["label"] == "yesterday"

    def test_partial_coverage_is_reported_not_conflated(self):
        cov = coverage_summary([
            {"quality": {"coverage": "partial", "freshness": "fresh",
                         "currency_integrity": "single_verified_currency"}},
        ])
        assert cov["coverage"] == "partial"
        assert any("missing" in limit for limit in cov["limits"])

    def test_mixed_currencies_break_comparability(self):
        cov = coverage_summary([
            {"quality": {"coverage": "complete", "freshness": "fresh",
                         "currency_integrity": "mixed_not_comparable"}},
        ])
        assert cov["currency_comparable"] is False

    def test_no_items_is_no_data(self):
        cov = coverage_summary([], window={"label": "yesterday"})
        assert cov["coverage"] == "no_data"

    def test_certified_only_when_recorded(self):
        cov = coverage_summary([
            {"quality": {"coverage": "complete", "freshness": "fresh",
                         "currency_integrity": "single_verified_currency"},
             "metric": "certified_store_count", "value": 1},
        ])
        assert cov["certified"] is True
        un = coverage_summary([
            {"quality": {"coverage": "complete", "freshness": "fresh",
                         "currency_integrity": "single_verified_currency"},
             "metric": "certified_store_count", "value": 0},
        ])
        assert un["certified"] is False


# ── natural-language confidence communication (239) ─────────────────────────

class TestConfidenceLanguage:
    def test_high_is_a_plain_statement(self):
        text = confidence_language("high")
        assert "confident" in text.lower()

    def test_every_category_is_a_sentence_without_percentages(self):
        for category in CONFIDENCE_CATEGORIES:
            text = confidence_language(category,
                                       ["Some records are missing."],
                                       next_step="Connect the store.")
            assert text.strip()
            assert not re.search(r"\d+(\.\d+)?\s*%", text), f"percentage in {category}: {text}"
            assert "TODO" not in text and "placeholder" not in text.lower()

    def test_insufficient_is_cannot_determine_not_low_confidence(self):
        text = confidence_language("insufficient",
                                   ["The source did not answer."],
                                   next_step="I can retry once it syncs.")
        assert "can't determine" in text.lower() or "cannot determine" in text.lower()

    def test_no_filler_disclaimers(self):
        for category in CONFIDENCE_CATEGORIES:
            text = confidence_language(category, [])
            assert "as an ai" not in text.lower()
            assert "please note" not in text.lower()
            assert "just to be clear" not in text.lower()


# ── meta follow-ups (matrix 29–36) ──────────────────────────────────────────

TWO_CLAIMS = [
    {**recorded_claim(value=42, unit="orders", text="You recorded 42 orders"),
     "claim_id": "clm-1"},
    {**recorded_claim(value="12.5", unit="percent",
                      text="Refund rate rose to 12.5%", category="moderate",
                      limitations=["Some records for this period are missing from the source."]),
     "claim_id": "clm-2"},
]


class TestMetaFollowupResolution:
    def test_ordinal_reference_resolves_to_the_recorded_claim(self):
        # 29: "explain the second point" resolves to claim #2, not a new pull.
        resolved = resolve_meta_followup("Can you explain the second point?",
                                         TWO_CLAIMS)
        assert resolved["kind"] == "ordinal_reference"
        assert resolved["ordinal"] == 2
        assert resolved["claim"]["claim_id"] == "clm-2"

    def test_ordinal_beyond_the_recorded_set_does_not_hallucinate(self):
        resolved = resolve_meta_followup("explain the fourth point", TWO_CLAIMS)
        assert resolved is None

    def test_simplification_request(self):
        # 32: "make it simpler" resolves without a new investigation.
        for phrase in ("make it simpler", "in simpler terms", "break it down",
                       "that was too technical"):
            resolved = resolve_meta_followup(phrase, TWO_CLAIMS)
            assert resolved is not None, phrase
            assert resolved["kind"] == "simplification"

    def test_verification_request(self):
        # 31: "are you sure?" resolves as verification, not as a correction.
        for phrase in ("Are you sure?", "double-check that",
                       "is that really right?"):
            resolved = resolve_meta_followup(phrase, TWO_CLAIMS)
            assert resolved is not None, phrase
            assert resolved["kind"] == "verification"

    def test_no_recorded_claims_never_fabricates_a_reference(self):
        # 30: with no previous claim set, the follow-up routes normally.
        for phrase in ("explain the second point", "make it simpler",
                       "are you sure?"):
            assert resolve_meta_followup(phrase, []) is None
            assert resolve_meta_followup(phrase, None) is None

    def test_explicit_correction_never_resolves_here(self):
        # A challenged figure goes to the correction handler, not verification.
        assert resolve_meta_followup("Are you sure? That's wrong.", TWO_CLAIMS,
                                     matches_correction=True) is None
        assert resolve_meta_followup("that is a wrong number", TWO_CLAIMS,
                                     matches_correction=True) is None

    def test_plain_business_question_is_not_a_meta_followup(self):
        assert resolve_meta_followup("how many orders did I get yesterday?",
                                     TWO_CLAIMS) is None


class TestMetaFollowupComposition:
    def test_ordinal_explanation_keeps_value_grade_and_confidence(self):
        text = compose_ordinal_explanation(TWO_CLAIMS[1], 2)
        assert "second" in text
        assert "12.5" in text
        assert "Refund rate rose" in text
        assert "possible cause, not an established one" not in text  # not a hypothesis
        assert "verified figure" in text

    def test_simplification_keeps_the_figures_and_says_so(self):
        text = compose_simplification(TWO_CLAIMS, window={"label": "yesterday"})
        assert "simpler" in text.lower()
        assert "42" in text and "12.5" in text
        assert "unchanged" in text.lower() or "not re-estimating" in text.lower()

    def test_simplification_of_hypothesis_keeps_its_label(self):
        hyp = [{**TWO_CLAIMS[0], "classification": "hypothesis",
                "confidence": {"category": "limited", "basis": [],
                               "limitations": []}}]
        text = compose_simplification(hyp, window={"label": "yesterday"})
        assert "possible cause, not proven" in text

    def test_verification_states_the_standing_per_claim(self):
        text = compose_verification(TWO_CLAIMS, window={"label": "yesterday"})
        assert "42" in text and "12.5" in text
        # the weak claim's standing must be visible
        assert "limitation" in text.lower() or "missing" in text.lower()

    def test_verification_with_a_weak_claim_offers_reinvestigation(self):
        limited = {**TWO_CLAIMS[1],
                   "confidence": {"category": "limited", "basis": ["staleness_penalty"],
                                  "limitations": [
                                      "This data is from the last successful sync and may be behind."]}}
        text = compose_verification([limited], window={"label": "yesterday"})
        assert "re-investigate" in text

    def test_verification_of_strong_claims_does_not_apologise(self):
        text = compose_verification([TWO_CLAIMS[0]], window={"label": "yesterday"})
        assert "re-investigate" not in text
        assert "confident" in text.lower()
