"""Request-scoped, privacy-safe execution telemetry for Rev.

One ``ExecutionRecorder`` lives for exactly one Rev execution (``run_investigation``)
and collects bounded, structured facts about how the answer was produced:

* identifiers (request / correlation / execution / conversation ids),
* objective and routing classification,
* every model call (purpose, provider, model, duration, provider-reported
  tokens, attempts, fallback, outcome, failure category),
* stage timings, tool executions (including reuse and cache outcomes),
  knowledge-source usage, retries, fallback, failure category, cancellation
  and the final status.

Privacy contract: the recorder only accepts identifiers, enumerations, counts,
durations and token numbers. Every string is checked against a strict token
pattern and dropped if it does not match, so merchant text, prompts, evidence
values, URLs with query strings, customer data, credentials and raw provider
errors cannot enter the record even by mistake. Nothing here is a durable
store: the record is attached to the response (``execution_trace``), written
once to the structured log, and the Node layer persists a further-sanitised
projection.
"""
from __future__ import annotations

import json
import logging
import re
import threading
import time
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Any, Iterator

logger = logging.getLogger("rev.execution_telemetry")

TELEMETRY_VERSION = "rev-execution-telemetry-v1"

_TOKEN = re.compile(r"[A-Za-z0-9._:-]{1,80}\Z")
_UUIDISH = re.compile(r"[A-Za-z0-9-]{1,128}\Z")

MAX_MODEL_CALLS = 24
MAX_STAGES = 40
MAX_TOOLS = 32
MAX_KNOWLEDGE = 12

MODEL_CALL_PURPOSES = frozenset({
    "understanding", "agent_turn", "web_search", "shopify_docs_search", "answer_composition",
    "narrative", "auxiliary",
})

_current: ContextVar["ExecutionRecorder | None"] = ContextVar("rev_execution_recorder", default=None)
_purpose: ContextVar[str] = ContextVar("rev_model_call_purpose", default="auxiliary")


def _token(value: Any) -> str | None:
    """Return ``value`` only when it is a short, safe enumeration-like token."""
    if isinstance(value, str) and _TOKEN.fullmatch(value):
        return value
    return None


def _count(value: Any, limit: int = 10_000_000) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int) and 0 <= value <= limit:
        return value
    if isinstance(value, float) and value == value and 0 <= value <= limit:
        return int(value)
    return None


def _ms(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value != value:
        return None
    return round(max(0.0, min(float(value), 3_600_000.0)), 1)


class ExecutionRecorder:
    """Bounded collector for one execution. Thread-safe."""

    def __init__(self, *, request_id: str | None = None, correlation_id: str | None = None,
                 execution_id: str | None = None, conversation_id: str | None = None,
                 organization_id: str | None = None, investigation_id: str | None = None,
                 surface: str = "investigation") -> None:
        self._lock = threading.Lock()
        self._started = time.monotonic()
        self.started_at = datetime.now(timezone.utc).isoformat()
        self.identifiers = {
            "request_id": request_id if isinstance(request_id, str) and _UUIDISH.fullmatch(request_id) else None,
            "correlation_id": correlation_id if isinstance(correlation_id, str) and _UUIDISH.fullmatch(correlation_id) else None,
            "execution_id": execution_id if isinstance(execution_id, str) and _UUIDISH.fullmatch(execution_id) else None,
            "conversation_id": conversation_id if isinstance(conversation_id, str) and _UUIDISH.fullmatch(conversation_id) else None,
            "organization_id": organization_id if isinstance(organization_id, str) and _UUIDISH.fullmatch(organization_id) else None,
            "investigation_id": investigation_id if isinstance(investigation_id, str) and _UUIDISH.fullmatch(investigation_id) else None,
        }
        self.surface = _token(surface) or "investigation"
        self.objective: dict[str, Any] = {}
        self.routing: dict[str, Any] = {}
        self.stages: list[dict] = []
        self.model_calls: list[dict] = []
        self.tools: list[dict] = []
        self.knowledge: list[dict] = []
        self.cache: dict[str, dict[str, int]] = {}
        self.dropped = {"model_calls": 0, "stages": 0, "tools": 0}
        self.failure_category: str | None = None
        self.cancelled = False

    def set_identifier(self, name: str, value: Any) -> None:
        if name in self.identifiers and isinstance(value, str) and _UUIDISH.fullmatch(value):
            with self._lock:
                self.identifiers[name] = value

    # -- recording ---------------------------------------------------------
    def set_objective(self, **fields: Any) -> None:
        with self._lock:
            for key in ("intent", "request_class", "response_mode", "objective_kind"):
                if key in fields:
                    self.objective[key] = _token(fields[key])

    def set_routing(self, **fields: Any) -> None:
        with self._lock:
            for key in ("gate", "source", "intent", "route", "knowledge_route", "agent_mode"):
                if key in fields:
                    self.routing[key] = _token(fields[key])
            for key in ("topic_change", "followup", "inherited_context", "private_context_allowed",
                        "web_requested"):
                if key in fields:
                    self.routing[key] = bool(fields[key])
            if "sources" in fields:
                self.routing["sources"] = [s for s in (_token(v) for v in fields["sources"] or []) if s][:8]
            if "confidence" in fields and isinstance(fields["confidence"], (int, float)) \
                    and not isinstance(fields["confidence"], bool):
                self.routing["confidence"] = round(max(0.0, min(float(fields["confidence"]), 1.0)), 3)

    def record_stage(self, name: str, duration_ms: float, outcome: str = "success") -> None:
        name_token = _token(name)
        if not name_token:
            return
        with self._lock:
            if len(self.stages) >= MAX_STAGES:
                self.dropped["stages"] += 1
                return
            self.stages.append({"stage": name_token, "duration_ms": _ms(duration_ms),
                                "outcome": _token(outcome) or "unknown"})

    def record_model_call(self, *, provider: Any, model: Any, duration_ms: Any = None,
                          input_tokens: Any = None, output_tokens: Any = None, attempt: Any = 1,
                          fallback_used: Any = False, outcome: str = "success",
                          category: Any = None, purpose: str | None = None) -> None:
        purpose = purpose or _purpose.get()
        entry = {
            "purpose": purpose if purpose in MODEL_CALL_PURPOSES else "auxiliary",
            "provider": _token(provider), "model": _token(model),
            "duration_ms": _ms(duration_ms),
            "input_tokens": _count(input_tokens), "output_tokens": _count(output_tokens),
            # 1-based attempt index inside one logical request; >1 is a retry
            # (same provider) or an authorised fallback (see fallback_used).
            "attempt": _count(attempt, 10) or 1,
            "fallback_used": bool(fallback_used),
            "outcome": _token(outcome) or "unknown",
            "failure_category": _token(category),
        }
        with self._lock:
            if len(self.model_calls) >= MAX_MODEL_CALLS:
                self.dropped["model_calls"] += 1
                return
            self.model_calls.append(entry)

    def record_tool(self, tool: str, status: str, duration_ms: Any = None, *, reused: bool = False,
                    cache: str | None = None, failure_category: str | None = None,
                    selected_by: str | None = None) -> None:
        tool_token = _token(tool)
        if not tool_token:
            return
        entry = {"tool": tool_token, "status": _token(status) or "unknown", "duration_ms": _ms(duration_ms),
                 "reused": bool(reused)}
        if cache:
            entry["cache"] = _token(cache)
        if failure_category:
            entry["failure_category"] = _token(failure_category)
        if selected_by:
            entry["selected_by"] = _token(selected_by)
        with self._lock:
            if len(self.tools) >= MAX_TOOLS:
                self.dropped["tools"] += 1
                return
            self.tools.append(entry)

    def record_cache(self, cache_name: str, outcome: str) -> None:
        name, result = _token(cache_name), _token(outcome)
        if not name or result not in {"hit", "miss", "store", "bypass", "expired", "invalidated"}:
            return
        with self._lock:
            bucket = self.cache.setdefault(name, {})
            bucket[result] = bucket.get(result, 0) + 1

    def record_knowledge(self, source: str, status: str, *, result_count: Any = 0,
                         retrieval_mode: str | None = None, duration_ms: Any = None,
                         cache_hit: bool = False) -> None:
        source_token = _token(source)
        if not source_token:
            return
        with self._lock:
            if len(self.knowledge) >= MAX_KNOWLEDGE:
                return
            self.knowledge.append({"source": source_token, "status": _token(status) or "unknown",
                                   "result_count": _count(result_count, 1000) or 0,
                                   "retrieval_mode": _token(retrieval_mode),
                                   "duration_ms": _ms(duration_ms), "cache_hit": bool(cache_hit)})

    def note_failure(self, category: Any) -> None:
        token = _token(category)
        if token:
            with self._lock:
                self.failure_category = self.failure_category or token

    def note_cancelled(self) -> None:
        with self._lock:
            self.cancelled = True

    @contextmanager
    def stage(self, name: str) -> Iterator[None]:
        started = time.monotonic()
        outcome = "success"
        try:
            yield
        except BaseException as exc:
            outcome = "cancelled" if type(exc).__name__ in {"InvestigationCancelled", "AgentCancelled"} else "failure"
            raise
        finally:
            self.record_stage(name, (time.monotonic() - started) * 1000, outcome)

    # -- output ------------------------------------------------------------
    def elapsed_ms(self) -> float:
        return round((time.monotonic() - self._started) * 1000, 1)

    def summary(self, *, final_status: str, outcome: str | None = None) -> dict:
        """The structured telemetry block (no merchant content by construction)."""
        with self._lock:
            calls = [dict(call) for call in self.model_calls]
            successful = [call for call in calls if call["outcome"] == "success"]
            reported = [call for call in successful
                        if call["input_tokens"] is not None and call["output_tokens"] is not None]
            input_tokens = sum(call["input_tokens"] for call in reported)
            output_tokens = sum(call["output_tokens"] for call in reported)
            if not successful:
                scope = "no_model_calls"
            elif len(reported) == len(successful):
                scope = "all_model_calls"
            else:
                scope = "partial_provider_reported"
            retries = sum(1 for call in calls if call["attempt"] > 1)
            failures = [call["failure_category"] for call in calls if call["failure_category"]]
            tool_reuse = sum(1 for tool in self.tools if tool["reused"])
            return {
                "telemetry_version": TELEMETRY_VERSION,
                "surface": self.surface,
                "identifiers": dict(self.identifiers),
                "started_at": self.started_at,
                "duration_ms": self.elapsed_ms(),
                "objective": dict(self.objective),
                "routing": dict(self.routing),
                "stages": [dict(stage) for stage in self.stages],
                "model_calls": calls,
                "model_call_count": len(calls),
                "token_usage": {"input": input_tokens, "output": output_tokens,
                                "total": input_tokens + output_tokens, "scope": scope,
                                "calls_with_usage": len(reported), "successful_calls": len(successful)},
                "tools": [dict(tool) for tool in self.tools],
                "tool_reuse_count": tool_reuse,
                "knowledge_sources": [dict(entry) for entry in self.knowledge],
                "cache": {name: dict(values) for name, values in self.cache.items()},
                "retries": retries,
                "fallback_used": any(call["fallback_used"] for call in calls),
                "failure_category": self.failure_category or (failures[-1] if failures and not successful else None),
                "cancelled": self.cancelled,
                "final_status": _token(final_status) or "unknown",
                "outcome": _token(outcome),
                "dropped": dict(self.dropped),
            }


# ---------------------------------------------------------------------------
# Context helpers (no-ops when no execution is being recorded)
# ---------------------------------------------------------------------------

def current() -> ExecutionRecorder | None:
    return _current.get()


@contextmanager
def recording(recorder: ExecutionRecorder) -> Iterator[ExecutionRecorder]:
    token = _current.set(recorder)
    try:
        yield recorder
    finally:
        _current.reset(token)


@contextmanager
def model_call_purpose(purpose: str) -> Iterator[None]:
    token = _purpose.set(purpose if purpose in MODEL_CALL_PURPOSES else "auxiliary")
    try:
        yield
    finally:
        _purpose.reset(token)


@contextmanager
def stage(name: str) -> Iterator[None]:
    recorder = _current.get()
    if recorder is None:
        yield
        return
    with recorder.stage(name):
        yield


def record_model_call(**fields: Any) -> None:
    recorder = _current.get()
    if recorder is not None:
        try:
            recorder.record_model_call(**fields)
        except Exception:  # telemetry must never break execution
            logger.debug("rev_telemetry_model_call_failed")


def record_tool(*args: Any, **kwargs: Any) -> None:
    recorder = _current.get()
    if recorder is not None:
        try:
            recorder.record_tool(*args, **kwargs)
        except Exception:
            logger.debug("rev_telemetry_tool_failed")


def record_cache(cache_name: str, outcome: str) -> None:
    recorder = _current.get()
    if recorder is not None:
        recorder.record_cache(cache_name, outcome)


def record_knowledge(*args: Any, **kwargs: Any) -> None:
    recorder = _current.get()
    if recorder is not None:
        try:
            recorder.record_knowledge(*args, **kwargs)
        except Exception:
            logger.debug("rev_telemetry_knowledge_failed")


def emit(summary: dict) -> None:
    """Write the single structured execution record to the log."""
    try:
        logger.info("rev_execution_record %s", json.dumps(summary, separators=(",", ":"), default=str))
    except Exception:
        logger.debug("rev_telemetry_emit_failed")
