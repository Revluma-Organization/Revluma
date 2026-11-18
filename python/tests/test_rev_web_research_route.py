"""Regression coverage for current-web research on the merchant SSE endpoint.

The HTTP route, production investigation router, and responder execute for real;
only the model boundary is synthetic, so this does not claim live search success.
"""
from __future__ import annotations

import json

from fastapi.testclient import TestClient

from src.agents import agent_gateway, investigation, model_gateway, understanding
from src.intelligence import knowledge_retrieval
from src.intelligence.operational_metrics import reset_for_tests, snapshot
from src.serving import api
from tests.test_rev_investigation import CONV, ORG, USER, workspace_db


async def _allow_internal_test_call():
    return None


def test_rev_stream_routes_current_research_to_grounded_search(monkeypatch):
    """Fallback path: the knowledge agent runtime cannot run, so the adaptive
    grounded-research path answers. The authoritative agent path is covered by
    test_rev_knowledge_agent.py."""
    monkeypatch.setattr(investigation, "_knowledge_agent_answer", lambda *args, **kwargs: None)
    monkeypatch.setitem(
        api.app.dependency_overrides,
        api.verify_internal_caller,
        _allow_internal_test_call,
    )
    monkeypatch.setattr(api, "_Session", lambda: workspace_db())

    understanding_histories = []

    def web_research_understanding(message, history, **kwargs):
        understanding_histories.append(history)
        return understanding.Understanding(
            intent="web_research",
            goal="find current public information",
            requires_store_data=False,
            requires_web=True,
            requires_action=False,
            response_mode=understanding.MODE_EXPLANATION,
            confidence=0.95,
        )

    reset_for_tests()
    agent_gateway.clear_web_cache()
    provider_calls = []

    def grounded_search(query, **kwargs):
        provider_calls.append((query, kwargs))
        return {"status": "ok", "summary": "Current public result.",
                "sources": [{"url": "https://example.org/current-source", "title": "Current source"}],
                "provider": "gemini", "model": "gemini-test", "searches": 1, "attempts": 1,
                "fallback_used": False, "duration_ms": 12,
                "usage": {"input_tokens": 200, "output_tokens": 30}}

    selection_calls = []
    def finish_after_inspection(**kwargs):
        selection_calls.append(kwargs)
        return {"text": "", "tool_calls": [{"id": "f", "name": "finish_research", "arguments": {}}],
                "usage": {"input_tokens": 50, "output_tokens": 4}, "provider": "gemini",
                "model": "gemini-test", "attempts": 1, "fallback_used": False,
                "assistant": {"role": "assistant", "content": []}}

    monkeypatch.setattr(understanding, "understand", web_research_understanding)
    monkeypatch.setattr(agent_gateway, "web_search", grounded_search)
    monkeypatch.setattr(agent_gateway, "chat", finish_after_inspection)
    question = "What are the latest ecommerce platform changes?"
    private_marker = "PRIVATE ORDER 12345 customer@example.com"
    payload = {
        "contract_version": "1.0",
        "organization_id": ORG,
        "user_id": USER,
        "conversation_id": CONV,
        "message": question,
        "context_payload": {
            "conversation_context": {
                "summary": private_marker,
                "context_window": json.dumps({
                    "recent_turns": [private_marker],
                    "last_selected_finding": {
                        "finding_id": "33333333-3333-4333-8333-333333333333"
                    },
                }),
            }
        },
    }

    response = TestClient(api.app).post("/rev/stream", json=payload)

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    final_payloads = []
    for frame in response.text.strip().split("\n\n"):
        lines = frame.splitlines()
        if lines and lines[0] == "event: final":
            final_payloads.append(json.loads("\n".join(
                line.removeprefix("data: ") for line in lines[1:] if line.startswith("data: ")
            )))
    assert len(final_payloads) == 1
    final = final_payloads[0]
    assert final["success"] is True
    assert final["response_type"] == "chat"  # preserve the existing Node/UI contract
    assert final["text"].startswith("Current public result.")
    assert "https://example.org/current-source" in final["text"]
    assert final["investigation"]["intent"] == "knowledge"
    assert final["investigation"]["tools_used"] == []
    assert final.get("selected_finding") is None
    assert final["evidence"]["items"] == []
    assert final["orchestration"]["tools"] == []
    assert final["orchestration"]["max_tool_count"] == 12
    assert final["knowledge_route"]["sources"] == ["live_web"]
    assert final["knowledge_route"]["private_tenant_context"] is False
    metrics = snapshot()
    assert "stage_routing" in metrics["latency_ms"]
    assert "stage_web_research" in metrics["latency_ms"]
    assert "stage_execution_total" in metrics["latency_ms"]
    assert any(counter["name"] == "rev_knowledge_routes_total"
               and counter["labels"].get("route") == "current_web_research"
               for counter in metrics["counters"])
    assert understanding_histories == [[]]
    assert len(provider_calls) == 1
    query, _ = provider_calls[0]
    assert query == question
    assert private_marker not in query
    assert len(selection_calls) == 1
    selection_prompt = json.dumps(selection_calls[0]["messages"])
    assert "https://example.org/current-source" in selection_prompt
    assert "PRIVATE ORDER" not in selection_prompt
    assert {tool["name"] for tool in selection_calls[0]["tools"]} == {
        "search_public_web", "finish_research"}
    assert final["execution_trace"]["token_usage"]["input"] == 250
    assert final["execution_trace"]["provider"] == "gemini"
    assert final["execution_trace"]["citations"] == [
        "https://example.org/current-source"]


def test_unrelated_why_question_is_rerouted_without_prior_finding_context(monkeypatch):
    monkeypatch.setitem(
        api.app.dependency_overrides,
        api.verify_internal_caller,
        _allow_internal_test_call,
    )
    monkeypatch.setattr(api, "_Session", lambda: workspace_db())
    understanding_calls = []

    def general_understanding(message, history, **kwargs):
        understanding_calls.append((message, history))
        return understanding.Understanding(
            intent="strategy",
            goal="explain an unrelated public concept",
            requires_store_data=False,
            requires_web=False,
            requires_action=False,
            response_mode=understanding.MODE_EXPLANATION,
            confidence=0.95,
        )

    provider_prompts = []

    def answer_provider(prompt, **kwargs):
        provider_prompts.append(prompt)
        return "Inflation has several macroeconomic drivers."

    monkeypatch.setattr(understanding, "understand", general_understanding)
    monkeypatch.setattr(model_gateway, "generate", answer_provider)
    payload = {
        "contract_version": "1.0",
        "organization_id": ORG,
        "user_id": USER,
        "conversation_id": CONV,
        "message": "Why is inflation high?",
        "context_payload": {
            "conversation_context": {
                "last_investigation": {"intent": "revenue_investigation"},
                "context_window": json.dumps({
                    "last_selected_finding": {
                        "finding_id": "33333333-3333-4333-8333-333333333333"
                    },
                    "recent_turns": [{"role": "user", "text": "PRIVATE PREVIOUS STORE QUESTION"}],
                }),
            }
        },
    }

    response = TestClient(api.app).post("/rev/stream", json=payload)

    assert response.status_code == 200
    final = next(
        json.loads("\n".join(
            line.removeprefix("data: ") for line in frame.splitlines()[1:]
            if line.startswith("data: ")
        ))
        for frame in response.text.strip().split("\n\n")
        if frame.startswith("event: final")
    )
    assert final["investigation"]["intent"] == "knowledge"
    assert final.get("selected_finding") is None
    assert final["investigation"]["tools_used"] == []
    assert understanding_calls == [("Why is inflation high?", [])]
    assert provider_prompts and "PRIVATE PREVIOUS STORE QUESTION" not in provider_prompts[0]


def test_private_knowledge_route_retrieves_only_opted_in_tenant_memories(monkeypatch):
    monkeypatch.setitem(
        api.app.dependency_overrides,
        api.verify_internal_caller,
        _allow_internal_test_call,
    )
    monkeypatch.setattr(api, "_Session", lambda: workspace_db())
    reset_for_tests()

    question = "What are my store's top products?"
    private_context = "PRIVATE MERCHANT PRODUCT PREFERENCE"
    u = understanding.Understanding(
        intent="knowledge", goal="answer the merchant-specific context question",
        requires_store_data=False, requires_web=False, requires_action=False,
        response_mode=understanding.MODE_EXPLANATION, confidence=0.95,
    )
    monkeypatch.setattr(investigation, "route_message", lambda *args, **kwargs: {
        "classification": {"intent": investigation.INTENT_KNOWLEDGE},
        "understanding": {"intent": "knowledge", "confidence": 0.95},
        "understanding_obj": u, "source": "understanding", "gate": "conversational",
        "topic_change": False, "social_opener": False,
        "correlation_id": kwargs.get("correlation_id"),
    })

    retrieval_calls = []

    def retrieve(db, organization_id, user_id, query, *, route, top_k=8):
        retrieval_calls.append((organization_id, user_id, query, route.private_tenant_context))
        return ([{"memory_value": private_context}], {
            "source": "tenant_memory", "status": "success", "result_count": 1,
        })

    monkeypatch.setattr(knowledge_retrieval, "retrieve_tenant_memories", retrieve)

    composer_args = []

    def compose(message, understanding_obj, history, memories, has_store, **kwargs):
        composer_args.append((history, memories, has_store))
        return "A response using only the opted-in merchant context."

    monkeypatch.setattr("src.agents.responder.compose_knowledge", compose)

    payload = {
        "contract_version": "1.0", "organization_id": ORG, "user_id": USER,
        "conversation_id": CONV, "message": question,
        "context_payload": {"conversation_context": {"summary": "unrelated prior context"}},
    }
    response = TestClient(api.app).post("/rev/stream", json=payload)
    assert response.status_code == 200
    final = next(
        json.loads("\n".join(
            line.removeprefix("data: ") for line in frame.splitlines()[1:]
            if line.startswith("data: ")
        ))
        for frame in response.text.strip().split("\n\n")
        if frame.startswith("event: final")
    )
    assert retrieval_calls == [(ORG, USER, question, True)]
    assert composer_args == [("", [{"memory_value": private_context}], True)]
    assert final["knowledge_route"]["private_tenant_context"] is True
    assert final["knowledge_route"]["tenant_memory_retrieval"]["status"] == "success"
