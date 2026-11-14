"""Shared fixtures for provider-independent behavioral regression suites."""
from __future__ import annotations

import pytest


_OFFLINE_COMPOSER_MODULES = {
    "test_greeting_experience",
    "test_rev_adaptive_response",
    "test_rev_contextual_followups",
    "test_rev_epistemic_pipeline",
    "test_rev_prompt_injection",
    "test_social_conversation",
    "test_task_205_guardrails",
    "test_task_207_investigation_outcomes",
}


def _offline_conversation(message: str, *_args, **_kwargs) -> str:
    """Deterministic copy for tests of routing/contracts, not prose generation."""
    text = (message or "").strip().lower()
    greetings = (
        "hello", "hi", "hey", "good morning", "good afternoon", "good evening",
        "hiya", "howdy", "yo",
    )
    if text.startswith(greetings):
        return "Hi, good to see you. What would you like to look at?"
    if text in {"thank you!", "thanks rev", "appreciate it", "well done"} \
            or text.startswith("thank you"):
        return "You're welcome."
    if text.startswith(("bye", "goodbye", "see you", "good night", "have a good day")):
        return "Goodbye. Take care."
    wellbeing = (
        "how are you", "how's it going", "how are things", "how was your day",
        "how do you feel", "how have you been", "are you okay", "what's up",
        "what are you up to", "how's life",
    )
    if text.startswith(wellbeing):
        return "I'm here and ready to help. What would you like to explore?"
    if text == "what's on your mind?":
        return "I'm here. What would you like to understand or investigate?"
    if "already updated the product" in text:
        return "That is not as independent verification; I cannot confirm the issue is fixed from that alone."
    write_requests = (
        "fix my pricing", "send recovery emails", "change my product inventory",
        "launch an advertising campaign", "refund this customer order", "apply this discount",
    )
    if any(action in text for action in write_requests):
        return "I can't make changes to your store."
    return "I can only help with your authorized store data."


@pytest.fixture(autouse=True)
def _stub_optional_composers_for_contract_tests(request, monkeypatch):
    """Avoid API dependency for tests whose assertions target deterministic contracts."""
    module_name = request.module.__name__.rsplit(".", 1)[-1]
    if module_name not in _OFFLINE_COMPOSER_MODULES:
        return

    from src.agents import responder

    monkeypatch.setattr(responder, "compose_conversational", _offline_conversation)
    monkeypatch.setattr(
        responder,
        "compose_knowledge",
        lambda *_args, **_kwargs: "Here is a concise general explanation for this question.",
    )
    monkeypatch.setattr(
        responder,
        "compose_clarification",
        lambda *_args, **_kwargs: "Which period would you like me to compare?",
    )
