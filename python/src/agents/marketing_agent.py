"""
Rev Intelligence — Marketing Agent
Responsible for: campaign performance, channel effectiveness, recovery messaging.
Does NOT blindly recommend discounts. Checks merchant constraints first.
"""

from __future__ import annotations
import logging
from .base_agent import BaseAgent, AgentResult

logger = logging.getLogger("rev.agent.marketing")


class MarketingAgent(BaseAgent):

    @property
    def name(self) -> str:
        return "marketing"

    def analyze(self, business_state, memories: list[dict], question: str) -> AgentResult:
        try:
            return self._analyze(business_state, memories, question)
        except Exception as e:
            logger.error("marketing_agent_failed", extra={"error": str(e)})
            return AgentResult.error("marketing", str(e))

    def _analyze(self, bs, memories: list[dict], question: str) -> AgentResult:
        facts = []
        signals = []
        diagnosis = []
        opportunities = []
        recommendations = []
        warnings = list(bs.warnings)

        # Merchant constraints — checked BEFORE any recommendation
        max_discount = _get_memory(memories, "max_discount_pct", 15)
        preferred_channel = _get_memory(memories, "preferred_channel", "email")
        never_discount = _get_memory(memories, "never_recommend_discounts", False)
        peak_season = _get_memory(memories, "peak_season_months", None)

        # ── Facts from BusinessState 
        marketing_opps = [o for o in bs.opportunities if o.get("category") in ("cart_recovery", "retention", "marketing")]

        if bs.abandoned_cart_count is not None:
            facts.append({
                "type": "fact",
                "metric": "recoverable_carts",
                "value": bs.abandoned_cart_count,
                "description": f"{bs.abandoned_cart_count} carts abandoned in last 48 hours worth ${float(bs.abandoned_cart_value or 0):,.2f}",
                "source": "abandoned_carts",
            })

        if marketing_opps:
            facts.append({
                "type": "fact",
                "metric": "active_opportunities",
                "value": len(marketing_opps),
                "description": f"{len(marketing_opps)} marketing opportunities identified in current business state",
                "source": "business_states.opportunities",
            })

        # ── Signals 
        if bs.cart_anomaly:
            signals.append({
                "type": "signal",
                "metric": "cart_abandonment_spike",
                "description": "Cart abandonment rate above 30-day average — recovery campaign urgently needed",
                "severity": "high",
            })

        if bs.churn_risk_count and bs.churn_risk_count > 10:
            signals.append({
                "type": "signal",
                "metric": "churn_pressure",
                "description": f"{bs.churn_risk_count} customers at churn risk — retention campaign recommended",
                "severity": "medium",
            })

        # ── Diagnosis 
        if bs.cart_anomaly and bs.revenue_delta_pct is not None and bs.revenue_delta_pct < -10:
            diagnosis.append({
                "type": "inference",
                "description": "Revenue decline combined with abandonment spike suggests a marketing or checkout experience breakdown, "
                               "not just demand softness. Investigate: recent email send deliverability, checkout page changes, pricing.",
                "confidence": 0.64,
            })

        # ── Recommendations — always check merchant constraints first ─────────
        if bs.abandoned_cart_count and bs.abandoned_cart_count > 0:
            if never_discount:
                rec_description = (
                    f"Launch a no-discount cart recovery sequence via {preferred_channel}. "
                    f"Focus on urgency (items still in stock), social proof, and value messaging. "
                    f"Discount suppressed per your business constraints."
                )
                discount_note = "No discount — merchant constraint applied"
            else:
                rec_description = (
                    f"Launch cart recovery sequence via {preferred_channel} for {bs.abandoned_cart_count} abandoned carts. "
                    f"Segment: failed-payment carts get 1-click recovery link (no discount needed). "
                    f"Price-sensitive carts: offer up to {max_discount}% off."
                )
                discount_note = f"Max discount: {max_discount}% (merchant constraint)"

            recommendations.append({
                "action": "cart_recovery_campaign",
                "description": rec_description,
                "constraint_note": discount_note,
                "predicted_impact": f"Estimated 20-28% recovery on ${float(bs.abandoned_cart_value or 0):,.2f}",
                "confidence": 0.80,
                "category": "cart_recovery",
                "params": {
                    "channel": preferred_channel,
                    "max_discount_pct": 0 if never_discount else max_discount,
                },
            })

        if bs.churn_risk_count and bs.churn_risk_count > 5:
            if never_discount:
                win_back_desc = (
                    f"Re-engagement campaign for {bs.churn_risk_count} at-risk customers via {preferred_channel}. "
                    f"Use product recommendations and value messaging. No discount per your constraints."
                )
            else:
                win_back_desc = (
                    f"Win-back sequence for {bs.churn_risk_count} at-risk customers via {preferred_channel}. "
                    f"Touch 1: value/product reminder (no discount). Touch 2: social proof. "
                    f"Touch 3 only if unresponsive: up to {max_discount}% off, 48h expiry."
                )

            recommendations.append({
                "action": "win_back_campaign",
                "description": win_back_desc,
                "predicted_impact": "Estimated 15-25% win-back rate",
                "confidence": 0.68,
                "category": "retention",
                "params": {
                    "channel": preferred_channel,
                    "max_discount_pct": 0 if never_discount else max_discount,
                },
            })

        # Add peak season context if relevant
        if peak_season:
            signals.append({
                "type": "signal",
                "metric": "seasonal_context",
                "description": f"Merchant peak season: {peak_season}. Factor this into campaign timing.",
                "severity": "context",
            })

        confidence = _compute_confidence(facts, signals, warnings)

        return AgentResult(
            agent="marketing",
            status="success" if facts or recommendations else "no_data",
            confidence=confidence,
            facts=facts,
            signals=signals,
            diagnosis=diagnosis,
            opportunities=opportunities,
            recommendations=recommendations,
            data_sources=["abandoned_carts", "customers", "business_states", "merchant_memories"],
            warnings=warnings,
        )


def _get_memory(memories: list[dict], key: str, default):
    for m in memories:
        if m.get("memory_key") == key and m.get("is_active"):
            val = m.get("memory_value")
            return val.get("value", default) if isinstance(val, dict) else (val or default)
    return default


def _compute_confidence(facts, signals, warnings) -> float:
    base = 0.5
    if facts: base += 0.2
    if signals: base += 0.15
    if warnings: base -= 0.1 * min(len(warnings), 3)
    return round(max(0.1, min(0.95, base)), 2)