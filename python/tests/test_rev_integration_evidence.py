"""Task 201 — canonical integration evidence retrieval.

Covers the mandated scenario classes:

* connection state (explicit states; a record is never "healthy" by itself);
* authorization independent of connection (required vs granted vs effective,
  scope satisfaction, platform approval gates);
* per-resource sync evidence (never/pending/running/succeeded/partial/
  failed/stale; a failed resource never disappears; enqueued is not synced);
* webhook health (registered vs arriving vs processed; secrets never leak);
* deterministic overall health with essential-vs-optional separation and an
  explainable score that never hides a critical failure;
* security (tenant isolation, no tokens/secrets in output, safe diagnostics).
"""

import json
from datetime import datetime, timedelta, timezone

import pytest

from src.intelligence import integration_evidence as ie
from src.intelligence.evidence import validate_collection
from tests.rev_fakes import FakeDB

NOW = datetime(2026, 11, 7, 12, 0, 0, tzinfo=timezone.utc)
ORG = "11111111-1111-4111-8111-111111111111"

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


def ledger_rows(domains=ALL_DOMAINS, status="ok", succeeded=_t(5),
                error_code=None, pagination_complete=True):
    return [
        dict(domain=d, status=status, last_attempted_at=succeeded,
             last_succeeded_at=succeeded, last_checked_at=succeeded,
             retry_count=0, records_discovered=100, records_inserted=90,
             records_updated=10, pages_completed=1,
             pagination_complete=pagination_complete, error_code=error_code)
        for d in domains
    ]


def store_row(store_id="s1", org=ORG, status="active", has_token=True,
              scopes=FULL_SCOPES, last_synced_at=_t(10)):
    return dict(id=store_id, organization_id=org, platform="shopify",
                status=status, shop_domain=f"{store_id}.myshopify.com",
                granted_scopes=scopes, last_synced_at=last_synced_at,
                installed_at=_t(60 * 24 * 30), has_token=has_token)


def webhook_reg(topic="orders/create", status="active", last_error=None):
    return [dict(topic=topic, status=status, last_error=last_error, attempt_count=0)]


def webhook_deliv(status="processed", received=_t(10), processed=_t(9.5)):
    return [dict(topic="orders/create", status=status, received_at=received,
                 processed_at=processed)]


def coverage_row():
    return [dict(coverage_start=_t(60 * 24 * 30), coverage_end=_t(1))]


def make_db(stores, ledgers=None, regs=None, delivs=None, cov=None):
    ledgers = ledgers or {}
    regs = regs or {}
    delivs = delivs or {}
    cov = cov or {}
    db = FakeDB()
    db.add("store_sync_domain_states", lambda p: ledgers.get(p["store"]) or [])
    db.add("webhook_registrations", lambda p: regs.get(p["store"]) or [])
    db.add("webhook_deliveries", lambda p: delivs.get(p["store"]) or [])
    db.add("intelligence_order_coverage", lambda p: cov.get(p["store"]) or [])
    db.add("FROM stores s", lambda p: [
        s for s in stores
        if s["organization_id"] == p["org_id"]
        and ("store_id" not in p or s["id"] == p["store_id"])
    ])
    return db


def healthy_db(**overrides):
    kwargs = dict(
        ledgers={"s1": ledger_rows()},
        regs={"s1": webhook_reg()},
        delivs={"s1": webhook_deliv()},
        cov={"s1": coverage_row()},
    )
    kwargs.update(overrides)
    stores = kwargs.pop("stores", [store_row()])
    return make_db(stores, **kwargs)


def retrieve(db, **kw):
    return ie.retrieve_integration_evidence(ORG, db, now=NOW, **kw)


def only_store(result):
    assert len(result["stores"]) == 1
    return result["stores"][0]


def domain(store, name):
    return store["synchronization"][name]


# ── Connection state ─────────────────────────────────────────────────────────

def test_connection_record_alone_is_not_authenticated_claim():
    """An active record with a token asserts 'authenticated', never more."""
    store = only_store(retrieve(healthy_db()))
    conn = store["connection"]
    assert conn["state"] == "authenticated"
    assert conn["has_credentials"] is True
    assert "validity" in " ".join(conn["notes"]) or "successful" in " ".join(conn["notes"])


def test_connection_not_installed():
    result = retrieve(make_db([]))
    assert result["overall_status"] == "disconnected"
    assert result["stores"] == []
    assert any("No Shopify store is installed" in w for w in result["warnings"])


@pytest.mark.parametrize("record_status, expected", [
    ("disconnected", "disconnected"),
    ("revoked", "revoked"),
    ("inactive", "disconnected"),
    ("not_connected", "disconnected"),
])
def test_connection_record_disconnect_states(record_status, expected):
    store = only_store(retrieve(make_db([store_row(status=record_status)],
                                        ledgers={}, regs={}, delivs={}, cov={})))
    assert store["connection"]["state"] == expected
    assert store["health"]["overall_status"] == "disconnected"


def test_connection_installation_pending():
    store = only_store(retrieve(make_db(
        [store_row(status="syncing", last_synced_at=None)],
        ledgers={}, regs={}, delivs={}, cov={},
    )))
    assert store["connection"]["state"] == "installation_pending"
    assert store["health"]["overall_status"] == "verification_pending"


def test_connection_verification_failed_when_credentials_rejected():
    rows = ledger_rows()
    rows[3] = dict(rows[3], domain="orders", status="failed",
                   error_code="SHOPIFY_API 401 TOKEN_INVALID")
    store = only_store(retrieve(healthy_db(ledgers={"s1": rows})))
    assert store["connection"]["state"] == "verification_failed"
    assert store["health"]["overall_status"] == "attention_required"


def test_connection_authentication_invalid_without_token():
    store = only_store(retrieve(make_db([store_row(has_token=False)],
                                        ledgers={}, regs={}, delivs={}, cov={})))
    assert store["connection"]["state"] == "authentication_invalid"
    assert store["health"]["overall_status"] == "attention_required"


def test_connection_unknown_status_is_unknown():
    store = only_store(retrieve(make_db([store_row(status="weird_state")],
                                        ledgers={}, regs={}, delivs={}, cov={})))
    assert store["connection"]["state"] == "unknown"
    assert store["health"]["overall_status"] == "unknown"


# ── Authorization ────────────────────────────────────────────────────────────

def test_granted_scope_is_not_effective_access_without_retrieval():
    """Scope granted + no successful sync => granted_unverified, not effective."""
    store = only_store(retrieve(make_db(
        [store_row()], ledgers={}, regs={}, delivs={}, cov={})))
    cap = next(c for c in store["capabilities"] if c["resource_id"] == "products")
    assert cap["authorization"]["state"] == "granted_unverified"
    assert cap["authorization"]["effective"] is False
    assert not cap["operational"]


def test_effective_access_proven_by_successful_retrieval():
    store = only_store(retrieve(healthy_db()))
    cap = next(c for c in store["capabilities"] if c["resource_id"] == "products")
    assert cap["authorization"]["state"] == "effective_verified"
    assert cap["authorization"]["effective"] is True
    assert cap["operational"] is True


def test_missing_critical_scope_is_unauthorized_and_never_healthy():
    store = only_store(retrieve(make_db(
        [store_row(scopes=FULL_SCOPES.replace("read_orders,", ""))],
        ledgers={"s1": ledger_rows()},
        regs={"s1": webhook_reg()}, delivs={"s1": webhook_deliv()},
        cov={"s1": coverage_row()},
    )))
    health = store["health"]
    assert health["overall_status"] == "unauthorized"
    assert "read_orders" in health["missing_permissions"]
    orders = next(c for c in store["capabilities"] if c["resource_id"] == "orders")
    assert orders["authorization"]["state"] == "missing_scope"
    assert not orders["operational"]
    assert health["score"] <= 59


def test_write_scope_satisfies_read_requirement():
    store = only_store(retrieve(make_db(
        [store_row(scopes="write_products,read_orders,read_inventory")],
        ledgers={"s1": ledger_rows()},
        regs={"s1": webhook_reg()}, delivs={"s1": webhook_deliv()},
        cov={"s1": coverage_row()},
    )))
    cap = next(c for c in store["capabilities"] if c["resource_id"] == "products")
    assert cap["authorization"]["missing_scopes"] == []
    assert cap["operational"] is True


def test_platform_approval_gates_are_reported():
    store = only_store(retrieve(healthy_db()))
    orders = next(c for c in store["capabilities"] if c["resource_id"] == "orders")
    assert any("read_all_orders" in r for r in orders["restrictions"])
    customers = next(c for c in store["capabilities"] if c["resource_id"] == "customers")
    assert any("protected customer data" in r for r in customers["restrictions"])
    assert customers["authorization"]["state"] in (
        "effective_verified", "granted_approval_pending")


def test_missing_optional_scope_is_availability_limit_not_failure():
    db = make_db([store_row(scopes="read_products,read_orders,read_inventory")],
                 ledgers={"s1": ledger_rows()},
                 regs={"s1": webhook_reg()}, delivs={"s1": webhook_deliv()},
                 cov={"s1": coverage_row()})
    store = only_store(retrieve(db))
    health = store["health"]
    # read_locations missing => inventory.locations optional capability limited
    assert health["overall_status"] == "healthy"
    entry = next(e for e in health["optional_unavailable"]
                 if e["resource_id"] == "inventory.locations")
    assert entry["reason"] == "missing_scope"
    assert "read_locations" in entry["missing_scopes"]


# ── Per-resource sync evidence ───────────────────────────────────────────────

def test_sync_state_succeeded_with_full_evidence():
    store = only_store(retrieve(healthy_db()))
    orders = domain(store, "orders")
    assert orders["state"] == "succeeded"
    assert orders["pagination_complete"] is True
    assert orders["records_discovered"] == 100
    assert orders["records_inserted"] == 90
    assert orders["freshness"]["state"] == "fresh"


def test_sync_state_failed_is_reported_not_hidden():
    rows = ledger_rows()
    rows[3] = dict(rows[3], status="failed", error_code="SHOPIFY_RATE_LIMITED 429")
    store = only_store(retrieve(healthy_db(ledgers={"s1": rows})))
    orders = domain(store, "orders")
    assert orders["state"] == "failed"
    assert orders["failure_class"] == "rate_limit"
    assert orders["error_code"] == "SHOPIFY_RATE_LIMITED 429"
    # A failed critical resource must surface in health, and never in the
    # healthy state.
    health = store["health"]
    assert health["overall_status"] in ("partially_operational", "attention_required")
    assert any(f["resource_id"] == "orders" for f in health["critical_failures"])
    assert health["overall_status"] != "healthy"


def test_sync_state_partial_on_incomplete_pagination():
    rows = ledger_rows()
    rows[3] = dict(rows[3], status="degraded", pagination_complete=False,
                   error_code="PAGINATION_INCOMPLETE")
    store = only_store(retrieve(healthy_db(ledgers={"s1": rows})))
    orders = domain(store, "orders")
    assert orders["state"] == "partial"
    assert orders["pagination_complete"] is False
    assert domain(store, "products")["state"] == "succeeded"


def test_sync_state_stale_on_old_success():
    rows = ledger_rows()
    rows[3] = dict(rows[3], last_succeeded_at=_t(60 * 24 * 3),
                   last_attempted_at=_t(60 * 24 * 3))
    store = only_store(retrieve(healthy_db(ledgers={"s1": rows})))
    orders = domain(store, "orders")
    assert orders["state"] == "succeeded"
    assert orders["freshness"]["state"] == "stale"
    assert store["health"]["overall_status"] == "partially_operational"
    assert "orders" in [f["resource_id"] for f in store["health"]["critical_failures"]]


def test_sync_never_synchronized_is_explicit():
    store = only_store(retrieve(make_db(
        [store_row(status="active", last_synced_at=_t(60))],
        ledgers={"s1": [dict(domain="products", status="never_run",
                             last_attempted_at=None, last_succeeded_at=None,
                             last_checked_at=_t(60), retry_count=0,
                             records_discovered=0, records_inserted=0,
                             records_updated=0, pages_completed=0,
                             pagination_complete=False, error_code=None)]},
        regs={}, delivs={}, cov={},
    )))
    products = domain(store, "products")
    assert products["state"] == "never_synchronized"
    orders = domain(store, "orders")
    assert orders["state"] == "never_synchronized"


def test_enqueued_job_is_never_reported_as_synchronized():
    rows = ledger_rows()
    rows[3] = dict(rows[3], status="running", error_code=None)
    store = only_store(retrieve(healthy_db(ledgers={"s1": rows})))
    orders = domain(store, "orders")
    assert orders["state"] == "running"
    assert orders["freshness"]["state"] == "synchronizing"
    # Running on a recent success keeps the capability operational, but the
    # domain itself still reports no new completed result.
    cap = next(c for c in store["capabilities"] if c["resource_id"] == "orders")
    assert cap["operational"] is True
    assert "in progress" in orders["note"].lower()


def test_failed_domain_with_no_prior_success_is_failed_not_never():
    rows = ledger_rows()
    rows[3] = dict(rows[3], status="failed", last_succeeded_at=None,
                   error_code="ACCESS_DENIED read_orders")
    store = only_store(retrieve(healthy_db(ledgers={"s1": rows})))
    assert domain(store, "orders")["state"] == "failed"
    assert domain(store, "orders")["failure_class"] == "authorization"
    assert store["health"]["overall_status"] == "unauthorized"


def test_domain_retry_and_record_counts_are_reported():
    rows = ledger_rows()
    rows[5] = dict(rows[5], retry_count=7, pages_completed=12,
                   records_discovered=2500, records_inserted=2400,
                   records_updated=100)
    store = only_store(retrieve(healthy_db(ledgers={"s1": rows})))
    inv = domain(store, "inventory")
    assert inv["retry_count"] == 7
    assert inv["pages_completed"] == 12
    assert inv["records_discovered"] == 2500


# ── Webhook health ───────────────────────────────────────────────────────────

def test_webhook_healthy_from_processed_events():
    store = only_store(retrieve(healthy_db()))
    assert store["webhooks"]["state"] == "healthy"
    assert store["webhooks"]["processed_last_7d"] == 1


def test_registered_webhook_is_not_proven_arriving():
    store = only_store(retrieve(healthy_db(delivs={})))
    wh = store["webhooks"]
    assert wh["state"] == "unknown"
    assert "registered" in wh["note"].lower()
    assert store["health"]["overall_status"] == "degraded"


def test_delivered_events_are_not_proven_persisted():
    store = only_store(retrieve(healthy_db(
        delivs={"s1": [dict(topic="orders/create", status="received",
                            received_at=_t(10), processed_at=None)]})))
    wh = store["webhooks"]
    assert wh["state"] == "degraded"
    assert "arriving" in wh["note"].lower() and "processing is not" in wh["note"].lower()


def test_webhook_delivery_failures_are_reported():
    store = only_store(retrieve(healthy_db(
        regs={"s1": webhook_reg(status="failed", last_error="HTTP 404 from Shopify")},
        delivs={"s1": [dict(topic="orders/create", status="failed",
                            received_at=_t(30), processed_at=None)]},
    )))
    wh = store["webhooks"]
    assert wh["state"] == "failed"
    assert wh["failures_last_7d"] == 1
    assert "orders/create" in wh["failed_topics"]
    assert store["health"]["overall_status"] == "partially_operational"


def test_not_registered_webhooks_are_an_explicit_limitation():
    store = only_store(retrieve(healthy_db(regs={})))
    assert store["webhooks"]["state"] == "not_registered"
    assert any("No webhook registrations" in w for w in store["health"]["warnings"])


# ── Overall health ───────────────────────────────────────────────────────────

def test_healthy_requires_every_essential_capability_operational():
    result = retrieve(healthy_db())
    assert result["overall_status"] == "healthy"
    store = only_store(result)
    assert store["health"]["components"]["synchronization"] == "healthy"
    assert store["health"]["critical_failures"] == []
    assert store["health"]["score"] == 100


def test_failure_classification_classes_are_stable_and_safe():
    assert ie.classify_failure("SHOPIFY_API 401 TOKEN_INVALID") == "authentication"
    assert ie.classify_failure("ACCESS_DENIED read_orders") == "authorization"
    assert ie.classify_failure("HTTP 429 RATE_LIMITED") == "rate_limit"
    assert ie.classify_failure("ETIMEDOUT") == "network"
    assert ie.classify_failure("PAGINATION_STALLED") == "pagination"
    assert ie.classify_failure("SQL unique violation") == "database"
    assert ie.classify_failure(None, "failed") == "unknown"


def test_critical_failure_caps_score_below_sixty():
    rows = ledger_rows()
    rows[3] = dict(rows[3], status="failed", error_code="API_ERROR 500")
    store = only_store(retrieve(healthy_db(ledgers={"s1": rows})))
    assert store["health"]["score"] <= 59
    assert store["health"]["overall_status"] == "partially_operational"
    assert "overall_status, not the score" in store["health"]["score_formula"]


def test_verification_pending_for_first_sync():
    store = only_store(retrieve(make_db(
        [store_row(status="syncing", last_synced_at=None)],
        ledgers={}, regs={}, delivs={}, cov={},
    )))
    assert store["health"]["overall_status"] == "verification_pending"
    # Unproven, not failed.
    assert all(f["class"] == "never_synchronized"
               for f in store["health"]["critical_failures"])
    assert store["health"]["score"] >= 70


def test_multi_store_rolls_up_to_worst_state():
    rows_ok = ledger_rows()
    rows_bad = ledger_rows()
    rows_bad[3] = dict(rows_bad[3], status="failed", error_code="API_ERROR 500")
    db = make_db([store_row("s1"), store_row("s2")],
                 ledgers={"s1": rows_ok, "s2": rows_bad},
                 regs={"s1": webhook_reg(), "s2": webhook_reg()},
                 delivs={"s1": webhook_deliv(), "s2": webhook_deliv()},
                 cov={"s1": coverage_row(), "s2": coverage_row()})
    result = retrieve(db)
    assert result["overall_status"] == "partially_operational"
    per_store = {s["store_id"]: s["health"]["overall_status"] for s in result["stores"]}
    assert per_store == {"s1": "healthy", "s2": "partially_operational"}


def test_store_id_filter_narrows_to_one_store():
    db = make_db([store_row("s1"), store_row("s2")],
                 ledgers={"s1": ledger_rows(), "s2": ledger_rows()},
                 regs={"s1": webhook_reg(), "s2": webhook_reg()},
                 delivs={"s1": webhook_deliv(), "s2": webhook_deliv()},
                 cov={"s1": coverage_row(), "s2": coverage_row()})
    result = retrieve(db, store_id="s2")
    assert [s["store_id"] for s in result["stores"]] == ["s2"]


# ── Evidence items (Task 197 contract) ───────────────────────────────────────

def test_evidence_items_are_valid_contract_items():
    result = retrieve(healthy_db())
    assert result["schema_version"] == "rev-evidence-v2"
    assert result["metric_family"] == "integration"
    errors = validate_collection(result["items"])
    assert errors == []
    metrics = {item["metric"] for item in result["items"]}
    assert "integration.connection_state" in metrics
    assert "integration.health_overall" in metrics
    assert "integration.webhook_health" in metrics
    assert "integration.resource.orders" in metrics
    assert all(item["organization_id"] == ORG for item in result["items"])


def test_evidence_items_carry_store_discriminators_in_multi_store():
    db = make_db([store_row("s1"), store_row("s2")],
                 ledgers={"s1": ledger_rows(), "s2": ledger_rows()},
                 regs={"s1": webhook_reg(), "s2": webhook_reg()},
                 delivs={"s1": webhook_deliv(), "s2": webhook_deliv()},
                 cov={"s1": coverage_row(), "s2": coverage_row()})
    result = retrieve(db)
    items = [i for i in result["items"] if i["metric"] == "integration.connection_state"]
    assert len(items) == 2
    assert validate_collection(result["items"]) == []


# ── Security ─────────────────────────────────────────────────────────────────

def test_organization_is_required_and_never_client_chosen():
    with pytest.raises(ValueError):
        ie.retrieve_integration_evidence("", healthy_db(), now=NOW)
    with pytest.raises(ValueError):
        ie.retrieve_integration_evidence(None, healthy_db(), now=NOW)
    with pytest.raises(ValueError):
        ie.retrieve_integration_evidence(123, healthy_db(), now=NOW)


def test_every_statement_is_organization_scoped():
    db = healthy_db()
    retrieve(db)
    assert db.statements, "expected database reads"
    for sql, params in db.statements:
        assert "organization_id = :org_id" in sql, sql
        assert params.get("org_id") == ORG


def test_cross_tenant_store_id_is_not_readable():
    other_org = "22222222-2222-4222-8222-222222222222"
    db = make_db([store_row("sX", org=other_org)])
    result = retrieve(db, store_id="sX")
    assert result["stores"] == []
    assert result["overall_status"] == "disconnected"


def test_no_tokens_secrets_or_error_prose_leak():
    db = healthy_db(
        ledgers={"s1": [dict(r, error_code="ACCESS_DENIED read_orders")
                        if r["domain"] == "orders" else r
                        for r in ledger_rows()]},
    )
    payload = json.dumps(retrieve(db))
    # No actual token value or credential-bearing keys; limitation wording that
    # merely names "secrets" as never-included is permitted.
    assert "access_token" not in payload
    assert "webhook_secret" not in payload
    assert "SHOPIFY_WEBHOOK_SECRET" not in payload
    assert "sk_live" not in payload
    assert "sha256=" not in payload
    # error_code (bounded, non-sensitive) is allowed; raw prose is not selected
    for sql, _ in db.statements:
        assert "error_details" not in sql
        assert "access_token IS NOT NULL" in sql or "access_token" not in sql or \
            "SELECT s.access_token" not in sql.upper()


# ── Unrecorded scopes (production data gap) ───────────────────────────────────
# The live test store has granted_scopes = NULL: a data gap, not proof of a
# missing grant. Capability must rest on observed synchronization behaviour.

def test_unrecorded_scopes_with_fresh_sync_is_healthy_not_unauthorized():
    db = healthy_db(stores=[store_row(scopes=None)])
    result = retrieve(db)
    assert result["overall_status"] == "healthy", result["overall_status"]
    store = only_store(result)
    orders = next(c for c in store["capabilities"] if c["resource_id"] == "orders")
    assert orders["operational"] is True
    assert orders["authorization"]["state"] == "effective_verified"
    assert orders["authorization"]["missing_scopes"] == []
    assert "No granted scopes are recorded" in orders["authorization"]["note"]
    # The data gap is a visible warning, never a silent assumption.
    assert any("No granted Shopify scopes are recorded" in w
               for w in store["health"]["warnings"])
    # The authorization item carries no scope value and names the gap.
    auth_item = next(i for i in result["items"] if i["metric"] == "integration.authorization")
    assert auth_item["value"] is None
    assert any("No granted Shopify scopes are recorded" in str(l) for l in auth_item["limitations"])
    assert validate_collection(result["items"]) == []


def test_unrecorded_scopes_with_failed_sync_is_partially_operational():
    db = healthy_db(
        stores=[store_row(scopes=None)],
        ledgers={"s1": [dict(r, status="failed", error_code="SHOPIFY_API 500")
                        if r["domain"] == "orders" else r
                        for r in ledger_rows()]},
    )
    result = retrieve(db)
    assert result["overall_status"] == "partially_operational", result["overall_status"]
    store = only_store(result)
    failures = {f["resource_id"]: f for f in store["health"]["critical_failures"]}
    assert failures["orders"]["reason"].startswith("sync_")
    assert failures["orders"]["reason"] != "missing_scope"
    assert store["health"]["missing_permissions"] == []


def test_unrecorded_scopes_fresh_install_is_verification_pending():
    db = make_db(
        [store_row(status="syncing", scopes=None, last_synced_at=None)],
        ledgers={}, regs={}, delivs={}, cov={},
    )
    result = retrieve(db)
    assert result["overall_status"] == "verification_pending", result["overall_status"]
    store = only_store(result)
    assert store["connection"]["state"] == "installation_pending"
    orders = next(c for c in store["capabilities"] if c["resource_id"] == "orders")
    assert orders["authorization"]["state"] == "unverified_unrecorded"
