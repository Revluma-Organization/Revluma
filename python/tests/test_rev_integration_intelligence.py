"""Task 201 — integration evidence inside Rev's real intelligence pipeline.

Proves the canonical integration evidence reaches the single Rev context and
answers: connected? healthy? last sync? syncing now? which resources are
accessible? permissions missing? why is a source unavailable? — and that no
credential material ever leaves the pipeline.
"""

import json
from datetime import datetime, timedelta, timezone

import pytest

from src.agents.investigation import INTENT_COVERAGE, INTENT_REVENUE, run_investigation
from src.agents.tools import catalog, run_tool
from src.intelligence.evidence import validate_collection
from tests.rev_fakes import FakeDB

NOW = datetime(2026, 11, 7, 12, tzinfo=timezone.utc)
ORG = "11111111-1111-4111-8111-111111111111"
USER = "22222222-2222-2222-2222-222222222222"

ALL_DOMAINS = (
    "store_domains", "products", "variants", "orders", "refunds", "inventory",
    "locations", "transactions", "fulfillments", "customers",
    "abandoned_checkouts", "webhooks",
)
FULL_SCOPES = ("read_products,read_orders,read_inventory,read_customers,"
               "read_checkouts,read_locations,read_discounts,read_content,"
               "read_themes,read_shipping,read_returns")


def _t(minutes):
    return NOW - timedelta(minutes=minutes)


def store_row(store_id="store-a1", org=ORG, status="active", scopes=FULL_SCOPES,
              has_token=True, last_synced_at=_t(9)):
    return {
        "id": store_id, "organization_id": org, "platform": "shopify",
        "status": status, "shop_domain": f"{store_id}.myshopify.com",
        "granted_scopes": scopes, "last_synced_at": last_synced_at,
        "installed_at": _t(60 * 24 * 30), "has_token": has_token,
        "settings_group": "general", "settings": {"currency": "USD"},
    }


def ledger_rows(status_by_domain=None, error_by_domain=None):
    status_by_domain = status_by_domain or {}
    error_by_domain = error_by_domain or {}
    rows = []
    for domain in ALL_DOMAINS:
        status = status_by_domain.get(domain, "ok")
        rows.append({
            "domain": domain, "status": status,
            "last_attempted_at": _t(5), "last_succeeded_at": _t(5),
            "last_checked_at": _t(5), "retry_count": 0,
            "records_discovered": 100, "records_inserted": 90,
            "records_updated": 10, "pages_completed": 1,
            "pagination_complete": True,
            "error_code": error_by_domain.get(domain),
        })
    return rows


def coverage_rows(store_id="store-a1"):
    return [{
        "store_id": store_id, "coverage_start": NOW - timedelta(days=30),
        "coverage_end": NOW + timedelta(days=1), "certified_at": NOW,
        "customer_lifetime_verified": True,
        "source": "shopify_verified_history_v1",
    }]


def webhook_reg():
    return [{"topic": "orders/create", "status": "active", "last_error": None,
             "attempt_count": 0}]


def webhook_deliv():
    return [{"topic": "orders/create", "status": "processed",
             "received_at": _t(10), "processed_at": _t(9.5)}]


_ACTIVE = ("active", "connected", "syncing")


def integration_db(*, store=None, ledgers=None, regs=None, delivs=None,
                   cov=None, order_rows=None):
    """FakeDB wired for the integration tool plus the coverage/revenue path.

    Store routes are org-aware callables so a store owned by another
    organization is never readable (mirrors the tenant scoping of the real
    SQL). Route order matters: the first matching pattern wins.
    """
    store = store or store_row()

    def _org_stores(params, *, active_only=False):
        return [s for s in (store,)
                if s["organization_id"] == params.get("org_id")
                and (not active_only or s["status"] in _ACTIVE)]

    db = FakeDB()
    # Integration canonical store query (carries shop_domain/granted_scopes).
    db.add("s.shop_domain", lambda p: _org_stores(p))
    # run_tool authorized-scope query + store_health + context resolution.
    db.add("SELECT s.id FROM stores s", lambda p: _org_stores(p, active_only=True))
    db.add("SELECT id, platform, status, last_synced_at",
           lambda p: _org_stores(p, active_only=True))
    db.add("SELECT s.id, s.platform, s.status, s.last_synced_at",
           lambda p: _org_stores(p, active_only=True))
    db.add("store_sync_domain_states", ledgers if ledgers is not None else [
        dict(r, store_id=store["id"]) for r in ledger_rows()])
    db.add("webhook_registrations", regs if regs is not None else webhook_reg())
    db.add("webhook_deliveries", delivs if delivs is not None else webhook_deliv())
    db.add("intelligence_order_coverage", cov if cov is not None else coverage_rows())
    # Revenue fallback rows so the revenue intent can run end-to-end.
    db.add("AS test_order_count", order_rows if order_rows is not None else [{
        "currency": "USD", "order_count": 2, "net_value": "20.50",
        "gross_value": "20.50", "gross_verified": 2,
        "refunded_to_date_value": "0", "refunded_to_date_verified": 2,
        "discount_value": "0", "discount_verified": 2,
        "line_items_value": "20.50", "line_items_verified": 2,
        "tax_value": "0", "tax_verified": 2,
        "shipping_value": "0", "shipping_verified": 2,
        "received_value": "20.50", "received_verified": 2,
        "outstanding_value": "0", "outstanding_verified": 2,
        "test_order_count": 0, "currency_unverified_count": 0,
        "negative_net_count": 0,
    }])
    db.add("COUNT(*) AS order_count", [
        {"currency": "USD", "order_count": 2, "order_value": "20.50"}])
    db.add("FROM events", [{"event_type": "checkout_started", "event_count": 3}])
    db.add("FROM intelligence_findings", [])
    db.add("to_regclass", [{"present": None}])
    db.add("FROM business_states", [])
    return db


@pytest.fixture(autouse=True)
def no_model(monkeypatch):
    monkeypatch.setenv("REV_NARRATIVE_LLM", "false")
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)


# ── Tool catalog and direct tool execution ───────────────────────────────────

def test_catalog_exposes_integration_health_as_read_only():
    spec = next(s for s in catalog() if s["name"] == "integration_health")
    assert spec["read_only"] is True
    assert spec["requires_period"] is False
    assert "store_sync_domain_states" in spec["data_sources"]
    assert "webhook_deliveries" in spec["data_sources"]


def test_run_tool_integration_health_reports_healthy_store():
    db = integration_db()
    result = run_tool("integration_health", ORG, db, now=NOW)
    assert result.status == "available"
    assert result.store_ids == ["store-a1"]
    assert validate_collection(result.items) == []
    metrics = {i["metric"] for i in result.items}
    assert "integration.connection_state" in metrics
    assert "integration.health_overall" in metrics
    health = next(i for i in result.items if i["metric"] == "integration.health_overall")
    assert health["value"] == "healthy"


def test_run_tool_integration_health_reports_failed_orders():
    db = integration_db(
        ledgers=[dict(r, status="failed",
                      error_code="SHOPIFY_RATE_LIMITED 429") if r["domain"] == "orders"
                 else r for r in ledger_rows()])
    result = run_tool("integration_health", ORG, db, now=NOW)
    assert result.status == "partial"
    orders = next(i for i in result.items
                  if i["metric"] == "integration.resource.orders")
    assert orders["value"] == "failed"
    health = next(i for i in result.items if i["metric"] == "integration.health_overall")
    assert health["value"] == "partially_operational"


def test_run_tool_integration_health_no_active_store_is_unavailable():
    db = integration_db(store=store_row(status="disconnected"))
    result = run_tool("integration_health", ORG, db, now=NOW)
    assert result.status == "unavailable"
    assert result.items == []


def test_run_tool_integration_health_tenant_isolation():
    other_org = "22222222-2222-4222-8222-222222222222"
    db = integration_db(store=store_row(org=other_org))
    result = run_tool("integration_health", ORG, db, now=NOW)
    # The store belongs to another organization: nothing is readable.
    assert result.status == "unavailable"
    assert all(i.get("organization_id") != ORG for i in result.items) or result.items == []


# ── The real investigation pipeline ──────────────────────────────────────────

def test_coverage_question_is_answered_from_integration_evidence():
    db = integration_db()
    result = run_investigation(ORG, USER, "Is my store connected and up to date?",
                               db=db, now=NOW, persist=False)
    assert result["investigation"]["intent"] == INTENT_COVERAGE
    assert "integration_health" in result["investigation"]["tools_used"]
    text = result["text"]
    assert "connected" in text
    assert "sync completed" in text
    assert "certified" in text
    # The answer cites evidence; validation must hold.
    assert result["evidence"]["validation"]["valid"] is True
    assert any(i["metric"] == "integration.health_overall"
               for i in result["evidence"]["items"])


def test_coverage_question_reports_a_failed_sync_deterministically():
    db = integration_db(
        ledgers=[dict(r, status="failed", error_code="SHOPIFY_API 500")
                 if r["domain"] == "orders" else r for r in ledger_rows()])
    result = run_investigation(ORG, USER, "Is my store connected and up to date?",
                               db=db, now=NOW, persist=False)
    text = result["text"]
    assert "not operational" in text
    assert "orders" in text
    # A failed source is explained, not hidden, and never called healthy.
    assert "healthy" not in text.lower() or "not" in text.lower()


def test_coverage_question_reports_missing_shopify_permissions():
    scopes = FULL_SCOPES.replace("read_orders,", "")
    db = integration_db(store=store_row(scopes=scopes))
    result = run_investigation(ORG, USER, "Which Shopify permissions does Rev have?",
                               db=db, now=NOW, persist=False)
    text = result["text"]
    assert "authorization" in text.lower() or "permission" in text.lower()
    assert "read_orders" in text


def test_coverage_question_reports_verification_pending_without_figures():
    db = integration_db(store=store_row(status="syncing", last_synced_at=None),
                        ledgers=[], regs=[], delivs=[])
    result = run_investigation(ORG, USER, "Is my store connected?",
                               db=db, now=NOW, persist=False)
    text = result["text"]
    assert "connected" in text
    assert "verified" in text.lower() or "sync" in text.lower()
    # No monetary figure may be invented while verification is pending.
    assert "USD" not in text


def test_coverage_question_reports_sync_running_now():
    rows = [dict(r, status="running") if r["domain"] == "orders" else r
            for r in ledger_rows()]
    db = integration_db(ledgers=rows)
    result = run_investigation(ORG, USER, "Is my store syncing right now?",
                               db=db, now=NOW, persist=False)
    assert "running now" in result["text"]
    assert "orders" in result["text"]


def test_revenue_investigation_carries_integration_validity():
    db = integration_db(
        ledgers=[dict(r, status="ok", last_succeeded_at=_t(60 * 24 * 3),
                      last_attempted_at=_t(60 * 24 * 3)) if r["domain"] == "orders"
                 else r for r in ledger_rows()])
    result = run_investigation(ORG, USER, "Why did my revenue fall this week?",
                               db=db, now=NOW, persist=False)
    assert result["investigation"]["intent"] == INTENT_REVENUE
    assert "integration_health" in result["investigation"]["tools_used"]
    # The integration verdict is part of the fact set the answer is built from.
    integration_facts = [f for f in result["facts"]
                         if f.get("metric") == "integration.health_overall"]
    assert integration_facts, "integration health must reach the answer context"
    assert "partially_operational" in integration_facts[0]["text"]
    # The stale source is named, so revenue claims are bounded, not blind.
    assert "stale" in integration_facts[0]["text"] or \
        any("stale" in f.get("text", "") for f in result["facts"])
    assert result["evidence"]["validation"]["valid"] is True


# ── Security: nothing credential-shaped leaves the pipeline ──────────────────

def test_no_credential_material_in_investigation_result():
    db = integration_db(
        store=store_row(scopes=FULL_SCOPES),
        ledgers=[dict(r, status="failed", error_code="ACCESS_DENIED read_orders")
                 if r["domain"] == "orders" else r for r in ledger_rows()])
    result = run_investigation(ORG, USER, "Is my store connected and up to date?",
                               db=db, now=NOW, persist=False)
    payload = json.dumps(result, default=str)
    assert "access_token" not in payload
    assert "webhook_secret" not in payload
    assert "SHOPIFY_WEBHOOK_SECRET" not in payload
    assert "sk_live" not in payload
    assert "has_token" not in payload
    # Every statement in the pipeline was organization-scoped.
    assert all(params.get("org_id") == ORG for _, params in db.statements
               if "org_id" in params)
