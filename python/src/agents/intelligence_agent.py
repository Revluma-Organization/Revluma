"""Cross-domain specialist for Business-State patterns and anomalies."""

from __future__ import annotations

import logging

from .base_agent import AgentResult, BaseAgent

logger = logging.getLogger("rev.agent.intelligence")


class IntelligenceAgent(BaseAgent):
    """Correlate available signals and surface evidence-backed proactive insights."""

    @property
    def name(self) -> str:
        return "intelligence"

    def analyze(self, business_state, memories: list[dict], question: str) -> AgentResult:
        try:
            return self._analyze(business_state)
        except Exception as exc:
            logger.error("intelligence_agent_failed", extra={"error_type": type(exc).__name__})
            return AgentResult.error(self.name, type(exc).__name__)

    def _analyze(self, state) -> AgentResult:
        facts, signals, diagnosis, opportunities, recommendations = [], [], [], [], []
        warnings = list(getattr(state, "warnings", []) or [])
        anomalies = list(getattr(state, "anomalies", []) or [])
        trends = list(getattr(state, "trends", []) or [])
        revenue_delta = getattr(state, "revenue_delta_pct", None)
        cart_anomaly = bool(getattr(state, "cart_anomaly", False))

        for anomaly in anomalies[:5]:
            if isinstance(anomaly, dict):
                signals.append({
                    "type": "signal", "metric": anomaly.get("metric", "anomaly"),
                    "description": str(anomaly.get("description") or anomaly.get("message") or "Anomaly detected."),
                    "severity": anomaly.get("severity", "medium"),
                })
        for trend in trends[:3]:
            if isinstance(trend, dict):
                facts.append({
                    "type": "fact", "metric": trend.get("metric", "trend"),
                    "value": trend.get("value"),
                    "description": str(trend.get("description", "Emerging trend detected.")),
                    "source": "business_state.trends",
                })

        if revenue_delta is not None and revenue_delta < -10 and cart_anomaly:
            diagnosis.append({
                "type": "inference",
                "description": "Revenue decline and elevated cart abandonment are occurring together; checkout or acquisition quality should be investigated before treating this as a product-demand issue.",
                "confidence": 0.72,
            })
            recommendations.append({
                "action": "investigate_cross_domain_anomaly",
                "description": "Compare checkout errors, traffic-source quality, and campaign changes over the same period.",
                "predicted_impact": "Identifies the most likely shared cause.",
                "confidence": 0.72,
                "category": "cross_domain",
            })
        if not facts and not signals:
            warnings.append("No current cross-domain trends or anomalies are available.")

        confidence = 0.4 + (0.2 if facts else 0) + (0.2 if signals else 0) + (0.1 if diagnosis else 0)
        return AgentResult(
            agent=self.name, status="success" if facts or signals else "no_data",
            confidence=round(min(0.9, confidence), 2), facts=facts, signals=signals,
            diagnosis=diagnosis, opportunities=opportunities, recommendations=recommendations,
            data_sources=["business_states", "alerts"], warnings=warnings,
        )
