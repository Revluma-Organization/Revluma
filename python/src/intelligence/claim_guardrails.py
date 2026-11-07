"""Fail-closed causal, financial-impact, evidence, and action-state controls.

Generation and persistence are not authority.  A merchant statement, model sentence,
or recommendation can describe a proposed action; only an independently authorised
execution/verification record (which Rev does not create) can establish execution.
"""
from __future__ import annotations

import re
from typing import Any

CAUSAL_STATES = frozenset({
    "observed", "observed_difference", "deterministic_relationship", "statistical_association",
    "hypothesis", "verified_causal", "unknown",
})
ACTION_STATES = frozenset({
    "recommended", "presented_to_merchant", "merchant_confirmed",
    "independently_verified", "execution_requested", "executing", "executed",
    "execution_failed", "dismissed", "superseded",
})
FINANCIAL_INTERPRETATIONS = frozenset({
    "recorded_observed", "recorded_aggregate", "observed_difference",
    "estimated_opportunity", "recoverable", "verified_recovered",
})
_ELIGIBLE_INTERPRETATIONS = frozenset({"recorded_observed", "recorded_aggregate", "observed_difference"})
_FINANCIAL_WORDS = re.compile(
    r"\b(?:lost|losing|loss(?:es)?|recover(?:s|ed|able|y)?|recoup(?:ed)?|saved|preventable|"
    r"guarantee(?:d|s)?|stockout\s+loss|revenue\s+leak|won\s+back)\b", re.I)
_FINANCIAL_NEGATION = re.compile(
    r"\b(?:not|no|cannot|can't|unknown|unverified|without|doesn't|does\s+not|"
    r"isn't|is\s+not|aren't|are\s+not|never)\b", re.I)
_CAUSAL_WORDS = re.compile(
    r"\b(?:caused|causes|causing|because\s+of|due\s+to|resulted\s+in|"
    r"led\s+to|drove|driven\s+by|attributable\s+to|attributed\s+to|"
    r"responsible\s+for|proved|proves|confirmed\s+that)\b", re.I)
_CAUSAL_NEGATION = re.compile(
    r"\b(?:not\s+(?:establish|established|prove|proven|confirm|confirmed|known)|"
    r"no\s+(?:causal\s+)?evidence|cause\s+is\s+unknown|causes\s+are\s+not|"
    r"does\s+not\s+establish|cannot\s+establish|can't\s+establish|unknown\s+cause)\b", re.I)
_ACTION_NEGATION = re.compile(
    r"(?:\bnothing\s*$|\bnothing\s+(?:has|have)|\bno\s+change\s+(?:has|have)|"
    r"(?:has|have)\s+not\s+been|did\s+not|cannot|can't)", re.I)
_ACTION_WORDS = re.compile(
    r"\b(?:(?:(?:i|we|revluma|rev)\s+|i['’]ve\s+|we['’]ve\s+)"
    r"(?:(?:have|has)\s+)?(?:(?:successfully|already)\s+)?"
    r"(?:fixed|updated|changed|executed|completed|applied|refunded|cancelled|canceled|"
    r"sent|launched|created|recovered)|"
    r"(?:successfully|already)\s+(?:fixed|updated|changed|executed|completed|applied|recovered)|"
    r"(?:has|have)\s+been\s+(?:fixed|updated|changed|executed|completed|applied|recovered)|"
    r"(?:issue|problem)\s+is\s+(?:fixed|resolved)|"
    r"(?:product|price|prices|settings|discount|order|inventory)\s+(?:was|were)\s+"
    r"(?:fixed|updated|changed|executed|applied))\b", re.I)
_REFERENCE = re.compile(r"\[(\d+)\]")
_METRIC_TERMS = {
    "revenue": ("revenue", "sales", "order_value"),
    "orders": ("order",),
    "inventory": ("inventory", "stock", "units"),
    "checkout": ("checkout", "payment"),
    "traffic": ("traffic", "session"),
    "conversion": ("conversion",),
}


def _sentences(text: str) -> list[str]:
    return [part.strip() for part in re.split(r"(?<=[.!?])\s+|\n+", text or "") if part.strip()]


def narrative_guardrail_errors(text: str) -> list[str]:
    """Reject unsafe prose, including prose accompanied by a valid-looking citation."""
    errors: list[str] = []
    for sentence in _sentences(text):
        causal = _CAUSAL_WORDS.search(sentence)
        if causal:
            prefix = sentence[:causal.start()]
            suffix = sentence[causal.end():]
            qualified = bool(_CAUSAL_NEGATION.search(prefix)) or bool(
                re.match(r"\s+are\s+not\s+(?:established|known|verified)", suffix, re.I))
            if not qualified:
                errors.append("unsupported_causal_language")
        financial = _FINANCIAL_WORDS.search(sentence)
        if financial and not _FINANCIAL_NEGATION.search(sentence[:financial.start()]):
            errors.append("unsupported_financial_impact_language")
        action = _ACTION_WORDS.search(sentence)
        if action and not _ACTION_NEGATION.search(sentence[:action.start()]):
            errors.append("generated_action_or_outcome_claim")
    return list(dict.fromkeys(errors))


def _evidence_lookup(response: dict) -> dict[str, dict]:
    evidence = response.get("evidence") or {}
    items = evidence.get("items") if isinstance(evidence, dict) else evidence
    comparison = evidence.get("comparison_items") if isinstance(evidence, dict) else []
    return {str(item.get("id")): item for item in [*(items or []), *(comparison or [])]
            if isinstance(item, dict) and item.get("id")}


def _declared_calculation_input(claim: dict, item: dict) -> bool:
    """A calculated_observation claim may reference each of its declared
    calculation inputs, in any window, under the input's own metric.

    A derived figure (a value-decomposition effect, a line-value change, a
    comparison) legitimately spans windows and metrics: its value is
    re-derivable from the declared inputs, so the inputs are *the* provenance.
    This is the same reference channel as the ``current`` role escape below —
    only broader (previous windows, count inputs) and limited to claims whose
    ``calculation`` block the epistemic validator already required to carry a
    formula, version, rounding and valued inputs (the claim's value must be
    re-derivable from them, so a calculation cannot cite arbitrary evidence).
    Eligibility (quality_eligible / status / currency) is still enforced.
    """
    if claim.get("classification") != "calculated_observation":
        return False
    calculation = claim.get("calculation") or {}
    if not str(calculation.get("method") or "").strip():
        return False
    return any(isinstance(entry, dict) and entry.get("evidence_id") == item.get("id")
               for entry in calculation.get("inputs") or [])


def _references_allowed(claim: dict, item: dict) -> bool:
    eligible_status = item.get("status") in {"available", "verified_zero"} or (
        item.get("status") == "partial" and claim.get("status") == "partial")
    if item.get("quality_eligible") is False or not eligible_status:
        return False
    claim_period = claim.get("period")
    calculation_inputs = (claim.get("calculation") or {}).get("inputs") or []
    current_reference = (isinstance(claim.get("value"), dict)
                         and item.get("id") == claim["value"].get("current_evidence_id")) or any(
        entry.get("role") == "current" and entry.get("evidence_id") == item.get("id")
        for entry in calculation_inputs if isinstance(entry, dict))
    if claim_period and item.get("period") and claim_period != item.get("period") \
            and not current_reference and not _declared_calculation_input(claim, item):
        return False
    claim_currency = claim.get("currency")
    if claim_currency and item.get("currency") and claim_currency != item.get("currency"):
        return False
    return True


def _relevant(claim: dict, item: dict) -> bool:
    if not _references_allowed(claim, item):
        return False
    text = str(claim.get("text") or "").lower()
    metric = str(item.get("metric") or "").lower()
    if claim.get("metric"):
        return str(claim["metric"]).lower() == metric \
            or _declared_calculation_input(claim, item)
    for family, terms in _METRIC_TERMS.items():
        if any(re.search(rf"\b{re.escape(term)}\w*\b", text) for term in terms):
            return any(term in metric for term in terms)
    return True


def financial_evidence_errors(item: dict) -> list[str]:
    measurement = item.get("measurement") or {}
    interpretation = measurement.get("interpretation")
    if interpretation not in FINANCIAL_INTERPRETATIONS:
        return []
    if interpretation in _ELIGIBLE_INTERPRETATIONS:
        return []
    impact = item.get("financial_impact")
    errors: list[str] = []
    if not isinstance(impact, dict):
        return ["financial_impact_record_required"]
    required = ("methodology_id", "methodology_version", "inputs", "coverage", "assumptions", "limitations")
    for field in required:
        value = impact.get(field)
        if value is None or value == "" or value == [] or value == {}:
            errors.append(f"financial_impact_{field}_required")
    if impact.get("eligible") is not True:
        errors.append("financial_impact_not_eligible")
    if impact.get("independent_attribution_verified") is not True:
        errors.append("financial_impact_attribution_unverified")
    return list(dict.fromkeys(errors))


def causal_methodology_eligible(methodology: Any) -> bool:
    if not isinstance(methodology, dict):
        return False
    allowed = {"randomized_controlled_trial", "difference_in_differences",
               "instrumental_variable", "regression_discontinuity"}
    required = ("methodology_version", "inputs", "coverage", "assumptions", "limitations")
    return (methodology.get("design") in allowed
            and methodology.get("eligible") is True
            and methodology.get("independently_verified") is True
            and all(methodology.get(field) not in (None, "", [], {}) for field in required))


def validate_action_states(recommendations: list[dict]) -> list[str]:
    errors: list[str] = []
    for index, action in enumerate(recommendations or []):
        state = action.get("action_state")
        if state not in ACTION_STATES:
            errors.append(f"recommendation_{index}_invalid_action_state")
        # Generated advisor output may propose, never establish a later lifecycle state.
        if state != "recommended":
            errors.append(f"recommendation_{index}_generated_state_not_authoritative")
        for field in ("execution_status", "execution_actor", "executed_at", "execution_outcome",
                      "verified_by", "verified_at"):
            if action.get(field) not in (None, "not_requested", "unverified"):
                errors.append(f"recommendation_{index}_{field}_not_authoritative")
        if action.get("executed") is not False:
            errors.append(f"recommendation_{index}_execution_flag_invalid")
        if action.get("merchant_confirmation") not in (None, "not_confirmed"):
            errors.append(f"recommendation_{index}_merchant_confirmation_not_authoritative")
        if action.get("independent_verification") not in (None, "unverified"):
            errors.append(f"recommendation_{index}_independent_verification_not_authoritative")
    return list(dict.fromkeys(errors))


def initialise_action_states(recommendations: list[dict]) -> None:
    for action in recommendations:
        action.update({
            "action_state": "recommended", "executed": False,
            "execution_status": "not_requested", "execution_actor": None,
            "executed_at": None, "execution_outcome": None,
            "merchant_confirmation": "not_confirmed",
            "independent_verification": "unverified",
            "verified_by": None, "verified_at": None,
        })


def validate_response_guardrails(response: dict) -> None:
    """Raise ValueError; callers must not expose or persist the rejected response."""
    errors = narrative_guardrail_errors(str(response.get("text") or ""))
    items = _evidence_lookup(response)
    source_references = [reference for item in items.values()
                         for reference in ((item.get("source") or {}).get("references") or [])]
    for marker in _REFERENCE.findall(str(response.get("text") or "")):
        index = int(marker)
        if index < 1 or index > len(source_references) or not source_references[index - 1]:
            errors.append("unresolved_citation_reference")
    for item in items.values():
        errors.extend(financial_evidence_errors(item))
    claims = []
    for key in ("facts", "comparison_facts", "year_over_year_facts", "hypotheses", "claims"):
        claims.extend(response.get(key) or [])
    for claim in claims:
        state = claim.get("causal_status")
        if state is not None and state not in CAUSAL_STATES:
            errors.append("invalid_causal_state")
        if state == "verified_causal" and not causal_methodology_eligible(claim.get("causal_methodology")):
            errors.append("verified_causal_methodology_required")
        references = (claim.get("evidence_ids") or claim.get("basis_evidence_ids")
                      or (claim.get("hypothesis") or {}).get("supports") or [])
        is_unknown = claim.get("classification") == "unknown"
        is_restated = claim.get("restated") is True
        if not references and not is_unknown and not is_restated:
            errors.append("material_claim_evidence_required")
        if claim.get("financial_impact") in {"lost", "recoverable", "saved", "prevented", "avoided", "leakage"}:
            errors.append("canonical_financial_impact_not_eligible")
        for reference in [] if is_restated or is_unknown else references:
            item = items.get(str(reference))
            if item is None:
                errors.append("material_claim_unknown_evidence")
            elif not _references_allowed(claim, item):
                errors.append("material_claim_irrelevant_or_ineligible_evidence")
            elif claim.get("status") != "hypothesis" and claim.get("classification") != "hypothesis" and not _relevant(claim, item):
                errors.append("material_claim_irrelevant_or_ineligible_evidence")
        text = str(claim.get("text") or claim.get("statement") or "")
        errors.extend(narrative_guardrail_errors(text))
    errors.extend(validate_action_states(response.get("recommendations") or []))
    errors = list(dict.fromkeys(errors))
    if errors:
        raise ValueError("Rev response failed safety validation: " + ", ".join(errors))


def direct_action_or_recovery_answer(message: str) -> str | None:
    """Safe direct answers; these never infer an action or recovered amount."""
    text = (message or "").strip().lower()
    if not text:
        return None
    if re.search(r"\bhave you (?:fixed|updated|changed)|\bdid you (?:fix|update|change|execute|apply)\b", text):
        return ("No. Rev is read-only and has not executed or changed anything. "
                "Any recommendation remains unconfirmed and unexecuted unless separately "
                "verified in Shopify or another authorised system.")
    if re.search(r"\bi (?:already |have )(?:fixed|updated|changed)|\bis (?:it|the issue|the problem) fixed now\b", text):
        return ("I’ve recorded that as your report, not as independent verification. "
                "Rev has not executed a change; the current store evidence would need to "
                "be checked before describing the issue as resolved.")
    if re.search(r"\bhow much revenue (?:did|have) (?:we|you|revluma) recover|\bhow much .*recovered\b", text):
        return ("No independently verified recovered revenue is established. Recorded "
                "revenue and later performance are not recovered revenue, and no "
                "post-recommendation attribution has been verified.")
    if re.search(r"\bhow much (?:money|revenue) can (?:revluma|rev|you) recover|\brecoverable revenue\b", text):
        return ("No recoverable amount is established by recorded sales, traffic, "
                "inventory, or an observed difference. A defensible estimate would require "
                "eligible evidence, a versioned methodology, explicit inputs and coverage, "
                "assumptions, limitations, and attribution controls.")
    return None
