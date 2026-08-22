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
    import anthropic, os

    context = _format_history(history)

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

    try:
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            return _safe_fallback(message, history, "no api key")

        client = anthropic.Anthropic(api_key=api_key, timeout=9.0)

        # Build content: text + optional image
        if image_base64 and image_media_type:
            content = [
                {"type": "image", "source": {
                    "type": "base64",
                    "media_type": image_media_type,
                    "data": image_base64,
                }},
                {"type": "text", "text": text_prompt},
            ]
        else:
            content = text_prompt

        resp = client.messages.create(
            model=UNDERSTANDING_MODEL,
            max_tokens=400,
            messages=[{"role": "user", "content": content}],
        )
        raw = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text").strip()

        parsed = _parse(raw)
        if parsed:
            logger.info("understanding_ok", extra={
                "intent": parsed.intent,
                "store":  parsed.requires_store_data,
                "mode":   parsed.response_mode,
            })
            return parsed

        print(f"UNDERSTANDING_PARSE_FAILED raw={raw[:200]}")
        return _safe_fallback(message, history, "parse failed")

    except Exception as e:
        print(f"UNDERSTANDING_ERROR {type(e).__name__}: {e}")
        logger.warning("understanding_failed", extra={"error": str(e)})
        return _safe_fallback(message, history, str(e))


def _parse(raw: str) -> Understanding | None:
    try:
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            cleaned = re.sub(r"^```(json)?", "", cleaned).strip()
            cleaned = re.sub(r"```$", "", cleaned).strip()
        # Grab the first JSON object if the model added stray text
        brace = cleaned.find("{")
        if brace > 0:
            cleaned = cleaned[brace:]
        last = cleaned.rfind("}")
        if last != -1:
            cleaned = cleaned[:last + 1]

        d = json.loads(cleaned)
        if not isinstance(d, dict) or "intent" not in d:
            return None

        mode = d.get("response_mode", MODE_CONVERSATIONAL)
        valid_modes = {
            MODE_CONVERSATIONAL, MODE_DIRECT_ANSWER, MODE_EXPLANATION,
            MODE_ANALYSIS, MODE_CLARIFICATION, MODE_ACTION_PLAN,
        }
        if mode not in valid_modes:
            mode = MODE_CONVERSATIONAL

        return Understanding(
            intent=str(d.get("intent", "casual")).lower().strip(),
            goal=str(d.get("goal", "")),
            requires_store_data=bool(d.get("requires_store_data", False)),
            requires_web=bool(d.get("requires_web", False)),
            requires_action=bool(d.get("requires_action", False)),
            response_mode=mode,
            entities=d.get("entities") if isinstance(d.get("entities"), dict) else {},
            domains=d.get("domains") if isinstance(d.get("domains"), list) else [],
            urgency=str(d.get("urgency", "low")),
            confidence=float(d.get("confidence", 0.5)) if isinstance(d.get("confidence"), (int, float)) else 0.5,
        )
    except Exception:
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
    needs_store = any(s in msg for s in store_signals)

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

    # Web research signals
    if any(p in msg for p in ["latest", "recent", "current trend", "this year", "2026",
                              "search the web", "what changed", "news about", "benchmark"]):
        return Understanding("web_research", "get current external information", needs_store, True, False,
                             MODE_EXPLANATION, {}, domains, "low", 0.7, reason)

    # Knowledge / definitions
    if any(p in msg for p in ["what is", "what's a", "whats a", "define", "explain",
                              "meaning of", "difference between"]) and not needs_store:
        return Understanding("knowledge", "learn a concept", False, False, False,
                             MODE_DIRECT_ANSWER, {}, domains, "low", 0.8, reason)

    # General strategy
    if any(p in msg for p in ["how do i", "how can i", "how to", "tips for", "best way",
                              "should i", "strategy for", "ways to"]) and not needs_store:
        return Understanding("strategy", "get ecommerce guidance", False, False, False,
                             MODE_EXPLANATION, {}, domains, "low", 0.8, reason)

    # Store-specific business question
    if needs_store:
        diag = any(p in msg for p in ["why", "dropped", "fell", "down", "wrong", "issue", "problem"])
        return Understanding(
            "diagnosis" if diag else "metrics",
            "understand store performance", True, False, False,
            MODE_ANALYSIS if diag else MODE_DIRECT_ANSWER,
            {}, domains or ["revenue"], "medium", 0.75, reason,
        )

    # Everything else is conversation. This is the safe default.
    return Understanding("casual", "conversation", False, False, False,
                         MODE_CONVERSATIONAL, {}, domains, "low", 0.6, reason)


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
