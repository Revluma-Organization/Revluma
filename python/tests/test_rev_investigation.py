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


def order_fixture(currency, count, value, **overrides):
    """A per-currency order aggregate row in the exact production SQL shape."""
    amount = value if isinstance(value, Decimal) else Decimal(str(value))
    row = {
        "currency": currency,
        "order_count": count,
        "net_value": amount,
        "gross_value": amount,
        "gross_verified": count,
        "refunded_to_date_value": Decimal("0"),
        "refunded_to_date_verified": count,
        "discount_value": Decimal("0"),
        "discount_verified": count,
        "line_items_value": amount,
        "line_items_verified": count,
        "tax_value": Decimal("0"),
        "tax_verified": count,
        "shipping_value": Decimal("0"),
        "shipping_verified": count,
        "received_value": amount,
        "received_verified": count,
        "outstanding_value": Decimal("0"),
        "outstanding_verified": count,
        "test_order_count": 0,
        "currency_unverified_count": 0,
        "negative_net_count": 0,
    }
    row.update(overrides)
    return row


# The Task 198 revenue aggregate is the only query carrying the test-order
# count; the legacy order_observations query keeps its plain COUNT(*) shape.
REVENUE_AGGREGATE_PATTERN = "AS test_order_count"
LEGACY_ORDER_PATTERN = "COUNT(*) AS order_count"


def workspace_db(*, order_rows=None, cart_rows=None, event_rows=None,
                 line_item_rows=None, fail=(), conversation_rows=None,
                 memory_rows=None):
    db = FakeDB(fail_patterns=tuple(fail))
    db.add("SELECT s.id, s.platform, s.status, s.last_synced_at", store_rows())
    db.add("SELECT id, last_synced_at, status", store_rows())
    db.add("FROM stores s WHERE", store_rows())
    db.add("intelligence_order_coverage", coverage_rows())
    db.add(REVENUE_AGGREGATE_PATTERN, order_rows if order_rows is not None else [
        order_fixture("USD", 3, "30.31"),
        order_fixture("NGN", 1, "1000.00"),
    ])
    db.add(LEGACY_ORDER_PATTERN, [
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
    # ``FakeDB.execute`` returns the FIRST route matching a SQL substring, so a
    # caller that re-adds "FROM order_items oi" afterwards would be silently
    # ignored. Line-item rows are therefore overridable through the fixture.
    db.add("FROM order_items oi", line_item_rows if line_item_rows is not None else [
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
        # The current window always ends at ``now``; the comparison window
        # ends where the current one starts. Keying on ``end`` keeps the
        # fixture correct for any resolved calendar (merchant-timezone)
        # boundaries.
        if params["end"] == NOW:
            return [order_fixture("USD", 3, "30.31"), order_fixture("NGN", 1, "1000.00")]
        return [order_fixture("USD", 6, "60.62"), order_fixture("NGN", 1, "0")]

    db = workspace_db()
    db.routes = [(pattern, order_rows if pattern == REVENUE_AGGREGATE_PATTERN else rows)
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


def test_periods_resolve_on_the_merchant_timezone_not_utc():
    # 2026-11-07T00:30Z is still 19:30 on 2026-11-06 in New York (EST, UTC-5):
    # "yesterday" for that merchant is 2026-11-05, not 2026-11-06.
    now_ny = datetime(2026, 11, 7, 0, 30, tzinfo=timezone.utc)
    window = resolve_reporting_period("How was yesterday?", now_ny,
                                      timezone_name="America/New_York")
    start = datetime.fromisoformat(window["start"].replace("Z", "+00:00"))
    end = datetime.fromisoformat(window["end"].replace("Z", "+00:00"))
    assert start == datetime(2026, 11, 5, 5, 0, tzinfo=timezone.utc)
    assert end == datetime(2026, 11, 6, 5, 0, tzinfo=timezone.utc)
    assert window["timezone"] == "America/New_York"
    assert window["compared_to"]["timezone"] == "America/New_York"

    # The same instant in Lagos (UTC+1) is already 01:30 on the 7th, so
    # "yesterday" is the 6th: local midnights map to 23:00Z the day before.
    window_lagos = resolve_reporting_period("How was yesterday?", now_ny,
                                            timezone_name="Africa/Lagos")
    start_lagos = datetime.fromisoformat(
        window_lagos["start"].replace("Z", "+00:00"))
    end_lagos = datetime.fromisoformat(
        window_lagos["end"].replace("Z", "+00:00"))
    assert start_lagos == datetime(2026, 11, 5, 23, 0, tzinfo=timezone.utc)
    assert end_lagos == datetime(2026, 11, 6, 23, 0, tzinfo=timezone.utc)


def test_calendar_weeks_are_monday_weeks_in_the_merchant_timezone():
    # 2026-11-07 is a Saturday. In New York (UTC-5) it is still Friday the
    # 6th at 19:30, so "this week" starts Monday 2026-11-02 05:00Z.
    now_ny = datetime(2026, 11, 7, 0, 30, tzinfo=timezone.utc)
    window = resolve_reporting_period("What about this week?", now_ny,
                                      timezone_name="America/New_York")
    start = datetime.fromisoformat(window["start"].replace("Z", "+00:00"))
    end = datetime.fromisoformat(window["end"].replace("Z", "+00:00"))
    assert start == datetime(2026, 11, 2, 5, 0, tzinfo=timezone.utc)
    assert end == now_ny
    previous = resolve_reporting_period("How was last week?", now_ny,
                                        timezone_name="America/New_York")
    prev_start = datetime.fromisoformat(previous["start"].replace("Z", "+00:00"))
    prev_end = datetime.fromisoformat(previous["end"].replace("Z", "+00:00"))
    # DST-safe: that local week straddles the US DST transition (2026-11-01),
    # so the boundaries are local midnights — 04:00Z (EDT) then 05:00Z (EST)
    # — not a fixed 7×24h interval.
    assert prev_start == datetime(2026, 10, 26, 4, 0, tzinfo=timezone.utc)
    assert prev_end == datetime(2026, 11, 2, 5, 0, tzinfo=timezone.utc)
    # The comparison of a PARTIAL "this week" is the same local-time interval
    # one week earlier (Monday-to-now vs Monday-to-same-offset), never a full
    # week: that would compare 5.8 days against 7.
    comp_start = datetime.fromisoformat(
        window["compared_to"]["start"].replace("Z", "+00:00"))
    comp_end = datetime.fromisoformat(
        window["compared_to"]["end"].replace("Z", "+00:00"))
    assert comp_end == start
    assert comp_start == start - (end - start)
    # "Last week" is a full week, so its comparison is the full calendar week
    # before it: Monday 2026-10-19 04:00Z (EDT) to Monday 2026-10-26 04:00Z.
    last_comp = previous["compared_to"]
    assert last_comp["start"] == "2026-10-19T04:00:00Z"
    assert last_comp["end"] == "2026-10-26T04:00:00Z"


def test_custom_date_ranges_are_half_open_on_local_midnights():
    now_ny = datetime(2026, 11, 7, 0, 30, tzinfo=timezone.utc)
    window = resolve_reporting_period(
        "Show me revenue from 2026-10-01 to 2026-10-15", now_ny,
        timezone_name="America/New_York")
    start = datetime.fromisoformat(window["start"].replace("Z", "+00:00"))
    end = datetime.fromisoformat(window["end"].replace("Z", "+00:00"))
    # Local midnights in New York: 05:00Z in October (EDT, UTC-4).
    assert start == datetime(2026, 10, 1, 4, 0, tzinfo=timezone.utc)
    assert end == datetime(2026, 10, 16, 4, 0, tzinfo=timezone.utc)
    assert window["semantics"] == "[start, end)"
    # Comparison is the equal-length window immediately before the range.
    comp_end = datetime.fromisoformat(window["compared_to"]["end"].replace("Z", "+00:00"))
    assert comp_end == start
    assert (end - start) == (comp_end - datetime.fromisoformat(
        window["compared_to"]["start"].replace("Z", "+00:00")))


def test_year_over_year_is_flagged_and_not_assumed():
    window = resolve_reporting_period("How does this compare year over year?", NOW)
    assert window["year_over_year"] is True
    assert resolve_reporting_period("Why did revenue fall this week?", NOW)[
        "year_over_year"] is False


def test_invalid_timezone_falls_back_to_utc_instead_of_crashing():
    window = resolve_reporting_period("How was yesterday?", NOW,
                                      timezone_name="Not/A_Zone")
    # The unresolvable name never leaks into the evidence period label.
    assert window["timezone"] == "UTC"
    start = datetime.fromisoformat(window["start"].replace("Z", "+00:00"))
    # Falls back to UTC midnight boundaries.
    assert start == datetime(2026, 10, 31, 0, 0, tzinfo=timezone.utc)


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


# ---------------------------------------------------------------------------
# Streaming reliability: cancellation, session ownership, pool invariant
# ---------------------------------------------------------------------------

def test_stream_requires_a_session_source():
    with pytest.raises(ValueError):
        list(stream_investigation(ORG, USER, "How is my store doing?", now=NOW))


def test_stream_cancellation_stops_before_the_next_expensive_step():
    """Stop/disconnect must abandon the work, not run it to completion."""
    import threading

    cancel = threading.Event()
    cancel.set()
    db = workspace_db()

    events = list(stream_investigation(
        ORG, USER, "Why did my revenue fall this week?", db=db, now=NOW,
        cancel_event=cancel,
    ))
    names = [event["event"] for event in events]

    # The turn is abandoned deliberately: no final answer and no error surfaced
    # to a merchant who is no longer there.
    assert "final" not in names
    assert "error" not in names
    assert names[0] == "accepted"


def test_closing_the_generator_signals_cancellation_to_the_worker():
    """A client disconnect closes the generator; the worker must be told."""
    import threading

    cancel = threading.Event()
    db = workspace_db()
    stream = stream_investigation(
        ORG, USER, "Why did my revenue fall this week?", db=db, now=NOW,
        cancel_event=cancel,
    )

    assert next(stream)["event"] == "accepted"
    assert cancel.is_set() is False

    stream.close()

    assert cancel.is_set() is True


def test_stream_worker_creates_and_closes_its_own_session_on_its_own_thread():
    """A Session is not thread-safe, so it must never cross a thread boundary."""
    import threading

    consumer_thread = threading.get_ident()
    seen: dict = {}
    db = workspace_db()

    class OwnedSession:
        """Delegates to the fake while recording lifecycle thread identity."""

        def __init__(self):
            self._db = db
            self.closed = False

        def __getattr__(self, name):
            return getattr(self._db, name)

        def close(self):
            self.closed = True
            seen["close_thread"] = threading.get_ident()

    def session_factory():
        seen["create_thread"] = threading.get_ident()
        session = OwnedSession()
        seen["session"] = session
        return session

    events = list(stream_investigation(
        ORG, USER, "Why did my revenue fall this week?", now=NOW,
        session_factory=session_factory,
    ))

    assert events[0]["event"] == "accepted"
    assert "create_thread" in seen and "close_thread" in seen
    # Created and closed on the same (worker) thread, which is not the consumer.
    assert seen["create_thread"] == seen["close_thread"]
    assert seen["create_thread"] != consumer_thread
    assert seen["session"].closed is True


def test_no_read_transaction_is_open_at_the_model_provider_boundary(monkeypatch):
    """The pool invariant: never hold a transaction across model generation."""
    db = workspace_db()
    observed: dict = {}

    def _capture(*args, **kwargs):
        observed["in_transaction"] = db.in_transaction()
        return investigation._compose_text.__wrapped__(*args, **kwargs) \
            if hasattr(investigation._compose_text, "__wrapped__") else "captured"

    monkeypatch.setattr(investigation, "_compose_text", _capture)

    run_investigation(ORG, USER, "Why did my revenue fall this week?",
                      db=db, now=NOW, persist=False)

    assert observed["in_transaction"] is False


def test_read_transactions_do_not_accumulate_across_a_full_investigation():
    """Every read in an investigation must hand its connection straight back."""
    db = workspace_db()

    run_investigation(ORG, USER, "Give me an overview of my store performance.",
                      db=db, now=NOW, persist=False)

    assert len(db.statements) > 5
    assert db.in_transaction() is False
