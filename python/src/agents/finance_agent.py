"""Finance specialist that reasons only from the shared Business State."""

from __future__ import annotations

import logging

from .base_agent import AgentResult, BaseAgent

logger = logging.getLogger("rev.agent.finance")


class FinanceAgent(BaseAgent):
    """Explain revenue and profitability signals without querying the database."""

    @property
    def name(self) -> str:
        return "finance"

    def analyze(self, business_state, memories: list[dict], question: str) -> AgentResult:
        try:
            return self._analyze(business_state, memories, question)
        except Exception as exc:
            logger.error("finance_agent_failed", extra={"error_type": type(exc).__name__})
            return AgentResult.error(self.name, type(exc).__name__)

    def _analyze(self, state, memories: list[dict], question: str) -> AgentResult:
        facts, signals, diagnosis, opportunities, recommendations = [], [], [], [], []
        warnings = list(getattr(state, "warnings", []) or [])
        revenue_today = getattr(state, "revenue_today", None)
        revenue_delta = getattr(state, "revenue_delta_pct", None)
        abandoned_value = getattr(state, "abandoned_cart_value", None)
        ml_signals = getattr(state, "ml_signals", {}) or {}

        if revenue_today is not None:
            facts.append({
                "type": "fact", "metric": "revenue_today", "value": float(revenue_today),
                "description": f"Revenue today is ${float(revenue_today):,.2f}.",
                "source": "business_state.sales_health",
            })
        if revenue_delta is not None:
            signals.append({
                "type": "signal", "metric": "revenue_delta_pct", "value": float(revenue_delta),
                "description": f"Revenue is {abs(float(revenue_delta)):.1f}% "
                               f"{'higher' if revenue_delta >= 0 else 'lower'} than yesterday.",
                "severity": "high" if abs(float(revenue_delta)) >= 20 else "medium",
            })
        margin_signal = ml_signals.get("margin") or ml_signals.get("profitability")
        if isinstance(margin_signal, dict):
            facts.append({
                "type": "fact", "metric": "margin", "value": margin_signal.get("value"),
                "description": str(margin_signal.get("description", "Current margin signal available.")),
                "source": "business_state.ml_signals",
            })
        else:
            warnings.append("Margin and channel-cost aggregates are not available in the current Business State.")

        if revenue_delta is not None and revenue_delta < -10:
            diagnosis.append({
                "type": "inference",
                "description": "A material revenue decline warrants checking conversion, channel spend, and offer cost before increasing discounts.",
                "confidence": 0.68,
            })
            recommendations.append({
                "action": "review_profitability",
                "description": "Review revenue, offer cost, and channel performance before changing campaign spend.",
                "predicted_impact": "Protects margin while diagnosing the decline.",
                "confidence": 0.68,
                "category": "finance",
            })
        if abandoned_value is not None and float(abandoned_value) > 0:
            opportunities.append({
                "category": "revenue_recovery", "estimated_value": float(abandoned_value),
                "description": "Recoverable cart value should be evaluated against the cost of any proposed offer.",
            })

        confidence = 0.45 + (0.2 if facts else 0) + (0.1 if signals else 0) - min(0.2, 0.05 * len(warnings))
        return AgentResult(
            agent=self.name, status="success" if facts else "no_data",
            confidence=round(max(0.1, min(0.9, confidence)), 2), facts=facts,
            signals=signals, diagnosis=diagnosis, opportunities=opportunities,
            recommendations=recommendations, data_sources=["business_states", "orders"], warnings=warnings,
        )
