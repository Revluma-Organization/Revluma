"""Rev Intelligence evidence contract.

Every analytical statement Rev makes must be traceable to one or more evidence
items produced by an authorised, organization-scoped tool.  This module defines
the single contract used by the Python intelligence runtime, the Node gateway
and the dashboard.

Rules encoded here (not merely documented):

* money is never mixed across currencies;
* a verified zero is not the same as "no data";
* missing data is never coerced to zero;
* every monetary item carries currency, period, source and definition;
* every item has a stable evidence identifier that answers can cite.
"""

from __future__ import annotations

import hashlib
import json
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Iterable

from .evidence_schema import EVIDENCE_SCHEMA_VERSION, STATUSES, EvidenceItem

STATUS_AVAILABLE = "available"
STATUS_PARTIAL = "partial"
STATUS_UNAVAILABLE = "unavailable"
STATUS_UNSUPPORTED = "unsupported"
EVIDENCE_STATUSES = STATUSES

UNIT_CURRENCY = "currency"
UNIT_COUNT = "count"
UNIT_RATIO = "ratio"
UNIT_RECORD = "record"
UNIT_REFERENCE = "reference"
UNITS = (UNIT_CURRENCY, UNIT_COUNT, UNIT_RATIO, UNIT_RECORD, UNIT_REFERENCE)

_EVIDENCE_OWNERSHIP: ContextVar[dict | None] = ContextVar("rev_evidence_ownership", default=None)


@contextmanager
def evidence_context(organization_id: str, store_ids: Iterable[str], *, timezone_label: str = "UTC"):
    """Bind trusted server-side ownership to every item built in this scope."""
    ids = list(dict.fromkeys(str(value) for value in store_ids if value))
    if not organization_id or not ids:
        raise ValueError("authenticated organization and authorized store scope are required")
    token = _EVIDENCE_OWNERSHIP.set({"organization_id": organization_id, "store_ids": ids, "timezone": timezone_label})
    try:
        yield
    finally:
        _EVIDENCE_OWNERSHIP.reset(token)


def current_evidence_context() -> dict | None:
    return _EVIDENCE_OWNERSHIP.get()

#: The four claim grades Rev may use, in descending order of strength.
#: A grade is a property of the evidence behind a statement, never a tone the
#: model may choose for emphasis.
CLAIM_VERIFIED_FACT = "verified_fact"
CLAIM_CALCULATED_OBSERVATION = "calculated_observation"
CLAIM_HYPOTHESIS = "hypothesis"
CLAIM_UNKNOWN = "unknown"
CLAIM_GRADES = (CLAIM_VERIFIED_FACT, CLAIM_CALCULATED_OBSERVATION, CLAIM_HYPOTHESIS, CLAIM_UNKNOWN)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def ensure_utc(value: datetime | None, *, field: str = "timestamp") -> datetime:
    if value is None:
        raise ValueError(f"{field} is required")
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{field} must be timezone-aware")
    return value.astimezone(timezone.utc)


def iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    return ensure_utc(value).isoformat().replace("+00:00", "Z")


def normalize_currency(code: Any) -> str | None:
    """Return an ISO-4217-shaped currency code or None.

    Never substitutes a default currency: an unknown currency means the
    monetary value cannot be used in a currency-explicit statement.
    """
    if not isinstance(code, str):
        return None
    candidate = code.strip().upper()
    if len(candidate) != 3 or not candidate.isalpha():
        return None
    return candidate


def money(value: Any) -> str | None:
    """Format a decimal monetary amount to two decimal places.

    Returns None for malformed values so callers cannot invent a number.
    """
    if value is None or isinstance(value, bool):
        return None
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return None
    if not amount.is_finite():
        return None
    return str(amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def decimal_value(value: Any) -> Decimal | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return None
    return amount if amount.is_finite() else None


def period(start: datetime, end: datetime, *, comparison_start: datetime | None = None,
           comparison_end: datetime | None = None, label: str | None = None,
           timezone_label: str = "UTC") -> dict:
    """A half-open UTC period, optionally with an equal-length comparison."""
    start = ensure_utc(start, field="period start")
    end = ensure_utc(end, field="period end")
    if end <= start:
        raise ValueError("period end must be after start")
    result = {
        "start": iso(start),
        "end": iso(end),
        "timezone": timezone_label,
        "semantics": "[start, end)",
    }
    if label:
        result["label"] = label
    if comparison_start is not None and comparison_end is not None:
        result["comparison_start"] = iso(comparison_start)
        result["comparison_end"] = iso(comparison_end)
    return result


def previous_period(start: datetime, end: datetime) -> tuple[datetime, datetime]:
    """Equal-length period immediately before ``start``."""
    start = ensure_utc(start)
    end = ensure_utc(end)
    duration = end - start
    return start - duration, start


def _evidence_id(metric: str, currency: str | None, window: dict, source: str,
                 discriminator: str = "") -> str:
    ownership = _EVIDENCE_OWNERSHIP.get() or {}
    payload = json.dumps(
        [metric, currency, window.get("start"), window.get("end"), source, discriminator,
         ownership.get("organization_id"), ownership.get("store_ids")],
        sort_keys=True,
    )
    return "ev-" + hashlib.sha256(payload.encode("utf-8")).hexdigest()[:24]


def evidence_item(
    metric: str,
    *,
    label: str,
    value: Any,
    unit: str = UNIT_COUNT,
    currency: str | None = None,
    window: dict | None = None,
    source: str,
    definition: str,
    status: str = STATUS_AVAILABLE,
    coverage: dict | None = None,
    freshness: dict | None = None,
    limitations: Iterable[str] | None = None,
    store_scope: str = "organization",
    discriminator: str = "",
    classification: str | None = None,
    evidence_type: str = "metric",
    domain: str | None = None,
    source_references: Iterable[dict] | None = None,
    measurement: dict | None = None,
    provenance: dict | None = None,
    confidence: dict | None = None,
) -> dict:
    """Build one validated evidence item.

    Monetary items must carry a currency and a decimal-string value.  A
    monetary item that cannot be attributed to a currency is ``unsupported``
    with a null value, never a silent zero.
    """
    if unit not in UNITS:
        raise ValueError(f"unsupported evidence unit: {unit}")
    if status not in EVIDENCE_STATUSES:
        raise ValueError(f"unsupported evidence status: {status}")
    if not source or not definition:
        raise ValueError("evidence source and definition are required")
    if not window:
        raise ValueError("evidence window is required")

    normalized_currency = normalize_currency(currency)
    normalized_value: Any = value
    if unit == UNIT_CURRENCY:
        if normalized_currency is None or status in (STATUS_UNAVAILABLE, STATUS_UNSUPPORTED):
            if status == STATUS_AVAILABLE:
                status = STATUS_UNSUPPORTED
            normalized_value = None if status != STATUS_AVAILABLE else money(value)
        else:
            normalized_value = money(value)
            if normalized_value is None:
                status = STATUS_UNSUPPORTED
    elif unit == UNIT_COUNT:
        if normalized_value is not None:
            if isinstance(normalized_value, bool) or not isinstance(normalized_value, int):
                raise ValueError("count evidence must be an integer or None")
            if normalized_value < 0:
                normalized_value = None
    elif unit == UNIT_RATIO:
        normalized_value = None if normalized_value is None else float(normalized_value)

    ownership = _EVIDENCE_OWNERSHIP.get()
    if not ownership:
        raise ValueError("authenticated evidence ownership context is required")
    store_ids = list(ownership["store_ids"])
    if store_scope == "store" and len(store_ids) != 1:
        raise ValueError("store-scoped evidence requires exactly one authorized store")
    raw_coverage = dict(coverage or {})
    complete = raw_coverage.get("complete") is True and raw_coverage.get("status", "complete") == "complete"
    normalized_coverage = {
        **raw_coverage,
        "status": raw_coverage.get("status") or ("complete" if complete else "unknown"),
        "period_status": raw_coverage.get("period_status") or ("covered" if complete else "unavailable"),
        "complete": complete,
        "source": raw_coverage.get("source") or source,
        "note": raw_coverage.get("note") or "Historical coverage is not certified by this source query.",
    }
    if status == STATUS_AVAILABLE and normalized_value == 0 and not complete:
        status = STATUS_PARTIAL
        normalized_value = None
    raw_freshness = dict(freshness or {})
    normalized_freshness = {
        "state": raw_freshness.get("state") or "unknown",
        "as_of": raw_freshness.get("as_of"),
        "age_seconds": raw_freshness.get("age_seconds"),
        "policy": raw_freshness.get("policy") or "domain-policy-unavailable",
        "note": raw_freshness.get("note") or "Source freshness is unknown.",
    }
    if raw_freshness.get("age_seconds") is None and raw_freshness.get("age_minutes") is not None:
        normalized_freshness["age_seconds"] = float(raw_freshness["age_minutes"]) * 60
    if normalized_freshness["state"] == "stale" and status == STATUS_AVAILABLE:
        status = "stale"
    if classification is None:
        classification = "unknown" if status in (STATUS_UNAVAILABLE, STATUS_UNSUPPORTED, "not_synchronized", "pending", "unauthorized", "retrieval_failed", "storage_failure", "invalid", "contradictory", "period_unavailable", "consent_unavailable") else ("deterministic_calculation" if unit == UNIT_RATIO else "verified_fact")
    if classification == "unknown":
        normalized_value = None
    if unit == UNIT_CURRENCY and measurement is None and normalized_value is not None:
        measurement = {
            "amount": normalized_value, "currency": normalized_currency,
            "interpretation": "net" if "net order" in definition.lower() or "net of refund" in definition.lower() else "gross",
            "tax": "unknown", "shipping": "unknown", "discounts": "unknown",
            "refunds": "deducted" if "refund" in definition.lower() else "unknown",
            "cancellations": "excluded" if "non-cancelled" in definition.lower() else "unknown",
            "numerator": None, "denominator": None, "formula": definition,
        }
    normalized_provenance = provenance or {
        "retrieval": "aggregate", "transformation": definition,
        "calculation_version": "metric-definition-v1", "lineage": [f"source:{source}"],
        "reproducible": True,
    }
    normalized_confidence = confidence or ({
        "level": "high" if complete and normalized_freshness["state"] == "fresh" else "medium",
        "score": 0.95 if complete and normalized_freshness["state"] == "fresh" else 0.55,
        "basis": "Validated source query with explicit coverage and freshness metadata.",
    } if classification != "unknown" else {"level": "none", "score": 0, "basis": "No affirmative value is established."})
    item = {
        "id": _evidence_id(metric, normalized_currency, window, source, discriminator),
        "schema_version": EVIDENCE_SCHEMA_VERSION,
        "organization_id": ownership["organization_id"],
        "store_id": store_ids[0] if store_scope == "store" else None,
        "store_ids": store_ids,
        "evidence_type": evidence_type,
        "domain": domain or source,
        "classification": classification,
        "metric": metric,
        "label": label,
        "value": normalized_value,
        "unit": unit,
        "currency": normalized_currency,
        "status": "verified_zero" if status == STATUS_AVAILABLE and normalized_value == 0 and complete else status,
        "period": {**window, "timezone": window.get("timezone") or ownership["timezone"]},
        "source": {"system": "shopify", "resource": source, "references": list(source_references or [])},
        "retrieved_at": iso(utc_now()),
        "computed_at": iso(utc_now()) if classification in ("deterministic_calculation", "analytical_finding") else None,
        "coverage": normalized_coverage,
        "freshness": normalized_freshness,
        "provenance": normalized_provenance,
        "measurement": measurement,
        "confidence": normalized_confidence,
        "definition": definition,
        "store_scope": store_scope,
        "limitations": list(limitations or []),
    }
    # Task 203: attach the six-dimension evidence-quality assessment so the
    # metadata is born with the item and survives every service boundary.
    # Lazy import: evidence_quality imports from this module.
    from .evidence_quality import quality_of
    item["quality"] = quality_of(item)
    return EvidenceItem.model_validate(item).model_dump(mode="json")


def availability_of(items: Iterable[dict]) -> str:
    """Collapse item statuses into a single availability for a metric group."""
    statuses = [item.get("status") for item in items]
    if not statuses:
        return STATUS_UNAVAILABLE
    if all(status == STATUS_UNSUPPORTED for status in statuses):
        return STATUS_UNSUPPORTED
    if all(status == STATUS_UNAVAILABLE for status in statuses):
        return STATUS_UNAVAILABLE
    if any(status not in (STATUS_AVAILABLE, "verified_zero") for status in statuses):
        return STATUS_PARTIAL
    return STATUS_AVAILABLE


def group_by_currency(items: Iterable[dict]) -> dict:
    """Money grouped per currency; never summed across codes."""
    grouped: dict[str, dict] = {}
    for item in items:
        if item.get("unit") != UNIT_CURRENCY or not item.get("currency"):
            continue
        bucket = grouped.setdefault(item["currency"], {"items": [], "value": None})
        bucket["items"].append(item["id"])
        total = decimal_value(bucket["value"] or 0) + (decimal_value(item.get("value")) or Decimal(0))
        bucket["value"] = str(total.quantize(Decimal("0.01")))
    return grouped


def validate_collection(items: Iterable[dict]) -> list[str]:
    """Strict runtime validation, including ownership and source lineage."""
    errors: list[str] = []
    seen: set[str] = set()
    for item in items:
        identifier = item.get("id")
        if not identifier:
            errors.append("missing_evidence_id")
        elif identifier in seen:
            errors.append("duplicate_evidence_id")
        seen.add(identifier)
        if item.get("status") not in STATUSES:
            errors.append("invalid_evidence_status")
        if not item.get("source") or not item.get("definition"):
            errors.append("missing_provenance")
        try:
            EvidenceItem.model_validate(item)
        except Exception:
            errors.append("invalid_evidence_contract")
    return sorted(set(errors))


def validate_claim_grades(
    claims: Iterable[dict],
    items: Iterable[dict],
) -> list[str]:
    """Enforce the four claim grades against the evidence that exists.

    Rules (deterministic, no model discretion):

    * ``verified_fact`` requires at least one resolvable cited evidence item,
      and every cited item must have ``status == available``. Monetary facts
      must cite items whose currency matches the claim currency.
    * ``calculated_observation`` requires at least one resolvable cited item
      and a non-empty ``definition``; cited items may be ``available`` or
      ``partial``.
    * ``hypothesis`` may never be emitted as verified, and if it cites
      evidence the ids must resolve. A hypothesis is an open question, not a
      conclusion with softer wording.
    * ``unknown`` may not carry a numeric value; anything not established is
      reported as missing, not guessed.

    Returns a sorted list of stable error codes; an empty list means the
    claims are admissible.
    """
    known = {item.get("id"): item for item in (items or []) if item.get("id")}
    errors: list[str] = []
    for claim in claims or []:
        grade = claim.get("grade")
        if grade not in CLAIM_GRADES:
            errors.append("invalid_claim_grade")
            continue
        evidence_ids = [value for value in (claim.get("evidence_ids") or []) if value]
        if grade == CLAIM_VERIFIED_FACT:
            if not evidence_ids:
                errors.append("verified_fact_without_evidence")
            for identifier in evidence_ids:
                item = known.get(identifier)
                if item is None:
                    errors.append("verified_fact_cites_unknown_evidence")
                elif item.get("status") not in (STATUS_AVAILABLE, "verified_zero"):
                    errors.append("verified_fact_cites_unavailable_evidence")
                elif (claim.get("unit") == UNIT_CURRENCY
                      and normalize_currency(claim.get("currency")) is not None
                      and item.get("currency") != normalize_currency(claim.get("currency"))):
                    errors.append("verified_fact_currency_mismatch")
        elif grade == CLAIM_CALCULATED_OBSERVATION:
            if not evidence_ids:
                errors.append("calculated_observation_without_evidence")
            if not str(claim.get("definition") or "").strip():
                errors.append("calculated_observation_without_definition")
            for identifier in evidence_ids:
                item = known.get(identifier)
                if item is None:
                    errors.append("calculated_observation_cites_unknown_evidence")
                elif item.get("status") not in (STATUS_AVAILABLE, STATUS_PARTIAL):
                    errors.append("calculated_observation_cites_unavailable_evidence")
        elif grade == CLAIM_HYPOTHESIS:
            if claim.get("verified") is True:
                errors.append("hypothesis_claimed_verified")
            for identifier in evidence_ids:
                if identifier not in known:
                    errors.append("hypothesis_cites_unknown_evidence")
        elif grade == CLAIM_UNKNOWN:
            if claim.get("value") is not None:
                errors.append("unknown_claim_carries_value")
    return sorted(set(errors))


def validate_attribution(
    facts: Iterable[dict],
    hypotheses: Iterable[dict],
    items: Iterable[dict],
) -> list[str]:
    """Check that every claim cites evidence that actually exists.

    A calculated observation or a hypothesis without a resolvable evidence id
    is an attribution gap: the merchant cannot verify the number behind it.
    Monetary facts must also carry the currency they are stated in.
    """
    known = {item.get("id") for item in (items or []) if item.get("id")}
    errors: list[str] = []
    for fact in facts or []:
        identifiers = [value for value in (fact.get("evidence_ids") or []) if value]
        if not identifiers:
            errors.append("fact_without_evidence")
        elif any(identifier not in known for identifier in identifiers):
            errors.append("fact_cites_unknown_evidence")
        if fact.get("unit") == UNIT_CURRENCY and normalize_currency(fact.get("currency")) is None:
            errors.append("currency_fact_without_currency")
    for hypothesis in hypotheses or []:
        if hypothesis.get("verified") is True:
            errors.append("hypothesis_claimed_verified")
        basis = [value for value in
                 (hypothesis.get("basis_evidence_ids") or hypothesis.get("evidence_ids") or [])
                 if value]
        if any(identifier not in known for identifier in basis):
            errors.append("hypothesis_cites_unknown_evidence")
    return sorted(set(errors))


def money_percent_change(current: Any, previous: Any) -> dict:
    """Percentage change with an explicit denominator; never fabricates one."""
    current_decimal = decimal_value(current)
    previous_decimal = decimal_value(previous)
    if current_decimal is None or previous_decimal is None:
        return {"status": STATUS_UNSUPPORTED, "reason": "missing_currency_value"}
    if previous_decimal <= 0:
        return {"status": STATUS_UNSUPPORTED, "reason": "previous_period_not_positive"}
    change = (current_decimal - previous_decimal) / previous_decimal * Decimal(100)
    return {
        "status": STATUS_AVAILABLE,
        "percent": str(change.quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)),
        "direction": "up" if change > 0 else "down" if change < 0 else "flat",
    }


def describe_period(window: dict) -> str:
    start = window.get("start")
    end = window.get("end")
    if not start or not end:
        return "an unspecified period"

    def _parse(value: str) -> datetime:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))

    try:
        start_dt, end_dt = _parse(start), _parse(end)
    except ValueError:
        return "an unspecified period"
    if end_dt - start_dt == timedelta(days=7):
        return f"{start_dt:%d %b} to {end_dt:%d %b %Y} (7 days, UTC)"
    if end_dt - start_dt == timedelta(days=1):
        return f"{start_dt:%d %b %Y} (1 day, UTC)"
    return f"{start_dt:%d %b %Y %H:%M} to {end_dt:%d %b %Y %H:%M} (UTC)"
