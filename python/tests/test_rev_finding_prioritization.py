"""Task 206: deterministic finding prioritization — method, gates, ties,
explanations and challenges. Synthetic fixtures, labelled as such."""
from datetime import datetime, timedelta, timezone

from src.intelligence.finding_prioritization import (
    PRIORITY_METHOD_VERSION,
    compare_priority,
    explain_priority,
    prioritize_findings,
)

NOW = datetime(2026, 11, 7, 12, tzinfo=timezone.utc)


def item(finding_id, *, title="Finding", severity="high", validity="current_evidence_verified",
         lifecycle="open", freshness="fresh", current_end="2026-11-07T00:00:00Z",
         type="revenue_drop", currency="USD", current_count=2, previous_count=4,
         current_revenue=20, previous_revenue=80, orders=1, updated_age_h=1,
         coverage_run="run-1", store="store-a", with_action=True, dedupe_key=None):
    record = {
        "finding_id": finding_id, "store_id": store, "type": type, "title": title,
        "dedupe_key": dedupe_key,
        "description": "Stored detection", "severity": severity,
        "lifecycle_status": lifecycle, "current_validity": validity,
        "detected_at": (NOW - timedelta(hours=24)).isoformat(),
        "updated_at": (NOW - timedelta(hours=updated_age_h)).isoformat(),
        "supporting_evidence": {
            "verified": validity == "current_evidence_verified",
            "complete": validity == "current_evidence_verified",
            "currency": currency, "currentCount": current_count,
            "previousCount": previous_count, "currentRevenue": current_revenue,
            "previousRevenue": previous_revenue,
            "currentStart": "2026-11-06T00:00:00Z", "currentEnd": current_end,
            "previousStart": "2026-11-05T00:00:00Z", "previousEnd": "2026-11-06T00:00:00Z",
            "coverage_source": "order_coverage", "coverage_run_id": coverage_run,
        },
        "recommendation_context": ({"type": "inspect", "description": "Inspect the channel mix"}
                                   if with_action else {}),
        "underlying_order_records": ([{"external_order_id": f"o-{finding_id}"}] * orders
                                     if orders else []),
    }
    return {"metric": "finding_evidence", "id": f"ev-{finding_id}", "value": record,
            "status": "available" if validity == "current_evidence_verified" else "partial",
            "freshness": {"state": freshness}}


def test_method_version_is_stable():
    assert PRIORITY_METHOD_VERSION == "finding-priority-v1"
    assert prioritize_findings([])["method_version"] == PRIORITY_METHOD_VERSION


def test_only_current_verified_open_findings_are_rankable():
    items = [
        item("f-open", lifecycle="open"),
        item("f-ack", lifecycle="acknowledged", updated_age_h=3),
        item("f-resolved", validity="historical_resolved", lifecycle="resolved"),
        item("f-dismissed", validity="historical_dismissed", lifecycle="dismissed"),
        item("f-stale", validity="stale_unreverified", freshness="stale"),
        item("f-unverified", validity="evidence_unverified",
             current_count=None, previous_count=None,
             current_revenue=None, previous_revenue=None, orders=0),
    ]
    result = prioritize_findings(items, now=NOW)
    assert [entry["finding_id"] for entry in result["ranked"]] == ["f-open", "f-ack"]
    excluded = {entry["finding_id"]: entry["reason"] for entry in result["excluded"]}
    assert excluded["f-resolved"] == "historical_resolved"
    assert excluded["f-dismissed"] == "historical_dismissed"
    assert excluded["f-stale"] == "stale_unreverified"
    assert excluded["f-unverified"] == "evidence_unverified"
    assert result["no_valid_findings"] is False


def test_ranking_uses_recorded_severity_then_freshness_then_sample():
    items = [
        item("f-low", severity="low", freshness="fresh"),
        item("f-high-stale-fresh", severity="high", freshness="aging"),
        item("f-high-fresh", severity="high", freshness="fresh"),
        item("f-medium-fresh", severity="medium", freshness="fresh"),
    ]
    ranked = [entry["finding_id"] for entry in
              prioritize_findings(items, now=NOW)["ranked"]]
    assert ranked == ["f-high-fresh", "f-high-stale-fresh", "f-medium-fresh", "f-low"]


def test_missing_severity_ranks_below_recorded_severity_and_is_visible():
    items = [
        item("f-nosev", severity=None, freshness="fresh"),
        item("f-low", severity="low", freshness="stale"),
    ]
    result = prioritize_findings(items, now=NOW)
    assert [entry["finding_id"] for entry in result["ranked"]] == ["f-low", "f-nosev"]
    assert result["ranked"][1]["severity"] is None
    assert result["ranked"][1]["severity_recorded"] is False
    assert "no recorded severity" in " ".join(result["ranked"][1]["reasons"])


def test_duplicates_group_on_the_recorded_dedupe_key():
    items = [
        item("f-dup-old", title="Same issue", dedupe_key="dup-1", updated_age_h=5),
        item("f-dup-new", title="Same issue", dedupe_key="dup-1", updated_age_h=1),
        item("f-other", title="Other issue", type="checkout_failure"),
    ]
    result = prioritize_findings(items, now=NOW)
    assert len(result["ranked"]) == 2
    representative = next(entry for entry in result["ranked"]
                          if entry["finding_id"] == "f-dup-new")
    assert [duplicate["finding_id"] for duplicate in representative["duplicates"]] == ["f-dup-old"]


def test_same_type_same_window_without_dedupe_key_are_not_grouped():
    items = [
        item("f-one", title="First revenue drop"),
        item("f-two", title="Second revenue drop"),
    ]
    result = prioritize_findings(items, now=NOW)
    assert len(result["ranked"]) == 2, "no dedupe key must never imply duplication"
    assert all(not entry["duplicates"] for entry in result["ranked"])


def test_tie_is_explained_not_manufactured():
    items = [
        item("f-a", title="Alpha issue", updated_age_h=1),
        item("f-b", title="Beta issue", updated_age_h=1),
    ]
    result = prioritize_findings(items, now=NOW)
    assert result["tie"] is not None
    assert set(result["tie"]["finding_ids"]) == {"f-a", "f-b"}
    assert "tie-break" in result["tie"]["statement"]
    explanation = explain_priority(result, items)
    assert "tie-break" in explanation["why_ranks_ahead"]


def test_explanation_uses_only_recorded_fields():
    items = [
        item("f-top", title="Revenue fell", severity="critical",
             current_count=2, previous_count=4, current_revenue=20, previous_revenue=80),
        item("f-second", title="Checkout failures", severity="medium",
             type="checkout_failure", current_end="2026-11-06T00:00:00Z"),
    ]
    result = prioritize_findings(items, now=NOW)
    explanation = explain_priority(result, items)
    assert explanation["finding_id"] == "f-top"
    assert "4 orders" in explanation["observed"] and "2 orders" in explanation["observed"]
    assert "USD 80.00" in explanation["observed"] and "USD 20.00" in explanation["observed"]
    assert "run-1" in explanation["evidence"]
    assert "critical" in explanation["why_ranks_ahead"] and "medium" in explanation["why_ranks_ahead"]
    assert "does not prove" in explanation["uncertain"]
    assert "Inspect the channel mix" in explanation["next_step"]
    # No invented impact figure beyond the recorded evidence values.
    for phrase in ("recovered", "recoverable", "lost revenue", "will earn"):
        assert phrase not in explanation["observed"].lower()


def test_explanation_is_none_without_valid_findings():
    assert explain_priority(prioritize_findings([], now=NOW), []) is None
    assert explain_priority(prioritize_findings([item("f", validity="stale_unreverified")],
                                                now=NOW), []) is None


def test_no_valid_findings_distinguishes_the_three_states():
    # Verified healthy: retrieval returned zero open findings.
    assert prioritize_findings([], now=NOW)["no_valid_findings_reason"] == \
        "verified_no_open_findings"
    # Only history: findings exist but are all resolved.
    result = prioritize_findings([item("f", validity="historical_resolved",
                                       lifecycle="resolved")], now=NOW)
    assert result["no_valid_findings"] is True
    assert result["no_valid_findings_reason"] == "only_historical_findings"
    # Stale: needs re-verification, named explicitly.
    result = prioritize_findings([item("f", validity="stale_unreverified")], now=NOW)
    assert result["no_valid_findings_reason"] == "stale_findings_require_reverification"
    # Unverified source evidence.
    result = prioritize_findings(
        [item("f", validity="evidence_unverified", current_count=None,
              previous_count=None, current_revenue=None, previous_revenue=None, orders=0)],
        now=NOW)
    assert result["no_valid_findings_reason"] == "evidence_unverified"


def test_malformed_records_are_excluded_not_dropped_silently():
    result = prioritize_findings([
        "not-a-dict",
        {"metric": "other_metric", "value": {}},
        {"metric": "finding_evidence", "value": "not-a-dict"},
        item("f-ok"),
    ], now=NOW)
    assert result["excluded"] == [{"finding_id": None, "title": None, "reason": "malformed_record"}
                                  for _ in range(3)]
    assert [entry["finding_id"] for entry in result["ranked"]] == ["f-ok"]


def test_challenge_explains_the_ranking_criteria():
    items = [
        item("f-top", title="Refund spike", type="refund_increase", severity="high"),
        item("f-mid", title="Checkout failures", type="checkout_failure", severity="medium",
             current_end="2026-11-06T00:00:00Z"),
    ]
    result = prioritize_findings(items, now=NOW)
    comparison = compare_priority(result, items,
                                  "Why is the refund issue more important than checkout?")
    assert comparison["matched"] is True
    assert comparison["referenced"]["finding_id"] == "f-top"
    assert "rank" in comparison["statement"]
    assert comparison["ranking_changed"] is False


def test_challenge_against_an_invalidated_finding_explains_the_change():
    items = [
        item("f-top", title="Inventory constraint", type="inventory", severity="high"),
        item("f-stale", title="Refund spike", type="refund_increase",
             validity="stale_unreverified", freshness="stale"),
    ]
    result = prioritize_findings(items, now=NOW)
    comparison = compare_priority(result, items,
                                  "Why is that more important than the refund issue?")
    assert comparison["matched"] is True
    assert comparison["referenced"]["reason"] == "stale_unreverified"
    assert "not in the current ranking" in comparison["statement"]
    assert "re-verified" in comparison["statement"]
    assert comparison["ranking_changed"] is False


def test_challenge_with_unmatchable_reference_refuses_to_rank_against_air():
    items = [item("f-top", title="Inventory constraint", type="inventory")]
    result = prioritize_findings(items, now=NOW)
    comparison = compare_priority(result, items, "Why is that more important than the tax issue?")
    assert comparison is not None and comparison["matched"] is False
    assert comparison["reason"] == "no_recorded_finding_matches"


def test_challenge_by_explicit_finding_id():
    items = [
        item("11111111-1111-1111-1111-111111111111", title="A", severity="high"),
        item("22222222-2222-2222-2222-222222222222", title="B", severity="medium",
             current_end="2026-11-06T00:00:00Z"),
    ]
    result = prioritize_findings(items, now=NOW)
    comparison = compare_priority(
        result, items,
        "Why is 22222222-2222-2222-2222-222222222222 more important than the other?")
    assert comparison["matched"] is True
    assert comparison["referenced"]["finding_id"] == "22222222-2222-2222-2222-222222222222"


def test_no_fabricated_priority_score_or_money():
    result = prioritize_findings([item("f")], now=NOW)
    blob = repr(result)
    for phrase in ("score=", "priority_score", "impact_usd", "recoverable"):
        assert phrase not in blob.lower()
