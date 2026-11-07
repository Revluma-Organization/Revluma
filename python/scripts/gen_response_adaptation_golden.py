"""Generate golden outputs from the Python response-adaptation keystone.

Run:  python scripts/gen_response_adaptation_golden.py
Writes Backend/src/services/__tests__/revResponseAdaptation.golden.json so
the Node mirror (revResponseAdaptation.js) can be asserted against identical
expected values: method D1 claim confidence, the response-level category,
the separate coverage representation, the deterministic A-H profile
classifier and the ordered element selection.
Deterministic inputs only — every evidence item carries its recorded quality
block, so no clock is involved.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.intelligence import response_adaptation as ra  # noqa: E402

# ── evidence items (recorded quality blocks keep this clock-free) ────────────
def qitem(id_, quality, metric="net_revenue", value="100.00"):
    return {
        "id": id_, "metric": metric, "status": "available", "unit": "currency",
        "currency": "USD", "value": value,
        "quality": quality,
    }

def qsuff(sufficiency, reasons):
    return {"sufficiency": sufficiency, "reasons": list(reasons),
            "coverage": "complete", "freshness": "fresh",
            "currency_integrity": "comparable", "note": "n"}

ITEMS = {
    "ev-high": qitem("ev-high", qsuff("sufficient", [])),
    "ev-partial": qitem("ev-partial", qsuff("partial", ["partial_coverage"])),
    "ev-stale": qitem("ev-stale", qsuff("insufficient", ["stale_for_current_claim"])),
    "ev-conflict": qitem("ev-conflict", qsuff("partial", ["conflicting_evidence"])),
    "ev-mixed": qitem("ev-mixed", qsuff("partial", ["mixed_currencies_not_comparable"])),
    "ev-unavail": qitem("ev-unavail", qsuff("unavailable", ["source_retrieval_failed"])),
    "ev-cov-unknown": qitem("ev-cov-unknown", qsuff("partial", ["coverage_unknown"])),
    "ev-never": qitem("ev-never", qsuff("insufficient", ["never_synchronized_for_current_claim"])),
}

# ── 1. method D1: per-claim confidence ──────────────────────────────────────
def claim(classification, evidence_ids=None, calculation=None, confidence=None,
          claim_id="clm-1"):
    c = {
        "claim_id": claim_id,
        "classification": classification,
        "text": "Revenue was NGN 1,000,000.00.",
        "value": "100.00",
        "value_kind": "money",
        "evidence_ids": list(evidence_ids or []),
    }
    if calculation is not None:
        c["calculation"] = calculation
    if confidence is not None:
        c["confidence"] = confidence
    return c

CLAIM_CASES = {
    "verified_fact_sufficient": (
        claim("verified_fact", ["ev-high"]),
        {"ev-high": ITEMS["ev-high"]},
    ),
    "verified_fact_partial_coverage": (
        claim("verified_fact", ["ev-partial"]),
        {"ev-partial": ITEMS["ev-partial"]},
    ),
    "verified_fact_stale": (
        claim("verified_fact", ["ev-stale"]),
        {"ev-stale": ITEMS["ev-stale"]},
    ),
    "verified_fact_conflicting": (
        claim("verified_fact", ["ev-conflict"]),
        {"ev-conflict": ITEMS["ev-conflict"]},
    ),
    "verified_fact_mixed_currency": (
        claim("verified_fact", ["ev-mixed"]),
        {"ev-mixed": ITEMS["ev-mixed"]},
    ),
    "verified_fact_unavailable": (
        claim("verified_fact", ["ev-unavail"]),
        {"ev-unavail": ITEMS["ev-unavail"]},
    ),
    "verified_fact_worst_of_two": (
        claim("verified_fact", ["ev-high", "ev-stale"]),
        {"ev-high": ITEMS["ev-high"], "ev-stale": ITEMS["ev-stale"]},
    ),
    "verified_fact_cited_id_missing": (
        claim("verified_fact", ["ev-missing"]),
        {"ev-high": ITEMS["ev-high"]},
    ),
    "verified_fact_no_evidence": (
        claim("verified_fact", []),
        {"ev-high": ITEMS["ev-high"]},
    ),
    "verified_fact_coverage_unknown": (
        claim("verified_fact", ["ev-cov-unknown"]),
        {"ev-cov-unknown": ITEMS["ev-cov-unknown"]},
    ),
    "calculated_observation_both_inputs": (
        claim("calculated_observation", [],
              calculation={"inputs": [
                  {"evidence_id": "ev-high", "period": "current"},
                  {"evidence_id": "ev-stale", "period": "previous"},
              ]}),
        {"ev-high": ITEMS["ev-high"], "ev-stale": ITEMS["ev-stale"]},
    ),
    "hypothesis_sufficient_capped": (
        claim("hypothesis", ["ev-high"]),
        {"ev-high": ITEMS["ev-high"]},
    ),
    "hypothesis_unavailable": (
        claim("hypothesis", ["ev-unavail"]),
        {"ev-unavail": ITEMS["ev-unavail"]},
    ),
    "unknown_grade": (
        claim("unknown", []),
        {"ev-high": ITEMS["ev-high"]},
    ),
    "unrecognised_grade_fails_closed": (
        claim("bogus_grade", ["ev-high"]),
        {"ev-high": ITEMS["ev-high"]},
    ),
}

claim_confidence = {
    name: ra.derive_claim_confidence(claim, items)
    for name, (claim, items) in CLAIM_CASES.items()
}

# ── 2. response-level category (worst answer-bearing claim / fallback) ──────
def rec(category, grade="verified_fact", claim_id="clm-x"):
    return claim(grade, [], confidence={
        "category": category, "basis": [], "limitations": []}, claim_id=claim_id)

RESPONSE_CATEGORY_CASES = {
    "worst_of_answer_bearing": (
        [rec("high", "verified_fact", "clm-a"),
         rec("moderate", "calculated_observation", "clm-b"),
         rec("high", "hypothesis", "clm-c")],
        None, "moderate",
    ),
    "unknown_claims_do_not_drag": (
        [rec("high", "verified_fact", "clm-a"),
         rec("insufficient", "unknown", "clm-b")],
        None, "high",
    ),
    "claimless_with_items_uses_sufficiency": (
        [], {"ev-partial": ITEMS["ev-partial"]}, "moderate",
    ),
    "claimless_with_no_items_insufficient": (
        [], None, "insufficient",
    ),
    "bogus_recorded_category_ignored": (
        [rec("nonsense", "verified_fact", "clm-a")],
        {"ev-high": ITEMS["ev-high"]}, "high",
    ),
    "claimless_all_sufficient_high": (
        [], {"ev-high": ITEMS["ev-high"]}, "high",
    ),
    "claimless_worst_item_unavailable": (
        [], {"ev-high": ITEMS["ev-high"], "ev-unavail": ITEMS["ev-unavail"]},
        "insufficient",
    ),
}

response_category = {
    name: {"claims": claims, "expected": ra.response_confidence_category(claims, items)}
    for name, (claims, items, _expected) in RESPONSE_CATEGORY_CASES.items()
}
for name, (_claims, _items, expected) in RESPONSE_CATEGORY_CASES.items():
    assert response_category[name]["expected"] == expected, (
        f"golden self-check failed for {name}: "
        f"{response_category[name]['expected']} != {expected}")

# ── 3. coverage representation (separate from confidence) ───────────────────
WINDOW = {"label": "November 2026", "start": "2026-11-01T00:00:00+00:00",
          "end": "2026-11-07T12:00:00+00:00", "timezone": "UTC"}

def qcov(coverage, freshness, currency="comparable"):
    return {"sufficiency": "sufficient", "reasons": [], "coverage": coverage,
            "freshness": freshness, "currency_integrity": currency, "note": "n"}

COVERAGE_CASES = {
    "no_data": ({}, []),
    "complete_fresh": ({"ev-a": qitem("ev-a", qcov("complete", "fresh"))}, []),
    "partial": ({"ev-a": qitem("ev-a", qcov("partial", "fresh"))}, []),
    "stale_limits": ({"ev-a": qitem("ev-a", qcov("complete", "stale"))}, []),
    "never_synchronized": ({"ev-a": qitem("ev-a", qcov("complete", "never_synchronized"))}, []),
    "synchronizing": ({"ev-a": qitem("ev-a", qcov("complete", "synchronizing"))}, []),
    "currency_mixed": ({"ev-a": qitem("ev-a", qcov("complete", "fresh", "mixed_not_comparable"))}, []),
    "currency_unknown": ({"ev-a": qitem("ev-a", qcov("complete", "fresh", "unknown_currency"))}, []),
    "certified_store": (
        {"ev-a": qitem("ev-a", qcov("complete", "fresh"),
                       metric="certified_store_count", value=1)}, []),
    "comparison_window_included": (
        {"ev-a": qitem("ev-a", qcov("complete", "fresh"))},
        [qitem("ev-b", qcov("partial", "stale"))],
    ),
    "worst_freshness_wins": (
        {"ev-a": qitem("ev-a", qcov("complete", "stale")),
         "ev-b": qitem("ev-b", qcov("complete", "fresh"))}, []),
    "complete_beats_not_applicable": (
        {"ev-a": qitem("ev-a", qcov("complete", "fresh")),
         "ev-b": qitem("ev-b", qcov("not_applicable", "unknown"))}, []),
    "unknown_coverage": (
        {"ev-a": qitem("ev-a", qcov("partial", "fresh")),
         "ev-b": qitem("ev-b", qcov("unknown", "fresh"))}, []),
}

coverage = {
    name: ra.coverage_summary(list(items_map.values()), window=WINDOW,
                              comparison_items=comparison)
    for name, (items_map, comparison) in COVERAGE_CASES.items()
}

# ── 4. deterministic A-H profile classification ─────────────────────────────
PROFILE_CASES = {
    "a_casual_greeting": dict(intent="greeting",
                              message="Hi, how are you today?"),
    "a_casual_capability": dict(intent="capability",
                                message="What can you help me with?"),
    "b_direct_metric_query": dict(
        intent="revenue_investigation",
        message="How much did I earn this month?"),
    "b_direct_count_query": dict(
        intent="revenue_investigation",
        message="How many orders did I get this week?"),
    "b_direct_data_coverage": dict(intent="data_coverage",
                                   message="Are my stores connected?"),
    "b_not_direct_when_causal": dict(
        intent="revenue_investigation",
        message="Why was my revenue down this month?"),
    "c_explanation_single_domain": dict(
        intent="revenue_investigation",
        message="Explain why my revenue dropped last week."),
    "d_comparative": dict(
        intent="revenue_investigation",
        message="How did this month compare with last month?",
        has_comparison=True),
    "d_comparative_beats_metric": dict(
        intent="revenue_investigation",
        message="How much did I earn versus last month?",
        has_comparison=True),
    "e_investigation_default": dict(
        intent="checkout_investigation",
        message="What is going on with my checkouts this month?"),
    "f_multi_domain_overview": dict(
        intent="store_overview",
        message="Give me the full picture of my store this month."),
    "f_multi_domain_by_domains": dict(
        intent="revenue_investigation",
        message="How are sales and refunds tracking this month?",
        domains=["revenue", "refunds"]),
    "g_recommendation_finding": dict(
        intent="finding_investigation",
        message="What should I do about the dropped revenue?"),
    "g_recommendation_priority": dict(
        intent="product_investigation",
        message="Which product should I fix first?",
        is_priority_question=True),
    "h_clarification_intent": dict(intent="clarify",
                                   message="Show me the numbers."),
    "h_clarification_understanding": dict(
        intent="revenue_investigation",
        message="Show me the numbers.",
        understanding={"intent": "clarification_needed"}),
    "degraded_depth_concise": dict(
        intent="revenue_investigation",
        message="How did this month compare with last month?",
        has_comparison=True, status="insufficient_data"),
    "failed_depth_concise": dict(
        intent="store_overview",
        message="Give me the full picture of my store this month.",
        status="failed"),
    "communication_explicit_on_insufficient": dict(
        intent="revenue_investigation",
        message="How did this month compare with last month?",
        has_comparison=True, claim_categories=["insufficient"]),
    "communication_inline_on_moderate": dict(
        intent="revenue_investigation",
        message="How did this month compare with last month?",
        has_comparison=True, claim_categories=["moderate"]),
    "communication_implicit_on_direct_high": dict(
        intent="revenue_investigation",
        message="How much did I earn this month?",
        claim_categories=["high", "high"]),
    "communication_inline_on_comparative_high": dict(
        intent="revenue_investigation",
        message="How did this month compare with last month?",
        has_comparison=True, claim_categories=["high"]),
    "override_direct_detailed": dict(
        intent="general",
        message="Tell me more.",
        response_intent="direct_factual",
        explanation_depth="detailed"),
}

profiles = {
    name: ra.classify_response_profile(**params)
    for name, params in PROFILE_CASES.items()
}

# ── 5. ordered element selection ────────────────────────────────────────────
def prof(name):
    return profiles[name]

ELEMENT_CASES = {
    "direct_minimal": (
        prof("b_direct_metric_query"),
        dict(has_facts=True, has_evidence=True),
        ["direct_answer", "evidence"]),
    "direct_evidence_only": (
        prof("b_direct_metric_query"), dict(has_evidence=True),
        ["evidence"]),
    "casual_empty": (
        prof("a_casual_greeting"),
        dict(has_facts=True, has_evidence=True), []),
    "comparative_full": (
        prof("d_comparative"),
        dict(has_comparison=True, has_evidence=True, has_limitations=True,
             has_recommendations=True), None),
    "investigation_ordered_with_confidence": (
        prof("e_investigation_default"),
        dict(has_facts=True, has_evidence=True, has_hypotheses=True,
             has_limitations=True, has_recommendations=True,
             has_follow_ups=True), None),
    "multi_domain_no_implication": (
        prof("f_multi_domain_overview"),
        dict(has_facts=True, has_evidence=True, has_limitations=True,
             has_recommendations=True, has_follow_ups=True), None),
    "recommendation_leads_with_answer": (
        prof("g_recommendation_priority"),
        dict(has_facts=True, has_evidence=True, has_limitations=True,
             has_recommendations=True, has_follow_ups=True), None),
    "clarification_with_next_step_degraded": (
        prof("h_clarification_understanding"),
        dict(has_unknowns=True,
             insufficient_next_step="Connect the store to see this."),
        ["direct_answer", "confidence", "unknowns", "suggested_investigation"]),
    "degraded_lead_order_with_facts": (
        prof("d_comparative"),
        dict(has_facts=True, has_evidence=True, has_limitations=True,
             has_unknowns=True,
             insufficient_next_step="Reconnect the data source."),
        ["direct_answer", "limitations", "confidence", "unknowns",
         "suggested_investigation"]),
    "recommendation_not_appropriate_omitted": (
        prof("b_direct_metric_query"),
        dict(has_facts=True, has_recommendations=True),
        ["direct_answer"]),
    "explanation_full": (
        prof("c_explanation_single_domain"),
        dict(has_facts=True, has_evidence=True, has_hypotheses=True,
             has_limitations=True, has_recommendations=True),
        ["direct_answer", "situation", "insight", "evidence",
         "confidence", "limitations"]),
}

elements = {
    name: ra.select_elements(profile, **kwargs)
    for name, (profile, kwargs, _expected) in ELEMENT_CASES.items()
}
for name, (_profile, _kwargs, expected) in ELEMENT_CASES.items():
    if expected is not None:
        assert elements[name] == expected, (
            f"golden self-check failed for {name}: {elements[name]} != {expected}")

golden = {
    "contract_version": ra.ADAPTATION_CONTRACT_VERSION,
    "claim_confidence": claim_confidence,
    "response_category": response_category,
    "coverage": coverage,
    "profiles": profiles,
    "elements": elements,
}

out = (ROOT.parent / "Backend" / "src" / "services" / "__tests__"
       / "revResponseAdaptation.golden.json")
out.write_text(json.dumps(golden, indent=2, sort_keys=True) + "\n")
print(f"wrote {out} "
      f"({len(claim_confidence)} claim cases, {len(response_category)} "
      f"category cases, {len(coverage)} coverage cases, "
      f"{len(profiles)} profile cases, {len(elements)} element cases)")
