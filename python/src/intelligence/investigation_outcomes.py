"""Task 207 — canonical investigation outcomes and capability decisions.

This module composes the existing integration evidence (Task 201), evidence
quality (Task 203), and reporting-period contracts. It is deliberately not a
second integration-state or coverage engine. All merchant-visible outcomes are
safe, typed, bounded and read-only; raw exceptions never cross this boundary.
"""
from __future__ import annotations

import hashlib
import re
from datetime import datetime
from typing import Any

OUTCOME_CONTRACT_VERSION = "rev-investigation-outcome-v1"
OUTCOMES = frozenset({
    "success", "partial_success", "insufficient_history", "insufficient_coverage",
    "integration_disconnected", "authorization_required", "authorization_expired",
    "permission_insufficient", "sync_in_progress", "sync_stale", "sync_failed",
    "source_unavailable", "retrieval_failed", "unsupported_capability",
    "unsupported_question", "ambiguous_question", "invalid_request", "internal_error",
})

TOOL_DOMAINS = {
    "store_health": ["integration"], "integration_health": ["integration"],
    "data_coverage": ["orders"], "revenue_observations": ["orders"],
    "order_observations": ["orders"], "cart_observations": ["checkouts"],
    "checkout_observations": ["checkouts"], "customer_observations": ["customers"],
    "product_observations": ["products"], "inventory_observations": ["inventory"],
    "traffic_observations": ["storefront_events"], "refund_observations": ["refunds"],
    "findings": ["findings"],
}

# Capability decisions are deterministic safeguards. They run before model
# routing so an unavailable provider cannot turn an unsupported request into a
# confident answer. They describe only the current, implemented read-only MVP.
_CAPABILITY_RULES = (
    ("definitive_causation", "unsupported_question", re.compile(
        r"\b(?:prove|proof|certain|certainty|definitive(?:ly)?|exactly)\b[^.?!]{0,80}\b(?:caus(?:e|ed|ation)|attribute|attribution|drove|driven)\b", re.I),
     "I can't provide definitive causal attribution from ordinary store observations.",
     "I can report observed differences and labelled hypotheses, or assess a properly designed experiment when its methodology and evidence are available."),
    ("advertising_integration", "unsupported_capability", re.compile(
        r"\b(?:ad(?:vertising|s)?\s+(?:spend|performance|campaign|roas)|facebook\s+ads|google\s+ads|meta\s+ads|tiktok\s+ads|campaign\s+performance)\b", re.I),
     "I don't have an authorized advertising integration, so I can't access advertising spend or campaign performance, not its contribution to sales.",
     "I can still investigate the Shopify order, checkout, refund, product and inventory records that are available."),
    ("web_analytics_integration", "unsupported_capability", re.compile(
        r"\b(?:google\s+analytics|\bga4\b|analytics\s+sessions|social\s+media\s+(?:campaign|performance)|instagram\s+(?:ads|campaign)|competitor(?:'s)?\s+(?:private\s+)?(?:sales|revenue|conversion))\b", re.I),
     "That requires an external or private data source Revluma is not connected to.",
     "I can analyze only your authorized Shopify records; I won't infer the missing external figures."),
    ("payment_provider", "unsupported_capability", re.compile(
        r"\b(?:stripe|paypal|adyen|klarna)\b[^.?!]{0,60}\b(?:payout|dispute|transaction|payment|revenue|fee)|\b(?:payouts|payment.provider|external\s+payment)\b", re.I),
     "I don't have an authorized external payment-provider integration for that analysis.",
     "Where synchronized Shopify order transactions exist, I can investigate those recorded transactions instead."),
    ("forecast", "unsupported_capability", re.compile(
        r"\b(?:forecast|predict|projection|exact\s+future|future\s+(?:sales|revenue|traffic)|when\s+(?:will|shall)\s+(?:i|we)\s+(?:run\s+out|stock\s+out)|stockout\s+date)\b", re.I),
     "This release does not provide a validated forecasting capability, so I can't give an exact future sales, traffic, revenue or stockout prediction.",
     "I can report observed history and clearly labelled hypotheses without presenting them as forecasts."),
    ("guarantee", "unsupported_question", re.compile(
        r"\b(?:guarantee|guaranteed|certain|promise)\b[^.?!]{0,70}\b(?:revenue|sales|conversion|recovery|recovered|improvement|growth)|\b(?:exact|definite)\s+(?:recovery|recovered\s+revenue)\b", re.I),
     "I can't guarantee future revenue, conversion improvement or recovery amounts.",
     "I can measure recorded results and distinguish observed value, eligible estimates and independently verified outcomes."),
    ("purchase_intent", "unsupported_question", re.compile(
        r"\b(?:know|prove|certain|certainty|definitive)\b[^.?!]{0,60}\b(?:customer|shopper)s?\b[^.?!]{0,40}\b(?:intent|going\s+to\s+buy|will\s+buy)\b", re.I),
     "Authorized store records cannot prove an individual customer's future purchase intent.",
     "I can describe recorded customer and checkout behavior without treating it as intent."),
)

_OUT_OF_DOMAIN = re.compile(
    r"^(?:what|who|where|when|why|how|tell me|write|translate|solve)?\s*(?:is|was|are|were|do|does|did|can|could)?\s*"
    r"(?:the\s+)?(?:capital\s+of|weather|recipe|meaning\s+of\s+life|president|quantum\s+physics|stock\s+market|bitcoin|homework|poem\s+about)\b", re.I)
_AMBIGUOUS_RANGE = re.compile(
    r"\bcompare\b[^.?!]{0,70}\b(?:that|it|before|earlier|last\s+time)\b|\b(?:last\s+month|this\s+week)\s+(?:or|versus|vs\.?)\s+(?:the\s+)?(?:other|previous)\b", re.I)


def capability_decision(message: str, *, has_conversation_context: bool = False) -> dict | None:
    """Return a deterministic unsupported/ambiguity decision, if applicable."""
    text = (message or "").strip()
    for code, outcome, pattern, unavailable, answerable in _CAPABILITY_RULES:
        if pattern.search(text):
            return {
                "code": code, "outcome": outcome, "category": "unsupported_external_data"
                if code.endswith("integration") or code == "payment_provider"
                else "unsupported_prediction" if code == "forecast" else "unsupported_request",
                "unavailable": unavailable, "answerable": answerable,
                "next_step": "Ask about an authorized Shopify metric or a supported historical comparison.",
                "retry_eligible": False,
            }
    if _OUT_OF_DOMAIN.search(text):
        return {
            "code": "out_of_domain", "outcome": "unsupported_question", "category": "out_of_domain",
            "unavailable": "That question is outside Revluma's store-evidence and commerce-operations scope.",
            "answerable": "I can help investigate authorized Shopify performance and operational records.",
            "next_step": "Ask a question about your store or its supported commerce data.", "retry_eligible": False,
        }
    commerce_terms = re.compile(
        r"\b(?:shopify|store|shop|ecommerce|commerce|revenue|sales|orders?|aov|average\s+order|"
        r"checkout|carts?|customers?|products?|inventory|refunds?|discounts?|fulfil|fulfill|"
        r"conversion|retention|churn|ltv|traffic|campaign|marketing|margin|profit|sku|merchant)\b", re.I)
    if not has_conversation_context \
            and re.match(r"^(?:what|who|where|when)\b", text, re.I) \
            and not re.match(r"^(?:what\s+(?:can\s+you|are\s+you|is\s+rev|about)\b|where\s+did\b)", text, re.I) \
            and not commerce_terms.search(text):
        return {
            "code": "out_of_domain", "outcome": "unsupported_question", "category": "out_of_domain",
            "unavailable": "That general-knowledge question is outside Revluma's store-evidence and commerce-operations scope.",
            "answerable": "I can help investigate authorized Shopify performance and operational records.",
            "next_step": "Ask a question about your store or its supported commerce data.", "retry_eligible": False,
        }
    if _AMBIGUOUS_RANGE.search(text):
        return {
            "code": "ambiguous_period", "outcome": "ambiguous_question", "category": "ambiguous_question",
            "unavailable": "The comparison periods are not explicit enough to select safely.",
            "answerable": "I can compare two periods once you identify them.",
            "next_step": "Which two dates or reporting periods would you like me to compare?", "retry_eligible": False,
        }
    return None


def base_outcome(*, outcome: str, investigation_id: str, question: str, intent: str,
                 organization_id: str, store_ids: list[str] | None = None,
                 required_domains: list[str] | None = None, period: dict | None = None) -> dict:
    if outcome not in OUTCOMES:
        raise ValueError("unknown investigation outcome")
    return {
        "contract_version": OUTCOME_CONTRACT_VERSION,
        "outcome": outcome,
        "investigation_id": investigation_id,
        "question": question,
        "resolved_intent": intent,
        "tenant": {"organization_id": organization_id, "store_ids": sorted(set(store_ids or []))},
        "required_domains": sorted(set(required_domains or [])),
        "available_domains": [], "unavailable_domains": [],
        "integration": {"state": "not_evaluated", "authorization": "not_evaluated"},
        "sync": {"state": "not_evaluated", "diagnostics": []},
        "retrieval": {"state": "not_evaluated", "diagnostics": []},
        "coverage": {"state": "unknown", "complete": False, "freshness": "unknown"},
        "history": {"state": "unknown", "requested_period": period,
                    "available_start": None, "available_end": None, "missing": []},
        "answerability": {"can_answer": [], "cannot_establish": []},
        "next_step": None, "retry": {"eligible": False, "status": "not_requested"},
        "diagnostic_reference": diagnostic_reference(investigation_id),
    }


def diagnostic_reference(investigation_id: str) -> str:
    digest = hashlib.sha256(("rev207:" + investigation_id).encode()).hexdigest()[:16]
    return f"REV-{digest.upper()}"


def unsupported_outcome(decision: dict, **base) -> dict:
    result = base_outcome(outcome=decision["outcome"], **base)
    result["capability"] = {"code": decision["code"], "category": decision["category"], "supported": False}
    result["answerability"] = {"can_answer": [decision["answerable"]], "cannot_establish": [decision["unavailable"]]}
    result["next_step"] = decision["next_step"]
    result["retry"] = {"eligible": decision["retry_eligible"], "status": "not_applicable"}
    return result


def outcome_text(decision: dict) -> str:
    if decision.get("category") == "ambiguous_question":
        return decision["next_step"]
    return (f"{decision['unavailable']}\n\n{decision['answerable']}\n\n"
            f"**Next step:** {decision['next_step']}")


def _dt(value):
    if not value: return None
    try:
        result = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return result
    except (TypeError, ValueError): return None


def history_assessment(items: list[dict], requested: dict, comparison: dict | None = None) -> dict:
    """Assess certified observation windows; never use integration age instead."""
    starts, ends = [], []
    states, missing = set(), []
    currencies, timezones = set(), set()
    for item in items:
        coverage = item.get("coverage") or {}
        if coverage.get("source") not in (None, "intelligence_order_coverage") and not coverage.get("status"):
            continue
        state = coverage.get("status") or "unknown"
        states.add(state)
        start, end = _dt(coverage.get("coverage_start")), _dt(coverage.get("coverage_end"))
        if start: starts.append(start)
        if end: ends.append(end)
        if item.get("currency"): currencies.add(item["currency"])
        if (item.get("period") or {}).get("timezone"): timezones.add(item["period"]["timezone"])
    if not starts or not ends:
        state = "unknown"
        missing.append("No certified earliest and latest observation window is available.")
    else:
        req_start, req_end = _dt((requested or {}).get("start")), _dt((requested or {}).get("end"))
        earliest, latest = min(starts), max(ends)
        if req_start and earliest > req_start:
            state = "insufficient_history"
            missing.append("The requested period predates the certified historical coverage.")
        elif req_end and latest < req_end:
            state = "insufficient_coverage"
            missing.append("The certified historical coverage ends before the requested period ends.")
        elif states == {"complete"}:
            state = "verified"
        else:
            state = "incomplete"
            missing.append("The source population or comparison period is not certified complete.")
    compared = (comparison or {}).get("status") if comparison else None
    comparison_state = "not_requested"
    if comparison:
        comparison_state = ("insufficient_history" if compared in ("insufficient_history", "period_unavailable")
                            else "eligible" if compared == "available" else "ineligible")
        if comparison_state != "eligible": missing.append("The comparison periods do not have equivalent certified coverage and populations.")
    return {
        "state": state, "available_start": min(starts).isoformat() if starts else None,
        "available_end": max(ends).isoformat() if ends else None,
        "requested_period": requested, "missing": list(dict.fromkeys(missing)),
        "comparison_eligibility": comparison_state,
        "population": {"state": "certified" if states == {"complete"} else "uncertified",
                       "currencies": sorted(currencies), "timezones": sorted(timezones)},
        "distinctions": ["integration_age_is_not_history", "no_rows_is_not_verified_zero"],
    }


def derive_outcome(*, investigation_id: str, question: str, intent: str, organization_id: str,
                   store_ids: list[str], tools: list[str], tool_results: dict[str, Any],
                   tool_failures: dict[str, dict], items: list[dict], period: dict,
                   comparison: dict | None, overall_status: str) -> dict:
    required = sorted({domain for tool in tools for domain in TOOL_DOMAINS.get(tool, []) if domain != "integration"})
    result = base_outcome(outcome="success", investigation_id=investigation_id, question=question,
                          intent=intent, organization_id=organization_id, store_ids=store_ids,
                          required_domains=required, period=period)
    integration = (getattr(tool_results.get("integration_health"), "diagnostics", None) or {}).get("integration") or {}
    stores = integration.get("stores") or []
    connection_states = [((s.get("connection") or {}).get("state")) for s in stores]
    if integration.get("overall_status"):
        result["integration"] = {"state": integration["overall_status"],
                                 "authorization": (integration.get("components") or {}).get("authorization", "unknown")}
    sync_diags, retrieval_diags = [], []
    unavailable = set()
    retryable = False
    for store in stores:
        for domain, sync in (store.get("synchronization") or {}).items():
            if sync.get("state") not in ("succeeded",):
                sync_diags.append({"store_id": store.get("store_id"), "domain": domain,
                                   "state": sync.get("state"), "failure_class": sync.get("failure_class"),
                                   "stale": sync.get("stale") is True,
                                   "retry_count": sync.get("retry_count", 0)})
                if sync.get("state") in ("failed", "running") or sync.get("stale"):
                    retryable = retryable or sync.get("failure_class") in ("network", "rate_limit", "shopify_api", "database", "scheduler")
    for tool in tools:
        tr = tool_results.get(tool)
        if tr is not None and getattr(tr, "status", None) in ("available", "verified_zero"):
            continue
        if tr is not None and getattr(tr, "status", None) == "partial":
            retrieval_diags.append({"tool": tool, "state": "partial", "domains": TOOL_DOMAINS.get(tool, [])})
            continue
        failure = tool_failures.get(tool) or {}
        state = failure.get("outcome") or "retrieval_failed"
        if tr is not None and getattr(tr, "status", None) == "unsupported": state = "unsupported_capability"
        if tr is not None and getattr(tr, "status", None) == "unauthorized": state = "permission_insufficient"
        for domain in TOOL_DOMAINS.get(tool, []):
            if domain != "integration": unavailable.add(domain)
        retrieval_diags.append({"tool": tool, "state": state, "domains": TOOL_DOMAINS.get(tool, []),
                                "error_class": failure.get("error_class")})
        retryable = retryable or failure.get("retry_eligible", False)
    available = sorted(set(required) - unavailable)
    result["available_domains"] = available
    result["unavailable_domains"] = sorted(unavailable)
    result["sync"] = {"state": "failed" if any(d["state"] == "failed" for d in sync_diags)
                      else "in_progress" if any(d["state"] == "running" for d in sync_diags)
                      else "stale" if any(d.get("stale") for d in sync_diags)
                      else "degraded" if sync_diags else "not_required", "diagnostics": sync_diags[:30]}
    result["retrieval"] = {"state": "partial" if available and unavailable else "failed" if unavailable else "complete",
                           "diagnostics": retrieval_diags[:30]}
    result["history"] = history_assessment(items, period, comparison)
    result["coverage"] = {
        "state": result["history"]["state"], "complete": result["history"]["state"] == "verified",
        "freshness": next(((i.get("freshness") or {}).get("state") for i in items if i.get("freshness")), "unknown"),
    }
    # Integration failures dominate only when they block all independent evidence.
    outcome = "success" if overall_status == "complete" else "partial_success" if overall_status == "partial" else "insufficient_coverage"
    if result["history"]["state"] == "insufficient_history" and not unavailable:
        outcome = "insufficient_history"
    if not stores and tool_results.get("store_health") is not None and getattr(tool_results["store_health"], "status", "") == "unavailable":
        outcome = "retrieval_failed"
    if any(s in ("disconnected", "revoked", "not_installed") for s in connection_states): outcome = "integration_disconnected"
    elif any(s in ("verification_failed", "authentication_invalid") for s in connection_states): outcome = "authorization_expired"
    elif result["integration"]["authorization"] == "failed" and not available: outcome = "permission_insufficient"
    elif result["sync"]["state"] == "in_progress" and not available: outcome = "sync_in_progress"
    elif result["sync"]["state"] == "stale" and not available: outcome = "sync_stale"
    elif result["sync"]["state"] == "failed" and not available: outcome = "sync_failed"
    elif unavailable and not available: outcome = "source_unavailable" if overall_status == "insufficient_data" else outcome
    result["outcome"] = outcome
    supported_facts = [i for i in items if i.get("status") in ("available", "verified_zero")]
    result["answerability"] = {
        "can_answer": ["Independent evidence that was retrieved and validated remains answerable."] if supported_facts else [],
        "cannot_establish": ([f"Conclusions requiring {', '.join(sorted(unavailable))} evidence cannot be established."] if unavailable else [])
                            + result["history"]["missing"],
    }
    next_steps = {
        "integration_disconnected": "Reconnect Shopify, then ask to continue this investigation after a new sync is verified.",
        "authorization_expired": "Reconnect Shopify to renew authorization, then ask to continue; reconnection is not assumed from a message alone.",
        "permission_insufficient": "Review and grant the required Shopify permissions, then retry the affected investigation.",
        "sync_in_progress": "Wait for the current synchronization to finish; no duplicate sync is needed.",
        "sync_stale": "Check synchronization status and retry the investigation after a fresh successful sync.",
        "sync_failed": "Check synchronization status and retry only the failed source when eligible.",
        "retrieval_failed": "Retry this investigation if the failure was transient; otherwise contact support with the diagnostic reference.",
        "source_unavailable": "Retry the affected source or contact support with the diagnostic reference.",
        "insufficient_history": "Ask for a current-period observation or choose a narrower period inside the certified history.",
        "insufficient_coverage": "Use a narrower supported period or wait for complete synchronized coverage before comparing.",
        "partial_success": "Review the supported findings, then restore only the unavailable domains needed for the remaining conclusions.",
        "success": None,
    }
    result["next_step"] = next_steps[outcome]
    result["retry"] = {"eligible": retryable or outcome == "retrieval_failed",
                       "status": "not_requested", "preserves_question": True, "preserves_period": True,
                       "starts_sync": False, "deduplicates_sync": True}
    return result


def validate_outcome(value: Any, *, organization_id: str | None = None) -> list[str]:
    errors = []
    if not isinstance(value, dict): return ["outcome_not_object"]
    if value.get("contract_version") != OUTCOME_CONTRACT_VERSION: errors.append("outcome_contract_version")
    if value.get("outcome") not in OUTCOMES: errors.append("outcome_classification")
    if organization_id and (value.get("tenant") or {}).get("organization_id") != organization_id: errors.append("outcome_tenant_mismatch")
    for key in ("required_domains", "available_domains", "unavailable_domains"):
        if not isinstance(value.get(key), list): errors.append(f"outcome_{key}")
    if not isinstance(value.get("answerability"), dict): errors.append("outcome_answerability")
    if not isinstance(value.get("retry"), dict) or not isinstance(value["retry"].get("eligible"), bool): errors.append("outcome_retry")
    if not value.get("diagnostic_reference"): errors.append("outcome_diagnostic_reference")
    # No accidental infrastructure disclosure in the structured merchant contract.
    for forbidden in ("stack", "traceback", "access_token", "database_url", "connection_string"):
        if forbidden in value: errors.append("outcome_sensitive_field")
    return sorted(set(errors))
