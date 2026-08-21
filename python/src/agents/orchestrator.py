"""
Rev Intelligence Orchestrator v3
==================================
Core principle: Understand first. Retrieve only what matters.
               Reason from evidence. Act only when appropriate.

Intent classification uses claude-haiku for accurate semantic understanding.
Conversation history drives follow-up context.
Response format adapts to intent -- no 6-part card for greetings.
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

INTENTS = {
    "chat":                "Natural conversation. No analytics needed.",
    "business":            "Business question requiring store data and reasoning.",
    "analytics":           "Request for specific metrics or data.",
    "recommendation":      "Asking what to do based on their specific situation.",
    "ecommerce_strategy":  "General ecommerce strategy/advice, no store data needed.",
    "action":              "Asking Rev to execute something.",
    "capability":          "Asking what Rev can do.",
    "knowledge":           "General ecommerce knowledge/definition, no store data needed.",
    "followup":            "Follow-up on a previous message in this conversation.",
}

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

    message = message.strip()[:MAX_MESSAGE_CHARS]
    if not message:
        raise ValueError("Empty message")

    conv_id, is_new = _get_or_create_conversation(organization_id, user_id, conversation_id, db)
    history         = _load_history(conv_id, db, limit=MAX_HISTORY_TURNS)
    memories        = _load_memories(organization_id, db)
    intent, _       = _classify_intent_with_llm(message, history)

    logger.info("intent_classified", extra={
        "correlation_id": correlation_id,
        "intent":         intent,
    })

    # ── Chat: greetings, small talk ───────────────────────────────────────────
    if intent == "chat":
        text = _generate_chat_response(message, history)
        text = _sanitise(text)
        _update_conversation(conv_id, db, title_hint=message if is_new else None)
        return OrchestrationResult(
            success=True, conversation_id=conv_id, message_id=str(uuid.uuid4()),
            response_type="chat", text=text, correlation_id=correlation_id,
        )

    # ── Capability ────────────────────────────────────────────────────────────
    if intent == "capability":
        text = _capability_response()
        _update_conversation(conv_id, db, title_hint=message if is_new else None)
        return OrchestrationResult(
            success=True, conversation_id=conv_id, message_id=str(uuid.uuid4()),
            response_type="capability", text=text, correlation_id=correlation_id,
        )

    # ── Knowledge and general ecommerce strategy (no store needed) ────────────
    if intent in ("knowledge", "ecommerce_strategy"):
        text = _generate_knowledge_response(message, history, intent=intent)
        text = _sanitise(text)
        _update_conversation(conv_id, db, title_hint=message if is_new else None)
        return OrchestrationResult(
            success=True, conversation_id=conv_id, message_id=str(uuid.uuid4()),
            response_type="knowledge", text=text, correlation_id=correlation_id,
        )

    # ── Business / analytics / recommendation / followup -- need store data ───
    business_state = load_current_business_state(organization_id, db)
    has_store = (
        business_state is not None and
        business_state.computation_status != "failed" and
        business_state.revenue_today is not None
    )

    if not has_store:
        try:
            business_state = build_business_state(organization_id, db)
            has_store = (
                business_state is not None and
                business_state.computation_status != "failed" and
                business_state.revenue_today is not None
            )
        except Exception:
            has_store = False

    if not has_store:
        text = _no_store_response(message, intent)
        text = _sanitise(text)
        _update_conversation(conv_id, db, title_hint=message if is_new else None)
        return OrchestrationResult(
            success=True, conversation_id=conv_id, message_id=str(uuid.uuid4()),
            response_type="clarification", text=text, correlation_id=correlation_id,
        )

    state_age = business_state.age_minutes() if business_state else 0.0
    state_id  = business_state.id if business_state else None

    selected_agents = _select_agents(message, intent, history)
    logger.info("agents_selected", extra={"correlation_id": correlation_id, "agents": selected_agents})

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

    hard_constraints = [m for m in memories if m.get("authority_level", 0) >= 5]
    if hard_constraints:
        agent_results = _apply_constraints(agent_results, hard_constraints)

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

    _update_conversation(conv_id, db, title_hint=message if is_new else None)

    return OrchestrationResult(
        success=True,
        conversation_id=conv_id,
        message_id=str(uuid.uuid4()),
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


# ── Intent classification ─────────────────────────────────────────────────────

def _classify_intent_with_llm(message: str, history: list[dict]) -> tuple[str, str]:
    import anthropic, os

    history_text = ""
    if history:
        for h in history[-3:]:
            role = h.get("role", "")
            content = h.get("content", {})
            text = ""
            if isinstance(content, dict):
                text = content.get("text", "") or content.get("situation", "")
            elif isinstance(content, str):
                text = content
            if text:
                history_text += f"{role}: {str(text)[:100]}\n"

    prompt = (
        "You are classifying the intent of a merchant message to an ecommerce AI assistant.\n\n"
        f"Previous conversation:\n{history_text if history_text else '(new conversation)'}\n\n"
        f"Current message: \"{message}\"\n\n"
        "Classify the intent as EXACTLY ONE of these:\n"
        "- chat: greeting, thanks, acknowledgement, casual conversation, how are you, okay, emotional response, any social message. NO analytics needed.\n"
        "- ecommerce_strategy: general strategy or advice about ecommerce that does NOT require the merchant specific store data. How do I reduce cart abandonment, What is a good retention strategy, How can I improve conversion, Tips for recovering carts. Use ecommerce expertise, not store data.\n"
        "- knowledge: general ecommerce concept or definition. What is LTV, What is CAC, Explain AOV, What is cart abandonment, Difference between retention and acquisition.\n"
        "- business: question about what is happening in THEIR specific store. Why did MY revenue drop, What is happening with MY store, Why are MY carts abandoning. Requires actual merchant store data.\n"
        "- analytics: request for specific numbers from THEIR store. Show me my revenue, How many carts did I lose yesterday, What is my conversion rate.\n"
        "- recommendation: asking what THEY should do based on their specific situation. What should I focus on, What should I do next.\n"
        "- action: asking Rev to create/send/launch something. Create a campaign, Send this email.\n"
        "- capability: asking what Rev can do or help with. What can you do, How can you help me.\n"
        "- followup: short follow-up referring to the previous message. why, tell me more, how, what about X.\n\n"
        "Rules:\n"
        "- How are you doing = chat (NOT business, NOT analytics)\n"
        "- What is up = chat\n"
        "- Okay = chat\n"
        "- Thanks = chat\n"
        "- How do I reduce cart abandonment = ecommerce_strategy (general advice, no store needed)\n"
        "- How can I improve my conversion rate = ecommerce_strategy\n"
        "- What is AOV = knowledge\n"
        "- Why is MY revenue down = business (store-specific)\n"
        "- Show me my revenue = analytics\n"
        "- Why (after a business question) = followup\n"
        "- What should I focus on = recommendation\n\n"
        "Respond with ONLY the intent word and a brief reason. Format:\n"
        "INTENT: [word]\n"
        "REASON: [one short sentence]"
    )

    try:
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            return _fallback_classify(message, history), "no api key"

        client = anthropic.Anthropic(api_key=api_key, timeout=5.0)
        resp = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=60,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text").strip()

        intent_match = re.search(r"INTENT:\s*(\w+)", raw, re.IGNORECASE)
        reason_match = re.search(r"REASON:\s*(.+)", raw, re.IGNORECASE)

        if intent_match:
            intent = intent_match.group(1).lower().strip()
            reason = reason_match.group(1).strip() if reason_match else ""
            if intent in INTENTS:
                return intent, reason

        return _fallback_classify(message, history), "parse failed"

    except Exception as e:
        logger.warning("intent_classify_failed", extra={"error": str(e)})
        return _fallback_classify(message, history), f"error: {str(e)}"


def _fallback_classify(message: str, history: list[dict]) -> str:
    msg = message.lower().strip()

    if len(msg.split()) <= 3 and history:
        followup_words = ["why", "how", "what", "when", "tell me more", "explain",
                         "which", "who", "where", "really", "and", "but"]
        if any(msg.startswith(w) for w in followup_words):
            return "followup"

    conv_patterns = ["hi", "hello", "hey", "thanks", "thank you", "okay", "ok",
                     "bye", "good morning", "how are you", "cheers", "great",
                     "cool", "alright", "got it", "makes sense", "sounds good"]
    if any(msg.startswith(p) or msg == p for p in conv_patterns):
        return "chat"

    strategy = ["how do i", "how can i", "how to", "tips for", "best way to",
                "how should i", "reduce cart", "increase aov", "improve conversion",
                "recover abandoned", "retention strategy", "win back"]
    if any(kw in msg for kw in strategy) and not any(
        store_kw in msg for store_kw in ["my ", "our ", "store"]
    ):
        return "ecommerce_strategy"

    knowledge = ["what is", "define", "explain", "aov", "ltv", "cac",
                 "what does", "how does", "what are", "best practice"]
    if any(kw in msg for kw in knowledge) and not any(
        store_kw in msg for store_kw in ["my ", "our ", "store"]
    ):
        return "knowledge"

    business = ["why", "what happened", "dropped", "fell", "increased", "decreased",
                "going on", "issue", "problem"]
    if any(kw in msg for kw in business):
        return "business"

    return "business"


def _select_agents(message: str, intent: str, history: list[dict]) -> list[str]:
    if intent == "followup" and history:
        for h in reversed(history):
            if h.get("role") == "rev":
                content = h.get("content", {})
                if isinstance(content, dict):
                    agent_str = content.get("agent_name", "")
                    if agent_str:
                        return [a.strip() for a in agent_str.split(",") if a.strip()]

    msg = message.lower()
    agents = []
    for domain, domain_agents in _DOMAIN_AGENTS.items():
        if domain in msg:
            for a in domain_agents:
                if a not in agents:
                    agents.append(a)

    return agents[:3] if agents else ["revenue", "retention"]


# ── Response generators ───────────────────────────────────────────────────────

def _generate_chat_response(message: str, history: list[dict]) -> str:
    import anthropic, os

    msg = message.lower().strip()

    instant = {
        "hi":              "Hey, good to have you here. What are we working on today?",
        "hello":           "Hey! What is on your mind?",
        "hey":             "Hey. What are we looking at?",
        "hey rev":         "Hey. What are we working on?",
        "hi rev":          "Hey. Good to see you. What is on your mind?",
        "good morning":    "Morning! Ready to dig in whenever you are. What is the focus today?",
        "morning":         "Morning. What are we working on?",
        "good afternoon":  "Afternoon. What are we looking at?",
        "good evening":    "Evening. What is on your mind?",
        "good night":      "Good night. Talk tomorrow.",
        "goodnight":       "Good night.",
        "thanks":          "Of course. Anything else?",
        "thank you":       "Of course. What else do you need?",
        "thank you so much": "Happy to help. What else?",
        "cheers":          "Of course.",
        "appreciated":     "Of course.",
        "okay":            "Got it. What is next?",
        "ok":              "Got it.",
        "ok thanks":       "Of course.",
        "okay thanks":     "Of course.",
        "alright":         "Got it.",
        "got it":          "Good. What else?",
        "makes sense":     "Good. What else do you want to look at?",
        "sounds good":     "Good. What is next?",
        "great":           "Good. Anything else?",
        "perfect":         "Good. What else?",
        "cool":            "Good.",
        "nice":            "Good.",
        "interesting":     "What do you want to dig into?",
        "wow":             "What are you thinking?",
        "yes":             "Good. What else?",
        "no":              "Okay. What would you like instead?",
        "yep":             "Good.",
        "nope":            "Okay.",
        "sure":            "Good.",
        "lol":             "Ha. What are we working on?",
        "haha":            "What is on your mind?",
        "bye":             "Talk soon.",
        "goodbye":         "Talk soon.",
        "see you":         "Talk soon.",
        "see ya":          "Talk soon.",
        "later":           "Talk soon.",
        "cya":             "Talk soon.",
    }

    if msg in instant:
        return instant[msg]
    clean = re.sub(r"[!.,?\s]+$", "", msg).strip()
    if clean in instant:
        return instant[clean]

    try:
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            return "What would you like to work on?"

        recent_context = ""
        if history:
            for h in history[-3:]:
                role = h.get("role", "")
                content = h.get("content", {})
                text = ""
                if isinstance(content, dict):
                    text = (content.get("text", "") or
                            content.get("situation", "") or
                            content.get("recommendation", ""))
                elif isinstance(content, str):
                    text = content
                if text:
                    recent_context += f"{role}: {str(text)[:100]}\n"

        client = anthropic.Anthropic(api_key=api_key, timeout=6.0)
        resp = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=120,
            messages=[{
                "role": "user",
                "content": (
                    "You are Rev, an ecommerce intelligence assistant for Revluma.\n"
                    f"Recent context:\n{recent_context if recent_context else '(new conversation)'}\n"
                    f"The merchant said: '{message}'\n"
                    "This is a conversational message, not a business question.\n"
                    "Reply naturally and warmly in 1-3 short sentences.\n"
                    "Sound like a smart, friendly ecommerce operator.\n"
                    "No em dashes. No corporate language. No 'certainly' or 'absolutely'.\n"
                    "If appropriate, invite them to share what they are working on."
                )
            }]
        )
        text = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text").strip()
        return text or "What would you like to work on today?"

    except Exception:
        return "What would you like to work on today?"


def _capability_response() -> str:
    return (
        "Here is what I can do for you:\n\n"
        "When your store is connected: analyze revenue changes, investigate why carts are abandoning, "
        "identify which customers are about to churn, find your biggest revenue leaks, "
        "and tell you exactly what to focus on next.\n\n"
        "Without store data: help you think through ecommerce strategy, explain concepts, "
        "advise on cart recovery approaches, retention tactics, pricing, and marketing.\n\n"
        "What are you working on?"
    )


def _generate_knowledge_response(message: str, history: list[dict], intent: str = "knowledge") -> str:
    import anthropic, os

    context_lines = []
    if history:
        for h in history[-4:]:
            role = h.get("role", "")
            content = h.get("content", {})
            text = ""
            if isinstance(content, dict):
                text = (content.get("text") or content.get("situation") or "")
            elif isinstance(content, str):
                text = content
            if text:
                context_lines.append(f"{role}: {str(text)[:120]}")
    context = "\n".join(context_lines)

    is_strategy = intent == "ecommerce_strategy"

    try:
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            return "I do not have an answer for that right now."

        client = anthropic.Anthropic(api_key=api_key, timeout=8.0)

        strategy_instruction = (
            "This is a general ecommerce strategy question. Give practical, specific advice "
            "from your ecommerce expertise. Be direct and actionable. If their store data "
            "would make this more specific, mention briefly that connecting their store would help."
        ) if is_strategy else (
            "This is a knowledge or definition question. Answer directly and accurately. "
            "Be concise but complete."
        )

        resp = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=350,
            messages=[{
                "role": "user",
                "content": (
                    "You are Rev, an ecommerce intelligence assistant built into Revluma.\n"
                    "You have deep expertise in ecommerce, Shopify, WooCommerce, revenue recovery, "
                    "retention, customer behavior, and marketing.\n\n"
                    f"Conversation context:\n{context if context else '(new conversation)'}\n\n"
                    f"The merchant asked: '{message}'\n\n"
                    f"{strategy_instruction}\n"
                    "Rules: No em dashes. No 'certainly' or 'absolutely'. No corporate language. "
                    "Sound like a sharp ecommerce operator, not a generic AI assistant."
                )
            }]
        )
        text = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text").strip()
        return text or "I do not have a clear answer for that right now."

    except Exception:
        return "I cannot look that up right now. Try asking again in a moment."


def _no_store_response(message: str, intent: str) -> str:
    import anthropic, os

    try:
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            raise RuntimeError("no key")

        client = anthropic.Anthropic(api_key=api_key, timeout=8.0)
        resp = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=250,
            messages=[{
                "role": "user",
                "content": (
                    "You are Rev, an ecommerce intelligence assistant.\n"
                    f"The merchant asked: '{message}'\n"
                    "Their store is not connected yet so you do not have their specific data.\n"
                    "Respond helpfully using your ecommerce expertise. Give practical general guidance.\n"
                    "At the end, mention briefly that you can give a more specific answer once their store is connected.\n"
                    "Be concise. No em dashes. No corporate language. Sound like a sharp operator."
                )
            }]
        )
        text = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text").strip()
        if text:
            return text
    except Exception:
        pass

    msg = message.lower()
    if any(kw in msg for kw in ["abandon", "cart"]):
        return (
            "The biggest causes of cart abandonment are unexpected shipping costs at checkout, "
            "forced account creation, checkout friction, weak trust signals, and poor mobile experience. "
            "Start by auditing your checkout flow for friction. "
            "Once your store is connected, I can tell you exactly where your specific carts are dropping off."
        )
    if any(kw in msg for kw in ["revenue", "sales", "orders"]):
        return (
            "Revenue problems usually trace to three things: traffic, conversion, or AOV. "
            "Check if traffic is down first, then look at your checkout conversion, then your average order value. "
            "Connect your store and I can tell you exactly which of these is the issue."
        )
    if any(kw in msg for kw in ["customer", "churn", "retention", "repeat"]):
        return (
            "Retention usually comes down to the post-purchase experience, timing of follow-up messages, "
            "and whether customers feel a reason to return. "
            "Connect your store and I can identify which customers are actually at risk."
        )
    return (
        "Happy to help with that. "
        "For a general answer I can advise from ecommerce expertise. "
        "For an answer specific to your store, connect Shopify or WooCommerce and I will work from your actual data."
    )


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
    message: str,
    intent: str,
    business_state,
    agent_results: list[AgentResult],
    memories: list[dict],
    history: list[dict],
) -> str:
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

    constraints = [
        {"key": m["memory_key"], "value": m["memory_value"]}
        for m in memories
        if m.get("authority_level", 0) >= 4 and m.get("is_active")
    ]

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

    state_json = json.dumps(state_data, default=str) if state_data else "No store data available."
    constraints_json = json.dumps(constraints) if constraints else "None."
    agent_json = json.dumps(agent_data, default=str) if agent_data else "No agent findings."

    return (
        "You are Rev, an ecommerce intelligence operator for Revluma.\n\n"
        "YOUR IDENTITY:\n"
        "You are a sharp, commercially-minded ecommerce operator who works from real store data "
        "and tells merchants exactly what they need to hear. "
        "You think in terms of money: where is it being created, where is it being lost, what should change.\n\n"
        "ABSOLUTE RULES:\n"
        "1. Never invent revenue figures, order counts, customer counts, or any metric. "
        "Every number must come from STORE DATA below.\n"
        "2. Never use em dashes. Use commas, colons, or periods instead.\n"
        "3. Never use filler phrases. Be direct and concise.\n"
        "4. Be direct and short. The merchant should understand your answer immediately.\n"
        "5. If data is unavailable for a specific metric, say what you cannot see instead of fabricating.\n"
        "6. Respect all CONSTRAINTS. They are hard rules.\n"
        "7. Confidence must reflect actual evidence quality, not be a random number.\n\n"
        f"STORE DATA (real metrics, use these directly):\n{state_json}\n\n"
        f"CONSTRAINTS (hard rules):\n{constraints_json}\n\n"
        f"AGENT ANALYSIS:\n{agent_json}\n\n"
        f"CONVERSATION CONTEXT:\n{context if context else 'First message.'}\n\n"
        f"MERCHANT MESSAGE (intent: {intent}):\n"
        f"'{message[:400]}'\n\n"
        "Respond with a valid JSON object only. No markdown, no preamble:\n"
        "{\n"
        '  "situation": "1-2 sentences. What is actually happening. Specific numbers from store data only.",\n'
        '  "insight": "1-2 sentences. Why it is happening. Evidence-based only.",\n'
        '  "implication": "1 sentence. What this means commercially.",\n'
        '  "recommendation": "1-2 sentences. The single most important specific action.",\n'
        '  "confidence": {\n'
        '    "score": 0.0,\n'
        '    "basis": "High: direct data. Medium: inferred from signals. Low: limited data."\n'
        "  },\n"
        '  "actions": [{"label": "Short action", "tool": null, "params": {}}]\n'
        "}\n\n"
        "Keep every field short and direct. Sound like a sharp operator who has looked at the actual data."
    )


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
