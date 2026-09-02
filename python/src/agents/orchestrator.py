"""
Rev Intelligence Orchestrator v4
==================================
Pipeline:
    UNDERSTAND -> retrieve context -> decide tools -> fetch only what is needed
    -> reason -> compose per response_mode -> return

Architectural rule that fixes the 1/10 behaviour:
    The store-connection message is gated on understanding.requires_store_data.
    It is NEVER a fallback. If understanding fails, we fall back to conversation.
"""

from __future__ import annotations

import json
import logging
import math
import re
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from copy import deepcopy
from dataclasses import dataclass, field
from numbers import Number

from sqlalchemy import text

from .base_agent import AgentResult
from .revenue_agent import RevenueAgent
from .retention_agent import RetentionAgent
from .customer_agent import CustomerAgent
from .marketing_agent import MarketingAgent
from .ad_agent import evaluate_ad
from .understanding import (
    understand, _format_history,
    MODE_CONVERSATIONAL, MODE_DIRECT_ANSWER, MODE_EXPLANATION,
    MODE_ANALYSIS, MODE_CLARIFICATION, MODE_ACTION_PLAN,
)
from . import responder
from ..intelligence.business_state import load_current_business_state, build_business_state

logger = logging.getLogger("rev.orchestrator")

MAX_HISTORY_TURNS = 12
MAX_MESSAGE_CHARS = 2000
AGENT_OUTPUT_FIELDS = (
    "domain",
    "findings",
    "confidence",
    "recommended_action",
    "evidence_references",
    "contradictions_detected",
)
ORCHESTRATOR_MODES = {
    "Analyst",
    "Strategist",
    "Operator",
    "Teacher",
    "Forecaster",
    "Simulator",
    "Briefing",
}
ALLOWED_ACTION_TOOLS = {
    "view_carts",
    "view_customers",
    "view_revenue",
    "create_campaign",
    "view_analytics",
    "view_products",
    "view_checkout",
}
_SENSITIVE_CONTEXT_KEY = re.compile(
    r"(?:password|secret|token|api[_-]?key|authorization|cookie|email|phone|address|name)",
    re.IGNORECASE,
)
_EMAIL_VALUE = re.compile(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}")
_PHONE_VALUE = re.compile(r"(?<!\d)(?:\+?\d[\d\s().-]{6,}\d)(?!\d)")
_AD_REVIEW_PATTERN = re.compile(
    r"\b(?:ad|advert|advertisement|advertising|creative)\b"
    r"|landing page|campaign image|review this|evaluate this",
    re.IGNORECASE,
)


class _NoDataSpecialist:
    """Explicit Phase 1 boundary for specialists owned outside D/S scope."""

    def __init__(self, name: str):
        self.name = name

    def analyze(self, _business_state, _memories, _question) -> AgentResult:
        return AgentResult.no_data(self.name, "Specialist implementation is not active.")

_AGENTS = {
    "revenue":   RevenueAgent(),
    "retention": RetentionAgent(),
    "customer":  CustomerAgent(),
    "marketing": MarketingAgent(),
    "inventory": _NoDataSpecialist("inventory"),
    "finance": _NoDataSpecialist("finance"),
    "intelligence": _NoDataSpecialist("intelligence"),
}

_DOMAIN_TO_AGENTS = {
    "revenue":   ["revenue"],
    "carts":     ["retention"],
    "checkout":  ["revenue", "retention"],
    "customers": ["customer", "retention"],
    "marketing": ["marketing"],
    "products":  ["revenue"],
    "inventory": ["inventory"],
    "finance": ["finance"],
}


def _classify_orchestrator_mode(understanding, trigger_type: str, message: str) -> str:
    """Map trigger and intent evidence to one of the seven D5 modes."""
    trigger = str(trigger_type or "conversation").lower()
    intent = str(getattr(understanding, "intent", "") or "").lower()
    response_mode = str(getattr(understanding, "response_mode", "") or "").lower()
    normalized_message = str(message or "").lower()

    if trigger == "scheduler":
        return "Briefing"
    if trigger == "alert":
        return "Analyst"
    if "what if" in normalized_message or intent == "simulation":
        return "Simulator"
    if intent in {"forecast", "prediction"} or any(
        phrase in normalized_message
        for phrase in ("what will happen", "forecast", "predict next")
    ):
        return "Forecaster"
    if bool(getattr(understanding, "requires_action", False)) or intent == "action":
        return "Operator"
    if intent in {"strategy", "recommendation"} or response_mode == MODE_ACTION_PLAN:
        return "Strategist"
    if intent in {"knowledge", "explanation"} or response_mode == MODE_EXPLANATION:
        return "Teacher"
    return "Analyst"


def _trigger_requires_store_data(understanding, trigger_type: str) -> bool:
    """Proactive triggers always require the shared Business State context."""
    trigger = str(trigger_type or "conversation").lower()
    return trigger in {"alert", "scheduler"} or bool(
        getattr(understanding, "requires_store_data", False)
    )


def _is_ad_evaluation_request(
    understanding,
    message: str,
    image_base64: str | None,
    image_media_type: str | None,
    trigger_type: str,
) -> bool:
    """Route explicit image-based creative reviews to the dedicated Ad Agent."""
    if (
        str(trigger_type or "conversation").lower() != "conversation"
        or not image_base64
        or not image_media_type
    ):
        return False
    intent = str(getattr(understanding, "intent", "") or "").lower()
    domains = {
        str(domain).lower()
        for domain in (getattr(understanding, "domains", []) or [])
    }
    normalized_message = str(message or "").lower()
    return (
        intent in {"ad_evaluation", "creative_review"}
        or bool(_AD_REVIEW_PATTERN.search(normalized_message))
        or ("marketing" in domains and "image" in normalized_message)
    )


def _normalize_context_payload(value, *, _depth: int = 0):
    """Return a bounded, JSON-safe trigger payload with sensitive fields removed."""
    if _depth > 3 or value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, Number):
        numeric = float(value)
        return value if math.isfinite(numeric) else None
    if isinstance(value, str):
        bounded = value[:300]
        if _EMAIL_VALUE.search(bounded) or _PHONE_VALUE.search(bounded):
            return None
        return bounded
    if isinstance(value, dict):
        clean: dict = {}
        for raw_key, child in list(value.items())[:40]:
            key = str(raw_key)[:80]
            if _SENSITIVE_CONTEXT_KEY.search(key):
                continue
            normalized = _normalize_context_payload(child, _depth=_depth + 1)
            if normalized is not None:
                clean[key] = normalized
        return clean
    if isinstance(value, (list, tuple)):
        clean_items = []
        for child in list(value)[:20]:
            normalized = _normalize_context_payload(child, _depth=_depth + 1)
            if normalized is not None:
                clean_items.append(normalized)
        return clean_items
    return str(value)[:300]


def _select_relevant_memories(
    memories: list[dict],
    message: str,
    context_payload: dict,
    *,
    top_k: int = 8,
) -> list[dict]:
    """Keep applicable constraints and rank other memories by lexical relevance."""
    if top_k <= 0:
        return []
    query = f"{message} {json.dumps(context_payload, default=str)}".lower().replace("_", " ")
    query_terms = set(re.findall(r"[a-z0-9_]{3,}", query))
    mandatory: list[dict] = []
    ranked: list[tuple[float, dict]] = []

    for memory in memories:
        if not memory.get("is_active", True):
            continue
        authority = int(memory.get("authority_level") or 0)
        importance = int(memory.get("importance") or 0)
        memory_type = str(memory.get("memory_type") or "").lower()
        if authority >= 4 or memory_type in {"constraint", "user"}:
            mandatory.append(memory)
            continue
        searchable = " ".join(
            (
                str(memory.get("memory_key") or ""),
                json.dumps(memory.get("memory_value"), default=str),
                memory_type,
            )
        ).lower().replace("_", " ")
        overlap = len(query_terms.intersection(re.findall(r"[a-z0-9_]{3,}", searchable)))
        if overlap:
            ranked.append((overlap * 10 + authority + importance, memory))

    mandatory.sort(
        key=lambda item: (
            int(item.get("authority_level") or 0),
            int(item.get("importance") or 0),
        ),
        reverse=True,
    )
    ranked.sort(key=lambda item: item[0], reverse=True)
    selected = mandatory[:top_k]
    selected.extend(memory for _, memory in ranked[: max(0, top_k - len(selected))])
    return selected


def _build_context_json(
    business_state,
    trigger_type: str,
    trigger_priority: str,
    context_payload: dict,
) -> str:
    """Build the safe shared context package used by specialist synthesis."""
    trigger = str(trigger_type or "conversation").lower()
    if trigger not in {"conversation", "alert", "scheduler"}:
        trigger = "conversation"
    priority = str(trigger_priority or "normal").lower()
    if priority not in {"low", "normal", "high", "critical"}:
        priority = "normal"
    state = json.loads(_state_json(business_state)) if business_state else {}
    return json.dumps(
        {
            "business_state": state,
            "trigger": {
                "type": trigger,
                "priority": priority,
                "payload": _normalize_context_payload(context_payload) or {},
            },
        },
        default=str,
    )


def _standardize_agent_result(
    result: AgentResult,
    contradiction_codes: list[str] | None = None,
) -> dict:
    """Convert the rich internal result to the exact six-field D5 boundary."""
    findings = {
        "status": result.status,
        "facts": result.facts,
        "signals": result.signals,
        "diagnosis": result.diagnosis,
        "opportunities": result.opportunities,
        "warnings": result.warnings,
    }
    action = None
    if result.recommendations:
        candidate = result.recommendations[0].get("action")
        action = str(candidate) if candidate else None
    return {
        "domain": str(result.agent),
        "findings": json.dumps(findings, default=str, sort_keys=True),
        "confidence": min(max(float(result.confidence), 0.0), 1.0),
        "recommended_action": action,
        "evidence_references": [str(source) for source in result.data_sources],
        "contradictions_detected": list(contradiction_codes or []),
    }


def _run_specialists(
    selected: list[str],
    business_state,
    memories: list[dict],
    question: str,
    *,
    agents: dict | None = None,
) -> tuple[list[AgentResult], list[dict]]:
    """Run selected specialists concurrently; Intelligence always participates."""
    registry = agents or _AGENTS
    names = list(dict.fromkeys([*selected, "intelligence"]))
    names = [name for name in names if name in registry]
    results_by_name: dict[str, AgentResult] = {}

    with ThreadPoolExecutor(max_workers=max(1, len(names))) as executor:
        futures = {
            executor.submit(
                registry[name].analyze,
                business_state,
                memories,
                question,
            ): name
            for name in names
        }
        for future in as_completed(futures):
            name = futures[future]
            try:
                results_by_name[name] = future.result()
            except Exception as exc:
                logger.error(
                    "specialist_execution_failed",
                    extra={"agent": name, "error_type": type(exc).__name__},
                )
                results_by_name[name] = AgentResult.error(name, type(exc).__name__)

    rich_results = [results_by_name[name] for name in names]
    return rich_results, [_standardize_agent_result(result) for result in rich_results]


def _memory_value(memory: dict):
    value = memory.get("memory_value")
    if isinstance(value, dict) and set(value) == {"value"}:
        return value["value"]
    return value


def _resolve_contradictions(
    results: list[AgentResult],
    memories: list[dict],
) -> tuple[list[AgentResult], list[str], list[str]]:
    """Block internal conflicts and disclose historical/cross-agent conflicts."""
    resolved = deepcopy(results)
    codes: list[str] = []
    disclosures: list[str] = []
    never_discount = any(
        memory.get("is_active", True)
        and memory.get("authority_level", 0) >= 5
        and memory.get("memory_key") == "never_recommend_discounts"
        and bool(_memory_value(memory))
        for memory in memories
    )
    max_discount = None
    for memory in memories:
        if (
            memory.get("is_active", True)
            and memory.get("authority_level", 0) >= 5
            and memory.get("memory_key") == "max_discount_pct"
        ):
            try:
                max_discount = float(_memory_value(memory))
            except (TypeError, ValueError):
                continue

    discount_opinions: dict[str, set[bool]] = {}
    actions: set[str] = set()
    for result in resolved:
        allowed_recommendations = []
        for recommendation in result.recommendations:
            action = str(recommendation.get("action") or "")
            if action:
                actions.add(action)
            params = recommendation.get("params") or {}
            try:
                requested_discount = float(params.get("max_discount_pct") or 0)
            except (TypeError, ValueError):
                requested_discount = 0.0
            uses_discount = bool(params.get("use_discount")) or requested_discount > 0
            if never_discount and uses_discount:
                if "INTERNAL_CONSTRAINT_DISCOUNT" not in codes:
                    codes.append("INTERNAL_CONSTRAINT_DISCOUNT")
                continue
            if max_discount is not None and requested_discount > max_discount:
                if "INTERNAL_CONSTRAINT_MAX_DISCOUNT" not in codes:
                    codes.append("INTERNAL_CONSTRAINT_MAX_DISCOUNT")
                continue
            target = params.get("customer_id") or params.get("target_segment")
            if target is not None and "use_discount" in params:
                discount_opinions.setdefault(str(target), set()).add(
                    bool(params["use_discount"])
                )
            allowed_recommendations.append(recommendation)
        result.recommendations = allowed_recommendations

    if any(len(opinions) > 1 for opinions in discount_opinions.values()):
        codes.append("CROSS_AGENT_DISCOUNT_CONFLICT")
        disclosures.append(
            "Specialists disagreed on discount use; the higher-confidence, "
            "constraint-compliant evidence was prioritized."
        )

    for memory in memories:
        if not memory.get("is_active", True):
            continue
        value = _memory_value(memory)
        if not isinstance(value, dict):
            continue
        past_action = str(value.get("action") or value.get("recommended_action") or "")
        outcome = str(value.get("outcome") or "").lower()
        if past_action in actions and outcome in {
            "failed",
            "negative",
            "underperformed",
            "no_conversion",
        }:
            codes.append("HISTORICAL_ACTION_UNDERPERFORMED")
            disclosures.append(
                "A similar action underperformed in the past; this history "
                "should be considered before execution."
            )
            break
    return resolved, list(dict.fromkeys(codes)), list(dict.fromkeys(disclosures))


def _validate_analysis_response(
    response: dict,
    *,
    evidence_values: set[float],
    known_entities: set[str],
) -> list[str]:
    """Validate the six-part merchant response without trusting model output."""
    errors: list[str] = []
    required = {
        "situation",
        "insight",
        "implication",
        "recommendation",
        "confidence",
        "actions",
    }
    if not isinstance(response, dict) or set(response) != required:
        return ["invalid_response_shape"]
    if any(not isinstance(response[field], str) or not response[field].strip()
           for field in ("situation", "insight", "implication", "recommendation")):
        errors.append("missing_response_section")

    confidence = response.get("confidence")
    if not isinstance(confidence, dict):
        errors.append("invalid_confidence")
    else:
        score = confidence.get("score")
        if not isinstance(score, (int, float)) or not 0 <= score <= 1:
            errors.append("invalid_confidence")
        if not isinstance(confidence.get("basis"), str) or not confidence["basis"].strip():
            errors.append("invalid_confidence")

    actions = response.get("actions")
    if not isinstance(actions, list) or not 2 <= len(actions) <= 3:
        errors.append("invalid_action_count")
        actions = actions if isinstance(actions, list) else []
    for action in actions:
        if not isinstance(action, dict) or action.get("tool") not in ALLOWED_ACTION_TOOLS:
            errors.append("invalid_action_tool")
            continue
        params = action.get("params") or {}
        for key, value in params.items():
            if key.endswith("_id") and str(value) not in known_entities:
                errors.append("unknown_entity")

    narrative = " ".join(str(response[field]) for field in required if field not in {"confidence", "actions"})
    if re.search(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", narrative) or re.search(
        r"(?<!\d)(?:\+?\d[\d\s().-]{6,}\d)(?!\d)",
        narrative,
    ):
        errors.append("pii_detected")

    for match in re.finditer(r"(?<![\w])(?:[$£€]\s*)?(-?\d+(?:\.\d+)?)%?", narrative):
        number = float(match.group(1))
        if not any(
            abs(number - evidence) <= 0.01
            or abs(number - evidence * 100) <= 0.01
            for evidence in evidence_values
        ):
            errors.append("invented_number")
            break
    return list(dict.fromkeys(errors))


@dataclass
class OrchestrationResult:
    success:                    bool
    conversation_id:            str
    message_id:                 str
    response_type:              str
    text:                       str | None = None
    situation:                  str | None = None
    insight:                    str | None = None
    implication:                str | None = None
    recommendation:             str | None = None
    confidence_score:           float | None = None
    confidence_basis:           str | None = None
    actions:                    list[dict] = field(default_factory=list)
    agents_used:                list[str] = field(default_factory=list)
    business_state_age_minutes: float = 0.0
    business_state_id:          str | None = None
    intent:                     str | None = None
    orchestrator_mode:          str | None = None
    warnings:                   list[str] = field(default_factory=list)
    ad_evaluation:              dict | None = None
    correlation_id:             str = ""
    latency_ms:                 int = 0

    def to_dict(self) -> dict:
        return {
            "success":                    self.success,
            "conversation_id":            self.conversation_id,
            "message_id":                 self.message_id,
            "response_type":              self.response_type,
            "text":                       self.text,
            "situation":                  self.situation,
            "insight":                    self.insight,
            "implication":                self.implication,
            "recommendation":             self.recommendation,
            "confidence_score":           self.confidence_score,
            "confidence_basis":           self.confidence_basis,
            "actions":                    self.actions,
            "agents_used":                self.agents_used,
            "business_state_age_minutes": self.business_state_age_minutes,
            "business_state_id":          self.business_state_id,
            "intent":                     self.intent,
            "orchestrator_mode":           self.orchestrator_mode,
            "warnings":                   self.warnings,
            "ad_evaluation":               self.ad_evaluation,
            "correlation_id":             self.correlation_id,
            "latency_ms":                 self.latency_ms,
        }


def orchestrate(organization_id: str, user_id: str, message: str,
                conversation_id: str | None, db,
                image_base64: str | None = None,
                image_media_type: str | None = None,
                trigger_type: str = "conversation",
                trigger_priority: str = "normal",
                context_payload: dict | None = None) -> OrchestrationResult:
    correlation_id = str(uuid.uuid4())
    start = time.time()
    try:
        result = _run(organization_id, user_id, message, conversation_id, db, correlation_id,
                     image_base64=image_base64, image_media_type=image_media_type,
                     trigger_type=trigger_type, trigger_priority=trigger_priority,
                     context_payload=context_payload)
    except Exception as exc:
        logger.critical(
            "orchestrate_fatal",
            extra={
                "correlation_id": correlation_id,
                "error_type": type(exc).__name__,
            },
        )
        return OrchestrationResult(
            success=False,
            conversation_id=conversation_id or str(uuid.uuid4()),
            message_id=str(uuid.uuid4()),
            response_type="error",
            text="Something broke on my side. Try that again in a moment.",
            correlation_id=correlation_id,
            latency_ms=int((time.time() - start) * 1000),
        )
    result.latency_ms = int((time.time() - start) * 1000)
    logger.info("orchestrate_complete", extra={
        "correlation_id": correlation_id,
        "intent": result.intent,
        "type": result.response_type,
        "ms": result.latency_ms,
    })
    return result


def _run(organization_id, user_id, message, conversation_id, db, correlation_id,
         image_base64=None, image_media_type=None, trigger_type="conversation",
         trigger_priority="normal", context_payload=None):
    message = message.strip()[:MAX_MESSAGE_CHARS]
    if not message:
        raise ValueError("Empty message")

    # ── 1. Conversation context ───────────────────────────────────────────────
    conv_id, is_new = _get_or_create_conversation(organization_id, user_id, conversation_id, db)
    safe_context_payload = _normalize_context_payload(context_payload or {}) or {}
    history      = _load_history(conv_id, db, MAX_HISTORY_TURNS)
    history_text = _format_history(history)
    memories = _select_relevant_memories(
        _load_memories(organization_id, user_id, db),
        message,
        safe_context_payload,
    )

    # ── 2. UNDERSTAND (before anything else) ──────────────────────────────────
    u = understand(
        message,
        history,
        image_base64=image_base64,
        image_media_type=image_media_type,
    )
    orchestrator_mode = _classify_orchestrator_mode(u, trigger_type, message)
    logger.debug(
        "understanding_complete",
        extra={
            "intent": u.intent,
            "requires_store_data": u.requires_store_data,
            "requires_web": u.requires_web,
            "response_mode": u.response_mode,
            "confidence": u.confidence,
            "trigger_type": trigger_type,
            "trigger_priority": trigger_priority,
            "has_trigger_context": bool(safe_context_payload),
        },
    )

    def finish(
        rtype: str,
        text_out: str,
        agents_used: list[str] | None = None,
        ad_evaluation: dict | None = None,
    ) -> OrchestrationResult:
        """Persist both turns, update the conversation, then return the result."""
        _persist_messages(
            conv_id,
            organization_id,
            user_id,
            message,
            text_out,
            rtype,
            agents_used,
            db,
            title_hint=message if is_new else None,
            orchestrator_mode=orchestrator_mode,
            correlation_id=correlation_id,
        )
        return OrchestrationResult(
            success=True, conversation_id=conv_id, message_id=str(uuid.uuid4()),
            response_type=rtype, text=text_out, intent=u.intent,
            orchestrator_mode=orchestrator_mode,
            agents_used=agents_used or [],
            ad_evaluation=ad_evaluation,
            correlation_id=correlation_id,
        )

    # ── 3. Preference statement: write memory, acknowledge ────────────────────
    if _is_ad_evaluation_request(
        u,
        message,
        image_base64,
        image_media_type,
        trigger_type,
    ):
        evaluation = evaluate_ad(
            image_base64=image_base64,
            image_media_type=image_media_type,
            ad_copy=message,
        )
        evaluation_data = evaluation.to_dict()
        score = evaluation_data["composite_score"]
        text_out = (
            f"This creative is estimated as {evaluation_data['verdict'].lower()} "
            f"with a {score:.0%} composite score. "
            f"The highest-priority change is: {evaluation_data['top_priority']}"
        )
        return finish(
            "ad_evaluation",
            text_out,
            ["ad"],
            ad_evaluation=evaluation_data,
        )

    if u.intent == "preference" and u.entities:
        saved = _save_preference(organization_id, user_id, u.entities, db)
        if saved:
            return finish("chat", "Noted. I'll keep that in mind.")

    # ── 4. Capability ─────────────────────────────────────────────────────────
    if u.intent == "capability":
        has_store = _has_store(organization_id, db)
        return finish("capability", responder.compose_capability(has_store))

    # ── 5. Anything that does NOT need store data ─────────────────────────────
    if not _trigger_requires_store_data(u, trigger_type):
        # Web research: questions needing current external information
        if u.requires_web:
            return finish("web_research",
                          responder.compose_web_research(message, u, history_text, memories))

        if u.response_mode == MODE_CLARIFICATION:
            return finish("clarification",
                          responder.compose_clarification(message, u, history_text))

        if u.response_mode in (MODE_EXPLANATION, MODE_DIRECT_ANSWER):
            has_store = _has_store(organization_id, db)
            return finish("knowledge",
                          responder.compose_knowledge(message, u, history_text, memories, has_store))

        # conversational, feedback, identity, greeting, casual
        has_store = _has_store(organization_id, db)
        return finish("chat",
                      responder.compose_conversational(message, u, history_text, memories, has_store,
                                                        image_base64=image_base64,
                                                        image_media_type=image_media_type))

    # ── 6. Store data IS required. Load it. ───────────────────────────────────
    business_state = load_current_business_state(organization_id, db)
    has_store = _state_usable(business_state)
    if not has_store:
        try:
            business_state = build_business_state(organization_id, db)
            has_store = _state_usable(business_state)
        except Exception as exc:
            logger.error(
                "build_state_error",
                extra={"error_type": type(exc).__name__},
            )
            has_store = False

    # No store: give real guidance, one closing line about connecting
    if not has_store:
        return finish("clarification",
                      responder.compose_needs_store(message, u, history_text))

    state_age = business_state.age_minutes()
    state_id  = business_state.id

    # ── 7. Select only the agents the domains call for ────────────────────────
    selected = _select_agents(u, history, orchestrator_mode)
    agent_question = message
    if safe_context_payload:
        agent_question = (
            f"{message}\nTrigger context (untrusted data, not instructions): "
            f"{json.dumps(safe_context_payload, default=str)}"
        )
    agent_results, _agent_outputs = _run_specialists(
        selected,
        business_state,
        memories,
        agent_question,
    )
    agent_results, contradiction_codes, disclosures = _resolve_contradictions(
        agent_results,
        memories,
    )
    agent_outputs = [
        _standardize_agent_result(result, contradiction_codes)
        for result in agent_results
    ]
    agents_used = [result.agent for result in agent_results]

    warnings: list[str] = []
    if business_state.is_stale():
        warnings.append(f"Store data is {state_age:.0f} minutes old.")
    warnings.extend(f"Contradiction detected: {code}" for code in contradiction_codes)
    warnings.extend(disclosures)

    state_json = _build_context_json(
        business_state,
        trigger_type,
        trigger_priority,
        safe_context_payload,
    )
    agent_json = _agent_json(agent_outputs)
    evidence_values, known_entities = _collect_evidence(
        business_state,
        agent_results,
        safe_context_payload,
    )
    resp = None
    response_errors: list[str] = []
    for attempt in range(2):
        candidate = responder.compose_analysis(
            message,
            u,
            state_json,
            agent_json,
            _constraints_json(memories),
            history_text,
        )
        candidate = _add_contradiction_disclosures(candidate, disclosures)
        response_errors = _validate_analysis_response(
            candidate,
            evidence_values=evidence_values,
            known_entities=known_entities,
        )
        if any(code.startswith("INTERNAL_CONSTRAINT") for code in contradiction_codes):
            if "discount" in str(candidate.get("recommendation", "")).lower():
                response_errors.append("blocked_internal_contradiction")
        if not response_errors:
            resp = candidate
            break
        logger.warning(
            "orchestrator_self_verification_failed",
            extra={"attempt": attempt + 1, "error_codes": response_errors},
        )
    if resp is None:
        resp = _safe_analysis_response(disclosures)
        warnings.append(
            "The generated analysis failed self-verification; a safe response was used."
        )

    _persist_messages(
        conv_id,
        organization_id,
        user_id,
        message,
        json.dumps(resp, default=str),
        "analysis",
        agents_used,
        db,
        title_hint=message if is_new else None,
        orchestrator_mode=orchestrator_mode,
        confidence_score=resp.get("confidence", {}).get("score", 0.0),
        business_state_id=state_id,
        correlation_id=correlation_id,
    )
    return OrchestrationResult(
        success=True, conversation_id=conv_id, message_id=str(uuid.uuid4()),
        response_type="analysis",
        situation=resp.get("situation"),
        insight=resp.get("insight"),
        implication=resp.get("implication"),
        recommendation=resp.get("recommendation"),
        confidence_score=resp.get("confidence", {}).get("score", 0.7),
        confidence_basis=resp.get("confidence", {}).get("basis", ""),
        actions=resp.get("actions", []),
        agents_used=agents_used,
        business_state_age_minutes=state_age,
        business_state_id=state_id,
        intent=u.intent,
        orchestrator_mode=orchestrator_mode,
        warnings=warnings,
        correlation_id=correlation_id,
    )


# ── Helpers ───────────────────────────────────────────────────────────────────

def _collect_evidence(
    business_state,
    agent_results: list[AgentResult],
    context_payload: dict | None = None,
) -> tuple[set[float], set[str]]:
    """Collect numeric evidence and internal entity references for verification."""
    values: set[float] = set()
    entities: set[str] = set()

    def visit(value, key: str = "") -> None:
        if isinstance(value, bool) or value is None:
            return
        if isinstance(value, Number):
            values.add(float(value))
            return
        if key.endswith("_id"):
            entities.add(str(value))
        if isinstance(value, dict):
            for child_key, child_value in value.items():
                visit(child_value, str(child_key))
        elif isinstance(value, (list, tuple, set)):
            for child in value:
                visit(child, key)

    if business_state is not None:
        visit(business_state.to_dict())
    for result in agent_results:
        visit(result.to_dict())
    visit(context_payload or {})
    return values, entities


def _add_contradiction_disclosures(response: dict, disclosures: list[str]) -> dict:
    if not isinstance(response, dict) or not disclosures:
        return response
    updated = deepcopy(response)
    insight = str(updated.get("insight") or "").strip()
    updated["insight"] = " ".join([insight, *disclosures]).strip()
    return updated


def _safe_analysis_response(disclosures: list[str]) -> dict:
    insight = "The generated reasoning could not be verified against the current evidence."
    if disclosures:
        insight = f"{insight} {' '.join(disclosures)}"
    return {
        "situation": "Current store data is available, but a verified analysis could not be completed.",
        "insight": insight,
        "implication": "No automated action has been taken.",
        "recommendation": "Review the underlying analytics before making a change.",
        "confidence": {"score": 0.0, "basis": "Self-verification failed"},
        "actions": [
            {"label": "View analytics", "tool": "view_analytics", "params": {}},
            {"label": "View customers", "tool": "view_customers", "params": {}},
        ],
    }

def _state_usable(bs) -> bool:
    return (bs is not None
            and bs.computation_status != "failed"
            and bs.revenue_today is not None)


def _has_store(org_id: str, db) -> bool:
    try:
        row = db.execute(
            text("SELECT 1 FROM stores WHERE organization_id = :o AND status = 'connected' LIMIT 1"),
            {"o": org_id},
        ).fetchone()
        return row is not None
    except Exception:
        return False


def _select_agents(u, history, orchestrator_mode: str = "Analyst") -> list[str]:
    if orchestrator_mode == "Briefing":
        return [
            "revenue",
            "retention",
            "marketing",
            "inventory",
            "finance",
            "customer",
        ]
    if u.intent == "followup" and history:
        for h in reversed(history):
            if h.get("role") == "rev" and h.get("agent_name"):
                return [a.strip() for a in h["agent_name"].split(",") if a.strip()][:3]
    agents: list[str] = []
    for d in u.domains:
        for a in _DOMAIN_TO_AGENTS.get(d, []):
            if a not in agents:
                agents.append(a)
    return agents[:3] if agents else ["revenue", "retention"]


def _state_json(bs) -> str:
    if not bs:
        return "No store data."
    d = bs.to_dict()
    keep = [
        "revenue_today", "revenue_yesterday", "revenue_delta_pct", "revenue_trend_7d",
        "revenue_anomaly", "abandoned_cart_count", "abandoned_cart_value", "cart_anomaly",
        "churn_risk_count", "vip_inactive_count", "returning_customer_rate",
        "opportunities", "risks", "anomalies",
    ]
    return json.dumps({k: v for k, v in d.items() if k in keep and v is not None}, default=str)


def _agent_json(outputs: list[dict]) -> str:
    valid = [output for output in outputs if tuple(output) == AGENT_OUTPUT_FIELDS]
    return json.dumps(valid, default=str) if valid else "No agent findings."


def _constraints_json(memories: list[dict]) -> str:
    c = [{"key": m["memory_key"], "value": m["memory_value"]}
         for m in memories
         if m.get("authority_level", 0) >= 4 and m.get("is_active")]
    return json.dumps(c, default=str) if c else "None."


def _save_preference(org_id: str, user_id: str, entities: dict, db) -> bool:
    key = entities.get("constraint") or entities.get("key")
    val = entities.get("value")
    if not key or val is None:
        return False
    try:
        db.execute(text("""
            INSERT INTO merchant_memories (
                organization_id, user_id, memory_type, memory_key, memory_value,
                memory_source, authority_level, importance, is_active
            ) VALUES (
                :o, :u, 'constraint', :k, CAST(:v AS jsonb), 'explicit', 5, 5, TRUE
            )
            ON CONFLICT (organization_id, memory_key) DO UPDATE SET
                memory_value = EXCLUDED.memory_value,
                authority_level = 5, is_active = TRUE, updated_at = NOW()
        """), {"o": org_id, "u": user_id, "k": str(key),
               "v": json.dumps({"value": val})})
        db.commit()
        return True
    except Exception as exc:
        logger.error(
            "save_preference_error",
            extra={"error_type": type(exc).__name__},
        )
        try:
            db.rollback()
        except Exception:
            logger.error("save_preference_rollback_failed")
        return False


# ── Database ──────────────────────────────────────────────────────────────────

def _persist_messages(
    conv_id: str,
    organization_id: str,
    user_id: str,
    merchant_message: str,
    rev_reply: str,
    reply_type: str,
    agents_used: list[str] | None,
    db,
    *,
    title_hint: str | None = None,
    orchestrator_mode: str | None = None,
    confidence_score: float | None = None,
    business_state_id: str | None = None,
    correlation_id: str = "",
) -> None:
    """Persist both turns and the conversation count in one locked transaction."""
    try:
        row = db.execute(
            text("""
                SELECT message_count
                FROM conversations
                WHERE id = :c AND organization_id = :o AND user_id = :u
                FOR UPDATE
            """),
            {"c": conv_id, "o": organization_id, "u": user_id},
        ).fetchone()
        if row is None:
            raise RuntimeError("Conversation ownership could not be verified.")
        base_seq = int(row[0])

        agent_label = ",".join(agents_used) if agents_used else None

        db.execute(text("""
            INSERT INTO conversation_messages
                (id, conversation_id, organization_id, user_id, role, content,
                 sequence_number, agent_name, orchestrator_mode,
                 confidence_score, business_state_id, correlation_id, created_at)
            VALUES
                (:id1, :c, :o, :u, 'user', CAST(:m AS jsonb), :seq1,
                 NULL, :mode, NULL, :state_id, :correlation_id, NOW()),
                (:id2, :c, :o, :u, 'rev', CAST(:r AS jsonb), :seq2,
                 :agent_name, :mode, :confidence, :state_id, :correlation_id, NOW())
        """), {
            "id1":   str(uuid.uuid4()),
            "id2":   str(uuid.uuid4()),
            "c":     conv_id,
            "o":     organization_id,
            "u":     user_id,
            "m":     json.dumps({"text": merchant_message}),
            "r":     json.dumps({"text": rev_reply, "response_type": reply_type}),
            "seq1":  base_seq + 1,
            "seq2":  base_seq + 2,
            "agent_name": agent_label,
            "mode": orchestrator_mode,
            "confidence": confidence_score,
            "state_id": business_state_id,
            "correlation_id": correlation_id or str(uuid.uuid4()),
        })
        title = None
        if title_hint:
            title = title_hint[:80] + ("..." if len(title_hint) > 80 else "")
        db.execute(text("""
            UPDATE conversations
            SET last_activity_at = NOW(),
                message_count = :message_count,
                title = COALESCE(title, :title),
                mode = COALESCE(:mode, mode),
                updated_at = NOW()
            WHERE id = :c AND organization_id = :o AND user_id = :u
        """), {
            "message_count": base_seq + 2,
            "title": title,
            "mode": orchestrator_mode,
            "c": conv_id,
            "o": organization_id,
            "u": user_id,
        })
        db.commit()
    except Exception as exc:
        # Non-fatal: a persistence failure must never break the response
        logger.error(
            "persist_messages_error",
            extra={"error_type": type(exc).__name__},
        )
        try:
            db.rollback()
        except Exception:
            logger.error("persist_messages_rollback_failed")

def _get_or_create_conversation(org_id, user_id, conv_id, db):
    if conv_id:
        row = db.execute(
            text("""
                SELECT id FROM conversations
                WHERE id = :i AND organization_id = :o AND user_id = :u
            """),
            {"i": conv_id, "o": org_id, "u": user_id},
        ).fetchone()
        if row:
            return str(row[0]), False
    new_id = str(uuid.uuid4())
    db.execute(text("""
        INSERT INTO conversations (id, organization_id, user_id, status, message_count, last_activity_at)
        VALUES (:i, :o, :u, 'active', 0, NOW())
    """), {"i": new_id, "o": org_id, "u": user_id})
    db.commit()
    return new_id, True


def _load_memories(org_id, user_id, db) -> list[dict]:
    try:
        rows = db.execute(text("""
            SELECT memory_key, memory_value, memory_source, authority_level,
                   confidence, importance, is_active, memory_type
            FROM merchant_memories
            WHERE organization_id = :o AND is_active = TRUE
              AND (user_id IS NULL OR user_id = :u)
              AND (expires_at IS NULL OR expires_at > NOW())
            ORDER BY authority_level DESC, importance DESC
            LIMIT 100
        """), {"o": org_id, "u": user_id}).fetchall()
        out = []
        for r in rows:
            v = r[1]
            if isinstance(v, str):
                try:
                    v = json.loads(v)
                except Exception:
                    pass
            if isinstance(v, dict) and "value" in v:
                v = v["value"]
            out.append({
                "memory_key": r[0], "memory_value": v, "memory_source": r[2],
                "authority_level": r[3], "confidence": float(r[4]) if r[4] else 1.0,
                "importance": r[5], "is_active": r[6], "memory_type": r[7],
            })
        return out
    except Exception as exc:
        logger.error(
            "load_memories_error",
            extra={"error_type": type(exc).__name__},
        )
        return []


def _load_history(conv_id, db, limit=12) -> list[dict]:
    try:
        rows = db.execute(text("""
            SELECT role, content, created_at, agent_name
            FROM conversation_messages
            WHERE conversation_id = :c
            ORDER BY sequence_number DESC LIMIT :l
        """), {"c": conv_id, "l": limit}).fetchall()
        out = []
        for r in reversed(rows):
            content = r[1]
            if isinstance(content, str):
                try:
                    content = json.loads(content)
                except Exception:
                    pass
            item = {"role": r[0], "content": content,
                    "timestamp": r[2].isoformat() if r[2] else None}
            if r[3]:
                item["agent_name"] = r[3]
            out.append(item)
        return out
    except Exception as exc:
        logger.error(
            "load_history_error",
            extra={"error_type": type(exc).__name__},
        )
        return []
