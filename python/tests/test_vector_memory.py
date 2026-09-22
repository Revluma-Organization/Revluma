from src.memory.vector_store import (
    EMBEDDING_DIMENSIONS,
    embed_text,
    memory_text,
    source_hash,
)


def test_local_embedding_is_deterministic_and_normalized():
    first = embed_text("merchant prefers concise weekly revenue summaries")
    second = embed_text("merchant prefers concise weekly revenue summaries")

    assert first == second
    assert len(first) == EMBEDDING_DIMENSIONS
    assert abs(sum(value * value for value in first) - 1.0) < 1e-9


def test_memory_hash_changes_with_canonical_content():
    first = memory_text("reporting_style", {"tone": "concise"}, "preference")
    second = memory_text("reporting_style", {"tone": "detailed"}, "preference")

    assert source_hash(first) != source_hash(second)
