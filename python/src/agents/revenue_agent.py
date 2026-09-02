"""
Rev Intelligence — Revenue Agent
Responsible for: revenue trends, order volume, AOV, anomalies, opportunities.
Reads exclusively from BusinessState — does NOT query the database directly.
"""

from __future__ import annotations
import json
import logging
from .base_agent import BaseAgent, AgentResult

logger = logging.getLogger("rev.agent.revenue")


class RevenueAgent(BaseAgent):

    @property
    def name(self) -> str:
        return "revenue"

    def analyze(self, business_state, memories: list[dict], question: str) -> AgentResult:
        try:
            return self._analyze(business_state, memories, question)
        except Exception as exc:
            logger.error(
                "revenue_agent_failed",
                extra={"error_type": type(exc).__name__},
            )
            return AgentResult.error("revenue", type(exc).__name__)

    def structured_output(self, business_state, memories: list[dict], question: str) -> dict:
        """Return the exact six-field D5 specialist boundary."""
        result = self.analyze(business_state, memories, question)
        findings = {
            "status": result.status,
            "facts": result.facts,
            "signals": result.signals,
            "diagnosis": result.diagnosis,
            "opportunities": result.opportunities,
            "warnings": result.warnings,
        }
        action = None
        if result.recommendations:
            candidate = result.recommendations[0].get("action")
            action = str(candidate) if candidate else None
        return {
            "domain": "revenue",
            "findings": json.dumps(findings, default=str, sort_keys=True),
            "confidence": min(max(float(result.confidence), 0.0), 1.0),
            "recommended_action": action,
            "evidence_references": [str(source) for source in result.data_sources],
            "contradictions_detected": [],
        }

    def _analyze(self, bs, memories: list[dict], question: str) -> AgentResult:
        if bs.revenue_today is None and bs.revenue_yesterday is None:
            return AgentResult.no_data("revenue", "No revenue data available. Ensure your store is connected and synced.")

        facts = []
        signals = []
        diagnosis = []
        opportunities = []
        recommendations = []
        warnings = list(bs.warnings)
        data_sources = ["orders", "business_states"]

        # ── Facts (directly in data) 
        if bs.revenue_today is not None:
            facts.append({
                "type": "fact",
                "metric": "revenue_today",
                "value": float(bs.revenue_today),
                "currency": "USD",
                "description": f"Revenue today: ${float(bs.revenue_today):,.2f}",
                "source": "orders table, today",
            })

        if bs.revenue_yesterday is not None:
            facts.append({
                "type": "fact",
                "metric": "revenue_yesterday",
                "value": float(bs.revenue_yesterday),
                "currency": "USD",
                "description": f"Revenue yesterday: ${float(bs.revenue_yesterday):,.2f}",
                "source": "orders table, yesterday",
            })

        # ── Signals (computed patterns) 
        if bs.revenue_delta_pct is not None:
            direction = "up" if bs.revenue_delta_pct > 0 else "down"
            signals.append({
                "type": "signal",
                "metric": "revenue_delta",
                "value": bs.revenue_delta_pct,
                "description": f"Revenue is {direction} {abs(bs.revenue_delta_pct):.1f}% vs yesterday",
                "severity": "high" if abs(bs.revenue_delta_pct) > 20 else "medium" if abs(bs.revenue_delta_pct) > 10 else "low",
            })

        if bs.revenue_trend_7d is not None:
            direction = "up" if bs.revenue_trend_7d > 0 else "down"
            signals.append({
                "type": "signal",
                "metric": "revenue_trend_7d",
                "value": bs.revenue_trend_7d,
                "description": f"7-day revenue trend: {direction} {abs(bs.revenue_trend_7d):.1f}% vs prior 7 days",
                "severity": "high" if abs(bs.revenue_trend_7d) > 15 else "medium",
            })

        for anomaly in bs.anomalies:
            if anomaly.get("metric") == "revenue":
                signals.append({
                    "type": "signal",
                    "metric": "anomaly",
                    "description": f"Revenue anomaly detected: {anomaly.get('direction')} {abs(anomaly.get('deviation', 0)):.1f}% {anomaly.get('period')}",
                    "severity": "high",
                })

        # ── Diagnosis (inferences) 
        if bs.revenue_delta_pct is not None and bs.revenue_delta_pct < -15:
            # Correlate with cart data if available
            if bs.cart_anomaly:
                diagnosis.append({
                    "type": "inference",
                    "description": "Revenue drop correlates with elevated cart abandonment. Checkout friction is a likely contributor.",
                    "confidence": 0.72,
                    "supporting_signals": ["revenue_delta", "cart_anomaly"],
                })
            else:
                diagnosis.append({
                    "type": "inference",
                    "description": "Revenue dropped significantly vs yesterday. Check for traffic changes, pricing changes, or product availability issues.",
                    "confidence": 0.55,
                    "supporting_signals": ["revenue_delta"],
                })

        if bs.revenue_trend_7d is not None and bs.revenue_trend_7d > 20:
            diagnosis.append({
                "type": "inference",
                "description": "Strong 7-day revenue growth suggests either increased traffic, improved conversion, or higher AOV. Identify which to sustain it.",
                "confidence": 0.65,
                "supporting_signals": ["revenue_trend_7d"],
            })

        # ── Opportunities 
        for opp in bs.opportunities:
            if opp.get("category") == "cart_recovery":
                opportunities.append(opp)

        if bs.cart_anomaly and bs.abandoned_cart_value:
            opportunities.append({
                "category": "revenue_recovery",
                "description": f"${float(bs.abandoned_cart_value):,.2f} in carts abandoned in the last 48 hours",
                "estimated_value": float(bs.abandoned_cart_value),
                "urgency": "high",
            })

        # ── Recommendations 
        if bs.revenue_delta_pct is not None and bs.revenue_delta_pct < -15:
            recommendations.append({
                "action": "investigate_revenue_drop",
                "description": "Review today's orders for patterns: payment failures, traffic source changes, or product stockouts.",
                "predicted_impact": "diagnostic",
                "confidence": 0.80,
                "category": "revenue_optimization",
            })

        if bs.abandoned_cart_count and bs.abandoned_cart_count > 0:
            max_discount = _get_memory_constraint(memories, "max_discount_pct", 15)
            recommendations.append({
                "action": "trigger_cart_recovery",
                "description": f"Launch recovery sequence for {bs.abandoned_cart_count} abandoned carts. Use max {max_discount}% discount for price-sensitive shoppers.",
                "predicted_impact": f"Estimated 18-25% recovery rate on ${float(bs.abandoned_cart_value or 0):,.2f}",
                "confidence": 0.75,
                "category": "cart_recovery",
                "params": {"max_discount_pct": max_discount},
            })

        confidence = _compute_confidence(facts, signals, warnings)

        return AgentResult(
            agent="revenue",
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


def _get_memory_constraint(memories: list[dict], key: str, default):
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
