"""Canonical epistemic claim contract (Task 204; original Tasks 212-216).

Revluma must distinguish, in every material claim it produces:

* ``verified_fact``          - directly supported by retrieved, authorized,
                               sufficiently complete source evidence;
* ``calculated_observation`` - a deterministic, reproducible result derived
                               from supported inputs by an explicit formula
                               (the Task 204 spec calls these "calculated
                               findings"; this module reuses the Task 197
                               claim-grade vocabulary, not a new one);
* ``hypothesis``             - a plausible explanation NOT established by the
                               available evidence; never silently promotable
                               to a fact;
* ``unknown``                - information the available evidence cannot
                               establish; a valid reasoning result, never
                               replaced by an invented answer.

This module is the single canonical, versioned contract for reasoning claims
produced by the intelligence pipeline. It extends the Task 197 evidence
contract (item-level ``classification`` and ``CLAIM_GRADES``) and the Task 203
evidence-quality model; it does not create a competing epistemic system.

Guarantees enforced here (all deterministic, no model discretion):

* a ``verified_fact`` must cite resolvable, available evidence;
* a ``calculated_observation`` must carry a calculation block (identifier,
  version, formula, resolvable inputs, declared rounding) and its inputs must
  be currency-consistent with no missing numerics;
* a ``hypothesis`` must never be marked verified and must name the evidence
  that is missing;
* an ``unknown`` must carry no numeric value (no null-to-zero, no invention);
* asserted financial impact (lost / recoverable / saved / prevented /
  avoided / leakage) is only admissible on a ``calculated_observation`` whose
  calculation method and verified inputs are recorded - observed order totals
  are never "lost revenue", abandoned checkout value is only "potential",
  and no impact figure is ever invented to make a finding look valuable;
* monetary precision is bounded (two decimals; declared rounding for
  percents) so unsupported precision is never implied;
* claims are tenant- and store-scoped: cross-tenant references are rejected;
* a hypothesis can only be promoted to a verified claim by NEW evidence
  (``can_promote``); a challenged claim is corrected explicitly
  (``correct_claim``), never defended.

``validate_claim`` returns a sorted list of stable error codes; an empty list
means the claim is admissible. Callers treat any error as fail-closed (the
claim is not presented as established).
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Iterable

from .evidence import (
    CLAIM_CALCULATED_OBSERVATION,
    CLAIM_GRADES,
    CLAIM_HYPOTHESIS,
    CLAIM_UNKNOWN,
    CLAIM_VERIFIED_FACT,
    UNIT_CURRENCY,
    UNIT_RATIO,
    STATUS_AVAILABLE,
    ensure_utc,
    iso,
    normalize_currency,
    utc_now,
)

CLAIM_CONTRACT_VERSION = "rev-claim-v1"

# Rounding declarations: the only precisions the pipeline may imply.
ROUNDING_MONEY = "2dp_money"          # e.g. "NGN 125,000.00"
ROUNDING_PERCENT = "1dp_percent"      # e.g. "12.4%"
ROUNDING_INTEGER = "integer_count"    # e.g. "42 orders"
ROUNDINGS = (ROUNDING_MONEY, ROUNDING_PERCENT, ROUNDING_INTEGER)

# Financial-impact kinds. ``observed`` and ``potential`` are admissible on any
# established claim (they name what the number IS, not a consequence of it).
# Asserted kinds quantify a CONSEQUENCE (money lost, saved, prevented) and are
# only admissible on a calculated observation with a recorded method.
IMPACT_OBSERVED = "observed"
IMPACT_POTENTIAL = "potential"
IMPACT_ASSERTED = ("lost", "recoverable", "saved", "prevented", "avoided", "leakage")
IMPACT_KINDS = (IMPACT_OBSERVED, IMPACT_POTENTIAL) + IMPACT_ASSERTED

MONEY_RE = re.compile(r"^-?\d+(\.\d{1,2})?$")
PERCENT_RE = re.compile(r"^-?\d+\.\d$")
INT_RE = re.compile(r"^-?\d+$")


def claim_id(*parts: Any) -> str:
    """Deterministic claim identifier (stable across re-derivation)."""
    payload = json.dumps(list(parts), sort_keys=True, default=str)
    return "clm-" + hashlib.sha256(payload.encode("utf-8")).hexdigest()[:24]


def _decimal(value: Any) -> Decimal | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return None
    return amount if amount.is_finite() else None


def _period_label(period: dict | None) -> str | None:
    if not isinstance(period, dict):
        return None
    return period.get("label") or period.get("start")


# ---------------------------------------------------------------------------
# Builders: the pipeline emits claims through these, never raw dicts.
# ---------------------------------------------------------------------------

def build_fact_claim(
    fact: dict, *, organization_id: str, store_ids: Iterable[str],
    investigation_id: str, item: dict | None = None,
    financial_impact: str | None = None,
) -> dict:
    """A verified_fact claim from a pipeline fact (evidence-backed prose line).

    ``item`` is the primary cited evidence item; its Task 203 quality block is
    carried on the claim so quality metadata survives the boundary.
    """
    item = item or {}
    unit = fact.get("unit")
    currency = normalize_currency(fact.get("currency"))
    value = fact.get("value")
    period = fact.get("period") or {}
    quality = item.get("quality") if isinstance(item, dict) else None
    limitations: list[str] = []
    if isinstance(quality, dict):
        limitations = [str(reason) for reason in (quality.get("reasons") or [])]
    if isinstance(item, dict):
        limitations = limitations or [str(limitation)
                                      for limitation in (item.get("limitations") or [])]
    claim = {
        "claim_id": claim_id(CLAIM_CONTRACT_VERSION, organization_id,
                             investigation_id, CLAIM_VERIFIED_FACT,
                             fact.get("metric"), currency,
                             period.get("start"), period.get("end"),
                             str(value)),
        "contract_version": CLAIM_CONTRACT_VERSION,
        "classification": CLAIM_VERIFIED_FACT,
        "causal_status": "observed",
        "text": fact.get("text") or "",
        "metric": fact.get("metric"),
        "value": value,
        "unit": unit,
        "currency": currency,
        "rounding": (ROUNDING_MONEY if unit == UNIT_CURRENCY
                     else ROUNDING_INTEGER if unit == "count"
                     else None),
        "period": period or None,
        "period_timezone": (period or {}).get("timezone"),
        "retrieved_at": (item or {}).get("retrieved_at"),
        "observed_at": (item or {}).get("retrieved_at"),
        "computed_at": None,
        "evidence_ids": [e for e in (fact.get("evidence_ids") or []) if e],
        "source": (item or {}).get("source") or (fact.get("source") if isinstance(fact.get("source"), dict) else None),
        "organization_id": organization_id,
        "store_ids": list(store_ids),
        "quality": quality,
        "limitations": limitations[:10],
        "financial_impact": financial_impact,
        "calculation": None,
        "hypothesis": None,
        "unknown": None,
    }
    return claim


def build_calculation_claim(
    *, change: dict, fact: dict, organization_id: str, store_ids: Iterable[str],
    investigation_id: str, items_by_id: dict[str, dict] | None = None,
    qualifier: str = "versus the previous period",
) -> dict:
    """A calculated_observation claim from a period comparison.

    The calculation block records enough to recompute the result
    independently: method, version, formula, both inputs (values AND evidence
    ids) and the declared rounding.
    """
    items_by_id = items_by_id or {}
    currency = normalize_currency(change.get("currency"))
    current_id = change.get("current_evidence_id")
    previous_id = change.get("previous_evidence_id")
    current_item = items_by_id.get(current_id) if current_id else None
    previous_item = items_by_id.get(previous_id) if previous_id else None
    unit = "percent"
    rounding = ROUNDING_PERCENT
    inputs = []
    for role, evidence_id, value in (("current", current_id, change.get("current")),
                                     ("previous", previous_id, change.get("previous"))):
        if evidence_id is None or value is None:
            continue  # missing input: the validator will reject the claim
        inputs.append({"role": role, "evidence_id": evidence_id, "value": value,
                       "currency": currency})
    inputs.sort(key=lambda entry: entry["role"])
    percent = _decimal(change.get("percent"))
    if percent is not None:
        # The claim's stored value must match the narrative text that quotes
        # it (one decimal place) and its declared rounding. The comparison
        # engine's raw figure is kept on the calculation inputs, not the claim.
        percent = percent.quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)
    period = fact.get("period") or {}
    item = current_item or previous_item or {}
    quality = item.get("quality") if isinstance(item, dict) else None
    limitations: list[str] = []
    if isinstance(quality, dict):
        limitations = [str(reason) for reason in (quality.get("reasons") or [])]
    return {
        "claim_id": claim_id(CLAIM_CONTRACT_VERSION, organization_id,
                             investigation_id, CLAIM_CALCULATED_OBSERVATION,
                             change.get("metric"), currency,
                             period.get("start"), period.get("end"),
                             str(percent)),
        "contract_version": CLAIM_CONTRACT_VERSION,
        "classification": CLAIM_CALCULATED_OBSERVATION,
        "causal_status": "observed_difference",
        "text": fact.get("text") or "",
        "metric": change.get("metric"),
        "value": str(percent) if percent is not None else None,
        "unit": unit,
        "currency": currency,
        "rounding": rounding,
        "period": period or None,
        "period_timezone": (period or {}).get("timezone"),
        "retrieved_at": (item or {}).get("retrieved_at"),
        "observed_at": None,
        "computed_at": iso(utc_now()),
        "evidence_ids": [e for e in (fact.get("evidence_ids") or []) if e],
        "source": (item or {}).get("source") or {"system": "shopify", "resource": "orders"},
        "organization_id": organization_id,
        "store_ids": list(store_ids),
        "quality": quality,
        "limitations": limitations[:10],
        "financial_impact": None,
        "calculation": {
            "id": f"percent-change:{change.get('metric')}:{period.get('start')}:{period.get('end')}",
            "version": "percent-change-v1",
            "method": "percent_change",
            "formula": "percent = (current - previous) / previous * 100",
            "qualifier": qualifier,
            "inputs": inputs,
            "rounding": rounding,
            "assumptions": ["previous period is the equal-length immediately preceding window"],
            "exclusions": [],
        },
        "hypothesis": None,
        "unknown": None,
    }


def build_contribution_claim(
    *, metric: str, value: Any, unit: str, currency: str | None,
    calculation: dict, fact: dict, organization_id: str,
    store_ids: Iterable[str], investigation_id: str,
    items_by_id: dict[str, dict] | None = None,
    qualifier: str = "versus the previous period",
) -> dict:
    """A calculated_observation claim for a contribution/decomposition figure.

    ``build_calculation_claim`` is fixed to the percent-change method; the
    decomposition (volume vs value effect), the per-product line-value change
    and a finding's recorded count/value change are all calculated
    observations but with different formulas and inputs. This builder keeps
    the same fail-closed contract: a complete, re-computable ``calculation``
    block (method, version, formula, inputs with evidence ids AND values,
    declared rounding) and currency integrity, or it is dropped by the
    validator.
    """
    items_by_id = items_by_id or {}
    currency = normalize_currency(currency)
    rounding = (ROUNDING_MONEY if unit == UNIT_CURRENCY
                else ROUNDING_PERCENT if unit == "percent"
                else ROUNDING_INTEGER if unit == "count" else None)
    period = fact.get("period") or {}
    primary_id = (calculation.get("primary_evidence_id"))
    item = items_by_id.get(primary_id) if primary_id else None
    quality = item.get("quality") if isinstance(item, dict) else None
    limitations: list[str] = []
    if isinstance(quality, dict):
        limitations = [str(reason) for reason in (quality.get("reasons") or [])]
    if not limitations and isinstance(item, dict):
        limitations = [str(x) for x in (item.get("limitations") or [])]
    calc_inputs = calculation.get("inputs") or []
    return {
        "claim_id": claim_id(CLAIM_CONTRACT_VERSION, organization_id,
                             investigation_id, CLAIM_CALCULATED_OBSERVATION,
                             metric, currency, period.get("start"), period.get("end"),
                             str(value)),
        "contract_version": CLAIM_CONTRACT_VERSION,
        "classification": CLAIM_CALCULATED_OBSERVATION,
        "text": fact.get("text") or "",
        "metric": metric,
        "value": str(value) if value is not None else None,
        "unit": unit,
        "currency": currency,
        "rounding": rounding,
        "period": period or None,
        "period_timezone": (period or {}).get("timezone"),
        "retrieved_at": (item or {}).get("retrieved_at"),
        "observed_at": None,
        "computed_at": iso(utc_now()),
        "evidence_ids": [e for e in (fact.get("evidence_ids") or []) if e],
        "source": (item or {}).get("source") or {"system": "shopify", "resource": "orders"},
        "organization_id": organization_id,
        "store_ids": list(store_ids),
        "quality": quality,
        "limitations": limitations[:10],
        "financial_impact": None,
        "calculation": {
            "id": f"contribution:{metric}:{period.get('start')}:{period.get('end')}",
            "version": calculation.get("version"),
            "method": calculation.get("method"),
            "formula": calculation.get("formula"),
            "qualifier": qualifier,
            "inputs": calc_inputs,
            "rounding": rounding,
            "assumptions": calculation.get("assumptions") or [],
            "exclusions": calculation.get("exclusions") or [],
        },
        "hypothesis": None,
        "unknown": None,
    }


def build_hypothesis_claim(
    hypothesis: dict, *, organization_id: str, store_ids: Iterable[str],
    investigation_id: str,
) -> dict:
    """A hypothesis claim: an open explanation, explicitly not established."""
    return {
        "claim_id": claim_id(CLAIM_CONTRACT_VERSION, organization_id,
                             investigation_id, CLAIM_HYPOTHESIS,
                             hypothesis.get("statement")),
        "contract_version": CLAIM_CONTRACT_VERSION,
        "classification": CLAIM_HYPOTHESIS,
        "causal_status": "hypothesis",
        "text": hypothesis.get("statement") or "",
        "metric": None,
        "value": None,
        "unit": None,
        "currency": None,
        "rounding": None,
        "period": None,
        "period_timezone": None,
        "retrieved_at": None,
        "observed_at": None,
        "computed_at": None,
        "evidence_ids": [],
        "source": None,
        "organization_id": organization_id,
        "store_ids": list(store_ids),
        "quality": None,
        "limitations": [],
        "financial_impact": None,
        "calculation": None,
        "hypothesis": {
            "verified": False,
            "supports": [e for e in
                         (hypothesis.get("basis_evidence_ids") or hypothesis.get("evidence_ids") or [])
                         if e],
            "missing_evidence": [str(hypothesis.get("note") or "The available records do not establish this.")],
            "alternatives": [],
            "confidence": hypothesis.get("confidence"),
            "verification_step": "Run a dedicated investigation for each candidate cause.",
        },
        "unknown": None,
    }


def build_unknown_claim(
    text: str, *, organization_id: str, store_ids: Iterable[str],
    investigation_id: str, attempts: Iterable[str] = (),
    missing_capability: str | None = None,
    needed_to_establish: str | None = None,
    limitations: Iterable[str] = (),
) -> dict:
    """An unknown claim: the evidence cannot establish the information.

    An unknown never carries a numeric value - that is a different claim or a
    defect, not an answer.
    """
    return {
        "claim_id": claim_id(CLAIM_CONTRACT_VERSION, organization_id,
                             investigation_id, CLAIM_UNKNOWN, text),
        "contract_version": CLAIM_CONTRACT_VERSION,
        "classification": CLAIM_UNKNOWN,
        "causal_status": "unknown",
        "text": text,
        "metric": None,
        "value": None,
        "unit": None,
        "currency": None,
        "rounding": None,
        "period": None,
        "period_timezone": None,
        "retrieved_at": None,
        "observed_at": None,
        "computed_at": None,
        "evidence_ids": [],
        "source": None,
        "organization_id": organization_id,
        "store_ids": list(store_ids),
        "quality": None,
        "limitations": [str(limitation) for limitation in limitations][:10],
        "financial_impact": None,
        "calculation": None,
        "hypothesis": None,
        "unknown": {
            "reason": text,
            "attempts": [str(attempt) for attempt in attempts][:10],
            "missing_capability": missing_capability,
            "needed_to_establish": needed_to_establish or "Authorized source evidence for this question.",
        },
    }


# ---------------------------------------------------------------------------
# Validation: fail-closed, deterministic, stable error codes.
# ---------------------------------------------------------------------------

def validate_claim(
    claim: dict, *, known_evidence: dict[str, dict],
    organization_id: str | None = None, store_ids: Iterable[str] | None = None,
) -> list[str]:
    """Validate one claim. Returns sorted stable error codes ([] = admissible).

    ``known_evidence`` maps evidence id -> item. Claims flagged
    ``restated`` (follow-ups citing a previous investigation) are validated
    against the restatement rules instead: they must name the originating
    investigation, because the merchant's question is answered from the
    recorded claim, not re-derived from fresh retrieval.
    """
    errors: set[str] = set()
    grade = claim.get("classification")
    if claim.get("contract_version") != CLAIM_CONTRACT_VERSION:
        errors.add("unknown_claim_contract_version")
    if grade not in CLAIM_GRADES:
        errors.add("invalid_claim_grade")
        return sorted(errors)

    evidence_ids = [e for e in (claim.get("evidence_ids") or []) if e]
    if claim.get("restated") is True:
        # A restatement answers from the recorded claim of a previous
        # investigation; it is not a new assertion, so it is not re-derived
        # against fresh retrieval. It must still name the originating
        # investigation and keep a well-formed claim id (the merchant can see
        # exactly which earlier answer is being restated).
        if not str(claim.get("source_investigation") or "").strip():
            errors.add("restated_claim_without_source_investigation")
        if not str(claim.get("claim_id") or "").startswith("clm-"):
            errors.add("restated_claim_without_claim_id")
    else:
        for identifier in evidence_ids:
            if identifier not in known_evidence:
                errors.add(f"{grade}_cites_unknown_evidence")

    if organization_id and claim.get("organization_id") != organization_id:
        errors.add("cross_tenant_claim")
    if store_ids is not None:
        allowed = set(store_ids)
        if not set(claim.get("store_ids") or []) <= allowed:
            errors.add("cross_store_claim")

    value = claim.get("value")
    unit = claim.get("unit")
    currency = normalize_currency(claim.get("currency"))

    # --- value / precision integrity (all grades) --------------------------
    if grade in (CLAIM_VERIFIED_FACT, CLAIM_CALCULATED_OBSERVATION):
        if value is None:
            errors.add("established_claim_without_value")  # no null-to-zero
        elif unit == UNIT_CURRENCY:
            if currency is None:
                errors.add("currency_claim_without_currency")
            amount = _decimal(value)
            if amount is None:
                errors.add("currency_claim_not_numeric")
            elif not MONEY_RE.match(str(amount)):
                errors.add("currency_claim_false_precision")
            elif claim.get("rounding") != ROUNDING_MONEY:
                errors.add("currency_claim_missing_rounding")
        elif unit == "count":
            count = _decimal(value)
            if count is None or count != count.to_integral_value():
                errors.add("count_claim_not_integer")
            elif claim.get("rounding") not in (ROUNDING_INTEGER, None):
                errors.add("count_claim_invalid_rounding")
        elif unit == UNIT_RATIO or unit == "percent":
            amount = _decimal(value)
            if amount is None:
                errors.add("percent_claim_not_numeric")
            elif claim.get("rounding") == ROUNDING_PERCENT and not PERCENT_RE.match(str(amount)):
                errors.add("percent_claim_false_precision")

    if grade == CLAIM_VERIFIED_FACT:
        if not evidence_ids:
            errors.add("verified_fact_without_evidence")
        if claim.get("restated") is not True:
            # A restatement answers from the recorded claim of a previous
            # investigation; its evidence was validated when it was first
            # recorded, so it is not re-resolved against this call's evidence.
            for identifier in evidence_ids:
                item = known_evidence.get(identifier)
                if item is None:
                    errors.add("verified_fact_cites_unknown_evidence")
                elif item.get("status") not in (STATUS_AVAILABLE, "verified_zero"):
                    errors.add("verified_fact_cites_unavailable_evidence")
                elif (unit == UNIT_CURRENCY and currency is not None
                      and item.get("currency") != currency):
                    errors.add("verified_fact_currency_mismatch")
        _check_financial_impact(claim, errors)

    elif grade == CLAIM_CALCULATED_OBSERVATION:
        if not evidence_ids:
            errors.add("calculated_observation_without_evidence")
        calculation = claim.get("calculation")
        if not isinstance(calculation, dict):
            errors.add("calculated_observation_without_calculation")
        else:
            if not str(calculation.get("formula") or "").strip():
                errors.add("calculation_without_formula")
            if not str(calculation.get("version") or "").strip():
                errors.add("calculation_without_version")
            if not str(calculation.get("rounding") or "").strip():
                errors.add("calculation_without_rounding")
            calc_inputs = calculation.get("inputs") or []
            if not calc_inputs:
                errors.add("calculation_without_inputs")
            restated = claim.get("restated") is True
            input_currencies: set[str] = set()
            for entry in calc_inputs:
                evidence_id = entry.get("evidence_id")
                if not evidence_id:
                    errors.add("calculation_input_without_evidence")
                    continue
                if not restated and evidence_id not in known_evidence:
                    errors.add("calculation_input_cites_unknown_evidence")
                entry_value = entry.get("value")
                if entry_value is None:
                    errors.add("calculation_input_missing_value")  # no null-to-zero
                else:
                    entry_currency = normalize_currency(entry.get("currency"))
                    if entry_currency:
                        input_currencies.add(entry_currency)
            if len(input_currencies) > 1:
                errors.add("calculation_mixes_currencies")
            method = str(calculation.get("method") or "")
            if method in ("percent_change", "ratio"):
                denominators = [entry.get("value") for entry in calc_inputs
                                if entry.get("role") == "previous"
                                or entry.get("role") == "denominator"]
                for denominator in denominators:
                    if denominator is None:
                        errors.add("calculation_zero_or_missing_denominator")
                    else:
                        den = _decimal(denominator)
                        if den is None or den <= 0:
                            errors.add("calculation_zero_or_missing_denominator")
        _check_financial_impact(claim, errors)

    elif grade == CLAIM_HYPOTHESIS:
        hypothesis = claim.get("hypothesis")
        if not isinstance(hypothesis, dict):
            errors.add("hypothesis_without_block")
        else:
            if hypothesis.get("verified") is True:
                errors.add("hypothesis_claimed_verified")
            if not [e for e in (hypothesis.get("missing_evidence") or []) if str(e).strip()]:
                errors.add("hypothesis_without_missing_evidence")
        if claim.get("financial_impact"):
            errors.add("hypothesis_carries_financial_impact")
        if _decimal(value) is not None and claim.get("financial_impact"):
            errors.add("hypothesis_carries_financial_impact")

    elif grade == CLAIM_UNKNOWN:
        if value is not None:
            errors.add("unknown_claim_carries_value")
        unknown = claim.get("unknown")
        if not isinstance(unknown, dict):
            errors.add("unknown_without_block")
        elif not str(unknown.get("reason") or "").strip():
            errors.add("unknown_without_reason")

    return sorted(errors)


def _check_financial_impact(claim: dict, errors: set[str]) -> None:
    """Revenue/loss integrity: asserted impact requires a recorded method.

    An observed order total is not lost revenue; an abandoned-checkout value
    is only *potential* value. Any quantified CONSEQUENCE (lost, recoverable,
    saved, prevented, avoided, leakage) must sit on a calculated observation
    whose calculation method and verified inputs are recorded - otherwise the
    figure is a fabricated financial opportunity and is rejected.
    """
    impact = claim.get("financial_impact")
    if not impact:
        return
    if impact not in IMPACT_KINDS:
        errors.add(f"unknown_impact_kind:{impact}")
        return
    if impact in IMPACT_ASSERTED:
        calculation = claim.get("calculation")
        if claim.get("classification") != CLAIM_CALCULATED_OBSERVATION:
            errors.add("asserted_impact_without_method")
        elif not isinstance(calculation, dict) or not str(calculation.get("method") or "").strip():
            errors.add("asserted_impact_without_method")


def validate_claims(
    claims: Iterable[dict], items: Iterable[dict],
    *, organization_id: str | None = None, store_ids: Iterable[str] | None = None,
) -> list[str]:
    """Validate a set of claims against the evidence that exists."""
    known = {item.get("id"): item for item in (items or []) if item.get("id")}
    errors: set[str] = set()
    for claim in claims or []:
        if not isinstance(claim, dict):
            errors.add("claim_not_an_object")
            continue
        errors.update(validate_claim(claim, known_evidence=known,
                                     organization_id=organization_id,
                                     store_ids=store_ids))
    return sorted(errors)


# ---------------------------------------------------------------------------
# Rollup, promotion, correction, reference resolution
# ---------------------------------------------------------------------------

def epistemic_rollup(claims: Iterable[dict]) -> dict:
    """Counts by grade plus the epistemic posture per metric.

    The rollup is descriptive; it never upgrades a grade. A metric's posture
    is its MOST SUPPORTED grade present, so a verified figure next to an open
    cause is reported as both, not blended.
    """
    counts = {grade: 0 for grade in CLAIM_GRADES}
    per_metric: dict[str, set[str]] = {}
    for claim in claims or []:
        grade = claim.get("classification")
        if grade in counts:
            counts[grade] += 1
        metric = claim.get("metric")
        if metric:
            per_metric.setdefault(metric, set()).add(grade)
    return {
        "contract_version": CLAIM_CONTRACT_VERSION,
        "counts": counts,
        "total": sum(counts.values()),
        "metrics": {metric: sorted(grades) for metric, grades in sorted(per_metric.items())},
    }


def can_promote(hypothesis_claim: dict, new_evidence_ids: Iterable[str]) -> bool:
    """A hypothesis may become an established claim only with NEW evidence.

    Re-citing the same evidence that motivated the hypothesis (or none) is
    not verification. The rule is encoded so no code path - and no model - can
    silently promote a hypothesis.
    """
    if hypothesis_claim.get("classification") != CLAIM_HYPOTHESIS:
        return False
    hypothesis = hypothesis_claim.get("hypothesis") or {}
    supports = set(hypothesis.get("supports") or [])
    fresh = {str(e) for e in new_evidence_ids if e} - supports
    return len(fresh) >= 1


def correct_claim(claim: dict, *, reason: str) -> tuple[dict, dict]:
    """Correct a previously stated claim explicitly; never defend it.

    Returns ``(superseded_claim, correction_claim)``. The original claim is
    flagged ``superseded`` (its text and ids are preserved so the merchant can
    see exactly what changed); the correction is an unknown-grade record that
    names the reason and references the original claim id.
    """
    superseded = dict(claim)
    superseded["superseded"] = True
    superseded["superseded_reason"] = reason
    correction = {
        "claim_id": claim_id(CLAIM_CONTRACT_VERSION, claim.get("organization_id"),
                             claim.get("source_investigation") or "correction",
                             CLAIM_UNKNOWN, "correction", claim.get("claim_id")),
        "contract_version": CLAIM_CONTRACT_VERSION,
        "classification": CLAIM_UNKNOWN,
        "causal_status": "unknown",
        "text": f"Correcting a previously stated figure ({claim.get('claim_id')}): {reason}",
        "metric": claim.get("metric"),
        "value": None,
        "unit": None,
        "currency": normalize_currency(claim.get("currency")),
        "rounding": None,
        "period": claim.get("period"),
        "period_timezone": (claim.get("period") or {}).get("timezone") if isinstance(claim.get("period"), dict) else None,
        "retrieved_at": None,
        "observed_at": None,
        "computed_at": iso(utc_now()),
        "evidence_ids": [],
        "source": None,
        "organization_id": claim.get("organization_id"),
        "store_ids": list(claim.get("store_ids") or []),
        "quality": None,
        "limitations": [],
        "financial_impact": None,
        "calculation": None,
        "hypothesis": None,
        "unknown": {
            "reason": reason,
            "attempts": [f"previous claim {claim.get('claim_id')} retracted: {reason}"],
            "missing_capability": None,
            "needed_to_establish": "A fresh, verified retrieval for the same period and metric.",
        },
        "corrects_claim_id": claim.get("claim_id"),
    }
    return superseded, correction


def claim_reference(claims: Iterable[dict], mentioned_values: Iterable[float] = ()) -> dict | None:
    """Resolve a follow-up reference ("that number", "that growth rate").

    Preference: a claim whose value matches a specifically mentioned number;
    otherwise the most recent quantitative claim (calculated first, then
    observed). Returns the claim or None - never a reconstruction.
    """
    list_claims = [claim for claim in (claims or []) if isinstance(claim, dict)]
    mentioned = [abs(_decimal(value)) for value in mentioned_values
                 if value is not None and _decimal(value) is not None]
    for value in mentioned:
        for claim in list_claims:
            if claim.get("value") is None:
                continue
            claim_value = _decimal(claim.get("value"))
            if claim_value is None:
                continue
            if abs(abs(claim_value) - value) <= max(Decimal("0.011"), abs(claim_value) * Decimal("0.0001")):
                return claim
    ranked = sorted(
        (claim for claim in list_claims if claim.get("value") is not None),
        key=lambda claim: (0 if claim.get("classification") == CLAIM_CALCULATED_OBSERVATION else 1),
    )
    return ranked[0] if ranked else None
