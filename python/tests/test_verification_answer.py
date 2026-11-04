"""Binding acceptance transcripts A/B for connection & coverage questions.

Production complaint (2026-11-04): "Hey Rev, is my store connected?" returned a
coverage-certification report — machine count facts ("1 connected store(s)"), a
duplicated claim, a recommendation contradicting its own evidence, internal
notation ("half-open", "[start, end)", microsecond timestamps, "Coverage
status: partial"), robotic filler sections and a nonsensical compare chip.
These tests pin the corrected contract: a direct prose verdict, connection /
sync / coverage kept distinct (P6), and merchant language only (§8).
"""
from src.agents.investigation import (
    INTENT_COVERAGE,
    INTENT_OVERVIEW,
    _compose_text,
    _facts_from_items,
    _follow_ups,
    _verification_answer,
)
from src.intelligence.evidence import STATUS_AVAILABLE

WINDOW = {"start": "2026-10-28T00:00:00Z", "end": "2026-11-04T00:00:00Z"}

INTERNAL_TERMS = [
    "half-open", "[start", "store(s)", "finding(s)", "coverage status",
    "evidence item(s)", "tool", "endpoint", "sql",
]


def metric(name: str, value, status: str = STATUS_AVAILABLE) -> dict:
    return {"id": name, "metric": name, "label": name, "value": value,
            "unit": "count", "currency": None, "status": status,
            "period": {"start": WINDOW["start"], "end": WINDOW["end"]},
            "source": "store_health", "definition": name}


def scan(text: str) -> None:
    lowered = text.lower()
    for term in INTERNAL_TERMS:
        assert term not in lowered, f"internal term {term!r} leaked into: {text!r}"


def test_connected_synced_certified_is_transcript_a():
    text, recommendations = _verification_answer(
        items=[metric("connected_store_count", 1), metric("stores_with_sync", 1),
               metric("certified_store_count", 1)],
        window=WINDOW,
    )
    assert text.startswith("Yes — your Shopify store is connected.")
    assert "The latest sync completed successfully." in text
    assert "Order coverage is certified" in text
    assert recommendations == []
    scan(text)


def test_connected_synced_not_certified_keeps_connection_and_coverage_distinct():
    text, recommendations = _verification_answer(
        items=[metric("connected_store_count", 1), metric("stores_with_sync", 1),
               metric("certified_store_count", 0)],
        window=WINDOW,
    )
    assert text.startswith("Yes — your Shopify store is connected.")
    assert "The latest sync completed successfully." in text
    # P6: connected + synced is never presented as certified coverage.
    assert "not certified" in text
    assert "won't quote financial totals" in text
    # The recommendation must not contradict the evidence: the sync completed.
    assert [rec["label"] for rec in recommendations] == [
        "Review why no orders were recorded for this window"]
    assert "Complete the initial Shopify sync" not in text
    scan(text)


def test_connected_without_sync_says_what_is_missing_and_what_to_do():
    text, recommendations = _verification_answer(
        items=[metric("connected_store_count", 1), metric("stores_with_sync", 0),
               metric("certified_store_count", 0)],
        window=WINDOW,
    )
    assert "connected" in text and "initial sync has not completed" in text
    assert [rec["label"] for rec in recommendations] == ["Complete the initial Shopify sync"]
    scan(text)


def test_failed_lookup_is_transcript_b_not_a_disconnected_store():
    # No usable store_health record: the check failed — that is not evidence of
    # disconnection and must not be presented as one.
    text, recommendations = _verification_answer(
        items=[metric("connected_store_count", None, status="unavailable")],
        window=WINDOW,
    )
    assert "can't verify the connection right now" in text
    assert "doesn't necessarily mean your store is disconnected" in text
    assert "Integrations page" in text
    assert recommendations == []
    scan(text)


def test_no_connected_store_does_not_invent_figures():
    text, recommendations = _verification_answer(
        items=[metric("connected_store_count", 0)], window=WINDOW,
    )
    assert "no connected Shopify store" in text
    assert "won't invent store figures" in text
    assert recommendations and recommendations[0]["label"] == "Complete the initial Shopify sync"
    scan(text)


def test_multi_store_wording_is_human():
    text, _ = _verification_answer(
        items=[metric("connected_store_count", 2), metric("stores_with_sync", 2),
               metric("certified_store_count", 2)],
        window=WINDOW,
    )
    assert "2 Shopify stores are connected." in text
    assert "2 stores completed a sync." in text
    scan(text)


def test_unknown_sync_status_is_stated_not_guessed():
    text, recommendations = _verification_answer(
        items=[metric("connected_store_count", 1)], window=WINDOW,
    )
    assert "could not verify the sync status" in text
    assert recommendations == []
    scan(text)


def test_fact_builders_are_human_and_deduplicated():
    items = [metric("connected_store_count", 1), metric("stores_with_sync", 1),
             metric("certified_store_count", 0), metric("open_finding_count", 1)]
    facts = _facts_from_items(items, INTENT_COVERAGE)
    texts = [fact["text"] for fact in facts]
    assert "Your Shopify store is connected." in texts
    assert "The latest sync completed." in texts
    assert "No store certifies order coverage for this window." in texts
    assert "One verified operational finding is open." in texts
    # The certified-coverage fact appears exactly once (was duplicated).
    assert sum("certif" in text for text in texts) == 1
    for text in texts:
        scan(text)


def test_coverage_questions_get_no_comparison_chip():
    chips = _follow_ups(
        INTENT_COVERAGE, {**WINDOW, "compared_to": {"start": "2026-10-21T00:00:00Z",
                                                    "end": "2026-10-28T00:00:00Z"}},
        None, evidence_items=[metric("connected_store_count", 1)],
        unknowns=[], comparison_facts=[],
    )
    assert "Can you compare this with the previous period?" not in chips


def test_composed_provenance_is_merchant_language():
    text = _compose_text(
        intent=INTENT_OVERVIEW, label="Store overview", window=WINDOW,
        facts=[{"text": "Twelve orders recorded.", "evidence_ids": []}],
        comparison_facts=[], hypotheses=[], unknowns=[], recommendations=[],
        skipped=[], store_context={}, overall_status="partial",
    )
    assert "## Data provenance" in text
    assert "28 Oct to 04 Nov 2026 (7 days, UTC)" in text
    assert "Some checks could not complete" in text
    assert "half-open" not in text
    assert "Coverage status:" not in text
    assert WINDOW["start"] not in text  # raw ISO timestamps are not merchant copy
    scan(text.split("## Data provenance")[1])
