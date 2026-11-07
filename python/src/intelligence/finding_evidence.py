"""Authorized finding lifecycle and supporting-evidence retrieval (Task 202)."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from .evidence import EVIDENCE_SCHEMA_VERSION, STATUS_PARTIAL, STATUS_UNAVAILABLE, availability_of, ensure_utc, evidence_item, iso, period, utc_now
from .query import safe_query

_FINDING_SQL = """
SELECT f.id, f.store_id, f.type, f.severity, f.status, f.title, f.description,
 f.evidence, f.action, f.dedupe_key, f.detected_at, f.acknowledged_at,
 f.resolved_at, f.dismissed_at, f.updated_at
FROM intelligence_findings f JOIN stores s ON s.id = f.store_id
WHERE s.organization_id = :org_id::uuid AND f.organization_id = :org_id::uuid
 AND s.status IN ('active','connected','syncing')
"""
_ORDER_SQL = """
SELECT o.external_order_id, o.external_order_name, o.ordered_at, o.total,
 o.refunded_total, o.currency, o.recovery_status
FROM orders o JOIN intelligence_findings f ON f.store_id = o.store_id
JOIN stores s ON s.id = f.store_id
WHERE f.id = CAST(:finding_id AS uuid) AND f.organization_id = :org_id::uuid
 AND s.organization_id = :org_id::uuid AND s.status IN ('active','connected','syncing')
 AND o.ordered_at >= :previous_start AND o.ordered_at < :current_end
ORDER BY o.ordered_at, o.id LIMIT 201
"""

_SCALAR_KEYS = {
    "verified", "complete", "currency", "currentCount", "previousCount",
    "currentRevenue", "previousRevenue", "currentReturning", "previousReturning",
    "currentStart", "currentEnd", "previousStart", "previousEnd",
    "coverage_source", "coverage_run_id", "failed_webhook_registrations",
}


def _get(row, key, default=None):
    try:
        return row[key]
    except (KeyError, TypeError, IndexError):
        return getattr(row, key, default)


def _json(value, fallback):
    if isinstance(value, (dict, list)):
        return value
    if value is None:
        return fallback
    try:
        import json
        return json.loads(str(value))
    except (TypeError, ValueError):
        return fallback


def _date(value):
    if not value:
        return None
    try:
        parsed = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return ensure_utc(parsed)
    except (TypeError, ValueError):
        return None


def _bounded_evidence(raw) -> dict:
    source = _json(raw, {})
    if not isinstance(source, dict):
        return {}
    result = {}
    for key in _SCALAR_KEYS:
        value = source.get(key)
        if isinstance(value, bool) or (isinstance(value, (int, float)) and not isinstance(value, bool)) or (isinstance(value, str) and len(value) <= 160):
            result[key] = value
    return result


def _bounded_action(raw) -> dict:
    action = _json(raw, {})
    if not isinstance(action, dict):
        return {}
    return {key: str(value)[:500] for key, value in action.items()
            if key in {"type", "label", "description", "recommendation", "measure"} and isinstance(value, (str, int, float))}


def retrieve_finding_evidence(organization_id: str, db, *, now: datetime | None = None,
                              timezone_name: str = "UTC", finding_reference: str | None = None,
                              latest: bool = False, include_history: bool = False,
                              lifecycle_status: str | None = None) -> dict:
    if not organization_id:
        raise ValueError("authenticated organization required")
    if finding_reference and latest:
        raise ValueError("latest cannot be combined with a finding reference")
    now = ensure_utc(now or utc_now(), field="now")
    params = {"org_id": organization_id}
    sql = _FINDING_SQL
    if finding_reference:
        import re
        if not re.fullmatch(r"[0-9a-fA-F-]{36}", str(finding_reference)):
            raise ValueError("invalid finding reference")
        sql += " AND f.id = CAST(:finding_id AS uuid)"
        params["finding_id"] = finding_reference
    elif lifecycle_status:
        if lifecycle_status not in {"open", "acknowledged", "resolved", "dismissed"}:
            raise ValueError("invalid finding lifecycle")
        sql += " AND f.status = :status"
        params["status"] = lifecycle_status
    elif not include_history:
        sql += " AND f.status IN ('open','acknowledged')"
    sql += " ORDER BY f.detected_at DESC, f.id DESC LIMIT 26"
    rows, error = safe_query(db, sql, params)
    if error:
        return {"schema_version": EVIDENCE_SCHEMA_VERSION, "items": [], "warnings": ["finding_query_failed"],
                "limitations": ["Finding evidence is unavailable."], "overall_status": STATUS_UNAVAILABLE,
                "generated_at": iso(now)}
    if latest:
        rows = rows[:1]
    truncated = len(rows) > 25
    rows = rows[:25]
    items = []
    warnings = ["finding_result_truncated"] if truncated else []
    for row in rows:
        evidence = _bounded_evidence(_get(row, "evidence"))
        action = _bounded_action(_get(row, "action"))
        detected = _date(_get(row, "detected_at"))
        updated = _date(_get(row, "updated_at")) or detected
        status = str(_get(row, "status") or "unknown")
        current_end = _date(evidence.get("currentEnd"))
        verified = evidence.get("verified") is True and evidence.get("complete") is True
        stale = bool(status in {"open", "acknowledged"} and current_end and (now - current_end).total_seconds() > 48 * 3600)
        historical = status in {"resolved", "dismissed"}
        validity = ("historical_" + status if historical else "stale_unreverified" if stale
                    else "current_evidence_verified" if verified else "evidence_unverified")
        coverage = {"complete": verified and not stale, "status": "complete" if verified and not stale else "partial",
                    "finding_lifecycle": status, "current_validity": validity}
        age = max(0, int((now - updated).total_seconds())) if updated else None
        freshness = {"state": "stale" if stale or age is None or age > 86400 else "fresh" if age <= 3600 else "aging",
                     "as_of": iso(updated), "age_seconds": age, "policy": "finding-reverification-48h"}
        finding_id = str(_get(row, "id"))
        order_records = []
        previous_start, current_end_value = _date(evidence.get("previousStart")), current_end
        valid_period = bool(previous_start and current_end_value and previous_start < current_end_value)
        if previous_start and current_end_value and not valid_period:
            warnings.append(f"finding_measurement_period_invalid:{finding_id}")
        if valid_period:
            order_rows, order_error = safe_query(db, _ORDER_SQL, {
                "org_id": organization_id, "finding_id": finding_id,
                "previous_start": previous_start, "current_end": current_end_value,
            })
            if order_error:
                warnings.append(f"finding_order_evidence_unavailable:{finding_id}")
            else:
                if len(order_rows) > 200:
                    warnings.append(f"finding_order_evidence_truncated:{finding_id}")
                for order in order_rows[:200]:
                    order_records.append({
                        "external_order_id": _get(order, "external_order_id"),
                        "order_name": _get(order, "external_order_name"),
                        "ordered_at": iso(_get(order, "ordered_at")),
                        "total": str(_get(order, "total")) if _get(order, "total") is not None else None,
                        "refunded_total": str(_get(order, "refunded_total")) if _get(order, "refunded_total") is not None else None,
                        "currency": _get(order, "currency"), "lifecycle": _get(order, "recovery_status"),
                    })
        elif _get(row, "type") != "integration_failure":
            warnings.append(f"finding_measurement_period_unavailable:{finding_id}")
        window = period(previous_start if valid_period else (detected or now - __import__("datetime").timedelta(seconds=1)), current_end_value if valid_period else (detected or now),
                        timezone_label=timezone_name)
        value = {
            "finding_id": finding_id, "store_id": str(_get(row, "store_id")),
            "type": _get(row, "type"), "title": _get(row, "title"),
            "description": _get(row, "description"), "severity": _get(row, "severity"),
            "lifecycle_status": status, "current_validity": validity,
            "detected_at": iso(detected), "updated_at": iso(updated),
            "acknowledged_at": iso(_get(row, "acknowledged_at")),
            "resolved_at": iso(_get(row, "resolved_at")), "dismissed_at": iso(_get(row, "dismissed_at")),
            "supporting_evidence": evidence, "recommendation_context": action,
            "underlying_order_records": order_records,
            "evidence_relationship": "organization/store-scoped finding plus bounded order records inside its source measurement windows",
        }
        items.append(evidence_item("finding_evidence", label=_get(row, "title") or f"Finding {finding_id}",
            value=value, unit="record", window=window, source="intelligence_findings",
            status=STATUS_PARTIAL if historical or stale or not verified else "available",
            definition="Authorized finding lifecycle, certified source evidence and bounded underlying order records; historical or stale findings are not current operational problems.",
            coverage=coverage, freshness=freshness,
            limitations=["Existence of a finding row does not prove current validity.", "Underlying order retrieval is capped at 200 records; truncation is disclosed."],
            domain="findings", discriminator=finding_id,
            classification="verified_fact" if verified else "unknown",
            source_references=([{"source_id": str(evidence["coverage_run_id"]), "resource": str(evidence.get("coverage_source") or "order_coverage"), "sync_run_id": str(evidence["coverage_run_id"])}] if evidence.get("coverage_run_id") else []),
            provenance={"retrieval": "direct", "transformation": "Tenant/store join, source evidence allowlist, lifecycle evaluation and measurement-window order lookup.",
                        "calculation_version": "finding-evidence-v1", "lineage": [f"finding:{finding_id}"], "reproducible": True}))
    return {"schema_version": EVIDENCE_SCHEMA_VERSION, "items": items, "warnings": list(dict.fromkeys(warnings)),
            "limitations": ["A resolved/dismissed finding is historical; stale findings require re-verification."],
            "overall_status": availability_of(items) if items else STATUS_PARTIAL,
            "generated_at": iso(now)}
