"""
Rev Intelligence — Customer Agent
Responsible for: segmentation, VIP tracking, at-risk customers, cohort patterns.
CRITICAL: Never passes customer PII (email, full name) to the LLM.
Uses aggregate counts and segment labels only.

No database access. The agent reasons only over the context package the
Orchestrator assembled — business_state and merchant memories.

Proactive attention means two populations: VIPs who have gone quiet for 45+
days, and customers sitting just under an LTV threshold they could be helped
across. Per-customer data for both arrives on
business_state.ml_signals["customer"]. Without it the agent falls back to
business_state.vip_inactive_count, which is a 30-day count, not a 45-day one —
the SQL behind that column uses INTERVAL '30 days'. In that case the agent
reports the 30-day figure, labels it as such, and records
VIP_THRESHOLD_IS_30_NOT_45 rather than passing it off as the number asked for.
"""

from __future__ import annotations
import logging
from .base_agent import BaseAgent, AgentResult

logger = logging.getLogger("rev.agent.customer")

# S5: VIPs inactive for 45+ days need proactive attention. business_state's own
# vip_inactive_count is computed at 30 days, so this threshold can only be
# applied to per-customer rows from ml_signals.
VIP_INACTIVE_DAYS = 45
VIP_SEGMENTS = ("champion", "loyal")

# LTV bands. 500 is not arbitrary — it is the same figure M4 escalates a
# CRITICAL customer to a human at, so a customer approaching it is approaching
# the point where they are worth a phone call.
LTV_THRESHOLDS = (100.0, 500.0, 1000.0, 2500.0)
# Within 15% below a threshold is close enough that one more order crosses it.
LTV_APPROACH_BAND = 0.15


def _customer_ml_signals(bs) -> dict:
    """Per-customer rows off the context package. Never queries anything.

    Expects business_state.ml_signals["customer"] as either a bare list of
    rows or a dict with "customers". A row carries customer_id, rfm_segment,
    days_inactive, ltv, and optionally sequence_count. Missing keys are
    tolerated; a row that cannot be read is skipped rather than guessed at.

    Returns:
        {"customers": list[dict], "available": bool}
    """
    raw = (getattr(bs, "ml_signals", None) or {}).get("customer")
    if isinstance(raw, list):
        rows = raw
    elif isinstance(raw, dict):
        rows = raw.get("customers") or []
    else:
        return {"customers": [], "available": False}
    rows = [r for r in rows if isinstance(r, dict)]
    return {"customers": rows, "available": bool(rows)}


def _vip_inactive(customers: list[dict]) -> list[dict]:
    """VIPs quiet for VIP_INACTIVE_DAYS or more."""
    out = []
    for c in customers:
        segment = str(c.get("rfm_segment") or "").lower()
        try:
            days = int(c.get("days_inactive") or 0)
        except (TypeError, ValueError):
            continue
        if segment in VIP_SEGMENTS and days >= VIP_INACTIVE_DAYS:
            out.append(c)
    return sorted(out, key=lambda c: float(c.get("ltv") or 0.0), reverse=True)


def _approaching_ltv_threshold(customers: list[dict]) -> list[dict]:
    """Customers sitting just below an LTV band, with the gap to close.

    Returns rows annotated with the threshold in question and the shortfall,
    so the recommendation can be sized rather than guessed.
    """
    out = []
    for c in customers:
        try:
            ltv = float(c.get("ltv") or 0.0)
        except (TypeError, ValueError):
            continue
        for threshold in LTV_THRESHOLDS:
            if threshold * (1 - LTV_APPROACH_BAND) <= ltv < threshold:
                out.append({**c, "ltv_threshold": threshold, "ltv_gap": round(threshold - ltv, 2)})
                break
    return sorted(out, key=lambda c: c["ltv_gap"])


def _approaching_second_purchase(customers: list[dict]) -> list[dict]:
    """Customers who have made exactly one purchase and are approaching their second."""
    out = []
    for c in customers:
        try:
            orders = int(c.get("past_orders_total") or c.get("orders_count") or 0)
        except (TypeError, ValueError):
            continue
        if orders == 1:
            out.append(c)
    return sorted(out, key=lambda c: int(c.get("days_inactive") or 0))

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

    def structured_output(self, business_state, memories: list[dict], question: str) -> dict:
        """The S5 agent output schema — six fields, no free-form text.

        Same guarantee as analyze(): this never raises. A caller serialising
        agent output cannot be left holding an exception instead of a schema,
        so a failure comes back as a conformant envelope carrying the
        exception type as a code — never as a message to be read.
        """
        try:
            return self._structured_output(business_state, memories, question)
        except Exception as e:
            logger.error("customer_structured_output_failed", extra={"error": str(e)})
            return {
                "domain": self.name,
                "findings": [{"code": "AGENT_ERROR", "metric": "agent_error",
                              "value": type(e).__name__, "kind": "fact", "severity": "high"}],
                "confidence": 0.0,
                "recommended_action": {
                    "action": "no_action_required", "target_segment": None, "target_count": None,
                    "min_days_inactive": None, "channel": None, "discount_allowed": False,
                    "ltv_threshold": None,
                },
                "evidence_references": [],
                "contradictions_detected": [],
            }

    def _structured_output(self, business_state, memories: list[dict], question: str) -> dict:
        """The S5 agent output schema — six fields, no free-form text.

        analyze() still returns an AgentResult because BaseAgent and the
        Orchestrator both require it and neither file is in scope to change.
        This method is the schema-conformant view of the same analysis, built
        from analyze()'s own result so the two cannot drift apart.

        Returns:
            dict with exactly: domain, findings, confidence, recommended_action,
            evidence_references, contradictions_detected.
        """
        result = self.analyze(business_state, memories, question)
        ml = _customer_ml_signals(business_state)
        vip_inactive = _vip_inactive(ml["customers"])
        approaching = _approaching_ltv_threshold(ml["customers"])
        second_purchase = _approaching_second_purchase(ml["customers"])
        second_purchase = _approaching_second_purchase(ml["customers"])

        findings = [
            {"code": f.get("metric", "").upper(), "metric": f.get("metric"),
             "value": f.get("value"), "kind": "fact", "severity": "info"}
            for f in result.facts
        ] + [
            {"code": s.get("metric", "").upper(), "metric": s.get("metric"),
             "value": s.get("value"), "kind": "signal", "severity": s.get("severity", "info")}
            for s in result.signals
        ]

        channel = _get_memory(memories, "preferred_channel", "email")
        if vip_inactive:
            # Dormant VIPs outrank LTV nudges: revenue already earned and at
            # risk of walking beats revenue that might be earned.
            recommended_action = {
                "action": "vip_45d_outreach",
                "target_segment": "champion,loyal",
                "target_count": len(vip_inactive),
                "min_days_inactive": VIP_INACTIVE_DAYS,
                "channel": channel,
                "discount_allowed": False,
                "ltv_threshold": None,
            }
        elif approaching:
            recommended_action = {
                "action": "ltv_threshold_nudge",
                "target_segment": None,
                "target_count": len(approaching),
                "min_days_inactive": None,
                "channel": channel,
                "discount_allowed": False,
                "ltv_threshold": approaching[0]["ltv_threshold"],
            }
        elif second_purchase:
            recommended_action = {
                "action": "second_purchase_nudge",
                "target_segment": None,
                "target_count": len(second_purchase),
                "min_days_inactive": None,
                "channel": channel,
                "discount_allowed": True,
                "ltv_threshold": None,
            }
        elif result.recommendations:
            top = result.recommendations[0]
            params = top.get("params", {})
            recommended_action = {
                "action": top.get("action"),
                "target_segment": params.get("segment"),
                "target_count": None,
                "min_days_inactive": params.get("min_days_inactive"),
                "channel": params.get("channel"),
                "discount_allowed": bool(params.get("use_discount", False)),
                "ltv_threshold": None,
            }
        else:
            recommended_action = {
                "action": "no_action_required", "target_segment": None, "target_count": None,
                "min_days_inactive": None, "channel": None, "discount_allowed": False,
                "ltv_threshold": None,
            }

        evidence = list(result.data_sources)
        state_id = getattr(business_state, "id", None)
        if state_id:
            evidence.append(f"business_state:{state_id}")
        if any(m.get("memory_key") == "preferred_channel" and m.get("is_active") for m in memories):
            evidence.append("memory:preferred_channel")

        return {
            "domain": self.name,
            "findings": findings,
            "confidence": result.confidence,
            "recommended_action": recommended_action,
            "evidence_references": evidence,
            "contradictions_detected": _detect_contradictions(business_state, ml, vip_inactive),
        }

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
        data_sources = ["customers", "business_states"]

        ml = _customer_ml_signals(bs)
        vip_inactive = _vip_inactive(ml["customers"])
        approaching = _approaching_ltv_threshold(ml["customers"])
        second_purchase = _approaching_second_purchase(ml["customers"])
        second_purchase = _approaching_second_purchase(ml["customers"])
        if ml["available"]:
            data_sources.append("ml_signals.customer")
        else:
            warnings.append(
                f"Per-customer rows absent from business_state.ml_signals — the "
                f"{VIP_INACTIVE_DAYS}-day VIP threshold and LTV proximity could not be "
                f"applied. vip_inactive_count below is a 30-day count."
            )

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

        if vip_inactive:
            facts.append({
                "type": "fact",
                "metric": "vip_inactive_45d_count",
                "value": len(vip_inactive),
                "description": f"{len(vip_inactive)} VIP customers inactive for "
                               f"{VIP_INACTIVE_DAYS}+ days",
                "source": "ml_signals.customer — aggregate count only",
            })
            signals.append({
                "type": "signal",
                "metric": "vip_dormancy",
                "value": len(vip_inactive),
                "description": f"{len(vip_inactive)} of the highest-value segment have gone quiet "
                               f"past the {VIP_INACTIVE_DAYS}-day mark",
                "severity": "high",
            })
            opportunities.append({
                "category": "vip_retention",
                "description": f"Proactive outreach to {len(vip_inactive)} VIPs inactive "
                               f"{VIP_INACTIVE_DAYS}+ days",
                "urgency": "high",
                "note": "Highest LTV per head of any segment — outreach, not discount",
            })

        if approaching:
            facts.append({
                "type": "fact",
                "metric": "approaching_ltv_threshold_count",
                "value": len(approaching),
                "description": f"{len(approaching)} customers are within "
                               f"{int(LTV_APPROACH_BAND * 100)}% of an LTV threshold",
                "source": "ml_signals.customer — aggregate count only",
            })
            nearest = approaching[0]
            signals.append({
                "type": "signal",
                "metric": "ltv_threshold_proximity",
                "value": nearest["ltv_gap"],
                "description": f"Closest customer is ${nearest['ltv_gap']:,.2f} short of the "
                               f"${nearest['ltv_threshold']:,.0f} LTV band",
                "severity": "medium",
            })
            opportunities.append({
                "category": "ltv_growth",
                "description": f"Move {len(approaching)} customers across an LTV threshold",
                "urgency": "medium",
                "note": "One well-sized order each — the gap is already computed per customer",
            })

        if second_purchase:
            facts.append({
                "type": "fact",
                "metric": "one_time_buyer_count",
                "value": len(second_purchase),
                "description": f"{len(second_purchase)} customers have made exactly one purchase",
                "source": "ml_signals.customer — aggregate count only",
            })
            signals.append({
                "type": "signal",
                "metric": "second_purchase_opportunity",
                "value": len(second_purchase),
                "description": f"{len(second_purchase)} customers are at the critical one-time buyer milestone",
                "severity": "medium",
            })
            opportunities.append({
                "category": "repeat_purchase_growth",
                "description": f"Convert {len(second_purchase)} one-time buyers into repeat customers",
                "urgency": "medium",
                "note": "The second purchase is the most important milestone for long-term retention",
            })

        # ── Recommendations 
        preferred_channel = _get_memory(memories, "preferred_channel", "email")

        if vip_inactive:
            recommendations.append({
                "action": "vip_45d_outreach",
                "description": f"Personalised re-engagement for {len(vip_inactive)} VIPs inactive "
                               f"{VIP_INACTIVE_DAYS}+ days, highest LTV first. No discount.",
                "predicted_impact": "VIP re-engagement typically converts at 32-45% without incentives",
                "confidence": 0.80,
                "category": "retention",
                "params": {
                    "segment": "champion,loyal",
                    "min_days_inactive": VIP_INACTIVE_DAYS,
                    "customer_ids": [c.get("customer_id") for c in vip_inactive[:25]],
                    "channel": preferred_channel,
                    "use_discount": False,
                },
            })

        if approaching:
            recommendations.append({
                "action": "ltv_threshold_nudge",
                "description": f"Nudge {len(approaching)} customers over the LTV band they are "
                               f"short of, sized to each customer's own gap.",
                "predicted_impact": f"Closing every gap moves {len(approaching)} customers into a "
                                    f"higher LTV band",
                "confidence": 0.64,
                "category": "ltv_growth",
                "params": {
                    "customer_ids": [c.get("customer_id") for c in approaching[:25]],
                    "channel": preferred_channel,
                    "use_discount": False,
                },
            })

        if second_purchase:
            recommendations.append({
                "action": "second_purchase_nudge",
                "description": f"Target {len(second_purchase)} one-time buyers to secure their second purchase.",
                "predicted_impact": "Securing a second purchase significantly increases probability of long-term retention",
                "confidence": 0.70,
                "category": "repeat_purchase_growth",
                "params": {
                    "customer_ids": [c.get("customer_id") for c in second_purchase[:25]],
                    "channel": preferred_channel,
                    "use_discount": True,
                },
            })

        if bs.vip_inactive_count and bs.vip_inactive_count > 0 and not vip_inactive:
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
            data_sources=data_sources,
            warnings=warnings,
        )


def _detect_contradictions(bs, ml: dict, vip_inactive: list[dict]) -> list[dict]:
    """Places where two sources of truth disagree, as codes rather than prose."""
    found = []

    if not ml["available"] and bs.vip_inactive_count:
        # Not a disagreement between numbers but between the number asked for
        # and the number available. Surfacing it stops a 30-day count being
        # read as a 45-day one downstream.
        found.append({
            "code": "VIP_THRESHOLD_IS_30_NOT_45",
            "left": {"source": "requested", "value": VIP_INACTIVE_DAYS},
            "right": {"source": "business_states.vip_inactive_count", "value": 30},
        })

    if ml["available"] and bs.vip_inactive_count is not None:
        # The 45-day cohort is a subset of the 30-day one. More of them than
        # there are of the superset means the two were computed over different
        # populations.
        if len(vip_inactive) > bs.vip_inactive_count:
            found.append({
                "code": "VIP_45D_EXCEEDS_30D_COUNT",
                "left": {"source": "ml_signals.customer", "value": len(vip_inactive)},
                "right": {"source": "business_states.vip_inactive_count",
                          "value": bs.vip_inactive_count},
            })

    if (bs.returning_customer_rate is not None and bs.returning_customer_rate > 0.35
            and bs.churn_risk_count and bs.churn_risk_count > 20):
        found.append({
            "code": "STRONG_LOYALTY_WITH_ELEVATED_CHURN_RISK",
            "left": {"source": "customers.orders_count", "value": bs.returning_customer_rate},
            "right": {"source": "customers.rfm_segment", "value": bs.churn_risk_count},
        })

    return found


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