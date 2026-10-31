"""
Rev Intelligence — Revenue Agent
Responsible for: revenue trends, order volume, AOV, anomalies, opportunities.
Reads exclusively from BusinessState — does NOT query the database directly.
"""

from __future__ import annotations
import json
import logging
from datetime import datetime, timedelta, timezone
from decimal import Decimal
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
        revenue_evidence = getattr(bs, "revenue_evidence", {}) or {}
        evidence_items = revenue_evidence.get("items", []) if isinstance(revenue_evidence, dict) else []
        generated_at = getattr(bs, "generated_at", None)
        today_start = None
        if isinstance(generated_at, datetime) and generated_at.tzinfo is not None and generated_at.utcoffset() is not None:
            today_start = datetime.combine(
                generated_at.astimezone(timezone.utc).date(), datetime.min.time(), tzinfo=timezone.utc
            )
        yesterday_start = today_start - timedelta(days=1) if today_start else None
        trend_start = today_start - timedelta(days=14) if today_start else None
        today_evidence = next(
            (item for item in evidence_items
             if item.get("metric") == "recorded_order_value"
             and item.get("status") == "available"
             and item.get("unit") == "money"
             and item.get("epistemic_type") == "observed"
             and item.get("currency") == currency
             and today_start is not None
             and _period_matches(item, today_start, None, end_day=today_start)),
            None,
        )
        yesterday_evidence = next(
            (item for item in evidence_items
             if item.get("metric") == "recorded_order_value"
             and item.get("status") == "available"
             and item.get("unit") == "money"
             and item.get("epistemic_type") == "observed"
             and item.get("currency") == currency
             and yesterday_start is not None
             and _period_matches(item, yesterday_start, today_start)),
            None,
        )
        trend_evidence = next(
            (item for item in evidence_items
             if item.get("metric") == "revenue_trend_7d"
             and item.get("status") == "available"
             and item.get("unit") == "percent"
             and item.get("epistemic_type") == "calculated"
             and item.get("currency") == currency
             and trend_start is not None
             and _period_matches(item, trend_start, today_start)),
            None,
        )
        if (revenue_evidence.get("overall_status") != "available" or not currency
                or (yesterday_evidence is None and trend_evidence is None)):
            return AgentResult.no_data("revenue", "No fresh, complete, single-currency revenue evidence with provenance is available for the requested analysis.")

        facts = []
        signals = []
        diagnosis = []
        opportunities = []
        recommendations = []
        warnings = list(bs.warnings)
        data_sources = [item["evidence_id"] for item in (yesterday_evidence, trend_evidence) if item]

        # ── Facts (directly in data) 
        if bs.revenue_today is not None and today_evidence:
            facts.append({
                "type": "fact",
                "claim_type": "verified_fact",
                "evidence_ids": [today_evidence["evidence_id"]],
                "metric": "revenue_today",
                "value": str(bs.revenue_today),
                "currency": currency,
                "description": f"Recorded order value today (UTC): {Decimal(str(bs.revenue_today)):,.2f} {currency}",
                "source": "orders.total and orders.currency, current UTC day",
            })

        if yesterday_evidence:
            yesterday_value = Decimal(str(yesterday_evidence["value"]))
            facts.append({
                "type": "fact",
                "claim_type": "verified_fact",
                "evidence_ids": [yesterday_evidence["evidence_id"]],
                "metric": "revenue_yesterday",
                "value": str(yesterday_value),
                "currency": currency,
                "description": f"Recorded order value yesterday (UTC): {yesterday_value:,.2f} {currency}",
                "source": "orders.total and orders.currency, previous complete UTC day",
            })

        # ── Signals (computed patterns) 
        if trend_evidence:
            trend_value = Decimal(str(trend_evidence["value"]))
            direction = "up" if trend_value > 0 else "down"
            signals.append({
                "type": "signal",
                "claim_type": "calculated_observation",
                "evidence_ids": [trend_evidence["evidence_id"]],
                "metric": "revenue_trend_7d",
                "value": float(trend_value),
                "currency": currency,
                "description": f"Recorded order value in {currency}: {direction} {abs(trend_value):.1f}% across the last seven complete UTC days vs the prior seven complete UTC days",
                "severity": "high" if abs(trend_value) > 15 else "medium",
            })

        for anomaly in bs.anomalies:
            if anomaly.get("metric") == "revenue" and trend_evidence:
                signals.append({
                    "type": "signal",
                    "claim_type": "derived_signal",
                    "evidence_ids": [trend_evidence["evidence_id"]],
                    "metric": "anomaly",
                    "description": f"Revenue anomaly detected: {anomaly.get('direction')} {abs(anomaly.get('deviation', 0)):.1f}% {anomaly.get('period')}",
                    "severity": "high",
                })

        # ── Diagnosis (inferences) 
        if trend_evidence and Decimal(str(trend_evidence["value"])) < -15:
            diagnosis.append({
                "type": "unknown",
                "claim_type": "unknown",
                "evidence_ids": [trend_evidence["evidence_id"]],
                "description": "Recorded order value declined across the verified comparison periods, but this revenue evidence does not establish why.",
                "confidence": 1.0,
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


def _period_matches(item: dict, start: datetime, end: datetime | None, *, end_day: datetime | None = None) -> bool:
    period = item.get("period") if isinstance(item, dict) else None
    if not isinstance(period, dict):
        return False
    start_value = str(period.get("start") or "")
    end_value = str(period.get("end") or "")
    if not start_value.startswith(start.date().isoformat()):
        return False
    expected_end = end_day or end
    return bool(expected_end and end_value.startswith(expected_end.date().isoformat()))
