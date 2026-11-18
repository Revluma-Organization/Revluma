"""Authoritative-runtime acceptance tests through the merchant ``/rev/stream`` route.

PROVIDER-MOCKED. Every test here runs the real FastAPI route, the real
investigation pipeline, the real agent runtime and gateways, the real tools
against the database double, real evidence validation, telemetry and
persistence. Only the AI provider's HTTP endpoint is synthetic
(``tests.rev_provider_fakes.FakeGemini``, Gemini wire format). Scripted model
turns read the actual tool results they receive and cite them, so the answers
depend on what the tools really returned.

These tests prove runtime contracts. They are NOT live-provider or production
evidence: live verification is reported separately (and is blocked) in
docs/mvp-execution/validation/REV-UNIFIED-AGENT-PRODUCTION-ACCEPTANCE.md.

Coverage (requirement 4):
  A1 general knowledge          A2 ecommerce knowledge     A3 Revluma documentation
  A4 Shopify documentation      A5 current Shopify research
  A6 revenue                    A7 refunds                 A8 products
  A9 missing data is not zero   A10 insufficient evidence -> clarification
  A11 follow-up keeps scope     A12 unrelated question does not inherit scope
  A13 context restored after refresh (database only)
"""
from __future__ import annotations

import json
import re
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from src.serving import api
from tests.rev_provider_fakes import FakeGemini, parse_sse, understanding
from tests.test_rev_investigation import CONV, ORG, USER, order_fixture, workspace_db

pytestmark = pytest.mark.provider_mocked

PRIVATE_MARKER = "PRIVATE ORDER 12345 owner@example.com"


async def _allow_internal_caller():
    return None


@pytest.fixture
def provider(monkeypatch):
    monkeypatch.setitem(api.app.dependency_overrides, api.verify_internal_caller, _allow_internal_caller)
    return FakeGemini().install(monkeypatch)


def _stream(monkeypatch, message, *, db_factory=workspace_db, context_payload=None):
    sessions = []

    def session():
        db = db_factory()
        sessions.append(db)
        return db

    monkeypatch.setattr(api, "_Session", session)
    payload = {"contract_version": "1.0", "organization_id": ORG, "user_id": USER,
               "conversation_id": CONV, "message": message}
    if context_payload is not None:
        payload["context_payload"] = context_payload
    response = TestClient(api.app).post("/rev/stream", json=payload)
    assert response.status_code == 200
    events = parse_sse(response.text)
    assert events[-1][0] == "final", [name for name, _ in events]
    return events[-1][1], events, sessions


def _objective(view) -> dict:
    text = view["first_user_text"]
    return json.loads(text.split("\n", 1)[1].rsplit("\n\n", 1)[0])


def _purposes(final) -> list[str]:
    return [call["purpose"] for call in final["execution_trace"]["telemetry"]["model_calls"]]


def _assert_telemetry_is_content_free(final, *needles):
    blob = json.dumps(final["execution_trace"]["telemetry"])
    for needle in needles:
        assert needle.lower() not in blob.lower(), needle


def _knowledge_reading(message):
    return understanding("knowledge", mode="explanation")


# ---------------------------------------------------------------------------
# Knowledge
# ---------------------------------------------------------------------------

def test_a1_general_knowledge_is_answered_by_the_agent_and_labelled_as_unretrieved(monkeypatch, provider):
    provider.understand = _knowledge_reading
    seen = {}

    def answer(view):
        seen["tools"] = view["tools"]
        seen["objective"] = _objective(view)
        return [provider.call("finish_answer", {
            "answer_markdown": "The median is the middle value of a sorted list, so a few very large orders "
                               "move it far less than they move the mean.",
            "cited_evidence_ids": [], "evidence_sufficiency": "sufficient"})]

    provider.agent_turns = [answer]
    message = "Explain the difference between a mean and a median."
    final, _, _ = _stream(monkeypatch, message)

    assert final["success"] is True and final["read_only"] is True
    assert final["text"].startswith("The median is the middle value")
    # No corpus exists for general knowledge: no source tool, honest label.
    assert seen["tools"] == ["finish_answer", "request_clarification"]
    assert seen["objective"]["knowledge_sources"]["ecommerce_knowledge"]["status"] == "unavailable"
    assert "no ecommerce reference library was searched" in final["text"]
    assert final["execution_trace"]["agent"]["model_directed"] is True
    assert final["execution_trace"]["knowledge_sources"]["manifest"] == {"ecommerce_knowledge": "unavailable"}
    # A context-free definition is settled without an understanding call.
    assert _purposes(final) == ["agent_turn"]
    assert provider.kinds() == ["agent_turn"]
    _assert_telemetry_is_content_free(final, message, "median")


def test_a1b_off_domain_trivia_keeps_the_existing_scope_and_spends_no_agent_turn(monkeypatch, provider):
    provider.understand = _knowledge_reading
    final, _, _ = _stream(monkeypatch, "Who won the 1998 football World Cup?")

    assert "outside Revluma's store-evidence and commerce-operations scope" in final["text"]
    assert "agent_turn" not in provider.kinds() and "web_search" not in provider.kinds()


def test_a2_ecommerce_knowledge_uses_one_model_call_and_no_store_or_web_tools(monkeypatch, provider):
    provider.understand = _knowledge_reading
    provider.agent_turns = [lambda view: [provider.call("finish_answer", {
        "answer_markdown": "Average order value is recorded order value divided by the number of orders in "
                           "the same period and currency. Raise it with bundles or free-shipping thresholds.",
        "cited_evidence_ids": [], "evidence_sufficiency": "sufficient"})]]
    final, _, sessions = _stream(monkeypatch, "What is average order value and how can merchants raise it?")

    assert final["text"].startswith("Average order value is recorded order value")
    assert final["investigation"]["tools_used"] == []
    assert final["evidence"]["items"] == []
    assert provider.kinds() == ["agent_turn"]  # no understanding, composer, or search call
    # Knowledge turns touch no merchant evidence tables.
    statements = " ".join(sql for sql, _ in sessions[0].statements)
    assert "AS test_order_count" not in statements and "FROM order_items" not in statements
    telemetry = final["execution_trace"]["telemetry"]
    assert telemetry["final_status"] == "completed"
    assert telemetry["token_usage"]["scope"] == "all_model_calls"
    assert telemetry["token_usage"]["input"] == 800 and telemetry["token_usage"]["output"] == 60


def test_a3_revluma_documentation_is_retrieved_from_the_runtime_registry_and_cited(monkeypatch, provider):
    provider.understand = _knowledge_reading
    cited = {}

    def search(view):
        assert "search_revluma_docs" in view["tools"]
        assert "search_shopify_docs" not in view["tools"] and "web_research" not in view["tools"]
        return [provider.call("search_revluma_docs", {"query": "refund rate definition"})]

    def finish(view):
        documents = view["results"]["search_revluma_docs"][0]["documents"]
        refund = next(document for document in documents if document["title"] == "Metric definition: Refund rate")
        cited["text"] = refund["text"]
        return [provider.call("finish_answer", {
            "answer_markdown": "Revluma measures refund rate as refunded order value divided by gross recorded "
                               "order value for the same window and currency.",
            "cited_evidence_ids": [refund["id"]], "evidence_sufficiency": "sufficient"})]

    provider.agent_turns = [search, finish]
    final, _, _ = _stream(monkeypatch, "How does Revluma define refund rate?")

    assert "SUM(COALESCE(refunded_total,0))" in cited["text"]  # the real registry formula reached the model
    assert "**Revluma documentation**\n- Metric definition: Refund rate" in final["text"]
    sources = final["execution_trace"]["knowledge_sources"]
    assert sources["used"] == ["revluma_product_docs"] and sources["revluma_docs_cited"] == 1
    tools = final["execution_trace"]["telemetry"]["knowledge_sources"]
    assert tools[0]["source"] == "revluma_product_docs" and tools[0]["result_count"] >= 1


def test_a4_shopify_documentation_is_searched_only_on_official_hosts(monkeypatch, provider):
    provider.understand = _knowledge_reading
    provider.search = lambda query: ("Webhooks notify an app when a shop event occurs.", [
        ("https://shopify.dev/docs/apps/build/webhooks", "About webhooks"),
        ("https://community.shopify.com/c/webhooks-thread", "Forum thread")])

    def search(view):
        assert view["tools"][0] == "search_shopify_docs"
        return [provider.call("search_shopify_docs", {"query": "how Shopify webhooks work"})]

    def finish(view):
        result = view["results"]["search_shopify_docs"][0]
        assert [document["url"] for document in result["documents"]] == [
            "https://shopify.dev/docs/apps/build/webhooks"]
        # The provider summary may rest on the dropped forum source: withheld.
        assert "untrusted_public_summary" not in result
        return [provider.call("finish_answer", {
            "answer_markdown": "Shopify sends a webhook to your app's endpoint when a subscribed shop event "
                               "happens, such as an order being created.",
            "cited_evidence_ids": [result["documents"][0]["id"]], "evidence_sufficiency": "sufficient"})]

    provider.agent_turns = [search, finish]
    final, _, _ = _stream(monkeypatch, "How do Shopify webhooks work?")

    searches = [request for request in provider.requests if request["kind"] == "web_search"]
    assert len(searches) == 1
    assert "site:shopify.dev" in searches[0]["query"] and "site:help.shopify.com" in searches[0]["query"]
    assert "https://shopify.dev/docs/apps/build/webhooks" in final["text"]
    assert "community.shopify.com" not in final["text"]
    assert final["execution_trace"]["citations"] == ["https://shopify.dev/docs/apps/build/webhooks"]
    telemetry = final["execution_trace"]["telemetry"]
    assert "shopify_docs_search" in _purposes(final)
    assert telemetry["cache"]["shopify_docs_search"] == {"miss": 1, "store": 1}


def test_a5_current_shopify_research_runs_independent_searches_concurrently_without_private_context(
        monkeypatch, provider):
    provider.understand = lambda message: understanding("web_research", web=True)
    provider.search = lambda query: (
        ("Shopify's changelog lists a Checkout API update dated 2026-11-03.",
         [("https://changelog.shopify.com/posts/checkout-api-update", "Checkout API update")])
        if "site:" in query else
        ("Industry coverage of the November Shopify checkout changes.",
         [("https://news.example.org/shopify-checkout-november", "Checkout changes")]))
    seen = {}

    def research(view):
        seen["tools"] = view["tools"]
        seen["objective"] = _objective(view)
        return [provider.call("web_research", {"query": "Shopify Checkout API changes November 2026"}),
                provider.call("search_shopify_docs", {"query": "Checkout API changelog"})]

    def finish(view):
        docs = view["results"]["search_shopify_docs"][0]["documents"]
        web = view["results"]["web_research"][0]["sources"]
        return [provider.call("finish_answer", {
            "answer_markdown": "Shopify's changelog lists a Checkout API update dated 3 November 2026.",
            "cited_evidence_ids": [docs[0]["id"], web[0]["id"]], "evidence_sufficiency": "sufficient"})]

    provider.agent_turns = [research, finish]
    final, _, _ = _stream(monkeypatch, "What changed in the Shopify Checkout API recently?", context_payload={
        "conversation_context": {"summary": PRIVATE_MARKER,
                                 "context_window": json.dumps({"recent_turns": [PRIVATE_MARKER]})}})

    assert seen["tools"][:2] == ["web_research", "search_shopify_docs"]
    assert "recent_conversation" not in seen["objective"]
    agent_payloads = json.dumps([request["payload"] for request in provider.requests
                                 if request["kind"] in ("agent_turn", "web_search")])
    assert "PRIVATE ORDER" not in agent_payloads and "owner@example.com" not in agent_payloads
    trace = final["knowledge_agent_execution"]
    assert trace["concurrent_batches"] == 1 and trace["web_searches"] == 2
    assert "https://changelog.shopify.com/posts/checkout-api-update" in final["text"]
    assert "https://news.example.org/shopify-checkout-november" in final["text"]
    assert sorted(final["execution_trace"]["citations"]) == [
        "https://changelog.shopify.com/posts/checkout-api-update",
        "https://news.example.org/shopify-checkout-november"]
    assert final["knowledge_route"]["private_tenant_context"] is False
    _assert_telemetry_is_content_free(final, "PRIVATE ORDER", "owner@example.com", "Checkout API changes")


# ---------------------------------------------------------------------------
# Store evidence
# ---------------------------------------------------------------------------

def _finish_with(provider, tool, metric, template, *, sufficiency="partial"):
    def finish(view):
        payload = view["results"][tool][0]
        item = next(entry for entry in payload["items"] if entry["metric"] == metric)
        return [provider.call("finish_answer", {
            "answer_markdown": template.format(**item), "cited_evidence_ids": [item["id"]],
            "evidence_sufficiency": sufficiency})]
    return finish


def test_a6_revenue_answer_is_grounded_in_the_tool_evidence_it_actually_received(monkeypatch, provider):
    provider.understand = lambda message: understanding("diagnosis", store=True, mode="analysis", domains=["revenue"])
    seen = {}

    def gather(view):
        seen["tools"] = view["tools"]
        return [provider.call("revenue_observations", {"compare": True})]

    def finish(view):
        items = view["results"]["revenue_observations"][0]["items"]
        value = next(entry for entry in items if entry["metric"] == "recorded_order_value")
        seen["value"] = value
        return [provider.call("finish_answer", {
            "answer_markdown": (f"Recorded order value this week is {value['value']} {value['currency']}; the "
                                f"store's sync is {value['status']}, so treat it as provisional."),
            "cited_evidence_ids": [value["id"]], "evidence_sufficiency": "partial"})]

    provider.agent_turns = [gather, finish]
    final, events, _ = _stream(monkeypatch, "Why did my revenue fall this week?")

    assert "revenue_observations" in seen["tools"] and "calculate" in seen["tools"]
    assert (seen["value"]["value"], seen["value"]["currency"]) == ("30.31", "USD")  # from the order rows
    assert final["text"].startswith("Recorded order value this week is 30.31 USD")
    assert final["agent_answer"]["validation"]["status"] == "accepted"
    assert final["investigation"]["intent"] == "revenue_investigation"
    assert any(name == "step" and data.get("tool") == "revenue_observations" for name, data in events)
    telemetry = final["execution_trace"]["telemetry"]
    tools = {entry["tool"]: entry for entry in telemetry["tools"]}
    assert "revenue_observations" in tools
    assert _purposes(final).count("agent_turn") == 2 and "compose" not in provider.kinds()
    assert telemetry["objective"]["intent"] == "revenue_investigation"
    _assert_telemetry_is_content_free(final, "30.31", "Why did my revenue")


def test_a7_refunds_come_from_the_refund_tool_and_an_unsynchronized_ledger_is_not_zero(monkeypatch, provider):
    provider.understand = lambda message: understanding("metrics", store=True, mode="direct_answer",
                                                        domains=["revenue"])
    refund_rows = [order_fixture("USD", 3, "30.31", refunded_to_date_value=Decimal("5.00"))]
    seen = {}

    def gather(view):
        assert "refund_observations" in view["tools"]
        return [provider.call("refund_observations")]

    def finish(view):
        payload = view["results"]["refund_observations"][0]
        items = {entry["metric"]: entry for entry in payload["items"]}
        seen["items"] = items
        window = items["refund_amount_window_orders"]
        return [provider.call("finish_answer", {
            "answer_markdown": (f"Refunds recorded against this month's orders total {window['value']} "
                                f"{window['currency']}. The refund ledger itself is not synchronized, so refunds "
                                "issued this month on older orders are unknown, not zero."),
            "cited_evidence_ids": [window["id"]], "evidence_sufficiency": "partial",
            "unknowns": ["Refund-ledger amounts for this month"]})]

    provider.agent_turns = [gather, finish]
    final, _, _ = _stream(monkeypatch, "What is my refund rate this month?",
                          db_factory=lambda: workspace_db(order_rows=refund_rows))

    assert final["investigation"]["intent"] == "refund_investigation"
    window, ledger = seen["items"]["refund_amount_window_orders"], seen["items"]["refund_amount"]
    assert (window["value"], window["currency"]) == ("5.00", "USD")  # from refunded_to_date_value
    assert ledger["status"] == "not_synchronized" and ledger.get("value") is None  # missing, never 0
    assert final["text"].startswith("Refunds recorded against this month's orders total 5.00 USD.")
    assert "unknown, not zero" in final["text"]
    assert final["agent_answer"]["validation"]["status"] == "accepted"
    assert "refund_observations" in {entry["tool"] for entry in final["execution_trace"]["telemetry"]["tools"]}


def test_a8_products_answer_uses_line_item_evidence(monkeypatch, provider):
    provider.understand = lambda message: understanding("metrics", store=True, mode="direct_answer",
                                                        domains=["products"])
    seen = {}

    def gather(view):
        assert "product_observations" in view["tools"]
        return [provider.call("product_observations")]

    def finish(view):
        payload = view["results"]["product_observations"][0]
        seen["payload"] = payload
        named = [entry for entry in payload["items"] if "Trail Jacket" in json.dumps(entry)]
        assert named, payload["items"]
        item = named[0]
        return [provider.call("finish_answer", {
            "answer_markdown": "Trail Jacket is the top product in the recorded line items for this week.",
            "cited_evidence_ids": [item["id"]], "evidence_sufficiency": "partial"})]

    provider.agent_turns = [gather, finish]
    final, _, sessions = _stream(monkeypatch, "Which products sold best this week?")

    assert final["investigation"]["intent"] == "product_investigation"
    assert final["text"].startswith("Trail Jacket is the top product")
    assert final["agent_answer"]["validation"]["status"] == "accepted"
    assert any("FROM order_items oi" in sql for sql, _ in sessions[0].statements)


def test_a9_missing_revenue_data_is_reported_as_unavailable_never_as_zero(monkeypatch, provider):
    provider.understand = lambda message: understanding("metrics", store=True, mode="direct_answer",
                                                        domains=["revenue"])
    seen = {}

    def gather(view):
        return [provider.call("revenue_observations")]

    def finish(view):
        payload = view["results"]["revenue_observations"][0]
        seen["payload"] = payload
        return [provider.call("finish_answer", {
            "answer_markdown": "I couldn't retrieve recorded orders for this period, so revenue can't be stated "
                               "yet. That is missing data, not a zero.",
            "cited_evidence_ids": [], "evidence_sufficiency": "insufficient",
            "unknowns": ["Recorded order value for this week"]})]

    provider.agent_turns = [gather, finish]
    final, _, _ = _stream(monkeypatch, "How much revenue did I make this week?",
                          db_factory=lambda: workspace_db(fail=("AS test_order_count",)))

    payload = seen["payload"]
    assert payload["status"] in ("unavailable", "storage_failure")
    assert not [item for item in payload.get("items") or [] if item.get("value") in (0, "0", "0.00")]
    assert "missing data, not a zero" in final["text"]
    money = [item for item in final["evidence"]["items"] if item.get("unit") == "currency"]
    assert not [item for item in money if item.get("value") in (0, "0", "0.00")]
    assert not re.search(r"\b0(?:\.00)?\s*(?:USD|NGN)\b", final["text"])


def test_a10_insufficient_evidence_lets_the_model_ask_a_clarifying_question(monkeypatch, provider):
    provider.understand = lambda message: understanding("diagnosis", store=True, mode="analysis",
                                                        domains=["revenue"])
    provider.agent_turns = [lambda view: [provider.call("request_clarification", {
        "question": "Do you mean revenue across both stores, or only your USD store?",
        "reason": "Two stores in different currencies are connected."})]]
    final, _, _ = _stream(monkeypatch, "How are sales?")

    assert final["text"].startswith("Do you mean revenue across both stores, or only your USD store?")
    assert final["orchestration"]["objective_agent"]["stop_reason"] == "clarification"
    assert final["agent_answer"]["validation"]["kind"] == "clarification"
    assert final["execution_trace"]["telemetry"]["final_status"] == "completed"


# ---------------------------------------------------------------------------
# Conversation follow-ups and restoration
# ---------------------------------------------------------------------------

def _revenue_turn(provider):
    return [lambda view: [provider.call("revenue_observations", {"compare": True})],
            _finish_with(provider, "revenue_observations", "recorded_order_value",
                         "Recorded order value this week is {value} {currency}.")]


def _persisted_context(sessions) -> dict:
    updates = [params for db in sessions for sql, params in db.statements
               if "UPDATE conversations" in sql and "context" in params]
    assert updates, "the first turn must persist conversation context"
    return json.loads(updates[-1]["context"])


def _node_context_payload(context: dict, summary: str = "Revenue investigation") -> dict:
    """The bounded conversation context Node forwards (well under the 16 KiB cap)."""
    return {"conversation_context": {"summary": summary, "context_window": json.dumps(
        {"last_investigation": context["last_investigation"]})}}


def test_a11_follow_up_keeps_the_previous_period_and_scope(monkeypatch, provider):
    provider.understand = lambda message: (
        understanding("diagnosis", store=True, mode="analysis", domains=["revenue"])
        if "revenue" in message.lower() else
        understanding("followup", store=True, mode="analysis", domains=["revenue"]))
    provider.agent_turns = _revenue_turn(provider)
    first, _, sessions = _stream(monkeypatch, "Why did my revenue fall last week?")
    context = _persisted_context(sessions)
    period = context["last_investigation"]["period"]

    seen = {}

    def gather(view):
        seen["objective"] = _objective(view)
        return [provider.call("order_observations")]

    provider.agent_turns = [gather, _finish_with(provider, "order_observations", "order_count",
                                                 "There were {value} recorded orders in the same period.")]
    final, _, _ = _stream(monkeypatch, "And how many orders was that?",
                          context_payload=_node_context_payload(context))

    resolved = seen["objective"]["resolved_reporting_period"]
    assert (resolved["start"], resolved["end"]) == (period["start"], period["end"])
    assert seen["objective"]["followup"] is True
    assert final["investigation"]["context_used"]["previous_investigation"] is True
    assert final["execution_trace"]["telemetry"]["routing"]["followup"] is True
    assert final["text"].startswith("There were 4 recorded orders in the same period.")


def test_a12_unrelated_question_does_not_inherit_store_scope_or_private_history(monkeypatch, provider):
    provider.understand = lambda message: (
        understanding("diagnosis", store=True, mode="analysis", domains=["revenue"])
        if "revenue" in message.lower() else understanding("knowledge"))
    provider.agent_turns = _revenue_turn(provider)
    _, _, sessions = _stream(monkeypatch, "Why did my revenue fall last week?")
    context = _persisted_context(sessions)
    seen = {}

    def answer(view):
        seen["tools"] = view["tools"]
        seen["objective"] = _objective(view)
        return [provider.call("finish_answer", {
            "answer_markdown": "Typical ecommerce email open rates are often quoted in the 20 to 40 percent "
                               "range, but they vary widely by list and industry.",
            "cited_evidence_ids": [], "evidence_sufficiency": "partial"})]

    provider.agent_turns = [answer]
    final, _, _ = _stream(monkeypatch, "What is a good email open rate for an online store?",
                          context_payload=_node_context_payload(context, summary=PRIVATE_MARKER))

    assert final["investigation"]["intent"] == "knowledge"
    assert final["investigation"]["tools_used"] == []
    assert seen["tools"] == ["finish_answer", "request_clarification"]
    assert "resolved_reporting_period" not in seen["objective"]
    assert "recent_conversation" not in seen["objective"]
    assert "PRIVATE ORDER" not in json.dumps(seen["objective"])


def test_a13_context_is_restored_from_the_database_after_a_refresh(monkeypatch, provider):
    provider.understand = lambda message: (
        understanding("diagnosis", store=True, mode="analysis", domains=["revenue"])
        if "revenue" in message.lower() else
        understanding("followup", store=True, mode="analysis", domains=["revenue"]))
    provider.agent_turns = _revenue_turn(provider)
    first, _, sessions = _stream(monkeypatch, "Why did my revenue fall last week?")
    context = _persisted_context(sessions)
    period = context["last_investigation"]["period"]

    # Refresh: a brand-new session, no context from the browser or Node. The
    # conversation context and history come only from the database.
    restored_rows = [{"summary": "Revenue investigation", "context_window": context}]
    history_rows = [{"role": "user", "content": {"text": "Why did my revenue fall last week?"},
                     "created_at": None},
                    {"role": "rev", "content": {"text": first["text"]}, "created_at": None}]
    seen = {}

    def gather(view):
        seen["objective"] = _objective(view)
        return [provider.call("order_observations")]

    provider.agent_turns = [gather, _finish_with(provider, "order_observations", "order_count",
                                                 "There were {value} recorded orders in that period.")]
    final, _, _ = _stream(monkeypatch, "And how many orders was that?",
                          db_factory=lambda: workspace_db(conversation_rows=restored_rows,
                                                          memory_rows=history_rows))

    resolved = seen["objective"]["resolved_reporting_period"]
    assert (resolved["start"], resolved["end"]) == (period["start"], period["end"])
    assert final["investigation"]["context_used"]["previous_investigation"] is True
    assert final["text"].startswith("There were 4 recorded orders in that period.")
    assert final["agent_answer"]["validation"]["status"] == "accepted"
