"""Task 212 — deterministic, evidence-preserving long-conversation context."""
from __future__ import annotations

import re
from typing import Any

from .epistemics import CLAIM_CONTRACT_VERSION
from .reliability import CONTEXT_CONTRACT_VERSION, redact_sensitive, utc_iso

MAX_RECENT_TURNS = 6
MAX_HISTORY_CHARS = 6000


def _claim(record: dict, evidence_ids: set[str]) -> dict | None:
    if record.get("contract_version") != CLAIM_CONTRACT_VERSION:
        return None
    refs = [ref for ref in record.get("evidence_ids") or [] if ref in evidence_ids]
    # Restatements may cite prior evidence retained in the authorized context.
    if not refs and not record.get("restated") and record.get("classification") != "unknown":
        return None
    projected = {key: record.get(key) for key in (
        "claim_id", "classification", "causal_status", "text", "metric", "value",
        "unit", "currency", "rounding", "period", "evidence_ids", "limitations",
        "hypothesis", "unknown", "restated", "source_investigation",
    ) if key in record} | {"evidence_ids": refs}
    if isinstance(projected.get("text"), str):
        projected["text"] = projected["text"][:500]
    if isinstance(projected.get("limitations"), list):
        projected["limitations"] = [str(value)[:200] for value in projected["limitations"][:3]]
    return projected


def build_context_summary(result: dict, *, conversation_id: str, organization_id: str,
                          store_ids: list[str], previous: dict | None = None) -> dict:
    investigation = result.get("investigation") or {}
    evidence = result.get("evidence") or {}
    items = [*(evidence.get("items") or []), *(evidence.get("comparison_items") or [])]
    evidence_ids = {item.get("id") for item in items if item.get("id")}
    if isinstance(previous, dict):
        evidence_ids.update(ref for ref in previous.get("evidence_references") or [] if isinstance(ref, str))
    selected = result.get("selected_finding")
    history = []
    if selected:
        history.append({"finding_id": selected.get("finding_id"),
                        "finding_version": selected.get("finding_version"),
                        "title": selected.get("title"), "lifecycle_state": selected.get("lifecycle_state")})
    if isinstance(previous, dict):
        history.extend(entry for entry in previous.get("finding_history") or [] if isinstance(entry, dict))
    unique_history = []
    seen = set()
    for entry in history:
        key = (entry.get("finding_id"), entry.get("finding_version"))
        if not entry.get("finding_id") or key in seen:
            continue
        seen.add(key)
        unique_history.append({key: entry.get(key) for key in (
            "finding_id", "finding_version", "title", "lifecycle_state")})
    claims = []
    for record in result.get("claims") or []:
        if isinstance(record, dict):
            bounded = _claim(record, evidence_ids)
            if bounded:
                claims.append(bounded)
    summary = {
        "contract_version": CONTEXT_CONTRACT_VERSION,
        "conversation_id": conversation_id,
        "tenant": {"organization_id": organization_id, "store_ids": sorted(store_ids)},
        "active_topic": investigation.get("intent"),
        "active_investigation_id": investigation.get("id"),
        "active_investigation_status": investigation.get("status"),
        "selected_finding": ({key: selected.get(key) for key in (
            "finding_id", "finding_version", "title", "lifecycle_state", "current_validity",
            "selection_source", "selected_at")} if selected else None),
        "finding_history": unique_history[:6],
        "reporting_period": investigation.get("period"),
        "currencies": sorted({item["currency"] for item in items if item.get("currency")}),
        "verified_findings": [claim for claim in claims if claim.get("classification") == "verified_fact"][:3],
        "calculated_findings": [claim for claim in claims if claim.get("classification") == "calculated_observation"][:3],
        "hypotheses": [claim for claim in claims if claim.get("classification") == "hypothesis"][:2],
        "unknowns": [claim for claim in claims if claim.get("classification") == "unknown"][:2],
        "unresolved_questions": [str(text)[:400] for text in (result.get("unknowns") or [])[:5]],
        "evidence_references": sorted(evidence_ids)[:30],
        "recommendations": [{key: rec.get(key) for key in (
            "recommendation_id", "finding_id", "finding_version", "lifecycle_state", "step",
            "validation_method", "evidence_references", "updated_at")}
            for rec in (result.get("recommendations") or [])[:3]],
        "consistency": result.get("consistency"),
        "last_validated_context_version": CONTEXT_CONTRACT_VERSION,
        "created_at": (previous or {}).get("created_at") or utc_iso(),
        "updated_at": utc_iso(),
        "summary_method": "deterministic_bounded_projection_no_model",
    }
    cited = set()
    for group in ("verified_findings", "calculated_findings", "hypotheses", "unknowns"):
        for claim in summary[group]:
            cited.update(claim.get("evidence_ids") or [])
    for recommendation in summary["recommendations"]:
        cited.update(recommendation.get("evidence_references") or [])
    summary["evidence_references"] = sorted(ref for ref in cited if isinstance(ref, str))
    return redact_sensitive(summary)


def validate_context_summary(value: Any, *, organization_id: str,
                             conversation_id: str | None = None) -> list[str]:
    if not isinstance(value, dict):
        return ["context_summary_not_object"]
    errors = []
    if value.get("contract_version") != CONTEXT_CONTRACT_VERSION:
        errors.append("context_summary_contract")
    tenant = value.get("tenant") or {}
    if tenant.get("organization_id") != organization_id or not isinstance(tenant.get("store_ids"), list):
        errors.append("context_summary_tenant")
    if conversation_id and value.get("conversation_id") != conversation_id:
        errors.append("context_summary_conversation")
    for key in ("verified_findings", "calculated_findings", "hypotheses", "unknowns",
                "evidence_references", "recommendations", "finding_history"):
        if not isinstance(value.get(key), list):
            errors.append("context_summary_" + key)
    if value.get("summary_method") != "deterministic_bounded_projection_no_model":
        errors.append("context_summary_method")
    if not isinstance(value.get("reporting_period"), dict):
        errors.append("context_summary_period")
    references = set(value.get("evidence_references") or [])
    for group, grade in (("verified_findings", "verified_fact"),
                         ("calculated_findings", "calculated_observation"),
                         ("hypotheses", "hypothesis"), ("unknowns", "unknown")):
        for claim in value.get(group) or []:
            if not isinstance(claim, dict) or claim.get("classification") != grade:
                errors.append("context_summary_epistemics")
                continue
            refs = claim.get("evidence_ids")
            if not isinstance(refs, list) or any(ref not in references for ref in refs):
                errors.append("context_summary_evidence_reference")
            numeric = claim.get("value")
            valid_numeric = (isinstance(numeric, (int, float)) and not isinstance(numeric, bool)) or (
                isinstance(numeric, str) and bool(re.fullmatch(r"-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?", numeric)))
            if "value" in claim and numeric is not None and not valid_numeric:
                errors.append("context_summary_numeric")
            if claim.get("currency") is not None and not re.fullmatch(r"[A-Z]{3}", str(claim.get("currency"))):
                errors.append("context_summary_currency")
    for recommendation in value.get("recommendations") or []:
        refs = recommendation.get("evidence_references") or []
        if any(ref not in references for ref in refs):
            errors.append("context_summary_recommendation_reference")
    import json
    if len(json.dumps(value, default=str).encode("utf-8")) > 16_000:
        errors.append("context_summary_too_large")
    return sorted(set(errors))


def bounded_history_text(summary: dict | None, recent_turns: list[dict], *,
                         selected_finding: dict | None = None) -> str:
    """Prioritize active finding/summary and recent relevant turns within a budget."""
    sections = []
    if selected_finding:
        sections.append("Active selected finding: " + str(selected_finding.get("finding_id")))
    if summary:
        # JSON-like deterministic projection; no raw customer records or prompt.
        import json
        sections.append("Validated conversation summary: " + json.dumps(summary, sort_keys=True, default=str))
    used = sum(len(section) for section in sections)
    turns = []
    for turn in reversed((recent_turns or [])[-MAX_RECENT_TURNS:]):
        role = str(turn.get("role") or "unknown")[:20]
        text = str(turn.get("text") or "")[:600]
        line = f"{role}: {text}"
        if used + len(line) + 2 > MAX_HISTORY_CHARS:
            continue
        turns.append(line)
        used += len(line) + 2
    sections.extend(reversed(turns))
    return "\n\n".join(sections)[:MAX_HISTORY_CHARS]
