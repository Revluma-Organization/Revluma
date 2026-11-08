"""Task 217 refund evidence and continuity fixtures; no production data."""
from datetime import datetime, timezone
from decimal import Decimal

import pytest

from src.intelligence.evidence import evidence_context
from src.intelligence.finding_evidence import retrieve_finding_evidence
from src.intelligence.finding_prioritization import prioritize_findings
from src.intelligence.recommendations import build_selected_finding, enrich_recommendations
from tests.test_task_202_evidence import DB, ORG, STORE, FINDING, NOW, finding_row


@pytest.fixture(autouse=True)
def authorized_scope():
    with evidence_context(ORG, [STORE]):
        yield


def refund_row(**changes):
    row = finding_row()
    row["type"] = "refund_increase"
    row["title"] = "Verified refund value increased 100%"
    row["description"] = "Successful refund transactions increased between comparable periods."
    row["evidence"].update(source="order_transactions", refund_coverage_complete=True,
        refund_sync_run_id="refund-sync-1", currentRefundTotal=400.0, previousRefundTotal=200.0,
        currentCount=2, previousCount=1)
    row.update(changes)
    return row


def refund_record():
    return {"external_id": "refund-1", "external_order_id": "order-1", "processed_at": NOW,
            "amount": Decimal("200.00"), "currency": "USD", "status": "success"}


def retrieved(row=None):
    db = DB([("FROM intelligence_findings f", [row or refund_row()]),
             ("FROM order_transactions t JOIN intelligence_findings", [refund_record()])])
    return db, retrieve_finding_evidence(ORG, db, now=NOW, finding_reference=FINDING)


def test_refund_evidence_uses_transaction_records_not_order_lifetime_totals():
    db, result = retrieved()
    record = result["items"][0]["value"]
    assert record["supporting_evidence"]["currentRefundTotal"] == 400.0
    assert record["supporting_evidence"]["refund_sync_run_id"] == "refund-sync-1"
    assert record["underlying_refund_records"][0]["external_refund_id"] == "refund-1"
    assert record["underlying_order_records"] == []
    assert any("FROM order_transactions t" in sql for sql, _ in db.calls)
    assert not any("FROM orders o JOIN" in sql for sql, _ in db.calls)


def test_refund_lookup_preserves_authenticated_tenant_scope():
    db, _ = retrieved()
    assert db.calls
    for sql, params in db.calls:
        assert params["org_id"] == ORG
        assert params["finding_id"] == FINDING
        assert "organization_id" in sql


def test_refund_finding_is_current_and_rankable_with_complete_coverage():
    _, result = retrieved()
    priority = prioritize_findings(result["items"], now=NOW)
    assert priority["ranked"][0]["finding_id"] == FINDING
    assert priority["ranked"][0]["measured_order_sample"] is True


def test_refund_selection_preserves_metrics_period_and_source_contract():
    _, result = retrieved()
    item = result["items"][0]
    selected = build_selected_finding(item, organization_id=ORG, investigation_id="investigation-1",
        reference={"finding_id": FINDING, "selection_source": "explicit_selection"}, now=NOW)
    assert selected["metrics"]["currentRefundTotal"] == 400.0
    assert selected["metrics"]["refund_sync_run_id"] == "refund-sync-1"
    assert selected["currency"] == "USD"
    assert selected["invalidation"]["invalidated"] is False


def test_refund_recommendation_is_specific_read_only_and_evidence_bound():
    _, result = retrieved()
    item = result["items"][0]
    selected = build_selected_finding(item, organization_id=ORG, investigation_id="investigation-1",
        reference={"finding_id": FINDING}, now=NOW)
    recommendations = enrich_recommendations([], items=[item], selected_item=item, selected=selected,
        organization_id=ORG, investigation_id="investigation-1", intent="finding_investigation", now=NOW)
    rec = recommendations[0]
    assert "affected orders, products" in rec["step"]
    assert "refund reasons" in rec["step"]
    assert rec["evidence_references"] == [item["id"]]
    assert rec["read_only"] is True and rec["executed"] is False


def test_stale_refund_evidence_is_not_current_priority():
    row = refund_row()
    row["evidence"]["currentEnd"] = "2026-10-01T00:00:00Z"
    _, result = retrieved(row)
    assert result["items"][0]["value"]["current_validity"] == "stale_unreverified"
    assert prioritize_findings(result["items"], now=NOW)["no_valid_findings"] is True


def test_invalidated_refund_recommendation_requires_fresh_evidence():
    row = refund_row(status="resolved")
    _, result = retrieved(row)
    item = result["items"][0]
    selected = build_selected_finding(item, organization_id=ORG, investigation_id="investigation-1",
        reference={"finding_id": FINDING}, now=NOW)
    rec = enrich_recommendations([], items=[item], selected_item=item, selected=selected,
        organization_id=ORG, investigation_id="investigation-1", intent="finding_investigation", now=NOW)[0]
    assert selected["current_validity"] == "historical_resolved"
    assert rec["actionability"] == "prerequisite_required"
    assert rec["executed"] is False


def test_refund_retrieval_failure_preserves_no_record_claim_boundary():
    class FailedDB(DB):
        def execute(self, statement, params):
            if "FROM order_transactions t" in str(statement):
                raise RuntimeError("unavailable")
            return super().execute(statement, params)
    db = FailedDB([("FROM intelligence_findings f", [refund_row()])])
    result = retrieve_finding_evidence(ORG, db, now=NOW, finding_reference=FINDING)
    # safe_query converts backend failure into a named warning; no records are asserted.
    assert result["items"][0]["value"]["underlying_refund_records"] == []
    assert any(w.startswith("finding_refund_evidence_unavailable") for w in result["warnings"])
