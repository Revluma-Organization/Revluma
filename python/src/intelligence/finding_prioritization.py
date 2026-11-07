"""Deterministic prioritization of authorized findings (Task 206).

Methodology ``finding-priority-v1``. Every step is deterministic and every
ranked statement traces to recorded fields of the finding-evidence items —
no composite numeric score is invented (that would imply false precision),
and a tie is EXPLAINED, never resolved by a fabricated winner.

Eligibility (fail-closed):
- only findings whose recorded ``current_validity`` is
  ``current_evidence_verified`` and whose lifecycle is ``open`` or
  ``acknowledged`` are rankable;
- everything else is excluded WITH its recorded reason (historical,
  stale-unreverified, evidence-unverified, malformed).

Duplicates:
- findings sharing one store-scoped recorded ``dedupe_key`` are one
  candidate group (the producer's re-detection signal); the representative
  is the most recently updated (stable id breaks the remaining tie). An
  absent dedupe key never implies duplication.

Ranking key (lexicographic; each slot documented):
1. recorded severity: critical > high > medium > low. A finding with no
   recorded severity ranks below every finding with one (the missing
   attribute is visible, not silently defaulted);
2. freshness class of the last verified update: fresh > aging > stale >
   unknown;
3. a measured order sample exists (underlying order records were retrieved)
   — a boolean, never a magnitude score;
4. most recently updated;
5. stable finding id — a pure tie-break with no implied meaning.

Ties:
- if the two best candidates share slots 1-3, no definitive winner is
  manufactured: both are reported as equally supported and the displayed
  order is labelled arbitrary (slot 5).
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any

PRIORITY_METHOD_VERSION = "finding-priority-v1"

_SEVERITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}
_FRESHNESS_CLASS = {"fresh": 0, "aging": 1, "stale": 2, "unknown": 3}
_RANKABLE_LIFECYCLE = {"open", "acknowledged"}
_UUID_RE = re.compile(r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
                      r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b")


def _iso(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _severity_rank(value: Any) -> tuple[int, str]:
    """Slot 1: recorded severity. Unknown/missing → below all recorded."""
    normalized = str(value).strip().lower() if value is not None else ""
    if normalized in _SEVERITY_ORDER:
        return _SEVERITY_ORDER[normalized], normalized
    return len(_SEVERITY_ORDER), "no_recorded_severity"


def _freshness_rank(item: dict) -> tuple[int, str]:
    state = ((item.get("freshness") or {}).get("state")) or "unknown"
    return _FRESHNESS_CLASS.get(state, 3), state


def _money_text(value: Any, currency: Any) -> str:
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return "unavailable"
    if currency:
        return f"{str(currency)} {amount.quantize(Decimal('0.01'))}"
    return str(amount)


def _record(item: Any) -> dict | None:
    if not isinstance(item, dict) or item.get("metric") != "finding_evidence":
        return None
    value = item.get("value")
    if not isinstance(value, dict):
        return None
    return value


def _evidence_sentence(record: dict) -> str:
    """What the finding's own supporting evidence records (verbatim data)."""
    evidence = record.get("supporting_evidence") or {}
    currency = evidence.get("currency")
    if evidence.get("currentCount") is None and evidence.get("currentRevenue") is None:
        return "The finding's supporting evidence records no measured order sample."
    current_count = (f"{evidence.get('currentCount')} orders"
                     if evidence.get("currentCount") is not None else "order count unavailable")
    previous_count = (f"{evidence.get('previousCount')} orders"
                      if evidence.get("previousCount") is not None else "order count unavailable")
    current_revenue = (f"{_money_text(evidence.get('currentRevenue'), currency)} recorded value"
                       if evidence.get("currentRevenue") is not None else "recorded value unavailable")
    previous_revenue = (f"{_money_text(evidence.get('previousRevenue'), currency)} recorded value"
                        if evidence.get("previousRevenue") is not None else "recorded value unavailable")
    return (f"Its recorded evidence: {previous_count} / {previous_revenue} in the previous "
            f"window versus {current_count} / {current_revenue} in the current window "
            f"(source: {evidence.get('coverage_source') or 'recorded coverage'}).")


def prioritize_findings(items: list[Any], *, now: datetime | None = None) -> dict:
    """Rank the authorized finding items (already tenant-scoped by retrieval).

    Returns a bounded, fully documented structure; it never raises on odd
    records — malformed input is excluded with a reason, never silently
    dropped.
    """
    now = now or datetime.now(timezone.utc)
    candidates: list[dict] = []
    excluded: list[dict] = []

    groups: dict[tuple, list] = {}
    for item in items or []:
        record = _record(item)
        base = {"finding_id": None, "title": None}
        if record is None:
            excluded.append({**base, "reason": "malformed_record"})
            continue
        finding_id = str(record.get("finding_id") or "") or None
        title = record.get("title")
        base = {"finding_id": finding_id, "title": title}
        validity = record.get("current_validity")
        lifecycle = record.get("lifecycle_status")
        if isinstance(validity, str) and validity.startswith("historical_"):
            excluded.append({**base, "reason": f"historical_{lifecycle or 'closed'}"})
            continue
        if lifecycle not in _RANKABLE_LIFECYCLE:
            excluded.append({**base, "reason": f"lifecycle_{lifecycle or 'unknown'}"})
            continue
        if validity == "stale_unreverified":
            excluded.append({**base, "reason": "stale_unreverified",
                             "note": "Its recorded evidence window is older than the 48h "
                                     "re-verification policy; it needs a fresh sync before "
                                     "it can be ranked."})
            continue
        if validity != "current_evidence_verified":
            excluded.append({**base, "reason": "evidence_unverified",
                             "note": "Its source evidence is not certified complete and "
                                     "verified for the current window."})
            continue

        candidate = {
            "finding_id": finding_id, "title": title, "record": record,
            "updated_at": record.get("updated_at"), "severity": record.get("severity"),
            "freshness_item": item, "duplicates": [],
        }
        # Group ONLY on the producer's recorded dedupe signal. Two findings
        # of the same type in the same window are not necessarily the same
        # issue; an absent dedupe key means "no dedupe signal", never
        # "duplicate".
        dedupe_key = record.get("dedupe_key")
        group_key = (None if dedupe_key is None
                     else (str(record.get("store_id")), dedupe_key))
        if group_key is None:
            candidates.append(candidate)
        else:
            groups.setdefault(group_key, []).append(candidate)

    # One candidate per duplicate group: the most recently updated record is
    # the representative (stable id breaks the remaining tie); the rest are
    # recorded as duplicates of it.
    for group in groups.values():
        group.sort(key=lambda c: (
            -(_iso(c["updated_at"]) or datetime.fromtimestamp(0, tz=timezone.utc)).timestamp(),
            c["finding_id"] or ""))
        representative = group[0]
        for other in group[1:]:
            representative["duplicates"].append(
                {"finding_id": other["finding_id"], "title": other["title"]})
        candidates.append(representative)

    def sort_key(candidate: dict) -> tuple:
        record = candidate["record"]
        evidence = record.get("supporting_evidence") or {}
        has_sample = bool(record.get("underlying_order_records")) or \
            evidence.get("currentCount") is not None
        updated = _iso(candidate["updated_at"]) or datetime.fromtimestamp(0, tz=timezone.utc)
        return (
            _severity_rank(candidate["severity"]),
            _freshness_rank(candidate["freshness_item"]),
            0 if has_sample else 1,
            -updated.timestamp(),
            candidate["finding_id"] or "",
        )

    candidates.sort(key=sort_key)
    ranked: list[dict] = []
    tie_report = None
    for index, candidate in enumerate(candidates[:10], start=1):
        record = candidate["record"]
        severity_rank, severity_label = _severity_rank(candidate["severity"])
        freshness_rank, freshness_state = _freshness_rank(candidate["freshness_item"])
        evidence = record.get("supporting_evidence") or {}
        ranked.append({
            "rank": index,
            "finding_id": candidate["finding_id"],
            "title": candidate["title"],
            "type": record.get("type"),
            "severity": severity_label if severity_label != "no_recorded_severity" else None,
            "severity_recorded": severity_label != "no_recorded_severity",
            "freshness": freshness_state,
            "lifecycle_status": record.get("lifecycle_status"),
            "current_validity": record.get("current_validity"),
            "measured_order_sample": bool(record.get("underlying_order_records"))
            or evidence.get("currentCount") is not None,
            "duplicates": candidate["duplicates"],
            "reasons": _rank_reasons(severity_label, freshness_state,
                                     evidence, record.get("underlying_order_records")),
        })
    if len(ranked) >= 2:
        first, second = candidates[0], candidates[1]
        same_slots = (
            _severity_rank(first["severity"]) == _severity_rank(second["severity"])
            and _freshness_rank(first["freshness_item"]) == _freshness_rank(second["freshness_item"])
            and _has_sample(first) == _has_sample(second)
        )
        if same_slots:
            tie_report = {
                "finding_ids": [first["finding_id"], second["finding_id"]],
                "titles": [first["title"], second["title"]],
                "statement": ("These two findings are equally supported by the recorded "
                              "evidence (same recorded severity, same freshness class, "
                              "same measurement status). The displayed order is a stable "
                              "identifier tie-break only; it does not mean the first is "
                              "worse or better."),
            }
    no_valid = not ranked
    if no_valid:
        reason = _no_valid_reason(excluded, items)
    else:
        reason = None
    return {
        "method_version": PRIORITY_METHOD_VERSION,
        "ranked": ranked,
        "tie": tie_report,
        "excluded": excluded[:10],
        "no_valid_findings": no_valid,
        "no_valid_findings_reason": reason,
        "computed_at": (now or datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


def _has_sample(candidate: dict) -> bool:
    record = candidate["record"]
    evidence = record.get("supporting_evidence") or {}
    return bool(record.get("underlying_order_records")) or evidence.get("currentCount") is not None


def _rank_reasons(severity_label: str, freshness_state: str,
                  evidence: dict, order_records: Any) -> list[str]:
    reasons = []
    if severity_label != "no_recorded_severity":
        reasons.append(f"recorded severity {severity_label}")
    else:
        reasons.append("no recorded severity (ranks below findings with one)")
    reasons.append(f"last verified update {freshness_state}")
    if evidence.get("coverage_run_id"):
        reasons.append(f"source evidence certified by run {evidence.get('coverage_run_id')}")
    if order_records:
        reasons.append(f"{len(order_records)} underlying order record(s) measured inside its "
                       "source windows (capped at 200)")
    return reasons


def _no_valid_reason(excluded: list[dict], items: list[Any]) -> str:
    if not items:
        return "verified_no_open_findings"
    if not excluded:
        return "verified_no_open_findings"
    reasons = {entry["reason"] for entry in excluded}
    if reasons <= {"malformed_record"}:
        return "no_currently_verified_findings"
    if reasons and reasons <= {
            "historical_resolved", "historical_dismissed",
            "historical_open", "historical_acknowledged"} | {
                r for r in reasons if r.startswith("historical_")}:
        return "only_historical_findings"
    if "stale_unreverified" in reasons:
        return "stale_findings_require_reverification"
    if reasons <= {"evidence_unverified", "malformed_record"} | {
            r for r in reasons if r.startswith("lifecycle_")}:
        return "evidence_unverified"
    return "no_currently_verified_findings"


def explain_priority(priority: dict | None, items: list[Any]) -> dict | None:
    """The structured explanation for the highest-priority finding.

    Built only from recorded fields; the LLM may narrate around it, never
    add impact figures or causal claims.
    """
    if not priority or priority.get("no_valid_findings") or not priority.get("ranked"):
        return None
    top = priority["ranked"][0]
    record = next((_record(item) for item in items
                   if _record(item) and str(_record(item).get("finding_id")) == top["finding_id"]),
                  None)
    if record is None:
        return None
    evidence = record.get("supporting_evidence") or {}
    why_ahead = []
    if len(priority["ranked"]) > 1:
        second = priority["ranked"][1]
        if top.get("severity_recorded") and not second.get("severity_recorded"):
            why_ahead.append(f"it has a recorded severity ({top.get('severity')}) and the "
                             "next candidate has none recorded")
        elif top.get("severity") and second.get("severity") and top.get("severity") == second.get("severity"):
            if top.get("freshness") == "fresh" and second.get("freshness") != "fresh":
                why_ahead.append("both record the same severity; this one's evidence was "
                                 "verified more recently")
            else:
                why_ahead.append("the recorded attributes are equal; the order between "
                                 "them is a stable identifier tie-break, not a judgement")
        elif top.get("severity") and second.get("severity"):
            why_ahead.append(f"recorded severity {top.get('severity')} versus "
                             f"{second.get('severity')}")
        elif top.get("severity") and not second.get("severity"):
            why_ahead.append(f"it has a recorded severity ({top.get('severity')}) and the "
                             "next candidate has none recorded")
    action = record.get("recommendation_context") or {}
    next_step = (f"Recorded recommended action: {action.get('description')}"
                 if action.get("description")
                 else "Review the underlying order records for this finding in Shopify Admin.")
    return {
        "finding_id": top["finding_id"],
        "title": top["title"],
        "observed": (f"{record.get('title') or 'A stored finding'} "
                     f"(type: {record.get('type') or 'unrecorded'}); "
                     + _evidence_sentence(record)),
        "why_it_matters": (f"Recorded severity {top.get('severity')} for a "
                           f"{record.get('type') or 'unrecorded-type'} issue in the current "
                           "verified window." if top.get("severity")
                           else "It is the most recently verified open finding; no severity "
                                "is recorded, which is itself a data gap to close."),
        "evidence": (f"Current validity {top.get('current_validity')}; lifecycle "
                     f"{top.get('lifecycle_status')}; "
                     f"{'a measured order sample exists' if top.get('measured_order_sample') else 'no measured order sample was retrieved'}"
                     + (f"; source evidence certified by run {evidence.get('coverage_run_id')}"
                        if evidence.get("coverage_run_id") else "")),
        "why_ranks_ahead": ("; ".join(why_ahead) if why_ahead else
                            "It is the only currently verified candidate."),
        "uncertain": ("A finding is a recorded detection: it does not prove the underlying "
                      "cause, and nothing has been executed on it."),
        "next_step": next_step,
    }


def compare_priority(priority: dict | None, items: list[Any], message: str) -> dict | None:
    """Answer a challenge: 'why is X more important than Y?'

    Resolves the referenced finding from the recorded priority state (by id,
    then by title token, then by finding type), compares it against the
    current top on the documented slots, and reports why the ranking does or
    does not change. Returns None when there is no priority state to answer
    from.
    """
    if not priority or priority.get("no_valid_findings") is None:
        return None
    lowered = (message or "").lower()
    referenced = None
    for uuid in _UUID_RE.findall(message or ""):
        if any(entry["finding_id"] == uuid for entry in
               priority.get("ranked", []) + priority.get("excluded", [])):
            referenced = {"finding_id": uuid}
            break
    if referenced is None:
        records = [_record(item) for item in items]
        records = [record for record in records if record is not None]
        # Type keyword first (deterministic, documented), then title tokens.
        for token, finding_type in (("refund", "refund"), ("checkout", "checkout"),
                                    ("abandonment", "checkout"), ("inventory", "inventory"),
                                    ("stock", "inventory"), ("product", "product"),
                                    ("revenue", "revenue"), ("delivery", "fulfillment")):
            if re.search(rf"\b{token}\b", lowered):
                match = next((record for record in records
                              if str(record.get("type") or "").lower() == finding_type), None)
                if match:
                    referenced = {"finding_id": match.get("finding_id"),
                                  "title": match.get("title")}
                break
        if referenced is None:
            for record in records:
                title_tokens = re.findall(r"[a-z]{4,}", str(record.get("title") or "").lower())
                overlap = set(title_tokens) & set(re.findall(r"[a-z]{4,}", lowered))
                if overlap:
                    referenced = {"finding_id": record.get("finding_id"),
                                  "title": record.get("title")}
                    break
    if referenced is None:
        return {"matched": False,
                "reason": "no_recorded_finding_matches",
                "statement": "I could not match that to a recorded finding in the current "
                             "evidence, so I will not rank against an unnamed problem."}
    finding_id = str(referenced["finding_id"])
    in_ranked = next((entry for entry in priority.get("ranked", [])
                      if entry["finding_id"] == finding_id), None)
    in_excluded = next((entry for entry in priority.get("excluded", [])
                        if entry["finding_id"] == finding_id), None)
    top = (priority.get("ranked") or [{}])[0]
    if in_excluded is not None:
        note = in_excluded.get("note") or "It is not currently verified against the live window."
        return {
            "matched": True,
            "referenced": in_excluded,
            "ranking_changed": False,
            "statement": (f"The finding you mentioned ({in_excluded.get('title') or finding_id}) "
                          f"is not in the current ranking: it is excluded as "
                          f"{in_excluded['reason']}. {note} It therefore cannot displace the "
                          f"current top ({top.get('title') or top.get('finding_id')}). If fresh "
                          "evidence is synchronized and re-verified, the ranking will be "
                          "recomputed and can change."),
        }
    if in_ranked is not None and top.get("finding_id") == finding_id:
        return {
            "matched": True,
            "referenced": in_ranked,
            "ranking_changed": False,
            "statement": (f"That finding is the current top priority (rank "
                          f"{in_ranked['rank']}). It is ranked on: "
                          + "; ".join(in_ranked.get("reasons", []))
                          + ". Nothing above it is currently verified."),
        }
    if in_ranked is not None and top.get("finding_id") != finding_id:
        return {
            "matched": True,
            "referenced": in_ranked,
            "ranking_changed": False,
            "statement": (f"That finding is ranked {in_ranked['rank']} (its basis: "
                          + "; ".join(in_ranked.get("reasons", []))
                          + f"). The current top ({top.get('title') or top.get('finding_id')}) "
                            f"is ranked ahead on: " + "; ".join(top.get("reasons", []))
                          + ". If new evidence changes those recorded attributes, the ranking "
                            "changes with it."),
        }
    return {
        "matched": True,
        "referenced": referenced,
        "ranking_changed": False,
        "statement": "That finding is not in the recorded current set at all; I will not rank "
                     "against evidence I do not have.",
    }
