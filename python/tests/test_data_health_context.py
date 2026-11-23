"""Shared data health (Node dataHealth.js) → Rev disclosure."""
from src.intelligence.data_health_context import (
    capabilities_for_domains,
    objective_summary,
    parse_data_health,
    relevant_limitations,
)

STORE = "3ed79446-cb6d-4a1c-b174-9ec1ab91fe15"


def _context(lines):
    return {"schema_version": "rev-merchant-context-v3", "organization_id": "org", "data_health": lines}


PRODUCTION_LIKE = _context([
    f"health | {STORE} | healthy_with_limitations | complete | 2026-11-21T00:09:32.319Z",
    f"complete | {STORE} | orders,refunds,transactions,products,variants,abandoned_checkouts,inventory",
    f"resource | {STORE} | shop.policies | store_policies | unauthorized | permission_not_granted:read_legal_policies | never",
    f"resource | {STORE} | content.redirects | url_redirects | unauthorized | permission_not_granted:read_online_store_navigation | never",
    f"resource | {STORE} | online-store.menus | navigation_menus | unsupported | not_offered_by_shopify | never",
    f"resource | {STORE} | customer_journeys | customers | unsupported | not_collected_by_revluma | never",
])


def test_parses_all_line_kinds():
    parsed = parse_data_health(PRODUCTION_LIKE)
    assert parsed["available"] is True
    assert parsed["stores"][0]["overall"] == "healthy_with_limitations"
    assert "orders" in parsed["complete"][STORE]
    policies = next(r for r in parsed["resources"] if r["resource"] == "shop.policies")
    assert policies["missing_scopes"] == ["read_legal_policies"]
    assert policies["last_success"] is None


def test_revenue_question_does_not_mention_unrelated_permission_gaps():
    parsed = parse_data_health(PRODUCTION_LIKE)
    assert relevant_limitations(parsed, capabilities_for_domains(["orders", "integration"])) == []


def test_question_needing_a_gap_discloses_it_specifically():
    parsed = parse_data_health(PRODUCTION_LIKE)
    sentences = relevant_limitations(parsed, {"url_redirects"})
    assert sentences == ["Shopify content redirects data is excluded: the store has not granted the "
                         "read_online_store_navigation permission."]


def test_stale_core_data_is_disclosed_with_its_timestamp():
    parsed = parse_data_health(_context([
        f"health | {STORE} | recovering | stale | 2026-11-20T00:00:00.000Z",
        f"resource | {STORE} | orders | orders | stale | latest_refresh_failed | 2026-11-20T00:00:00.000Z",
    ]))
    sentences = relevant_limitations(parsed, capabilities_for_domains(["refunds"]))
    assert sentences == ["Shopify orders data was last refreshed at 2026-11-20T00:00:00.000Z; "
                         "more recent activity may be missing."]


def test_syncing_store_discloses_incompleteness_for_core_questions_only():
    parsed = parse_data_health(_context([f"health | {STORE} | syncing | incomplete | never"]))
    assert relevant_limitations(parsed, {"orders"}) == [
        "Revluma is still synchronizing this store; figures may be incomplete until it finishes."]
    assert relevant_limitations(parsed, {"store_policies"}) == []


def test_untrusted_or_malformed_lines_are_dropped_not_guessed():
    parsed = parse_data_health(_context([
        "health | x | made_up_state | complete | never",
        f"resource | {STORE} | orders | orders | great | synced | never",
        "resource | <script> | orders | orders | stale | x | never",
        42,
        f"resource | {STORE} | orders | orders | stale | x:drop table;+read_orders | never",
    ]))
    assert parsed["available"] is False
    assert len(parsed["resources"]) == 1
    assert parsed["resources"][0]["missing_scopes"] == ["read_orders"]


def test_missing_health_is_reported_as_not_evaluated():
    assert objective_summary(parse_data_health(None))["status"] == "not_evaluated"
    assert objective_summary(parse_data_health({"data_health": []}))["status"] == "not_evaluated"
    summary = objective_summary(parse_data_health(PRODUCTION_LIKE))
    assert summary["stores"][0]["core_state"] == "complete"
    assert "unauthorized" in summary["not_complete"]
