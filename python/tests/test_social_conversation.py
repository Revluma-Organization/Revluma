"""Mutual conversation (merchant complaint 2026-11-04, CONV-001).

"How are you doing?" ran the full evidence pipeline and answered with a
store report. A question addressed to Rev is conversation, not analysis:
these tests pin the social route, the business-noun guard that keeps real
questions investigating, the quiet conversational payload, and the
sentence-level fact dedupe that stopped "Recorded order value ..." from
appearing twice in one answer.
"""

import re

from src.agents.investigation import (
    INTENT_GENERAL,
    INTENT_OVERVIEW,
    INTENT_SOCIAL,
    RESPONSE_MODE_CONVERSATIONAL,
    STATUS_AVAILABLE,
    STORE_INTENTS,
    _conversation_result,
    _facts_from_items,
    classify_investigation,
    select_response_mode,
)

SOCIAL_MESSAGES = [
    "How are you doing?",
    "how are you?",
    "How are you",
    "how's it going?",
    "how are things?",
    "how was your day?",
    "how do you feel today?",
    "how have you been?",
    "are you okay?",
    "what's up?",
    "what are you up to?",
    "how's life?",
    "thank you!",
    "thanks rev",
    "appreciate it",
    "well done",
    "bye!",
    "goodbye",
    "see you later",
    "good night",
    "have a good day",
]

BUSINESS_GUARD_MESSAGES = [
    "how are you doing on my sales this week?",
    "how are you doing on orders?",
    "thank you — now check my sync",
    "thanks, what about my revenue?",
    "bye the way, is my store connected?",
]

GOLDEN_OVERVIEW_PROMPTS = [
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
]


def _result(message: str) -> dict:
    classification = classify_investigation(message, {})
    assert classification["intent"] == INTENT_SOCIAL, message
    return _conversation_result(
        message, classification, investigation_id="inv-social",
        store_context={}, user_id="user-1",
        window={"start": "2026-10-28", "end": "2026-11-04", "timezone": "UTC"},
    )


def test_social_messages_route_to_conversation():
    for message in SOCIAL_MESSAGES:
        assert classify_investigation(message, {})["intent"] == INTENT_SOCIAL, message


def test_store_domain_nouns_keep_the_business_reading():
    for message in BUSINESS_GUARD_MESSAGES:
        assert classify_investigation(message, {})["intent"] != INTENT_SOCIAL, message


def test_overview_prompts_still_investigate():
    for message in GOLDEN_OVERVIEW_PROMPTS:
        intent = classify_investigation(message, {})["intent"]
        assert intent in STORE_INTENTS and intent != INTENT_SOCIAL, (message, intent)


def test_how_is_my_store_doing_still_overview():
    assert classify_investigation("how is my store doing?", {})["intent"] == INTENT_OVERVIEW
    assert classify_investigation("how are sales performing?", {})["intent"] in STORE_INTENTS


def test_wellbeing_reply_is_mutual_and_data_free():
    text = _result("How are you doing?")["text"]
    assert "thanks for asking" in text
    assert "?" in text and "working on today" in text
    assert not re.search(r"\d|\$|USD", text), text
    for term in ("evidence", "investigation", "recorded order", "coverage"):
        assert term not in text.lower(), (term, text)


def test_thanks_and_farewell_replies():
    assert "Anytime," in _result("thank you!")["text"]
    assert "See you later" in _result("bye!")["text"]


def test_social_payload_is_quiet_conversational_with_no_tools():
    result = _result("how are you?")
    assert result["response_mode"] == RESPONSE_MODE_CONVERSATIONAL
    assert result["response_type"] == "chat"
    assert result["investigation"]["tools_used"] == []
    assert result["investigation"]["steps"] == []
    mode, _ = select_response_mode(
        intent=INTENT_SOCIAL, status=result["investigation"]["status"],
        tool_names=[], evidence_items=result["evidence"]["items"],
        comparison_facts=[], hypotheses=[])
    assert mode == RESPONSE_MODE_CONVERSATIONAL


def test_unsignalled_chatter_gets_a_conversational_offer_not_a_capability_wall():
    classification = classify_investigation("what's on your mind?", {})
    assert classification["intent"] == INTENT_GENERAL
    result = _conversation_result(
        "what's on your mind?", classification, investigation_id="inv-x",
        store_context={}, user_id="user-1",
        window={"start": "2026-10-28", "end": "2026-11-04", "timezone": "UTC"})
    assert result["text"].startswith("I'm all ears,")
    assert result["text"].endswith("What's on your mind today?")


def test_identical_fact_sentences_cite_together_instead_of_repeating():
    items = [
        {"id": "ev-rev", "metric": "recorded_order_value", "value": 2321.85,
         "currency": "USD", "status": STATUS_AVAILABLE, "source": "revenue_observations"},
        {"id": "ev-ord", "metric": "recorded_order_value", "value": 2321.85,
         "currency": "USD", "status": STATUS_AVAILABLE, "source": "order_observations"},
        {"id": "ev-count", "metric": "recorded_order_count", "value": 2,
         "currency": "USD", "status": STATUS_AVAILABLE, "source": "order_observations"},
    ]
    facts = _facts_from_items(items, INTENT_OVERVIEW)
    texts = [fact["text"] for fact in facts]
    assert len(texts) == len(set(texts)), texts
    value_fact = next(f for f in facts if f["text"].startswith("Recorded order value"))
    assert value_fact["evidence_ids"] == ["ev-rev", "ev-ord"]
