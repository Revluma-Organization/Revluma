"""Unified evidence-quality model (Task 203; original Tasks 207-211).

A *confident answer based on incomplete or contradictory evidence is a product
defect.*  This module is the single coherent model through which every
evidence-quality judgement is made.  It does not replace the Task 197 evidence
contract; it *derives* quality from the fields that contract already carries
(status, coverage, freshness, value, currency, classification) and adds the
deterministic capability helpers the pipeline needs:

* currency-safe aggregation and cross-currency comparison  (Task 207)
* zero-vs-missing value-state classification               (Task 208)
* incomplete-evidence fallback / sufficiency               (Task 209)
* source-specific freshness with historical/current split  (Task 210)
* contradiction detection and defensible resolution        (Task 211)

The six quality dimensions are represented INDEPENDENTLY and must never be
collapsed into a single ambiguous status:

    A. availability        - can we use the source at all?
    B. coverage            - is the queried population complete?
    C. freshness           - is the evidence current enough?
    D. value_state         - what is the actual value?
    E. consistency         - do the sources agree?
    F. currency_integrity  - are the amounts comparably currency-attributed?

Consequences the model must permit (asserted in tests):

* evidence can be **available but stale**;
* evidence can be **fresh but incomplete**;
* evidence can be **complete but contradictory**;
* evidence can contain a **verified zero** while another source is unavailable;
* evidence can be **complete but not safely comparable** across currencies.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Iterable

from .evidence import (
    UNIT_CURRENCY,
    ensure_utc,
    money,
    normalize_currency,
)

QUALITY_SCHEMA_VERSION = "rev-evidence-quality-v1"

# --- A. Availability ------------------------------------------------------
AVAILABILITY_AVAILABLE = "available"
AVAILABILITY_PARTIAL = "partially_available"
AVAILABILITY_UNAVAILABLE = "unavailable"
AVAILABILITY_UNAUTHORIZED = "unauthorized"
AVAILABILITY_UNSUPPORTED = "unsupported"
AVAILABILITY_NOT_SYNCED = "not_synchronized"
AVAILABILITY_RETRIEVAL_FAILED = "retrieval_failed"
AVAILABILITY = (
    AVAILABILITY_AVAILABLE, AVAILABILITY_PARTIAL, AVAILABILITY_UNAVAILABLE,
    AVAILABILITY_UNAUTHORIZED, AVAILABILITY_UNSUPPORTED,
    AVAILABILITY_NOT_SYNCED, AVAILABILITY_RETRIEVAL_FAILED,
)

# --- B. Coverage ----------------------------------------------------------
COVERAGE_COMPLETE = "complete"
COVERAGE_PARTIAL = "partial"
COVERAGE_UNKNOWN = "unknown"
COVERAGE_NOT_APPLICABLE = "not_applicable"
COVERAGE = (COVERAGE_COMPLETE, COVERAGE_PARTIAL, COVERAGE_UNKNOWN, COVERAGE_NOT_APPLICABLE)

# --- C. Freshness ---------------------------------------------------------
FRESH_FRESH = "fresh"
FRESH_AGING = "aging"
FRESH_STALE = "stale"
FRESH_UNKNOWN = "unknown"
FRESH_SYNCHRONIZING = "synchronizing"
FRESH_FAILED = "failed"
FRESH_NEVER = "never_synchronized"
FRESHNESS = (
    FRESH_FRESH, FRESH_AGING, FRESH_STALE, FRESH_UNKNOWN,
    FRESH_SYNCHRONIZING, FRESH_FAILED, FRESH_NEVER,
)

# --- D. Value state -------------------------------------------------------
VALUE_OBSERVED_NONZERO = "observed_nonzero"
VALUE_VERIFIED_ZERO = "verified_zero"
VALUE_NULL = "null"
VALUE_MISSING = "missing"
VALUE_NOT_APPLICABLE = "not_applicable"
VALUE_UNKNOWN = "unknown"
VALUE_STATE = (
    VALUE_OBSERVED_NONZERO, VALUE_VERIFIED_ZERO, VALUE_NULL, VALUE_MISSING,
    VALUE_NOT_APPLICABLE, VALUE_UNKNOWN,
)

# --- E. Consistency -------------------------------------------------------
CONSISTENT = "consistent"
CONFLICTING = "conflicting"
UNVERIFIED = "unverified"
CONSISTENCY = (CONSISTENT, CONFLICTING, UNVERIFIED)

# --- F. Currency integrity ------------------------------------------------
CURRENCY_SINGLE = "single_verified_currency"
CURRENCY_COMPATIBLE = "compatible"
CURRENCY_CONVERTED = "explicitly_converted"
CURRENCY_MIXED = "mixed_not_comparable"
CURRENCY_UNKNOWN = "unknown_currency"
CURRENCY_NOT_APPLICABLE = "not_applicable"
CURRENCY_INTEGRITY = (
    CURRENCY_SINGLE, CURRENCY_COMPATIBLE, CURRENCY_CONVERTED, CURRENCY_MIXED,
    CURRENCY_UNKNOWN, CURRENCY_NOT_APPLICABLE,
)

# --- Sufficiency of evidence for a conclusion -----------------------------
SUFFICIENT = "sufficient"
PARTIAL = "partial"
INSUFFICIENT = "insufficient"
UNAVAILABLE = "unavailable"
SUFFICIENCY = (SUFFICIENT, PARTIAL, INSUFFICIENT, UNAVAILABLE)

# A status is "usable" (the source answered) when the value is present even if
# other dimensions are degraded.  Stale and contradictory evidence is still
# *available* - the other dimensions carry the degradation.
_USABLE_STATUSES = {"available", "verified_zero", "stale", "contradictory"}
_UNAVAILABLE_STATUSES = {"unavailable", "period_unavailable", "invalid"}
_UNAUTHORIZED_STATUSES = {"unauthorized", "consent_unavailable"}
_UNSUPPORTED_STATUSES = {"unsupported"}
_NOT_SYNCED_STATUSES = {"not_synchronized"}
_RETRIEVAL_FAILED_STATUSES = {"retrieval_failed", "storage_failure"}
_PARTIAL_STATUSES = {"partial", "pending"}

_ZERO_DENOMINATOR_NOTE = (
    "The denominator is zero or non-positive, so no ratio or percentage is "
    "computed; an invented denominator would be a fabricated value."
)


# --------------------------------------------------------------------------
# Dimension derivation
# --------------------------------------------------------------------------

def availability_of(item: dict) -> str:
    """Map an item's status onto the availability dimension."""
    status = item.get("status")
    if status in _USABLE_STATUSES:
        return AVAILABILITY_AVAILABLE
    if status in _PARTIAL_STATUSES:
        return AVAILABILITY_PARTIAL
    if status in _UNAUTHORIZED_STATUSES:
        return AVAILABILITY_UNAUTHORIZED
    if status in _UNSUPPORTED_STATUSES:
        return AVAILABILITY_UNSUPPORTED
    if status in _NOT_SYNCED_STATUSES:
        return AVAILABILITY_NOT_SYNCED
    if status in _RETRIEVAL_FAILED_STATUSES:
        return AVAILABILITY_RETRIEVAL_FAILED
    return AVAILABILITY_UNAVAILABLE


def coverage_of(item: dict) -> str:
    """Map an item's coverage block onto the coverage dimension."""
    coverage = item.get("coverage") or {}
    status = coverage.get("status")
    period_status = coverage.get("period_status")
    if period_status == "not_applicable":
        return COVERAGE_NOT_APPLICABLE
    if status == "complete" and coverage.get("complete") is True:
        return COVERAGE_COMPLETE
    if status == "partial":
        return COVERAGE_PARTIAL
    # not_synchronized / unsupported / missing_authorization / ... : the
    # population could not be certified, so coverage is unknown (the
    # *availability* dimension carries the reason).
    return COVERAGE_UNKNOWN


def freshness_of(item: dict) -> str:
    """Map an item's freshness block and status onto the freshness dimension."""
    freshness = item.get("freshness") or {}
    state = freshness.get("state")
    status = item.get("status")
    if status in _RETRIEVAL_FAILED_STATUSES:
        return FRESH_FAILED
    if state in FRESHNESS:
        return state
    if status in _NOT_SYNCED_STATUSES:
        return FRESH_NEVER
    return FRESH_UNKNOWN


def value_state_of(item: dict) -> str:
    """Classify the actual value of an item (the zero-vs-missing distinction).

    A *verified zero* is an observed zero over a complete population.  A null
    or absent value is never promoted to zero.  Non-numeric units (record /
    reference) have no numeric value state.
    """
    unit = item.get("unit")
    if unit in ("record", "reference"):
        return VALUE_NOT_APPLICABLE
    value = item.get("value")
    status = item.get("status")
    coverage = item.get("coverage") or {}

    if item.get("status") == "verified_zero" or (
        value == 0 and coverage.get("complete") is True and coverage.get("status") == "complete"
    ):
        return VALUE_VERIFIED_ZERO
    if value is None:
        # We know the value is absent.  "missing" = the source could not be
        # queried (an availability problem); "null" = it was queried and the
        # field is simply unpopulated.
        if status in (
            "unauthorized", "consent_unavailable", "not_synchronized",
            "retrieval_failed", "storage_failure", "pending", "unsupported",
        ):
            return VALUE_MISSING
        return VALUE_NULL if status in _USABLE_STATUSES else VALUE_UNKNOWN
    if value == 0:
        # A zero that is *not* over a complete population is not a verified
        # zero; it is an unknown value (never silently a zero).
        return VALUE_UNKNOWN
    return VALUE_OBSERVED_NONZERO


def consistency_of(item: dict) -> str:
    """A single available fact is consistent; degraded or flagged items are not."""
    status = item.get("status")
    if status == "contradictory":
        return CONFLICTING
    if status in _USABLE_STATUSES:
        return CONSISTENT
    return UNVERIFIED


def currency_integrity_of(item: dict) -> str:
    """Currency integrity of a *single* item.

    Collection-level integrity (compatible / mixed / converted) is computed by
    :func:`currency_integrity_of_collection` because it is a property of a set
    of amounts, not of one.
    """
    if item.get("unit") != UNIT_CURRENCY:
        return CURRENCY_NOT_APPLICABLE
    currency = normalize_currency(item.get("currency"))
    if currency is None:
        return CURRENCY_UNKNOWN
    return CURRENCY_SINGLE


def _reason(*codes: str) -> list[str]:
    return list(codes)


def sufficiency(dimensions: dict, *, current_claim: bool = True) -> tuple[str, list[str]]:
    """Decide how far the evidence supports a conclusion.

    ``current_claim`` asks whether the evidence is good enough to support a
    *current-state* claim.  A stale source may still support a *historical*
    claim, so staleness only blocks current claims.
    """
    reasons: list[str] = []
    availability = dimensions["availability"]
    coverage = dimensions["coverage"]
    freshness = dimensions["freshness"]
    value = dimensions["value_state"]
    consistency = dimensions["consistency"]
    currency = dimensions["currency_integrity"]

    if availability in (
        AVAILABILITY_UNAVAILABLE, AVAILABILITY_UNAUTHORIZED, AVAILABILITY_UNSUPPORTED,
        AVAILABILITY_NOT_SYNCED, AVAILABILITY_RETRIEVAL_FAILED,
    ):
        return UNAVAILABLE, _reason(f"source_{availability}")

    if value in (VALUE_MISSING,):
        reasons.append("value_missing")
    if value == VALUE_UNKNOWN:
        reasons.append("value_unknown")
    if coverage == COVERAGE_PARTIAL:
        reasons.append("partial_coverage")
    elif coverage == COVERAGE_UNKNOWN:
        reasons.append("coverage_unknown")
    if consistency == CONFLICTING:
        reasons.append("conflicting_evidence")
    if currency == CURRENCY_MIXED:
        reasons.append("mixed_currencies_not_comparable")
    elif currency == CURRENCY_UNKNOWN:
        reasons.append("currency_unknown")

    if current_claim:
        if freshness in (FRESH_STALE, FRESH_FAILED, FRESH_NEVER):
            reasons.append(f"{freshness}_for_current_claim")
        elif freshness == FRESH_SYNCHRONIZING:
            reasons.append("synchronizing_for_current_claim")

    if not reasons:
        return SUFFICIENT, []

    # A missing/unknown value with incomplete coverage is not a usable partial
    # answer - it is insufficient.  Otherwise the evidence is partial: it still
    # says something, but the limitation must stay visible.
    if value in (VALUE_MISSING, VALUE_UNKNOWN) and coverage != COVERAGE_COMPLETE:
        return INSUFFICIENT, reasons
    if availability == AVAILABILITY_PARTIAL:
        return INSUFFICIENT, reasons
    return PARTIAL, reasons


def quality_of(item: dict, *, current_claim: bool = True) -> dict:
    """Derive the full six-dimension quality block for one evidence item."""
    dimensions = {
        "availability": availability_of(item),
        "coverage": coverage_of(item),
        "freshness": freshness_of(item),
        "value_state": value_state_of(item),
        "consistency": consistency_of(item),
        "currency_integrity": currency_integrity_of(item),
    }
    verdict, reasons = sufficiency(dimensions, current_claim=current_claim)
    return {
        "schema_version": QUALITY_SCHEMA_VERSION,
        **dimensions,
        "sufficiency": verdict,
        "reasons": reasons,
    }


# --------------------------------------------------------------------------
# A. Currency safety (Task 207)
# --------------------------------------------------------------------------

def _to_decimal(value: Any) -> Decimal | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        amount = Decimal(str(value))
    except Exception:
        return None
    return amount if amount.is_finite() else None


def aggregate_currency(values: Iterable[dict]) -> dict:
    """Aggregate monetary amounts *per currency*; never across currencies.

    Each input is ``{"amount": <number|str|Decimal|None>, "currency": <code>,
    "source"?: str}``.  Amounts in different currencies are reported in their
    own buckets and the combined total is only produced when a single verified
    currency is involved.  Unknown currencies are quarantined, never coerced.
    """
    buckets: dict[str, dict] = {}
    unknown: list[dict] = []
    malformed: list[dict] = []
    for entry in values:
        currency = normalize_currency(entry.get("currency"))
        amount = _to_decimal(entry.get("amount"))
        if currency is None:
            unknown.append({"amount": None if amount is None else str(amount), "source": entry.get("source")})
            continue
        if amount is None:
            # A currency-attributed amount that is not numeric (NaN/Inf/malformed)
            # is quarantined so it can never silently become zero in a total.
            malformed.append({"currency": currency, "source": entry.get("source")})
            continue
        bucket = buckets.setdefault(currency, {"total": Decimal("0"), "count": 0})
        bucket["total"] += amount
        bucket["count"] += 1

    currencies = {
        code: {"total": str(v["total"].quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)), "count": v["count"]}
        for code, v in sorted(buckets.items())
    }
    mixed = len(currencies) > 1
    combined = None
    if len(currencies) == 1 and not unknown and not malformed:
        combined = next(iter(currencies.values()))["total"]
    if malformed:
        reason = "one or more amounts are not numeric; the total is not reliable"
    elif mixed:
        reason = "amounts span multiple currencies and must not be combined"
    elif unknown:
        reason = "one or more amounts have an unknown or invalid currency"
    elif not currencies:
        reason = "no currency-attributed amounts were provided"
    else:
        reason = "single verified currency"

    return {
        "currencies": currencies,
        "unknown_currency_amounts": unknown,
        "malformed_amounts": malformed,
        "mixed": mixed,
        "combined": combined,
        "usable": combined is not None,
        "reason": reason,
    }


def compare_currency(
    a: dict, b: dict, conversion: dict | None = None,
) -> dict:
    """Compare two monetary amounts, only across currencies with a documented
    conversion.

    Same currency -> compare directly.  Different currencies -> only comparable
    when ``conversion`` is a documented, provenance-carrying rate covering the
    pair; otherwise the amounts are reported as not directly comparable and the
    original values are preserved.  Never fabricates a rate.
    """
    currency_a = normalize_currency(a.get("currency"))
    currency_b = normalize_currency(b.get("currency"))
    amount_a = _to_decimal(a.get("amount"))
    amount_b = _to_decimal(b.get("amount"))

    base = {"a": {"amount": None if amount_a is None else str(amount_a), "currency": currency_a},
            "b": {"amount": None if amount_b is None else str(amount_b), "currency": currency_b}}
    if amount_a is None or amount_b is None:
        return {**base, "comparable": False, "reason": "one or both amounts are not numeric"}
    if currency_a is None or currency_b is None:
        return {**base, "comparable": False, "reason": "unknown or invalid currency code"}

    if currency_a == currency_b:
        difference = amount_a - amount_b
        return {
            **base, "comparable": True, "basis": "same_currency",
            "difference": str(difference.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)),
            "higher": "a" if difference > 0 else "b" if difference < 0 else "equal",
        }

    if conversion is None:
        return {
            **base, "comparable": False,
            "reason": "different currencies with no documented conversion; amounts are not directly comparable",
        }

    from_code = normalize_currency(conversion.get("from_currency"))
    to_code = normalize_currency(conversion.get("to_currency"))
    rate = _to_decimal(conversion.get("rate"))
    if rate is None or rate <= 0 or not conversion.get("documented") or not conversion.get("source"):
        return {**base, "comparable": False,
                "reason": "conversion is not documented or lacks a positive rate"}
    if {from_code, to_code} != {currency_a, currency_b}:
        return {**base, "comparable": False,
                "reason": "conversion does not cover the compared currency pair"}

    # Convert b into a's currency for the comparison. Rate convention: one unit
    # of from_currency == `rate` units of to_currency (e.g. 1 USD == 1600 NGN).
    if to_code == currency_a and from_code == currency_b:
        comparable_b = amount_b * rate      # b is denominated in from_currency
    elif from_code == currency_a and to_code == currency_b:
        comparable_b = amount_b / rate      # b is denominated in to_currency
    else:
        return {**base, "comparable": False, "reason": "conversion direction does not match"}
    difference = amount_a - comparable_b
    return {
        **base, "comparable": True, "basis": "explicit_conversion",
        "conversion": {
            "source": conversion.get("source"),
            "rate": str(rate),
            "from_currency": from_code, "to_currency": to_code,
            "rate_at": conversion.get("rate_at"),
        },
        "difference": str(difference.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)),
        "higher": "a" if difference > 0 else "b" if difference < 0 else "equal",
    }


# --------------------------------------------------------------------------
# B. Zero vs missing (Task 208)
# --------------------------------------------------------------------------

def classify_zero_value(context: dict) -> dict:
    """Distinguish a genuine zero from missing/unavailable evidence.

    ``context`` keys:
      value             - the observed value (number/str/Decimal) or None
      value_is_null_field - True when records exist but the field is unpopulated
      kind              - "count" or "amount" (default "amount")
      records_found     - int/bool of matching records, or None if unknown
      coverage_complete - bool, the queried population is certified complete
      coverage_status   - "complete" | "partial" | ... | None
      authorized        - bool
      sync_state        - "ok" | "failed" | "synchronizing" | "never" | None
      queried           - bool, whether the source was actually queried

    Returns ``{"state": <one of the eight>, "verified_zero": bool, "explanation": str}``.
    """
    value = context.get("value")
    amount = _to_decimal(value)
    kind = context.get("kind") or "amount"
    coverage_complete = context.get("coverage_complete") is True
    authorized = context.get("authorized") is True
    sync_state = context.get("sync_state")
    queried = context.get("queried")
    records_found = context.get("records_found")

    if not authorized:
        return {"state": "unauthorized_or_unavailable", "verified_zero": False,
                "explanation": "The source is not authorized, so no population was queried; zero must not be claimed."}
    if sync_state == "failed" or (queried is False):
        return {"state": "failed_or_incomplete_sync", "verified_zero": False,
                "explanation": "The source failed to synchronize or was not queried; the absence of rows is not evidence of zero."}
    if sync_state == "never":
        return {"state": "failed_or_incomplete_sync", "verified_zero": False,
                "explanation": "The source has never synchronized; its population is unknown."}
    if context.get("value_is_null_field") or (amount is None and records_found):
        return {"state": "null_field", "verified_zero": False,
                "explanation": "Records exist but the value field is unpopulated; a null is not a zero."}
    if amount is None:
        return {"state": "missing_record", "verified_zero": False,
                "explanation": "No value could be read from the source."}

    if amount != 0:
        return {"state": "observed_nonzero", "verified_zero": False,
                "explanation": "A non-zero value was observed."}

    # amount == 0 from here on
    if not coverage_complete:
        return {"state": "incomplete_coverage", "verified_zero": False,
                "explanation": "The observed zero is over an incomplete population, so it cannot be certified as a true zero."}
    if kind == "count" and not records_found:
        return {"state": "no_match_verified_population", "verified_zero": True,
                "explanation": "The fully-queried population contains no matching records; this is a verified zero count."}
    return {"state": "verified_zero", "verified_zero": True,
            "explanation": "The value is zero over a certified complete population; the zero is genuine."}


def safe_ratio(numerator: Any, denominator: Any) -> dict:
    """A ratio that never divides by zero or fabricates a denominator."""
    num = _to_decimal(numerator)
    den = _to_decimal(denominator)
    if num is None or den is None:
        return {"ok": False, "value": None, "reason": "missing_numerics"}
    if den == 0:
        return {"ok": False, "value": None, "reason": "zero_denominator", "note": _ZERO_DENOMINATOR_NOTE}
    return {"ok": True, "value": float((num / den).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)), "reason": None}


def safe_percent_change(current: Any, previous: Any) -> dict:
    """Percentage change with a hard guard on a zero/non-positive baseline."""
    cur = _to_decimal(current)
    prev = _to_decimal(previous)
    if cur is None or prev is None:
        return {"ok": False, "percent": None, "reason": "missing_values"}
    if prev <= 0:
        return {"ok": False, "percent": None, "reason": "zero_or_nonpositive_baseline", "note": _ZERO_DENOMINATOR_NOTE}
    change = (cur - prev) / prev * Decimal(100)
    return {"ok": True, "percent": str(change.quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)), "reason": None}


# --------------------------------------------------------------------------
# C. Source-specific freshness (Task 210)
# --------------------------------------------------------------------------

def evaluate_freshness(
    *,
    as_of: datetime | None,
    last_successful_sync: datetime | None,
    now: datetime,
    policy_seconds: float,
    sync_state: str | None = None,
    question: str = "current",
    period: dict | None = None,
) -> dict:
    """Evaluate freshness against a source-specific policy.

    Mirrors the existing pattern (fresh <= policy, aging <= 2*policy, else
    stale).  Separates *source freshness* from *reporting-period age* and from
    whether the evidence can support a **current-state** claim versus a
    **historical** claim.

    ``question`` is "current" or "historical".  A historical question is
    answerable from old evidence when the evidence's ``as_of`` falls at or
    after the requested ``period`` start (provenance reliable); a current-state
    question is not supported by stale/failed/never evidence.
    """
    now = ensure_utc(now, field="now")
    policy_seconds = max(0, float(policy_seconds))

    if sync_state == "synchronizing":
        return {"state": FRESH_SYNCHRONIZING, "age_seconds": None, "supports_current_claim": False,
                "supports_historical_claim": False, "reason": "synchronization is in progress"}
    if sync_state == "failed":
        return {"state": FRESH_FAILED, "age_seconds": None, "supports_current_claim": False,
                "supports_historical_claim": False, "reason": "the source's latest synchronization failed"}
    if as_of is None and last_successful_sync is None:
        return {"state": FRESH_NEVER, "age_seconds": None, "supports_current_claim": False,
                "supports_historical_claim": False, "reason": "the source has never synchronized"}

    reference = as_of or last_successful_sync
    reference = ensure_utc(reference, field="as_of")
    age_seconds = max(0, (now - reference).total_seconds())
    if policy_seconds == 0:
        state = FRESH_FRESH
    elif age_seconds <= policy_seconds:
        state = FRESH_FRESH
    elif age_seconds <= policy_seconds * 2:
        state = FRESH_AGING
    else:
        state = FRESH_STALE

    supports_current = state in (FRESH_FRESH, FRESH_AGING) and sync_state not in ("failed",)

    supports_historical = False
    if question == "historical" and period is not None:
        start = period.get("start")
        if start:
            period_start = ensure_utc(datetime.fromisoformat(str(start).replace("Z", "+00:00")), field="period start")
            # Evidence observed at/after the period start can speak to that
            # historical window even if it is stale relative to "now".
            supports_historical = reference >= period_start and state != FRESH_FAILED

    if state == FRESH_STALE:
        reason = (f"latest observation is {int(age_seconds)}s old (policy {int(policy_seconds)}s); "
                  "too old to support a current-state claim")
    elif state == FRESH_AGING:
        reason = f"evidence is aging ({int(age_seconds)}s old, policy {int(policy_seconds)}s)"
    else:
        reason = f"evidence is fresh ({int(age_seconds)}s old, policy {int(policy_seconds)}s)"

    return {
        "state": state, "age_seconds": age_seconds,
        "as_of": reference.isoformat().replace("+00:00", "Z"),
        "policy_seconds": policy_seconds,
        "supports_current_claim": supports_current,
        "supports_historical_claim": supports_historical,
        "reason": reason,
    }


# --------------------------------------------------------------------------
# D. Contradiction detection and resolution (Task 211)
# --------------------------------------------------------------------------

def _numeric(value: Any) -> Decimal | None:
    return _to_decimal(value)


def detect_contradictions(
    items: Iterable[dict], *, source_of_truth: dict | None = None,
) -> list[dict]:
    """Detect material conflicts across evidence items and resolve them only by
    defensible rules.

    Two items are *candidates* for contradiction only when they describe the
    same metric over the same reporting period, in the same currency, with the
    same unit, and are both numeric.  Differences in period, currency, unit or
    metric are *not* contradictions.

    ``source_of_truth`` maps a metric to the source system whose record wins
    when a documented authority exists.  Without authority, the conflict stays
    unresolved (never averaged, never silently discarded) and must lower
    confidence.
    """
    items = list(items)
    groups: dict[tuple, list[dict]] = {}
    for item in items:
        if item.get("unit") != UNIT_CURRENCY and item.get("unit") not in ("count", "ratio"):
            continue
        value = _numeric(item.get("value"))
        if value is None:
            continue
        period = item.get("period") or {}
        key = (
            item.get("metric"),
            period.get("start"), period.get("end"),
            normalize_currency(item.get("currency")) if item.get("unit") == UNIT_CURRENCY else None,
            item.get("unit"),
            tuple(sorted(item.get("store_ids") or [])),
        )
        groups.setdefault(key, []).append(item)

    conflicts: list[dict] = []
    for key, group in groups.items():
        values = {_numeric(item.get("value")) for item in group}
        if len(group) < 2 or len(values) < 2:
            continue  # identical values: no conflict

        metric = key[0]
        resolution = None
        winner = None
        winner_value = None
        reason = None
        resolved = False

        # Rule 1: a documented source-of-truth wins.
        authority = (source_of_truth or {}).get(metric)
        if authority:
            for item in group:
                if (item.get("source") or {}).get("resource") == authority or item.get("domain") == authority:
                    winner = item
                    break
        # Rule 2: a fresh, current record supersedes a stale one (recency).
        if winner is None:
            fresh = [i for i in group if freshness_of(i) in (FRESH_FRESH, FRESH_AGING)]
            stale = [i for i in group if freshness_of(i) == FRESH_STALE]
            if len(fresh) == 1 and len(stale) >= 1:
                winner = fresh[0]

        if winner is not None:
            resolved = True
            winner_value = _numeric(winner.get("value"))
            resolution = "source_of_truth" if authority else "recency_supersession"
            reason = (
                f"resolved to the authoritative record for '{metric}'" if authority
                else "the fresh current record supersedes the stale one"
            )
        else:
            resolution = "unresolved"
            reason = ("no documented source-of-truth and no unambiguous supersedence; "
                      "the conflict is preserved and the conclusion must stay uncertain")

        conflicts.append({
            "metric": metric,
            "period": {"start": key[1], "end": key[2]},
            "currency": key[3],
            "unit": key[4],
            "values": [str(v) for v in sorted(values)],
            "resolved": resolved,
            "resolution": resolution,
            "winner_id": winner.get("id") if winner else None,
            "winner_value": None if winner_value is None else str(winner_value),
            "reason": reason,
            "confidence_impact": "none" if resolved else "reduce",
            "contradictory": True,
        })
    return conflicts


# --------------------------------------------------------------------------
# Collection-level rollup
# --------------------------------------------------------------------------

def currency_integrity_of_collection(items: Iterable[dict], *, conversion: dict | None = None) -> str:
    """Currency integrity across a set of monetary items."""
    currencies: set[str] = set()
    for item in items:
        if item.get("unit") != UNIT_CURRENCY:
            continue
        currency = normalize_currency(item.get("currency"))
        if currency is None:
            return CURRENCY_UNKNOWN
        currencies.add(currency)
    if not currencies:
        return CURRENCY_NOT_APPLICABLE
    if len(currencies) == 1:
        return CURRENCY_COMPATIBLE
    if conversion is not None and conversion.get("documented"):
        return CURRENCY_CONVERTED
    return CURRENCY_MIXED


def quality_of_collection(items: Iterable[dict], *, current_claim: bool = True) -> dict:
    """Quality summary for a set of items: per-item quality plus a rollup.

    The rollup is the *worst* sufficiency across items, so a single degraded
    source cannot be hidden behind healthy ones.  Per-item quality stays
    visible so a verified zero in one source is not lost to an unavailable
    other.
    """
    items = list(items)
    per_item = []
    worst_rank = {SUFFICIENT: 0, PARTIAL: 1, INSUFFICIENT: 2, UNAVAILABLE: 3}
    worst = SUFFICIENT
    reasons: set[str] = set()
    for item in items:
        quality = quality_of(item, current_claim=current_claim)
        per_item.append({"id": item.get("id"), **quality})
        if worst_rank[quality["sufficiency"]] > worst_rank[worst]:
            worst = quality["sufficiency"]
        reasons.update(quality["reasons"])
    return {
        "schema_version": QUALITY_SCHEMA_VERSION,
        "item_count": len(items),
        "currency_integrity": currency_integrity_of_collection(items),
        "overall_sufficiency": worst,
        "reasons": sorted(reasons),
        "items": per_item,
    }
