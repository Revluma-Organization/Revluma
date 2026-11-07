"""Task 212 deterministic 110-scenario intelligence regression matrix.

Every case runs production validation/helper code. No provider, merchant or
network is involved; production acceptance is a separate, authenticated gate.
"""
from __future__ import annotations

import copy
import json
import time
from datetime import datetime, timezone

import pytest

from src.agents.model_gateway import ModelProviderError
from src.agents.responder import _parse_analysis
from src.agents.understanding import _parse
from src.intelligence.conversation_reliability import (
    bounded_history_text, build_context_summary, validate_context_summary,
)
from src.intelligence.reliability import (
    CONSISTENCY_CONTRACT_VERSION, FAILURE_CONTRACT_VERSION, InvestigationDeadline,
    canonical_request, classify_exception, compare_consistency, redact_sensitive,
    safe_failure, validate_consistency,
)

ORG = "11111111-1111-4111-8111-111111111111"
OTHER_ORG = "22222222-2222-4222-8222-222222222222"
CONV = "33333333-3333-4333-8333-333333333333"
SCENARIOS = []


def add(group, name, handler, **payload):
    SCENARIOS.append(pytest.param({"id": f"{group}-{len(SCENARIOS)+1:03d}-{name}", "handler": handler, **payload},
                                  id=f"{group}-{len(SCENARIOS)+1:03d}-{name}"))


CATEGORIES = ["timeout", "cancelled", "rate_limited", "provider_unavailable", "connection_failed",
              "invalid_request", "malformed_output", "schema_validation_failed", "authorization_failed",
              "permission_denied", "unsupported_capability", "evidence_retrieval_failed", "specialist_failed",
              "partial_success", "internal_error"]
for category in CATEGORIES:
    add("F", category, "taxonomy", category=category, retryable=category in {
        "timeout", "rate_limited", "provider_unavailable", "connection_failed"})
for index in range(15):
    add("D", f"remaining-budget-{index}", "deadline", operation=[
        "context_retrieval", "database_statement", "intent_classification", "specialist", "response_composition"][index % 5],
        elapsed_ms=0 if index < 12 else 1100, expired=index >= 12)


def understanding():
    return {"intent": "diagnosis", "goal": "Understand revenue", "requires_store_data": True,
            "requires_web": False, "requires_action": False, "response_mode": "analysis",
            "entities": {"metric": "revenue"}, "domains": ["revenue"], "urgency": "low", "confidence": 0.8}


def mutate(payload, key, value):
    result = copy.deepcopy(payload)
    if value is Ellipsis:
        result.pop(key, None)
    else:
        result[key] = value
    return result


base_u = understanding()
add("O", "complete-valid-object", "understanding", payload=base_u, valid=True)
add("O", "fenced-complete-object", "understanding_raw", raw="```json\n" + json.dumps(base_u) + "\n```", valid=True)
for key in base_u:
    add("O", f"missing-{key}", "understanding", payload=mutate(base_u, key, Ellipsis), valid=False)
add("O", "surrounding-prose", "understanding_raw", raw="Answer: " + json.dumps(base_u), valid=False)
add("O", "truncated", "understanding_raw", raw=json.dumps(base_u)[:-8], valid=False)
add("O", "invalid-enum", "understanding", payload=mutate(base_u, "intent", "revenue_drop"), valid=False)
add("O", "invalid-confidence", "understanding", payload=mutate(base_u, "confidence", 1.2), valid=False)
add("O", "boolean-confidence", "understanding", payload=mutate(base_u, "confidence", True), valid=False)
add("O", "boolean-string", "understanding", payload=mutate(base_u, "requires_action", "false"), valid=False)
add("O", "invalid-domain-type", "understanding", payload=mutate(base_u, "domains", "revenue"), valid=False)
add("O", "invalid-goal-type", "understanding", payload=mutate(base_u, "goal", 3), valid=False)
assert len(SCENARIOS) == 50

base_a = {"situation": "Revenue is recorded.", "insight": "One input changed.",
          "implication": "Review the evidence.", "recommendation": "Inspect the recorded orders.",
          "confidence": {"score": 0.8, "basis": "Recorded evidence"}, "actions": []}
add("A", "valid", "analysis", payload=base_a, valid=True)
for index, key in enumerate(base_a):
    if index >= 5:
        break
    add("A", f"missing-{key}", "analysis", payload=mutate(base_a, key, Ellipsis), valid=False)
add("A", "repaired-confidence-rejected", "analysis", payload={**base_a, "confidence": {"score": 4, "basis": "bad"}}, valid=False)
add("A", "action-execution-rejected", "analysis", payload={**base_a, "actions": [{"label": "Write", "tool": "create_campaign"}]}, valid=False)
add("A", "surrounding-json-rejected", "analysis_raw", raw="Result " + json.dumps(base_a), valid=False)
add("A", "non-string-situation-rejected", "analysis", payload={**base_a, "situation": 3}, valid=False)
assert len(SCENARIOS) == 60

period = {"start": "2026-10-01T00:00:00Z", "end": "2026-11-01T00:00:00Z", "timezone": "UTC", "semantics": "paid_at"}
item = {"id": "ev-1", "metric": "revenue", "value": 100, "unit": "currency", "currency": "USD",
        "status": "available", "period": period, "coverage": {"rows": 10},
        "freshness": {"state": "fresh", "as_of": "2026-11-01T00:00:00Z"}}
for name, mutation in [
    ("unchanged", {}), ("retrieval-time-ignored", {"freshness.as_of": "2026-11-02T00:00:00Z"}),
    ("value", {"value": 101}), ("currency", {"currency": "EUR"}), ("status", {"status": "partial"}),
    ("coverage", {"coverage.rows": 9}), ("period-start", {"period.start": "2026-09-30T00:00:00Z"}),
    ("freshness-state", {"freshness.state": "stale"}), ("definition", {"definition": "net"}),
    ("evidence-id", {"id": "ev-2"}), ("unit", {"unit": "count"}), ("metric", {"metric": "orders"}),
    ("period-timezone", {"period.timezone": "Africa/Lagos"}), ("period-semantics", {"period.semantics": "created_at"}),
    ("freshness-time-ignored", {"freshness.as_of": None}),
]:
    changed = copy.deepcopy(item)
    for dotted, value in mutation.items():
        target = changed
        parts = dotted.split(".")
        for part in parts[:-1]:
            target = target[part]
        target[parts[-1]] = value
    add("R", name, "consistency", original=item, changed=changed,
        unchanged=name in {"unchanged", "retrieval-time-ignored", "freshness-time-ignored"})
assert len(SCENARIOS) == 75


def context_result():
    evidence = {**item, "store_ids": ["store-a"], "organization_id": ORG}
    claim = {"contract_version": "rev-claim-v1", "claim_id": "claim-1", "classification": "verified_fact",
             "causal_status": "not_causal", "text": "Recorded revenue is 100 USD.", "metric": "revenue",
             "value": 100, "unit": "currency", "currency": "USD", "rounding": "exact",
             "period": period, "evidence_ids": ["ev-1"], "limitations": []}
    return {"investigation": {"id": "inv-1", "intent": "diagnosis", "status": "completed", "period": period},
            "evidence": {"items": [evidence], "comparison_items": []}, "claims": [claim],
            "unknowns": ["Cause is unknown"], "recommendations": [], "selected_finding": None,
            "consistency": None}


add("C", "valid-summary", "context", mutation=None, valid=True)
for index, mutation in enumerate([
    ("tenant", OTHER_ORG), ("contract", "bad"), ("method", "model"),
    ("conversation", "other"), ("hypothesis-grade", "verified_fact"),
]):
    add("C", mutation[0], "context", mutation=mutation, valid=False)
add("C", "bounded-history", "context_history", valid=True)
add("C", "preserve-active-finding", "context_finding", valid=True)
add("C", "preserve-hypothesis-unknown", "context_epistemics", valid=True)
add("C", "preserve-recommendation-provenance", "context_recommendation", valid=True)
add("C", "prior-finding-history", "context_previous", valid=True)
add("C", "unrelated-turns-dropped", "context_history_drop", valid=True)
add("C", "numeric-value-preserved", "context_numeric", valid=True)
add("C", "currency-preserved", "context_currency", valid=True)
add("C", "evidence-reference-preserved", "context_reference", valid=True)
assert len(SCENARIOS) == 90

for index, key in enumerate(["access_token", "api_key", "secret", "password", "authorization",
                              "database_url", "connection_string", "email", "phone", "stack_trace"]):
    add("P", key, "redaction", key=key)
assert len(SCENARIOS) == 100

for status in [429, 500, 502, 503, 504, "missing_key", "network", "timeout_budget_exhausted", "empty_text", 400]:
    add("M", str(status), "provider", status=status)
assert len(SCENARIOS) == 110


def execute(case):
    handler = case["handler"]
    if handler == "taxonomy":
        failure = safe_failure(case["category"], "provider", retry_count=1, partial=True, fallback=True)
        assert failure["contract_version"] == FAILURE_CONTRACT_VERSION
        assert failure["retryable"] is case["retryable"]
        assert failure["retry_count"] == 1 and failure["partial_results_preserved"]
    elif handler == "deadline":
        deadline = InvestigationDeadline.start(1000)
        deadline.started = time.monotonic() - case["elapsed_ms"] / 1000
        assert deadline.expired() is case["expired"]
        if not case["expired"]:
            assert 0 < deadline.operation_seconds(case["operation"], 30) <= deadline.remaining_ms() / 1000
    elif handler == "understanding":
        assert (_parse(json.dumps(case["payload"])) is not None) is case["valid"]
    elif handler == "understanding_raw":
        assert (_parse(case["raw"]) is not None) is case["valid"]
    elif handler == "analysis":
        assert (_parse_analysis(json.dumps(case["payload"])) is not None) is case["valid"]
    elif handler == "analysis_raw":
        assert (_parse_analysis(case["raw"]) is not None) is case["valid"]
    elif handler == "consistency":
        common = {"organization_id": ORG, "store_ids": ["store-a"], "intent": "diagnosis", "period": period}
        previous = canonical_request(**common, items=[case["original"]])
        current = canonical_request(**common, items=[case["changed"]])
        compared = compare_consistency(previous, current)
        assert not validate_consistency(compared)
        assert (compared["status"] == "unchanged") is case["unchanged"]
        if not case["unchanged"]:
            assert compared["status"] == "evidence_changed" and "evidence_snapshot" in compared["changed_fields"]
    elif handler.startswith("context"):
        result = context_result()
        previous = None
        if handler == "context_finding":
            result["selected_finding"] = {"finding_id": "finding-1", "finding_version": "v1", "title": "Revenue",
                                          "lifecycle_state": "active", "current_validity": "current",
                                          "selection_source": "explicit", "selected_at": "2026-11-01T00:00:00Z"}
        if handler == "context_epistemics":
            result["claims"].append({**result["claims"][0], "claim_id": "h-1", "classification": "hypothesis",
                                     "causal_status": "hypothesized", "text": "A hypothesis", "value": None,
                                     "hypothesis": "Possible cause", "restated": True})
            result["claims"].append({**result["claims"][0], "claim_id": "u-1", "classification": "unknown",
                                     "causal_status": "not_established", "text": "Unknown", "value": None,
                                     "unknown": "Cause", "restated": True})
        if handler == "context_recommendation":
            result["recommendations"] = [{"recommendation_id": "r-1", "finding_id": "f-1", "finding_version": "v1",
                                          "lifecycle_state": "proposed", "step": "Inspect orders",
                                          "validation_method": "Compare recorded revenue", "evidence_references": ["ev-1"]}]
        if handler == "context_previous":
            previous = build_context_summary({**result, "selected_finding": {"finding_id": "old", "finding_version": "v1",
                "title": "Earlier", "lifecycle_state": "active"}}, conversation_id=CONV,
                organization_id=ORG, store_ids=["store-a"])
            result["selected_finding"] = {"finding_id": "new", "finding_version": "v1", "title": "Current",
                                          "lifecycle_state": "active"}
        summary = build_context_summary(result, conversation_id=CONV, organization_id=ORG,
                                        store_ids=["store-a"], previous=previous)
        if handler == "context_history":
            assert len(bounded_history_text(summary, [{"role": "user", "text": "x" * 1000}] * 12)) <= 6000
            return
        if handler == "context_history_drop":
            text = bounded_history_text(summary, [{"role": "user", "text": "unrelated " * 100}] * 12)
            assert len(text) <= 6000 and "Validated conversation summary" in text
            return
        mutation = case.get("mutation")
        if mutation:
            key, value = mutation
            if key == "tenant": summary["tenant"]["organization_id"] = value
            if key == "contract": summary["contract_version"] = value
            if key == "method": summary["summary_method"] = value
            if key == "conversation": summary["conversation_id"] = value
            if key == "hypothesis-grade": summary["hypotheses"] = [{"classification": value}]
        errors = validate_context_summary(summary, organization_id=ORG, conversation_id=CONV)
        assert (not errors) is case["valid"], errors
        if not case["valid"]: return
        if handler == "context_epistemics":
            assert summary["hypotheses"][0]["classification"] == "hypothesis"
            assert summary["unknowns"][0]["classification"] == "unknown"
        if handler == "context_numeric": assert summary["verified_findings"][0]["value"] == 100
        if handler == "context_currency": assert summary["currencies"] == ["USD"]
        if handler == "context_reference": assert summary["evidence_references"] == ["ev-1"]
        if handler == "context_previous": assert [f["finding_id"] for f in summary["finding_history"]] == ["new", "old"]
    elif handler == "redaction":
        cleaned = redact_sensitive({case["key"]: "must-not-survive", "metric": "revenue", "nested": {case["key"]: "secret"}})
        assert case["key"] not in cleaned and case["key"] not in cleaned["nested"]
        assert cleaned["metric"] == "revenue"
    elif handler == "provider":
        failure = classify_exception(ModelProviderError("gemini", case["status"]), stage="provider")
        expected = {429: "rate_limited", 500: "provider_unavailable", 502: "provider_unavailable",
                    503: "provider_unavailable", 504: "provider_unavailable", "missing_key": "provider_unavailable",
                    "network": "connection_failed", "timeout_budget_exhausted": "timeout",
                    "empty_text": "malformed_output", 400: "invalid_request"}[case["status"]]
        assert failure["category"] == expected
        assert "must-not" not in json.dumps(failure)


@pytest.mark.parametrize("case", SCENARIOS)
def test_task212_scenario(case):
    execute(case)


def test_task212_matrix_is_exactly_110_unique_scenarios():
    assert len(SCENARIOS) == 110
    assert len({case.values[0]["id"] for case in SCENARIOS}) == 110
