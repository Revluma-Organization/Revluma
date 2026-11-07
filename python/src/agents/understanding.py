"""
Rev Intelligence - Message Understanding Layer
===============================================
Every message passes through here BEFORE any tool, agent, or data query runs.

Returns a structured Understanding object, not a single word:
    intent, requires_store_data, requires_web, response_mode, entities, goal

Architectural rule: the store-connection message is ONLY ever shown when
requires_store_data is True AND no store exists. It is never a fallback.
"""

from __future__ import annotations

import json
import logging
import re
import time
from dataclasses import dataclass, field

logger = logging.getLogger("rev.understanding")

UNDERSTANDING_MODEL = "claude-sonnet-4-6"  # Sonnet for accurate intent classification

# response_mode drives the frontend rendering
MODE_CONVERSATIONAL = "conversational"   # plain text, natural
MODE_DIRECT_ANSWER  = "direct_answer"    # short factual answer
MODE_EXPLANATION    = "explanation"      # teaching / knowledge
MODE_ANALYSIS       = "analysis"         # 6-part structured card
MODE_CLARIFICATION  = "clarification"    # asking a question back
MODE_ACTION_PLAN    = "action_plan"      # proposing an operation


@dataclass
class Understanding:
    intent:              str
    goal:                str
    requires_store_data: bool
    requires_web:        bool
    requires_action:     bool
    response_mode:       str
    entities:            dict = field(default_factory=dict)
    domains:             list[str] = field(default_factory=list)
    urgency:             str = "low"
    confidence:          float = 0.5
    reasoning:           str = ""

    def to_dict(self) -> dict:
        return {
            "intent":              self.intent,
            "goal":                self.goal,
            "requires_store_data": self.requires_store_data,
            "requires_web":        self.requires_web,
            "requires_action":     self.requires_action,
            "response_mode":       self.response_mode,
            "entities":            self.entities,
            "domains":             self.domains,
            "urgency":             self.urgency,
            "confidence":          self.confidence,
        }


_SCHEMA_PROMPT = """You are the understanding layer of Rev, an ecommerce intelligence agent.

Your ONLY job is to understand what the merchant means. You do not answer them.

Return a single JSON object. No markdown. No preamble.

{
  "intent": "one of: greeting | casual | identity | capability | knowledge | strategy | diagnosis | metrics | recommendation | action | web_research | followup | preference | feedback | clarification_needed",
  "goal": "short phrase describing what the merchant is trying to accomplish",
  "requires_store_data": true or false,
  "requires_web": true or false,
  "requires_action": true or false,
  "response_mode": "one of: conversational | direct_answer | explanation | analysis | clarification | action_plan",
  "entities": {"metric": "...", "period": "...", "channel": "..."},
  "domains": ["revenue" | "carts" | "customers" | "marketing" | "products" | "checkout"],
  "urgency": "low | medium | high",
  "confidence": 0.0 to 1.0
}

CRITICAL RULES for requires_store_data:
- Set TRUE only when answering genuinely needs THIS merchant's actual numbers.
- Set FALSE for greetings, identity questions, capability questions, general ecommerce advice, definitions, and anything conversational.
- When in doubt, set FALSE. A wrong FALSE means Rev answers helpfully from expertise. A wrong TRUE means Rev tells them to connect a store when they only said hello, which is unacceptable.

EXAMPLES:

"Hello" ->
{"intent":"greeting","goal":"start conversation","requires_store_data":false,"requires_web":false,"requires_action":false,"response_mode":"conversational","entities":{},"domains":[],"urgency":"low","confidence":0.99}

"Nothing much, what about you?" ->
{"intent":"casual","goal":"small talk","requires_store_data":false,"requires_web":false,"requires_action":false,"response_mode":"conversational","entities":{},"domains":[],"urgency":"low","confidence":0.97}

"Who are you?" ->
{"intent":"identity","goal":"understand what Rev is","requires_store_data":false,"requires_web":false,"requires_action":false,"response_mode":"conversational","entities":{},"domains":[],"urgency":"low","confidence":0.98}

"What can you do?" ->
{"intent":"capability","goal":"understand Rev capabilities","requires_store_data":false,"requires_web":false,"requires_action":false,"response_mode":"explanation","entities":{},"domains":[],"urgency":"low","confidence":0.98}

"What is AOV?" ->
{"intent":"knowledge","goal":"learn a definition","requires_store_data":false,"requires_web":false,"requires_action":false,"response_mode":"direct_answer","entities":{"metric":"aov"},"domains":[],"urgency":"low","confidence":0.96}

"How do I reduce cart abandonment?" ->
{"intent":"strategy","goal":"reduce cart abandonment","requires_store_data":false,"requires_web":false,"requires_action":false,"response_mode":"explanation","entities":{},"domains":["carts"],"urgency":"low","confidence":0.94}

"My sales dropped this week" ->
{"intent":"diagnosis","goal":"find cause of revenue decline","requires_store_data":true,"requires_web":false,"requires_action":false,"response_mode":"analysis","entities":{"metric":"sales","period":"this_week"},"domains":["revenue"],"urgency":"high","confidence":0.95}

"Show me my revenue today" ->
{"intent":"metrics","goal":"see revenue figure","requires_store_data":true,"requires_web":false,"requires_action":false,"response_mode":"direct_answer","entities":{"metric":"revenue","period":"today"},"domains":["revenue"],"urgency":"low","confidence":0.96}

"What should I focus on?" ->
{"intent":"recommendation","goal":"identify top priority","requires_store_data":true,"requires_web":false,"requires_action":false,"response_mode":"analysis","entities":{},"domains":["revenue","carts"],"urgency":"medium","confidence":0.9}

"What changed in Shopify checkout recently?" ->
{"intent":"web_research","goal":"learn recent platform changes","requires_store_data":false,"requires_web":true,"requires_action":false,"response_mode":"explanation","entities":{},"domains":["checkout"],"urgency":"low","confidence":0.93}

"Create a recovery campaign" ->
{"intent":"action","goal":"launch cart recovery","requires_store_data":true,"requires_web":false,"requires_action":true,"response_mode":"action_plan","entities":{},"domains":["carts","marketing"],"urgency":"medium","confidence":0.92}

"That's too aggressive" ->
{"intent":"feedback","goal":"adjust previous recommendation","requires_store_data":false,"requires_web":false,"requires_action":false,"response_mode":"conversational","entities":{},"domains":[],"urgency":"low","confidence":0.88}

"Never discount above 10%" ->
{"intent":"preference","goal":"set a business constraint","requires_store_data":false,"requires_web":false,"requires_action":false,"response_mode":"conversational","entities":{"constraint":"max_discount_pct","value":10},"domains":[],"urgency":"low","confidence":0.95}

"Why?" (after Rev explained a revenue drop) ->
{"intent":"followup","goal":"understand cause more deeply","requires_store_data":true,"requires_web":false,"requires_action":false,"response_mode":"analysis","entities":{},"domains":["revenue"],"urgency":"medium","confidence":0.85}
"""


def understand(message: str, history: list[dict],
               image_base64: str | None = None,
               image_media_type: str | None = None) -> Understanding:
    """
    Understand the merchant message. Never raises.
    Falls back to a safe conversational reading if the model is unavailable.
    """

    context = _format_history(history)
    text_prompt = (
        _SCHEMA_PROMPT
        + "\n\nCONVERSATION SO FAR:\n"
        + (context if context else "(this is the first message)")
        + "\n\nMERCHANT MESSAGE:\n"
        + message[:800]
        + ("\n\n[The merchant has also uploaded an image for you to analyse.]"
           if image_base64 else "")
        + "\n\nReturn only the JSON object."
    )

    started = time.monotonic()
    try:
        from .model_gateway import generate
        for attempt in range(2):
            remaining = 12.0 - (time.monotonic() - started)
            if remaining <= 0:
                break
            prompt = text_prompt if attempt == 0 else text_prompt + "\nThe previous output was invalid. Return one complete JSON object matching every required field and type; no markup or extra text."
            raw = generate(prompt, role="fast", max_tokens=700, timeout=remaining,
                           image_base64=image_base64, image_media_type=image_media_type)
            parsed = _parse(raw)
            if parsed:
                logger.info("understanding_ok", extra={
                    "intent": parsed.intent, "store": parsed.requires_store_data,
                    "mode": parsed.response_mode, "repair_attempt": attempt,
                })
                return parsed
            logger.warning("understanding_parse_failed attempt=%d", attempt + 1)
        return _safe_fallback(message, history, "malformed_output")

    except Exception as e:
        logger.warning("understanding_failed", extra={"error_type": type(e).__name__})
        return _safe_fallback(message, history, type(e).__name__)


def _parse(raw: str) -> Understanding | None:
    """Strict versioned-shape validation; never scavenges JSON from prose."""
    try:
        if not isinstance(raw, str):
            return None
        cleaned = raw.strip()
        fenced = re.fullmatch(r"```(?:json)?\s*(\{.*\})\s*```", cleaned, re.S)
        if fenced:
            cleaned = fenced.group(1)
        if not cleaned.startswith("{") or not cleaned.endswith("}"):
            return None
        d = json.loads(cleaned)
        required = {"intent", "goal", "requires_store_data", "requires_web", "requires_action",
                    "response_mode", "entities", "domains", "urgency", "confidence"}
        valid_intents = {"greeting", "casual", "identity", "capability", "knowledge", "strategy",
                         "diagnosis", "metrics", "recommendation", "action", "web_research", "followup",
                         "preference", "feedback", "clarification_needed"}
        valid_modes = {MODE_CONVERSATIONAL, MODE_DIRECT_ANSWER, MODE_EXPLANATION,
                       MODE_ANALYSIS, MODE_CLARIFICATION, MODE_ACTION_PLAN}
        if not isinstance(d, dict) or not required.issubset(d):
            return None
        if d["intent"] not in valid_intents or d["response_mode"] not in valid_modes:
            return None
        if not isinstance(d["goal"], str) or any(not isinstance(d[key], bool) for key in
                ("requires_store_data", "requires_web", "requires_action")):
            return None
        if not isinstance(d["entities"], dict) or not isinstance(d["domains"], list) or \
                any(not isinstance(domain, str) for domain in d["domains"]):
            return None
        if d["urgency"] not in {"low", "medium", "high"} or isinstance(d["confidence"], bool) or \
                not isinstance(d["confidence"], (int, float)) or not 0 <= d["confidence"] <= 1:
            return None
        return Understanding(
            intent=d["intent"], goal=d["goal"][:300],
            requires_store_data=d["requires_store_data"], requires_web=d["requires_web"],
            requires_action=d["requires_action"], response_mode=d["response_mode"],
            entities=d["entities"], domains=d["domains"][:8], urgency=d["urgency"],
            confidence=float(d["confidence"]),
        )
    except (ValueError, TypeError, json.JSONDecodeError):
        return None


def _safe_fallback(message: str, history: list[dict], reason: str) -> Understanding:
    """
    Deterministic fallback. Biased HEAVILY toward conversational.
    requires_store_data is only True on explicit possessive store language.
    """
    msg = message.lower().strip()

    # Explicit store-specific possessive language is the ONLY path to store data
    store_signals = [
        "my revenue", "my sales", "my store", "my carts", "my customers",
        "my orders", "my conversion", "my checkout", "my products", "my aov",
        "our revenue", "our sales", "our store", "our carts", "our customers",
        "our orders", "our conversion", "my abandoned", "our abandoned",
        "analyze my", "analyse my", "how is my", "how's my", "hows my",
        "what happened yesterday", "what happened today", "this week",
    ]
    # A merchant asking for connected-store facts must never be routed as small talk.
    # Check these phrases before generic knowledge, identity, or web-research routing.
    store_signals.extend([
        "my connected store", "connected store", "verified findings",
        "my findings", "store findings", "supporting evidence",
        "store data", "my business data", "information is still unavailable",
    ])
    needs_store = any(signal in msg for signal in store_signals)

    domains = []
    for d, kws in {
        "revenue":   ["revenue", "sales", "orders", "aov"],
        "carts":     ["cart", "abandon", "checkout", "recover"],
        "customers": ["customer", "churn", "retention", "repeat", "ltv"],
        "marketing": ["campaign", "email", "sms", "whatsapp", "marketing"],
        "products":  ["product", "inventory", "sku"],
    }.items():
        if any(k in msg for k in kws):
            domains.append(d)

    if needs_store and any(p in msg for p in (
        "verified findings", "connected store", "supporting evidence",
        "store findings", "information is still unavailable",
    )):
        return Understanding("diagnosis", "review verified merchant evidence", True, False, False,
                             MODE_ANALYSIS, {}, domains or ["revenue"], "medium", 0.9, reason)

    # Identity
    if any(p in msg for p in ["who are you", "what are you", "introduce yourself",
                              "tell me about yourself", "what is rev", "whats rev"]):
        return Understanding("identity", "understand what Rev is", False, False, False,
                             MODE_CONVERSATIONAL, {}, [], "low", 0.8, reason)

    # Capability
    if any(p in msg for p in ["what can you do", "what can you help", "how can you help",
                              "what do you do", "your capabilities", "what features"]):
        return Understanding("capability", "understand Rev capabilities", False, False, False,
                             MODE_EXPLANATION, {}, [], "low", 0.85, reason)

    # Questions about the merchant's present data are not external research.
    # "current" and "recent" must not override first-party store evidence.
    # Web research signals
    if not needs_store and any(p in msg for p in ["latest", "recent", "current trend", "this year", "2026",
                              "search the web", "what changed", "news about", "benchmark"]):
        return Understanding("web_research", "get current external information", needs_store, True, False,
                             MODE_EXPLANATION, {}, domains, "low", 0.7, reason)

    # Knowledge / definitions
    if any(p in msg for p in ["what is", "what's a", "whats a", "define", "explain",
                              "meaning of", "difference between"]) and not needs_store:
        return Understanding("knowledge", "learn a concept", False, False, False,
                             MODE_DIRECT_ANSWER, {}, domains, "low", 0.8, reason)

    # Broad diagnostic verbs are treated as ecommerce strategy only when an
    # ecommerce domain was identified. This prevents phrases such as
    # "identify this person" or "improve team morale" from being misrouted.
    strategy_phrases = [
        "how do i", "how can i", "how to", "tips for", "best way",
        "should i", "strategy for", "ways to",
    ]
    ecommerce_reasoning_phrases = [
        "why do", "why does", "why are", "why is", "real reason",
        "reason why", "what causes", "what drives", "how should",
        "what happens", "what makes", "identify", "diagnose",
        "increase", "reduce", "improve", "fix", "solve",
        "most common", "biggest problem", "main reason",
    ]
    is_general_strategy = any(p in msg for p in strategy_phrases)
    is_ecommerce_reasoning = bool(domains) and any(
        p in msg for p in ecommerce_reasoning_phrases
    )
    if (is_general_strategy or is_ecommerce_reasoning) and not needs_store:
        return Understanding("strategy", "get ecommerce guidance", False, False, False,
                             MODE_EXPLANATION, {}, domains, "low", 0.5, reason)

    # Store-specific business question
    if needs_store:
        diag = any(p in msg for p in ["why", "dropped", "fell", "down", "wrong", "issue", "problem"])
        return Understanding(
            "diagnosis" if diag else "metrics",
            "understand store performance", True, False, False,
            MODE_ANALYSIS if diag else MODE_DIRECT_ANSWER,
            {}, domains or ["revenue"], "medium", 0.5, reason,
        )

    # Everything else is conversation. This is the safe default.
    return Understanding("casual", "conversation", False, False, False,
                         MODE_CONVERSATIONAL, {}, domains, "low", 0.45, reason)


def _format_history(history: list[dict], turns: int = 6) -> str:
    lines = []
    for h in history[-turns:]:
        role = h.get("role", "")
        content = h.get("content", {})
        text = ""
        if isinstance(content, dict):
            text = (content.get("text")
                    or content.get("situation")
                    or content.get("recommendation")
                    or "")
        elif isinstance(content, str):
            text = content
        if text:
            speaker = "merchant" if role == "user" else "rev"
            lines.append(f"{speaker}: {str(text)[:160]}")
    return "\n".join(lines)
