"""Adaptive public web research on the capability-aware gateway (provider synthetic)."""
from __future__ import annotations

import json

import pytest

from src.agents import agent_gateway, objective_agent
from src.agents.model_gateway import ModelProviderError


def _search(summary, urls, **extra):
    return {"status": "ok", "summary": summary, "provider": "anthropic", "model": "claude-haiku-4-5-20251001",
            "sources": [{"url": url, "title": f"Title {index}"} for index, url in enumerate(urls)],
            "searches": 1, "attempts": 1, "fallback_used": False, "usage": {"input_tokens": 100, "output_tokens": 20},
            **extra}


def _decision(name, arguments=None):
    return {"text": "", "tool_calls": [{"id": "d", "name": name, "arguments": arguments or {}}],
            "usage": {"input_tokens": 30, "output_tokens": 5}, "provider": "anthropic",
            "model": "claude-haiku-4-5-20251001", "attempts": 1, "fallback_used": False,
            "assistant": {"role": "assistant", "content": []}}


def test_result_is_inspected_before_refined_search_and_sources_are_verified(monkeypatch):
    searches = []
    outputs = iter([
        _search("Official update is live [1]. See https://unverified.example.test/x", ["https://docs.example.test/current"]),
        _search("Follow-up detail.", ["https://status.example.test/latest"]),
    ])
    monkeypatch.setattr(agent_gateway, "web_search", lambda query, **kw: (searches.append(query), next(outputs))[1])
    prompts = []
    monkeypatch.setattr(agent_gateway, "chat", lambda **kw: (prompts.append(kw), _decision(
        "search_public_web", {"query": "official status update details"}))[1])

    result = objective_agent.run_adaptive_web_research(question="What is the current service status?")

    assert searches == ["What is the current service status?", "official status update details"]
    assert "https://docs.example.test/current" in json.dumps(prompts[0]["messages"])
    assert result["trace"]["calls"] == 2 and result["trace"]["model_directed"] is True
    assert result["trace"]["provider"] == "anthropic"
    assert result["trace"]["citations"] == ["https://docs.example.test/current", "https://status.example.test/latest"]
    assert "https://status.example.test/latest" in result["text"]
    assert "unverified.example.test" not in result["text"]  # only verified source URLs survive
    assert "[1]" not in result["text"]
    assert result["trace"]["input_tokens"] == 230


def test_search_without_sources_fails_honestly_without_followup(monkeypatch):
    monkeypatch.setattr(agent_gateway, "web_search", lambda *a, **k: {
        "status": "no_sources", "summary": "", "sources": [], "provider": "anthropic", "model": "m",
        "failure_category": "no_verifiable_sources", "usage": {}})
    monkeypatch.setattr(agent_gateway, "chat", lambda **k: pytest.fail("do not adapt unverifiable search output"))
    result = objective_agent.run_adaptive_web_research(question="Latest update?")
    assert "couldn't verify current web sources" in result["text"]
    assert result["trace"]["status"] == "search_unavailable"
    assert result["trace"]["failure_category"] == "no_verifiable_sources"


def test_no_search_capable_provider_is_reported(monkeypatch):
    monkeypatch.setenv("AI_PROVIDER", "anthropic")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("AI_FALLBACK_PROVIDERS", raising=False)
    agent_gateway.clear_web_cache()
    result = objective_agent.run_adaptive_web_research(question="Latest Shopify news?")
    assert result["trace"]["failure_category"] == "unsupported_capability"
    assert "no search-capable model provider" in result["text"]


def test_inspection_failure_keeps_grounded_result_as_partial(monkeypatch):
    monkeypatch.setattr(agent_gateway, "web_search", lambda *a, **k: _search("Grounded fact.", ["https://a.example/x"]))

    def fail(**kwargs):
        raise ModelProviderError("anthropic", 503)

    monkeypatch.setattr(agent_gateway, "chat", fail)
    result = objective_agent.run_adaptive_web_research(question="q?")
    assert result["trace"]["status"] == "partial_adaptation_failure"
    assert "Grounded fact." in result["text"] and "https://a.example/x" in result["text"]


def test_unverifiable_third_party_causal_claims_are_not_presented(monkeypatch):
    monkeypatch.setattr(agent_gateway, "web_search", lambda *a, **k: _search(
        "Shopify released an update. Sales dropped due to the new checkout.", ["https://a.example/x"]))
    monkeypatch.setattr(agent_gateway, "chat", lambda **k: _decision("finish_research"))
    result = objective_agent.run_adaptive_web_research(question="q?")
    assert "due to" not in result["text"]
    assert "Shopify released an update." in result["text"]
    assert result["trace"]["sources_omitted_sentences"] == 1


def test_private_refined_query_is_rejected(monkeypatch):
    calls = []
    monkeypatch.setattr(agent_gateway, "web_search", lambda q, **k: (calls.append(q), _search("Fact.", ["https://a.example/x"]))[1])
    monkeypatch.setattr(agent_gateway, "chat", lambda **k: _decision(
        "search_public_web", {"query": "orders for buyer@example.com"}))
    result = objective_agent.run_adaptive_web_research(question="q?")
    assert calls == ["q?"]
    assert result["trace"]["status"] == "invalid_followup_query"
