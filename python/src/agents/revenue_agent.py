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
        """Return the exact six-field specialist boundary."""
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
        currency = getattr(bs, "revenue_currency", None)
        if not currency or (bs.revenue_today is None and bs.revenue_yesterday is None and bs.revenue_trend_7d is None):
            return AgentResult.no_data("revenue", "No fresh, complete, single-currency revenue evidence is available for the requested analysis.")

        facts = []
        signals = []
        diagnosis = []
        opportunities = []
        recommendations = []
        warnings = list(bs.warnings)
        data_sources = ["orders.total", "orders.currency", "orders.ordered_at", "orders.recovery_status", "intelligence_order_coverage", "business_states"]

        # ── Facts (directly in data) 
        if bs.revenue_today is not None:
            facts.append({
                "type": "fact",
                "metric": "revenue_today",
                "value": float(bs.revenue_today),
                "currency": currency,
                "description": f"Recorded order value today (UTC): {float(bs.revenue_today):,.2f} {currency}",
                "source": "orders.total and orders.currency, current UTC day",
            })

        if bs.revenue_yesterday is not None:
            facts.append({
                "type": "fact",
                "metric": "revenue_yesterday",
                "value": float(bs.revenue_yesterday),
                "currency": currency,
                "description": f"Recorded order value yesterday (UTC): {float(bs.revenue_yesterday):,.2f} {currency}",
                "source": "orders.total and orders.currency, previous complete UTC day",
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
                "currency": currency,
                "description": f"Recorded order value in {currency}: {direction} {abs(bs.revenue_trend_7d):.1f}% across the last seven complete UTC days vs the prior seven complete UTC days",
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
                    "description": "Recorded order value declined. The available revenue evidence does not establish why; traffic, checkout, pricing and inventory causes have not been verified by this metric.",
                    "confidence": 0.35,
                    "supporting_signals": ["revenue_delta"],
                })
            else:
                diagnosis.append({
                    "type": "inference",
                    "description": "Recorded order value declined. The available revenue evidence does not identify a cause.",
                    "confidence": 0.35,
                    "supporting_signals": ["revenue_delta"],
                })

        if bs.revenue_trend_7d is not None and bs.revenue_trend_7d > 20:
            diagnosis.append({
                "type": "inference",
                "description": "Recorded order value increased over the verified comparison periods. This metric alone does not establish whether traffic, conversion, pricing or order mix caused the change.",
                "confidence": 0.35,
                "supporting_signals": ["revenue_trend_7d"],
            })

        # ── Opportunities 
        for opp in bs.opportunities:
            if opp.get("category") == "cart_recovery":
                opportunities.append(opp)

        if bs.cart_anomaly and bs.abandoned_cart_count:
            opportunities.append({
                "category": "revenue_recovery",
                "description": f"{bs.abandoned_cart_count} recorded carts were abandoned in the last 48 hours. Their monetary value is not included because cart currency is not verified here.",
                "urgency": "high",
            })

        # ── Recommendations 
        if bs.revenue_delta_pct is not None and bs.revenue_delta_pct < -15:
            recommendations.append({
                "action": "investigate_revenue_drop",
                "description": "Review the verified recorded-order evidence and investigate potential causes separately; this metric does not identify payment, traffic or inventory causes.",
                "predicted_impact": "diagnostic",
                "confidence": 0.80,
                "category": "revenue_optimization",
            })

        if bs.abandoned_cart_count and bs.abandoned_cart_count > 0:
            max_discount = _get_memory_constraint(memories, "max_discount_pct", 15)
            recommendations.append({
                "action": "trigger_cart_recovery",
                "description": f"Launch recovery sequence for {bs.abandoned_cart_count} abandoned carts. Use max {max_discount}% discount for price-sensitive shoppers.",
                "predicted_impact": "Potential recovery opportunity; no revenue estimate is verified.",
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
