"""Task 208 — executable revenue, retention and operational specialists.

Specialists consume the same authorized evidence as the investigation runtime;
they do not query independently, call an LLM, or mint new financial numbers.
The structured result is validated locally and again at the Node boundary.
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Callable

CONTRACT_VERSION = "rev-specialist-execution-v1"
SPECIALIST_VERSION = "1.0.0"
SPECIALISTS = ("revenue", "retention", "operational")
STAGES = (
    "request_received", "intent_domain_validated", "specialist_selected",
    "required_capabilities_determined", "evidence_requirements_identified",
    "evidence_retrieved_authorized", "evidence_quality_evaluated",
    "domain_analysis_performed", "calculations_validated",
    "findings_recommendations_generated", "epistemic_classifications_validated",
    "evidence_references_validated", "specialist_result_returned",
    "conversation_context_incorporated",
)
AVAILABLE = {"available", "verified_zero"}
CAPABILITIES = {
    "revenue": ("revenue_observations", "order_observations", "refund_observations"),
    "retention": ("customer_observations", "order_observations"),
    "operational": ("order_observations", "product_observations", "integration_health"),
}
REQUIRED_TOOLS = {
    "revenue": ("revenue_observations", "order_observations"),
    "retention": ("customer_observations",),
    "operational": ("integration_health",),
}
METRICS = {
    "revenue": {
        "recorded_order_value", "recorded_order_count", "average_order_value", "gross_sales",
        "refund_amount", "refund_amount_window_orders", "discount_amount", "cancelled_count",
        "product_order_lines", "variant_order_lines", "product_recorded_value", "product_units_sold",
        "order_count", "line_items_value", "captured_payment_amount", "test_order_count",
    },
    "retention": {
        "ordering_customer_count", "customer_associated_order_count", "repeat_within_window_customer_count",
        "repeat_within_window_customer_rate", "returning_customer_count", "returning_customer_rate",
        "first_time_customer_count", "newly_observed_customer_count", "repeat_purchase_interval_days",
        "customer_cohort_90d",
    },
    "operational": {
        "product_evidence", "fulfilled_count", "unfulfilled_count", "partially_fulfilled_count",
        "delayed_unfulfilled_count", "split_fulfillment_count", "open_count", "closed_count",
        "refunded_count", "partially_refunded_count", "cancelled_count", "integration_overall_status",
        "integration_connection_state", "resource_capability", "webhook_health", "order_count",
    },
}


def select_specialists(intent: str, question: str) -> list[str]:
    text = (question or "").lower()
    retention = bool(re.search(r"\b(?:retention|repeat|returning|cohort|customers? (?:come|coming|purchase|purchased)|second purchase|churn|loyal)", text))
    operational = bool(re.search(r"\b(?:inventory|stock|fulfil|fulfill|shipping|delivery|unfulfilled|operational|syncing|synchronization|webhook|integration|product availability)", text))
    revenue = bool(re.search(r"\b(?:revenue|sales|aov|average order|order value|orders?|refunds?|discounts?|cancell?|products? .*revenue|performing|performance|priority|issue first)", text))
    if intent == "customer_retention":
        retention = True
    if intent == "product_investigation":
        operational = operational or not revenue
    if intent == "data_coverage":
        operational = True
        revenue = retention = False
    if intent in {"revenue_investigation", "refund_investigation", "checkout_investigation"}:
        revenue = True
    if intent == "store_overview":
        revenue = retention = operational = True
    if intent == "finding_investigation" and not (revenue or retention or operational):
        revenue = operational = True
    return [name for name in SPECIALISTS if {"revenue": revenue, "retention": retention, "operational": operational}[name]]


def _lifecycle(failed_at: str | None = None) -> list[dict]:
    result = []
    for stage in STAGES:
        status = "failed" if stage == failed_at else "completed"
        result.append({"stage": stage, "status": status})
        if stage == failed_at:
            result.extend({"stage": remaining, "status": "not_executed"}
                          for remaining in STAGES[STAGES.index(stage) + 1:])
            break
    return result


def _fact(item: dict) -> dict:
    classification = item.get("classification")
    grade = "calculated_observation" if classification == "deterministic_calculation" else "verified_fact"
    value = item.get("value")
    if item.get("metric") == "product_evidence" and isinstance(value, dict):
        # Preserve operational relationships without duplicating the complete
        # product evidence payload in every specialist result.
        value = {
            "product_id": value.get("product_id"), "title": value.get("title"),
            "inventory_coverage_complete": value.get("inventory_coverage_complete"),
            "variants": [{
                "variant_id": variant.get("variant_id"), "title": variant.get("title"),
                "sku": variant.get("sku"), "tracked": variant.get("tracked"),
                "available_for_sale": variant.get("available_for_sale"),
                "inventory_status": variant.get("inventory_status"),
                "inventory_levels": [{
                    "location_id": level.get("location_id"), "location_active": level.get("location_active"),
                    "quantities": level.get("quantities"), "synced_at": level.get("synced_at"),
                } for level in (variant.get("inventory_levels") or [])[:50]],
            } for variant in (value.get("variants") or [])[:100]],
        }
    return {
        "metric": item.get("metric"), "label": item.get("label"), "value": value,
        "unit": item.get("unit"), "currency": item.get("currency"), "period": item.get("period"),
        "definition": item.get("definition"), "epistemic_grade": grade,
        "evidence_references": [item["id"]], "status": item.get("status"),
    }


def _comparison_findings(name: str, facts: list[dict], current_period: dict) -> list[dict]:
    """Calculate changes only between identical metric/currency definitions."""
    eligible = {
        "revenue": {"recorded_order_value", "recorded_order_count", "average_order_value", "refund_amount", "discount_amount"},
        "retention": {"repeat_within_window_customer_rate", "returning_customer_rate", "repeat_within_window_customer_count", "returning_customer_count"},
        "operational": {"unfulfilled_count", "delayed_unfulfilled_count", "partially_fulfilled_count"},
    }[name]
    grouped: dict[tuple, list[dict]] = {}
    for fact in facts:
        if fact.get("metric") in eligible and fact.get("value") is not None:
            grouped.setdefault((fact["metric"], fact.get("currency")), []).append(fact)
    derived: list[dict] = []
    for (metric, currency), group in grouped.items():
        current = next((fact for fact in group if (fact.get("period") or {}).get("start") == current_period.get("start")), None)
        previous = next((fact for fact in group if fact is not current), None)
        if not current or not previous:
            continue
        try:
            current_value, previous_value = Decimal(str(current["value"])), Decimal(str(previous["value"]))
        except Exception:
            continue
        unit = "percentage_points" if str(current.get("unit")) == "ratio" else current.get("unit")
        difference = (current_value - previous_value) * 100 if unit == "percentage_points" else current_value - previous_value
        derived.append({
            "metric": f"{metric}_change", "label": f"Change in {metric.replace('_', ' ')}",
            "value": str(difference), "unit": unit, "currency": currency, "period": current.get("period"),
            "definition": f"Current {metric} minus the immediately retrieved comparison value with the same metric definition and currency.",
            "epistemic_grade": "calculated_observation",
            "evidence_references": list(dict.fromkeys(current["evidence_references"] + previous["evidence_references"])),
            "status": "available", "comparison_period": previous.get("period"),
        })
    return derived


def _recommendation(name: str, facts: list[dict], question: str) -> dict | None:
    by_metric = {fact["metric"]: fact for fact in facts}
    refs = list(dict.fromkeys(ref for fact in facts[:4] for ref in fact["evidence_references"]))
    base = {"executed": False, "read_only": True, "requires": "merchant decision",
            "state": "recommended", "evidence_ids": refs, "specialist": name,
            "priority": "normal", "causal_status": "observed"}
    if name == "revenue":
        if any(f["metric"] == "product_order_lines" for f in facts):
            return {**base, "label": "Review the highest-contribution product lines in Shopify before changing merchandising",
                    "why": "Historical line value identifies where recorded sales are concentrated; it does not prove profit or causation.",
                    "rationale": "Product-line concentration is measurable in the current evidence.",
                    "measure": "Units, distinct orders and historical line value by product, variant and currency."}
        if any(f["metric"] in {"refund_amount", "refund_amount_window_orders"} for f in facts):
            return {**base, "label": "Reconcile the recorded refund and discount drivers separately",
                    "why": "Refund-date money, refunds on window orders, discounts and net order value have different meanings and must not be double-counted.",
                    "rationale": "The revenue evidence contains a refund or adjustment measure.",
                    "measure": "Refund amount by attribution basis, discount amount and net recorded order value per currency."}
        return {**base, "label": "Investigate order count and average order value separately for the same currency and period",
                "why": "Separating volume from per-order value narrows the arithmetic driver without asserting a cause.",
                "rationale": "Revenue and order evidence is available for a deterministic decomposition.",
                "measure": "Non-cancelled order count, recorded order value and AOV per currency against the eligible comparison."}
    if name == "retention":
        if any(f["metric"] == "customer_cohort_90d" for f in facts):
            return {**base, "label": "Compare only cohorts with complete 90-day observation windows",
                    "why": "Immature cohorts have had less time to repeat and cannot be ranked directly against mature cohorts.",
                    "rationale": "Cohort entry and maturity are explicitly measured.",
                    "measure": "Repeat-within-90-days customers divided by mature entered customers for each cohort."}
        return {**base, "label": "Review the purchase cadence of customers with an observed second order",
                "why": "An observed first-to-second interval is actionable without assigning churn or intent to customers who have not returned.",
                "rationale": "Customer/order associations support aggregate repeat analysis.",
                "measure": "Within-window repeat-customer rate and median first-to-second interval; monitor cohort maturity before comparing periods."}
    delayed = by_metric.get("delayed_unfulfilled_count")
    if delayed and isinstance(delayed.get("value"), (int, float)) and delayed["value"] > 0:
        return {**base, "priority": "high", "label": "Review open unfulfilled orders older than 72 hours in Shopify Admin",
                "why": "These orders cross a disclosed age threshold; the reason and any merchant SLA breach remain unverified.",
                "rationale": "Delayed unfulfilled orders are directly observed in the canonical order aggregate.",
                "measure": "Resolve the operational blocker, then compare the delayed-unfulfilled count at the next fresh sync."}
    if any(f["metric"] == "product_evidence" for f in facts):
        return {**base, "label": "Review variant-level available quantity across every active location before replenishment decisions",
                "why": "One location's zero does not establish a store-wide stockout, and current snapshots do not reconstruct history.",
                "rationale": "Variant/location inventory evidence is available.",
                "measure": "Available, on-hand, committed and other source-supported quantities by variant and location at the next sync."}
    return {**base, "label": "Check the affected Shopify resource synchronization and then review unfulfilled work",
            "why": "Business issues and stale/incomplete integration evidence require different remediation.",
            "rationale": "Operational conclusions depend on resource capability and freshness.",
            "measure": "Resource sync status, pagination completeness, freshness and distinct unfulfilled orders."}


def _inventory_limitations(facts: list[dict]) -> list[str]:
    if not any(fact["metric"] == "product_evidence" for fact in facts):
        return []
    return ["Current inventory snapshots cannot establish historical stock levels, stockout duration or lost revenue."]


def _base(name: str, execution_id: str, question: str, intent: str, organization_id: str,
          store_ids: list[str], period: dict, investigation_id: str) -> dict:
    return {
        "contract_version": CONTRACT_VERSION,
        "specialist": {"name": name, "version": SPECIALIST_VERSION},
        "execution_id": execution_id, "investigation_id": investigation_id,
        "request": question, "resolved_intent": intent,
        "tenant": {"organization_id": organization_id, "store_ids": sorted(store_ids)},
        "period": period, "required_capabilities": list(CAPABILITIES[name]),
        "required_evidence_domains": list(REQUIRED_TOOLS[name]), "retrieved_evidence_domains": [],
        "status": "error", "verified_facts": [], "calculated_findings": [],
        "hypotheses": [], "unknowns": [], "evidence_references": [],
        "coverage": {"state": "unknown", "complete": False}, "freshness": {"state": "unknown"},
        "currency_integrity": {"aggregation": "separate_by_currency", "currencies": [], "mixed_currency_totals": False},
        "findings": [], "recommendations": [], "investigation_outcome": "internal_error",
        "limitations": [], "unsupported_capabilities": [], "lifecycle": _lifecycle("domain_analysis_performed"),
        "diagnostics": {"error_class": "not_executed", "read_only": True},
        "follow_up_context": {"investigation_id": investigation_id, "execution_id": execution_id},
        "contradictions": [],
    }


def _analyze(name: str, result: dict, items: list[dict], tools: dict, question: str) -> None:
    result["lifecycle"] = _lifecycle()
    required = REQUIRED_TOOLS[name]
    failed = [tool for tool in required if tool not in tools or getattr(tools[tool], "status", None) in {"unavailable", "unsupported"}]
    result["retrieved_evidence_domains"] = sorted(tool for tool in CAPABILITIES[name] if tool in tools)
    candidates = [item for item in items if item.get("metric") in METRICS[name]
                  or (name == "operational" and str(item.get("metric", "")).startswith("integration."))]
    usable = [item for item in candidates if item.get("status") in AVAILABLE]
    unavailable = [item for item in candidates if item.get("status") not in AVAILABLE]
    facts = [_fact(item) for item in usable[:40]]
    facts.extend(_comparison_findings(name, facts, result["period"]))
    result["verified_facts"] = [fact for fact in facts if fact["epistemic_grade"] == "verified_fact"]
    result["calculated_findings"] = [fact for fact in facts if fact["epistemic_grade"] == "calculated_observation"]
    result["evidence_references"] = [item["id"] for item in usable[:40]]
    result["currency_integrity"]["currencies"] = sorted({item["currency"] for item in usable if item.get("currency")})
    coverage_items = [item.get("coverage") for item in candidates if isinstance(item.get("coverage"), dict)]
    freshness_items = [item.get("freshness") for item in candidates if isinstance(item.get("freshness"), dict)]
    result["coverage"] = {
        "state": "verified" if coverage_items and all(c.get("complete") for c in coverage_items) else "partial" if coverage_items else "unknown",
        "complete": bool(coverage_items and all(c.get("complete") for c in coverage_items)),
    }
    result["freshness"] = next((f for f in freshness_items if f.get("state") in {"stale", "unknown"}),
                               freshness_items[0] if freshness_items else {"state": "unknown"})
    result["unknowns"] = [f"{item.get('label') or item.get('metric')}: {item.get('status')}"
                          for item in unavailable[:8]]
    result["limitations"] = list(dict.fromkeys(
        limitation for item in candidates for limitation in item.get("limitations", [])))[:12]
    result["limitations"].extend(_inventory_limitations(facts))
    if name == "retention":
        result["limitations"].append("No satisfaction, loyalty, churn probability, future LTV, purchase intent or campaign effect is inferred.")
        result["hypotheses"] = []  # retention observations never become behavioral explanations
    elif name == "revenue" and facts:
        result["hypotheses"] = [{"statement": "Order volume, AOV, product mix, refunds and availability are separate investigation paths; none is established as the cause by this evidence.",
                                 "verified": False, "causal_status": "hypothesis",
                                 "evidence_references": result["evidence_references"][:4]}]
    elif name == "operational" and facts:
        result["hypotheses"] = [{"statement": "An inventory or fulfillment observation may coexist with revenue changes, but operational causation or lost revenue is not established.",
                                 "verified": False, "causal_status": "hypothesis",
                                 "evidence_references": result["evidence_references"][:4]}]
    recommendation = _recommendation(name, facts, question) if facts else None
    result["recommendations"] = [recommendation] if recommendation else []
    result["findings"] = [{"finding_key": f"{name}:{fact['metric']}:{index}", "lifecycle_state": "observed",
                           "priority": "high" if fact["metric"] == "delayed_unfulfilled_count" and fact.get("value") else "normal",
                           "metric": fact["metric"], "evidence_references": fact["evidence_references"]}
                          for index, fact in enumerate(facts[:20])]
    if failed:
        result["diagnostics"] = {"error_class": "required_evidence_unavailable", "failed_tools": failed, "read_only": True}
    else:
        result["diagnostics"] = {"error_class": None, "read_only": True, "shared_evidence_retrieval": True}
    if facts and failed:
        result["status"], result["investigation_outcome"] = "partial", "partial_success"
    elif facts:
        partial = bool(unavailable) or not result["coverage"]["complete"]
        result["status"] = "partial" if partial else "success"
        result["investigation_outcome"] = "partial_success" if partial else "success"
    elif candidates or failed:
        result["status"], result["investigation_outcome"] = "no_data", "insufficient_coverage" if not failed else "retrieval_failed"
    else:
        # Valid zero is represented by a canonical zero-valued evidence item;
        # no candidates means the required capability did not execute.
        result["status"], result["investigation_outcome"] = "no_data", "insufficient_coverage"
        result["unknowns"].append("The specialist retrieved no eligible evidence; this is not a verified zero-result investigation.")


def validate_specialist_result(result: Any, *, organization_id: str, evidence_ids: set[str]) -> list[str]:
    errors: list[str] = []
    if not isinstance(result, dict):
        return ["specialist_not_object"]
    if result.get("contract_version") != CONTRACT_VERSION:
        errors.append("specialist_contract_version")
    if (result.get("specialist") or {}).get("name") not in SPECIALISTS:
        errors.append("specialist_identity")
    if (result.get("tenant") or {}).get("organization_id") != organization_id:
        errors.append("specialist_tenant")
    if not result.get("execution_id") or not result.get("investigation_id"):
        errors.append("specialist_execution_identity")
    if result.get("status") not in {"success", "partial", "no_data", "error"}:
        errors.append("specialist_status")
    if result.get("status") in {"success", "partial"} and not (result.get("verified_facts") or result.get("calculated_findings")):
        errors.append("specialist_empty_success")
    if len(result.get("lifecycle") or []) != len(STAGES):
        errors.append("specialist_lifecycle")
    refs = list(result.get("evidence_references") or [])
    for collection in ("verified_facts", "calculated_findings"):
        for fact in result.get(collection) or []:
            refs.extend(fact.get("evidence_references") or [])
            if fact.get("epistemic_grade") not in {"verified_fact", "calculated_observation"}:
                errors.append("specialist_epistemics")
    if any(ref not in evidence_ids for ref in refs):
        errors.append("specialist_evidence_reference")
    for rec in result.get("recommendations") or []:
        if rec.get("executed") is not False or rec.get("read_only") is not True:
            errors.append("specialist_action_state")
        if any(ref not in evidence_ids for ref in rec.get("evidence_ids") or []):
            errors.append("specialist_recommendation_reference")
    # Customer PII and infrastructure details are never valid specialist fields.
    def sensitive_keys(value: Any, depth: int = 0) -> bool:
        if depth > 10:
            return True
        if isinstance(value, dict):
            return any(re.search(r"^(?:email|phone|address|access_token|database_url|connection_string|traceback|stack)$", str(key), re.I)
                       or sensitive_keys(child, depth + 1) for key, child in value.items())
        if isinstance(value, list):
            return any(sensitive_keys(child, depth + 1) for child in value)
        return False
    if sensitive_keys(result):
        errors.append("specialist_sensitive_field")
    return sorted(set(errors))


def reconcile_specialists(results: list[dict]) -> list[dict]:
    """Disclose conflicting values instead of manufacturing agreement."""
    seen: dict[tuple, tuple[dict, dict]] = {}
    for result in results:
        for fact in [*(result.get("verified_facts") or []), *(result.get("calculated_findings") or [])]:
            period = fact.get("period") or {}
            key = (fact.get("metric"), fact.get("currency"), period.get("start"), period.get("end"))
            previous = seen.get(key)
            if previous and str(previous[1].get("value")) != str(fact.get("value")):
                for owner, other in (previous, (result, fact)):
                    code = f"contradictory_metric:{fact.get('metric')}"
                    owner["contradictions"] = list(dict.fromkeys([*owner.get("contradictions", []), code]))
                    owner["status"] = "partial"
                    owner["investigation_outcome"] = "partial_success"
                    owner["unknowns"].append(f"Conflicting values for {fact.get('metric')} were not reconciled.")
            else:
                seen[key] = (result, fact)
    return results


def execute_specialists(*, intent: str, question: str, organization_id: str, store_ids: list[str],
                        investigation_id: str, period: dict, items: list[dict], tools: dict,
                        selected: list[str] | None = None) -> list[dict]:
    names = selected if selected is not None else select_specialists(intent, question)
    evidence_ids = {item.get("id") for item in items if item.get("id")}
    results: list[dict] = []
    for name in names:
        if name not in SPECIALISTS:
            continue
        execution_id = str(uuid.uuid4())
        result = _base(name, execution_id, question, intent, organization_id, store_ids, period, investigation_id)
        try:
            _analyze(name, result, items, tools, question)
            errors = validate_specialist_result(result, organization_id=organization_id, evidence_ids=evidence_ids)
            if errors:
                raise ValueError(",".join(errors))
        except Exception as exc:
            failed = _base(name, execution_id, question, intent, organization_id, store_ids, period, investigation_id)
            failed["diagnostics"] = {"error_class": type(exc).__name__, "read_only": True}
            failed["unknowns"] = ["The specialist did not complete; no domain conclusion is returned."]
            result = failed
        results.append(result)
    return reconcile_specialists(results)
