"""Task 212 — bounded execution, safe failures and evidence consistency.

This module contains deterministic helpers only. It never calls a model, writes
merchant data, caches an answer, or turns an exception into an empty success.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

FAILURE_CONTRACT_VERSION = "rev-failure-v1"
CONSISTENCY_CONTRACT_VERSION = "rev-consistency-v1"
CONTEXT_CONTRACT_VERSION = "rev-conversation-context-v2"
FAILURE_CATEGORIES = frozenset({
    "timeout", "cancelled", "rate_limited", "provider_unavailable",
    "connection_failed", "invalid_request", "malformed_output",
    "schema_validation_failed", "authorization_failed", "permission_denied",
    "unsupported_capability", "evidence_retrieval_failed", "specialist_failed",
    "partial_success", "internal_error",
})
RETRYABLE_CATEGORIES = frozenset({"timeout", "rate_limited", "provider_unavailable", "connection_failed"})
TIMEOUT_POLICY_MS = {
    "context_retrieval": 5_000,
    "database_statement": int(os.getenv("REV_DB_STATEMENT_TIMEOUT_MS", "10000")),
    "intent_classification": 12_000,
    "specialist": 5_000,
    "response_composition": 25_000,
    "node_python": 45_000,
    "overall_investigation": int(os.getenv("REV_INVESTIGATION_DEADLINE_MS", "100000")),
    "browser_stream": 130_000,
}
logger = logging.getLogger("rev.reliability")


def utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def safe_failure(category: str, stage: str, *, retry_count: int = 0,
                 partial: bool = False, fallback: bool = False,
                 execution_id: str | None = None) -> dict:
    """Build a merchant-safe, versioned diagnostic; no exception text is copied."""
    if category not in FAILURE_CATEGORIES:
        category = "internal_error"
    return {
        "contract_version": FAILURE_CONTRACT_VERSION,
        "category": category,
        "stage": re.sub(r"[^a-z0-9_.-]", "_", str(stage or "unknown"))[:80],
        "retryable": category in RETRYABLE_CATEGORIES,
        "retry_count": max(0, min(int(retry_count), 1)),
        "partial_results_preserved": bool(partial),
        "fallback_used": bool(fallback),
        "execution_id": execution_id if isinstance(execution_id, str) else None,
        "occurred_at": utc_iso(),
    }


def classify_exception(exc: BaseException, *, stage: str, partial: bool = False,
                       fallback: bool = False, retry_count: int = 0) -> dict:
    """Classify by safe exception metadata, never by sensitive message payloads."""
    name = type(exc).__name__.lower()
    status = getattr(exc, "status", None) or getattr(exc, "status_code", None)
    explicit = getattr(exc, "category", None)
    if explicit in FAILURE_CATEGORIES:
        return safe_failure(explicit, stage, retry_count=retry_count, partial=partial, fallback=fallback)
    if "cancel" in name:
        category = "cancelled"
    elif "timeout" in name or "timedout" in name:
        category = "timeout"
    elif status == 429 or "ratelimit" in name:
        category = "rate_limited"
    elif isinstance(exc, PermissionError) or status == 403:
        category = "permission_denied"
    elif status == 401:
        category = "authorization_failed"
    elif isinstance(exc, (ConnectionError, OSError)) or "connection" in name:
        category = "connection_failed"
    elif isinstance(exc, json.JSONDecodeError) or "parse" in name:
        category = "malformed_output"
    elif isinstance(exc, (ValueError, TypeError)):
        category = "schema_validation_failed"
    else:
        category = "internal_error"
    return safe_failure(category, stage, retry_count=retry_count, partial=partial, fallback=fallback)


def record_failure(failure: dict, *, correlation_id: str | None = None,
                   investigation_id: str | None = None, specialist: str | None = None) -> None:
    """Structured operational telemetry with no prompt, customer or secret data."""
    logger.warning("rev_failure", extra={
        "failure_category": failure.get("category"),
        "failure_stage": failure.get("stage"),
        "retry_count": failure.get("retry_count"),
        "retryable": failure.get("retryable"),
        "partial_results_preserved": failure.get("partial_results_preserved"),
        "fallback_used": failure.get("fallback_used"),
        "correlation_id": correlation_id,
        "investigation_id": investigation_id,
        "specialist": specialist,
    })


@dataclass
class InvestigationDeadline:
    """Monotonic overall deadline; operation budgets never exceed the remainder."""
    started: float
    timeout_ms: int

    @classmethod
    def start(cls, timeout_ms: int | None = None) -> "InvestigationDeadline":
        bounded = max(1000, min(int(timeout_ms or TIMEOUT_POLICY_MS["overall_investigation"]), 110000))
        return cls(time.monotonic(), bounded)

    def remaining_ms(self) -> int:
        return max(0, self.timeout_ms - int((time.monotonic() - self.started) * 1000))

    def expired(self) -> bool:
        return self.remaining_ms() <= 0

    def operation_seconds(self, operation: str, requested_seconds: float) -> float:
        budget = TIMEOUT_POLICY_MS.get(operation, int(requested_seconds * 1000)) / 1000
        return max(0.001, min(float(requested_seconds), budget, self.remaining_ms() / 1000))


def _canonical_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _canonical_value(value[key]) for key in sorted(value)}
    if isinstance(value, (list, tuple)):
        return [_canonical_value(entry) for entry in value]
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def evidence_snapshot(items: list[dict]) -> str:
    """Hash semantics, not retrieval timestamps or model wording.

    Evidence IDs alone are insufficient: corrected rows can retain identity.
    Values, currency, period, status, coverage and freshness state therefore
    participate, while generated/retrieved timestamps do not create false changes.
    """
    records = []
    for item in items:
        if not isinstance(item, dict):
            continue
        period = item.get("period") or {}
        evidence_id = item.get("id")
        # Per-investigation UUID-derived IDs are transport references, not
        # evidence identity. Stable external IDs remain part of the snapshot.
        if isinstance(evidence_id, str) and re.fullmatch(r"ev-[0-9a-f]{20,}", evidence_id):
            evidence_id = None
        records.append({
            "id": evidence_id, "source": item.get("source"), "metric": item.get("metric"), "value": item.get("value"),
            "unit": item.get("unit"), "currency": item.get("currency"), "status": item.get("status"),
            "period": {key: period.get(key) for key in ("start", "end", "timezone", "semantics")},
            "coverage": item.get("coverage"), "freshness_state": (item.get("freshness") or {}).get("state"),
            "definition": item.get("definition"),
        })
    records.sort(key=lambda record: (str(record["id"]), str(record["metric"])))
    serialized = json.dumps(_canonical_value(records), sort_keys=True, separators=(",", ":"), default=str)
    return "sha256:" + hashlib.sha256(serialized.encode()).hexdigest()


def canonical_request(*, organization_id: str, store_ids: list[str], intent: str,
                      period: dict, items: list[dict], selected_finding: dict | None = None,
                      metric: str | None = None) -> dict:
    currencies = sorted({str(item["currency"]) for item in items if item.get("currency")})
    # Intent + resolved metric/period/finding/store is the semantic paraphrase
    # key. Raw merchant wording and model-generated text are deliberately absent.
    key = {
        "organization_id": organization_id, "store_ids": sorted(store_ids),
        "intent": intent, "metric": metric or intent,
        "period": {name: period.get(name) for name in ("start", "end", "timezone", "semantics")},
        "finding_id": (selected_finding or {}).get("finding_id"),
        "finding_version": (selected_finding or {}).get("finding_version"),
    }
    return {
        "contract_version": CONSISTENCY_CONTRACT_VERSION,
        "request_key": "sha256:" + hashlib.sha256(json.dumps(key, sort_keys=True, default=str).encode()).hexdigest(),
        "evidence_snapshot": evidence_snapshot(items),
        "currency_scope": currencies,
        "created_at": utc_iso(),
    }


def compare_consistency(previous: dict | None, current: dict) -> dict:
    result = dict(current)
    if not isinstance(previous, dict) or previous.get("contract_version") != CONSISTENCY_CONTRACT_VERSION:
        result.update(status="new_context", changed_fields=[], previous_snapshot=None)
        return result
    if previous.get("request_key") != current.get("request_key"):
        result.update(status="context_changed", changed_fields=["request_scope"], previous_snapshot=None)
        return result
    if previous.get("evidence_snapshot") == current.get("evidence_snapshot"):
        result.update(status="unchanged", changed_fields=[], previous_snapshot=previous.get("evidence_snapshot"))
        return result
    changed = ["evidence_snapshot"]
    if previous.get("currency_scope") != current.get("currency_scope"):
        changed.append("currency_scope")
    result.update(status="evidence_changed", changed_fields=changed,
                  previous_snapshot=previous.get("evidence_snapshot"))
    return result


def validate_consistency(value: Any, organization_id: str | None = None) -> list[str]:
    if not isinstance(value, dict):
        return ["consistency_not_object"]
    errors = []
    if value.get("contract_version") != CONSISTENCY_CONTRACT_VERSION:
        errors.append("consistency_contract")
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", str(value.get("request_key") or "")):
        errors.append("consistency_request_key")
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", str(value.get("evidence_snapshot") or "")):
        errors.append("consistency_snapshot")
    if value.get("status") not in {"new_context", "context_changed", "unchanged", "evidence_changed"}:
        errors.append("consistency_status")
    if not isinstance(value.get("changed_fields"), list):
        errors.append("consistency_changed_fields")
    return errors


def redact_sensitive(value: Any, *, depth: int = 0) -> Any:
    """Defensive derived-context/log sanitizer. Allowlist numeric/text semantics."""
    if depth > 12:
        return None
    if isinstance(value, dict):
        cleaned = {}
        for key, child in value.items():
            if re.search(r"(?:access.?token|api.?key|secret|password|authorization|database.?url|connection.?string|email|phone|address|raw.?prompt|stack.?trace)", str(key), re.I):
                continue
            cleaned[str(key)] = redact_sensitive(child, depth=depth + 1)
        return cleaned
    if isinstance(value, list):
        return [redact_sensitive(child, depth=depth + 1) for child in value]
    if isinstance(value, str):
        return re.sub(r"(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}", "[redacted]", value)[:4000]
    return value if value is None or isinstance(value, (int, float, bool)) else str(value)
