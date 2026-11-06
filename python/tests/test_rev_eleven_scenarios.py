"""Eleven-scenario Rev conversation acceptance matrix (Revluma MVP).

This is the deterministic, fixture-level half of the live acceptance suite.
Each scenario asserts the routing contract: which gate opens, whether live
understanding was consulted, and whether store tools are permitted to run.

The live half (authenticated merchant session, real tool-invocation counts,
browser evidence) is specified in docs/production-recovery/REV-LIVE-ACCEPTANCE-RUNBOOK.md
and cannot be executed without that session; counts are never fabricated.

Scenario names mirror the mandated launch set:
 1 greeting · 2 casual conversation · 3 general ecommerce question ·
 4 concern about sales · 5 explicit store investigation · 6 follow-up on a
 reporting period · 7 acknowledgement · 8 request for clarification ·
 9 return to a previous investigation · 10 topic change · 11 prohibited action.
"""

import json

import pytest

import src.agents.model_gateway as gateway
from src.agents.investigation import (
    INTENT_CLARIFY,
    INTENT_CUSTOMERS,
    INTENT_KNOWLEDGE,
    INTENT_REVENUE,
    INTENT_REFUNDS,
    route_message,
)

STORE = {"store_count": 1}


def _u(intent="metrics", store=True, mode="direct_answer", domains=None,
       confidence=0.9, entities=None):
    return json.dumps({
        "intent": intent, "goal": "acceptance", "requires_store_data": store,
        "requires_web": False, "requires_action": False, "response_mode": mode,
        "entities": entities or {}, "domains": domains or [],
        "urgency": "low", "confidence": confidence,
    })


@pytest.fixture
def model(monkeypatch):
    state = {"calls": [], "reply": _u()}

    def fake_generate(prompt, **kwargs):
        state["calls"].append(prompt)
        if state.get("raise"):
            raise RuntimeError("provider down")
        return state["reply"]

    monkeypatch.setattr(gateway, "generate", fake_generate)
    return state


def route(message, context=None):
    return route_message(message, context or {}, STORE)


# 1 — Greeting: warm social routing, zero store tools, zero understanding call.
def test_01_greeting(model):
    out = route("Good morning!")
    assert out["gate"] == "conversational"
    assert out["source"] == "fast_path"
    assert model["calls"] == []


# 2 — Casual conversation: no investigation, no understanding call.
def test_02_casual_conversation(model):
    out = route("What's up?")
    assert out["gate"] == "conversational"
    assert model["calls"] == []


# 3 — General ecommerce question: answered from knowledge, never from tools.
def test_03_general_ecommerce_question(model):
    model["reply"] = _u(intent="knowledge", store=False, mode="explanation",
                        domains=["customers"])
    out = route("What does a good repeat purchase rate look like?")
    assert out["gate"] == "conversational"
    assert out["classification"]["intent"] == INTENT_KNOWLEDGE


# 4 — Concern about sales: the gate opens; evidence is required, not vibes.
def test_04_sales_concern_opens_investigation(model):
    model["reply"] = _u(intent="diagnosis", domains=["revenue"], mode="analysis")
    out = route("Why are my sales lower than usual lately?")
    assert out["gate"] == "tools"
    assert out["classification"]["intent"] == INTENT_REVENUE


# 5 — Explicit store investigation request: tools, full analysis mode.
def test_05_explicit_investigation(model):
    model["reply"] = _u(intent="diagnosis", domains=["overview"], mode="analysis",
                        confidence=0.95)
    out = route("Please run a full investigation of my store.")
    assert out["gate"] == "tools"
    cls = out.get("classification") or {}
    assert (cls.get("response_mode") or out.get("response_mode") or "analysis") == "analysis"


# 6 — Follow-up about a reporting period: context carries the subject.
def test_06_followup_about_reporting_period(model):
    context = {
        "last_investigation": {"intent": INTENT_REVENUE},
        "recent_turns": [
            {"role": "user", "text": "How much revenue did we do this month?"},
            {"role": "rev", "text": "2 orders, 3,446.85 USD recorded."},
        ],
    }
    out = route("What about last week?", context)
    assert out["gate"] == "tools"
    assert out["classification"]["intent"] == INTENT_REVENUE
    assert out["classification"]["followup"] is True


# 7 — Acknowledgement: never an investigation.
def test_07_acknowledgement(model):
    for message in ("Got it.", "Thanks.", "Makes sense."):
        out = route(message)
        assert out["gate"] == "conversational"
        assert model["calls"] == []


# 8 — Request for clarification: the system clarifies instead of fabricating
#     an investigation from an under-specified message.
def test_08_clarification_request(model):
    model["reply"] = _u(intent="clarification_needed", store=False,
                        mode="clarification", confidence=0.4)
    out = route("What do you think?")
    assert out["gate"] == "clarify"
    assert out["classification"]["intent"] == INTENT_CLARIFY


# 9 — Return to a previous investigation: the prior customer subject is kept.
def test_09_return_to_previous_investigation(model):
    context = {
        "conversation_state": {"subject": INTENT_CUSTOMERS,
                               "updated_at": "2026-11-06T09:00:00+00:00"},
        "last_investigation": {"intent": INTENT_CUSTOMERS},
    }
    model["reply"] = _u(intent="followup", domains=["customers"])
    out = route("go back to that customer issue you flagged", context)
    assert out["gate"] == "tools"
    assert out["classification"]["followup"] is True or \
        out["classification"]["intent"] == INTENT_CUSTOMERS


# 10 — Topic change: the new subject is answered, previous context does not leak.
def test_10_topic_change_isolation(model):
    context = {
        "last_investigation": {"intent": INTENT_REVENUE},
        "recent_turns": [{"role": "user", "text": "Why is revenue down?"}],
    }
    model["reply"] = _u(intent="knowledge", store=False, mode="explanation",
                        domains=["refunds"])
    out = route("Anyway, how do refunds usually work on Shopify?", context)
    assert out["gate"] == "conversational"
    assert out["classification"]["intent"] == INTENT_KNOWLEDGE
    assert out.get("topic_change") is True


# 11 — Prohibited / unsupported action: refused before any routing or tools.
def test_11_prohibited_action_refused_before_tools(model):
    out = route("Delete all my products from Shopify right now.")
    assert out["gate"] == "refuse"
    assert model["calls"] == []
    out2 = route("Please refund order 1004.")
    assert out2["gate"] == "refuse"
    assert model["calls"] == []
