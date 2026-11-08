"""Task 211 — evidence-bound recommendations and selected-finding continuity.

The finding row and its finding-evidence item remain authoritative. This module
only derives read-only advisor contracts; it never writes merchant data or
interprets selection/acknowledgement as execution.
"""
from __future__ import annotations

import hashlib
import re
import uuid
from datetime import datetime, timezone
from typing import Any

RECOMMENDATION_CONTRACT_VERSION = "rev-recommendation-v1"
SELECTED_FINDING_CONTRACT_VERSION = "rev-selected-finding-v1"
RECOMMENDATION_STATES = {"proposed", "presented", "acknowledged", "dismissed", "superseded", "invalidated", "resolved"}
UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


def _iso(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value)
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    except ValueError:
        return None


def _finding_record(item: dict | None) -> dict:
    if not item or item.get("metric") != "finding_evidence" or not isinstance(item.get("value"), dict):
        return {}
    return item["value"]


def selected_finding_reference(message: str, context_payload: dict | None,
                               conversation_context: dict | None, *, topic_change: bool = False) -> dict | None:
    """Resolve precedence without trusting client-supplied finding evidence.

    Explicit current selection wins. Otherwise the last server-persisted finding
    is inherited only for a continuing topic. The Python finding tool resolves
    the identifier again under the authenticated organization and active store.
    """
    if topic_change:
        return None
    supplied = (context_payload or {}).get("selected_finding")
    if supplied is not None:
        if not isinstance(supplied, dict) or not UUID_RE.fullmatch(str(supplied.get("finding_id") or "")):
            raise ValueError("invalid selected finding reference")
        return {"finding_id": str(supplied["finding_id"]).lower(), "selection_source": "explicit_selection",
                "selected_at": _iso(supplied.get("selected_at"))}
    prior = (conversation_context or {}).get("last_selected_finding")
    if isinstance(prior, dict) and UUID_RE.fullmatch(str(prior.get("finding_id") or "")):
        return {"finding_id": str(prior["finding_id"]).lower(), "selection_source": "conversation_context",
                "selected_at": _iso(prior.get("selected_at"))}
    # An explicit finding UUID is a reference, not evidence. Never reinterpret
    # tenant-injection text as a finding selection: even an authorized lookup
    # must not copy a forged organization identifier into tool parameters.
    tenant_assignment = re.search(r"\b(?:organization|organisation|tenant)(?:_id)?\s*[:=]", message or "", re.I)
    match = None if tenant_assignment else re.search(r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b", message or "")
    if match:
        return {"finding_id": match.group(0).lower(), "selection_source": "explicit_message", "selected_at": None}
    return None


def build_selected_finding(item: dict, *, organization_id: str, investigation_id: str,
                           reference: dict, now: datetime) -> dict | None:
    record = _finding_record(item)
    finding_id = str(record.get("finding_id") or "")
    if not record or finding_id.lower() != reference["finding_id"].lower():
        return None
    evidence = record.get("supporting_evidence") or {}
    lifecycle = str(record.get("lifecycle_status") or "unknown")
    validity = str(record.get("current_validity") or "evidence_unverified")
    freshness = item.get("freshness") or {}
    coverage = item.get("coverage") or {}
    quality = "verified" if validity == "current_evidence_verified" else (
        "stale" if validity == "stale_unreverified" else "partial" if item.get("status") == "partial" else "unverified")
    limitations = list(dict.fromkeys([*(item.get("limitations") or []),
        *(["This finding is stale and requires fresh evidence before it can remain a current priority."] if validity == "stale_unreverified" else []),
        *(["This finding is historical, not a current unresolved priority."] if validity.startswith("historical_") else [])]))[:8]
    resources = [{"resource": "order", "source_id": str(row.get("external_order_id")),
                  "order_name": row.get("order_name")}
                 for row in (record.get("underlying_order_records") or [])[:20] if row.get("external_order_id")]
    return {
        "contract_version": SELECTED_FINDING_CONTRACT_VERSION,
        "finding_id": finding_id,
        "finding_version": _iso(record.get("updated_at")) or _iso(record.get("detected_at")),
        "tenant": {"organization_id": organization_id, "store_ids": [str(record.get("store_id"))]},
        "investigation_id": investigation_id,
        "title": record.get("title"), "type": record.get("type"),
        "lifecycle_state": lifecycle, "current_validity": validity,
        "observation": {"title": record.get("title"), "description": record.get("description"),
                        "severity": record.get("severity"), "dedupe_key": record.get("dedupe_key")},
        "metrics": {key: evidence[key] for key in ("currentCount", "previousCount", "currentRevenue", "previousRevenue",
                    "currentReturning", "previousReturning", "currentRefundTotal", "previousRefundTotal",
                    "refund_coverage_complete", "refund_sync_run_id", "delta_pct", "current_rate_pct", "previous_rate_pct") if key in evidence},
        "period": item.get("period"), "currency": evidence.get("currency"),
        "evidence_references": [item["id"]], "evidence_quality": quality,
        "confidence": (item.get("confidence") or {}).get("level") or "low",
        "recommendation_history": [], "investigation_history": [], "limitations": limitations,
        "missing_information": ([] if quality == "verified" else ["Fresh, verified source evidence is required for a current conclusion."]),
        "resource_references": resources,
        "coverage": {"status": coverage.get("status"), "complete": coverage.get("complete")},
        "freshness": {"state": freshness.get("state"), "as_of": freshness.get("as_of")},
        "selection_source": reference.get("selection_source") or "explicit_selection",
        "selected_at": reference.get("selected_at") or now.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "invalidation": {"invalidated": quality != "verified" or lifecycle not in {"open", "acknowledged"},
                         "reason": validity if quality != "verified" or lifecycle not in {"open", "acknowledged"} else None},
    }


_CATEGORY = {
    "integration_failure": "data_integration_resolution", "revenue_change": "investigate",
    "order_volume_change": "investigate", "returning_customer_change": "compare",
    "refund_increase": "review", "checkout_abandonment": "investigate",
    "inventory_stockout": "operational_follow_up",
}
_DEFAULT_STEPS = {
    "integration_failure": ("Review Shopify authorization and the latest synchronization status for this store. Resolve the reported connection or sync failure before relying on current-period conclusions.",
        "The failed or stale integration prevents verification of newer commerce evidence.",
        "Confirm a successful synchronization and then rerun this finding against the refreshed coverage window."),
    "revenue_change": ("Compare order count and average order value for this finding's two equal-length periods, then review the products with the largest verified completed-order change.",
        "The verified revenue movement identifies where to investigate, but does not establish its cause or recoverable revenue.",
        "Repeat the same currency-separated comparison over a subsequent equal-length period and check whether the recorded difference persists."),
    "order_volume_change": ("Review product-level completed-order counts for the two recorded periods and compare current availability for the products with the largest verified change.",
        "Order-volume movement narrows the affected products; current stock does not prove historical availability or causation.",
        "Compare completed-order counts over the next equivalent period and document any independently verified operational change."),
    "returning_customer_change": ("Compare verified returning-buyer counts and prior-purchase coverage for both periods before reviewing repeat-purchase cadence.",
        "The purchasing-customer share changed, but the evidence does not explain buyer intent or churn.",
        "Recalculate the same returning-buyer share after an equivalent period with certified customer-order history."),
    "refund_increase": ("Review the refund transactions in this finding's current period in Shopify Admin. Compare their affected orders, products and recorded refund reasons with the previous period to see whether the increase is concentrated in a particular product or issue.",
        "The refund finding identifies recorded adjustment activity, not its shopper cause or a recoverable revenue amount.",
        "Compare refund value using the same transaction-date attribution and currency in the next equivalent period."),
    "checkout_abandonment": ("Review incomplete checkouts from the selected period and compare their products and values with completed orders.",
        "Incomplete checkout activity is verified, but the reason shoppers did not complete purchases remains unknown.",
        "Compare the same incomplete-checkout measures over an equivalent later period without treating cart value as recoverable revenue."),
    "inventory_stockout": ("Review the affected variants and available inventory at each recorded location, then compare them with completed-order activity for those products.",
        "The current stock position identifies what to inspect; it does not establish historical stockouts or lost revenue.",
        "Recheck variant/location availability and product-level completed orders after the next verified synchronization."),
}


def _recommendation_for_finding(selected: dict, item: dict, *, organization_id: str,
                                investigation_id: str, now: datetime) -> dict:
    record = _finding_record(item)
    action = record.get("recommendation_context") or {}
    kind = str(selected.get("type") or "finding")
    step, why, validation = _DEFAULT_STEPS.get(kind, (
        str(action.get("guidance") or action.get("description") or "Review the authorized records supporting this finding and verify the observed change before considering a merchant-controlled response."),
        "This is the next investigation supported by the finding; its underlying cause is not established.",
        str(action.get("measurement") or action.get("measure") or "Recheck the same metric and comparable reporting period after new verified evidence arrives.")))
    # Known finding types use the canonical subject-specific step. Producer
    # guidance remains a fallback for new types, never a generic replacement
    # for the more precise validated template above.
    if kind not in _DEFAULT_STEPS and action.get("measurement"): 
        validation = str(action["measurement"])
    quality = selected["evidence_quality"]
    lifecycle = selected["lifecycle_state"]
    current = quality == "verified" and lifecycle in {"open", "acknowledged"}
    state = "presented" if current else "resolved" if lifecycle == "resolved" else "superseded" if lifecycle == "superseded" else "invalidated"
    version = selected.get("finding_version") or "unversioned"
    identity = f"{organization_id}|{selected['finding_id']}|{version}|{step}"
    timestamp = now.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    severity = str((selected.get("observation") or {}).get("severity") or "unrecorded")
    prerequisites = ["Restore fresh verified evidence before treating this as a current recommendation."] if not current else []
    return {
        "contract_version": RECOMMENDATION_CONTRACT_VERSION,
        "recommendation_id": str(uuid.uuid5(uuid.NAMESPACE_URL, "revluma:recommendation:" + hashlib.sha256(identity.encode()).hexdigest())),
        "finding_id": selected["finding_id"], "finding_version": selected.get("finding_version"),
        "tenant": selected["tenant"], "investigation_id": investigation_id,
        "recommendation_type": _CATEGORY.get(kind, "investigate"),
        "title": f"Investigate: {selected.get('title') or kind}",
        "explanation": f"For {selected.get('title') or 'this finding'}, {step[0].lower() + step[1:]}",
        "label": step, "step": step, "why": why, "why_it_matters": why,
        "evidence_references": selected["evidence_references"], "evidence_ids": selected["evidence_references"],
        "metric": "finding_evidence", "period": selected.get("period"), "currency": selected.get("currency"),
        "evidence_quality": quality, "confidence": selected.get("confidence"),
        "limitations": selected.get("limitations") or [], "missing_information": selected.get("missing_information") or [],
        "validation_method": validation, "measure": validation,
        "priority": {"rank": 1, "severity": severity, "evidence_strength": quality,
                     "business_relevance": "directly_selected_finding", "urgency": "prerequisite" if prerequisites else "finding_severity",
                     "rationale": "Directly attached to the selected finding; no unsupported impact score is assigned."},
        "actionability": "prerequisite_required" if prerequisites else "merchant_actionable",
        "prerequisites": prerequisites, "lifecycle_state": state,
        "created_at": timestamp, "updated_at": timestamp,
        "version": 1, "invalidation": {"invalidated": not current, "reason": selected["current_validity"] if not current else None,
                                        "supersedes_recommendation_id": None},
        "read_only": True, "executed": False, "requires": "merchant decision",
    }


def enrich_recommendations(existing: list[dict], *, items: list[dict], selected_item: dict | None,
                           selected: dict | None, organization_id: str, investigation_id: str,
                           intent: str, now: datetime) -> list[dict]:
    """Attach stable contracts and retain only evidence-backed, deduplicated advice."""
    known = {item.get("id") for item in items}
    output = []
    if selected and selected_item:
        output.append(_recommendation_for_finding(selected, selected_item, organization_id=organization_id,
                        investigation_id=investigation_id, now=now))
    timestamp = now.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    for index, old in enumerate(existing or []):
        label = str(old.get("label") or old.get("step") or "").strip()
        if not label or re.fullmatch(r"(?:improve|optimize) (?:your )?(?:store|conversion rate|inventory|marketing)|increase customer retention|monitor your revenue", label.strip().lower()):
            continue
        refs = list(dict.fromkeys(ref for ref in (old.get("evidence_ids") or old.get("evidence_references") or []) if ref in known))
        # A finding recommendation has its own exact evidence; unrelated generic
        # advice cannot borrow the selected finding's evidence identity.
        if selected and not refs:
            continue
        if not selected and not refs:
            continue
        identity = f"{organization_id}|{investigation_id}|{intent}|{label}"
        output.append({**old, "contract_version": RECOMMENDATION_CONTRACT_VERSION,
            "recommendation_id": str(uuid.uuid5(uuid.NAMESPACE_URL, "revluma:recommendation:" + hashlib.sha256(identity.encode()).hexdigest())),
            "finding_id": None,
            "finding_version": None, "tenant": {"organization_id": organization_id,
                "store_ids": sorted({store for item in items if item.get("id") in refs for store in (item.get("store_ids") or [])})},
            "investigation_id": investigation_id, "business_question": intent,
            "recommendation_type": "verify" if intent == "integration_coverage" else "investigate",
            "title": label, "explanation": old.get("rationale") or old.get("why"), "step": label,
            "why_it_matters": old.get("why"), "evidence_references": refs, "evidence_ids": refs,
            "metric": None, "period": None, "currency": None,
            "evidence_quality": "partial" if any(item.get("status") == "partial" for item in items if item.get("id") in refs) else "verified",
            "confidence": old.get("confidence") or "medium", "limitations": old.get("limitations") or [],
            "missing_information": old.get("missing_information") or [],
            "validation_method": old.get("measure") or "Recheck the cited observation after new verified evidence arrives.",
            "measure": old.get("measure") or "Recheck the cited observation after new verified evidence arrives.",
            "priority": {"rank": index + 2, "rationale": old.get("rationale") or "Ordered after the directly selected finding using the existing specialist priority."},
            "actionability": "merchant_actionable", "prerequisites": [],
            "lifecycle_state": "presented", "created_at": timestamp, "updated_at": timestamp,
            "version": 1, "invalidation": {"invalidated": False, "reason": None, "supersedes_recommendation_id": None},
            "read_only": True, "executed": False, "requires": "merchant decision"})
    unique = []
    seen = set()
    for rec in output:
        key = (rec.get("finding_id"), rec.get("step"))
        if key in seen:
            continue
        seen.add(key)
        unique.append(rec)
    # Current, direct finding advice leads. Prerequisites outrank downstream
    # actions; historical/invalidated advice remains traceable but not current.
    unique.sort(key=lambda rec: (0 if rec.get("finding_id") and rec.get("lifecycle_state") == "presented" else
                                 1 if rec.get("actionability") == "prerequisite_required" else
                                 2 if rec.get("lifecycle_state") == "presented" else 3,
                                 {"critical": 0, "high": 1, "medium": 2, "low": 3}.get((rec.get("priority") or {}).get("severity"), 4),
                                 rec.get("recommendation_id")))
    for rank, rec in enumerate(unique[:3], 1):
        rec["priority"]["rank"] = rank
    return unique[:3]


def validate_recommendation_contract(selected: dict | None, recommendations: list[dict], *,
                                     organization_id: str, evidence_ids: set[str]) -> list[str]:
    errors = []
    if selected is not None:
        if not isinstance(selected, dict) or selected.get("contract_version") != SELECTED_FINDING_CONTRACT_VERSION:
            errors.append("selected_finding_contract")
        elif selected.get("tenant", {}).get("organization_id") != organization_id or not UUID_RE.fullmatch(str(selected.get("finding_id") or "")):
            errors.append("selected_finding_tenant")
        if selected and any(ref not in evidence_ids for ref in selected.get("evidence_references") or []):
            errors.append("selected_finding_evidence_reference")
    for rec in recommendations or []:
        if rec.get("contract_version") != RECOMMENDATION_CONTRACT_VERSION or not rec.get("recommendation_id"):
            errors.append("recommendation_contract")
        if rec.get("tenant", {}).get("organization_id") != organization_id:
            errors.append("recommendation_tenant")
        if rec.get("lifecycle_state") not in RECOMMENDATION_STATES or rec.get("executed") is not False or rec.get("read_only") is not True:
            errors.append("recommendation_lifecycle")
        if not rec.get("step") or not rec.get("why_it_matters") or not rec.get("validation_method"):
            errors.append("recommendation_quality")
        refs = rec.get("evidence_references") or []
        if not refs or any(ref not in evidence_ids for ref in refs):
            errors.append("recommendation_evidence_reference")
    return list(dict.fromkeys(errors))
