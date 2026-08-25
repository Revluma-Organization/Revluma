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
    "You are Rev, the autonomous ecommerce intelligence inside Revluma. "
    "You are not a chatbot. You are an operational intelligence that knows "
    "an ecommerce founder's business better than they do. "
    "You have the analytical precision of a data scientist, the commercial judgment "
    "of a COO, and the memory of an institutional historian. "
    "You are direct, concise, ecommerce-native, and never generic. "
    "If your response could be given to any merchant anywhere, it has failed. "
    "You never pad. You never use corporate filler. You never use em dashes. "
    "You never say 'Happy to help' or 'Great question'. "
    "You never claim numbers you were not given. "
    "You never end a substantive response without a clear next step or action. "
    "You say 'I recommend' not 'you might consider'. "
    "You take ownership of your analysis."
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
                           memories: list[dict], has_store: bool,
                           image_base64: str | None = None,
                           image_media_type: str | None = None) -> str:
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
        + "Reply naturally in 1 to 3 short sentences. Match their energy.\n"
        + "If they made small talk, respond and briefly open the door to work.\n"
        + "If they asked who you are, explain Rev clearly and invite them to share what they are working on.\n"
        + "Do NOT mention store connection unless they asked about store-specific analysis.\n"
        + "Do NOT give business analysis for conversational messages.\n"
        + "Do NOT list features robotically.\n"
        + "Sound like an intelligent person who knows ecommerce deeply, not a product demo.\n"
        + "No em dashes. No corporate language. No 'Happy to help'."
    )
    try:
        if image_base64 and image_media_type:
            import anthropic as _anth, os as _os
            _client = _anth.Anthropic(api_key=_os.environ.get("ANTHROPIC_API_KEY"), timeout=10.0)
            _resp = _client.messages.create(
                model=FAST_MODEL, max_tokens=300,
                messages=[{"role": "user", "content": [
                    {"type": "image", "source": {
                        "type": "base64",
                        "media_type": image_media_type,
                        "data": image_base64,
                    }},
                    {"type": "text", "text": (
                        prompt + "\n\nThe merchant has also uploaded an image. "
                        "Look at it carefully and incorporate what you see into your response. "
                        "Describe what is relevant in the image as it relates to their message."
                    )},
                ]}]
            )
            return sanitise("".join(b.text for b in _resp.content if getattr(b, "type", "") == "text").strip())
        return sanitise(_call(FAST_MODEL, prompt, 300, 10.0))
    except Exception as e:
        print(f"RESPONDER_CONVERSATIONAL_ERROR {type(e).__name__}: {e}")
        return _static_conversational(message, understanding)


def _static_conversational(message: str, understanding) -> str:
    msg = message.lower().strip().rstrip("?!.,")
    if understanding.intent == "identity":
        return ("I'm Rev, Revluma's ecommerce intelligence. I monitor your store, "
                "surface what matters before you ask, and help you understand what is "
                "happening and what to do about it. What are you working on?")
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
                      memories: list[dict], has_store: bool,
                      image_base64: str | None = None,
                      image_media_type: str | None = None) -> str:
    """
    Answer any ecommerce question — Shopify, WooCommerce, BigCommerce, DTC,
    cart abandonment, checkout, conversion, retention, churn, LTV, CAC, ROAS,
    email, SMS, WhatsApp, campaigns, pricing, discounts, segmentation,
    product performance, acquisition, TikTok Shop, Amazon, Etsy, dropshipping,
    merchandising, promotions, funnels, attribution, AOV, repeat purchase,
    customer journey, inventory, margin, ecommerce ops — anything.

    No store connection needed. Claude already knows all of this deeply.
    """
    constraint_block = ""
    hard = [m for m in memories if m.get("authority_level", 0) >= 4 and m.get("is_active")]
    if hard:
        pairs = ", ".join(f"{m['memory_key']}={m['memory_value']}" for m in hard)
        constraint_block = f"\nMerchant constraints to respect: {pairs}\n"

    is_definition = understanding.response_mode == "direct_answer"

    depth = (
        "Answer concisely and accurately in 1 to 4 sentences. Be precise and specific."
        if is_definition else
        "Give a thorough, expert answer. Be specific and practical. "
        "Use your full knowledge of ecommerce, Shopify, WooCommerce, and the "
        "broader ecosystem. Cover what actually matters. Do not pad."
    )

    store_hint = ""
    if not has_store and understanding.intent in ("strategy", "recommendation"):
        store_hint = (
            "\nIf mentioning that their specific store data would sharpen the answer, "
            "do so in ONE closing sentence only. Never lead with it."
        )

    prompt = (
        PERSONA
        + "\n\nYou are one of the most knowledgeable ecommerce experts on the planet. "
        + "You have complete mastery of:\n"
        + "- Shopify: admin, analytics, checkout, payment, themes, apps, Shopify Plus, "
        + "  Markets, B2B, Flow, Functions, Hydrogen, Storefront API, Liquid\n"
        + "- WooCommerce, BigCommerce, Magento, PrestaShop, Squarespace Commerce\n"
        + "- DTC strategy, brand building, retention economics\n"
        + "- Cart abandonment: psychology, signals, recovery timing, channel selection\n"
        + "- Checkout optimisation: friction, trust, mobile, payment methods\n"
        + "- Conversion rate optimisation: product pages, PDP, PLP, UX, A/B testing\n"
        + "- Customer retention, churn, repeat purchase, LTV, cohort analysis, RFM\n"
        + "- Email marketing: flows, broadcasts, deliverability, segmentation, copy\n"
        + "- SMS marketing: compliance, timing, recovery, TCPA, GDPR\n"
        + "- WhatsApp Commerce: Business API, catalogues, order messaging\n"
        + "- Performance marketing: Meta, Google, TikTok, attribution, ROAS, CAC\n"
        + "- Customer segmentation, CLV modelling, predictive analytics\n"
        + "- Pricing strategy, promotions, discounting, bundles, upsells, cross-sells\n"
        + "- Supply chain, inventory management, dropshipping, 3PL, fulfilment\n"
        + "- Ecommerce metrics: AOV, CVR, RPV, CAC, LTV, NPS, churn rate, ARPU\n"
        + "- Marketplace selling: Amazon, Etsy, eBay, TikTok Shop, Walmart\n"
        + "- Ecommerce law: consumer rights, returns, VAT, sales tax, customs\n"
        + "- Product strategy, merchandising, catalogue management, seasonal planning\n"
        + "- Ecommerce operations, team structure, tools, integrations, workflows\n"
        + constraint_block
        + "\nCONVERSATION CONTEXT:\n"
        + (history_text if history_text else "(first message)")
        + f"\n\nQUESTION:\n{message[:800]}\n\n"
        + f"Goal: {understanding.goal}\n\n"
        + depth
        + store_hint
        + "\n\nFORMATTING — follow these rules exactly:\n"
        + "- Use ## for section headings when the answer has multiple distinct sections\n"
        + "- Use **bold** to emphasise key terms, numbers, and important points\n"
        + "- Use numbered lists (1. 2. 3.) for sequential steps or ranked priorities\n"
        + "- Use bullet points (- item) for non-sequential lists\n"
        + "- Use > blockquote for important callouts or warnings\n"
        + "- Short paragraphs between lists to add context\n"
        + "- No em dashes. No filler phrases. No 'certainly' or 'absolutely'.\n"
        + "- Sound like the sharpest ecommerce operator the merchant has spoken to.\n"
        + "- After the answer, ask ONE follow-up question to continue the conversation "
        + "or invite them to go deeper. Keep it natural."
    )

    # Use sonnet for knowledge — haiku is too shallow for deep ecom expertise
    try:
        import anthropic as _anth2, os as _os2
        _client2 = _anth2.Anthropic(api_key=_os2.environ.get("ANTHROPIC_API_KEY"), timeout=18.0)
        if image_base64 and image_media_type:
            _content = [
                {"type": "image", "source": {
                    "type": "base64",
                    "media_type": image_media_type,
                    "data": image_base64,
                }},
                {"type": "text", "text": (
                    prompt + "\n\nThe merchant has also shared an image. "
                    "Analyse it carefully and incorporate your observations into your answer. "
                    "If the image shows analytics, a store, a product, a chart, or anything "
                    "ecommerce-related, reference what you see specifically."
                )},
            ]
        else:
            _content = prompt
        _resp2 = _client2.messages.create(
            model=DEEP_MODEL, max_tokens=1200,
            messages=[{"role": "user", "content": _content}]
        )
        return sanitise("".join(b.text for b in _resp2.content if getattr(b, "type", "") == "text").strip())
    except Exception as e:
        print(f"RESPONDER_KNOWLEDGE_SONNET_ERROR {type(e).__name__}: {e}")
        try:
            return sanitise(_call(FAST_MODEL, prompt, 700, 12.0))
        except Exception as e2:
            print(f"RESPONDER_KNOWLEDGE_HAIKU_ERROR {type(e2).__name__}: {e2}")
            return _static_knowledge(message, understanding)


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


def _static_knowledge(message: str, understanding) -> str:
    """Deterministic ecommerce knowledge fallback when LLM is unavailable."""
    msg = message.lower()

    # Identity questions
    if understanding.intent == "identity":
        return ("I'm Rev, Revluma's ecommerce intelligence layer. I monitor your store "
                "continuously, surface what matters before you think to look for it, and "
                "help you understand exactly what is happening and what to do next. "
                "I work with your connected Shopify or WooCommerce data for store-specific "
                "analysis, and I can also help with ecommerce strategy, cart recovery, "
                "conversion, retention, and marketing without a connected store. "
                "What are you working on?")

    # Cart abandonment
    if any(k in msg for k in ["cart abandon", "abandon cart", "cart recovery", "recover cart"]):
        return ("The biggest causes of cart abandonment are unexpected shipping costs "
                "at checkout, forced account creation, slow or confusing checkout, weak "
                "trust signals, and poor mobile experience. Start by auditing your checkout "
                "on a phone. Then check where your analytics show the biggest drop-off. "
                "Timed recovery messages with a clear value proposition outperform discount-first "
                "approaches for most store types. If your store is connected I can show you "
                "exactly where your carts are dropping off.")

    # Conversion rate
    if any(k in msg for k in ["conversion", "convert", "checkout rate"]):
        return ("Conversion rate problems almost always come from one of four places: "
                "checkout friction, price/value mismatch, trust gap, or traffic quality. "
                "Check your mobile checkout completion rate first since that is where most "
                "stores leak. Then look at your product page bounce rate. Fixing friction "
                "before adding traffic is almost always the higher-ROI move.")

    # AOV
    if any(k in msg for k in ["aov", "average order", "order value"]):
        return ("AOV is average order value: total revenue divided by number of orders. "
                "To increase it: bundle complementary products, set free shipping thresholds "
                "just above your current AOV, offer volume discounts, and surface upsells "
                "at checkout rather than on product pages. For most DTC stores, threshold-based "
                "free shipping is the fastest AOV lever.")

    # LTV / lifetime value
    if any(k in msg for k in ["ltv", "lifetime value", "customer value"]):
        return ("LTV is the total revenue a customer generates over their relationship with your store. "
                "The biggest drivers are repeat purchase rate, purchase frequency, and AOV. "
                "Improving retention by even 5% typically increases LTV by 25 to 95 percent "
                "depending on your margin structure. Post-purchase experience is usually "
                "the highest-leverage LTV intervention.")

    # Retention / churn
    if any(k in msg for k in ["retention", "churn", "repeat", "returning"]):
        return ("Retention breaks down in the post-purchase window. The follow-up is usually "
                "too late, too generic, or gives no reason to return. Start with: a strong "
                "day-3 follow-up, a day-14 re-engagement, and a win-back sequence at day-45. "
                "Non-discount retention outperforms discount retention for high-LTV customers "
                "because it does not train them to wait for deals.")

    # WhatsApp / email / SMS
    if any(k in msg for k in ["whatsapp", "email", "sms", "channel"]):
        return ("WhatsApp outperforms email for recovery messages in markets where it is the "
                "primary communication app, typically 3 to 5x higher open rates. Email is "
                "better for relationship-building sequences. SMS is effective for time-sensitive "
                "messages. The best approach is to match the channel to where your customers "
                "already communicate, not where it is cheapest to send.")

    # Discount
    if any(k in msg for k in ["discount", "offer", "promo"]):
        return ("Discounts are a short-term lever with long-term costs if overused. "
                "They work best when used sparingly for high-risk churn customers, never as "
                "the first recovery touch. Test non-discount recovery first: urgency messaging, "
                "social proof, and removing checkout friction. Reserve discounts for customers "
                "where the data shows price sensitivity is the actual barrier.")

    # General ecommerce
    return ("That is a good ecommerce question. The answer depends on your specific "
            "store setup, customer base, and what the data shows. Connect your store "
            "and I can give you a specific answer rather than a general one.")



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


def compose_web_research(message: str, understanding, history_text: str,
                         memories: list[dict]) -> str:
    """
    Use Anthropic web_search tool to answer questions needing current information.
    Clearly distinguishes external research from store data.
    """
    import anthropic, os

    try:
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            raise RuntimeError("no key")

        constraint_block = ""
        hard = [m for m in memories if m.get("authority_level", 0) >= 4 and m.get("is_active")]
        if hard:
            pairs = ", ".join(f"{m['memory_key']}={m['memory_value']}" for m in hard)
            constraint_block = f"Merchant constraints: {pairs}\n"

        prompt = (
            PERSONA
            + "\n\nYou have access to the web_search tool. Use it to find current, "
            + "accurate information when the question requires recent or external data.\n"
            + constraint_block
            + "\nCONVERSATION SO FAR:\n"
            + (history_text if history_text else "(first message)")
            + f"\n\nMERCHANT ASKED:\n{message[:500]}\n\n"
            + "Search for current information to answer this well. "
            + "After searching, give a clear, concise answer. "
            + "Use ## headings for distinct sections when the answer covers multiple topics. "
            + "Use numbered lists or bullets where listing multiple items. "
            + "If you found relevant images or diagrams from sources, include them as markdown: ![description](url). "
            + "If you cite external sources, add them as [Source Name](url) inline. "
            + "Distinguish external research from your own expertise. "
            + "No em dashes. No corporate filler. Be direct and useful. "
            + "End with one follow-up question to continue the conversation."
        )

        client = anthropic.Anthropic(api_key=api_key, timeout=20.0)
        resp = client.messages.create(
            model=FAST_MODEL,
            max_tokens=900,
            tools=[{"type": "web_search_20250305", "name": "web_search"}],
            messages=[{"role": "user", "content": prompt}],
        )

        # Extract text from response (may include tool_use blocks)
        text = "".join(
            b.text for b in resp.content
            if getattr(b, "type", "") == "text"
        ).strip()

        if text:
            return sanitise(text)

        # If model used tool but no text yet, do agentic follow-through
        messages = [{"role": "user", "content": prompt}]
        messages.append({"role": "assistant", "content": resp.content})
        # Add tool results if present
        tool_results = []
        for block in resp.content:
            if getattr(block, "type", "") == "tool_use":
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": "Search completed.",
                })
        if tool_results:
            messages.append({"role": "user", "content": tool_results})
            resp2 = client.messages.create(
                model=FAST_MODEL,
                max_tokens=900,
                tools=[{"type": "web_search_20250305", "name": "web_search"}],
                messages=messages,
            )
            text2 = "".join(
                b.text for b in resp2.content
                if getattr(b, "type", "") == "text"
            ).strip()
            if text2:
                return sanitise(text2)

        return "I searched for that but could not find a clear answer. Try rephrasing the question."

    except Exception as e:
        print(f"RESPONDER_WEB_RESEARCH_ERROR {type(e).__name__}: {e}")
        # Fall back to knowledge response
        u_mock = type("U", (), {"intent": "knowledge", "goal": understanding.goal,
                                 "response_mode": "explanation", "domains": understanding.domains})()
        return compose_knowledge(message, u_mock, history_text, memories, False)


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
        + '  "situation": "1-2 sentences. What is actually happening, with real numbers. If this is a simple metrics request, just state the number clearly.",\n'
        + '  "insight": "1-2 sentences. Why this matters or what drives it. Skip if the question was purely factual.",\n'
        + '  "implication": "1 sentence. Commercial impact. Only include if genuinely meaningful — do not pad.",\n'
        + '  "recommendation": "1-2 sentences. The single most important next action. Be specific.",\n'
        + '  "confidence": {"score": 0.0, "basis": "one phrase explaining confidence level"},\n'
        + '  "actions": [{"label": "Short verb phrase", "tool": "tool_name_or_null", "params": {}}]\n'
        + "}\n\n"
        + "CRITICAL: Actions must map to real tools: view_carts, view_customers, view_revenue, "
        + "create_campaign, view_analytics, view_products, view_checkout. "
        + "If no real action applies, return empty actions array. Never invent fake actions. "
        + "Two or three maximum."
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
