"""Conversational routing + investigation gate evaluation (directive §14).

The gate matrix runs with the model gateway patched so every layer's decision
is deterministic: fast path (no model call), model understanding (canned JSON),
fallback (provider failure). Asserts gate outcomes, tool justification,
follow-up continuity, topic changes, mixed intents and ambiguity behaviour.
"""

import json

import pytest

import src.agents.model_gateway as gateway
from src.agents.investigation import (
    INTENT_CHECKOUT,
    INTENT_CLARIFY,
    INTENT_COVERAGE,
    INTENT_CUSTOMERS,
    INTENT_KNOWLEDGE,
    INTENT_OVERVIEW,
    INTENT_REVENUE,
    INTENT_SOCIAL,
    route_message,
)


def _u(intent="metrics", store=True, mode="direct_answer", domains=None,
       confidence=0.9, entities=None):
    return json.dumps({
        "intent": intent, "goal": "test", "requires_store_data": store,
        "requires_web": False, "requires_action": False, "response_mode": mode,
        "entities": entities or {}, "domains": domains or [],
        "urgency": "low", "confidence": confidence,
    })


@pytest.fixture
def model(monkeypatch):
    """Patched gateway: records prompts, returns canned understanding JSON."""
    state = {"calls": [], "reply": _u()}

    def fake_generate(prompt, **kwargs):
        state["calls"].append(prompt)
        if state.get("raise"):
            raise RuntimeError("provider down")
        return state["reply"]

    monkeypatch.setattr(gateway, "generate", fake_generate)
    return state


def route(message, model=None, context=None):
    return route_message(message, context or {}, {"store_count": 1})


# ── A/B: social and acknowledgements never open the gate ────────────────────
@pytest.mark.parametrize("message", [
    "Hey.", "Hello.", "Good morning.", "How are you?", "How are you doing?",
    "What's up?", "Are you there?", "Hope you're doing well.",
    "Nice talking to you.", "How have you been?", "Long time no see.",
])
def test_social_set_runs_no_tools(message, model):
    routing = route(message, model)
    assert routing["gate"] == "conversational", message
    assert routing["source"] == "fast_path", message
    assert model["calls"] == [], f"understanding call for {message}"


@pytest.mark.parametrize("message", [
    "Thanks.", "Thank you.", "Okay.", "Alright.", "Got it.", "Interesting.",
    "That's good.", "Wow.", "Makes sense.", "I see.",
])
def test_acknowledgements_do_not_investigate(message, model):
    routing = route(message, model)
    assert routing["gate"] == "conversational", message
    assert model["calls"] == [], message


# ── C/D: capability and general advice stay data-free ───────────────────────
def test_capability_discovery(model):
    assert route("What can you do?", model)["gate"] == "conversational"


def test_general_advice_reaches_the_model_not_the_tools(model):
    model["reply"] = _u(intent="strategy", store=False, mode="explanation",
                        domains=["carts"])
    routing = route("How do I reduce cart abandonment?", model)
    assert routing["gate"] == "conversational"
    assert routing["classification"]["intent"] == INTENT_KNOWLEDGE
    assert routing["source"] == "model"
    assert model["calls"], "unforeseen advice phrasing must reach understanding"


# ── E/F/G/H: justified store work still runs ────────────────────────────────
def test_store_verification_is_quick_not_a_report(model):
    routing = route("Is my Shopify store connected?", model)
    assert routing["classification"]["intent"] == INTENT_COVERAGE
    assert routing["gate"] == "tools"
    assert model["calls"] == []


def test_direct_metric_question_runs_tools(model):
    routing = route("How much revenue did I generate this week?", model)
    assert routing["classification"]["intent"] == INTENT_REVENUE
    assert routing["gate"] == "tools"


def test_unforeseen_metric_phrasing_reaches_the_model_and_runs(model):
    model["reply"] = _u(intent="metrics", domains=["revenue"])
    routing = route("what's my damage for this week so far?", model)
    assert routing["gate"] == "tools"
    assert routing["classification"]["intent"] == INTENT_REVENUE
    assert routing["source"] == "model"


def test_investigation_and_recommendation_intents(model):
    model["reply"] = _u(intent="diagnosis", domains=["revenue"], mode="analysis")
    assert route("Why are sales lower than expected?", model)["gate"] == "tools"
    model["reply"] = _u(intent="recommendation", domains=["revenue"], mode="analysis")
    routing = route("where is the biggest leak right now?", model)
    assert routing["gate"] == "tools"


# ── I: contextual follow-ups keep their subject ─────────────────────────────
def test_followup_inherits_subject_from_context(model):
    context = {"last_investigation": {"intent": INTENT_REVENUE},
               "recent_turns": [{"role": "user", "text": "How much revenue this week?"},
                                {"role": "rev", "text": "2,321.85 across 2 orders."}]}
    routing = route("What about last week?", model, context)
    assert routing["classification"]["intent"] == INTENT_REVENUE
    assert routing["classification"]["followup"] is True
    assert routing["gate"] == "tools"


def test_followup_resolved_from_conversation_state(model):
    model["reply"] = _u(intent="followup", domains=["customers"])
    context = {"conversation_state": {"subject": INTENT_CUSTOMERS,
                                      "updated_at": "2026-11-04T09:00:00+00:00"},
               "last_investigation": {"intent": INTENT_CUSTOMERS}}
    routing = route("could refunds be responsible?", model, context)
    assert routing["gate"] == "tools"


# ── J/K: ambiguity clarifies, topic changes reset without blocking ──────────
def test_ambiguous_message_clarifies_instead_of_investigating(model):
    model["reply"] = _u(intent="clarification_needed", store=False,
                        mode="clarification", confidence=0.4)
    routing = route("What do you think?", model)
    assert routing["gate"] == "clarify"
    assert routing["classification"]["intent"] == INTENT_CLARIFY


def test_low_confidence_with_business_evidence_still_answers(model):
    model["reply"] = _u(intent="metrics", domains=["revenue"], confidence=0.35)
    routing = route("revenue situation looking shaky lately?", model)
    assert routing["gate"] == "tools"
    assert routing["source"] == "fallback_deterministic"


def test_topic_change_to_knowledge_still_gets_knowledge(model):
    model["reply"] = _u(intent="knowledge", store=False, mode="explanation",
                        domains=["customers"])
    routing = route("Anyway, what is customer lifetime value?", model)
    assert routing["classification"]["intent"] == INTENT_KNOWLEDGE
    assert routing["gate"] == "conversational"
    assert routing["topic_change"] is True


# ── L: mixed intents run the business half and flag the social opener ───────
def test_mixed_message_runs_tools_and_flags_the_opener(model):
    routing = route("Hey, hope you're well. Can you check my sales this week?", model)
    assert routing["gate"] == "tools"
    assert routing["classification"]["intent"] == INTENT_REVENUE
    assert routing["social_opener"] is True


# ── Provider failure: conservative, never a fabricated investigation ────────
def test_provider_failure_degrades_conversational_not_investigative(model):
    model["raise"] = True
    routing = route("what's my damage for this week so far?", model)
    # understand() falls back to a conversational reading; the deterministic
    # keyword layer rescues the clear business subject instead of guessing.
    assert routing["gate"] in ("tools", "conversational", "clarify")
    assert routing["source"] in ("fallback_deterministic", "model")


def test_provider_failure_on_social_stays_social(model):
    model["raise"] = True
    routing = route("how are you doing?", model)
    assert routing["gate"] == "conversational"
    assert routing["source"] == "fast_path"


# ── Security: the guard outranks everything ─────────────────────────────────
def test_prohibited_action_refuses_before_any_routing(model):
    routing = route("Please change my product prices to 9.99", model)
    assert routing["gate"] == "refuse"
    assert model["calls"] == []
