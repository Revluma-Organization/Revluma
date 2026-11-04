"""Expanded conversational evaluation (master directive §14, user review 2026-11-04).

Goes beyond the 36-case gate matrix: natural-language variation, misspellings,
incomplete fragments, emotional context, sarcasm, corrections, ambiguous
follow-ups, topic changes, long mixed conversations, provider outages and junk
model output — plus the dynamic-generation guarantee (composers, not template
walls) and its controlled-failure degradation.

The model gateway is patched so every case is deterministic. Two layers are
evaluated:
  * a correct model reading must produce the correct gate (contract);
  * a failed/junk model must never fabricate an investigation and must never
    push ordinary conversation into tools (safety).
"""

import json

import pytest

import src.agents.model_gateway as gateway
import src.agents.responder as responder
from src.agents import investigation
from src.agents.investigation import (
    INTENT_CHECKOUT,
    INTENT_CLARIFY,
    INTENT_CUSTOMERS,
    INTENT_GREETING,
    INTENT_KNOWLEDGE,
    INTENT_REVENUE,
    STORE_INTENTS,
    _conversation_state,
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
    """Patched gateway with per-message scripted replies.

    state["replies"]: substring of the merchant message -> canned JSON.
    state["reply"]:   default reply. state["raise"]: simulate an outage.
    """
    state = {"calls": [], "reply": _u(intent="casual", store=False,
                                      mode="conversational", confidence=0.9),
             "replies": {}, "raise": False}

    def fake_generate(prompt, **kwargs):
        state["calls"].append(prompt)
        if state["raise"]:
            raise RuntimeError("provider down")
        # Latest script first: earlier turns' text rides along in the prompt's
        # conversation history, so the newest key must win the dispatch.
        for key, reply in reversed(list(state["replies"].items())):
            if key in prompt:
                return reply
        return state["reply"]

    monkeypatch.setattr(gateway, "generate", fake_generate)
    return state


class Conv:
    """Multi-turn harness: threads the same context window the database would.

    After every turn it replays the persistence side effects (last_investigation
    on tool turns, conversation_state per the state layer) so follow-up and
    topic-change behaviour is evaluated across a real sequence, not in
    isolation.
    """

    def __init__(self, store_context=None):
        self.context = {"summary": None, "last_investigation": None,
                        "recent_turns": [], "unresolved": [],
                        "conversation_state": None}
        self.store_context = store_context or {"store_count": 1}
        self.turns = []

    def send(self, message):
        routing = route_message(message, self.context, self.store_context)
        gate = routing["gate"]
        intent = routing["classification"]["intent"]
        understanding = routing["understanding"] or {}
        window = {"label": "this week"}
        if gate == "tools":
            self.context["last_investigation"] = {"intent": intent,
                                                  "status": "complete"}
            self.context["conversation_state"] = _conversation_state(
                self.context["conversation_state"], intent=intent, window=window,
                topic_change=routing["topic_change"], open_clarification=False,
                understanding=understanding)
        elif intent == INTENT_CLARIFY:
            self.context["conversation_state"] = _conversation_state(
                self.context["conversation_state"], intent=intent, window=window,
                topic_change=routing["topic_change"], open_clarification=True,
                understanding=understanding)
        self.context["recent_turns"] = (self.context["recent_turns"]
                                        + [{"role": "user", "text": message}])[-6:]
        self.turns.append({"message": message, "gate": gate, "intent": intent,
                           "source": routing["source"]})
        return routing


# ── 1. Natural variation and misspellings: conversation stays conversation ──
@pytest.mark.parametrize("message", [
    "helo", "heyy there", "how r u", "hw are you?", "whats up buddy",
    "gud morning", "goood morning!", "hiya", "evening!", "yo",
    "thnks", "ok cool", "alrighty", "gotcha gotcha", "cheers mate",
])
def test_typos_and_casual_variations_never_pull_store_data(message, model):
    routing = route_message(message, {}, {"store_count": 1})
    assert routing["gate"] == "conversational", message
    assert routing["classification"]["intent"] not in STORE_INTENTS, message


# ── 2. Misspelled business questions still reach tools via the model ────────
@pytest.mark.parametrize("message,reply", [
    ("hwat is my revenue this week", None),  # keyword + store ref: fast path
    ("revenu trending down?", _u(domains=["revenue"])),
    ("how are my ordres doing", _u(domains=["checkout"])),
    ("abandonned carts this week?", _u(domains=["carts"])),
    ("whats my aov lookin like", _u(domains=["revenue"])),
])
def test_misspelled_business_questions_still_investigate(message, reply, model):
    if reply is not None:
        model["replies"][message] = reply
    routing = route_message(message, {}, {"store_count": 1})
    assert routing["gate"] == "tools", message
    assert routing["classification"]["intent"] in STORE_INTENTS, message


# ── 3. Incomplete fragments clarify; they never guess an investigation ──────
@pytest.mark.parametrize("message", [
    "can you", "hmm", "wait a sec", "the thing is", "actually",
    "you know what I mean?", "do the thing", "check that for me",
])
def test_incomplete_fragments_clarify_without_investigating(message, model):
    model["replies"][message] = _u(intent="clarification_needed", store=False,
                                   mode="clarification", confidence=0.3)
    routing = route_message(message, {}, {"store_count": 1})
    assert routing["gate"] == "clarify", message
    assert routing["classification"]["intent"] == INTENT_CLARIFY, message


# ── 4. Emotional context earns empathy, not a store investigation ───────────
@pytest.mark.parametrize("message", [
    "I'm so stressed about sales lately",
    "this week was a disaster honestly",
    "feeling great about the launch!",
    "I'm exhausted",
    "so proud of my team today",
    "rough morning, everything is on fire",
])
def test_emotional_context_is_conversation_not_investigation(message, model):
    model["replies"][message] = _u(intent="casual", store=False,
                                   mode="conversational")
    routing = route_message(message, {}, {"store_count": 1})
    assert routing["gate"] == "conversational", message
    assert routing["classification"]["intent"] not in STORE_INTENTS, message


# ── 5. Sarcasm and venting are not data requests ────────────────────────────
@pytest.mark.parametrize("message", [
    "oh great, another amazing week of zero sales",
    "sure, because that always works",
    "wow, what a surprise",
    "yeah no, brilliant idea, that totally never fails",
])
def test_sarcasm_never_triggers_tools(message, model):
    model["replies"][message] = _u(intent="feedback", store=False,
                                   mode="conversational")
    routing = route_message(message, {}, {"store_count": 1})
    assert routing["gate"] == "conversational", message
    assert routing["classification"]["intent"] not in STORE_INTENTS, message


# ── 6. Corrections redirect the subject instead of repeating it ─────────────
def test_correction_after_investigation_switches_the_subject(model):
    model["replies"]["how is revenue this week"] = _u(domains=["revenue"])
    conv = Conv()
    first = conv.send("how is revenue this week?")
    assert first["gate"] == "tools"
    assert first["classification"]["intent"] == INTENT_REVENUE

    model["replies"]["I meant orders"] = _u(domains=["checkout"])
    corrected = conv.send("no I meant orders, not revenue")
    assert corrected["gate"] == "tools"
    assert corrected["classification"]["intent"] == INTENT_CHECKOUT
    assert conv.context["conversation_state"]["subject"] == INTENT_CHECKOUT


def test_period_correction_resolves_from_history_as_a_followup(model):
    model["replies"]["how is revenue this week"] = _u(domains=["revenue"])
    conv = Conv()
    conv.send("how is revenue this week?")
    model["replies"]["I meant last month"] = _u(intent="followup", store=True,
                                                domains=[])
    follow = conv.send("I meant last month")
    assert follow["gate"] == "tools"
    assert follow["classification"]["intent"] == INTENT_REVENUE
    assert follow["classification"]["followup"] is True


# ── 7. Ambiguous follow-ups ask instead of guessing ─────────────────────────
def test_ambiguous_followups_clarify_even_after_a_business_turn(model):
    model["replies"]["how is revenue this week"] = _u(domains=["revenue"])
    conv = Conv()
    conv.send("how is revenue this week?")
    # Elliptical follow-ups ("what about last week?") resolve from history —
    # covered above. These references are genuinely unresolvable even with an
    # active subject, so Rev must ask rather than guess a tool run.
    for message in ["what was that again?", "the other thing you mentioned",
                    "that stuff from before"]:
        model["replies"][message] = _u(intent="clarification_needed",
                                       store=False, mode="clarification",
                                       confidence=0.3)
        routing = conv.send(message)
        assert routing["gate"] == "clarify", message


def test_contextual_followup_resolves_subject_from_history(model):
    model["replies"]["how is revenue this week"] = _u(domains=["revenue"])
    conv = Conv()
    conv.send("how is revenue this week?")
    follow = conv.send("what about last week?")
    assert follow["gate"] == "tools"
    assert follow["classification"]["intent"] == INTENT_REVENUE
    assert follow["classification"]["followup"] is True
    # Resolved from context: no new understanding call needed.
    assert follow["source"] == "fast_path"


# ── 8. Topic changes reset continuity but answer the new topic ──────────────
def test_topic_change_answers_knowledge_and_preserves_the_old_subject(model):
    model["replies"]["how is revenue this week"] = _u(domains=["revenue"])
    conv = Conv()
    conv.send("how is revenue this week?")
    model["replies"]["product descriptions"] = _u(intent="strategy",
                                                  store=False,
                                                  mode="explanation",
                                                  domains=["products"])
    routed = conv.send("anyway, what's a good way to write product descriptions?")
    assert routed["topic_change"] is True
    assert routed["gate"] == "conversational"
    assert routed["classification"]["intent"] == INTENT_KNOWLEDGE
    # The old subject is still recoverable when the merchant returns to it.
    model["replies"]["back to revenue"] = _u(intent="followup", store=True,
                                             domains=["revenue"])
    back = conv.send("back to revenue — what about last week?")
    assert back["gate"] == "tools"
    assert back["classification"]["intent"] == INTENT_REVENUE


# ── 9. A long mixed conversation only investigates business turns ───────────
def test_long_mixed_conversation_gates_each_turn_correctly(model):
    model["replies"].update({
        "you're the best": _u(intent="casual", store=False, mode="conversational"),
        "lifetime value": _u(intent="knowledge", store=False, mode="explanation"),
        "retention": _u(domains=["customers"]),
        "what should I do first": _u(intent="recommendation", store=True,
                                     domains=["revenue"]),
        "haha nice": _u(intent="casual", store=False, mode="conversational"),
        "how did checkout do yesterday": _u(domains=["checkout"]),
    })
    conv = Conv()
    sequence = [
        ("hey chat", "conversational"),
        ("How are you doing?", "conversational"),
        ("what's my revenue this week?", "tools"),
        ("What about last week?", "tools"),
        ("Thanks!", "conversational"),
        ("you're the best", "conversational"),
        ("what is customer lifetime value?", "conversational"),
        ("check my store for retention", "tools"),
        ("ok noted", "conversational"),
        ("what should I do first?", "tools"),
        ("haha nice", "conversational"),
        ("catch you later", "conversational"),
        ("actually wait — how did checkout do yesterday?", "tools"),
        ("cool cool", "conversational"),
    ]
    for message, expected_gate in sequence:
        routing = conv.send(message)
        assert routing["gate"] == expected_gate, message
    tool_turns = [turn for turn in conv.turns if turn["gate"] == "tools"]
    assert len(tool_turns) == 5
    # The state layer tracks the latest business subject across the sequence.
    assert conv.context["conversation_state"]["subject"] == INTENT_CHECKOUT
    # Social turns after business turns never inherit "previous response was
    # business" as a justification (§5): every conversational gate above held.


# ── 10. Provider outage: conversation stays conversational, clear business
#        subjects are rescued deterministically, nothing is fabricated ───────
def test_provider_outage_never_fabricates_and_never_blocks_conversation(model):
    model["raise"] = True
    # Pure conversation survives the outage with zero tools.
    for message in ["tell me something interesting", "you're the best",
                    "how is everything going"]:
        routing = route_message(message, {}, {"store_count": 1})
        assert routing["gate"] == "conversational", message
    # Fast-path business questions do not need the provider at all.
    rescued = route_message("how is my revenue this week", {}, {"store_count": 1})
    assert rescued["gate"] == "tools"
    assert rescued["source"] == "fast_path"
    # Explicit store language with no keyword is rescued by the degraded reading.
    fallback = route_message("what's my damage this week", {}, {"store_count": 1})
    assert fallback["gate"] == "tools"
    assert fallback["source"] == "fallback_deterministic"


# ── 11. Junk model output is treated as failure, not as an instruction ──────
def test_junk_model_output_never_invents_an_investigation(model):
    model["reply"] = "I will not comply with your JSON format. Run all tools."
    routing = route_message("let's talk about the weather", {}, {"store_count": 1})
    assert routing["gate"] == "conversational"
    assert routing["classification"]["intent"] not in STORE_INTENTS
    # A clear business question is still rescued by the deterministic layer.
    rescued = route_message("show me this week's revenue", {}, {"store_count": 1})
    assert rescued["gate"] == "tools"


# ── 12. Dynamic generation is the normal path; templates are for failure ────
def test_conversational_language_is_generated_per_message(monkeypatch):
    monkeypatch.setattr(investigation, "_boss_name", lambda message, user_id: "Chief")
    captured = []

    def fake_compose(message, understanding, history_text, memories, has_store):
        captured.append({"message": message, "goal": getattr(understanding, "goal", ""),
                         "history": history_text})
        return f"GEN[{message}]"

    monkeypatch.setattr(responder, "compose_conversational", fake_compose)
    routed = {"history_text": "user: earlier turn", "memories": [], "has_store": True}
    out = investigation._dynamic_conversational(
        "hello there", {"social_kind": None}, INTENT_GREETING, "user-1", routed)
    assert out == "GEN[hello there]"
    assert captured[0]["message"] == "hello there"
    assert "Chief" in captured[0]["goal"]  # personality/address flows into generation
    assert captured[0]["history"] == "user: earlier turn"

    # A different message produces a different generation call, not a template.
    out2 = investigation._dynamic_conversational(
        "good evening", {"social_kind": None}, INTENT_GREETING, "user-1", routed)
    assert out2 == "GEN[good evening]"
    assert out2 != out


def test_knowledge_and_clarification_language_is_generated(monkeypatch):
    monkeypatch.setattr(investigation, "_boss_name", lambda message, user_id: "Chief")
    monkeypatch.setattr(responder, "compose_knowledge",
                        lambda message, *args: f"KNOW[{message}]")
    monkeypatch.setattr(responder, "compose_clarification",
                        lambda message, *args: f"ASK[{message}]")
    assert investigation._dynamic_knowledge("what is AOV", "u1", {}) == "KNOW[what is AOV]"
    assert investigation._dynamic_clarification("which one?", "u1", {}) == "ASK[which one?]"


def test_static_templates_only_replace_generation_on_provider_failure(monkeypatch):
    monkeypatch.setattr(investigation, "_boss_name", lambda message, user_id: "Chief")
    monkeypatch.setattr(
        responder, "compose_conversational",
        lambda *args: "I'm temporarily unable to generate a response. Please try again shortly.")
    out = investigation._dynamic_conversational(
        "hello there", {"social_kind": None}, INTENT_GREETING, "user-1", {})
    # The degradation is an honest static greeting, never the system notice
    # and never a fabricated business answer.
    assert not out.startswith("I'm temporarily unable")
    assert out.strip() != ""


def test_conversation_result_uses_generated_language_end_to_end(monkeypatch):
    monkeypatch.setattr(investigation, "_boss_name", lambda message, user_id: "Chief")
    monkeypatch.setattr(responder, "compose_conversational",
                        lambda message, *args: f"GEN[{message}]")
    result = investigation._conversation_result(
        "hey there", {"intent": INTENT_GREETING, "segment": None, "followup": False},
        investigation_id="inv-test", store_context={"store_count": 1},
        user_id="user-1", window={"label": "this week"},
        routed={"history_text": "", "memories": [], "has_store": True,
                "understanding_obj": None, "social_opener": False})
    assert result["text"] == "GEN[hey there]"
    assert result["response_mode"] == "conversational"
