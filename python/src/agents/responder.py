"""
Rev Intelligence - Response Composer
======================================
Generates the response for a given Understanding. The response_mode from the
understanding layer decides the shape. The 6-part analysis card is one mode
among several, not the default.

Personality: sharp, direct, commercially minded ecommerce operator.
Never corporate. Never "Happy to help with that."
"""

from __future__ import annotations

import json
import logging
import re
import time

logger = logging.getLogger("rev.responder")

FAST_MODEL = "claude-haiku-4-5-20251001"
DEEP_MODEL = "claude-sonnet-4-6"

BANNED = [
    "happy to help", "i'd be happy to", "certainly!", "absolutely!",
    "as an ai", "it's important to note", "based on the information provided",
    "i understand your concern", "let's dive", "great question",
    "here are some actionable insights", "to answer that specifically",
    "i can advise from ecommerce expertise", "there are several factors",
]

PERSONA = (
    "You are Rev, the intelligence layer inside Revluma. "
    "You are an experienced ecommerce operator, not a chatbot. "
    "You are sharp, direct, commercially minded, and conversational. "
    "You think about where money is made and where it leaks. "
    "You never pad. You never use corporate filler. You never say 'Happy to help'. "
    "You never use em dashes. You never claim numbers you were not given."
)


def sanitise(text: str) -> str:
    """Strip em dashes and banned phrases."""
    text = text.replace("\u2014", ",").replace("\u2013", ",")
    text = re.sub(r"\s*,\s*,", ",", text)
    low = text.lower()
    for phrase in BANNED:
        if low.startswith(phrase):
            # Drop the leading filler sentence
            parts = text.split(".", 1)
            if len(parts) == 2 and len(parts[1].strip()) > 10:
                text = parts[1].strip()
                break
    return text.strip()


def _call(model: str, prompt: str, max_tokens: int, timeout: float) -> str:
    import anthropic, os
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not set")
    client = anthropic.Anthropic(api_key=api_key, timeout=timeout)
    t0 = time.time()
    resp = client.messages.create(
        model=model, max_tokens=max_tokens,
        messages=[{"role": "user", "content": prompt}],
    )
    logger.info("llm_call", extra={"model": model, "ms": int((time.time() - t0) * 1000)})
    return "".join(b.text for b in resp.content if getattr(b, "type", "") == "text").strip()


# ── Conversational / identity / capability / feedback ─────────────────────────

def compose_conversational(message: str, understanding, history_text: str,
                           memories: list[dict], has_store: bool) -> str:
    """
    Natural conversation. Never mentions store connection unless the merchant
    raised it. Uses conversation history so replies are contextual, not canned.
    """
    identity_block = ""
    if understanding.intent == "identity":
        identity_block = (
            "\nThe merchant is asking who or what you are. Tell them plainly: "
            "you are Rev, the intelligence layer inside Revluma. You help ecommerce "
            "businesses understand what is happening in their store, find where revenue "
            "is leaking, and decide what to do next. Keep it to 2 or 3 sentences, "
            "then invite them to tell you what they are working on.\n"
        )

    memory_block = ""
    known = [m for m in memories if m.get("is_active")][:5]
    if known:
        pairs = ", ".join(f"{m['memory_key']}={m['memory_value']}" for m in known)
        memory_block = f"\nThings you already know about this merchant: {pairs}\n"

    prompt = (
        PERSONA
        + identity_block
        + memory_block
        + "\n\nCONVERSATION SO FAR:\n"
        + (history_text if history_text else "(first message)")
        + f"\n\nMERCHANT JUST SAID:\n{message[:400]}\n\n"
        + f"Their intent is: {understanding.intent}. Their goal: {understanding.goal}.\n\n"
        + "Reply naturally in 1 to 3 short sentences. Match their energy. "
        + "If they made small talk, make small talk back and then open the door to work. "
        + "Do NOT mention connecting a store. Do NOT give business analysis. "
        + "Do NOT list your features unless they asked. "
        + "Sound like a person, not a product."
    )
    try:
        return sanitise(_call(FAST_MODEL, prompt, 160, 8.0))
    except Exception as e:
        print(f"RESPONDER_CONVERSATIONAL_ERROR {type(e).__name__}: {e}")
        return _static_conversational(message, understanding)


def _static_conversational(message: str, understanding) -> str:
    msg = message.lower().strip().rstrip("?!.,")
    if understanding.intent == "identity":
        return ("I'm Rev, the intelligence layer inside Revluma. I help ecommerce "
                "businesses understand what's happening in their store, find where revenue "
                "is leaking, and decide what to do next. What are you working on?")
    table = {
        "hi": "Hey. What are we working on?",
        "hello": "Hey. What's on your mind?",
        "hey": "Hey. What are we looking at?",
        "how are you": "I'm good. What's going on with the business?",
        "how are you doing": "Good. What are you working on?",
        "how's it going": "Going well. What's on your mind?",
        "hows it going": "Going well. What's on your mind?",
        "nothing much": "Fair enough. Shout when you want to dig into something.",
        "not much": "All good. What do you want to look at?",
        "thanks": "Anytime.",
        "thank you": "Anytime.",
        "ok": "Got it.",
        "okay": "Got it.",
        "bye": "Talk soon.",
    }
    for k, v in table.items():
        if msg.startswith(k):
            return v
    return "What do you want to look at?"


# ── Knowledge / strategy / explanation ────────────────────────────────────────

def compose_knowledge(message: str, understanding, history_text: str,
                      memories: list[dict], has_store: bool) -> str:
    """
    General ecommerce knowledge or strategy. No store data needed.
    Mentions store connection at most once, only if it would genuinely sharpen
    the answer, and only as a closing half-sentence.
    """
    constraint_block = ""
    hard = [m for m in memories if m.get("authority_level", 0) >= 4 and m.get("is_active")]
    if hard:
        pairs = ", ".join(f"{m['memory_key']}={m['memory_value']}" for m in hard)
        constraint_block = (
            f"\nMerchant constraints you must respect in any advice: {pairs}\n"
        )

    depth = ("Answer in 1 to 3 sentences. Be precise."
             if understanding.response_mode == "direct_answer"
             else "Give 3 to 5 concrete points. Lead with the ones that move money most. "
                  "Be specific enough to act on. No generic filler.")

    store_hint = ""
    if not has_store and understanding.intent == "strategy":
        store_hint = ("\nYou may add ONE short closing line noting that with their store "
                      "connected you could point at which of these is actually costing them. "
                      "Only one line. Do not lead with it. Do not repeat it.")

    prompt = (
        PERSONA
        + "\nYou have deep expertise in Shopify, WooCommerce, cart recovery, checkout "
        + "optimisation, conversion, retention, churn, LTV, segmentation, lifecycle "
        + "marketing, email, SMS and WhatsApp commerce.\n"
        + constraint_block
        + "\nCONVERSATION SO FAR:\n"
        + (history_text if history_text else "(first message)")
        + f"\n\nMERCHANT ASKED:\n{message[:500]}\n\n"
        + f"Their goal: {understanding.goal}\n\n"
        + depth
        + store_hint
        + "\nUse markdown sparingly: bold for key terms, short bullets if listing. "
        + "No headings. No em dashes. No corporate language."
    )
    try:
        return sanitise(_call(FAST_MODEL, prompt, 500, 12.0))
    except Exception as e:
        print(f"RESPONDER_KNOWLEDGE_ERROR {type(e).__name__}: {e}")
        return ("I can't reach the reasoning service right now. "
                "Ask me again in a moment.")


# ── Capability ────────────────────────────────────────────────────────────────

def compose_capability(has_store: bool) -> str:
    if has_store:
        return (
            "I work off your live store data. I can tell you why revenue moved, where "
            "checkout is leaking, which carts are worth recovering, which customers are "
            "about to churn, and how your campaigns are actually performing.\n\n"
            "I can also research current ecommerce and platform changes when that matters, "
            "and I remember your constraints so I don't suggest things you've ruled out.\n\n"
            "What do you want to look at first?"
        )
    return (
        "Two things right now.\n\n"
        "**Ecommerce reasoning.** Cart recovery, checkout friction, conversion, retention, "
        "churn, pricing, lifecycle campaigns. Ask me anything and I'll give you a straight answer.\n\n"
        "**Store intelligence.** Once your Shopify or WooCommerce store is connected, I can "
        "work off your real numbers: why revenue moved, where money is leaking, which carts "
        "and customers are worth chasing.\n\n"
        "What are you working on?"
    )


# ── Clarification ─────────────────────────────────────────────────────────────

def compose_clarification(message: str, understanding, history_text: str) -> str:
    prompt = (
        PERSONA
        + "\n\nCONVERSATION SO FAR:\n"
        + (history_text if history_text else "(first message)")
        + f"\n\nMERCHANT SAID:\n{message[:400]}\n\n"
        + "Their request is ambiguous. Ask ONE short clarifying question, the smallest "
        + "one that unblocks you. Do not list options unless there are exactly two or three "
        + "obvious ones. Do not apologise. One or two sentences maximum."
    )
    try:
        return sanitise(_call(FAST_MODEL, prompt, 120, 8.0))
    except Exception:
        return "Say a bit more about what you're after and I'll dig in."


# ── Store-data-needed but no store ────────────────────────────────────────────

def compose_needs_store(message: str, understanding, history_text: str) -> str:
    """
    ONLY called when requires_store_data is True and no store exists.
    Leads with useful reasoning, closes with one line about connecting.
    """
    prompt = (
        PERSONA
        + "\n\nCONVERSATION SO FAR:\n"
        + (history_text if history_text else "(first message)")
        + f"\n\nMERCHANT ASKED:\n{message[:400]}\n\n"
        + f"Their goal: {understanding.goal}\n"
        + "Their store is not connected, so you do not have their numbers.\n\n"
        + "Do this:\n"
        + "1. Give them the genuinely useful part of the answer from ecommerce expertise. "
        + "Tell them what usually drives this and what to check first. Be specific.\n"
        + "2. Close with ONE short line saying that with their store connected you could "
        + "point at the exact number instead of the general pattern.\n\n"
        + "Never invent their metrics. Never lead with the store connection line. "
        + "Keep the whole reply under 120 words."
    )
    try:
        return sanitise(_call(FAST_MODEL, prompt, 350, 10.0))
    except Exception as e:
        print(f"RESPONDER_NEEDSSTORE_ERROR {type(e).__name__}: {e}")
        return _static_needs_store(understanding)


def _static_needs_store(understanding) -> str:
    d = understanding.domains[0] if understanding.domains else "revenue"
    table = {
        "carts": ("Cart abandonment is usually shipping cost shock at checkout, forced "
                  "account creation, a slow mobile checkout, or weak trust signals. Check "
                  "your checkout on a phone first, then look at where the drop-off spikes. "
                  "With your store connected I could tell you which step is actually losing them."),
        "revenue": ("Revenue moves for three reasons: traffic, conversion, or order value. "
                    "Check traffic first, then checkout conversion, then AOV. Whichever moved "
                    "most is your answer. Connect your store and I can tell you which one it was."),
        "customers": ("Retention usually breaks in the post-purchase window. The follow-up is "
                      "too late, too generic, or gives no reason to come back. Look at your "
                      "second-purchase rate first. With your store connected I could name the "
                      "customers actually at risk."),
        "marketing": ("Campaign performance usually comes down to timing, segment and offer, "
                      "in that order. Test send timing before you touch the discount. "
                      "Connect your store and I can show you what your data says."),
    }
    return table.get(d, table["revenue"])


# ── Analysis (6-part card) ────────────────────────────────────────────────────

def compose_analysis(message: str, understanding, state_json: str, agent_json: str,
                     constraints_json: str, history_text: str) -> dict:
    prompt = (
        PERSONA
        + "\n\nHARD RULES:\n"
        + "1. Every number you state must come from STORE DATA below. Never invent one.\n"
        + "2. If a metric is missing, say what you cannot see rather than guessing.\n"
        + "3. Respect CONSTRAINTS absolutely.\n"
        + "4. Confidence must reflect evidence quality, not be decorative.\n"
        + "5. No em dashes. No filler.\n\n"
        + f"STORE DATA:\n{state_json}\n\n"
        + f"CONSTRAINTS:\n{constraints_json}\n\n"
        + f"AGENT FINDINGS:\n{agent_json}\n\n"
        + "CONVERSATION SO FAR:\n"
        + (history_text if history_text else "(first message)")
        + f"\n\nMERCHANT ASKED:\n{message[:400]}\n"
        + f"Their goal: {understanding.goal}\n\n"
        + "Return ONLY this JSON object:\n"
        + "{\n"
        + '  "situation": "1-2 sentences. What is actually happening, with real numbers.",\n'
        + '  "insight": "1-2 sentences. Why, based on evidence.",\n'
        + '  "implication": "1 sentence. What it costs or gains commercially.",\n'
        + '  "recommendation": "1-2 sentences. The single highest-value next action.",\n'
        + '  "confidence": {"score": 0.0, "basis": "why this level"},\n'
        + '  "actions": [{"label": "Short verb phrase", "tool": null, "params": {}}]\n'
        + "}\n\n"
        + "Actions must relate directly to what you just said. Two or three maximum."
    )
    for attempt in range(2):
        try:
            raw = _call(DEEP_MODEL, prompt, 700, 14.0)
            parsed = _parse_analysis(raw)
            if parsed:
                for f in ("situation", "insight", "implication", "recommendation"):
                    if isinstance(parsed.get(f), str):
                        parsed[f] = sanitise(parsed[f])
                return parsed
        except Exception as e:
            print(f"RESPONDER_ANALYSIS_ERROR attempt={attempt+1} {type(e).__name__}: {e}")
    return {
        "situation": "I could not complete the analysis.",
        "insight": "The reasoning service did not respond. Nothing was fabricated.",
        "implication": "Your data is unaffected.",
        "recommendation": "Try the question again in a moment.",
        "confidence": {"score": 0.0, "basis": "Service unavailable"},
        "actions": [],
    }


def _parse_analysis(raw: str) -> dict | None:
    try:
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            cleaned = re.sub(r"^```(json)?", "", cleaned).strip()
            cleaned = re.sub(r"```$", "", cleaned).strip()
        b = cleaned.find("{")
        if b > 0:
            cleaned = cleaned[b:]
        e = cleaned.rfind("}")
        if e != -1:
            cleaned = cleaned[:e + 1]
        d = json.loads(cleaned)
        required = {"situation", "insight", "implication", "recommendation", "confidence", "actions"}
        if not isinstance(d, dict) or not required.issubset(d.keys()):
            return None
        if not isinstance(d.get("confidence"), dict):
            d["confidence"] = {"score": 0.7, "basis": ""}
        sc = d["confidence"].get("score", 0.7)
        if not isinstance(sc, (int, float)) or not (0 <= sc <= 1):
            d["confidence"]["score"] = 0.7
        if not isinstance(d.get("actions"), list):
            d["actions"] = []
        for f in ("situation", "insight", "implication", "recommendation"):
            if isinstance(d.get(f), str) and len(d[f]) > 600:
                d[f] = d[f][:600]
        return d
    except Exception:
        return None
