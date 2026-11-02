from src.agents.investigation import INTENT_REVENUE, _follow_ups


def test_followups_are_grounded_in_available_evidence():
    suggestions = _follow_ups(
        INTENT_REVENUE,
        {"compared_to": {"label": "Previous period"}},
        None,
        evidence_items=[
            {"metric": "recorded_order_value", "status": "available"},
            {"metric": "refund_amount", "status": "available"},
        ],
        unknowns=[],
        comparison_facts=[{"text": "Recorded order value changed."}],
    )

    assert suggestions[0] == "Which verified metric changed the most against the previous period?"
    assert "How did recorded refunds contribute to this change?" in suggestions
    assert "What about mobile customers?" not in suggestions
    assert len(suggestions) <= 3


def test_followups_do_not_invent_product_or_customer_segments():
    suggestions = _follow_ups(
        INTENT_REVENUE,
        {},
        None,
        evidence_items=[{"metric": "recorded_order_value", "status": "available"}],
        unknowns=[],
        comparison_facts=[],
    )

    assert "Which products contributed most to recorded sales?" not in suggestions
    assert "What about returning customers?" not in suggestions
