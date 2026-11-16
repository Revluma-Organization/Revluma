#!/usr/bin/env python3
"""Reproducible local microbenchmark; no database, network, or model calls.

Measures only source routing and the existing local hash-embedding + hybrid
memory rank path on a deterministic synthetic corpus. It is not an end-to-end,
production, provider, pgvector, or accuracy benchmark.
"""
from __future__ import annotations

import json
import platform
import statistics
import time
from pathlib import Path
import sys

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.agents.orchestrator import _select_relevant_memories
from src.intelligence.knowledge_retrieval import resolve_knowledge_route
from src.memory.vector_store import embed_text

ROUTE_QUERIES = (
    ("How do Shopify webhooks work?", "knowledge"),
    ("What is a product contribution margin?", "knowledge"),
    ("How does Rev Intelligence work?", "knowledge"),
    ("Find current public ecommerce policy changes", "web_research"),
    ("What are my store's most returned products?", "knowledge"),
)


def percentile(samples: list[float], p: float) -> float:
    ordered = sorted(samples)
    return ordered[min(len(ordered) - 1, int((len(ordered) - 1) * p + 0.999999))]


def summarize(samples_ns: list[int]) -> dict[str, float | int]:
    samples_ms = [value / 1_000_000 for value in samples_ns]
    return {
        "iterations": len(samples_ms),
        "p50_ms": round(percentile(samples_ms, .50), 4),
        "p95_ms": round(percentile(samples_ms, .95), 4),
        "p99_ms": round(percentile(samples_ms, .99), 4),
        "max_ms": round(max(samples_ms), 4),
        "mean_ms": round(statistics.fmean(samples_ms), 4),
    }


def main() -> None:
    memories = [
        {
            "id": f"memory-{index}",
            "memory_key": f"merchant preference product category {index % 32}",
            "memory_value": {"note": f"inventory margin return behavior category {index % 32}"},
            "memory_type": "preference" if index % 5 else "constraint",
            "authority_level": 1 if index % 5 else 4,
            "importance": index % 7,
            "is_active": True,
        }
        for index in range(256)
    ]
    matrix = np.asarray([
        embed_text(f"{item['memory_key']} {item['memory_value']['note']}")
        for item in memories
    ], dtype=np.float32)
    route_query = "What are my store's most returned products?"
    query_vector = embed_text(route_query)
    vector_ns: list[int] = []
    select_ns: list[int] = []
    combined_ns: list[int] = []

    # Warm the regex route, hashing vectorizer and dot-product path.
    for message, intent in ROUTE_QUERIES:
        resolve_knowledge_route(message, intent, requires_web=intent == "web_research")
    for _ in range(15):
        q = embed_text(route_query)
        sims = matrix @ np.asarray(q, dtype=np.float32)
        top = np.argsort(-sims)[:16]
        score_map = {memories[int(index)]["id"]: float(sims[index]) for index in top}
        _select_relevant_memories(memories, route_query, {}, top_k=8, vector_scores=score_map)

    route_samples: list[int] = []
    for index in range(1000):
        message, intent = ROUTE_QUERIES[index % len(ROUTE_QUERIES)]
        started = time.perf_counter_ns()
        resolve_knowledge_route(message, intent, requires_web=intent == "web_research")
        route_samples.append(time.perf_counter_ns() - started)

    for index in range(200):
        query = f"{route_query} category {index % 32}"
        started = time.perf_counter_ns()
        q = embed_text(query)
        sims = matrix @ np.asarray(q, dtype=np.float32)
        top = np.argsort(-sims)[:16]
        score_map = {memories[int(row)]["id"]: float(sims[row]) for row in top}
        vector_ns.append(time.perf_counter_ns() - started)

        started = time.perf_counter_ns()
        _select_relevant_memories(memories, query, {}, top_k=8, vector_scores=score_map)
        select_ns.append(time.perf_counter_ns() - started)

        started = time.perf_counter_ns()
        route = resolve_knowledge_route(query, "knowledge")
        if route.private_tenant_context:
            q = embed_text(query)
            sims = matrix @ np.asarray(q, dtype=np.float32)
            top = np.argsort(-sims)[:16]
            scores = {memories[int(row)]["id"]: float(sims[row]) for row in top}
            _select_relevant_memories(memories, query, {}, top_k=8, vector_scores=scores)
        combined_ns.append(time.perf_counter_ns() - started)

    print(json.dumps({
        "benchmark": "local_knowledge_route_and_synthetic_tenant_hybrid_rank",
        "python": platform.python_version(),
        "numpy": np.__version__,
        "memory_rows": len(memories),
        "embedding_dimensions": int(matrix.shape[1]),
        "model_or_network_calls": 0,
        "database_calls": 0,
        "route_selection": summarize(route_samples),
        "synthetic_embedding_and_top16": summarize(vector_ns),
        "hybrid_relevance_rank_only": summarize(select_ns),
        "private_route_plus_embedding_and_rank": summarize(combined_ns),
        "accuracy_or_recall_claim": False,
    }, indent=2))


if __name__ == "__main__":
    main()
