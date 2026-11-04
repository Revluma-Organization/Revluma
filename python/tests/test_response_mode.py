"""Presentation-mode selection is deterministic and guard-first.

The mode travels with the final payload so the frontend presents what the
evidence supports (REV-CONVERSATION-EXPERIENCE-SPEC v1.0.0 section 2). These
tests pin the guard precedence: missing evidence beats a flattering layout,
and connection-only checks never render as a full investigation.
"""
from src.agents.investigation import select_response_mode


def available(count=1):
    return [{"status": "available", "metric": f"m{i}"} for i in range(count)]


def test_conversational_intents_never_render_as_reports():
    for intent in ("greeting", "identity", "capability", "general", "read_only_boundary"):
        mode, reason = select_response_mode(
            intent=intent, status="complete", tool_names=[], evidence_items=available(),
            comparison_facts=[], hypotheses=[])
        assert mode == "conversational"
        assert reason


def test_missing_verified_evidence_wins_over_every_layout():
    mode, _ = select_response_mode(
        intent="revenue_investigation", status="insufficient_data",
        tool_names=["revenue_observations"], evidence_items=[],
        comparison_facts=[{"text": "x"}], hypotheses=[])
    assert mode == "insufficient_evidence"
    mode, _ = select_response_mode(
        intent="revenue_investigation", status="partial",
        tool_names=["revenue_observations"],
        evidence_items=[{"status": "unavailable", "metric": "m"}],
        comparison_facts=[], hypotheses=[])
    assert mode == "insufficient_evidence"


def test_comparison_facts_select_comparison_mode():
    mode, _ = select_response_mode(
        intent="revenue_investigation", status="complete",
        tool_names=["revenue_observations"], evidence_items=available(2),
        comparison_facts=[{"text": "change"}], hypotheses=[])
    assert mode == "comparison"


def test_connection_only_checks_select_quick_verification():
    mode, _ = select_response_mode(
        intent="data_coverage", status="complete",
        tool_names=["store_health", "data_coverage"], evidence_items=available(),
        comparison_facts=[], hypotheses=[])
    assert mode == "quick_verification"
    # Any additional tool escapes the quick-verification guard.
    mode, _ = select_response_mode(
        intent="data_coverage", status="complete",
        tool_names=["store_health", "order_observations"], evidence_items=available(),
        comparison_facts=[], hypotheses=[])
    assert mode != "quick_verification"


def test_single_supported_observation_is_an_insight():
    mode, _ = select_response_mode(
        intent="store_overview", status="complete",
        tool_names=["order_observations"], evidence_items=available(2),
        comparison_facts=[], hypotheses=[])
    assert mode == "insight"


def test_multi_check_diagnostics_remain_investigations():
    mode, reason = select_response_mode(
        intent="revenue_investigation", status="complete",
        tool_names=["revenue_observations", "refund_observations", "order_observations"],
        evidence_items=available(4), comparison_facts=[], hypotheses=[])
    assert mode == "investigation"
    assert reason
    mode, _ = select_response_mode(
        intent="store_overview", status="complete",
        tool_names=["order_observations"], evidence_items=available(2),
        comparison_facts=[], hypotheses=[{"statement": "maybe"}])
    assert mode == "investigation"
