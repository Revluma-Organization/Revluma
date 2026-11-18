from __future__ import annotations

from src.intelligence.knowledge_retrieval import (
    ECOMMERCE_KNOWLEDGE, LIVE_WEB, REV_PRODUCT_DOCS, SHOPIFY_DOCS,
    TENANT_MEMORY, resolve_knowledge_route, retrieve_tenant_memories,
)


def test_four_knowledge_domains_route_to_distinct_source_namespaces():
    shopify = resolve_knowledge_route("How do Shopify webhooks work?", "knowledge")
    ecommerce = resolve_knowledge_route("What is a product contribution margin?", "knowledge")
    rev = resolve_knowledge_route("How does Rev Intelligence work?", "knowledge")
    tenant = resolve_knowledge_route("What are my store's top products?", "knowledge")

    assert shopify.sources == (SHOPIFY_DOCS,)
    assert ecommerce.sources == (ECOMMERCE_KNOWLEDGE,)
    assert rev.sources == (REV_PRODUCT_DOCS,)
    assert tenant.sources == (ECOMMERCE_KNOWLEDGE, TENANT_MEMORY)
    assert tenant.private_tenant_context is True
    assert tenant.conversation_history is True
    # Document collections do not currently have ingestion/retrieval adapters;
    # they must be visible as unavailable, never silently treated as searched.
    for route in (shopify, ecommerce, rev):
        assert route.configured_sources == ()
        assert route.unavailable_sources == route.sources
        assert route.model_knowledge_fallback is True


def test_new_public_knowledge_understanding_omits_private_conversation_history(monkeypatch):
    from src.agents import investigation, understanding

    seen = []

    def understand(message, history, **kwargs):
        seen.append(history)
        return understanding.Understanding(
            intent="knowledge", goal="explain public Shopify documentation",
            requires_store_data=False, requires_web=False, requires_action=False,
            response_mode=understanding.MODE_EXPLANATION, confidence=0.95,
        )

    monkeypatch.setattr(understanding, "understand", understand)
    investigation.route_message(
        "Find current Shopify webhook documentation for the new API version.",
        {"recent_turns": [{"role": "user", "text": "PRIVATE ORDER CONTEXT"}]},
        {"store_count": 1},
    )
    assert seen == [[]]


def test_unavailable_document_corpus_is_disclosed_as_not_searched(monkeypatch):
    from types import SimpleNamespace
    from src.agents import responder

    captured = {}
    monkeypatch.setattr(responder, "_call", lambda role, prompt, *args, **kwargs:
                       captured.setdefault("prompt", prompt) or "Explanation")
    understanding = SimpleNamespace(response_mode="direct_answer", intent="knowledge",
                                    goal="explain Shopify webhooks")
    responder.compose_knowledge(
        "How do Shopify webhooks work?", understanding, "", [], True,
        retrieval_status={"configured_sources": [],
                          "unavailable_sources": [SHOPIFY_DOCS],
                          "tenant_memory": "not_requested"})
    assert "not configured/ingested" in captured["prompt"]
    assert SHOPIFY_DOCS in captured["prompt"]
    assert "Do not claim to have searched" in captured["prompt"]
    assert "model knowledge rather than current documentation" in captured["prompt"]


def test_current_web_route_is_exclusive_and_never_receives_private_context():
    route = resolve_knowledge_route(
        "Find current Shopify API changes for my store", "web_research", requires_web=True)
    assert route.sources == (LIVE_WEB,)
    assert route.current_web_search is True
    assert route.private_tenant_context is False
    assert route.conversation_history is False
    assert route.unavailable_sources == ()


def test_tenant_retrieval_is_not_run_unless_private_route_explicitly_allows_it():
    class MustNotBeUsed:
        def execute(self, *args, **kwargs):
            raise AssertionError("database should not be touched")

    public_route = resolve_knowledge_route("What is a conversion rate?", "knowledge")
    result, provenance = retrieve_tenant_memories(
        MustNotBeUsed(), "org", "user", "conversion rate", route=public_route)
    assert result == []
    assert provenance["status"] == "not_requested"


def test_legacy_runtime_does_not_load_tenant_memories_for_public_knowledge(monkeypatch):
    from types import SimpleNamespace
    from src.agents import orchestrator, responder

    captured = {}
    monkeypatch.setattr(orchestrator, "_get_or_create_conversation", lambda *_: ("c", False))
    monkeypatch.setattr(orchestrator, "_load_history", lambda *_: [])
    monkeypatch.setattr(orchestrator, "_has_store", lambda *_: True)
    monkeypatch.setattr(orchestrator, "_persist_messages", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(orchestrator, "_load_memories", lambda *_: (_ for _ in ()).throw(
        AssertionError("public question must not load tenant memories")))
    monkeypatch.setattr(orchestrator, "understand", lambda *_args, **_kwargs: SimpleNamespace(
        intent="knowledge", response_mode="explanation", requires_action=False,
        goal="explain a public ecommerce concept", requires_store_data=False,
        requires_web=False, domains=[], confidence=0.9,
    ))

    def compose(message, understanding, history, memories, has_store):
        captured.update(history=history, memories=memories)
        return "Public explanation."

    monkeypatch.setattr(responder, "compose_knowledge", compose)
    result = orchestrator._run(
        "org", "user", "What is a conversion rate?", None, object(), "trace")

    assert result.text == "Public explanation."
    assert captured == {"history": "", "memories": []}


def test_private_memory_path_uses_authenticated_tenant_and_user_filters(monkeypatch):
    from src.agents import orchestrator
    from src.memory import vector_store

    route = resolve_knowledge_route("What are my store's top products?", "knowledge")
    assert route.private_tenant_context is True
    observed = {}
    memory = {"id": "m1", "memory_key": "focus", "memory_value": "products"}

    def load(org_id, user_id, db):
        observed["load"] = (org_id, user_id, db)
        return [memory]

    def score(db, org_id, user_id, query, *, top_k):
        observed["vector"] = (org_id, user_id, query, top_k)
        return {"m1": 0.9}

    monkeypatch.setattr(orchestrator, "_load_memories", load)
    monkeypatch.setattr(vector_store, "retrieve_memory_scores", score)
    db = object()
    result, provenance = retrieve_tenant_memories(
        db, "authenticated-org", "authenticated-user", "top products", route=route)

    assert result == [memory]
    assert observed["load"] == ("authenticated-org", "authenticated-user", db)
    assert observed["vector"] == ("authenticated-org", "authenticated-user", "top products", 8)
    assert provenance["status"] == "success"
