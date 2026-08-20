"""
Rev Intelligence — Retention Agent
Responsible for: churn risk, cart recovery, repeat purchase behaviour, LTV.
Reads from BusinessState. Respects merchant memory constraints.
"""

from __future__ import annotations
import logging
from .base_agent import BaseAgent, AgentResult

logger = logging.getLogger("rev.agent.retention")


class RetentionAgent(BaseAgent):

    @property
    def name(self) -> str:
        return "retention"

    def analyze(self, business_state, memories: list[dict], question: str) -> AgentResult:
        try:
            return self._analyze(business_state, memories, question)
        except Exception as e:
            logger.error("retention_agent_failed", extra={"error": str(e)})
            return AgentResult.error("retention", str(e))

    def _analyze(self, bs, memories: list[dict], question: str) -> AgentResult:
        bs_has_data = any([
            bs.churn_risk_count is not None,
            bs.abandoned_cart_count is not None,
            bs.returning_customer_rate is not None,
        ])
        if not bs_has_data:
            return AgentResult.no_data("retention", "No customer or cart data available.")

        facts = []
        signals = []
        diagnosis = []
        opportunities = list(bs.opportunities)
        recommendations = []
        warnings = list(bs.warnings)
        data_sources = ["customers", "abandoned_carts", "orders", "business_states"]

        max_discount = _get_memory(memories, "max_discount_pct", 15)
        preferred_channel = _get_memory(memories, "preferred_channel", "email")

        # ── Facts 
        if bs.churn_risk_count is not None:
            facts.append({
                "type": "fact",
                "metric": "churn_risk_count",
                "value": bs.churn_risk_count,
                "description": f"{bs.churn_risk_count} customers showing early churn signals (at_risk or hibernating RFM segment)",
                "source": "customers.rfm_segment",
            })

        if bs.vip_inactive_count is not None:
            facts.append({
                "type": "fact",
                "metric": "vip_inactive_count",
                "value": bs.vip_inactive_count,
                "description": f"{bs.vip_inactive_count} VIP customers (champion segment) inactive for 30+ days",
                "source": "customers.rfm_segment + customers.updated_at",
            })

        if bs.returning_customer_rate is not None:
            facts.append({
                "type": "fact",
                "metric": "returning_customer_rate",
                "value": bs.returning_customer_rate,
                "description": f"Returning customer rate: {bs.returning_customer_rate * 100:.1f}%",
                "source": "customers.orders_count",
            })

        if bs.abandoned_cart_count is not None:
            facts.append({
                "type": "fact",
                "metric": "abandoned_carts",
                "value": bs.abandoned_cart_count,
                "description": f"{bs.abandoned_cart_count} carts abandoned in the last 48 hours "
                               f"(${float(bs.abandoned_cart_value or 0):,.2f} total value)",
                "source": "abandoned_carts",
            })

        # ── Signals 
        if bs.returning_customer_rate is not None:
            if bs.returning_customer_rate < 0.20:
                signals.append({
                    "type": "signal",
                    "metric": "low_repeat_purchase",
                    "value": bs.returning_customer_rate,
                    "description": f"Only {bs.returning_customer_rate * 100:.1f}% of customers have made more than one purchase — below healthy benchmark of 25-35%",
                    "severity": "high",
                })
            elif bs.returning_customer_rate > 0.40:
                signals.append({
                    "type": "signal",
                    "metric": "strong_repeat_purchase",
                    "value": bs.returning_customer_rate,
                    "description": f"Strong repeat purchase rate of {bs.returning_customer_rate * 100:.1f}%",
                    "severity": "positive",
                })

        if bs.cart_anomaly:
            signals.append({
                "type": "signal",
                "metric": "cart_abandonment_spike",
                "description": "Cart abandonment rate is significantly above 30-day average",
                "severity": "high",
            })

        if bs.churn_risk_count and bs.churn_risk_count > 20:
            signals.append({
                "type": "signal",
                "metric": "elevated_churn_risk",
                "value": bs.churn_risk_count,
                "description": f"Elevated number of at-risk customers ({bs.churn_risk_count}). Intervention needed.",
                "severity": "high",
            })

        # ── Diagnosis 
        if bs.returning_customer_rate is not None and bs.returning_customer_rate < 0.20:
            diagnosis.append({
                "type": "inference",
                "description": "Low repeat purchase rate suggests post-purchase experience or product-market fit issues. "
                               "Check: post-purchase email sequence, product quality signals, delivery experience.",
                "confidence": 0.62,
                "supporting_signals": ["low_repeat_purchase"],
            })

        if bs.cart_anomaly and bs.churn_risk_count and bs.churn_risk_count > 10:
            diagnosis.append({
                "type": "inference",
                "description": "Simultaneous cart abandonment spike and elevated churn risk suggests "
                               "a customer experience issue — possibly pricing, checkout friction, or competitor activity.",
                "confidence": 0.58,
                "supporting_signals": ["cart_abandonment_spike", "elevated_churn_risk"],
            })

        # ── Recommendations 
        if bs.churn_risk_count and bs.churn_risk_count > 0:
            recommendations.append({
                "action": "launch_winback_sequence",
                "description": f"Send personalised win-back sequence to {bs.churn_risk_count} at-risk customers "
                               f"via {preferred_channel}. Lead with product value, not discount.",
                "predicted_impact": "Estimated 18-28% win-back rate based on segment behaviour",
                "confidence": 0.70,
                "category": "churn_prevention",
                "params": {
                    "segment": "at_risk,hibernating",
                    "channel": preferred_channel,
                    "max_discount_pct": max_discount,
                },
            })

        if bs.vip_inactive_count and bs.vip_inactive_count > 0:
            recommendations.append({
                "action": "vip_reengagement",
                "description": f"Re-engage {bs.vip_inactive_count} VIP customers inactive 30+ days. "
                               f"Use personalised recommendation, no discount — they buy on value.",
                "predicted_impact": "VIPs have 3-4x higher conversion rate on re-engagement vs standard customers",
                "confidence": 0.78,
                "category": "retention",
                "params": {
                    "segment": "champion",
                    "channel": preferred_channel,
                    "use_discount": False,
                },
            })

        if bs.abandoned_cart_count and bs.abandoned_cart_count > 0:
            recommendations.append({
                "action": "cart_recovery",
                "description": f"Recover {bs.abandoned_cart_count} abandoned carts "
                               f"(${float(bs.abandoned_cart_value or 0):,.2f} value). "
                               f"Priority: failed-payment carts first (no discount needed), then price-sensitive carts (max {max_discount}% off).",
                "predicted_impact": f"Estimated 20-28% recovery rate",
                "confidence": 0.82,
                "category": "cart_recovery",
                "params": {
                    "channel": preferred_channel,
                    "max_discount_pct": max_discount,
                },
            })

        confidence = _compute_confidence(facts, signals, warnings)

        return AgentResult(
            agent="retention",
            status="success" if facts else "partial",
            confidence=confidence,
            facts=facts,
            signals=signals,
            diagnosis=diagnosis,
            opportunities=opportunities,
            recommendations=recommendations,
            data_sources=data_sources,
            warnings=warnings,
        )


def _get_memory(memories: list[dict], key: str, default):
    for m in memories:
        if m.get("memory_key") == key and m.get("is_active"):
            val = m.get("memory_value")
            if isinstance(val, dict):
                return val.get("value", default)
            return val or default
    return default


def _compute_confidence(facts, signals, warnings) -> float:
    base = 0.5
    if facts:
        base += 0.2
    if signals:
        base += 0.15
    if warnings:
        base -= 0.1 * min(len(warnings), 3)
    return round(max(0.1, min(0.95, base)), 2)