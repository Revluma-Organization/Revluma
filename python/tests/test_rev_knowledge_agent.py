"""Knowledge-agent source boundaries (requirement 1).

PROVIDER-MOCKED where a model is involved: the agent runtime, gateways,
knowledge tools, public-query guard, validation and telemetry run for real;
only the Gemini HTTP endpoint is scripted (``tests.rev_provider_fakes``).
These are contract tests, not evidence of live-provider answer quality.

Boundaries proven here:
* Revluma documentation comes from the runtime registry (never claimed as a
  broader corpus); Shopify documentation is a live search restricted to
  official hosts and is offered only when a search-capable provider exists.
* General ecommerce knowledge has no ingested corpus, and answers say so.
* Private tenant context is recalled only for explicit tenant questions,
  from memories already retrieved for this request, and never leaves the
  request through a public search query.
* With no provider configured, nothing is fabricated: the agent does not run
  and the trace records the fallback.
"""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from src.agents import investigation
from src.intelligence import knowledge_retrieval
from src.intelligence import knowledge_sources as ks
from src.intelligence.knowledge_retrieval import (
    REV_PRODUCT_DOCS, SHOPIFY_DOCS, TENANT_MEMORY, resolve_knowledge_route,
)
from src.serving import api
from tests.rev_provider_fakes import FakeGemini, parse_sse, understanding
from tests.test_rev_investigation import CONV, ORG, USER, workspace_db

TENANT_GOAL = {"memory_key": "growth_goal", "memory_value": "Grow wholesale accounts in Kano before Ramadan",
               "memory_type": "goal", "memory_source": "merchant"}


async def _allow_internal_caller():
    return None


@pytest.fixture
def stream(monkeypatch):
    monkeypatch.setitem(api.app.dependency_overrides, api.verify_internal_caller, _allow_internal_caller)
    monkeypatch.setattr(api, "_Session", workspace_db)

    def run(message, *, expect="final"):
        response = TestClient(api.app).post("/rev/stream", json={
            "contract_version": "1.0", "organization_id": ORG, "user_id": USER,
            "conversation_id": CONV, "message": message})
        assert response.status_code == 200
        events = parse_sse(response.text)
        assert events[-1][0] == expect, [name for name, _ in events]
        return events[-1][1]
    return run


@pytest.fixture
def provider(monkeypatch):
    return FakeGemini().install(monkeypatch)


def _specs(route, *, manifest=None, memories=None):
    return investigation._knowledge_tool_specs(
        route=route.to_dict(), message="How do Shopify webhooks work?",
        routed={"memories": memories or []}, manifest=manifest or ks.source_manifest(),
        correlation_id=None, investigation_id="inv-1", cancelled=None)


# ---------------------------------------------------------------------------
# Source manifest and tool exposure (no model involved)
# ---------------------------------------------------------------------------

def test_source_manifest_reports_real_ingestion_coverage_without_provider(monkeypatch):
    for name in ("GEMINI_API_KEY", "ANTHROPIC_API_KEY", "AI_FALLBACK_PROVIDERS"):
        monkeypatch.delenv(name, raising=False)
    manifest = ks.source_manifest()

    assert manifest[SHOPIFY_DOCS]["status"] == "unavailable"
    assert manifest[SHOPIFY_DOCS]["coverage"]["allowed_domains"] == [
        "shopify.dev", "help.shopify.com", "changelog.shopify.com"]
    assert manifest[SHOPIFY_DOCS]["coverage"]["ingested_documents"] == 0  # live search only, no corpus claim
    assert manifest[REV_PRODUCT_DOCS]["status"] == "available"
    assert manifest[REV_PRODUCT_DOCS]["retrieval_mode"] == "runtime_registry"
    assert manifest[REV_PRODUCT_DOCS]["coverage"]["documents"] == len(ks.revluma_documents())
    assert "help_centre" in manifest[REV_PRODUCT_DOCS]["coverage"]["excludes"]
    assert manifest["ecommerce_knowledge"]["status"] == "unavailable"
    assert manifest["ecommerce_knowledge"]["coverage"]["ingested_documents"] == 0
    assert REV_PRODUCT_DOCS in knowledge_retrieval.available_retrieval_adapters()
    assert SHOPIFY_DOCS not in knowledge_retrieval.available_retrieval_adapters()


def test_shopify_docs_tool_is_offered_only_when_a_search_provider_is_configured(monkeypatch):
    route = resolve_knowledge_route("How do Shopify webhooks work?", "knowledge")
    for name in ("GEMINI_API_KEY", "ANTHROPIC_API_KEY", "AI_FALLBACK_PROVIDERS"):
        monkeypatch.delenv(name, raising=False)
    assert "search_shopify_docs" not in _specs(route)

    FakeGemini().install(monkeypatch)
    specs = _specs(resolve_knowledge_route("How do Shopify webhooks work?", "knowledge"))
    tool = specs["search_shopify_docs"]
    assert tool.public_query is True and tool.visibility == "public" and tool.source == SHOPIFY_DOCS
    assert "recall_merchant_context" not in specs and "search_revluma_docs" not in specs


def test_tenant_recall_is_offered_only_for_explicit_tenant_questions():
    public = resolve_knowledge_route("What is a good email open rate?", "knowledge")
    tenant = resolve_knowledge_route("Remind me what our team agreed on.", "knowledge")

    assert TENANT_MEMORY not in public.sources and public.private_tenant_context is False
    assert "recall_merchant_context" not in _specs(public, memories=[TENANT_GOAL])
    assert tenant.private_tenant_context is True
    tool = _specs(tenant, memories=[TENANT_GOAL])["recall_merchant_context"]
    assert tool.visibility == "private" and tool.public_query is False


def test_prefetched_tenant_context_serves_this_requests_memories_without_a_new_query():
    result = ks.prefetched_tenant_context([TENANT_GOAL, {"memory_key": "tone", "memory_value": "Formal"}],
                                          {"status": "success"}, "wholesale growth goal")
    assert result["status"] == "ok" and result["source"] == TENANT_MEMORY
    assert result["documents"][0]["text"] == "growth goal: Grow wholesale accounts in Kano before Ramadan"
    assert ks.rank_documents([{"text": "tone: Formal"}, {"text": "wholesale growth"}], "growth")[0]["text"] \
        == "wholesale growth"


@pytest.mark.parametrize("query,reason", [
    ("", "empty_query"),
    ("x" * 301, "query_too_long"),
    ("refund policy for owner@example.com", "private_identifier"),
    ("webhooks for acme.myshopify.com", "private_identifier"),
    ("status of order #10234", "private_identifier"),
    ("wholesale accounts in kano strategy", "private_context_overlap"),
    ("Acme Outfitters checkout settings", "private_store_term"),
    ("How do Shopify webhooks work", None),
])
def test_public_query_guard_rejects_private_context(query, reason):
    guard = ks.PublicQueryGuard()
    guard.add_private_text("Grow wholesale accounts in Kano before Ramadan")
    guard.add_private_terms(["Acme Outfitters"])
    assert guard.check(query) == reason


# ---------------------------------------------------------------------------
# Knowledge agent through /rev/stream (scripted provider)
# ---------------------------------------------------------------------------

def test_private_context_never_reaches_a_public_search(monkeypatch, provider, stream):
    provider.understand = lambda message: understanding("knowledge", mode="explanation")
    provider.search = lambda query: ("Webhooks deliver shop events.", [
        ("https://shopify.dev/docs/apps/build/webhooks", "About webhooks")])
    provider.agent_turns = [
        lambda view: [provider.call("search_shopify_docs", {"query": "webhooks for acme.myshopify.com"})],
        lambda view: [provider.call("search_shopify_docs", {"query": "how Shopify webhooks work"})],
        lambda view: [provider.call("finish_answer", {
            "answer_markdown": "Shopify sends subscribed shop events to your app's webhook endpoint.",
            "cited_evidence_ids": [view["results"]["search_shopify_docs"][0]["documents"][0]["id"]],
            "evidence_sufficiency": "sufficient"})],
    ]
    final = stream("How do Shopify webhooks work?")

    searches = [request for request in provider.requests if request["kind"] == "web_search"]
    assert len(searches) == 1 and "myshopify" not in searches[0]["query"]
    calls = final["knowledge_agent_execution"]["tool_calls"]
    assert calls[0]["status"] == "rejected_query" and calls[0]["reason"] == "private_identifier"
    assert "https://shopify.dev/docs/apps/build/webhooks" in final["text"]


def test_tenant_question_recalls_private_context_and_marks_it_private(monkeypatch, provider, stream):
    monkeypatch.setattr(knowledge_retrieval, "retrieve_tenant_memories",
                        lambda *args, **kwargs: ([TENANT_GOAL], {"source": TENANT_MEMORY, "status": "success",
                                                                 "result_count": 1}))
    provider.understand = lambda message: understanding("knowledge", mode="explanation")
    seen = {}

    def recall(view):
        seen["tools"] = view["tools"]
        return [provider.call("recall_merchant_context", {"query": "growth goals"})]

    def finish(view):
        documents = view["results"]["recall_merchant_context"][0]["documents"]
        return [provider.call("finish_answer", {
            "answer_markdown": "Your team agreed to grow wholesale accounts in Kano before Ramadan.",
            "cited_evidence_ids": [documents[0]["id"]], "evidence_sufficiency": "sufficient"})]

    provider.agent_turns = [recall, finish]
    final = stream("Remind me what our team agreed on.")

    assert "recall_merchant_context" in seen["tools"]
    assert final["text"].startswith("Your team agreed to grow wholesale accounts in Kano")
    sources = final["execution_trace"]["knowledge_sources"]
    assert sources["private_context_used"] is True and TENANT_MEMORY in sources["used"]
    assert "web_search" not in provider.kinds()
    assert "Kano" not in json.dumps(final["execution_trace"]["telemetry"])


def test_general_question_never_triggers_tenant_retrieval(monkeypatch, provider, stream):
    def forbidden(*args, **kwargs):
        raise AssertionError("tenant memory must not be retrieved for a public question")

    monkeypatch.setattr(knowledge_retrieval, "retrieve_tenant_memories", forbidden)
    provider.understand = lambda message: understanding("knowledge", mode="explanation")
    provider.agent_turns = [lambda view: [provider.call("finish_answer", {
        "answer_markdown": "Open rates for ecommerce newsletters are commonly quoted between 20 and 40 percent.",
        "cited_evidence_ids": [], "evidence_sufficiency": "partial"})]]
    final = stream("What is a good email open rate for an online store?")

    assert final["knowledge_route"]["private_tenant_context"] is False
    assert final["execution_trace"]["knowledge_sources"]["private_context_used"] is False
    assert "no ecommerce reference library was searched" in final["text"]


def test_an_uncited_source_is_never_attached_to_the_answer(monkeypatch, provider, stream):
    provider.understand = lambda message: understanding("knowledge", mode="explanation")
    provider.agent_turns = [
        lambda view: [provider.call("search_revluma_docs", {"query": "refund rate"})],
        lambda view: [provider.call("finish_answer", {
            "answer_markdown": "Revluma reports refund rate per currency for the selected window.",
            "cited_evidence_ids": [], "evidence_sufficiency": "partial"})],
    ]
    final = stream("How does Revluma define refund rate?")

    assert "**Revluma documentation**" not in final["text"]
    assert final["execution_trace"]["knowledge_sources"]["revluma_docs_cited"] == 0


def test_an_agent_answer_failing_claim_guardrails_is_never_delivered(monkeypatch, provider, stream):
    provider.understand = lambda message: understanding("knowledge", mode="explanation")
    provider.agent_turns = [lambda view: [provider.call("finish_answer", {
        "answer_markdown": "Cross-selling is guaranteed to recover lost revenue.",
        "cited_evidence_ids": [], "evidence_sufficiency": "sufficient"})]]
    provider.compose = lambda prompt: ("Cross-selling suggests related items at the point of purchase, "
                                       "such as a case offered with a phone.")
    final = stream("What is cross-selling in ecommerce?")

    assert "guaranteed" not in final["text"] and "lost revenue" not in final["text"]
    assert final["text"].startswith("Cross-selling suggests related items")
    trace = final["knowledge_agent_execution"]
    assert trace["fallback_mode"] == "knowledge_composer" and trace["model_directed"] is False
    assert "unsupported_financial_impact_language" in trace["guardrail_rejections"]


def test_no_configured_provider_fails_honestly_without_running_the_agent(monkeypatch, stream):
    for name in ("GEMINI_API_KEY", "ANTHROPIC_API_KEY", "AI_FALLBACK_PROVIDERS", "OPENAI_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("REV_NARRATIVE_LLM", "false")

    def no_agent(*args, **kwargs):
        raise AssertionError("the agent loop must not start without a configured provider")

    monkeypatch.setattr("src.agents.rev_agent.run_agent", no_agent)
    error = stream("How does Revluma define refund rate?", expect="error")

    # Nothing is fabricated from the registry or the model: the merchant is
    # told the AI provider is unavailable.
    assert error["code"] == "PROVIDER_FAILURE"
    assert "refund" not in json.dumps(error).lower()


@pytest.mark.parametrize("message,intent", [
    ("Are webhooks working?", "data_coverage"),
    ("Are Shopify webhooks working for my store?", "data_coverage"),
    ("Is Shopify connected?", "data_coverage"),
    ("How do Shopify webhooks work?", "knowledge"),
    ("What does the Shopify webhooks API reference say about retries?", "knowledge"),
])
def test_public_shopify_documentation_questions_do_not_open_store_tools(provider, message, intent):
    provider.understand = lambda text: understanding("knowledge", mode="explanation")
    routed = investigation.route_message(message, {}, {"has_store": True})
    assert routed["classification"]["intent"] == intent
