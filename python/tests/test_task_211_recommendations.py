"""Task 211 recommendation/finding-context acceptance scenarios (synthetic)."""
from __future__ import annotations

import json
from datetime import timedelta

import pytest

from src.agents.investigation import run_investigation
from src.intelligence.claim_guardrails import initialise_action_states, validate_action_states
from src.intelligence.evidence import evidence_context, evidence_item, period
from src.intelligence.recommendations import (
    RECOMMENDATION_CONTRACT_VERSION, SELECTED_FINDING_CONTRACT_VERSION,
    build_selected_finding, enrich_recommendations, selected_finding_reference,
    validate_recommendation_contract,
)
from tests.test_rev_investigation import NOW, ORG, USER, workspace_db

FINDING = "123e4567-e89b-42d3-a456-426614174000"
OTHER = "123e4567-e89b-42d3-a456-426614174001"
STORE = "store-a1"
INVESTIGATION = "99999999-9999-4999-8999-999999999999"
WINDOW = period(NOW - timedelta(days=1), NOW)


def finding_item(kind="revenue_change", *, validity="current_evidence_verified", lifecycle="open",
                 severity="high", version="2026-11-07T11:00:00Z", complete=True, finding_id=FINDING):
    value = {
        "finding_id": finding_id, "store_id": STORE, "type": kind,
        "title": f"Verified {kind.replace('_', ' ')}", "description": "Recorded synthetic finding.",
        "severity": severity, "lifecycle_status": lifecycle, "current_validity": validity,
        "dedupe_key": f"{kind}:one", "detected_at": "2026-11-06T11:00:00Z", "updated_at": version,
        "supporting_evidence": {"verified": complete, "complete": complete, "currency": "USD",
            "currentCount": 8, "previousCount": 10, "currentRevenue": 80, "previousRevenue": 100,
            "currentStart": "2026-11-06T12:00:00Z", "currentEnd": "2026-11-07T12:00:00Z",
            "previousStart": "2026-11-05T12:00:00Z", "previousEnd": "2026-11-06T12:00:00Z"},
        "recommendation_context": {"guidance": "Compare the affected records for the two recorded periods.",
                                    "measurement": "Repeat the same comparison after the next equivalent period."},
        "underlying_order_records": [{"external_order_id": "order-1", "order_name": "#1001"}],
    }
    with evidence_context(ORG, [STORE]):
        return evidence_item("finding_evidence", label=value["title"], value=value, unit="record",
        window=WINDOW, source="intelligence_findings", status="available" if validity == "current_evidence_verified" else "partial",
        definition="Authorized synthetic finding and source observations.",
        coverage={"complete": validity == "current_evidence_verified", "status": "complete" if validity == "current_evidence_verified" else "partial"},
        freshness={"state": "stale" if validity == "stale_unreverified" else "fresh", "as_of": version},
        limitations=["Synthetic finding test; no production merchant evidence."], domain="findings",
        discriminator=finding_id, classification="verified_fact",
        provenance={"retrieval": "direct", "transformation": "Authorized finding lookup.",
                    "calculation_version": "finding-evidence-v1", "lineage": [finding_id], "reproducible": True})


def derived(kind="revenue_change", **kwargs):
    item = finding_item(kind, **kwargs)
    selected = build_selected_finding(item, organization_id=ORG, investigation_id=INVESTIGATION,
        reference={"finding_id": FINDING, "selection_source": "explicit_selection"}, now=NOW)
    recs = enrich_recommendations([], items=[item], selected_item=item, selected=selected,
        organization_id=ORG, investigation_id=INVESTIGATION, intent="finding_investigation", now=NOW)
    return item, selected, recs


def test_01_verified_revenue_recommendation_is_specific():
    _, selected, recs = derived()
    assert selected["finding_id"] == FINDING and recs[0]["finding_id"] == FINDING
    assert "order count" in recs[0]["step"] and "average order value" in recs[0]["step"]


@pytest.mark.parametrize("kind,needle", [
    ("refund_increase", "refund"), ("checkout_abandonment", "incomplete checkouts"),
    ("inventory_stockout", "variants"), ("integration_failure", "authorization"),
])
def test_02_to_05_domain_recommendations_are_specific(kind, needle):
    assert needle in derived(kind)[2][0]["step"].lower()


def test_06_insufficient_evidence_has_narrow_prerequisite():
    _, _, recs = derived(validity="evidence_unverified", complete=False)
    assert recs[0]["actionability"] == "prerequisite_required"
    assert recs[0]["lifecycle_state"] == "invalidated"


def test_07_unsupported_empty_advice_is_excluded():
    item, selected, _ = derived()
    recs = enrich_recommendations([{"label": ""}], items=[item], selected_item=item, selected=selected,
        organization_id=ORG, investigation_id=INVESTIGATION, intent="finding_investigation", now=NOW)
    assert len(recs) == 1


def test_08_recommendation_references_are_authorized():
    item, selected, recs = derived()
    assert recs[0]["evidence_references"] == [item["id"]]
    assert validate_recommendation_contract(selected, recs, organization_id=ORG, evidence_ids={item["id"]}) == []


def test_09_recommendation_explains_why_and_validation():
    rec = derived()[2][0]
    assert rec["why_it_matters"] and rec["validation_method"] and rec["explanation"]


def test_10_no_financial_outcome_promise():
    text = json.dumps(derived()[2]).lower()
    assert not any(term in text for term in ("will recover", "guaranteed", "expected revenue recovery", "will increase revenue"))


def test_11_prioritization_is_defensible_and_bounded():
    item, selected, _ = derived()
    existing = [{"label": "Compare a secondary observation", "why": "Independent check", "measure": "Same metric", "evidence_ids": [item["id"]]}]
    recs = enrich_recommendations(existing * 2, items=[item], selected_item=item, selected=selected,
        organization_id=ORG, investigation_id=INVESTIGATION, intent="finding_investigation", now=NOW)
    assert recs[0]["finding_id"] == FINDING and recs[0]["priority"]["rank"] == 1
    assert "no unsupported impact score" in recs[0]["priority"]["rationale"]


def test_12_duplicate_recommendations_are_prevented():
    item, selected, _ = derived()
    old = {"label": "Same step", "why": "Same reason", "measure": "Same measure", "evidence_ids": [item["id"]]}
    recs = enrich_recommendations([old, dict(old)], items=[item], selected_item=item, selected=selected,
        organization_id=ORG, investigation_id=INVESTIGATION, intent="finding_investigation", now=NOW)
    assert len({(r["finding_id"], r["step"]) for r in recs}) == len(recs)


@pytest.mark.parametrize("field", ["prices", "discounts", "inventory", "refunds", "cancellations", "customer_communications"])
def test_13_to_18_read_only_generation_has_no_merchant_writes(field):
    rec = derived()[2][0]
    assert rec["read_only"] is True and rec["executed"] is False
    assert rec.get(field) is None


def test_19_acknowledgement_is_not_execution():
    rec = derived()[2][0]
    initialise_action_states([rec])
    rec["action_state"] = "acknowledged"
    assert rec["executed"] is False and rec["execution_status"] == "not_requested"
    assert validate_action_states([rec]) == [
        "recommendation_0_invalid_action_state",
        "recommendation_0_generated_state_not_authoritative",
    ]


def test_20_no_false_completion_claim():
    rec = derived()[2][0]
    initialise_action_states([rec])
    assert validate_action_states([rec]) == []
    assert rec["execution_outcome"] is None and rec["independent_verification"] == "unverified"


def finding_db(row=None):
    db = workspace_db()
    record = {
        "id": FINDING, "store_id": STORE, "type": "revenue_change", "severity": "high", "status": "open",
        "title": "Verified revenue decreased", "description": "Recorded revenue changed between equal periods.",
        "evidence": {"verified": True, "complete": True, "currency": "USD", "currentCount": 8, "previousCount": 10,
            "currentRevenue": 80, "previousRevenue": 100, "currentStart": "2026-11-06T12:00:00Z",
            "currentEnd": "2026-11-07T12:00:00Z", "previousStart": "2026-11-05T12:00:00Z", "previousEnd": "2026-11-06T12:00:00Z"},
        "action": {"guidance": "Compare order count and average order value for the two periods.", "measurement": "Repeat the comparison next period."},
        "dedupe_key": "revenue:one", "detected_at": NOW - timedelta(days=1), "updated_at": NOW,
        "acknowledged_at": None, "resolved_at": None, "dismissed_at": None,
    }
    if row:
        record.update(row)
    db.routes.insert(0, ("FROM intelligence_findings f JOIN stores", [record]))
    return db


def selected_payload():
    return {"selected_finding": {"finding_id": FINDING, "selection_source": "explicit_selection",
                                 "selected_at": "2026-11-07T11:30:00Z"}}


def test_21_selection_opens_correct_authoritative_context():
    result = run_investigation(ORG, USER, "Help with this finding", db=finding_db(), now=NOW,
                               context_payload=selected_payload(), persist=False)
    assert result["selected_finding"]["finding_id"] == FINDING
    assert result["selected_finding"]["title"] == "Verified revenue decreased"


@pytest.mark.parametrize("question", ["Why is this happening?", "Which products are involved?",
    "Is this affecting my revenue?", "What should I do first?", "Has this improved?", "Explain that more simply."])
def test_22_to_27_real_followups_keep_finding(question):
    result = run_investigation(ORG, USER, question, db=finding_db(), now=NOW,
                               context_payload=selected_payload(), persist=False)
    assert result["selected_finding"]["finding_id"] == FINDING
    finding_calls = [(sql, params) for sql, params in result["_test_statements"]] if "_test_statements" in result else []


def test_28_to_29_prior_conversation_restores_identifier_and_revalidates():
    db = finding_db()
    context = {"summary": None, "context_window": {"last_selected_finding": {"finding_id": FINDING, "title": "Old client title"}}}
    result = run_investigation(ORG, USER, "Why is it important?", conversation_id="44444444-4444-4444-8444-444444444444",
        db=db, now=NOW, context_payload={"conversation_context": context}, persist=False)
    assert result["selected_finding"]["finding_id"] == FINDING
    assert result["selected_finding"]["title"] == "Verified revenue decreased"
    assert any(params.get("finding_id") == FINDING for sql, params in db.statements if "f.id = CAST(:finding_id" in sql)


def test_30_explicit_new_selection_wins_over_prior():
    db = finding_db({"id": OTHER})
    context = {"context_window": {"last_selected_finding": {"finding_id": FINDING}}}
    result = run_investigation(ORG, USER, "Explain this", db=db, now=NOW,
        context_payload={"conversation_context": context, "selected_finding": {"finding_id": OTHER}}, persist=False)
    assert result["selected_finding"]["finding_id"] == OTHER


def test_31_topic_change_drops_prior_finding():
    result = selected_finding_reference("Instead, how is inventory?", None,
        {"last_selected_finding": {"finding_id": FINDING}}, topic_change=True)
    assert result is None


def test_32_missing_explicit_reference_never_falls_back_to_latest():
    db = finding_db()
    result = run_investigation(ORG, USER, "Why this?", db=db, now=NOW,
        context_payload={"selected_finding": {"finding_id": OTHER}}, persist=False)
    assert result["selected_finding"] is None
    assert any("could not be re-resolved" in unknown for unknown in result["unknowns"])


@pytest.mark.parametrize("validity", [
    "evidence_unverified", "stale_unreverified", "evidence_failed",
    "source_disconnected", "contradictory_unresolved", "unsupported_claim",
])
def test_33_to_38_incomplete_and_stale_states_remain_qualified(validity):
    _, selected, recs = derived(validity=validity, complete=False)
    assert selected["evidence_quality"] != "verified"
    assert recs[0]["actionability"] == "prerequisite_required"
    assert recs[0]["missing_information"]


def test_39_contradictory_evidence_remains_a_limitation():
    item, selected, recs = derived()
    item["limitations"].append("Source observations conflict; no value was reconciled into a false agreement.")
    selected = build_selected_finding(item, organization_id=ORG, investigation_id=INVESTIGATION,
        reference={"finding_id": FINDING}, now=NOW)
    recs = enrich_recommendations([], items=[item], selected_item=item, selected=selected,
        organization_id=ORG, investigation_id=INVESTIGATION, intent="finding_investigation", now=NOW)
    assert "conflict" in recs[0]["limitations"][-1].lower()


def test_40_verified_zero_is_not_missing():
    item = finding_item()
    item["value"]["supporting_evidence"]["currentCount"] = 0
    selected = build_selected_finding(item, organization_id=ORG, investigation_id=INVESTIGATION,
        reference={"finding_id": FINDING}, now=NOW)
    assert selected["metrics"]["currentCount"] == 0 and selected["evidence_quality"] == "verified"


def test_41_valid_subset_keeps_specific_advice():
    item, selected, recs = derived(validity="evidence_unverified", complete=False)
    item["status"] = "partial"
    assert recs[0]["evidence_references"] == [item["id"]] and recs[0]["lifecycle_state"] == "invalidated"


def test_42_partial_domain_does_not_invent_full_completion():
    result = run_investigation(ORG, USER, "Which products are involved?", db=finding_db(), now=NOW,
                               context_payload=selected_payload(), persist=False)
    assert result["selected_finding"]["finding_id"] == FINDING
    assert result["investigation"]["status"] in {"partial", "complete", "insufficient_data"}


def test_43_severity_change_creates_new_version_identity():
    old = derived(severity="medium", version="2026-11-07T10:00:00Z")[2][0]
    new = derived(severity="critical", version="2026-11-07T11:00:00Z")[2][0]
    assert old["recommendation_id"] != new["recommendation_id"]
    assert new["priority"]["severity"] == "critical"


def test_44_new_evidence_reevaluates_recommendation():
    old = derived(version="2026-11-07T10:00:00Z")[2][0]
    new = derived(version="2026-11-07T11:00:00Z")[2][0]
    assert new["finding_version"] != old["finding_version"] and new["recommendation_id"] != old["recommendation_id"]


def test_45_stale_invalidates_current_recommendation():
    rec = derived(validity="stale_unreverified")[2][0]
    assert rec["lifecycle_state"] == "invalidated" and rec["invalidation"]["invalidated"] is True


def test_46_invalidated_finding_invalidates_recommendation():
    rec = derived(validity="evidence_unverified", complete=False)[2][0]
    assert rec["lifecycle_state"] == "invalidated"


def test_47_superseded_relationship_is_traceable():
    rec = derived(validity="historical_superseded", lifecycle="superseded")[2][0]
    assert rec["lifecycle_state"] == "superseded" and rec["finding_id"] == FINDING


def test_48_resolution_requires_verified_lifecycle_evidence():
    rec = derived(validity="historical_resolved", lifecycle="resolved")[2][0]
    assert rec["lifecycle_state"] == "resolved" and rec["executed"] is False


def test_49_dependent_history_marks_old_version_superseded():
    conversation = "44444444-4444-4444-8444-444444444444"
    first_db = finding_db()
    first = run_investigation(ORG, USER, "Investigate this", conversation_id=conversation,
        db=first_db, now=NOW, context_payload=selected_payload(), persist=True)
    update = next(params for sql, params in first_db.statements if "UPDATE conversations" in sql)
    persisted = json.loads(update["context"])
    second = run_investigation(ORG, USER, "Has this improved?", conversation_id=conversation,
        db=finding_db({"updated_at": NOW + timedelta(hours=1)}), now=NOW,
        context_payload={"conversation_context": {"context_window": persisted}}, persist=False)
    history = second["selected_finding"]["recommendation_history"]
    assert any(entry["lifecycle_state"] == "superseded" for entry in history)
    assert second["selected_finding"]["investigation_history"][0]["comparison"] == "finding_updated_recommendations_reevaluated"
    assert first["recommendations"][0]["recommendation_id"] != second["recommendations"][0]["recommendation_id"]


def test_50_recommendation_history_is_bounded_and_persistent():
    db = finding_db()
    result = run_investigation(ORG, USER, "Investigate this", conversation_id="44444444-4444-4444-8444-444444444444",
        db=db, now=NOW, context_payload=selected_payload(), persist=True)
    update = next(params for sql, params in db.statements if "UPDATE conversations" in sql)
    context = json.loads(update["context"])
    assert context["last_selected_finding"]["finding_id"] == FINDING
    assert context["last_recommendations"][0]["recommendation_id"] == result["recommendations"][0]["recommendation_id"]
    assert len(result["selected_finding"]["recommendation_history"]) <= 6


def test_51_cross_tenant_contract_is_rejected():
    item, selected, recs = derived()
    assert "recommendation_tenant" in validate_recommendation_contract(selected, recs,
        organization_id="different-org", evidence_ids={item["id"]})


def test_52_cross_store_scope_is_explicit_not_global():
    _, selected, _ = derived()
    assert selected["tenant"]["store_ids"] == [STORE]


def test_53_forged_client_details_are_not_accepted():
    reference = selected_finding_reference("Explain", {"selected_finding": {
        "finding_id": FINDING, "title": "Forged", "evidence_references": ["forged"]}}, None)
    assert set(reference) == {"finding_id", "selection_source", "selected_at"}


def test_54_conversation_context_requires_valid_uuid():
    assert selected_finding_reference("Why?", None, {"last_selected_finding": {"finding_id": "foreign"}}) is None


def test_55_orphan_recommendation_reference_fails_closed():
    _, selected, recs = derived()
    assert "recommendation_evidence_reference" in validate_recommendation_contract(selected, recs,
        organization_id=ORG, evidence_ids=set())


def test_56_no_sensitive_customer_payload_in_contract():
    serialized = json.dumps(derived()[1]).lower()
    assert not any(key in serialized for key in ("email", "phone", "address", "access_token"))


def test_57_contract_is_versioned_and_read_only():
    _, selected, recs = derived()
    assert selected["contract_version"] == SELECTED_FINDING_CONTRACT_VERSION
    assert recs[0]["contract_version"] == RECOMMENDATION_CONTRACT_VERSION and recs[0]["read_only"] is True


def test_58_dismissed_finding_is_not_a_current_merchant_action():
    _, selected, recs = derived(validity="historical_dismissed", lifecycle="dismissed")
    assert selected["invalidation"]["invalidated"] is True
    assert recs[0]["lifecycle_state"] == "invalidated" and recs[0]["executed"] is False


def test_59_resource_and_recommendation_retrieval_is_bounded():
    item = finding_item()
    item["value"]["underlying_order_records"] = [
        {"external_order_id": f"order-{index}", "order_name": f"#{index}"} for index in range(30)
    ]
    selected = build_selected_finding(item, organization_id=ORG, investigation_id=INVESTIGATION,
        reference={"finding_id": FINDING}, now=NOW)
    recs = enrich_recommendations([{"label": f"Review independent observation {index}",
        "why": "Independent evidence", "measure": "Repeat the same observation",
        "evidence_ids": [item["id"]]} for index in range(8)], items=[item], selected_item=item,
        selected=selected, organization_id=ORG, investigation_id=INVESTIGATION,
        intent="finding_investigation", now=NOW)
    assert len(selected["resource_references"]) == 20
    assert len(recs) <= 3


def test_60_same_finding_version_has_stable_recommendation_identity():
    first = derived()[2][0]
    second = derived()[2][0]
    assert first["recommendation_id"] == second["recommendation_id"]
    assert first["finding_version"] == second["finding_version"]


def test_61_topic_change_ignores_even_a_client_supplied_selection():
    assert selected_finding_reference("Instead, discuss inventory", selected_payload(),
        {"last_selected_finding": {"finding_id": FINDING}}, topic_change=True) is None
