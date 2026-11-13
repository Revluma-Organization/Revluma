"""Greeting experience contract.

A merchant saying hello is not asking for an investigation. These tests pin:
- whole-message greetings classify as INTENT_GREETING and bypass evidence tools;
- the fallback greeting is short and natural, with no capability pitch;
- a form of address is used only when explicitly requested;
- the greeting payload stays conversational and contains no findings or tools.
"""

from src.agents.investigation import (
    INTENT_GREETING,
    RESPONSE_MODE_CONVERSATIONAL,
    _boss_name,
    _conversation_result,
    classify_investigation,
    select_response_mode,
)

GREETINGS = [
    "Hello",
    "hello",
    "Hi",
    "hey",
    "Hello chat",
    "hello chat",
    "hi rev",
    "hey there",
    "Hey!",
    "hey 👋",
    "Hello, everyone",
    "good morning",
    "Good morning rev",
    "good afternoon!",
    "good evening",
    "hiya",
    "howdy",
    "yo",
]

NOT_GREETINGS = [
    "hello why did my revenue drop",
    "hi can you check my sync",
    "hey what are my sales this week",
    "good morning — is my store connected?",
    "hello i want to compare last week and this week",
]


def _result(message: str, user_id: str = "user-1") -> dict:
    classification = classify_investigation(message, {})
    assert classification["intent"] == INTENT_GREETING, message
    return _conversation_result(
        message, classification, investigation_id="inv-1",
        store_context={}, user_id=user_id,
        window={"start": "2026-10-28", "end": "2026-11-04", "timezone": "UTC"},
    )


def test_whole_message_greetings_classify_as_greeting():
    for message in GREETINGS:
        assert classify_investigation(message, {})["intent"] == INTENT_GREETING, message


def test_business_questions_are_not_swallowed_by_the_greeting_rule():
    for message in NOT_GREETINGS:
        assert classify_investigation(message, {})["intent"] != INTENT_GREETING, message


def test_greeting_answer_is_natural_and_brief():
    result = _result("Hello chat")
    text = result["text"]
    assert text == "Hi, good to see you. What would you like to look at?"
    assert "\n\n" not in text
    assert len(text) <= 80
    for marker in ("I can help with your store's revenue", "starting point",
                   "data coverage", "inventory and", "ecommerce advice"):
        assert marker not in text, marker


def test_greeting_payload_is_quiet_conversational_with_no_chrome():
    result = _result("hey there")
    assert result["response_mode"] == RESPONSE_MODE_CONVERSATIONAL
    assert result["response_type"] == "chat"
    assert result["investigation"]["steps"] == []
    assert result["investigation"]["tools_used"] == []
    assert result.get("facts", []) == [] and result.get("comparison_facts", []) == []
    assert result["investigation"]["follow_ups"] == []
    mode, _reason = select_response_mode(
        intent=INTENT_GREETING, status=result["investigation"]["status"],
        tool_names=[], evidence_items=result["evidence"]["items"],
        comparison_facts=[], hypotheses=[])
    assert mode == RESPONSE_MODE_CONVERSATIONAL


def test_only_explicit_address_preferences_are_used():
    assert _boss_name("hello, call me Queen", "u") == "Queen"
    assert _boss_name("hey, call me mama", "u") == "Mama"
    assert _boss_name("hello I'm a woman building my brand", "u") == ""
    assert _boss_name("hello", "u") == ""


def test_greeting_copy_carries_no_internal_notation():
    prohibited = ("half-open", "[start", "store(s)", "finding(s)", "coverage status",
                  "evidence item", "tool", "endpoint", "sql", "confidence score")
    for message in ("Hello", "Hello chat", "hey 👋"):
        lowered = _result(message)["text"].lower()
        for term in prohibited:
            assert term not in lowered, (message, term)
