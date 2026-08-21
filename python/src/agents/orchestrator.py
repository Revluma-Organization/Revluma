"""
Rev Intelligence Orchestrator v3
==================================
Core principle: Understand first. Retrieve only what matters.
               Reason from evidence. Act only when appropriate.

The fundamental change from v2:
- Intent classification uses the LLM (fast, cheap, 1-2 word output)
  instead of brittle regex. This handles all natural language variations.
- Conversation history is the primary context for follow-up questions.
- "How are you doing?" is conversational. Always. No analytics.
- "Why?" in context of a revenue discussion = business question about revenue.
- Ambiguous messages get a natural clarifying question, not an analytics menu.
- No web search yet (placeholder for Phase 5). Clearly stated when needed.
- Response format adapts to intent. No 6-part card for greetings.
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

MAX_HISTORY_TURNS = 12
MAX_MESSAGE_CHARS = 2000
MAX_LLM_RETRIES   = 2

_AGENTS = {
    "revenue":   RevenueAgent(),
    "retention": RetentionAgent(),
    "customer":  CustomerAgent(),
    "marketing": MarketingAgent(),
}

# ── Intent types ──────────────────────────────────────────────────────────────

INTENTS = {
    "chat":           "Natural conversation. No analytics needed.",
    "business":       "Business question requiring store data and reasoning.",
    "analytics":      "Request for specific metrics or data.",
    "recommendation": "Asking what to do or how to improve something.",
    "action":         "Asking Rev to execute something.",
    "capability":     "Asking what Rev can do.",
    "knowledge":      "General ecommerce knowledge question, no store data needed.",
    "followup":       "Follow-up on a previous message in this conversation.",
}

# Domain to agent mapping
_DOMAIN_AGENTS = {
    "revenue":    ["revenue"],
    "sales":      ["revenue"],
    "orders":     ["revenue"],
    "aov":        ["revenue"],
    "conversion": ["revenue"],
    "checkout":   ["revenue", "retention"],
    "traffic":    ["revenue"],
    "cart":       ["retention"],
    "abandon":    ["retention"],
    "recover":    ["retention", "marketing"],
    "churn":      ["retention", "customer"],
    "retention":  ["retention"],
    "repeat":     ["retention", "customer"],
    "ltv":        ["customer", "retention"],
    "lifetime":   ["customer", "retention"],
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
    "refund":     ["revenue"],
    "discount":   ["marketing", "retention"],
    "acquisition":["marketing"],
    "cac":        ["marketing"],
    "roas":       ["marketing"],
}


# ── Response dataclass ────────────────────────────────────────────────────────

@dataclass
class OrchestrationResult:
    success:                    bool
    conversation_id:            str
    message_id:                 str
    response_type:              str  # chat | analysis | capability | clarification | knowledge | error
    text:                       str | None = None
    # For analysis
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


# ── Main entry ────────────────────────────────────────────────────────────────

def orchestrate(
    organization_id: str,
    user_id:         str,
    message:         str,
    conversation_id: str | None,
    db,
) -> OrchestrationResult:
    correlation_id = str(uuid.uuid4())
    start_time     = time.time()

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
        })
        latency_ms = int((time.time() - start_time) * 1000)
        return _failure_result(
            correlation_id=correlation_id,
            conversation_id=conversation_id or str(uuid.uuid4()),
            latency_ms=latency_ms,
        )

    result.latency_ms = int((time.time() - start_time) * 1000)

    logger.info("orchestrate_complete", extra={
        "correlation_id": correlation_id,
        "response_type":  result.response_type,
        "agents_used":    result.agents_used,
        "latency_ms":     result.latency_ms,
    })

    return result


def _run_pipeline(
    organization_id: str,
    user_id:         str,
    message:         str,
    conversation_id: str | None,
    db,
    correlation_id:  str,
) -> OrchestrationResult:

    # ── Step 1: Sanitise ──────────────────────────────────────────────────────
    message = message.strip()[:MAX_MESSAGE_CHARS]
    if not message:
        raise ValueError("Empty message")

    # ── Step 2: Load/create conversation ──────────────────────────────────────
    conv_id, is_new = _get_or_create_conversation(organization_id, user_id, conversation_id, db)

    # ── Step 3: Load conversation history ─────────────────────────────────────
    history = _load_history(conv_id, db, limit=MAX_HISTORY_TURNS)

    # ── Step 4: Load memories (needed for intent + constraints) ───────────────
    memories = _load_memories(organization_id, db)

    # ── Step 5: Classify intent with LLM (fast, cheap, accurate) ─────────────
    intent, reasoning = _classify_intent_with_llm(message, history)

    logger.info("intent_classified", extra={
        "correlation_id": correlation_id,
        "intent":         intent,
        "reasoning":      reasoning,
    })

    # ── Step 6: Route by intent ───────────────────────────────────────────────

    # Chat: greetings, small talk, follow-ups that are purely conversational
    if intent == "chat":
        text = _generate_chat_response(message, history, memories)
        text = _sanitise(text)
        msg_id = _save_turn(conv_id, organization_id, user_id, message, text,
                            "chat", len(history), db, correlation_id)
        _update_conversation(conv_id, db, title_hint=message if is_new else None)
        return OrchestrationResult(
            success=True, conversation_id=conv_id, message_id=msg_id,
            response_type="chat", text=text, correlation_id=correlation_id,
        )

    # Capability: what can Rev do
    if intent == "capability":
        text = _capability_response()
        msg_id = _save_turn(conv_id, organization_id, user_id, message, text,
                            "capability", len(history), db, correlation_id)
        _update_conversation(conv_id, db, title_hint=message if is_new else None)
        return OrchestrationResult(
            success=True, conversation_id=conv_id, message_id=msg_id,
            response_type="capability", text=text, correlation_id=correlation_id,
        )

    # General ecommerce knowledge (no store data needed)
    if intent == "knowledge":
        text = _generate_knowledge_response(message, history)
        text = _sanitise(text)
        msg_id = _save_turn(conv_id, organization_id, user_id, message, text,
                            "knowledge", len(history), db, correlation_id)
        _update_conversation(conv_id, db, title_hint=message if is_new else None)
        return OrchestrationResult(
            success=True, conversation_id=conv_id, message_id=msg_id,
            response_type="knowledge", text=text, correlation_id=correlation_id,
        )

    # ── Step 7: Business/analytics/recommendation/action/followup need store ──
    business_state = load_current_business_state(organization_id, db)
    has_store = (business_state is not None and
                 business_state.computation_status != "failed" and
                 business_state.revenue_today is not None)

    if not has_store:
        # Try to build
        try:
            business_state = build_business_state(organization_id, db)
            has_store = (business_state is not None and
                         business_state.computation_status != "failed" and
                         business_state.revenue_today is not None)
        except Exception:
            has_store = False

    # If still no store data
    if not has_store:
        text = _no_store_response(message, intent)
        msg_id = _save_turn(conv_id, organization_id, user_id, message, text,
                            "clarification", len(history), db, correlation_id)
        _update_conversation(conv_id, db, title_hint=message if is_new else None)
        return OrchestrationResult(
            success=True, conversation_id=conv_id, message_id=msg_id,
            response_type="clarification", text=text, correlation_id=correlation_id,
        )

    state_age = business_state.age_minutes() if business_state else 0.0
    state_id  = business_state.id if business_state else None

    # ── Step 8: Select only relevant agents ───────────────────────────────────
    selected_agents = _select_agents(message, intent, history)

    logger.info("agents_selected", extra={
        "correlation_id": correlation_id,
        "agents":         selected_agents,
    })

    # ── Step 9: Execute agents ────────────────────────────────────────────────
    agent_results: list[AgentResult] = []
    for name in selected_agents:
        agent = _AGENTS.get(name)
        if not agent:
            continue
        try:
            result = agent.analyze(business_state, memories, message)
            agent_results.append(result)
        except Exception as e:
            logger.error("agent_error", extra={"agent": name, "error": str(e)})

    # ── Step 10: Apply hard memory constraints ────────────────────────────────
    hard_constraints = [m for m in memories if m.get("authority_level", 0) >= 5]
    if hard_constraints:
        agent_results = _apply_constraints(agent_results, hard_constraints)

    # ── Step 11: Synthesise ───────────────────────────────────────────────────
    warnings: list[str] = []
    if business_state and business_state.is_stale():
        warnings.append(f"Store data is {state_age:.0f} minutes old.")

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

    # ── Step 12: Persist ──────────────────────────────────────────────────────
    rev_content = {**response, "response_type": "analysis", "business_state_id": state_id}
    msg_id = _save_turn(
        conv_id, organization_id, user_id, message, rev_content,
        "analysis", len(history), db, correlation_id,
        agent_name=",".join(selected_agents),
        business_state_id=state_id,
        confidence_score=response.get("confidence", {}).get("score"),
    )
    _update_conversation(conv_id, db, title_hint=message if is_new else None)

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


# ── Intent classification — LLM-based ────────────────────────────────────────

def _classify_intent_with_llm(message: str, history: list[dict]) -> tuple[str, str]:
    """
    Use the LLM to classify intent. One fast call, ~20 tokens output.
    Far more accurate than regex for natural language variations.
    Falls back to 'business' if LLM unavailable.
    """
    import anthropic, os

    # Build minimal history context (last 3 turns)
    history_text = ""
    if history:
        recent = history[-3:]
        for h in recent:
            role = h.get("role", "")
            content = h.get("content", {})
            text = ""
            if isinstance(content, dict):
                text = content.get("text", "") or content.get("situation", "")
            elif isinstance(content, str):
                text = content
            if text:
                history_text += f"{role}: {str(text)[:100]}\n"

    prompt = f"""You are classifying the intent of a merchant message to an ecommerce AI assistant.

Previous conversation:
{history_text if history_text else "(new conversation)"}

Current message: "{message}"

Classify the intent as EXACTLY ONE of these:
- chat: greeting, thanks, acknowledgement, casual conversation, "how are you", "okay", "sounds good", emotional response, any social/conversational message
- business: question about why something happened, what is wrong, business performance analysis, requires store data
- analytics: request for specific numbers, metrics, data from the store
- recommendation: asking what to do, how to improve, what should I focus on
- action: asking Rev to create/send/launch something
- capability: asking what Rev can do or help with
- knowledge: general ecommerce knowledge question that doesn't require their specific store data
- followup: short follow-up that refers to the previous message (like "why?", "tell me more", "how?", "what about X?" when X was just discussed)

Rules:
- "How are you doing?" = chat
- "Okay" = chat
- "Thanks" = chat
- "What's AOV?" = knowledge
- "Why?" after a business question = followup
- "Why is revenue down?" = business
- "Show me my revenue" = analytics
- "How can I improve conversion?" = recommendation

Respond with ONLY the intent word and a brief reason. Format:
INTENT: [word]
REASON: [one short sentence]"""

    try:
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            return _fallback_classify(message, history), "no api key"

        client = anthropic.Anthropic(api_key=api_key, timeout=5.0)
        resp = client.messages.create(
            model="claude-haiku-4-5-20251001",  # Fast cheap model for classification
            max_tokens=60,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text").strip()

        # Parse "INTENT: xxx\nREASON: yyy"
        intent_match = re.search(r"INTENT:\s*(\w+)", raw, re.IGNORECASE)
        reason_match = re.search(r"REASON:\s*(.+)", raw, re.IGNORECASE)

        if intent_match:
            intent = intent_match.group(1).lower().strip()
            reason = reason_match.group(1).strip() if reason_match else ""
            if intent in INTENTS:
                return intent, reason

        # If parsing failed, use fallback
        return _fallback_classify(message, history), "parse failed"

    except Exception as e:
        logger.warning("intent_classify_failed", extra={"error": str(e)})
        return _fallback_classify(message, history), f"error: {str(e)}"


def _fallback_classify(message: str, history: list[dict]) -> str:
    """Deterministic fallback if LLM classification fails."""
    msg = message.lower().strip()

    # Very short follow-up words
    if len(msg.split()) <= 3 and history:
        followup_words = ["why", "how", "what", "when", "tell me more", "explain",
                         "which", "who", "where", "really", "and", "but"]
        if any(msg.startswith(w) for w in followup_words):
            return "followup"

    # Clear conversational
    conv_patterns = ["hi", "hello", "hey", "thanks", "thank you", "okay", "ok",
                     "bye", "good morning", "how are you", "cheers", "great",
                     "cool", "alright", "got it", "makes sense", "sounds good"]
    if any(msg.startswith(p) or msg == p for p in conv_patterns):
        return "chat"

    # Knowledge
    knowledge = ["what is", "what's", "define", "explain", "aov", "ltv", "cac",
                 "what does", "how does", "what are", "best practice"]
    if any(kw in msg for kw in knowledge) and not any(
        store_kw in msg for store_kw in ["my ", "our ", "store"]
    ):
        return "knowledge"

    # Business keywords
    business = ["why", "what happened", "dropped", "fell", "increase", "decreased",
                "what's wrong", "issue", "problem", "going on"]
    if any(kw in msg for kw in business):
        return "business"

    return "business"  # safe default


# ── Agent selection ───────────────────────────────────────────────────────────

def _select_agents(message: str, intent: str, history: list[dict]) -> list[str]:
    """
    Select only the agents relevant to this message.
    For follow-up questions, use the same agents as the previous turn.
    """
    if intent == "followup" and history:
        # Find most recent rev message and reuse its agents
        for h in reversed(history):
            if h.get("role") == "rev":
                content = h.get("content", {})
                if isinstance(content, dict):
                    agent_str = content.get("agent_name", "")
                    if agent_str:
                        return [a.strip() for a in agent_str.split(",") if a.strip()]
        # Fall through to message-based selection

    msg = message.lower()
    agents = []

    for domain, domain_agents in _DOMAIN_AGENTS.items():
        if domain in msg:
            for a in domain_agents:
                if a not in agents:
                    agents.append(a)

    if not agents:
        # Default: revenue + retention are most commonly relevant
        agents = ["revenue", "retention"]

    return agents[:3]


# ── Response generators ───────────────────────────────────────────────────────

def _generate_chat_response(message: str, history: list[dict], memories: list[dict]) -> str:
    """
    Generate a natural conversational response.
    Handles most cases without LLM using simple rules.
    Uses LLM only for complex conversational messages.
    """
    import anthropic, os

    msg = message.lower().strip()

    # Handle common cases instantly (no LLM, no latency)
    instant = {
        "hi": "Hey.",
        "hello": "Hello.",
        "hey": "Hey.",
        "good morning": "Morning.",
        "morning": "Morning.",
        "good afternoon": "Afternoon.",
        "good evening": "Good evening.",
        "how are you": "I'm good. What are you working on?",
        "how are you doing": "I'm good. What do you want to look at?",
        "how are you?": "Good. What are you working on?",
        "how r u": "Good. What do you want to look at?",
        "you good": "Yes. What's on your mind?",
        "thanks": "Of course.",
        "thank you": "Of course.",
        "cheers": "Of course.",
        "okay": "Got it.",
        "ok": "Got it.",
        "alright": "Got it.",
        "got it": "Good.",
        "makes sense": "Good.",
        "sounds good": "Good.",
        "great": "Good.",
        "perfect": "Good.",
        "cool": "Good.",
        "interesting": "What do you want to dig into?",
        "nice": "Good.",
        "wow": "What are you thinking?",
        "yes": "Good.",
        "no": "Okay. What would you like instead?",
        "yep": "Good.",
        "nope": "Okay.",
        "lol": "What's up?",
        "haha": "What are you working on?",
        "bye": "Talk soon.",
        "goodbye": "Talk soon.",
        "see you": "Talk soon.",
        "later": "Talk soon.",
    }

    # Check exact matches
    if msg in instant:
        return instant[msg]
    # Check without punctuation
    clean = re.sub(r"[!.,?]+$", "", msg).strip()
    if clean in instant:
        return instant[clean]

    # For anything else conversational, use LLM with very tight constraints
    try:
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            return "What would you like to look at?"

        # Build recent context
        recent_context = ""
        if history:
            for h in history[-2:]:
                role = h.get("role", "")
                content = h.get("content", {})
                text = ""
                if isinstance(content, dict):
                    text = content.get("text", "") or content.get("situation", "")
                elif isinstance(content, str):
                    text = content
                if text:
                    recent_context += f"{role}: {str(text)[:80]}\n"

        client = anthropic.Anthropic(api_key=api_key, timeout=6.0)
        resp = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=80,
            messages=[{
                "role": "user",
                "content": (
                    f"You are Rev, an ecommerce intelligence assistant for Revluma.\n"
                    f"Recent context:\n{recent_context}\n"
                    f"The merchant said: \"{message}\"\n"
                    f"Reply naturally in 1-10 words. Direct. No em dashes. "
                    f"No corporate language. Sound like a sharp operator."
                )
            }]
        )
        text = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text").strip()
        return text or "What are you working on?"

    except Exception:
        return "What are you working on?"


def _capability_response() -> str:
    return (
        "I can help you understand why revenue changed, find out where customers are dropping off, "
        "identify carts worth recovering, spot customers about to churn, analyze campaign performance, "
        "and tell you what to focus on. I work from your actual store data when it's connected. "
        "What do you want to look at?"
    )


def _generate_knowledge_response(message: str, history: list[dict]) -> str:
    """General ecommerce knowledge question, no store data needed."""
    import anthropic, os

    try:
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            return "I don't have an answer for that right now."

        client = anthropic.Anthropic(api_key=api_key, timeout=8.0)
        resp = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=200,
            messages=[{
                "role": "user",
                "content": (
                    f"You are Rev, an ecommerce intelligence assistant. "
                    f"Answer this ecommerce knowledge question concisely and accurately. "
                    f"No em dashes. No corporate language. Direct and specific.\n\n"
                    f"Question: {message}"
                )
            }]
        )
        text = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text").strip()
        return text or "I don't have a clear answer for that right now."

    except Exception:
        return "I can't look that up right now. Try asking again in a moment."


def _no_store_response(message: str, intent: str) -> str:
    """Clear, honest response when no store is connected."""
    msg = message.lower()

    if any(kw in msg for kw in ["abandon", "cart"]):
        return (
            "I can help with that, but I need your store connected to see your actual cart data. "
            "Connect Shopify or WooCommerce and I can analyze exactly where and why carts are dropping off."
        )
    if any(kw in msg for kw in ["revenue", "sales", "money", "orders"]):
        return (
            "I need your store connected to pull revenue data. "
            "Once you connect, I can show you what's actually happening with your numbers."
        )
    if any(kw in msg for kw in ["customer", "churn", "retention", "repeat"]):
        return (
            "To analyze customer behavior, I need your store data connected. "
            "Connect your store and I can tell you exactly what your customers are doing."
        )
    return (
        "To answer that specifically, I need your store connected. "
        "Once you link Shopify or WooCommerce, I can work from your actual data."
    )


# ── Main LLM synthesis ────────────────────────────────────────────────────────

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

    prompt = _build_analysis_prompt(
        message=message,
        intent=intent,
        business_state=business_state,
        agent_results=agent_results,
        memories=memories,
        history=history,
    )

    for attempt in range(MAX_LLM_RETRIES):
        try:
            api_key = os.environ.get("ANTHROPIC_API_KEY")
            if not api_key:
                raise RuntimeError("ANTHROPIC_API_KEY not set")

            client = anthropic.Anthropic(api_key=api_key, timeout=12.0)
            t0 = time.time()
            resp = client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=700,
                messages=[{"role": "user", "content": prompt}],
            )
            raw = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")

            logger.info("synthesis_complete", extra={
                "correlation_id": correlation_id,
                "duration_ms":    int((time.time() - t0) * 1000),
                "input_tokens":   getattr(getattr(resp, "usage", None), "input_tokens", 0),
                "output_tokens":  getattr(getattr(resp, "usage", None), "output_tokens", 0),
            })

            parsed = _parse_analysis(raw)
            if parsed:
                for f in ("situation", "insight", "implication", "recommendation"):
                    if isinstance(parsed.get(f), str):
                        parsed[f] = _sanitise(parsed[f])
                return parsed

        except Exception as e:
            logger.error("synthesis_failed", extra={
                "correlation_id": correlation_id,
                "attempt":        attempt + 1,
                "error":          str(e),
            })
            if attempt == MAX_LLM_RETRIES - 1:
                warnings.append("Analysis temporarily unavailable.")
                return _fallback_analysis()

    warnings.append("Analysis temporarily unavailable.")
    return _fallback_analysis()


def _build_analysis_prompt(
    message:       str,
    intent:        str,
    business_state,
    agent_results: list[AgentResult],
    memories:      list[dict],
    history:       list[dict],
) -> str:

    # Business state — only non-null fields
    state_data: dict = {}
    if business_state:
        d = business_state.to_dict()
        state_data = {k: v for k, v in d.items()
                      if v is not None and k in [
                          "revenue_today", "revenue_yesterday", "revenue_delta_pct",
                          "revenue_trend_7d", "revenue_anomaly",
                          "abandoned_cart_count", "abandoned_cart_value", "cart_anomaly",
                          "churn_risk_count", "vip_inactive_count", "returning_customer_rate",
                          "opportunities", "risks", "anomalies",
                      ]}

    # Hard constraints only
    constraints = [
        {"key": m["memory_key"], "value": m["memory_value"]}
        for m in memories
        if m.get("authority_level", 0) >= 4 and m.get("is_active")
    ]

    # Agent findings
    agent_data = []
    for r in agent_results:
        if r.status not in ("error",):
            agent_data.append({
                "agent":           r.agent,
                "status":          r.status,
                "confidence":      r.confidence,
                "facts":           r.facts[:5],
                "signals":         r.signals[:5],
                "recommendations": r.recommendations[:3],
                "warnings":        r.warnings,
            })

    # Recent conversation context (last 6 turns)
    context_lines = []
    for h in history[-6:]:
        role = h.get("role", "")
        content = h.get("content", {})
        text = ""
        if isinstance(content, dict):
            text = (content.get("text") or
                    content.get("situation") or
                    content.get("recommendation") or "")
        elif isinstance(content, str):
            text = content
        if text:
            context_lines.append(f"{role}: {str(text)[:150]}")
    context = "\n".join(context_lines)

    return f"""You are Rev, an ecommerce intelligence operator for Revluma.

YOUR IDENTITY:
You are not a generic AI assistant. You are a sharp, commercially-minded ecommerce operator who works from real store data and tells merchants exactly what they need to hear. You think in terms of money: where is it being created, where is it being lost, what should change.

ABSOLUTE RULES:
1. Never invent revenue figures, order counts, customer counts, or any metric. Every number must come from STORE DATA below.
2. Never use em dashes (the character —). Use commas, colons, or periods.
3. Never use filler: "It's important to note", "Based on the information", "I'd be happy to", "Let's dive into", "Great question", "As an AI", "There are several factors".
4. Be direct and short. The merchant should understand your answer immediately.
5. If data is unavailable for a specific metric, say what you can't see instead of fabricating.
6. Respect all CONSTRAINTS. They are hard rules.
7. Confidence must reflect actual evidence quality, not be a random number.

STORE DATA (real metrics, use these directly — do not invent other numbers):
{json.dumps(state_data, default=str) if state_data else "No store data available."}

CONSTRAINTS (hard rules):
{json.dumps(constraints) if constraints else "None."}

AGENT ANALYSIS:
{json.dumps(agent_data, default=str) if agent_data else "No agent findings."}

CONVERSATION CONTEXT:
{context if context else "First message."}

MERCHANT MESSAGE (intent: {intent}):
"{message[:400]}"

Respond with a valid JSON object only. No markdown, no preamble:
{{
  "situation": "1-2 sentences. What is actually happening. Specific numbers from store data only. If data is missing, say what you cannot see.",
  "insight": "1-2 sentences. Why it is happening. Evidence-based only.",
  "implication": "1 sentence. What this means commercially.",
  "recommendation": "1-2 sentences. The single most important specific action.",
  "confidence": {{
    "score": 0.0,
    "basis": "High: direct data supports this. Medium: inferred from signals. Low: limited data."
  }},
  "actions": [
    {{"label": "Short action", "tool": null, "params": {{}}}}
  ]
}}

Keep every field short and direct. No padding. Sound like a sharp operator who has looked at the actual data."""


# ── Sanitise ──────────────────────────────────────────────────────────────────

def _sanitise(text: str) -> str:
    text = text.replace("\u2014", ",").replace("\u2013", ",")
    text = re.sub(r"\s*,\s*,", ",", text)
    text = re.sub(r",\s*$", ".", text)
    return text.strip()


def _parse_analysis(raw: str) -> dict | None:
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
            data["confidence"] = {"score": 0.7, "basis": ""}

        score = data["confidence"].get("score", 0.7)
        if not isinstance(score, (int, float)) or not (0 <= score <= 1):
            data["confidence"]["score"] = 0.7

        if not isinstance(data.get("actions"), list):
            data["actions"] = []

        for f in ("situation", "insight", "implication", "recommendation"):
            if isinstance(data.get(f), str) and len(data[f]) > 600:
                data[f] = data[f][:600]

        return data
    except Exception:
        return None


def _fallback_analysis() -> dict:
    return {
        "situation": "Analysis is temporarily unavailable.",
        "insight": "The system encountered an issue. No data was fabricated.",
        "implication": "Try again in a moment.",
        "recommendation": "Refresh and try your question again.",
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


def _load_history(conv_id: str, db, limit: int = 12) -> list[dict]:
    try:
        rows = db.execute(text("""
            SELECT role, content, created_at, agent_name FROM conversation_messages
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
            item = {
                "role":      r[0],
                "content":   content,
                "timestamp": r[2].isoformat() if r[2] else None,
            }
            if r[3]:
                item["agent_name"] = r[3]
            history.append(item)
        return history
    except Exception as e:
        logger.error("load_history_failed", extra={"error": str(e)})
        return []


def _save_turn(
    conv_id: str, org_id: str, user_id: str,
    user_message: str, rev_content,
    response_type: str, history_len: int, db,
    correlation_id: str = "",
    agent_name: str | None = None,
    business_state_id: str | None = None,
    confidence_score: float | None = None,
) -> str:
    """Persist both user message and Rev response in one call."""
    user_seq = history_len + 1
    rev_seq  = history_len + 2
    msg_id   = str(uuid.uuid4())
    rev_id   = str(uuid.uuid4())

    if not correlation_id:
        correlation_id = str(uuid.uuid4())

    # Determine rev content string
    if isinstance(rev_content, str):
        rev_str = json.dumps({"response_type": response_type, "text": rev_content})
    else:
        rev_str = json.dumps(rev_content)

    try:
        db.execute(text("""
            INSERT INTO conversation_messages (
                id, conversation_id, organization_id, user_id,
                role, content, sequence_number, correlation_id, has_error
            ) VALUES (
                :id, :conv_id, :org_id, :user_id,
                'user', :content, :seq, :correlation_id, FALSE
            )
        """), {
            "id": msg_id, "conv_id": conv_id, "org_id": org_id, "user_id": user_id,
            "content": json.dumps({"text": user_message}),
            "seq": user_seq, "correlation_id": correlation_id,
        })

        db.execute(text("""
            INSERT INTO conversation_messages (
                id, conversation_id, organization_id, user_id,
                role, content, sequence_number,
                agent_name, model_name, model_provider,
                business_state_id, correlation_id, confidence_score, has_error
            ) VALUES (
                :id, :conv_id, :org_id, :user_id,
                'rev', :content, :seq,
                :agent_name, 'claude-sonnet-4-6', 'anthropic',
                :bstate_id, :correlation_id, :confidence_score, FALSE
            )
        """), {
            "id": rev_id, "conv_id": conv_id, "org_id": org_id, "user_id": user_id,
            "content": rev_str, "seq": rev_seq,
            "agent_name": agent_name,
            "bstate_id": business_state_id,
            "correlation_id": correlation_id,
            "confidence_score": confidence_score,
        })

        db.commit()
    except Exception as e:
        logger.error("save_turn_failed", extra={"error": str(e)})
        try:
            db.rollback()
        except Exception:
            pass

    return rev_id


def _failure_result(correlation_id: str, conversation_id: str, latency_ms: int) -> OrchestrationResult:
    return OrchestrationResult(
        success=False,
        conversation_id=conversation_id,
        message_id=str(uuid.uuid4()),
        response_type="error",
        text="Something went wrong. Please try again in a moment.",
        correlation_id=correlation_id,
        latency_ms=latency_ms,
    )