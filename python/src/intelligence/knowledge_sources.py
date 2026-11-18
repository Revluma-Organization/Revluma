"""Source-separated knowledge retrieval for Rev's authoritative agent runtime.

Four source classes are kept strictly apart. Each has its own adapter, its own
evidence-id prefix, its own visibility, and an honest coverage manifest that
states what is actually available — never a claim of corpus coverage that does
not exist.

=======================  =========  =====================================  ==========
source                   visible    adapter / retrieval mode               id prefix
=======================  =========  =====================================  ==========
shopify_public_docs      public     live search restricted to Shopify's    shopify_
                                    official documentation hosts (no
                                    ingested corpus)
revluma_product_docs     public     generated from Revluma's runtime       rvdoc_
                                    capability catalogue, metric registry,
                                    read-only policy and this manifest
ecommerce_knowledge      public     none: no approved corpus is ingested;  (none)
                                    general guidance from the model is
                                    labelled ``model_general_knowledge``
tenant_memory            private    organization+user scoped memories      tenant_
                                    (existing hybrid retriever)
=======================  =========  =====================================  ==========

Separation rules enforced in code (not just prompted):

* Private tenant context is only retrievable when the resolved route allows
  it, is scoped to the authenticated organization and user, and its text is
  never sent to a public adapter: public queries containing private-looking
  identifiers, or sharing a three-word sequence with recalled private text,
  are rejected (see ``PublicQueryGuard``).
* Shopify documentation results are only accepted from allowlisted official
  hosts; when the provider also returned other hosts, those sources and the
  provider summary that may rest on them are dropped.
* Revluma documentation is built from the code the product actually runs, so
  it cannot drift from behaviour; it does not include marketing copy.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import re
import time
from collections import Counter
from functools import lru_cache
from typing import Any, Callable

from .knowledge_retrieval import (
    ECOMMERCE_KNOWLEDGE, REV_PRODUCT_DOCS, SHOPIFY_DOCS, TENANT_MEMORY,
)

KNOWLEDGE_CONTRACT_VERSION = "rev-knowledge-sources-v1"

# Official Shopify documentation hosts only: developer docs (shopify.dev and
# its subdomains), the merchant Help Center and the changelog. Marketing and
# blog pages on www.shopify.com, community forums and the app store are not
# documentation and are excluded.
SHOPIFY_DOC_DOMAINS: tuple[str, ...] = ("shopify.dev", "help.shopify.com", "changelog.shopify.com")
SHOPIFY_EXCLUDED_HOSTS: tuple[str, ...] = ("community.shopify.com", "apps.shopify.com",
                                           "myshopify.com", "community.shopify.dev")


def _live_shopify_enabled() -> bool:
    return os.getenv("REV_SHOPIFY_DOCS_LIVE", "on").strip().lower() not in {"0", "false", "no", "off"}


# ---------------------------------------------------------------------------
# Revluma documentation generated from runtime registries
# ---------------------------------------------------------------------------

_READ_ONLY_POLICY = (
    "Rev is read-only. It reads authorised Shopify evidence that Revluma has synchronised for the "
    "authenticated organization. It cannot change prices, products, themes, orders, discounts or "
    "campaigns, cannot issue refunds, and does not send emails or messages. It can explain evidence and "
    "recommend a next step that the merchant applies in Shopify, then investigate the recorded result. "
    "It does not invent numbers or causes: missing data is reported as unknown, never as zero, and "
    "abandoned-checkout value is not presented as lost or recoverable revenue."
)

_EVIDENCE_POLICY = (
    "Rev separates verified facts from deterministic calculations, interpretations, unverified hypotheses "
    "and unknowns. All arithmetic (differences, percentage changes, ratios, shares, sums) is calculated "
    "deterministically from evidence values, never by the language model. Values in different currencies "
    "are never combined. Every answer states the reporting period, and comparisons use an equal-length "
    "previous period."
)


def _tokens(text: str) -> list[str]:
    return [token for token in re.findall(r"[a-z0-9]+", (text or "").lower()) if len(token) > 1]


def _doc(identifier_seed: str, title: str, text: str, source_ref: str, topic: str) -> dict:
    digest = hashlib.sha256(identifier_seed.encode()).hexdigest()[:10]
    return {"id": f"rvdoc_{digest}", "title": title, "text": text, "source_ref": source_ref,
            "topic": topic, "source": REV_PRODUCT_DOCS}


@lru_cache(maxsize=1)
def revluma_documents() -> tuple[dict, ...]:
    """Documents derived from the code Rev runs. Built once per process."""
    from ..agents.tools import catalog
    from . import metric_registry

    documents: list[dict] = [
        _doc("policy:read_only", "What Rev can and cannot do", _READ_ONLY_POLICY,
             "runtime:policy#read_only", "capabilities"),
        _doc("policy:evidence", "How Rev handles evidence and calculations", _EVIDENCE_POLICY,
             "runtime:policy#evidence", "evidence"),
    ]
    for entry in catalog():
        if entry["name"] == "store_health":
            continue
        sources = ", ".join(entry.get("data_sources") or [])
        period = "Requires a reporting period." if entry.get("requires_period") else "Not tied to a reporting period."
        documents.append(_doc(
            f"tool:{entry['name']}", f"Rev capability: {entry['label']}",
            f"{entry['description']} {period} Read-only and scoped to the authenticated organization. "
            f"Reads: {sources}.", f"runtime:tools.catalog#{entry['name']}", "capabilities"))
    for key, definition in sorted(metric_registry.REGISTRY.items()):
        parts = [f"{definition.label}: {definition.definition}", f"Formula: {definition.formula}."]
        if definition.exclusions:
            parts.append(f"Exclusions: {definition.exclusions}")
        if definition.limitations:
            parts.append("Limitations: " + " ".join(definition.limitations))
        if not definition.is_computable:
            parts.append(definition.explain_unavailable())
        else:
            parts.append(f"Status: {definition.status}.")
        documents.append(_doc(f"metric:{key}", f"Metric definition: {definition.label}", " ".join(parts),
                              f"runtime:metric_registry#{key}", "metrics"))
    return tuple(documents)


def revluma_corpus_version() -> str:
    material = "|".join(doc["id"] + doc["text"] for doc in revluma_documents())
    return hashlib.sha256(material.encode()).hexdigest()[:12]


@lru_cache(maxsize=1)
def _revluma_index() -> tuple[list[Counter], dict[str, int], float]:
    docs = revluma_documents()
    term_counts = [Counter(_tokens(doc["title"] + " " + doc["title"] + " " + doc["text"])) for doc in docs]
    document_frequency: Counter = Counter()
    for counts in term_counts:
        document_frequency.update(counts.keys())
    average = sum(sum(counts.values()) for counts in term_counts) / max(1, len(term_counts))
    return term_counts, dict(document_frequency), average


def search_revluma_docs(query: str, *, top_k: int = 4) -> dict:
    """Deterministic BM25 search over the runtime-generated Revluma documents."""
    from .execution_telemetry import record_knowledge

    started = time.monotonic()
    docs = revluma_documents()
    terms = _tokens(query)[:24]
    if not terms:
        return {"status": "invalid_query", "source": REV_PRODUCT_DOCS, "documents": [],
                "coverage": source_manifest()[REV_PRODUCT_DOCS]}
    term_counts, document_frequency, average = _revluma_index()
    count = len(docs)
    scored = []
    for index, counts in enumerate(term_counts):
        length = sum(counts.values()) or 1
        score = 0.0
        for term in terms:
            frequency = counts.get(term, 0)
            if not frequency:
                continue
            idf = math.log(1 + (count - document_frequency.get(term, 0) + 0.5) / (document_frequency.get(term, 0) + 0.5))
            score += idf * frequency * 2.2 / (frequency + 1.2 * (0.25 + 0.75 * length / average))
        if score > 0:
            scored.append((score, index))
    scored.sort(key=lambda pair: (-pair[0], pair[1]))
    results = [{**{key: docs[index][key] for key in ("id", "title", "text", "source_ref", "topic")},
                "score": round(score, 3)} for score, index in scored[:max(1, min(int(top_k), 8))]]
    elapsed = (time.monotonic() - started) * 1000
    status = "ok" if results else "no_match"
    record_knowledge(REV_PRODUCT_DOCS, status, result_count=len(results), retrieval_mode="runtime_registry",
                     duration_ms=elapsed)
    return {"status": status, "source": REV_PRODUCT_DOCS, "documents": results,
            "coverage": source_manifest()[REV_PRODUCT_DOCS]}


# ---------------------------------------------------------------------------
# Coverage manifest
# ---------------------------------------------------------------------------

def source_manifest() -> dict[str, dict]:
    """What each source can actually provide right now. Never overstated."""
    from ..agents import agent_gateway

    web_providers = agent_gateway.agent_capability_status().get("web_search") or []
    live_shopify = bool(web_providers) and _live_shopify_enabled()
    revluma_docs = revluma_documents()
    return {
        SHOPIFY_DOCS: {
            "source": SHOPIFY_DOCS, "visibility": "public",
            "status": "available" if live_shopify else "unavailable",
            "retrieval_mode": "live_domain_restricted_search" if live_shopify else None,
            "coverage": {"indexed_corpus": False, "ingested_documents": 0,
                         "allowed_domains": list(SHOPIFY_DOC_DOMAINS),
                         "search_providers": list(web_providers) if live_shopify else []},
            "reason": (None if live_shopify else
                       "No search-capable provider is configured (or REV_SHOPIFY_DOCS_LIVE=off), and no Shopify "
                       "documentation corpus has been ingested."),
        },
        REV_PRODUCT_DOCS: {
            "source": REV_PRODUCT_DOCS, "visibility": "public", "status": "available",
            "retrieval_mode": "runtime_registry",
            "coverage": {"indexed_corpus": True, "documents": len(revluma_docs),
                         "version": revluma_corpus_version(),
                         "content": ["capability_catalog", "metric_definitions", "read_only_policy",
                                     "evidence_policy"],
                         "excludes": ["help_centre", "pricing", "marketing_pages", "roadmap"]},
            "reason": None,
        },
        ECOMMERCE_KNOWLEDGE: {
            "source": ECOMMERCE_KNOWLEDGE, "visibility": "public", "status": "unavailable",
            "retrieval_mode": None,
            "coverage": {"indexed_corpus": False, "ingested_documents": 0},
            "reason": "No approved general ecommerce knowledge corpus has been ingested. Any general guidance "
                      "comes from the model's own knowledge and is labelled as such.",
        },
        TENANT_MEMORY: {
            "source": TENANT_MEMORY, "visibility": "private", "status": "available",
            "retrieval_mode": "organization_user_scoped_hybrid",
            "coverage": {"scope": "authenticated_organization_and_user"},
            "reason": None,
        },
    }


# ---------------------------------------------------------------------------
# Shopify public documentation (live, domain restricted)
# ---------------------------------------------------------------------------

def search_shopify_docs(query: str, *, timeout: float = 20.0, cancelled: Callable[[], bool] | None = None,
                        correlation_id: str | None = None, execution_id: str | None = None) -> dict:
    from ..agents import agent_gateway
    from .execution_telemetry import record_knowledge

    manifest = source_manifest()[SHOPIFY_DOCS]
    if manifest["status"] != "available":
        record_knowledge(SHOPIFY_DOCS, "unavailable", retrieval_mode=None)
        return {"status": "unavailable", "source": SHOPIFY_DOCS, "documents": [], "coverage": manifest,
                "failure_category": "unsupported_capability"}
    started = time.monotonic()
    research = agent_gateway.web_search(
        query, timeout=timeout, cancelled=cancelled, correlation_id=correlation_id, execution_id=execution_id,
        allowed_domains=SHOPIFY_DOC_DOMAINS, excluded_hosts=SHOPIFY_EXCLUDED_HOSTS,
        purpose="shopify_docs_search")
    documents = [{"url": source["url"], "title": source.get("title") or "", "page_age": source.get("page_age")}
                 for source in research.get("sources") or []]
    status = research.get("status") or "failed"
    record_knowledge(SHOPIFY_DOCS, status, result_count=len(documents),
                     retrieval_mode="live_domain_restricted_search",
                     duration_ms=(time.monotonic() - started) * 1000, cache_hit=bool(research.get("cache_hit")))
    return {
        "status": status, "source": SHOPIFY_DOCS, "documents": documents,
        "summary": research.get("summary") or "", "summary_withheld": bool(research.get("summary_withheld")),
        "filtered_source_count": research.get("filtered_source_count") or 0,
        "retrieved_at": research.get("retrieved_at"), "cache_hit": bool(research.get("cache_hit")),
        "cache_age_seconds": research.get("cache_age_seconds"),
        "provider": research.get("provider"), "model": research.get("model"),
        "usage": research.get("usage") or {}, "searches": research.get("searches") or 0,
        "failure_category": research.get("failure_category"), "coverage": manifest,
    }


# ---------------------------------------------------------------------------
# Private tenant context
# ---------------------------------------------------------------------------

def tenant_documents(memories: list[dict] | None, *, limit: int = 8) -> list[dict]:
    """Shape tenant memories (already organization/user scoped) as private documents."""
    documents = []
    for memory in (memories or [])[:limit]:
        memory = memory or {}
        value = memory.get("memory_value")
        if isinstance(value, (dict, list)):
            value = json.dumps(value, default=str)
        if not str(value or "").strip():
            continue
        key = str(memory.get("memory_key") or "").replace("_", " ").strip()
        text = (f"{key}: {value}" if key else str(value))[:600]
        documents.append({"id": f"tenant_{len(documents) + 1}", "text": text,
                          "memory_type": str(memory.get("memory_type") or "memory")[:40],
                          "authority": str(memory.get("memory_source") or "")[:40] or None})
    return documents


def rank_documents(documents: list[dict], query: str, *, top_k: int = 6) -> list[dict]:
    """Stable lexical ranking; documents with no overlap keep their original order last."""
    terms = set(_tokens(query))
    scored = [(-len(terms & set(_tokens(document.get("text") or ""))), index, document)
              for index, document in enumerate(documents)]
    scored.sort(key=lambda entry: (entry[0], entry[1]))
    return [document for _, _, document in scored[:top_k]]


def prefetched_tenant_context(memories: list[dict] | None, provenance: dict | None, query: str, *,
                              top_k: int = 6) -> dict:
    """Serve tenant context retrieved earlier in this request; no second query."""
    from .execution_telemetry import record_knowledge

    started = time.monotonic()
    documents = rank_documents(tenant_documents(memories), query, top_k=top_k)
    status = (provenance or {}).get("status") or ("ok" if documents else "empty")
    record_knowledge(TENANT_MEMORY, "ok" if documents else status, result_count=len(documents),
                     retrieval_mode="organization_user_scoped_hybrid",
                     duration_ms=(time.monotonic() - started) * 1000)
    return {"status": "ok" if documents else ("empty" if status in ("ok", "available") else status),
            "source": TENANT_MEMORY, "documents": documents,
            "coverage": {"status": "available", "retrieval_mode": "organization_user_scoped_hybrid"}}


def recall_tenant_context(db: Any, organization_id: str, user_id: str, query: str, *, route: Any,
                          top_k: int = 6) -> dict:
    """Retrieve tenant memories for ``query`` (organization and user scoped)."""
    from .knowledge_retrieval import retrieve_tenant_memories

    memories, provenance = retrieve_tenant_memories(db, organization_id, user_id, query, route=route,
                                                    top_k=top_k)
    result = prefetched_tenant_context(memories, provenance, query, top_k=top_k)
    result["provenance"] = provenance
    return result


class PublicQueryGuard:
    """Rejects public-source queries that could carry private merchant context."""

    _PRIVATE = re.compile(r"@|\.myshopify\.com|#\d{3,}|\b\d{6,}\b|order\s*(?:no\.?|number)|"
                          r"\b(?:customer|buyer)\s+(?:named|called)\b", re.I)

    def __init__(self) -> None:
        self._private_shingles: set[tuple[str, ...]] = set()
        self._private_terms: set[str] = set()

    def add_private_text(self, text: str) -> None:
        words = _tokens(text)
        for index in range(len(words) - 2):
            self._private_shingles.add(tuple(words[index:index + 3]))

    def add_private_terms(self, terms: list[str]) -> None:
        for term in terms:
            normalized = " ".join(_tokens(term))
            if len(normalized) >= 4:
                self._private_terms.add(normalized)

    def check(self, query: Any) -> str | None:
        """Return a rejection reason, or None when the query is safe to send."""
        if not isinstance(query, str) or not query.strip():
            return "empty_query"
        if len(query) > 300:
            return "query_too_long"
        if self._PRIVATE.search(query):
            return "private_identifier"
        normalized = " ".join(_tokens(query))
        if any(term in normalized for term in self._private_terms):
            return "private_store_term"
        words = _tokens(query)
        if any(tuple(words[index:index + 3]) in self._private_shingles for index in range(len(words) - 2)):
            return "private_context_overlap"
        return None
