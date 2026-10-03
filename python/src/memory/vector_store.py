"""Deterministic, zero-secret vector storage for merchant memories.

The embedding is a pinned local hashing model built from the repository's
existing scikit-learn dependency. It avoids an external API key, network cost,
and deployment-time model download. PostgreSQL/pgvector owns similarity search;
the caller always retains lexical retrieval as a fail-safe.
"""

from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from sklearn.feature_extraction.text import HashingVectorizer
from sqlalchemy import text


logger = logging.getLogger("revluma.memory.vector_store")

EMBEDDING_DIMENSIONS = 384
EMBEDDING_MODEL = "sklearn-hashing-word-bigram-v1"
MAX_ATTEMPTS = 5
MIN_VECTOR_SIMILARITY = 0.08

_VECTORIZER = HashingVectorizer(
    n_features=EMBEDDING_DIMENSIONS,
    alternate_sign=False,
    analyzer="word",
    ngram_range=(1, 2),
    lowercase=True,
    norm="l2",
    token_pattern=r"(?u)\b\w\w+\b",
)


def _stable_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)


def memory_text(memory_key: str, memory_value: Any, memory_type: str) -> str:
    """Return the bounded canonical text embedded for one memory."""
    return " ".join(
        (
            str(memory_type or "memory"),
            str(memory_key or ""),
            _stable_json(memory_value),
        )
    )[:8000]


def source_hash(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def embed_text(content: str) -> list[float]:
    """Create a deterministic 384-dimensional, L2-normalized vector."""
    row = _VECTORIZER.transform([str(content or "")])
    return row.toarray()[0].astype(float).tolist()


def _vector_literal(values: list[float]) -> str:
    if len(values) != EMBEDDING_DIMENSIONS:
        raise ValueError("Unexpected embedding dimension.")
    return "[" + ",".join(f"{value:.12g}" for value in values) + "]"


def _claim_job(db):
    row = db.execute(text("""
        WITH candidate AS (
            SELECT id
            FROM merchant_memory_embedding_jobs
            WHERE attempt_count < :max_attempts
              AND available_at <= NOW()
              AND (
                status = 'pending'
                OR (status = 'processing' AND updated_at < NOW() - INTERVAL '10 minutes')
              )
            ORDER BY available_at, created_at
            FOR UPDATE SKIP LOCKED
            LIMIT 1
        ), claimed AS (
            UPDATE merchant_memory_embedding_jobs AS job
            SET status = 'processing',
                attempt_count = job.attempt_count + 1,
                last_error = NULL,
                updated_at = NOW()
            FROM candidate
            WHERE job.id = candidate.id
            RETURNING job.id, job.memory_id, job.organization_id,
                      job.attempt_count
        )
        SELECT claimed.id, claimed.memory_id, claimed.organization_id,
               claimed.attempt_count, memory.user_id, memory.memory_type,
               memory.memory_key, memory.memory_value, memory.is_active,
               memory.expires_at
        FROM claimed
        JOIN merchant_memories AS memory ON memory.id = claimed.memory_id
    """), {"max_attempts": MAX_ATTEMPTS}).fetchone()
    db.commit()
    return row


def _complete_job(db, row) -> None:
    content = memory_text(row[6], row[7], row[5])
    digest = source_hash(content)
    embedding = _vector_literal(embed_text(content))
    db.execute(text("""
        INSERT INTO merchant_memory_embeddings (
            memory_id, organization_id, user_id, embedding,
            embedding_model, source_hash, created_at, updated_at
        ) VALUES (
            :memory_id, :organization_id, :user_id, CAST(:embedding AS vector),
            :embedding_model, :source_hash, NOW(), NOW()
        )
        ON CONFLICT (memory_id) DO UPDATE SET
            organization_id = EXCLUDED.organization_id,
            user_id = EXCLUDED.user_id,
            embedding = EXCLUDED.embedding,
            embedding_model = EXCLUDED.embedding_model,
            source_hash = EXCLUDED.source_hash,
            updated_at = NOW()
    """), {
        "memory_id": str(row[1]),
        "organization_id": str(row[2]),
        "user_id": str(row[4]) if row[4] else None,
        "embedding": embedding,
        "embedding_model": EMBEDDING_MODEL,
        "source_hash": digest,
    })
    db.execute(text("""
        UPDATE merchant_memory_embedding_jobs
        SET status = 'completed', last_error = NULL, updated_at = NOW()
        WHERE id = :job_id
    """), {"job_id": str(row[0])})
    db.commit()


def _discard_inactive_job(db, row) -> None:
    db.execute(text(
        "DELETE FROM merchant_memory_embeddings WHERE memory_id = :memory_id"
    ), {"memory_id": str(row[1])})
    db.execute(text(
        "DELETE FROM merchant_memory_embedding_jobs WHERE id = :job_id"
    ), {"job_id": str(row[0])})
    db.commit()


def _fail_job(db, row, exc: Exception) -> None:
    db.rollback()
    attempts = int(row[3] or 1)
    terminal = attempts >= MAX_ATTEMPTS
    available_at = datetime.now(timezone.utc) + timedelta(
        seconds=min(900, 30 * (2 ** max(0, attempts - 1)))
    )
    db.execute(text("""
        UPDATE merchant_memory_embedding_jobs
        SET status = :status, available_at = :available_at,
            last_error = :error_type, updated_at = NOW()
        WHERE id = :job_id
    """), {
        "status": "failed" if terminal else "pending",
        "available_at": available_at,
        "error_type": type(exc).__name__[:120],
        "job_id": str(row[0]),
    })
    db.commit()


def process_embedding_jobs(db, limit: int = 50) -> dict[str, int]:
    """Claim and process memory embeddings without duplicate workers."""
    bounded_limit = min(max(int(limit), 1), 200)
    processed = 0
    failed = 0
    for _ in range(bounded_limit):
        row = _claim_job(db)
        if row is None:
            break
        try:
            expires_at = row[9]
            if expires_at is not None and expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            expired = expires_at is not None and expires_at <= datetime.now(timezone.utc)
            if row[8] is not True or expired:
                _discard_inactive_job(db, row)
            else:
                _complete_job(db, row)
            processed += 1
        except Exception as exc:  # a bad memory must not stop the queue
            failed += 1
            _fail_job(db, row, exc)
            logger.warning(
                "memory_embedding_job_failed",
                extra={"job_id": str(row[0]), "error_type": type(exc).__name__},
            )
    return {"processed": processed, "failed": failed}


def retrieve_memory_scores(
    db,
    organization_id: str,
    user_id: str,
    query: str,
    *,
    top_k: int = 8,
) -> dict[str, float]:
    """Return tenant-filtered vector scores keyed by memory UUID.

    Any database/extension problem returns an empty mapping so the caller can
    use its existing lexical path. No query text or memory value is logged.
    """
    if not query.strip() or top_k <= 0:
        return {}
    try:
        vector = _vector_literal(embed_text(query[:8000]))
        rows = db.execute(text("""
            SELECT memory.id,
                   1 - (embedding.embedding <=> CAST(:query AS vector)) AS similarity
            FROM merchant_memory_embeddings AS embedding
            JOIN merchant_memories AS memory ON memory.id = embedding.memory_id
            WHERE memory.organization_id = :organization_id
              AND memory.is_active = TRUE
              AND (memory.user_id IS NULL OR memory.user_id = :user_id)
              AND (memory.expires_at IS NULL OR memory.expires_at > NOW())
              AND embedding.embedding_model = :embedding_model
              AND 1 - (embedding.embedding <=> CAST(:query AS vector)) >= :minimum_similarity
            ORDER BY embedding.embedding <=> CAST(:query AS vector),
                     memory.authority_level DESC, memory.importance DESC
            LIMIT :top_k
        """), {
            "query": vector,
            "organization_id": organization_id,
            "user_id": user_id,
            "embedding_model": EMBEDDING_MODEL,
            "minimum_similarity": MIN_VECTOR_SIMILARITY,
            "top_k": min(int(top_k), 16),
        }).fetchall()
        return {str(row[0]): float(row[1]) for row in rows}
    except Exception as exc:
        db.rollback()
        logger.info(
            "memory_vector_retrieval_unavailable",
            extra={"error_type": type(exc).__name__},
        )
        return {}
