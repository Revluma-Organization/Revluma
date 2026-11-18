"""Source-isolated routing and retrieval policy for Rev knowledge.

This module is intentionally a policy boundary, not a claim that all document
corpora are already ingested. Tenant memories and the current Google Search
composer have adapters; Shopify, ecommerce and Revluma document adapters remain
unconfigured until their source inventories and freshness policies are approved.
"""
from __future__ import annotations

import re
import time
from dataclasses import asdict, dataclass
from typing import Any


SHOPIFY_DOCS = "shopify_public_docs"
ECOMMERCE_KNOWLEDGE = "ecommerce_knowledge"
REV_PRODUCT_DOCS = "revluma_product_docs"
TENANT_MEMORY = "tenant_memory"
LIVE_WEB = "live_web"
MERCHANT_EVIDENCE = "merchant_evidence"

# Public-document collections are deliberately distinct. Never add the tenant
# corpus to these identifiers or use one vector namespace for all four classes.
DOCUMENT_COLLECTIONS = frozenset({SHOPIFY_DOCS, ECOMMERCE_KNOWLEDGE, REV_PRODUCT_DOCS})
AVAILABLE_RETRIEVAL_ADAPTERS = frozenset({TENANT_MEMORY, LIVE_WEB})


def available_retrieval_adapters() -> frozenset[str]:
    """Sources with a working retrieval path right now (real coverage only).

    Always: tenant memory and live web. Revluma documentation is retrievable
    from the runtime capability/metric registry. Shopify documentation is only
    retrievable through a configured search-capable provider (live search
    restricted to Shopify's official documentation domains); no Shopify corpus
    is ingested. No general ecommerce corpus exists, so it is never listed.
    """
    available = set(AVAILABLE_RETRIEVAL_ADAPTERS)
    try:
        from .knowledge_sources import source_manifest
        manifest = source_manifest()
        for source in (REV_PRODUCT_DOCS, SHOPIFY_DOCS):
            if (manifest.get(source) or {}).get("status") == "available":
                available.add(source)
    except Exception:  # availability must never break routing
        pass
    return frozenset(available)

_SHOPIFY_DOCUMENT_QUESTION = re.compile(
    r"\b(?:shopify|shopify's)\b.{0,64}\b(?:docs?|documentation|developer|api|"
    r"graphql|webhooks?|version|reference|guide)\b|"
    r"\b(?:docs?|documentation|developer|api|graphql|webhooks?|reference|guide)\b"
    r".{0,64}\bshopify\b", re.I,
)


def is_public_shopify_documentation_question(message: str) -> bool:
    """True when the message asks about Shopify's public platform/docs."""
    return bool(_SHOPIFY_DOCUMENT_QUESTION.search(message or ""))


_REV_PRODUCT_QUESTION = re.compile(
    r"\b(?:revluma|revintell|rev intelligence|rev's (?:dashboard|features|capabilities)|"
    r"how does rev work|what can rev)\b", re.I,
)
_TENANT_CONTEXT_QUESTION = re.compile(
    r"\b(?:my|our|this)\s+(?:store|shop|business|customers?|products?|sales|"
    r"revenue|orders?|inventory|checkout|account|team)\b"
    r"|\bfor\s+(?:my|our)\s+(?:store|shop|business|customers?|products?)\b",
    re.I,
)


@dataclass(frozen=True)
class KnowledgeRoute:
    """Resolved source boundary for one knowledge/evidence request."""

    request_class: str
    sources: tuple[str, ...]
    private_tenant_context: bool
    conversation_history: bool
    current_web_search: bool
    model_knowledge_fallback: bool
    configured_sources: tuple[str, ...]
    unavailable_sources: tuple[str, ...]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def explicitly_requests_tenant_context(message: str) -> bool:
    """Return whether the current text explicitly names private merchant context."""
    return bool(_TENANT_CONTEXT_QUESTION.search((message or "").strip()))


def resolve_knowledge_route(
    message: str,
    intent: str,
    *,
    requires_web: bool = False,
    requires_store_data: bool = False,
) -> KnowledgeRoute:
    """Choose exactly which source classes are eligible for this turn.

    The current route only asserts a source as configured when an adapter is
    present. Document-source selection never makes an unpopulated corpus appear
    to have been searched. Private memories are opt-in by explicit tenant scope.
    """
    text = (message or "").strip()
    lower = text.lower()
    if requires_web or intent == "web_research":
        return KnowledgeRoute(
            request_class="current_web_research", sources=(LIVE_WEB,),
            private_tenant_context=False, conversation_history=False,
            current_web_search=True, model_knowledge_fallback=False,
            configured_sources=(LIVE_WEB,), unavailable_sources=(),
        )
    if requires_store_data:
        return KnowledgeRoute(
            request_class="merchant_investigation", sources=(MERCHANT_EVIDENCE,),
            private_tenant_context=False, conversation_history=True,
            current_web_search=False, model_knowledge_fallback=False,
            configured_sources=(), unavailable_sources=(MERCHANT_EVIDENCE,),
        )
    if _REV_PRODUCT_QUESTION.search(text):
        selected = (REV_PRODUCT_DOCS,)
        request_class = "revluma_product_documentation"
    elif _SHOPIFY_DOCUMENT_QUESTION.search(text):
        selected = (SHOPIFY_DOCS,)
        request_class = "shopify_public_documentation"
    else:
        selected = (ECOMMERCE_KNOWLEDGE,)
        request_class = "general_ecommerce_knowledge"

    include_tenant = explicitly_requests_tenant_context(lower)
    sources = selected + ((TENANT_MEMORY,) if include_tenant else ())
    adapters = available_retrieval_adapters()
    configured = tuple(source for source in sources if source in adapters)
    unavailable = tuple(source for source in sources if source not in adapters)
    return KnowledgeRoute(
        request_class=request_class, sources=sources,
        private_tenant_context=include_tenant,
        # Do not leak an unrelated prior merchant transcript into a public
        # document/model-knowledge request. Tenant-context queries may use the
        # server-owned history as private context, still separate from sources.
        conversation_history=include_tenant,
        current_web_search=False, model_knowledge_fallback=True,
        configured_sources=configured, unavailable_sources=unavailable,
    )


def retrieve_tenant_memories(
    db: Any,
    organization_id: str,
    user_id: str,
    query: str,
    *,
    route: KnowledgeRoute,
    top_k: int = 8,
) -> tuple[list[dict], dict[str, Any]]:
    """Hybrid-rank only memories permitted by the resolved private route.

    The query is the current question only (not public-document text or the
    full transcript); both the vector SQL and lexical load are organization and
    user scoped. The active stream can use the same adapter as the legacy path.
    """
    from .operational_metrics import record_stage

    if not route.private_tenant_context or not organization_id or not user_id or not query.strip():
        return [], {"source": TENANT_MEMORY, "status": "not_requested", "result_count": 0}

    started = time.monotonic()
    status = "success"
    selected: list[dict] = []
    vector_count = 0
    try:
        # Reuse the existing tenant-filtered retrieval and ranker rather than
        # creating a second memory policy. Imports are delayed to avoid the
        # investigator/orchestrator dependency cycle.
        from ..agents.orchestrator import _load_memories, _select_relevant_memories
        from ..memory.vector_store import retrieve_memory_scores

        memories = _load_memories(organization_id, user_id, db) or []
        scores = retrieve_memory_scores(
            db, organization_id, user_id, query[:8000], top_k=min(max(int(top_k), 1), 16))
        vector_count = len(scores)
        selected = _select_relevant_memories(
            memories, query[:8000], {}, top_k=min(max(int(top_k), 1), 16),
            vector_scores=scores)
        if not selected:
            status = "empty"
    except Exception as exc:  # retrieval must degrade to no private context
        status = "failed"
        selected = []
        error_type = type(exc).__name__
    else:
        error_type = None
    duration_ms = (time.monotonic() - started) * 1000
    record_stage(
        "knowledge_retrieval", duration_ms,
        labels={"source": TENANT_MEMORY, "outcome": status},
        attributes={"result_count": len(selected), "vector_result_count": vector_count,
                    "error_type": error_type},
    )
    return selected, {
        "source": TENANT_MEMORY,
        "status": status,
        "result_count": len(selected),
        "vector_result_count": vector_count,
        "duration_ms": round(duration_ms, 2),
    }
