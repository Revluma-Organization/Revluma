"""
Rev Intelligence Orchestrator — Overhaul v2
=============================================
Core principle: Understand first. Retrieve only what matters.
               Reason from evidence. Act only when appropriate.

Pipeline:
    1.  Validate + sanitise input
    2.  Load/create conversation
    3.  Classify intent (BEFORE any data retrieval)
    4.  If conversational → respond directly, skip agents entirely
    5.  If business/analytics/recommendation → check store connection
    6.  Load BusinessState (if store connected)
    7.  Load memories
    8.  Load conversation history
    9.  Select ONLY relevant agents
    10. Execute selected agents
    11. Apply memory constraints
    12. Synthesise with single LLM call
    13. Sanitise response (remove em dashes, validate)
    14. Persist
    15. Return
"""

from __future__ import annotations

import json
import logging
import re
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import text

from .base_agent import AgentResult
from .revenue_agent import RevenueAgent
from .retention_agent import RetentionAgent
from .customer_agent import CustomerAgent
from .marketing_agent import MarketingAgent
from ..intelligence.business_state import load_current_business_state, build_business_state

logger = logging.getLogger("rev.orchestrator")

MAX_HISTORY_TURNS  = 10
MAX_MESSAGE_CHARS  = 2000
MAX_LLM_RETRIES    = 2

_AGENTS = {
    "revenue":   RevenueAgent(),
    "retention": RetentionAgent(),
    "customer":  CustomerAgent(),
    "marketing": MarketingAgent(),
}

# ── Intent categories ─────────────────────────────────────────────────────────

INTENT_CONVERSATIONAL  = "conversational"
INTENT_BUSINESS        = "business"
INTENT_ANALYTICS       = "analytics"
INTENT_RECOMMENDATION  = "recommendation"
INTENT_ACTION          = "action"
INTENT_CAPABILITY      = "capability"
INTENT_AMBIGUOUS       = "ambiguous"

# Conversational patterns — matched FIRST, no agents run
_CONVERSATIONAL_PATTERNS = [
    r"^(hi|hello|hey|good morning|good afternoon|good evening|morning|afternoon|evening)[\s!.,?]*$",
    r"^(how are you|how r u|how're you|how are things|you good|all good)[\s!.,?]*$",
    r"^(thanks|thank you|thank you so much|cheers|appreciated|great|okay|ok|cool|alright|sounds good|got it|perfect|makes sense)[\s!.,?]*$",
    r"^(who are you|what are you|what is rev|tell me about yourself|what's rev|what is rev intell)[\s!.,?]*$",
    r"^(bye|goodbye|see you|later|cya)[\s!.,?]*$",
    r"^(yes|no|yep|nope|yup|sure)[\s!.,?]*$",
    r"^(lol|haha|nice|wow|interesting|really|seriously)[\s!.,?]*$",
]

# Capability questions
_CAPABILITY_KEYWORDS = [
    "what can you do", "what can you help", "help me with",
    "what do you do", "your capabilities", "can you", "are you able",
    "do you support", "can rev", "what does rev do",
]

# Action request keywords
_ACTION_KEYWORDS = [
    "create campaign", "create a campaign", "start sequence", "send campaign",
    "launch sequence", "create recovery", "start a", "set up a", "enable",
    "change setting", "update setting", "pause sequence", "stop campaign",
]

# Analytics keywords — require data
_ANALYTICS_KEYWORDS = [
    "show me", "what is my", "what are my", "how much", "how many",
    "revenue today", "revenue yesterday", "abandoned cart value",
    "conversion rate", "orders today", "churn count", "give me numbers",
    "stats", "statistics", "metrics", "numbers", "data",
]

# Business question keywords — require reasoning
_BUSINESS_KEYWORDS = [
    "why", "what happened", "what's wrong", "what is wrong", "reason",
    "cause", "problem", "issue", "hurting", "affecting", "impact",
    "fell", "dropped", "declined", "increased", "improved", "changed",
    "should i", "what should", "focus on", "priorit",
]

# Recommendation keywords
_RECOMMENDATION_KEYWORDS = [
    "how can i", "how do i", "what can i do", "ways to", "tips",
    "improve", "increase", "grow", "reduce", "fix", "solve", "help with",
    "suggest", "recommend", "advice", "what would you", "best way",
]

# Domain-specific agent mapping
_DOMAIN_AGENTS = {
    "revenue":    ["revenue"],
    "sales":      ["revenue"],
    "orders":     ["revenue"],
    "conversion": ["revenue"],
    "checkout":   ["revenue", "retention"],
    "cart":       ["retention"],
    "abandon":    ["retention"],
    "recover":    ["retention", "marketing"],
    "churn":      ["retention", "customer"],
    "retention":  ["retention"],
    "repeat":     ["retention", "customer"],
    "customer":   ["customer"],
    "segment":    ["customer"],
    "vip":        ["customer"],
    "campaign":   ["marketing"],
    "email":      ["marketing"],
    "whatsapp":   ["marketing"],
    "sms":        ["marketing"],
    "marketing":  ["marketing"],
    "product":    ["revenue"],
    "inventory":  ["revenue"],
    "ltv":        ["customer", "retention"],
    "lifetime":   ["customer", "retention"],
}


# ── Response types ────────────────────────────────────────────────────────────

@dataclass
class OrchestrationResult:
    success:                    bool
    conversation_id:            str
    message_id:                 str
    response_type:              str   # conversational | analysis | capability | clarification | error
    # For conversational / capability / clarification responses
    text:                       str | None = None
    # For analysis responses (6-part)
    situation:                  str | None = None
    insight:                    str | None = None
    implication:                str | None = None
    recommendation:             str | None = None
    confidence_score:           float | None = None
    confidence_basis:           str | None = None
    actions:                    list[dict] = field(default_factory=list)
    # Metadata
    agents_used:                list[str] = field(default_factory=list)
    business_state_age_minutes: float = 0.0
    business_state_id:          str | None = None
    warnings:                   list[str] = field(default_factory=list)
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
            "warnings":                   self.warnings,
            "correlation_id":             self.correlation_id,
            "latency_ms":                 self.latency_ms,
        }


# ── Intent classifier ─────────────────────────────────────────────────────────

def classify_intent(message: str, history: list[dict]) -> tuple[str, list[str]]:
    """
    Classify the intent of a merchant message.
    Returns (intent_type, relevant_agent_names).

    This runs BEFORE any data retrieval or agent activation.
    No LLM call needed — purely deterministic.
    """
    msg = message.strip().lower()

    # 1. Check conversational patterns first
    for pattern in _CONVERSATIONAL_PATTERNS:
        if re.match(pattern, msg, re.IGNORECASE):
            return INTENT_CONVERSATIONAL, []

    # 2. Capability questions
    if any(kw in msg for kw in _CAPABILITY_KEYWORDS):
        return INTENT_CAPABILITY, []

    # 3. Action requests
    if any(kw in msg for kw in _ACTION_KEYWORDS):
        return INTENT_ACTION, _select_agents_for_message(msg)

    # 4. Determine if business data is needed
    needs_data = (
        any(kw in msg for kw in _ANALYTICS_KEYWORDS) or
        any(kw in msg for kw in _BUSINESS_KEYWORDS) or
        any(kw in msg for kw in _RECOMMENDATION_KEYWORDS) or
        any(domain in msg for domain in _DOMAIN_AGENTS)
    )

    if not needs_data:
        # Very short message with no clear intent — check conversation context
        if len(msg.split()) <= 3 and history:
            # Could be a follow-up — treat as business with context
            return INTENT_BUSINESS, _select_agents_for_message(msg)
        return INTENT_AMBIGUOUS, []

    # 5. Classify business intent type
    if any(kw in msg for kw in _ANALYTICS_KEYWORDS):
        return INTENT_ANALYTICS, _select_agents_for_message(msg)
    if any(kw in msg for kw in _RECOMMENDATION_KEYWORDS):
        return INTENT_RECOMMENDATION, _select_agents_for_message(msg)
    return INTENT_BUSINESS, _select_agents_for_message(msg)


def _select_agents_for_message(msg: str) -> list[str]:
    """Select only the agents relevant to this specific message."""
    agents = []
    for domain, domain_agents in _DOMAIN_AGENTS.items():
        if domain in msg:
            for a in domain_agents:
                if a not in agents:
                    agents.append(a)

    # If no domain match, use revenue + retention as defaults for business questions
    if not agents:
        agents = ["revenue", "retention"]

    return agents[:3]  # hard cap


# ── Main entry ────────────────────────────────────────────────────────────────

def orchestrate(
    organization_id: str,
    user_id: str,
    message: str,
    conversation_id: str | None,
    db,
) -> OrchestrationResult:
    """
    Main entry point. Always returns OrchestrationResult. Never raises.
    """
    correlation_id = str(uuid.uuid4())
    start_time     = time.time()
    warnings: list[str] = []

    logger.info("orchestrate_start", extra={
        "correlation_id": correlation_id,
        "org_id":         organization_id,
        "message_length": len(message),
    })

    try:
        result = _run_pipeline(
            organization_id=organization_id,
            user_id=user_id,
            message=message,
            conversation_id=conversation_id,
            db=db,
            correlation_id=correlation_id,
            warnings=warnings,
        )
    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        print(f"ORCHESTRATE_FATAL ERROR: {type(e).__name__}: {e}")
        print(f"TRACEBACK: {tb}")
        logger.error("orchestrate_fatal", extra={
            "correlation_id": correlation_id,
            "org_id":         organization_id,
            "error":          str(e),
            "traceback":      tb,
        })
        latency_ms = int((time.time() - start_time) * 1000)
        return _failure_result(
            correlation_id=correlation_id,
            conversation_id=conversation_id or str(uuid.uuid4()),
            latency_ms=latency_ms,
        )

    latency_ms = int((time.time() - start_time) * 1000)
    result.latency_ms = latency_ms
    result.warnings.extend(warnings)

    logger.info("orchestrate_complete", extra={
        "correlation_id":  correlation_id,
        "intent":          result.response_type,
        "agents_used":     result.agents_used,
        "latency_ms":      latency_ms,
    })

    return result


def _run_pipeline(
    organization_id: str,
    user_id:         str,
    message:         str,
    conversation_id: str | None,
    db,
    correlation_id:  str,
    warnings:        list[str],
) -> OrchestrationResult:

    # ── Step 1: Sanitise ──────────────────────────────────────────────────────
    message = message.strip()[:MAX_MESSAGE_CHARS]
    if not message:
        raise ValueError("Empty message")

    # ── Step 2: Load/create conversation ──────────────────────────────────────
    conv_id, _ = _get_or_create_conversation(organization_id, user_id, conversation_id, db)

    # ── Step 3: Load conversation history (needed for context + intent) ───────
    history = _load_history(conv_id, db, limit=MAX_HISTORY_TURNS)

    # ── Step 4: Classify intent FIRST — before any data retrieval ────────────
    intent, selected_agents = classify_intent(message, history)

    logger.info("orchestrate_intent_classified", extra={
        "correlation_id": correlation_id,
        "intent":         intent,
        "agents":         selected_agents,
    })

    # ── Step 5: Handle conversational and capability intents directly ─────────
    if intent == INTENT_CONVERSATIONAL:
        text = _handle_conversational(message, history, organization_id, db, correlation_id)
        msg_id = _persist_message(conv_id, organization_id, user_id, "user", {"text": message}, len(history) + 1, db)
        _persist_message(conv_id, organization_id, user_id, "rev",
                        {"response_type": "conversational", "text": text},
                        len(history) + 2, db, correlation_id=correlation_id)
        _update_conversation(conv_id, db, title_hint=message if not conversation_id else None)
        return OrchestrationResult(
            success=True, conversation_id=conv_id, message_id=msg_id,
            response_type="conversational", text=text,
            correlation_id=correlation_id,
        )

    if intent == INTENT_CAPABILITY:
        text = _handle_capability(message)
        msg_id = _persist_message(conv_id, organization_id, user_id, "user", {"text": message}, len(history) + 1, db)
        _persist_message(conv_id, organization_id, user_id, "rev",
                        {"response_type": "capability", "text": text},
                        len(history) + 2, db, correlation_id=correlation_id)
        _update_conversation(conv_id, db, title_hint=message if not conversation_id else None)
        return OrchestrationResult(
            success=True, conversation_id=conv_id, message_id=msg_id,
            response_type="capability", text=text,
            correlation_id=correlation_id,
        )

    if intent == INTENT_AMBIGUOUS:
        text = _handle_ambiguous(message, history)
        msg_id = _persist_message(conv_id, organization_id, user_id, "user", {"text": message}, len(history) + 1, db)
        _persist_message(conv_id, organization_id, user_id, "rev",
                        {"response_type": "clarification", "text": text},
                        len(history) + 2, db, correlation_id=correlation_id)
        _update_conversation(conv_id, db, title_hint=message if not conversation_id else None)
        return OrchestrationResult(
            success=True, conversation_id=conv_id, message_id=msg_id,
            response_type="clarification", text=text,
            correlation_id=correlation_id,
        )

    # ── Step 6: For business/analytics/recommendation — check store + load data
    business_state = load_current_business_state(organization_id, db)
    has_store = business_state is not None and business_state.computation_status != "failed"

    if not has_store:
        # Try to build business state
        try:
            business_state = build_business_state(organization_id, db)
            has_store = business_state.computation_status != "failed"
        except Exception:
            has_store = False
            business_state = None

    # If still no store data and message needs it, say so clearly
    if not has_store and intent in (INTENT_ANALYTICS, INTENT_BUSINESS):
        text = (
            "I need your store connected to answer that. "
            "Once you connect your Shopify or WooCommerce store, "
            "I can pull the real data and give you a specific answer."
        )
        msg_id = _persist_message(conv_id, organization_id, user_id, "user", {"text": message}, len(history) + 1, db)
        _persist_message(conv_id, organization_id, user_id, "rev",
                        {"response_type": "clarification", "text": text},
                        len(history) + 2, db, correlation_id=correlation_id)
        _update_conversation(conv_id, db)
        return OrchestrationResult(
            success=True, conversation_id=conv_id, message_id=msg_id,
            response_type="clarification", text=text,
            correlation_id=correlation_id,
        )

    state_age   = business_state.age_minutes() if business_state else 0.0
    state_id    = business_state.id if business_state else None

    if business_state and business_state.is_stale():
        warnings.append(f"Store data is {state_age:.0f} minutes old.")

    # ── Step 7: Load memories ─────────────────────────────────────────────────
    memories = _load_memories(organization_id, db)

    # ── Step 8: Execute only relevant agents ──────────────────────────────────
    agent_results: list[AgentResult] = []
    for agent_name in selected_agents:
        agent = _AGENTS.get(agent_name)
        if not agent:
            continue
        try:
            result = agent.analyze(business_state, memories, message)
            agent_results.append(result)
            logger.info("agent_complete", extra={
                "correlation_id": correlation_id,
                "agent":          agent_name,
                "status":         result.status,
            })
        except Exception as e:
            logger.error("agent_failed", extra={"agent": agent_name, "error": str(e)})
            warnings.append(f"Agent '{agent_name}' encountered an issue.")

    # ── Step 9: Apply memory constraints ──────────────────────────────────────
    hard_constraints = [m for m in memories if m.get("authority_level", 0) >= 5]
    if hard_constraints:
        agent_results = _apply_constraints(agent_results, hard_constraints)

    # ── Step 10: Synthesise with single LLM call ──────────────────────────────
    response = _synthesise(
        message=message,
        intent=intent,
        business_state=business_state,
        agent_results=agent_results,
        memories=memories,
        history=history,
        has_store=has_store,
        correlation_id=correlation_id,
        warnings=warnings,
    )

    # ── Step 11: Persist ──────────────────────────────────────────────────────
    msg_id = _persist_message(
        conv_id, organization_id, user_id, "user",
        {"text": message}, len(history) + 1, db
    )
    rev_content = {**response, "response_type": "analysis"}
    rev_content["business_state_id"] = state_id
    _persist_message(
        conv_id, organization_id, user_id, "rev",
        rev_content, len(history) + 2, db,
        correlation_id=correlation_id,
        agent_name=",".join(selected_agents),
        business_state_id=state_id,
        confidence_score=response.get("confidence", {}).get("score"),
    )
    _update_conversation(conv_id, db, title_hint=message if not conversation_id else None)

    return OrchestrationResult(
        success=True,
        conversation_id=conv_id,
        message_id=msg_id,
        response_type="analysis",
        situation=response.get("situation"),
        insight=response.get("insight"),
        implication=response.get("implication"),
        recommendation=response.get("recommendation"),
        confidence_score=response.get("confidence", {}).get("score", 0.7),
        confidence_basis=response.get("confidence", {}).get("basis", ""),
        actions=response.get("actions", []),
        agents_used=selected_agents,
        business_state_age_minutes=state_age,
        business_state_id=state_id,
        warnings=warnings,
        correlation_id=correlation_id,
    )


# ── Conversational handlers ───────────────────────────────────────────────────

def _handle_conversational(message: str, history: list[dict], org_id: str, db, correlation_id: str) -> str:
    """
    Handle greetings and small talk via a single focused LLM call.
    No business data, no agents. Short, natural response.
    """
    import anthropic, os

    msg_lower = message.lower().strip()

    # Handle the simplest cases without LLM
    if re.match(r"^(hi|hello|hey)[\s!.,?]*$", msg_lower, re.IGNORECASE):
        return "Hey. What are we looking at today?"
    if re.match(r"^(thanks|thank you|cheers)[\s!.,?]*$", msg_lower, re.IGNORECASE):
        return "Of course. What else do you need?"
    if re.match(r"^(good morning|morning)[\s!.,?]*$", msg_lower, re.IGNORECASE):
        return "Morning. Ready when you are. What do you want to look at?"
    if re.match(r"^(good afternoon|afternoon)[\s!.,?]*$", msg_lower, re.IGNORECASE):
        return "Afternoon. What are we working on?"
    if re.match(r"^(how are you|how are things|you good)[\s!.,?]*$", msg_lower, re.IGNORECASE):
        return "I'm operational. More importantly, how's your store doing? Ask me anything."
    if re.match(r"^(okay|ok|alright|got it|makes sense|sounds good|perfect|great)[\s!.,?]*$", msg_lower, re.IGNORECASE):
        return "Good. Anything else you want to look at?"
    if re.match(r"^(bye|goodbye|later|see you)[\s!.,?]*$", msg_lower, re.IGNORECASE):
        return "Talk soon."

    # For anything else conversational, use a minimal LLM call
    try:
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            return "Hey. What are we looking at today?"
        client = anthropic.Anthropic(api_key=api_key, timeout=8.0)
        recent = history[-2:] if history else []
        resp = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=150,
            messages=[{
                "role": "user",
                "content": (
                    f"You are Rev, an ecommerce intelligence assistant. "
                    f"The merchant said: '{message}'. "
                    f"Respond naturally in 1-2 short sentences. "
                    f"Do not use em dashes. Do not mention business data. "
                    f"Sound like a capable operator, not a chatbot."
                )
            }]
        )
        text = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")
        return _sanitise_text(text.strip())
    except Exception:
        return "Hey. What are we looking at today?"


def _handle_capability(message: str) -> str:
    return (
        "I can help you understand revenue trends, find out why sales dropped, "
        "identify carts worth recovering, spot customers about to churn, "
        "analyse campaign performance, and tell you what to focus on next. "
        "I work best when your store is connected. What do you want to look at?"
    )


def _handle_ambiguous(message: str, history: list[dict]) -> str:
    # If there's conversation context, ask what area they mean
    if history:
        return "Which area do you want to look at? Revenue, carts, customers, or something else?"
    return "What do you want to check on? I can help with revenue, carts, customers, campaigns, or retention."


# ── LLM synthesis ─────────────────────────────────────────────────────────────

def _synthesise(
    message: str,
    intent: str,
    business_state,
    agent_results: list[AgentResult],
    memories: list[dict],
    history: list[dict],
    has_store: bool,
    correlation_id: str,
    warnings: list[str],
) -> dict:
    import anthropic, os

    prompt = _build_prompt(
        message=message,
        intent=intent,
        business_state=business_state,
        agent_results=agent_results,
        memories=memories,
        history=history,
        has_store=has_store,
    )

    for attempt in range(MAX_LLM_RETRIES):
        try:
            api_key = os.environ.get("ANTHROPIC_API_KEY")
            if not api_key:
                raise RuntimeError("ANTHROPIC_API_KEY not set")

            client = anthropic.Anthropic(api_key=api_key, timeout=9.0)
            t0 = time.time()
            response = client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=600,
                messages=[{"role": "user", "content": prompt}],
            )
            raw = "".join(b.text for b in response.content if getattr(b, "type", "") == "text")
            logger.info("llm_complete", extra={
                "correlation_id": correlation_id,
                "duration_ms": int((time.time() - t0) * 1000),
                "input_tokens": getattr(getattr(response, "usage", None), "input_tokens", 0),
                "output_tokens": getattr(getattr(response, "usage", None), "output_tokens", 0),
            })

            parsed = _parse_and_validate(raw)
            if parsed:
                # Sanitise em dashes from all text fields
                for field in ("situation", "insight", "implication", "recommendation"):
                    if isinstance(parsed.get(field), str):
                        parsed[field] = _sanitise_text(parsed[field])
                return parsed

            logger.warning("llm_invalid_output", extra={"correlation_id": correlation_id, "attempt": attempt + 1})

        except Exception as e:
            logger.error("llm_failed", extra={"correlation_id": correlation_id, "attempt": attempt + 1, "error": str(e)})
            if attempt == MAX_LLM_RETRIES - 1:
                warnings.append("Analysis temporarily unavailable.")
                return _fallback_analysis(agent_results)

    warnings.append("Analysis temporarily unavailable.")
    return _fallback_analysis(agent_results)


def _build_prompt(
    message: str,
    intent: str,
    business_state,
    agent_results: list[AgentResult],
    memories: list[dict],
    history: list[dict],
    has_store: bool,
) -> str:
    # Business state — only relevant fields, no raw records
    state_summary: dict = {}
    if business_state and has_store:
        d = business_state.to_dict()
        state_summary = {k: d[k] for k in [
            "computation_status", "revenue_today", "revenue_yesterday",
            "revenue_delta_pct", "revenue_trend_7d", "revenue_anomaly",
            "abandoned_cart_count", "abandoned_cart_value", "cart_anomaly",
            "churn_risk_count", "vip_inactive_count", "returning_customer_rate",
            "opportunities", "risks",
        ] if d.get(k) is not None}

    # Hard constraints
    constraints = [
        {"key": m["memory_key"], "value": m["memory_value"]}
        for m in memories
        if m.get("authority_level", 0) >= 4 and m.get("is_active")
    ]

    # Agent findings
    agent_data = [r.to_dict() for r in agent_results if r.status != "error"]

    # Recent history (last 4 turns)
    recent = history[-4:] if history else []

    store_status = "CONNECTED with data" if has_store and state_summary else "NOT CONNECTED or no data available"

    return f"""You are Rev, an ecommerce intelligence operator built into Revluma.

IDENTITY: You are not a generic AI assistant. You are specifically an ecommerce intelligence operator. You understand how online stores work, how revenue is generated and lost, and what merchants actually need to hear.

ABSOLUTE RULES:
1. NEVER invent revenue figures, order counts, customer counts, or any business metric. Every number must come from the STORE DATA block.
2. NEVER use em dashes (the character —). Use commas, colons, or periods instead.
3. NEVER use filler phrases: "I'd be happy to", "Great question", "Based on the information provided", "In today's competitive landscape", "Let's dive into", "It's important to note".
4. If store data is unavailable for a specific question, say clearly what you need and why. Never fabricate.
5. Be direct and specific. The merchant should understand your answer in seconds.
6. Respect all MERCHANT CONSTRAINTS. They are hard rules.

STORE STATUS: {store_status}

STORE DATA (do not invent values not present here):
{json.dumps(state_summary, default=str) if state_summary else "No store data available."}

MERCHANT CONSTRAINTS (hard rules, must not be violated):
{json.dumps(constraints, default=str) if constraints else "None set."}

AGENT FINDINGS (structured analysis, read-only):
{json.dumps(agent_data, default=str) if agent_data else "No agent findings available."}

CONVERSATION CONTEXT (recent turns):
{json.dumps(recent, default=str) if recent else "First message in conversation."}

MERCHANT MESSAGE (intent: {intent}):
"{message[:500]}"

RESPONSE INSTRUCTION:
Return a single valid JSON object. No markdown. No explanation outside the JSON.

For this {intent} question, produce:
{{
  "situation": "1-2 sentences stating what is actually happening, with specific numbers if available. If no data, say what you cannot see.",
  "insight": "1-2 sentences explaining why, based only on available data.",
  "implication": "1 sentence: what this means for the business.",
  "recommendation": "1-2 sentences: the single most important action. Be specific.",
  "confidence": {{
    "score": 0.0,
    "basis": "Brief explanation. High = backed by direct data. Medium = inferred from signals. Low = limited data."
  }},
  "actions": [
    {{"label": "Short action label", "tool": null, "params": {{}}}}
  ]
}}

Keep all fields short and direct. No padding. No generic advice."""


def _sanitise_text(text: str) -> str:
    """Remove em dashes and other prohibited characters."""
    text = text.replace("\u2014", ",")  # em dash → comma
    text = text.replace("\u2013", ",")  # en dash → comma
    text = re.sub(r'\s*,\s*,', ',', text)  # clean double commas
    return text.strip()


def _parse_and_validate(raw: str) -> dict | None:
    try:
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            cleaned = re.sub(r"^```(json)?", "", cleaned).strip()
            cleaned = re.sub(r"```$", "", cleaned).strip()

        data = json.loads(cleaned)
        required = {"situation", "insight", "implication", "recommendation", "confidence", "actions"}
        if not isinstance(data, dict) or not required.issubset(data.keys()):
            return None

        conf = data.get("confidence", {})
        if not isinstance(conf, dict):
            return None

        score = conf.get("score", 0.7)
        if not isinstance(score, (int, float)):
            data["confidence"]["score"] = 0.7

        if not isinstance(data.get("actions"), list):
            data["actions"] = []

        # Truncate overlong fields
        for f in ("situation", "insight", "implication", "recommendation"):
            if isinstance(data.get(f), str) and len(data[f]) > 600:
                data[f] = data[f][:600]

        return data
    except Exception:
        return None


def _fallback_analysis(agent_results: list[AgentResult]) -> dict:
    """Minimal honest fallback — never fabricates business data."""
    return {
        "situation": "Analysis is temporarily unavailable.",
        "insight": "The intelligence system encountered an issue processing your request.",
        "implication": "No data has been lost.",
        "recommendation": "Try again in a moment.",
        "confidence": {"score": 0.0, "basis": "System unavailable"},
        "actions": [],
    }


def _apply_constraints(results: list[AgentResult], constraints: list[dict]) -> list[AgentResult]:
    max_discount = None
    never_discount = False
    for c in constraints:
        key = c.get("memory_key")
        val = c.get("memory_value")
        if isinstance(val, dict):
            val = val.get("value")
        if key == "max_discount_pct" and val is not None:
            max_discount = float(val)
        if key == "never_recommend_discounts" and val:
            never_discount = True
    for result in results:
        for rec in result.recommendations:
            params = rec.get("params", {})
            if never_discount:
                params["max_discount_pct"] = 0
                params["use_discount"] = False
            elif max_discount is not None and params.get("max_discount_pct", 0) > max_discount:
                params["max_discount_pct"] = max_discount
    return results


# ── Database helpers ──────────────────────────────────────────────────────────

def _get_or_create_conversation(org_id: str, user_id: str, conv_id: str | None, db) -> tuple[str, bool]:
    if conv_id:
        row = db.execute(
            text("SELECT id FROM conversations WHERE id = :id AND organization_id = :org_id"),
            {"id": conv_id, "org_id": org_id},
        ).fetchone()
        if row:
            return str(row[0]), False
    new_id = str(uuid.uuid4())
    db.execute(
        text("""
            INSERT INTO conversations (id, organization_id, user_id, status, message_count, last_activity_at)
            VALUES (:id, :org_id, :user_id, 'active', 0, NOW())
        """),
        {"id": new_id, "org_id": org_id, "user_id": user_id},
    )
    db.commit()
    return new_id, True


def _update_conversation(conv_id: str, db, title_hint: str | None = None) -> None:
    try:
        if title_hint:
            title = title_hint[:80] + ("..." if len(title_hint) > 80 else "")
            db.execute(text("""
                UPDATE conversations SET last_activity_at = NOW(),
                message_count = message_count + 2,
                title = COALESCE(title, :title), updated_at = NOW()
                WHERE id = :id
            """), {"id": conv_id, "title": title})
        else:
            db.execute(text("""
                UPDATE conversations SET last_activity_at = NOW(),
                message_count = message_count + 2, updated_at = NOW()
                WHERE id = :id
            """), {"id": conv_id})
        db.commit()
    except Exception as e:
        logger.error("update_conversation_failed", extra={"error": str(e)})


def _load_memories(org_id: str, db) -> list[dict]:
    try:
        rows = db.execute(text("""
            SELECT memory_key, memory_value, memory_source, authority_level,
                   confidence, importance, is_active, memory_type
            FROM merchant_memories
            WHERE organization_id = :org_id AND is_active = TRUE
              AND (expires_at IS NULL OR expires_at > NOW())
            ORDER BY authority_level DESC, importance DESC
        """), {"org_id": org_id}).fetchall()

        memories = []
        for r in rows:
            val = r[1]
            if isinstance(val, str):
                try:
                    val = json.loads(val)
                except Exception:
                    pass
            memories.append({
                "memory_key": r[0], "memory_value": val,
                "memory_source": r[2], "authority_level": r[3],
                "confidence": float(r[4]) if r[4] else 1.0,
                "importance": r[5], "is_active": r[6], "memory_type": r[7],
            })
        return memories
    except Exception as e:
        logger.error("load_memories_failed", extra={"error": str(e)})
        return []


def _load_history(conv_id: str, db, limit: int = 10) -> list[dict]:
    try:
        rows = db.execute(text("""
            SELECT role, content, created_at FROM conversation_messages
            WHERE conversation_id = :conv_id
            ORDER BY sequence_number DESC LIMIT :limit
        """), {"conv_id": conv_id, "limit": limit}).fetchall()

        history = []
        for r in reversed(rows):
            content = r[1]
            if isinstance(content, str):
                try:
                    content = json.loads(content)
                except Exception:
                    pass
            history.append({
                "role": r[0],
                "content": content,
                "timestamp": r[2].isoformat() if r[2] else None,
            })
        return history
    except Exception as e:
        logger.error("load_history_failed", extra={"error": str(e)})
        return []


def _persist_message(
    conv_id: str, org_id: str, user_id: str, role: str,
    content: dict, seq: int, db,
    correlation_id: str | None = None,
    agent_name: str | None = None,
    business_state_id: str | None = None,
    confidence_score: float | None = None,
) -> str:
    msg_id = str(uuid.uuid4())
    try:
        db.execute(text("""
            INSERT INTO conversation_messages (
                id, conversation_id, organization_id, user_id,
                role, content, sequence_number,
                agent_name, model_name, model_provider,
                business_state_id, correlation_id, confidence_score, has_error
            ) VALUES (
                :id, :conv_id, :org_id, :user_id,
                :role, :content, :seq,
                :agent_name, :model_name, :model_provider,
                :bstate_id, :correlation_id, :confidence_score, FALSE
            )
        """), {
            "id": msg_id, "conv_id": conv_id, "org_id": org_id, "user_id": user_id,
            "role": role, "content": json.dumps(content), "seq": seq,
            "agent_name": agent_name,
            "model_name": "claude-sonnet-4-6" if role == "rev" else None,
            "model_provider": "anthropic" if role == "rev" else None,
            "bstate_id": business_state_id,
            "correlation_id": correlation_id or str(uuid.uuid4()),
            "confidence_score": confidence_score,
        })
        db.commit()
    except Exception as e:
        logger.error("persist_message_failed", extra={"error": str(e)})
        try:
            db.rollback()
        except Exception:
            pass
    return msg_id


def _failure_result(correlation_id: str, conversation_id: str, latency_ms: int) -> OrchestrationResult:
    return OrchestrationResult(
        success=False,
        conversation_id=conversation_id,
        message_id=str(uuid.uuid4()),
        response_type="error",
        text="Something went wrong on our end. Please try again in a moment.",
        correlation_id=correlation_id,
        latency_ms=latency_ms,
    )