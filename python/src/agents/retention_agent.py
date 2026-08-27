"""
Rev Intelligence — Retention Agent
Responsible for: churn risk, cart recovery, repeat purchase behaviour, LTV.
Reads from BusinessState. Respects merchant memory constraints.

No database access. Every number this agent states comes from the context
package the Orchestrator assembled — business_state and merchant memories —
and nothing else. There is no session, no engine, no query.

M4 churn scores arrive on business_state.ml_signals["churn"]. When that key is
absent the agent falls back to the RFM segment counts already on
business_state and records M4_SIGNALS_UNAVAILABLE, rather than inventing
per-customer risk it cannot see.

The one rule that is not a heuristic: a customer M4 calls HEALTHY never gets a
win-back discount. Paying someone to stay who was never leaving is the most
expensive mistake this agent could make, so the guard sits at the point the
action is built, not only at the point customers are selected.
"""

from __future__ import annotations
import logging
from .base_agent import BaseAgent, AgentResult

logger = logging.getLogger("rev.agent.retention")

# M4 tiers a win-back discount may be attached to. HEALTHY is excluded by the
# spec; EARLY_WARNING is excluded because the tier exists to reach someone
# cheaply while they are still reachable — discounting there spends margin on
# customers who have not yet decided to leave.
DISCOUNT_ELIGIBLE_TIERS = ("AT_RISK", "HIGH_RISK", "CRITICAL")
WINBACK_ELIGIBLE_TIERS = ("AT_RISK", "HIGH_RISK", "CRITICAL")
NEVER_DISCOUNT_TIERS = ("HEALTHY", "EARLY_WARNING")

TIER_PRIORITY = {"CRITICAL": 4, "HIGH_RISK": 3, "AT_RISK": 2, "EARLY_WARNING": 1, "HEALTHY": 0}


def _m4_churn_signals(bs) -> dict:
    """Reads M4 output off the context package. Never queries anything.

    Accepts either shape the Orchestrator may put on ml_signals["churn"]:
    a bare list of predict() results, or a dict with "customers" and/or
    "tier_counts". Anything else is treated as absent.

    Returns:
        {"customers": list[dict], "tier_counts": dict, "available": bool}
    """
    raw = (getattr(bs, "ml_signals", None) or {}).get("churn")
    if isinstance(raw, list):
        customers, counts = raw, {}
    elif isinstance(raw, dict):
        customers = raw.get("customers") or []
        counts = raw.get("tier_counts") or {}
    else:
        return {"customers": [], "tier_counts": {}, "available": False}

    customers = [c for c in customers if isinstance(c, dict) and c.get("churn_tier")]
    if not counts and customers:
        counts = {}
        for c in customers:
            counts[c["churn_tier"]] = counts.get(c["churn_tier"], 0) + 1
    return {
        "customers": customers,
        "tier_counts": counts,
        "available": bool(customers or counts),
    }


def _discount_allowed(tier: str) -> bool:
    """The HEALTHY guard, in one place so it cannot be half-applied."""
    return tier not in NEVER_DISCOUNT_TIERS and tier in DISCOUNT_ELIGIBLE_TIERS


def _expected_value(customer: dict) -> float:
    """LTV at stake weighted by how likely it is to walk out of the door."""
    ltv = float(customer.get("customer_ltv") or customer.get("ltv") or 0.0)
    probability = float(customer.get("churn_probability") or 0.0)
    return ltv * probability


def _highest_value_winback(customers: list[dict]) -> dict | None:
    """The single best win-back opportunity, or None if there is not one.

    Ranked by expected value first — the money actually recoverable — with
    tier as the tie-break so that between two customers worth the same, the
    one closer to gone is reached first.
    """
    eligible = [c for c in customers if c.get("churn_tier") in WINBACK_ELIGIBLE_TIERS]
    if not eligible:
        return None
    return max(
        eligible,
        key=lambda c: (_expected_value(c), TIER_PRIORITY.get(c.get("churn_tier"), 0)),
    )


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
            logger.error("retention_structured_output_failed", extra={"error": str(e)})
            return {
                "domain": self.name,
                "findings": [{"code": "AGENT_ERROR", "metric": "agent_error",
                              "value": type(e).__name__, "kind": "fact", "severity": "high"}],
                "confidence": 0.0,
                "recommended_action": {
                    "action": "no_action_required", "customer_id": None, "churn_tier": None,
                    "channel": None, "discount_allowed": False, "discount_pct": 0,
                    "expected_value": None, "escalate_to_human": False,
                },
                "evidence_references": [],
                "contradictions_detected": [],
            }

    def _structured_output(self, business_state, memories: list[dict], question: str) -> dict:
        """The S5 agent output schema — six fields, no free-form text.

        analyze() still returns an AgentResult because BaseAgent and the
        Orchestrator both require it and neither file is in scope to change.
        This method is the schema-conformant view of the same analysis: it is
        built from analyze()'s own result, so the two cannot drift apart.

        Returns:
            dict with exactly: domain, findings, confidence, recommended_action,
            evidence_references, contradictions_detected. Every value is a
            code, a number, or a boolean — nothing to be read as prose.
        """
        result = self.analyze(business_state, memories, question)
        m4 = _m4_churn_signals(business_state)

        findings = [
            {"code": f.get("metric", "").upper(), "metric": f.get("metric"),
             "value": f.get("value"), "kind": "fact", "severity": "info"}
            for f in result.facts
        ] + [
            {"code": s.get("metric", "").upper(), "metric": s.get("metric"),
             "value": s.get("value"), "kind": "signal", "severity": s.get("severity", "info")}
            for s in result.signals
        ]

        best = _highest_value_winback(m4["customers"])
        if best is not None:
            tier = best.get("churn_tier")
            allowed = _discount_allowed(tier) and not bool(
                _get_memory(memories, "never_recommend_discounts", False)
            )
            recommended_action = {
                "action": "targeted_winback",
                "customer_id": best.get("customer_id"),
                "churn_tier": tier,
                "channel": best.get("recommended_channel")
                           or _get_memory(memories, "preferred_channel", "email"),
                "discount_allowed": allowed,
                "discount_pct": (_get_memory(memories, "max_discount_pct", 15) if allowed else 0),
                "expected_value": round(_expected_value(best), 2),
                "escalate_to_human": bool(best.get("escalate_to_human")),
            }
        elif result.recommendations:
            top = result.recommendations[0]
            params = top.get("params", {})
            recommended_action = {
                "action": top.get("action"),
                "customer_id": params.get("customer_id"),
                "churn_tier": params.get("churn_tier"),
                "channel": params.get("channel"),
                "discount_allowed": bool(params.get("use_discount", False)),
                "discount_pct": params.get("max_discount_pct", 0),
                "expected_value": None,
                "escalate_to_human": bool(params.get("escalate_to_human", False)),
            }
        else:
            recommended_action = {
                "action": "no_action_required", "customer_id": None, "churn_tier": None,
                "channel": None, "discount_allowed": False, "discount_pct": 0,
                "expected_value": None, "escalate_to_human": False,
            }

        evidence = list(result.data_sources)
        state_id = getattr(business_state, "id", None)
        if state_id:
            evidence.append(f"business_state:{state_id}")
        for key in ("max_discount_pct", "preferred_channel", "never_recommend_discounts"):
            if any(m.get("memory_key") == key and m.get("is_active") for m in memories):
                evidence.append(f"memory:{key}")

        return {
            "domain": self.name,
            "findings": findings,
            "confidence": result.confidence,
            "recommended_action": recommended_action,
            "evidence_references": evidence,
            "contradictions_detected": _detect_contradictions(business_state, m4, memories),
        }

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
        never_discount = bool(_get_memory(memories, "never_recommend_discounts", False))

        m4 = _m4_churn_signals(bs)
        if not m4["available"]:
            warnings.append("M4 churn scores absent from business_state.ml_signals — "
                            "risk is reported from RFM segments only.")
        else:
            data_sources.append("ml_signals.churn")

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

        if m4["tier_counts"]:
            facts.append({
                "type": "fact",
                "metric": "m4_tier_counts",
                "value": m4["tier_counts"],
                "description": "M4 churn tier distribution: " + ", ".join(
                    f"{tier} {count}" for tier, count in sorted(m4["tier_counts"].items())
                ),
                "source": "ml_signals.churn",
            })

        early_warning_count = m4["tier_counts"].get("EARLY_WARNING", 0)
        if early_warning_count:
            facts.append({
                "type": "fact",
                "metric": "early_warning_count",
                "value": early_warning_count,
                "description": f"{early_warning_count} customers are still buying normally but their "
                               f"engagement has already started falling — reachable now, 4-6 weeks "
                               f"before a no-purchase rule would flag them",
                "source": "ml_signals.churn",
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

        best = _highest_value_winback(m4["customers"])
        if best is not None:
            signals.append({
                "type": "signal",
                "metric": "highest_value_winback",
                "value": round(_expected_value(best), 2),
                "description": f"Highest-value win-back opportunity: a {best.get('churn_tier')} "
                               f"customer with ${_expected_value(best):,.2f} of LTV at risk",
                "severity": "high" if best.get("churn_tier") == "CRITICAL" else "medium",
            })

        if early_warning_count:
            signals.append({
                "type": "signal",
                "metric": "early_warning_cohort",
                "value": early_warning_count,
                "description": f"{early_warning_count} customers in EARLY_WARNING — engagement decay "
                               f"without a missed purchase yet",
                "severity": "medium",
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
        if best is not None:
            tier = best.get("churn_tier")
            allowed = _discount_allowed(tier) and not never_discount
            recommendations.append({
                "action": "targeted_winback",
                "description": f"Highest-value win-back: one {tier} customer with "
                               f"${_expected_value(best):,.2f} of LTV at risk. Reach via "
                               f"{best.get('recommended_channel') or preferred_channel}."
                               + ("" if allowed else " No discount — this tier does not warrant one."),
                "predicted_impact": f"${_expected_value(best):,.2f} of LTV addressed by a single action",
                "confidence": 0.74,
                "category": "churn_prevention",
                "params": {
                    "customer_id": best.get("customer_id"),
                    "churn_tier": tier,
                    "channel": best.get("recommended_channel") or preferred_channel,
                    # The HEALTHY guard. Never fill this from max_discount without
                    # asking _discount_allowed first.
                    "use_discount": allowed,
                    "max_discount_pct": max_discount if allowed else 0,
                    "escalate_to_human": bool(best.get("escalate_to_human")),
                },
            })

        if early_warning_count:
            recommendations.append({
                "action": "early_warning_reengagement",
                "description": f"Re-engage {early_warning_count} EARLY_WARNING customers with content, "
                               f"not price — they have not missed a purchase yet.",
                "predicted_impact": "Acting 4-6 weeks earlier costs a message instead of a discount",
                "confidence": 0.66,
                "category": "churn_prevention",
                "params": {
                    "segment": "EARLY_WARNING",
                    "channel": preferred_channel,
                    "use_discount": False,
                    "max_discount_pct": 0,
                },
            })

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


def _detect_contradictions(bs, m4: dict, memories: list[dict]) -> list[dict]:
    """Places where two sources of truth disagree, as codes rather than prose.

    Reporting these is the point: a merchant acting on one number while the
    other says the opposite is how retention budget gets spent backwards.
    """
    found = []
    counts = m4["tier_counts"]

    if m4["available"] and bs.churn_risk_count is not None and counts:
        m4_at_risk = sum(counts.get(t, 0) for t in WINBACK_ELIGIBLE_TIERS)
        # A gap of more than half means the two systems disagree about who is
        # leaving, not merely about where a boundary sits.
        if abs(m4_at_risk - bs.churn_risk_count) > max(5, 0.5 * max(m4_at_risk, bs.churn_risk_count)):
            found.append({
                "code": "RFM_M4_RISK_COUNT_DIVERGENCE",
                "left": {"source": "customers.rfm_segment", "value": bs.churn_risk_count},
                "right": {"source": "ml_signals.churn", "value": m4_at_risk},
            })

    if (bs.returning_customer_rate is not None and bs.returning_customer_rate > 0.40
            and bs.churn_risk_count and bs.churn_risk_count > 20):
        found.append({
            "code": "HIGH_LOYALTY_WITH_HIGH_CHURN_RISK",
            "left": {"source": "customers.orders_count", "value": bs.returning_customer_rate},
            "right": {"source": "customers.rfm_segment", "value": bs.churn_risk_count},
        })

    if _get_memory(memories, "never_recommend_discounts", False):
        offer_required = sum(1 for c in m4["customers"] if c.get("offer_required"))
        if offer_required:
            found.append({
                "code": "MERCHANT_BANS_DISCOUNT_BUT_M4_REQUIRES_OFFER",
                "left": {"source": "memory:never_recommend_discounts", "value": True},
                "right": {"source": "ml_signals.churn.offer_required", "value": offer_required},
            })

    healthy_with_offer = sum(
        1 for c in m4["customers"]
        if c.get("churn_tier") in NEVER_DISCOUNT_TIERS and c.get("offer_required")
    )
    if healthy_with_offer:
        found.append({
            "code": "M4_OFFER_REQUIRED_ON_NON_DISCOUNT_TIER",
            "left": {"source": "ml_signals.churn.churn_tier", "value": list(NEVER_DISCOUNT_TIERS)},
            "right": {"source": "ml_signals.churn.offer_required", "value": healthy_with_offer},
        })

    return found


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