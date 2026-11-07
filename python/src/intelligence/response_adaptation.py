"""Task 210 — Adaptive Answer Structure & Confidence Communication.

Pure functions, no I/O, no model calls. This module extends the existing
stack without competing with it:

* presentation *modes* are still chosen by ``select_response_mode`` in
  ``agents.investigation`` (REV-CONVERSATION-EXPERIENCE-SPEC §2) — this module
  chooses the *content* of the answer: which composable elements it carries,
  in what order, at what depth, and what confidence communication it needs;
* evidence *quality* (Task 203) supplies the per-item ``sufficiency`` verdict
  and machine reasons that confidence is derived from;
* the epistemic claim contract (Task 204) supplies the claim grades and the
  re-derivable calculation inputs.

Confidence methodology (D1, documented and mirrored by the Node boundary):

1. *Grade gate.* ``hypothesis`` → at most ``limited``; ``unknown`` →
   ``insufficient`` regardless of evidence volume. A hypothesis is a labelled
   possibility, never a fact; it is capped, not disqualified.
2. *Evidence sufficiency.* Worst ``quality.sufficiency`` across the claim's
   cited items (calculation claims: both period inputs): all ``sufficient``
   → no cap; any ``partial`` → base ``moderate``; any ``insufficient`` →
   base ``limited``; any ``unavailable`` or missing citation → base
   ``insufficient``.
3. *Machine-reason penalties.* ``conflicting_evidence`` → cap ``limited``;
   staleness for the current claim (``*_for_current_claim``) → cap
   ``limited``; ``partial_coverage`` / ``coverage_unknown`` → cap
   ``moderate``; ``mixed_currencies_not_comparable`` → ``insufficient``.
4. *Floor.* Verified fact / calculated observation with fully sufficient,
   in-window, comparable evidence → ``high``.

Categories only — no step emits a number. Coverage (how much of the source
data was seen) is reported by ``coverage_summary`` and never feeds the
category, so coverage is never conflated with confidence.
"""
from __future__ import annotations

import re

from .evidence_quality import (
    COVERAGE_COMPLETE, COVERAGE_PARTIAL,
    SUFFICIENT, PARTIAL, INSUFFICIENT, UNAVAILABLE, SUFFICIENCY,
    FRESH_FRESH, FRESH_AGING, FRESH_STALE, FRESH_UNKNOWN, FRESH_SYNCHRONIZING,
    FRESH_FAILED, FRESH_NEVER,
    quality_of,
)

ADAPTATION_CONTRACT_VERSION = "rev-response-adaptation-v1"

# ---------------------------------------------------------------------------
# Response intents (the consolidated taxonomy A–H)
# ---------------------------------------------------------------------------
RESPONSE_INTENT_CASUAL = "casual_conversation"          # A
RESPONSE_INTENT_DIRECT = "direct_factual"               # B
RESPONSE_INTENT_EXPLANATION = "explanation"             # C
RESPONSE_INTENT_COMPARATIVE = "comparative"             # D
RESPONSE_INTENT_INVESTIGATION = "investigation"         # E
RESPONSE_INTENT_MULTI_DOMAIN = "multi_domain"           # F
RESPONSE_INTENT_RECOMMENDATION = "recommendation"       # G
RESPONSE_INTENT_CLARIFICATION = "clarification"         # H
RESPONSE_INTENTS = (
    RESPONSE_INTENT_CASUAL, RESPONSE_INTENT_DIRECT, RESPONSE_INTENT_EXPLANATION,
    RESPONSE_INTENT_COMPARATIVE, RESPONSE_INTENT_INVESTIGATION,
    RESPONSE_INTENT_MULTI_DOMAIN, RESPONSE_INTENT_RECOMMENDATION,
    RESPONSE_INTENT_CLARIFICATION,
)

COMPLEXITY_SIMPLE = "simple"
COMPLEXITY_MODERATE = "moderate"
COMPLEXITY_COMPLEX = "complex"
COMPLEXITIES = (COMPLEXITY_SIMPLE, COMPLEXITY_MODERATE, COMPLEXITY_COMPLEX)

DEPTH_CONCISE = "concise"
DEPTH_STANDARD = "standard"
DEPTH_DETAILED = "detailed"
EXPLANATION_DEPTHS = (DEPTH_CONCISE, DEPTH_STANDARD, DEPTH_DETAILED)

CONFIDENCE_COMMUNICATION_IMPLICIT = "implicit"
CONFIDENCE_COMMUNICATION_INLINE = "inline"
CONFIDENCE_COMMUNICATION_EXPLICIT = "explicit"
CONFIDENCE_COMMUNICATIONS = (
    CONFIDENCE_COMMUNICATION_IMPLICIT, CONFIDENCE_COMMUNICATION_INLINE,
    CONFIDENCE_COMMUNICATION_EXPLICIT,
)

# ---------------------------------------------------------------------------
# Composable element vocabulary (fixed, closed set)
# ---------------------------------------------------------------------------
ELEMENT_DIRECT_ANSWER = "direct_answer"
ELEMENT_SITUATION = "situation"
ELEMENT_INSIGHT = "insight"
ELEMENT_PERIOD_COMPARISON = "period_comparison"
ELEMENT_EVIDENCE = "evidence"
ELEMENT_IMPLICATION = "implication"
ELEMENT_CONFIDENCE = "confidence"
ELEMENT_LIMITATIONS = "limitations"
ELEMENT_ALTERNATIVES = "alternatives"
ELEMENT_UNKNOWN = "unknowns"
ELEMENT_SUGGESTED_INVESTIGATION = "suggested_investigation"
ELEMENT_RECOMMENDATION = "recommendation"
ELEMENT_FOLLOW_UP = "follow_up"
RESPONSE_ELEMENTS = (
    ELEMENT_DIRECT_ANSWER, ELEMENT_SITUATION, ELEMENT_INSIGHT,
    ELEMENT_PERIOD_COMPARISON, ELEMENT_EVIDENCE, ELEMENT_IMPLICATION,
    ELEMENT_CONFIDENCE, ELEMENT_LIMITATIONS, ELEMENT_ALTERNATIVES,
    ELEMENT_UNKNOWN, ELEMENT_SUGGESTED_INVESTIGATION,
    ELEMENT_RECOMMENDATION, ELEMENT_FOLLOW_UP,
)

# ---------------------------------------------------------------------------
# Confidence categories (aligned with product wording)
# ---------------------------------------------------------------------------
CONFIDENCE_HIGH = "high"
CONFIDENCE_MODERATE = "moderate"
CONFIDENCE_LIMITED = "limited"
CONFIDENCE_INSUFFICIENT = "insufficient"
CONFIDENCE_CATEGORIES = (
    CONFIDENCE_HIGH, CONFIDENCE_MODERATE, CONFIDENCE_LIMITED,
    CONFIDENCE_INSUFFICIENT,
)
_CONFIDENCE_RANK = {
    CONFIDENCE_HIGH: 4, CONFIDENCE_MODERATE: 3,
    CONFIDENCE_LIMITED: 2, CONFIDENCE_INSUFFICIENT: 1,
}
_SUFFICIENCY_RANK = {
    SUFFICIENT: 4, PARTIAL: 3, INSUFFICIENT: 2, UNAVAILABLE: 1,
}

_CLAIM_GRADES = (
    "verified_fact", "calculated_observation", "hypothesis", "unknown",
)
_CLAIM_HYPOTHESIS = "hypothesis"
_CLAIM_UNKNOWN = "unknown"
# Grades that carry the answer (worst of these is the response-level category).
_ANSWER_GRADES = ("verified_fact", "calculated_observation", "hypothesis")

_FRESHNESS_RANK = {
    FRESH_FRESH: 0, FRESH_AGING: 1, FRESH_SYNCHRONIZING: 2, FRESH_UNKNOWN: 3,
    FRESH_STALE: 4, FRESH_FAILED: 5, FRESH_NEVER: 6,
}


def _worse_category(a: str, b: str) -> str:
    return a if _CONFIDENCE_RANK.get(a, 0) <= _CONFIDENCE_RANK.get(b, 0) else b


def _worse_sufficiency(a: str, b: str) -> str:
    return a if _SUFFICIENCY_RANK.get(a, 0) <= _SUFFICIENCY_RANK.get(b, 0) else b


# ---------------------------------------------------------------------------
# 1. Response-intent / complexity classification (deterministic)
# ---------------------------------------------------------------------------
# Routed intents that need no store investigation at all (taxonomy A).
_CONVERSATIONAL_INTENTS = frozenset({
    "greeting", "social", "identity", "capability", "knowledge", "general",
    "read_only_boundary", "unsupported_question",
})
# Intents that are investigations of a single store domain (taxonomy E).
_SINGLE_DOMAIN_INTENTS = frozenset({
    "revenue_investigation", "checkout_investigation", "customer_retention",
    "refund_investigation", "product_investigation", "traffic_investigation",
    "data_coverage",
})
# Intents that combine several recorded findings (taxonomy F).
_MULTI_DOMAIN_INTENTS = frozenset({"store_overview", "finding_investigation"})
# Advice-seeking intents (taxonomy G) — ranking/actionable questions.
_RECOMMENDATION_INTENTS = frozenset({"finding_investigation"})

_METRIC_QUERY_RE = re.compile(
    r"\b(?:how (?:much|many)|show me|count|total|what (?:is|was|are|were) "
    r"(?:my|our|the)|how (?:is|are) (?:my|our))\b", re.I)
_CAUSAL_RE = re.compile(
    r"\b(?:why|cause|reason|explain|what (?:is|was) (?:going on|happening)|"
    r"what (?:do i|should i) need to know)\b", re.I)
_EXPLANATION_RE = re.compile(
    r"\b(?:why|explain|how (?:does|did)|what (?:does|does this) .* mean|"
    r"walk me through)\b", re.I)


def classify_response_profile(
    *, intent: str, understanding: dict | None = None,
    status: str | None = None, has_comparison: bool = False,
    domains: list | None = None, clarification_required: bool = False,
    is_priority_question: bool = False, message: str = "",
    claim_categories: list | None = None,
    response_intent: str | None = None,
    explanation_depth: str | None = None,
) -> dict:
    """Classify the RESPONSE (not the question's routing intent).

    Deterministic from the recorded routing output and the evidence outcome.
    The LLM never picks the structure: ``understanding`` may inform it only
    through fields the deterministic router already resolved.
    ``response_intent`` / ``explanation_depth`` are explicit overrides for
    the deterministic handlers that compose a response without running the
    store router (meta follow-ups); they must be valid enum values.
    """
    understanding = understanding or {}
    domains = domains or []
    message = message or ""
    clarification_required = bool(
        clarification_required or intent == "clarify"
        or understanding.get("intent") == "clarification_needed")
    if response_intent is not None and response_intent not in RESPONSE_INTENTS:
        raise ValueError(f"Unknown response intent: {response_intent}")
    if explanation_depth is not None and explanation_depth not in EXPLANATION_DEPTHS:
        raise ValueError(f"Unknown explanation depth: {explanation_depth}")

    if response_intent is None:
        # A: casual — no store investigation was (or should be) run.
        if intent in _CONVERSATIONAL_INTENTS:
            response_intent = RESPONSE_INTENT_CASUAL
        elif clarification_required:
            response_intent = RESPONSE_INTENT_CLARIFICATION
        elif is_priority_question or intent in _RECOMMENDATION_INTENTS:
            response_intent = RESPONSE_INTENT_RECOMMENDATION
        elif has_comparison:
            response_intent = RESPONSE_INTENT_COMPARATIVE
        elif intent in _MULTI_DOMAIN_INTENTS or len(domains) >= 2:
            response_intent = RESPONSE_INTENT_MULTI_DOMAIN
        elif intent == "data_coverage" and not _CAUSAL_RE.search(message):
            # A connection/coverage check asks for a direct fact, not a report.
            response_intent = RESPONSE_INTENT_DIRECT
        elif _METRIC_QUERY_RE.search(message) and not _CAUSAL_RE.search(message) \
                and not has_comparison:
            response_intent = RESPONSE_INTENT_DIRECT
        elif _EXPLANATION_RE.search(message) and intent in _SINGLE_DOMAIN_INTENTS \
                and not has_comparison:
            response_intent = RESPONSE_INTENT_EXPLANATION
        else:
            response_intent = RESPONSE_INTENT_INVESTIGATION

    # Complexity: how much the question combines, independent of data quality.
    if response_intent in (RESPONSE_INTENT_CASUAL, RESPONSE_INTENT_CLARIFICATION,
                           RESPONSE_INTENT_DIRECT):
        complexity = COMPLEXITY_SIMPLE
    elif response_intent in (RESPONSE_INTENT_EXPLANATION, RESPONSE_INTENT_COMPARATIVE,
                             RESPONSE_INTENT_RECOMMENDATION, RESPONSE_INTENT_INVESTIGATION):
        complexity = COMPLEXITY_COMPLEX if len(domains) >= 2 else COMPLEXITY_MODERATE
    else:
        complexity = COMPLEXITY_COMPLEX

    depth = {
        COMPLEXITY_SIMPLE: DEPTH_CONCISE,
        COMPLEXITY_MODERATE: DEPTH_STANDARD,
        COMPLEXITY_COMPLEX: DEPTH_DETAILED,
    }[complexity]
    # A degraded answer has no room for detail: it leads with the limitation.
    if status in ("insufficient_data", "failed"):
        depth = DEPTH_CONCISE
    if explanation_depth is not None:
        depth = explanation_depth  # explicit deterministic handler override

    # Confidence communication requirement.
    if response_intent == RESPONSE_INTENT_CASUAL:
        communication = CONFIDENCE_COMMUNICATION_IMPLICIT
    else:
        claim_categories = claim_categories or []
        if any(c == CONFIDENCE_INSUFFICIENT for c in claim_categories):
            communication = CONFIDENCE_COMMUNICATION_EXPLICIT
        elif any(c in (CONFIDENCE_MODERATE, CONFIDENCE_LIMITED)
                 for c in claim_categories):
            communication = CONFIDENCE_COMMUNICATION_INLINE
        elif claim_categories:
            communication = (CONFIDENCE_COMMUNICATION_IMPLICIT
                             if response_intent == RESPONSE_INTENT_DIRECT
                             else CONFIDENCE_COMMUNICATION_INLINE)
        else:
            communication = (CONFIDENCE_COMMUNICATION_IMPLICIT
                             if response_intent == RESPONSE_INTENT_DIRECT
                             else CONFIDENCE_COMMUNICATION_INLINE)

    return {
        "contract_version": ADAPTATION_CONTRACT_VERSION,
        "response_intent": response_intent,
        "complexity": complexity,
        "explanation_depth": depth,
        "recommendation_appropriate": response_intent in (
            RESPONSE_INTENT_RECOMMENDATION, RESPONSE_INTENT_MULTI_DOMAIN,
            RESPONSE_INTENT_INVESTIGATION, RESPONSE_INTENT_COMPARATIVE),
        "clarification_required": clarification_required,
        "confidence_communication": communication,
        "reason": _profile_reason(response_intent, intent, has_comparison,
                                  len(domains), clarification_required),
    }


def _profile_reason(response_intent: str, intent: str, has_comparison: bool,
                    domain_count: int, clarification_required: bool) -> str:
    if response_intent == RESPONSE_INTENT_CASUAL:
        return "the question needs no store investigation"
    if clarification_required:
        return "the question needs clarification before any figure can be given"
    if response_intent == RESPONSE_INTENT_DIRECT:
        return "a single recorded metric answers the question directly"
    if has_comparison:
        return "the answer compares recorded periods"
    if response_intent == RESPONSE_INTENT_MULTI_DOMAIN:
        return "the answer combines findings from several store domains"
    if response_intent == RESPONSE_INTENT_RECOMMENDATION:
        return "the merchant asked what to do, so the answer leads with the step"
    if response_intent == RESPONSE_INTENT_EXPLANATION:
        return "the merchant asked for the reasoning behind the figures"
    return "the answer combines several store checks"


# ---------------------------------------------------------------------------
# 2. Claim-specific confidence (method D1)
# ---------------------------------------------------------------------------
def _sufficiency_of_item(item: dict) -> tuple:
    quality = (item or {}).get("quality")
    if isinstance(quality, dict) and quality.get("sufficiency") in SUFFICIENCY:
        return (str(quality["sufficiency"]),
                [str(r) for r in (quality.get("reasons") or [])])
    derived = quality_of(item or {})
    return derived["sufficiency"], list(derived.get("reasons") or [])


_LIMITATION_PHRASES = (
    ("conflicting_evidence", "The sources disagree on this figure."),
    ("mixed_currencies_not_comparable",
     "The values are recorded in different currencies that were not converted, "
     "so they cannot be compared directly."),
    ("stale_for_current_claim",
     "This data is from the last successful sync and may be behind."),
    ("failed_for_current_claim",
     "The last sync for this source failed, so the figure may be outdated."),
    ("never_synchronized_for_current_claim",
     "This source has never synced, so the figure comes from a fallback."),
    ("synchronizing_for_current_claim",
     "Data is still syncing, so this may be incomplete."),
    ("unknown_for_current_claim",
     "I could not verify how current this data is."),
    ("partial_coverage",
     "Some records for this period are missing from the source."),
    ("coverage_unknown",
     "I cannot confirm how complete the source data is for this period."),
    ("value_missing", "The source did not return a value for this."),
    ("value_unknown", "The source did not return a value for this."),
    ("evidence_reference_missing",
     "A source for this figure is no longer in the current evidence set."),
    ("hypothesis_unverified",
     "This is a possible cause, not an established one."),
    ("no_evidence_to_determine",
     "The records I have do not include what this would take."),
    ("source_unavailable", "The source did not answer for this period."),
    ("source_not_synchronized", "The source has not synchronized yet."),
    ("source_unauthorized", "The source is not authorized to be read."),
    ("source_retrieval_failed", "The source could not be reached."),
    ("source_consent_unavailable", "Consent is not available for this source."),
    ("currency_unknown", "The currency for this figure could not be verified."),
)


def _limitation_phrases(reasons: list[str], *, limit: int = 4) -> list[str]:
    known = dict(_LIMITATION_PHRASES)
    phrases: list[str] = []
    for reason in reasons:
        phrase = known.get(reason)
        if phrase is None and reason.endswith("_for_current_claim"):
            phrase = "This data may not reflect the current state."
        if phrase and phrase not in phrases:
            phrases.append(phrase)
    return phrases[:limit]


def derive_claim_confidence(claim: dict, items_by_id: dict | None) -> dict:
    """Derive one claim's confidence category (method D1).

    ``items_by_id`` maps every current AND comparison-window evidence id to
    its item (claims cite one record per period for comparisons). Returns
    ``{category, basis, limitations}`` — machine-readable reasons plus the
    merchant-facing limitation phrases, in a stable order.
    """
    claim = claim or {}
    grade = claim.get("classification")
    if grade not in _CLAIM_GRADES:
        grade = _CLAIM_UNKNOWN  # fail closed on an unrecognised grade

    if grade == _CLAIM_UNKNOWN:
        return {
            "category": CONFIDENCE_INSUFFICIENT,
            "basis": ["no_evidence_to_determine"],
            "limitations": ["The records I have do not include what this would take."],
        }

    basis: set[str] = set()
    cited: list[str] = []
    for evidence_id in (claim.get("evidence_ids") or []):
        if evidence_id:
            cited.append(str(evidence_id))
    calculation = claim.get("calculation")
    if isinstance(calculation, dict):
        for entry in (calculation.get("inputs") or []):
            evidence_id = (entry or {}).get("evidence_id")
            if evidence_id:
                cited.append(str(evidence_id))
    cited = list(dict.fromkeys(cited))

    worst = SUFFICIENT
    if cited:
        for evidence_id in cited:
            item = (items_by_id or {}).get(evidence_id)
            if item is None:
                worst = _worse_sufficiency(worst, UNAVAILABLE)
                basis.add("evidence_reference_missing")
                continue
            sufficiency, reasons = _sufficiency_of_item(item)
            worst = _worse_sufficiency(worst, sufficiency)
            basis.update(reasons)
    elif grade != _CLAIM_HYPOTHESIS:
        # An answer-grade claim that cites nothing cannot stand.
        worst = UNAVAILABLE
        basis.add("evidence_reference_missing")

    # Grade gate: hypotheses are capped, never disqualified.
    if grade == _CLAIM_HYPOTHESIS:
        basis.add("hypothesis_unverified")

    # Machine-reason penalties.
    if "conflicting_evidence" in basis:
        basis.add("conflicting_penalty")
    if any(reason.endswith("_for_current_claim") for reason in basis):
        basis.add("staleness_penalty")
    if "partial_coverage" in basis or "coverage_unknown" in basis:
        basis.add("coverage_penalty")
    if "mixed_currencies_not_comparable" in basis:
        basis.add("currency_penalty")

    base = {
        SUFFICIENT: CONFIDENCE_HIGH, PARTIAL: CONFIDENCE_MODERATE,
        INSUFFICIENT: CONFIDENCE_LIMITED, UNAVAILABLE: CONFIDENCE_INSUFFICIENT,
    }[worst]
    category = base
    if grade == _CLAIM_HYPOTHESIS:
        category = _worse_category(category, CONFIDENCE_LIMITED)
    if "conflicting_penalty" in basis:
        category = _worse_category(category, CONFIDENCE_LIMITED)
    if "staleness_penalty" in basis:
        category = _worse_category(category, CONFIDENCE_LIMITED)
    if "coverage_penalty" in basis:
        category = _worse_category(category, CONFIDENCE_MODERATE)
    if "currency_penalty" in basis:
        category = _worse_category(category, CONFIDENCE_INSUFFICIENT)

    return {
        "category": category,
        "basis": sorted(basis),
        "limitations": _limitation_phrases(sorted(basis)),
    }


def response_confidence_category(claims: list | None,
                                 items_by_id: dict | None = None) -> str:
    """The response-level category: the worst of the answer-bearing claims.

    The answer is only as certain as its weakest load-bearing claim; per-claim
    categories remain in the payload. ``unknown`` claims are the
    "cannot determine" element itself and do not drag a claim-backed answer
    down — but if no claim carries the answer, the response cannot either,
    unless the answer is a claim-less direct verification (health/coverage)
    in which case the evidence sufficiency carries it: with
    ``items_by_id`` given, the worst item sufficiency maps
    sufficient→high, partial→moderate, insufficient→limited,
    unavailable/no items→insufficient.
    """
    categories = [
        (claim.get("confidence") or {}).get("category")
        for claim in (claims or [])
        if isinstance(claim, dict)
        and claim.get("classification") in _ANSWER_GRADES
        and isinstance(claim.get("confidence"), dict)
    ]
    categories = [c for c in categories if c in CONFIDENCE_CATEGORIES]
    if categories:
        category = categories[0]
        for other in categories[1:]:
            category = _worse_category(category, other)
        return category
    if items_by_id:
        worst = SUFFICIENT
        for item in items_by_id.values():
            sufficiency, _ = _sufficiency_of_item(item)
            worst = _worse_sufficiency(worst, sufficiency)
        return {
            SUFFICIENT: CONFIDENCE_HIGH, PARTIAL: CONFIDENCE_MODERATE,
            INSUFFICIENT: CONFIDENCE_LIMITED, UNAVAILABLE: CONFIDENCE_INSUFFICIENT,
        }[worst]
    return CONFIDENCE_INSUFFICIENT


def _item_quality(item: dict) -> dict:
    quality = (item or {}).get("quality")
    if isinstance(quality, dict):
        return quality
    return quality_of(item or {})


def coverage_summary(items: list | None, *, window: dict | None = None,
                     comparison_items: list | None = None) -> dict:
    """Coverage of the source data — separate from confidence (spec 5.D).

    How much of the source data was seen, how current it is, whether the
    currencies can be compared, and whether order coverage is certified.
    Nothing here is a certainty statement about any claim.
    """
    all_items = [item for item in (items or []) if isinstance(item, dict)]
    all_items += [item for item in (comparison_items or [])
                  if isinstance(item, dict)]
    window = window or {}

    coverages = []
    fresh = None
    currency_mixed = False
    currency_unknown = False
    certified = False
    for item in all_items:
        quality = _item_quality(item)
        coverages.append(quality.get("coverage"))
        state = quality.get("freshness")
        if state in _FRESHNESS_RANK:
            fresh = state if fresh is None else (
                state if _FRESHNESS_RANK[state] > _FRESHNESS_RANK[fresh] else fresh)
        currency = quality.get("currency_integrity")
        if currency == "mixed_not_comparable":
            currency_mixed = True
        if currency == "unknown_currency":
            currency_unknown = True
        if item.get("metric") == "certified_store_count" \
                and item.get("value") in (1, "1"):
            certified = True

    if not coverages:
        coverage = "no_data"
    elif any(c == COVERAGE_PARTIAL for c in coverages):
        coverage = "partial"
    elif all(c in (COVERAGE_COMPLETE, "not_applicable", None) for c in coverages):
        coverage = "complete"
    else:
        coverage = "unknown"

    limits: list[str] = []
    if coverage == "partial":
        limits.append("Some records for this period are missing from the source.")
    elif coverage == "unknown":
        limits.append("I cannot confirm how complete the source data is for this period.")
    if fresh in (FRESH_STALE, FRESH_FAILED, FRESH_NEVER):
        limits.append("The data may not reflect the current state.")
    elif fresh == FRESH_SYNCHRONIZING:
        limits.append("Data is still syncing, so this may be incomplete.")
    if currency_mixed:
        limits.append("Values are recorded in currencies that were not converted.")
    if currency_unknown:
        limits.append("A currency could not be verified.")

    return {
        "window": {
            "label": window.get("label"), "start": window.get("start"),
            "end": window.get("end"), "timezone": window.get("timezone"),
        },
        "coverage": coverage,
        "freshness": fresh or "unknown",
        "currency_comparable": not (currency_mixed or currency_unknown),
        "certified": certified,
        "limits": limits[:3],
    }


# ---------------------------------------------------------------------------
# 3. Natural-language confidence communication
# ---------------------------------------------------------------------------
def confidence_language(category: str, limitations: list | None = None,
                        next_step: str | None = None) -> str:
    """One merchant-facing sentence for a category. No percentages, no filler."""
    limitations = [str(limit) for limit in (limitations or [])]
    limit_text = limitations[0] if limitations else ""
    if category == CONFIDENCE_HIGH:
        return ("I'm confident in this: it comes from complete, current records "
                "for the period.")
    if category == CONFIDENCE_MODERATE:
        if limit_text:
            return f"This is supported by the records, with one limitation: {limit_text.lower()}"
        return "This is supported by the records, though part of the data is incomplete."
    if category == CONFIDENCE_LIMITED:
        if limit_text:
            return f"Treat this as a partial reading — {limit_text.lower()}"
        return "Treat this as a partial reading; the records do not cover everything."
    if category == CONFIDENCE_INSUFFICIENT:
        if next_step:
            return f"I can't determine this from the records I have. {next_step}"
        if limit_text:
            return f"I can't determine this from the records I have — {limit_text.lower()}"
        return "I can't determine this from the records I have."
    return "I can't determine this from the records I have."


# ---------------------------------------------------------------------------
# 4. Composable element selection
# ---------------------------------------------------------------------------
_ELEMENTS_BY_INTENT: dict[str, tuple] = {
    RESPONSE_INTENT_CASUAL: (),
    RESPONSE_INTENT_DIRECT: (ELEMENT_DIRECT_ANSWER, ELEMENT_EVIDENCE),
    RESPONSE_INTENT_EXPLANATION: (
        ELEMENT_DIRECT_ANSWER, ELEMENT_SITUATION, ELEMENT_INSIGHT,
        ELEMENT_EVIDENCE, ELEMENT_LIMITATIONS, ELEMENT_RECOMMENDATION),
    RESPONSE_INTENT_COMPARATIVE: (
        ELEMENT_DIRECT_ANSWER, ELEMENT_PERIOD_COMPARISON, ELEMENT_EVIDENCE,
        ELEMENT_INSIGHT, ELEMENT_LIMITATIONS, ELEMENT_RECOMMENDATION),
    RESPONSE_INTENT_INVESTIGATION: (
        ELEMENT_SITUATION, ELEMENT_INSIGHT, ELEMENT_IMPLICATION,
        ELEMENT_EVIDENCE, ELEMENT_CONFIDENCE, ELEMENT_LIMITATIONS,
        ELEMENT_RECOMMENDATION, ELEMENT_FOLLOW_UP),
    RESPONSE_INTENT_MULTI_DOMAIN: (
        ELEMENT_SITUATION, ELEMENT_INSIGHT, ELEMENT_EVIDENCE,
        ELEMENT_CONFIDENCE, ELEMENT_LIMITATIONS, ELEMENT_RECOMMENDATION,
        ELEMENT_FOLLOW_UP),
    RESPONSE_INTENT_RECOMMENDATION: (
        ELEMENT_DIRECT_ANSWER, ELEMENT_RECOMMENDATION, ELEMENT_EVIDENCE,
        ELEMENT_CONFIDENCE, ELEMENT_LIMITATIONS, ELEMENT_FOLLOW_UP),
    RESPONSE_INTENT_CLARIFICATION: (
        ELEMENT_DIRECT_ANSWER, ELEMENT_LIMITATIONS, ELEMENT_UNKNOWN,
        ELEMENT_SUGGESTED_INVESTIGATION),
}


def select_elements(profile: dict, *, has_facts: bool = False,
                    has_comparison: bool = False, has_evidence: bool = False,
                    has_hypotheses: bool = False, has_recommendations: bool = False,
                    has_unknowns: bool = False, has_limitations: bool = False,
                    has_follow_ups: bool = False,
                    insufficient_next_step: str | None = None,
                    recommendation_appropriate: bool | None = None) -> list[str]:
    """Pick the ordered elements this answer actually carries.

    An element that has no content is omitted — the renderer never sees an
    empty section, and a simple question never gets a report skeleton.
    """
    response_intent = profile.get("response_intent", RESPONSE_INTENT_INVESTIGATION)
    communication = profile.get("confidence_communication",
                                CONFIDENCE_COMMUNICATION_INLINE)
    if recommendation_appropriate is None:
        recommendation_appropriate = bool(
            profile.get("recommendation_appropriate"))

    # For a clarification answer, the "direct answer" is the clarifying
    # question itself — it is always present.
    present = {
        ELEMENT_DIRECT_ANSWER: bool(
            has_facts or has_comparison
            or response_intent == RESPONSE_INTENT_CLARIFICATION),
        ELEMENT_SITUATION: bool(has_facts),
        ELEMENT_INSIGHT: bool(has_facts or has_comparison),
        ELEMENT_PERIOD_COMPARISON: bool(has_comparison),
        ELEMENT_EVIDENCE: bool(has_evidence),
        ELEMENT_IMPLICATION: bool(has_hypotheses),
        ELEMENT_CONFIDENCE: False,  # placed by the communication requirement
        ELEMENT_LIMITATIONS: bool(has_limitations),
        ELEMENT_ALTERNATIVES: bool(has_hypotheses),
        ELEMENT_UNKNOWN: bool(has_unknowns),
        ELEMENT_SUGGESTED_INVESTIGATION: bool(insufficient_next_step),
        ELEMENT_RECOMMENDATION: bool(
            has_recommendations and recommendation_appropriate),
        ELEMENT_FOLLOW_UP: bool(has_follow_ups),
    }

    if insufficient_next_step:
        # Degraded outcome (or a clarification that names its gap): lead
        # with the question when there is one, then the limitation, the
        # confidence standing, the gap and the smallest useful next step —
        # never a speculative conclusion (spec §4, insufficient answers).
        elements = []
        if present.get(ELEMENT_DIRECT_ANSWER):
            elements.append(ELEMENT_DIRECT_ANSWER)
        if present.get(ELEMENT_LIMITATIONS):
            elements.append(ELEMENT_LIMITATIONS)
        elements.append(ELEMENT_CONFIDENCE)
        if present.get(ELEMENT_UNKNOWN):
            elements.append(ELEMENT_UNKNOWN)
        elements.append(ELEMENT_SUGGESTED_INVESTIGATION)
        return elements

    elements = [element for element in _ELEMENTS_BY_INTENT.get(
        response_intent, ()) if present.get(element)]

    if ELEMENT_CONFIDENCE not in elements and \
            communication != CONFIDENCE_COMMUNICATION_IMPLICIT \
            and response_intent != RESPONSE_INTENT_CASUAL:
        tail = (ELEMENT_LIMITATIONS, ELEMENT_UNKNOWN, ELEMENT_RECOMMENDATION,
                ELEMENT_FOLLOW_UP)
        anchor = next((i for i, e in enumerate(elements) if e in tail), None)
        if anchor is None:
            elements.append(ELEMENT_CONFIDENCE)
        else:
            elements.insert(anchor, ELEMENT_CONFIDENCE)

    return elements


# ---------------------------------------------------------------------------
# 5. Meta follow-ups (spec 7): continue from the recorded claims
# ---------------------------------------------------------------------------
META_FOLLOWUP_ORDINAL = "ordinal_reference"
META_FOLLOWUP_SIMPLIFY = "simplification"
META_FOLLOWUP_VERIFY = "verification"
META_FOLLOWUP_KINDS = (META_FOLLOWUP_ORDINAL, META_FOLLOWUP_SIMPLIFY,
                       META_FOLLOWUP_VERIFY)

_ORDINAL_TOKENS = {
    "first": 1, "1st": 1, "second": 2, "2nd": 2, "third": 3, "3rd": 3,
    "fourth": 4, "4th": 4, "fifth": 5, "5th": 5,
}
_ORDINAL_RE = re.compile(
    r"\b(?:the\s+)?(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th)"
    r"\s+(?:point|finding|issue|item|claim|recommendation|one)\b", re.I)
_VERIFY_RE = re.compile(
    r"\b(?:are (?:you|we) sure|double[- ]?check (?:that|it|this|your answer)"
    r"|confirm (?:that|it|this|your answer)"
    r"|is (?:that|it) (?:really|actually|truly) (?:true|right|correct)"
    r"|really (?:true|right|correct)\?)\b", re.I)
_SIMPLIFY_RE = re.compile(
    r"\b(?:make (?:it|that|this|your answer|your explanation) simpler"
    r"|in simpler terms|simpler terms"
    r"|explain (?:it|that|this) (?:to me |more simply |in simpler words )"
    r"?(?:again)?"
    r"|too (?:technical|complicated|complex)"
    r"|break (?:it|that|this) down"
    r"|say (?:that|it) again more simply)\b", re.I)


def resolve_meta_followup(message: str, claims: list | None, *,
                          matches_correction: bool = False) -> dict | None:
    """Resolve ordinal / simplification / verification follow-ups.

    ``claims`` are the previous investigation's recorded claims, already
    filtered to the authenticated tenant. A follow-up only resolves when a
    recorded claim exists to resolve it against; otherwise ``None`` and the
    message routes normally. An explicit correction never resolves here.
    """
    if matches_correction or not (claims or []):
        return None
    message = (message or "").strip()
    if not message:
        return None

    ordinal_match = _ORDINAL_RE.search(message)
    if ordinal_match:
        ordinal = _ORDINAL_TOKENS.get(ordinal_match.group(1).lower())
        if ordinal and ordinal <= len(claims):
            return {"kind": META_FOLLOWUP_ORDINAL, "ordinal": ordinal,
                    "claim": claims[ordinal - 1]}
        return None

    if _VERIFY_RE.search(message):
        return {"kind": META_FOLLOWUP_VERIFY, "ordinal": None, "claim": None}
    if _SIMPLIFY_RE.search(message):
        return {"kind": META_FOLLOWUP_SIMPLIFY, "ordinal": None, "claim": None}
    return None


def _claim_grade_line(claim: dict) -> str:
    grade = claim.get("classification")
    if grade == "verified_fact":
        return "This is a verified figure from the store records."
    if grade == "calculated_observation":
        return "This is calculated from two recorded periods, with the inputs recorded."
    if grade == _CLAIM_HYPOTHESIS:
        return "This is a hypothesis — a possible cause, not an established one."
    return "This records what the investigation could not establish."


def _claim_value_line(claim: dict) -> str:
    value = claim.get("value")
    if value is None:
        return claim.get("text") or ""
    label = f"{value} {claim['unit']}".strip()
    if claim.get("currency"):
        label += f" {claim['currency']}"
    period = claim.get("period") or {}
    meta = ", ".join(p for p in (period.get("label"), period.get("timezone")) if p)
    return f"{label} ({meta})" if meta else label


def _claim_confidence_line(claim: dict) -> str:
    confidence = claim.get("confidence") or {}
    category = confidence.get("category")
    limitations = confidence.get("limitations") or []
    return confidence_language(category or CONFIDENCE_INSUFFICIENT, limitations)


def compose_ordinal_explanation(claim: dict, ordinal: int) -> str:
    """Explain one previously recorded claim, from the record only."""
    ordinal_word = {1: "first", 2: "second", 3: "third", 4: "fourth",
                    5: "fifth"}.get(ordinal, f"{ordinal}th")
    lines = [f"## The {ordinal_word} point, explained",
             claim.get("text") or "",
             _claim_value_line(claim),
             _claim_grade_line(claim),
             _claim_confidence_line(claim)]
    limitations = (claim.get("confidence") or {}).get("limitations") or []
    if limitations:
        lines.append("Limitation: " + " ".join(limitations))
    return "\n\n".join(line for line in lines if line)


def compose_simplification(claims: list, *, window: dict | None = None) -> str:
    """Re-state the previous answer more simply — same figures, no re-estimate."""
    window = window or {}
    period_label = window.get("label") or "the recorded period"
    top = claims[:3]
    lines = ["## In simpler terms",
             f"Here is what I found for {period_label}, without the detail:"]
    for claim in top:
        value_line = _claim_value_line(claim)
        line = f"- {claim.get('text') or value_line}"
        if claim.get("classification") == _CLAIM_HYPOTHESIS:
            line += " (possible cause, not proven)"
        lines.append(line)
    lines.append(
        "The figures are unchanged — I'm not re-estimating anything, just saying "
        "it more plainly.")
    return "\n\n".join(lines)


def compose_verification(claims: list, *, window: dict | None = None) -> str:
    """Re-state the recorded claims with their standing — no new retrieval."""
    window = window or {}
    period_label = window.get("label") or "the recorded period"
    lines = ["## What I recorded, and how strongly it's supported",
             f"From my last investigation ({period_label}):"]
    for claim in claims[:4]:
        content = claim.get("text") or _claim_value_line(claim)
        lines.append(f"- {content} — {_claim_confidence_line(claim).lower()}")
    weakest = response_confidence_category(claims)
    if weakest in (CONFIDENCE_LIMITED, CONFIDENCE_INSUFFICIENT):
        lines.append(
            "If you've seen something different in Shopify, tell me and I'll "
            "re-investigate the records — I won't defend a figure the data "
            "doesn't support.")
    return "\n\n".join(lines)
