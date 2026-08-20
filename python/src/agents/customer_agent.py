"""
Rev Intelligence — Customer Agent
Responsible for: segmentation, VIP tracking, at-risk customers, cohort patterns.
CRITICAL: Never passes customer PII (email, full name) to the LLM.
Uses aggregate counts and segment labels only.
"""

from __future__ import annotations
import logging
from .base_agent import BaseAgent, AgentResult

logger = logging.getLogger("rev.agent.customer")


class CustomerAgent(BaseAgent):

    @property
    def name(self) -> str:
        return "customer"

    def analyze(self, business_state, memories: list[dict], question: str) -> AgentResult:
        try:
            return self._analyze(business_state, memories, question)
        except Exception as e:
            logger.error("customer_agent_failed", extra={"error": str(e)})
            return AgentResult.error("customer", str(e))

    def _analyze(self, bs, memories: list[dict], question: str) -> AgentResult:
        has_data = bs.churn_risk_count is not None or bs.returning_customer_rate is not None
        if not has_data:
            return AgentResult.no_data("customer", "No customer segment data available.")

        facts = []
        signals = []
        diagnosis = []
        opportunities = []
        recommendations = []
        warnings = list(bs.warnings)

        # ── Facts — aggregate only, no PII 
        if bs.churn_risk_count is not None:
            facts.append({
                "type": "fact",
                "metric": "at_risk_segment_count",
                "value": bs.churn_risk_count,
                "description": f"{bs.churn_risk_count} customers in at_risk or hibernating segments",
                "source": "customers.rfm_segment — aggregate count only, no individual PII",
            })

        if bs.vip_inactive_count is not None:
            facts.append({
                "type": "fact",
                "metric": "vip_inactive_count",
                "value": bs.vip_inactive_count,
                "description": f"{bs.vip_inactive_count} champion-segment customers inactive 30+ days",
                "source": "customers.rfm_segment — aggregate count only",
            })

        if bs.returning_customer_rate is not None:
            pct = bs.returning_customer_rate * 100
            facts.append({
                "type": "fact",
                "metric": "repeat_purchase_rate",
                "value": pct,
                "description": f"{pct:.1f}% of customers have purchased more than once",
                "source": "customers.orders_count — aggregate rate",
            })

        # ── Signals 
        if bs.returning_customer_rate is not None:
            rate = bs.returning_customer_rate
            if rate < 0.15:
                signals.append({
                    "type": "signal",
                    "metric": "very_low_repeat_purchase",
                    "description": "Repeat purchase rate is critically low. Most customers buy once and don't return.",
                    "severity": "high",
                })
            elif rate > 0.35:
                signals.append({
                    "type": "signal",
                    "metric": "strong_loyalty",
                    "description": "Strong customer loyalty — above-average repeat purchase rate.",
                    "severity": "positive",
                })

        if bs.churn_risk_count and bs.churn_risk_count > 0:
            urgency = "high" if bs.churn_risk_count > 20 else "medium"
            signals.append({
                "type": "signal",
                "metric": "churn_signal",
                "value": bs.churn_risk_count,
                "description": f"{bs.churn_risk_count} customers showing behavioural churn indicators",
                "severity": urgency,
            })

        # ── Diagnosis 
        if bs.returning_customer_rate is not None and bs.returning_customer_rate < 0.20:
            diagnosis.append({
                "type": "inference",
                "description": "Low repeat purchase rate combined with churn risk signals suggests "
                               "the post-purchase experience is not building habit. "
                               "Consider: post-purchase sequence timing, product education, loyalty incentives.",
                "confidence": 0.60,
            })

        # ── Opportunities 
        if bs.vip_inactive_count and bs.vip_inactive_count > 0:
            opportunities.append({
                "category": "vip_retention",
                "description": f"Re-engage {bs.vip_inactive_count} high-value dormant customers",
                "urgency": "high",
                "note": "VIP customers have highest LTV — personalised outreach, no discount needed",
            })

        if bs.churn_risk_count and bs.churn_risk_count > 0:
            opportunities.append({
                "category": "churn_prevention",
                "description": f"Intervene with {bs.churn_risk_count} at-risk customers before they churn",
                "urgency": "medium",
            })

        # ── Recommendations 
        preferred_channel = _get_memory(memories, "preferred_channel", "email")

        if bs.vip_inactive_count and bs.vip_inactive_count > 0:
            recommendations.append({
                "action": "vip_personalised_outreach",
                "description": f"Send a personalised re-engagement message to your {bs.vip_inactive_count} "
                               f"top-tier customers who haven't purchased in 30+ days. "
                               f"Reference their previous purchase category. No discount.",
                "predicted_impact": "VIP re-engagement typically converts at 32-45% without incentives",
                "confidence": 0.80,
                "category": "retention",
                "params": {"channel": preferred_channel, "use_discount": False},
            })

        confidence = _compute_confidence(facts, signals, warnings)

        return AgentResult(
            agent="customer",
            status="success" if facts else "partial",
            confidence=confidence,
            facts=facts,
            signals=signals,
            diagnosis=diagnosis,
            opportunities=opportunities,
            recommendations=recommendations,
            data_sources=["customers", "business_states"],
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