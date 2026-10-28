from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

from src.agents import orchestrator, responder


def test_connected_store_is_friendly_and_verified():
    db = MagicMock()
    db.execute.return_value.mappings.return_value.all.return_value = [{
        "platform": "shopify",
        "shop_domain": "sample-shop.myshopify.com",
        "status": "connected",
        "has_token": True,
        "last_synced_at": datetime(2026, 10, 28, 16, 8, tzinfo=timezone.utc),
    }]
    reply = orchestrator._verified_store_connection_answer("org-1", db)
    assert "Good news" in reply
    assert "sample-shop.myshopify.com" in reply
    assert "28 October 2026 at 16:08 UTC" in reply
    assert "orders and checkout activity" in reply
    assert "+00:00" not in reply


def test_unverified_store_is_never_called_connected():
    db = MagicMock()
    db.execute.return_value.mappings.return_value.all.return_value = [{
        "platform": "shopify", "shop_domain": "sample-shop.myshopify.com",
        "status": "error", "has_token": False, "last_synced_at": None,
    }]
    reply = orchestrator._verified_store_connection_answer("org-1", db)
    assert "connection is not verified" in reply
    assert "is connected in Revluma!" not in reply


def test_greeting_prompt_is_warm_and_preserves_history(monkeypatch):
    captured = []
    monkeypatch.setattr(responder, "_call", lambda model, prompt, max_tokens, timeout: captured.append(prompt) or "Hey, Captain! I'm doing well. How are you doing today?")
    result = responder.compose_conversational(
        "Hey Rev, how are you?",
        SimpleNamespace(intent="greeting", goal="greet"),
        "Merchant: Yesterday we discussed retention.", [], True,
    )
    assert "Captain" in result
    assert "Yesterday we discussed retention" in captured[0]
    assert "greet back" in captured[0].lower()
    assert "do not force" in captured[0].lower()


def test_preferred_title_instruction_present(monkeypatch):
    prompts = []
    monkeypatch.setattr(responder, "_call", lambda model, prompt, max_tokens, timeout: prompts.append(prompt) or "Good to see you, Commander.")
    responder.compose_conversational(
        "Please call me Commander",
        SimpleNamespace(intent="preference", goal="preferred address"),
        "", [], True,
    )
    assert "Honor an explicitly stated preferred title" in prompts[0]
    assert "Please call me Commander" in prompts[0]
