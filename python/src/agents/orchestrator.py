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
import time
import uuid
from dataclasses import dataclass, field

from sqlalchemy import text

from .base_agent import AgentResult
from .revenue_agent import RevenueAgent
from .retention_agent import RetentionAgent
from .customer_agent import CustomerAgent
from .marketing_agent import MarketingAgent
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

_AGENTS = {
    "revenue":   RevenueAgent(),
    "retention": RetentionAgent(),
    "customer":  CustomerAgent(),
    "marketing": MarketingAgent(),
}

_DOMAIN_TO_AGENTS = {
    "revenue":   ["revenue"],
    "carts":     ["retention"],
    "checkout":  ["revenue", "retention"],
    "customers": ["customer", "retention"],
    "marketing": ["marketing"],
    "products":  ["revenue"],
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
    intent:                     str | None = None
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
            "intent":                     self.intent,
            "warnings":                   self.warnings,
            "correlation_id":             self.correlation_id,
            "latency_ms":                 self.latency_ms,
        }


def orchestrate(organization_id: str, user_id: str, message: str,
                conversation_id: str | None, db,
                image_base64: str | None = None,
                image_media_type: str | None = None) -> OrchestrationResult:
    correlation_id = str(uuid.uuid4())
    start = time.time()
    try:
        result = _run(organization_id, user_id, message, conversation_id, db, correlation_id,
                     image_base64=image_base64, image_media_type=image_media_type)
    except Exception as e:
        import traceback
        print(f"ORCHESTRATE_FATAL {type(e).__name__}: {e}")
        print(traceback.format_exc())
        logger.error("orchestrate_fatal", extra={"correlation_id": correlation_id, "error": str(e)})
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
         image_base64=None, image_media_type=None):
    message = message.strip()[:MAX_MESSAGE_CHARS]
    if not message:
        raise ValueError("Empty message")

    # ── 1. Conversation context ───────────────────────────────────────────────
    conv_id, is_new = _get_or_create_conversation(organization_id, user_id, conversation_id, db)
    history      = _load_history(conv_id, db, MAX_HISTORY_TURNS)
    history_text = _format_history(history)
    memories     = _load_memories(organization_id, db)

    # ── 2. UNDERSTAND (before anything else) ──────────────────────────────────
    u = understand(message, history, image_base64=image_base64)
    print(f"UNDERSTANDING intent={u.intent} store={u.requires_store_data} "
          f"web={u.requires_web} mode={u.response_mode} conf={u.confidence}")

    def finish(rtype: str, text_out: str, agents_used: list[str] | None = None) -> OrchestrationResult:
        """Persist both turns, update the conversation, then return the result."""
        _update_conversation(conv_id, db, title_hint=message if is_new else None)
        _persist_messages(conv_id, user_id, message, text_out, rtype,
                          agents_used=agents_used, db=db)
        return OrchestrationResult(
            success=True, conversation_id=conv_id, message_id=str(uuid.uuid4()),
            response_type=rtype, text=text_out, intent=u.intent,
            agents_used=agents_used or [],
            correlation_id=correlation_id,
        )

    # ── 3. Preference statement: write memory, acknowledge ────────────────────
    if u.intent == "preference" and u.entities:
        saved = _save_preference(organization_id, user_id, u.entities, db)
        if saved:
            return finish("chat", "Noted. I'll keep that in mind.")

    # ── 4. Capability ─────────────────────────────────────────────────────────
    if u.intent == "capability":
        has_store = _has_store(organization_id, db)
        return finish("capability", responder.compose_capability(has_store))

    # ── 5. Anything that does NOT need store data ─────────────────────────────
    if not u.requires_store_data:
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
        except Exception as e:
            print(f"BUILD_STATE_ERROR {type(e).__name__}: {e}")
            has_store = False

    # No store: give real guidance, one closing line about connecting
    if not has_store:
        return finish("clarification",
                      responder.compose_needs_store(message, u, history_text))

    state_age = business_state.age_minutes()
    state_id  = business_state.id

    # ── 7. Select only the agents the domains call for ────────────────────────
    selected = _select_agents(u, history)
    agent_results: list[AgentResult] = []
    for name in selected:
        agent = _AGENTS.get(name)
        if not agent:
            continue
        try:
            agent_results.append(agent.analyze(business_state, memories, message))
        except Exception as e:
            print(f"AGENT_ERROR {name}: {type(e).__name__}: {e}")

    hard = [m for m in memories if m.get("authority_level", 0) >= 5]
    if hard:
        agent_results = _apply_constraints(agent_results, hard)

    warnings: list[str] = []
    if business_state.is_stale():
        warnings.append(f"Store data is {state_age:.0f} minutes old.")

    # ── 8. Short factual answer does not need the full card ───────────────────
    if u.response_mode == MODE_DIRECT_ANSWER:
        text_out = responder.compose_knowledge(
            message, u, history_text + "\n\nSTORE DATA:\n" + _state_json(business_state),
            memories, True,
        )
        _update_conversation(conv_id, db, title_hint=message if is_new else None)
        _persist_messages(conv_id, user_id, message, text_out, "knowledge",
                          agents_used=selected, db=db)
        return OrchestrationResult(
            success=True, conversation_id=conv_id, message_id=str(uuid.uuid4()),
            response_type="knowledge", text=text_out, intent=u.intent,
            agents_used=selected, business_state_age_minutes=state_age,
            business_state_id=state_id, warnings=warnings, correlation_id=correlation_id,
        )

    # ── 9. Full analysis ──────────────────────────────────────────────────────
    resp = responder.compose_analysis(
        message, u,
        _state_json(business_state),
        _agent_json(agent_results),
        _constraints_json(memories),
        history_text,
    )
    # Persist both turns so this analysis is in history for the next message
    analysis_text = resp.get("situation", "")  # representative text for history
    _update_conversation(conv_id, db, title_hint=message if is_new else None)
    _persist_messages(conv_id, user_id, message, analysis_text, "analysis",
                      agents_used=selected, db=db)
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
        agents_used=selected,
        business_state_age_minutes=state_age,
        business_state_id=state_id,
        intent=u.intent,
        warnings=warnings,
        correlation_id=correlation_id,
    )


# ── Helpers ───────────────────────────────────────────────────────────────────

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


def _select_agents(u, history) -> list[str]:
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


def _agent_json(results: list[AgentResult]) -> str:
    out = []
    for r in results:
        if r.status == "error":
            continue
        out.append({
            "agent": r.agent, "status": r.status, "confidence": r.confidence,
            "facts": r.facts[:5], "signals": r.signals[:5],
            "recommendations": r.recommendations[:3], "warnings": r.warnings,
        })
    return json.dumps(out, default=str) if out else "No agent findings."


def _constraints_json(memories: list[dict]) -> str:
    c = [{"key": m["memory_key"], "value": m["memory_value"]}
         for m in memories
         if m.get("authority_level", 0) >= 4 and m.get("is_active")]
    return json.dumps(c, default=str) if c else "None."


def _apply_constraints(results, constraints):
    max_discount, never = None, False
    for c in constraints:
        k, v = c.get("memory_key"), c.get("memory_value")
        if isinstance(v, dict):
            v = v.get("value")
        if k == "max_discount_pct" and v is not None:
            try:
                max_discount = float(v)
            except Exception:
                pass
        if k == "never_recommend_discounts" and v:
            never = True
    for r in results:
        for rec in r.recommendations:
            p = rec.get("params", {})
            if never:
                p["max_discount_pct"] = 0
                p["use_discount"] = False
            elif max_discount is not None and p.get("max_discount_pct", 0) > max_discount:
                p["max_discount_pct"] = max_discount
    return results


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
    except Exception as e:
        print(f"SAVE_PREFERENCE_ERROR {type(e).__name__}: {e}")
        try:
            db.rollback()
        except Exception:
            pass
        return False


# ── Database ──────────────────────────────────────────────────────────────────

def _persist_messages(
    conv_id: str,
    user_id: str,
    merchant_message: str,
    rev_reply: str,
    reply_type: str,
    agents_used: list[str] | None,
    db,
) -> None:
    """
    Writes both the merchant's message and Rev's reply to conversation_messages.

    This is the function that makes conversation history work. Without it,
    _load_history always returns an empty list and Rev has no memory of
    prior turns in the same session.

    Uses a sequence_number derived from the current message_count so rows
    are always ordered correctly even if two messages arrive in quick
    succession.
    """
    try:
        # Fetch current count to derive sequence numbers for this pair
        row = db.execute(
            text("SELECT message_count FROM conversations WHERE id = :c"),
            {"c": conv_id},
        ).fetchone()
        base_seq = int(row[0]) if row else 0

        agent_label = ",".join(agents_used) if agents_used else None

        db.execute(text("""
            INSERT INTO conversation_messages
                (id, conversation_id, role, content, message_type, sequence_number, created_at)
            VALUES
                (:id1, :c, 'user',  CAST(:m AS jsonb), 'text', :seq1, NOW()),
                (:id2, :c, 'rev',   CAST(:r AS jsonb), :rtype, :seq2, NOW())
        """), {
            "id1":   str(uuid.uuid4()),
            "id2":   str(uuid.uuid4()),
            "c":     conv_id,
            "m":     json.dumps({"text": merchant_message}),
            "r":     json.dumps({"text": rev_reply, "agent_name": agent_label}),
            "rtype": reply_type,
            "seq1":  base_seq + 1,
            "seq2":  base_seq + 2,
        })
        db.commit()
    except Exception as e:
        # Non-fatal: a persistence failure must never break the response
        print(f"PERSIST_MESSAGES_ERROR {type(e).__name__}: {e}")
        try:
            db.rollback()
        except Exception:
            pass

def _get_or_create_conversation(org_id, user_id, conv_id, db):
    if conv_id:
        row = db.execute(
            text("SELECT id FROM conversations WHERE id = :i AND organization_id = :o"),
            {"i": conv_id, "o": org_id},
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


def _update_conversation(conv_id, db, title_hint=None):
    try:
        if title_hint:
            t = title_hint[:80] + ("..." if len(title_hint) > 80 else "")
            db.execute(text("""
                UPDATE conversations SET last_activity_at = NOW(),
                message_count = message_count + 2,
                title = COALESCE(title, :t), updated_at = NOW() WHERE id = :i
            """), {"i": conv_id, "t": t})
        else:
            db.execute(text("""
                UPDATE conversations SET last_activity_at = NOW(),
                message_count = message_count + 2, updated_at = NOW() WHERE id = :i
            """), {"i": conv_id})
        db.commit()
    except Exception as e:
        print(f"UPDATE_CONV_ERROR {type(e).__name__}: {e}")


def _load_memories(org_id, db) -> list[dict]:
    try:
        rows = db.execute(text("""
            SELECT memory_key, memory_value, memory_source, authority_level,
                   confidence, importance, is_active, memory_type
            FROM merchant_memories
            WHERE organization_id = :o AND is_active = TRUE
              AND (expires_at IS NULL OR expires_at > NOW())
            ORDER BY authority_level DESC, importance DESC
        """), {"o": org_id}).fetchall()
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
    except Exception as e:
        print(f"LOAD_MEMORIES_ERROR {type(e).__name__}: {e}")
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
    except Exception as e:
        print(f"LOAD_HISTORY_ERROR {type(e).__name__}: {e}")
        return []
