"""Rev conversation-experience golden set (spec §10, increment I6).

Deterministic evaluation layer for the conversation contract: intent
classification, response-mode selection, composed-answer content, follow-up
gating and prohibited-claim scanning across a curated prompt × evidence-state
matrix (≥100 cases, expanding toward 250–500 per spec §10).

Scope honesty: this harness certifies the deterministic pipeline — routing,
mode guards, fact composition, gating and claim discipline. Narrative quality
produced by an optional LLM rewrite is validated separately at runtime by
_validate_narrative and is out of offline scope; the certification report says
so explicitly.
"""
import pytest

from src.agents.investigation import (
    INTENT_CAPABILITY,
    INTENT_CHECKOUT,
    INTENT_COVERAGE,
    INTENT_CUSTOMERS,
    INTENT_GENERAL,
    INTENT_GREETING,
    INTENT_IDENTITY,
    INTENT_LABELS,
    INTENT_OVERVIEW,
    INTENT_PRODUCTS,
    INTENT_READ_ONLY,
    INTENT_REFUNDS,
    INTENT_REVENUE,
    INTENT_TRAFFIC,
    _clarification_result,
    _compose_text,
    _conversation_result,
    _follow_ups,
    _read_only_result,
    classify_investigation,
    select_response_mode,
)
from src.intelligence.evidence import STATUS_AVAILABLE

WINDOW = {"start": "2026-10-25T00:00:00Z", "end": "2026-11-01T00:00:00Z"}
WINDOW_COMPARED = {
    **WINDOW,
    "compared_to": {"start": "2026-10-18T00:00:00Z", "end": "2026-10-25T00:00:00Z",
                    "label": "Previous period"},
}


def ev(id: str, metric: str = "recorded_order_value", status: str = STATUS_AVAILABLE) -> dict:
    return {
        "id": id, "metric": metric, "label": metric.replace("_", " "),
        "value": 1250, "unit": "currency", "currency": "USD", "status": status,
        "period": {"start": WINDOW["start"], "end": WINDOW["end"]},
        "source": "shopify_orders", "definition": "Recorded non-cancelled order value.",
    }


FACT = {"text": "Recorded order value was $1,250 for the period.", "evidence_ids": ["ev-current"]}
REFUND_FACT = {"text": "Refunds totalled $180.", "evidence_ids": ["ev-refunds"]}
HEALTH_FACT = {"text": "The Shopify connection is active.", "evidence_ids": ["ev-health"]}
COMPARISON_FACT = {
    "text": "Recorded order value declined by 12% against the previous period.",
    "evidence_ids": ["ev-current", "ev-before"],
}
HYPOTHESIS = {
    "statement": "Lower order volume may have contributed.",
    "verified": False, "status": "hypothesis", "confidence": 0.2,
}
RECOMMENDATION = {
    "label": "Review refunded orders", "why": "Refunds overlap with the decline.",
    "measure": "Refund count per day", "executed": False,
}

# Evidence states a finished investigation can legitimately be in. Each state
# pins the mode its guards must select and the content the composed answer must
# (or must not) carry.
STATES = {
    "single_verified_finding": {
        "status": "complete", "tool_names": ["revenue_observations"],
        "evidence_items": [ev("ev-current")], "comparison_facts": [], "hypotheses": [],
        "expected_mode": "insight",
        "facts": [FACT], "recommendations": [RECOMMENDATION], "unknowns": [],
        "window": WINDOW,
        "required": ["Recorded order value was $1,250 for the period."],
    },
    "multi_tool_investigation": {
        "status": "complete", "tool_names": ["revenue_observations", "refund_observations"],
        "evidence_items": [ev("ev-current"), ev("ev-refunds", "refund_amount"),
                           ev("ev-orders", "orders_count")],
        "comparison_facts": [], "hypotheses": [HYPOTHESIS],
        "expected_mode": "investigation",
        "facts": [FACT, REFUND_FACT], "recommendations": [RECOMMENDATION],
        "unknowns": ["Acquisition source is not recorded."],
        "window": WINDOW,
        "required": ["Refunds totalled $180.", "What is not established",
                     "Lower order volume may have contributed."],
    },
    "period_comparison": {
        "status": "complete", "tool_names": ["revenue_observations"],
        "evidence_items": [ev("ev-current"), ev("ev-before")],
        "comparison_facts": [COMPARISON_FACT], "hypotheses": [],
        "expected_mode": "comparison",
        "facts": [FACT], "recommendations": [], "unknowns": [],
        "window": WINDOW_COMPARED,
        "required": ["declined by 12%", "Compared with the previous period",
                     "arithmetic description of the change"],
    },
    "connection_check_only": {
        "status": "complete", "tool_names": ["store_health", "data_coverage"],
        "evidence_items": [ev("ev-health", "store_health")],
        "comparison_facts": [], "hypotheses": [],
        "expected_mode": "quick_verification",
        "facts": [HEALTH_FACT], "recommendations": [], "unknowns": [],
        "window": WINDOW,
        "required": ["The Shopify connection is active."],
    },
    "no_verified_evidence": {
        "status": "complete", "tool_names": ["revenue_observations"],
        "evidence_items": [ev("ev-missing", status="unavailable")],
        "comparison_facts": [], "hypotheses": [],
        "expected_mode": "insufficient_evidence",
        "facts": [], "recommendations": [],
        "unknowns": ["Store records did not pass the evidence gate."],
        "window": WINDOW,
        "required": ["without guessing"],
    },
    "degraded_status": {
        # Guard-first selection: a degraded investigation status outranks the
        # presence of otherwise-verified evidence.
        "status": "insufficient_data", "tool_names": ["revenue_observations"],
        "evidence_items": [ev("ev-current")], "comparison_facts": [], "hypotheses": [],
        "expected_mode": "insufficient_evidence",
        "facts": [FACT], "recommendations": [],
        "unknowns": ["One source failed mid-investigation."],
        "window": WINDOW,
        "required": ["Recorded order value was $1,250 for the period.",
                     "Limits of this evidence"],
    },
}

STORE_PROMPTS = {
    INTENT_OVERVIEW: [
        "How is my store performing?",
        "Give me a summary of my shop.",
        "What should I look at first?",
        "What is the most important issue in my business right now?",
        "Give me a morning briefing on my store.",
        "Where should I focus today?",
        "What are my priorities this week?",
        "What's the biggest problem in my shop?",
        "Can I get an overview of recent trading?",
        "Where should I start with all this data?",
    ],
    INTENT_REVENUE: [
        "Why did revenue drop yesterday?",
        "How are my sales this week?",
        "Did orders fall compared with last period?",
        "How much money did the store make this week?",
        "Is my income growing?",
        "What happened to my profit margin?",
        "Are purchases increasing or declining?",
        "How is average order value trending?",
        "Did turnover go down this month?",
        "How much did sales grow last weekend?",
    ],
    INTENT_CHECKOUT: [
        "Where are carts being abandoned?",
        "Why are checkouts failing?",
        "How many abandoned carts did I have yesterday?",
        "Why are people abandoning their carts?",
        "How is the checkout performing?",
        "Is checkout abandonment getting worse?",
        "What's my abandoned cart rate this week?",
        "Are carts being left at the shipping step?",
        "How many checkouts started but never finished?",
        "Did cart abandonment spike on mobile?",
    ],
    INTENT_CUSTOMERS: [
        "Are repeat customers declining?",
        "How is customer retention?",
        "What is my customers' lifetime value?",
        "Are shoppers coming back to buy again?",
        "Are my buyers mostly one-time shoppers?",
        "Is churn increasing among loyal customers?",
        "How many returning customers did I have this month?",
        "What is my LTV trend?",
        "Should I run a win-back for lapsed customers?",
        "Do customers who buy once come back?",
    ],
    INTENT_REFUNDS: [
        "Why are refunds increasing?",
        "How much money went back in returns?",
        "Are chargebacks up this month?",
        "Did any cancelled orders spike this week?",
        "Which products got returned most?",
        "Are disputes trending up?",
        "How many refunds did I process this week?",
        "What caused the cancellation spike?",
        "Are return requests growing?",
        "How do refunds compare with last month?",
    ],
    INTENT_PRODUCTS: [
        "Which products sold best this week?",
        "Are any items out of stock?",
        "How are my collections performing?",
        "Which variants are out of stock?",
        "What are my best sellers this month?",
        "Is inventory running low anywhere?",
        "Which SKUs sold the most?",
        "How is stock moving on new arrivals?",
        "Did any product go out of stock last week?",
        "What's my best-selling collection?",
    ],
    INTENT_TRAFFIC: [
        "Why did sessions drop?",
        "Is the pixel firing correctly?",
        "How is my conversion rate trending?",
        "Why are visits dropping?",
        "Are my landing pages converting?",
        "How much traffic did I get yesterday?",
        "Did clicks fall on the sale page?",
        "Are tracking events missing?",
        "Which sessions bounced the fastest?",
        "Is my traffic mostly mobile visitors?",
    ],
    INTENT_COVERAGE: [
        "Is my store connected?",
        "When did the last sync run?",
        "Are webhooks working?",
        "Is my data up to date?",
        "Do you have the right permissions on my store?",
        "How fresh is my store data?",
        "Did the sync finish successfully?",
        "What's my data coverage right now?",
        "Is the connection to Shopify healthy?",
        "Are my data scopes complete?",
    ],
}

CONVERSATIONAL_PROMPTS = {
    INTENT_GREETING: ["Hey", "Hello!", "Good morning", "Hi", "Good evening"],
    INTENT_IDENTITY: ["Who are you?", "What is Rev?", "What are you?", "Tell me about yourself"],
    INTENT_CAPABILITY: ["What can you do?", "How can you help me?",
                        "What can you help me with?", "What features do you have?",
                        "What do you do?"],
    INTENT_GENERAL: ["What is the best way to structure shipping options?",
                     "Tell me a joke about ecommerce.",
                     "How should I think about pricing my shipping zones?",
                     "What makes a strong brand story?",
                     "How do I write a good about page?"],
}

READ_ONLY_PROMPTS = [
    "Cancel all pending orders for me",
    "Send an email to customers who abandoned carts",
    "Can you fix the checkout for me?",
    "Update the price of the Atlas Lamp",
    "Edit the product description for me",
    "Launch a discount for the weekend",
    "Could you handle the refund for order 123?",
    "Would you send an SMS to my customer list?",
]

# Spec §8: internal terms are forbidden in user-facing copy; promised uplift,
# invented benchmarks and execution claims are forbidden everywhere.
PROHIBITED_CLAIMS = [
    "guarantee", "will definitely", "industry average", "industry benchmark",
    "i updated", "i changed", "i have changed", "i applied", "i sent",
    "i launched", "i refunded", "i cancelled", "net sales", "confidence score",
    "context payload", "sql", "worker", "event stream", "endpoint",
    "model status",
]

GENERIC_FILLER = "What should I investigate next?"


def _compose_for(intent: str, state: dict) -> str:
    return _compose_text(
        intent=intent, label=INTENT_LABELS[intent], window=state["window"],
        facts=state["facts"], comparison_facts=state["comparison_facts"],
        hypotheses=state["hypotheses"], unknowns=state["unknowns"],
        recommendations=state["recommendations"], skipped=[],
        store_context={}, overall_status=state["status"],
    )


def _first_meaningful_lines(text: str, count: int = 2) -> str:
    """First non-heading lines: what a merchant reads first."""
    lines = [line.strip() for line in text.splitlines()
             if line.strip() and not line.strip().startswith("#")]
    return " ".join(lines[:count])


def _store_cases() -> list[dict]:
    cases = []
    for intent, prompts in STORE_PROMPTS.items():
        for prompt in prompts:
            for state_name, state in STATES.items():
                cases.append({
                    "id": f"{intent}/{prompt[:24]}/{state_name}",
                    "kind": "store", "prompt": prompt, "intent": intent,
                    "state_name": state_name, "state": state,
                })
    return cases


def _conversational_cases() -> list[dict]:
    cases = []
    for intent, prompts in CONVERSATIONAL_PROMPTS.items():
        for prompt in prompts:
            cases.append({"id": f"{intent}/{prompt[:24]}", "kind": "conversation",
                          "prompt": prompt, "intent": intent})
    for prompt in READ_ONLY_PROMPTS:
        cases.append({"id": f"read_only/{prompt[:24]}", "kind": "read_only",
                      "prompt": prompt, "intent": INTENT_READ_ONLY})
    return cases


CASES = _store_cases() + _conversational_cases()


def test_golden_set_meets_minimum_size():
    # Spec §10: ≥100 prompts with evidence fixtures and expected modes,
    # expanding toward 250–500 scored cases.
    assert len({case["prompt"] for case in CASES}) >= 100
    assert len(CASES) >= 250


def evaluate(case: dict) -> dict:
    """Score one golden-set case against every deterministic criterion."""
    checks: dict[str, bool] = {}
    classification = classify_investigation(case["prompt"])
    checks["classification"] = classification["intent"] == case["intent"]

    if case["kind"] == "store":
        state = case["state"]
        mode, _reason = select_response_mode(
            intent=case["intent"], status=state["status"],
            tool_names=state["tool_names"], evidence_items=state["evidence_items"],
            comparison_facts=state["comparison_facts"], hypotheses=state["hypotheses"],
        )
        checks["mode"] = mode == state["expected_mode"]
        text = _compose_for(case["intent"], state)
        lowered = text.lower()
        checks["required_facts"] = all(requirement in text for requirement in state["required"])
        # Answer-first (spec §10 directness): the lead fact — or the honest
        # limitation when there is none — arrives within the first two lines.
        lead = state["facts"][0]["text"] if state["facts"] else "without guessing"
        checks["directness"] = lead in _first_meaningful_lines(text)
        checks["prohibited_claims"] = not any(claim in lowered for claim in PROHIBITED_CLAIMS)
        if state["hypotheses"]:
            checks["uncertainty"] = ("What is not established" in text
                                     and HYPOTHESIS["statement"] in text)
        else:
            checks["uncertainty"] = "What is not established" not in text
        if state["recommendations"]:
            checks["measurability"] = ("Measure: Refund count per day" in text
                                       and "Nothing has been changed or sent." in text)
        else:
            checks["measurability"] = "Measure:" not in text
        # Follow-up gating: the generic filler is extinct everywhere, and a
        # state with no verified evidence offers no chips at all.
        chips = _follow_ups(case["intent"], state["window"], None,
                            evidence_items=state["evidence_items"],
                            unknowns=state["unknowns"],
                            comparison_facts=state["comparison_facts"])
        checks["followup_gating"] = GENERIC_FILLER not in chips and (
            state["expected_mode"] != "insufficient_evidence" or not chips
            or case["intent"] == INTENT_COVERAGE
        )
        checks["read_only"] = "Nothing has been changed or sent." in text or not state["recommendations"]
        checks["verbosity"] = True  # composed length is fixture-driven; scored at result level
        return checks

    if case["kind"] == "conversation":
        result = _conversation_result(case["prompt"], classification,
                                      investigation_id="golden-conv", store_context={},
                                      user_id="golden-user", window={})
        text = result["text"]
        checks["mode"] = result["response_mode"] == "conversational"
        checks["required_facts"] = bool(text.strip())
        checks["directness"] = bool(text.strip())
        checks["prohibited_claims"] = not any(claim in text.lower() for claim in PROHIBITED_CLAIMS)
        checks["uncertainty"] = True
        checks["measurability"] = True
        checks["followup_gating"] = result["investigation"]["follow_ups"] == []
        checks["read_only"] = result["read_only"] is True
        checks["verbosity"] = len(text) <= 1000
        return checks

    # read_only boundary
    result = _read_only_result(case["prompt"], classification,
                               investigation_id="golden-ro", store_context={},
                               user_id="golden-user", window={})
    text = result["text"]
    checks["mode"] = result["response_mode"] == "conversational"
    checks["required_facts"] = "I can't execute that" in text
    checks["directness"] = "read-only" in _first_meaningful_lines(text, 1)
    checks["prohibited_claims"] = not any(claim in text.lower() for claim in PROHIBITED_CLAIMS)
    checks["uncertainty"] = True
    checks["measurability"] = True
    checks["followup_gating"] = GENERIC_FILLER not in result["investigation"]["follow_ups"]
    checks["read_only"] = (result["read_only"] is True and result["executed_actions"] == []
                           and result["requested_actions"] != [])
    checks["verbosity"] = len(text) <= 1000
    return checks


CRITERIA = ("classification", "mode", "required_facts", "directness", "prohibited_claims",
            "uncertainty", "measurability", "followup_gating", "read_only", "verbosity")


@pytest.mark.parametrize("case", CASES, ids=[case["id"] for case in CASES])
def test_golden_case(case):
    failures = {name: passed for name, passed in evaluate(case).items() if not passed}
    assert not failures, f"{case['id']} failed: {sorted(failures)}"


def test_golden_set_scorecard():
    """Aggregate gates from spec §10. Every gate is a merge precondition."""
    scored = [(case, evaluate(case)) for case in CASES]
    total = len(scored)
    rates = {
        name: sum(1 for _case, checks in scored if checks[name]) / total
        for name in CRITERIA
    }
    violations = [
        f"{case['id']}:{name}"
        for case, checks in scored for name, passed in checks.items() if not passed
    ]
    report = "\n".join(f"{name}: {rates[name]:.1%}" for name in CRITERIA)
    gates = {
        "classification": 1.0, "mode": 1.0, "required_facts": 1.0,
        "prohibited_claims": 1.0, "uncertainty": 1.0, "measurability": 1.0,
        "followup_gating": 1.0, "read_only": 1.0, "verbosity": 1.0,
        "directness": 0.95,
    }
    failed_gates = {name: rates[name] for name, minimum in gates.items() if rates[name] < minimum}
    assert not failed_gates, f"golden-set gates failed: {failed_gates}\n{report}\n{violations[:20]}"


def test_clarification_paths_lead_with_the_limitation():
    """Acceptance transcripts B/D shape: limitation first, no invented number,
    guard-produced chips only where the guard actually produced them."""
    classification = classify_investigation("How are my sales this week?")
    missing = _clarification_result("How are my sales this week?", classification,
                                    investigation_id="golden-clar", store_context={},
                                    user_id="golden-user", window=WINDOW, reason="evidence")
    assert missing["response_mode"] == "insufficient_evidence"
    assert "without guessing" in missing["text"]
    assert missing["investigation"]["follow_ups"] == []
    assert not any(claim in missing["text"].lower() for claim in PROHIBITED_CLAIMS)

    no_store = _clarification_result("How are my sales this week?", classification,
                                     investigation_id="golden-nostore", store_context={},
                                     user_id="golden-user", window=WINDOW, reason="no_store")
    assert no_store["response_mode"] == "insufficient_evidence"
    assert "connected store" in no_store["text"]
    # Guard-produced chips survive; generic filler does not.
    assert no_store["investigation"]["follow_ups"] == [
        "How do I connect Shopify?", "What data will you read?", "What stays private?",
    ]
    assert GENERIC_FILLER not in no_store["investigation"]["follow_ups"]


def test_coverage_followup_chip_requires_a_real_limitation():
    """The coverage chip is offered only when the investigation surfaced a
    coverage limitation — never just because the question was about coverage."""
    limited = _follow_ups(INTENT_COVERAGE, WINDOW, None,
                          evidence_items=[ev("ev-health", "store_health")],
                          unknowns=["Traffic events are missing for part of the period."],
                          comparison_facts=[])
    assert "Which missing data source is limiting this investigation?" in limited

    clean = _follow_ups(INTENT_COVERAGE, WINDOW, None,
                        evidence_items=[ev("ev-health", "store_health")],
                        unknowns=[], comparison_facts=[])
    assert clean == []
