import json
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

import src.agents.investigation as investigation
from src.agents.investigation import (
    INTENT_CHECKOUT,
    INTENT_OVERVIEW,
    INTENT_READ_ONLY,
    INTENT_REVENUE,
    classify_investigation,
    resolve_reporting_period,
    run_investigation,
    stream_investigation,
)
from src.agents.base_agent import normalize_specialist_status
from src.agents.tools import ToolAuthorizationError, catalog, run_tool
from tests.rev_fakes import FakeDB

NOW = datetime(2026, 11, 1, 12, tzinfo=timezone.utc)
ORG = "11111111-1111-1111-1111-111111111111"
USER = "22222222-2222-2222-2222-222222222222"
CONV = "33333333-3333-3333-3333-333333333333"


def store_rows():
    return [
        {"id": "store-a1", "platform": "shopify", "status": "active",
         "last_synced_at": NOW - timedelta(minutes=9), "settings_group": "general",
         "settings": {"currency": "USD", "timezone": "Africa/Lagos"}},
        {"id": "store-a2", "platform": "shopify", "status": "connected",
         "last_synced_at": NOW - timedelta(minutes=10), "settings_group": "general",
         "settings": {"currency": "NGN", "timezone": "Africa/Lagos"}},
    ]


def coverage_rows():
    return [
        {"store_id": "store-a1", "coverage_start": NOW - timedelta(days=30),
         "coverage_end": NOW + timedelta(days=1), "certified_at": NOW,
         "customer_lifetime_verified": True, "source": "shopify_verified_history_v1"},
        {"store_id": "store-a2", "coverage_start": NOW - timedelta(days=30),
         "coverage_end": NOW + timedelta(days=1), "certified_at": NOW,
         "customer_lifetime_verified": True, "source": "shopify_verified_history_v1"},
    ]


def workspace_db(*, order_rows=None, cart_rows=None, event_rows=None,
                 fail=(), conversation_rows=None, memory_rows=None):
    db = FakeDB(fail_patterns=tuple(fail))
    db.add("SELECT s.id, s.platform, s.status, s.last_synced_at", store_rows())
    db.add("SELECT id, last_synced_at, status", store_rows())
    db.add("FROM stores s WHERE", store_rows())
    db.add("intelligence_order_coverage", coverage_rows())
    db.add("COUNT(*) AS order_count", order_rows if order_rows is not None else [
        {"currency": "USD", "order_count": 3, "order_value": Decimal("30.31")},
        {"currency": "NGN", "order_count": 1, "order_value": Decimal("1000.00")},
    ])
    db.add("COUNT(DISTINCT o.customer_id)", [
        {"currency": "USD", "ordering_customers": 2, "first_time_customers": 1},
        {"currency": "NGN", "ordering_customers": 1, "first_time_customers": 1},
    ])
    db.add("WITH ranked", cart_rows if cart_rows is not None else [
        {"currency": "USD", "cart_count": 4, "cart_value": Decimal("220.00")},
        {"currency": "NGN", "cart_count": 2, "cart_value": Decimal("50000.00")},
    ])
    db.add("FROM events", event_rows if event_rows is not None else [
        {"event_type": "checkout_started", "event_count": 12},
        {"event_type": "checkout_completed", "event_count": 5},
    ])
    db.add("completed_count", [{"completed_count": 5}])
    db.add("FROM customers c", [])
    db.add("FROM products p", [{"out_of_stock": 1, "low_stock": 2, "tracked_products": 10}])
    db.add("FROM order_items oi", [
        {"product_name": "Trail Jacket", "currency": "USD", "units": 4,
         "line_value": Decimal("260.00")},
    ])
    db.add("FROM intelligence_findings", [])
    db.add("to_regclass", [{"present": None}])
    db.add("FROM business_states", [])
    if conversation_rows is not None:
        db.add("SELECT summary, context_window", conversation_rows)
    if memory_rows is not None:
        db.add("FROM conversation_messages", memory_rows)
    return db


@pytest.fixture(autouse=True)
def no_model(monkeypatch):
    monkeypatch.setenv("REV_NARRATIVE_LLM", "false")
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)


def test_revenue_investigation_is_evidence_backed_and_currency_explicit():
    db = workspace_db()
    result = run_investigation(ORG, USER, "Why did my revenue fall this week?",
                               db=db, now=NOW, persist=False)

    assert result["read_only"] is True
    assert result["response_type"] == "analysis"
    assert result["investigation"]["intent"] == INTENT_REVENUE
    assert result["investigation"]["status"] in ("complete", "partial")
    assert result["evidence"]["validation"]["valid"] is True

    text = result["text"]
    assert "USD 30.31" in text
    assert "NGN 1,000.00" in text
    # Currencies are never combined into one total.
    assert "1,030.31" not in text
    assert "1,000.00 USD" not in text
    # A cause is never asserted.
    assert "not established" in text or "not verified" in text
    assert "## Recommended next steps" in text

    monetary = [item for item in result["evidence"]["items"]
                if item["unit"] == "currency" and item["status"] == "available"]
    assert monetary, "expected available monetary evidence"
    for item in monetary:
        assert item["currency"] in ("USD", "NGN")
        assert item["period"]["start"] and item["period"]["end"]
        assert item["source"] and item["definition"]
        assert item["id"].startswith("ev-")

    assert result["hypotheses"] and result["hypotheses"][0]["verified"] is False
    assert result["unknowns"]
    assert result["recommendations"]
    assert all(rec["executed"] is False for rec in result["recommendations"])


def test_comparison_uses_equal_length_previous_period_per_currency():
    calls = []

    def order_rows(params):
        calls.append(params)
        if params["start"] == (NOW - timedelta(days=7)):
            return [
                {"currency": "USD", "order_count": 3, "order_value": Decimal("30.31")},
                {"currency": "NGN", "order_count": 1, "order_value": Decimal("1000.00")},
            ]
        return [
            {"currency": "USD", "order_count": 6, "order_value": Decimal("60.62")},
            {"currency": "NGN", "order_count": 1, "order_value": Decimal("0")},
        ]

    db = workspace_db()
    db.routes = [(pattern, order_rows if pattern == "COUNT(*) AS order_count" else rows)
                 for pattern, rows in db.routes]
    result = run_investigation(ORG, USER, "Why did my revenue fall this week?",
                               db=db, now=NOW, persist=False)

    comparison = next(item for item in result["evidence"]["items"])
    assert comparison["period"]["start"]
    joined = json.dumps(result["comparison_facts"], default=str)
    assert "moved down 50.0%" in joined
    assert "USD" in joined
    # NGN previous period was zero, so no percentage is invented for it.
    assert "NGN" not in joined.split("moved down 50.0%")[-1]
    assert len(calls) >= 2
    first, second = calls[0], calls[1]
    assert second["end"] == first["start"]
    assert (second["end"] - second["start"]) == (first["end"] - first["start"])


def test_no_store_returns_clarification_without_invented_statistics():
    db = FakeDB()
    db.add("SELECT s.id, s.platform, s.status, s.last_synced_at", [])
    db.add("SELECT id, last_synced_at, status", [])
    db.add("FROM stores s WHERE", [])
    db.add("FROM business_states", [])
    result = run_investigation(ORG, USER, "What can you tell me about my store?",
                               db=db, now=NOW, persist=False)
    assert result["response_type"] == "clarification"
    assert result["investigation"]["status"] == "insufficient_data"
    assert "connect" in result["text"].lower()
    assert not [item for item in result["evidence"]["items"] if item["unit"] == "currency"]
    assert "$" not in result["text"]


def test_read_only_boundary_never_executes_or_claims_execution():
    db = workspace_db()
    for message in ("Change the price of my best seller to 20 dollars",
                    "Refund order 1042 and email the customer",
                    "Launch a discount campaign for abandoned carts"):
        result = run_investigation(ORG, USER, message, db=db, now=NOW, persist=False)
        assert result["response_type"] == "recommendation"
        assert result["investigation"]["intent"] == INTENT_READ_ONLY
        assert result["executed_actions"] == []
        assert "can't execute" in result["text"]
        for phrase in ("I have changed", "I updated", "I sent", "I launched"):
            assert phrase not in result["text"]


def test_follow_up_inherits_investigation_context_and_segment():
    context = {
        "summary": "Revenue investigation for last seven days",
        "context_window": {
            "last_investigation": {
                "intent": INTENT_REVENUE,
                "period": {"start": "2026-10-25T12:00:00Z", "end": "2026-11-01T12:00:00Z",
                           "label": "Last seven days"},
                "status": "complete",
            }
        },
    }
    db = workspace_db(conversation_rows=[context],
                      memory_rows=[{"role": "user", "content": {"text": "Why did revenue fall?"},
                                    "created_at": NOW}])
    result = run_investigation(ORG, USER, "What about mobile customers?",
                               conversation_id=CONV, db=db, now=NOW, persist=False)
    assert result["investigation"]["intent"] == INTENT_REVENUE
    assert result["investigation"]["segment"] == "mobile"
    assert result["investigation"]["context_used"]["followup"] is True
    assert result["investigation"]["context_used"]["previous_investigation"] is True
    assert any("device" in unknown.lower() for unknown in result["unknowns"])


def test_historical_comparison_period_resolution():
    window = resolve_reporting_period("Was this happening last month?", NOW)
    start = datetime.fromisoformat(window["start"].replace("Z", "+00:00"))
    end = datetime.fromisoformat(window["end"].replace("Z", "+00:00"))
    assert (start.year, start.month) == (2026, 10)
    assert (end.year, end.month) == (2026, 11)
    comparison_start = datetime.fromisoformat(
        window["compared_to"]["start"].replace("Z", "+00:00"))
    assert (comparison_start.year, comparison_start.month) == (2026, 9)


def test_partial_results_survive_one_failing_tool():
    db = workspace_db(fail=("WITH ranked",))
    result = run_investigation(ORG, USER, "Why did my revenue fall this week?",
                               db=db, now=NOW, persist=False)
    metrics = {item["metric"] for item in result["evidence"]["items"]}
    assert "recorded_order_value" in metrics
    assert result["investigation"]["status"] == "partial"
    assert any(step["status"] == "failed" for step in result["investigation"]["steps"])
    assert "USD 30.31" in result["text"]


def test_zero_orders_never_becomes_a_currency_zero():
    db = workspace_db(order_rows=[])
    result = run_investigation(ORG, USER, "How much revenue did I make this week?",
                               db=db, now=NOW, persist=False)
    assert "USD 0.00" not in result["text"]
    assert "0 orders" in result["text"] or "0 non-cancelled orders" in result["text"]
    value = next((item for item in result["evidence"]["items"]
                  if item["metric"] == "recorded_order_value"), None)
    if value is not None:
        assert value["status"] in ("unsupported", "unavailable")
        assert value["value"] is None


def test_every_database_parameter_is_organization_scoped():
    db = workspace_db()
    run_investigation(ORG, USER, "Why did my revenue fall this week?",
                      db=db, now=NOW, persist=False)
    assert db.scoped_organizations() == {ORG}
    for sql, params in db.statements:
        if "FROM stores" in sql and "organization_id" in sql:
            assert params.get("org_id") == ORG


def test_streaming_emits_plan_steps_evidence_then_final():
    db = workspace_db()
    events = list(stream_investigation(ORG, USER, "Why did my revenue fall this week?",
                                       db=db, now=NOW))
    names = [event["event"] for event in events]
    assert names[0] == "accepted"
    assert "plan" in names and "step" in names and "evidence" in names
    assert names[-1] in ("final", "error")
    final = events[-1]["data"]
    assert final["read_only"] is True
    assert names.index("plan") < names.index("evidence") < len(names) - 1


def test_checkout_investigation_does_not_invent_abandonment_causes():
    db = workspace_db(event_rows=[])
    result = run_investigation(ORG, USER, "Why are customers abandoning checkout?",
                               db=db, now=NOW, persist=False)
    assert result["investigation"]["intent"] == INTENT_CHECKOUT
    assert any("reason a shopper abandoned" in unknown for unknown in result["unknowns"])
    assert all(hypothesis["verified"] is False for hypothesis in result["hypotheses"])
    assert "payment failure" in json.dumps(result["hypotheses"]).lower()


def test_correction_invalidates_previous_memory_and_asks_for_the_truth():
    db = workspace_db()
    result = run_investigation(ORG, USER, "That's wrong, the revenue didn't fall.",
                               db=db, now=NOW, persist=False)
    assert result["response_type"] == "clarification"
    assert any("merchant_memories" in sql and "is_active = false" in sql
               for sql, _ in db.statements)
    assert "superseded" in result["text"]


def test_capability_answer_states_the_read_only_boundary():
    result = run_investigation(ORG, USER, "What can you do?", db=FakeDB(), now=NOW, persist=False)
    assert result["response_type"] == "capability"
    assert "can't change prices" in result["text"]
    assert result["read_only"] is True


def test_specialist_status_contract_is_enforced():
    assert normalize_specialist_status("success", facts=[{"x": 1}]) == "success"
    assert normalize_specialist_status("success", facts=[], signals=[]) == "partial"
    assert normalize_specialist_status("partial") == "partial"
    assert normalize_specialist_status("no_data") == "no_data"
    assert normalize_specialist_status("error") == "error"
    assert normalize_specialist_status("COMPLETE") == "error"
    assert normalize_specialist_status(None) == "error"


def test_tool_catalog_is_read_only_and_typed():
    tools = catalog()
    assert len(tools) >= 10
    assert {tool["name"] for tool in tools} >= {
        "revenue_observations", "checkout_observations", "customer_observations",
        "product_observations", "data_coverage", "store_health",
    }
    for tool in tools:
        assert tool["read_only"] is True
        assert tool["scope"] == "authenticated_organization"
        assert tool["data_sources"]
    with pytest.raises(ToolAuthorizationError):
        run_tool("revenue_observations", "", FakeDB())
    with pytest.raises(ToolAuthorizationError):
        run_tool("revenue_observations", ORG, FakeDB(), {"start": "2026-10-01T00:00:00Z"})


def test_narrative_validator_rejects_unsupported_numbers_and_execution_claims():
    items = [{"id": "ev-1", "value": "30.31", "currency": "USD", "status": "available"}]
    facts = [{"text": "Recorded order value USD 30.31 across 3 orders"}]
    ok, reason = investigation._validate_narrative(
        "## What I can verify\nRecorded order value was USD 30.31 across 3 orders for the week.", facts, items)
    assert ok, reason
    ok, reason = investigation._validate_narrative(
        "## What I can verify\nRecorded order value was USD 987.65 across 42 orders.", facts, items)
    assert not ok and reason == "unsupported_number"
    ok, reason = investigation._validate_narrative(
        "## Done\nI have changed the price to USD 30.31 and revenue moved 3%.", facts, items)
    assert not ok and reason == "claimed_execution"


def test_persistence_writes_scoped_context_and_verified_memory():
    db = workspace_db()
    result = run_investigation(ORG, USER, "Why did my revenue fall this week?",
                               conversation_id=CONV, db=db, now=NOW, persist=True)
    updates = [(sql, params) for sql, params in db.statements
               if "UPDATE conversations" in sql]
    memories = [(sql, params) for sql, params in db.statements
                if "INSERT INTO merchant_memories" in sql]
    assert updates and updates[0][1]["org_id"] == ORG
    assert updates[0][1]["conversation_id"] == CONV
    context = json.loads(updates[0][1]["context"])
    assert context["last_investigation"]["intent"] == INTENT_REVENUE
    assert memories and memories[0][1]["org_id"] == ORG
    assert result["investigation"]["status"] in ("complete", "partial")
