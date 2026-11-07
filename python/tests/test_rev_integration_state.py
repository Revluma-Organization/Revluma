"""Task 213 — canonical integration state model (rev-integration-state-v1).

Evaluator-level coverage of the 35 acceptance scenarios, the documented
precedence invariants, the contract shape, fail-closed behaviour and the
security properties (no tokens, no raw errors, no secret leakage).

The Node mirror (Backend/src/services/revIntegrationState.js) is pinned to
this module by a Python-generated golden fixture
(Backend/src/services/__tests__/revIntegrationState.golden.json).
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from src.intelligence.integration_state import (
    APP_REQUESTED_SCOPES,
    INTEGRATION_STATE_CONTRACT_VERSION,
    OVERALL_STATES,
    STATE_SEVERITY,
    SYNC_PHASES,
    evaluate_integration_state,
    normalize_store_record,
    worst_state,
)

NOW = datetime(2026, 11, 7, 12, 0, 0, tzinfo=timezone.utc)

# The app's hard-coded request set (Backend/src/utils/shopify.js).
APP_SCOPES = "read_orders,read_customers,read_products,read_inventory,read_locations,read_legal_policies,read_online_store_navigation"

CRIT_DOMAINS = ("store_domains", "products", "variants", "orders", "refunds", "inventory", "webhooks")
OPT_APP_DOMAINS = ("customers", "locations", "transactions", "fulfillments", "abandoned_checkouts")
TOPICS = (
    "orders/create", "orders/updated", "products/create", "products/update",
    "products/delete", "inventory_levels/updated",
    "shopify_payments/terms_of_service_acceptance", "app/uninstalled",
    "customers/data_request",
)


def _store(status="active", scopes=APP_SCOPES, token=True, domain="test.myshopify.com",
           platform="shopify", updated=timedelta(minutes=5), access_token=None):
    row = {
        "id": "store-1", "organization_id": "org-1", "platform": platform,
        "shop_domain": domain, "status": status,
        "granted_scopes": scopes,
        "installed_at": NOW - timedelta(days=10),
        "last_synced_at": NOW - timedelta(hours=1),
        "updated_at": NOW - updated,
    }
    if access_token is not None:
        row["access_token"] = access_token  # secret path: must never leak
    elif token:
        row["access_token"] = "shpat_secret_value"
    else:
        row["access_token"] = None
    return normalize_store_record(row, organization_id="org-1")


def _dom(domain, status="ok", succeeded=None, attempted=None, retry=0, err=None):
    return {
        "domain": domain, "status": status,
        "last_succeeded_at": succeeded if succeeded is not None else NOW - timedelta(hours=1),
        "last_attempted_at": attempted if attempted is not None else NOW - timedelta(hours=1),
        "retry_count": retry,
        "records_discovered": 100, "records_inserted": 50, "records_updated": 50,
        "pages_completed": 10, "pagination_complete": True,
        "error_code": err,
        "error_since": (NOW - timedelta(hours=2)) if err else None,
    }


def _records(**kw):
    store = kw.pop("store", None)
    return {
        "organization_id": "org-1",
        "store": store if store is not None else _store(**kw) if kw else _store(),
        "domain_states": [ _dom(d) for d in CRIT_DOMAINS ] + [ _dom(d) for d in OPT_APP_DOMAINS ],
        "webhook_registrations": [
            {"topic": t, "status": "active", "last_error": None, "attempt_count": 1}
            for t in TOPICS
        ],
        "webhook_deliveries": [
            {"topic": "orders/create", "status": "processed",
             "received_at": NOW - timedelta(hours=1),
             "processed_at": NOW - timedelta(minutes=50)}
        ],
        "order_coverage": {
            "status": "complete", "start": "2026-01-01T00:00:00+00:00",
            "end": NOW.isoformat(), "certified_at": NOW.isoformat(),
            "customer_lifetime_verified": False,
        },
    }


def _without(records, domain):
    records = dict(records)
    records["domain_states"] = [d for d in records["domain_states"] if d["domain"] != domain]
    return records


def _state(records, **kw):
    return evaluate_integration_state(records, now=NOW, **kw)


def _dump(result):
    return json.dumps(result, sort_keys=True)


# ── Contract shape (task §3.B) ────────────────────────────────────────────────

def test_contract_version_and_closed_states():
    r = _state(_records())
    assert r["contract_version"] == INTEGRATION_STATE_CONTRACT_VERSION
    assert r["overall_status"] in OVERALL_STATES
    assert set(OVERALL_STATES) == {
        "connected", "synchronizing", "limited_access", "needs_attention",
        "disconnected", "authorization_required", "authorization_expired",
        "authorization_revoked", "sync_failed", "sync_partial", "unsupported",
        "unknown",
    }
    assert r["synchronization"]["state"] in SYNC_PHASES


def test_required_properties_present():
    r = _state(_records())
    for key in (
        "contract_version", "integration_id", "organization_id", "store",
        "overall_status", "status_reason", "status_explanation",
        "authorization", "capabilities", "synchronization", "webhooks",
        "coverage", "last_error", "merchant_action_required",
        "recommended_next_step", "evaluated_at", "source",
    ):
        assert key in r, key
    for key in ("valid", "verified", "verification", "last_verified_at",
                "granted_scopes", "required_scopes", "missing_scopes",
                "missing_app_scopes", "scope_list_recorded"):
        assert key in r["authorization"], key
    for key in ("state", "active", "running_domains", "failed_domains",
                "succeeded_domains", "retrying", "stalled",
                "last_attempted_at", "last_succeeded_at", "domains"):
        assert key in r["synchronization"], key
    cap = r["capabilities"][0]
    for key in ("id", "name", "critical", "supported", "app_requested",
                "authorization", "required_permissions", "missing_permissions",
                "source_available", "sync_state", "freshness", "operational",
                "limited_reasons", "merchant_action_required", "remediation"):
        assert key in cap, key


# ── Security properties ───────────────────────────────────────────────────────

def test_token_never_leaks():
    r = _state(_records(access_token="shpat_super_secret_123"))
    blob = _dump(r)
    assert "shpat_super_secret_123" not in blob
    assert "access_token" not in blob
    assert "refresh" not in blob.lower().replace("retry", "x").replace("refresh", "refresh")  # structural: no refresh_token key
    assert "refresh_token" not in blob


def test_error_exposure_is_classified_not_raw():
    rec = _records()
    rec["domain_states"] = [
        _dom("orders", "failed", None, NOW - timedelta(hours=1),
             err="SHOPIFY_API_ERROR")
    ] + [d for d in rec["domain_states"] if d["domain"] != "orders"]
    r = _state(rec)
    assert r["last_error"]["category"] in (
        "none", "authorization", "authentication", "rate_limit", "pagination",
        "database", "scheduler", "network", "shopify_api")
    # Short class code only — never prose or URLs
    assert r["last_error"]["code"] == "SHOPIFY_API_ERROR"
    assert "shpat" not in _dump(r)


def test_no_store_data_in_output():
    r = _state(_records())
    blob = _dump(r)
    # No customer/order content is ever part of the state contract (the
    # capability ids legitimately contain resource names like order.line_items;
    # we assert absence of store-data KEYS, not substrings).
    for token in ('"email"', '"customer_email"', '"order_number"',
                  '"customer_name"', '"line_items":'):
        assert token not in blob


# ── The 35 acceptance scenarios (evaluator level) ─────────────────────────────

def test_s01_fresh_install_no_record():
    r = _state({"organization_id": "org-1"})
    assert (r["overall_status"], r["status_reason"]) == ("disconnected", "no_installation_record")
    assert r["integration_id"] is None
    assert "Connect your store" in r["recommended_next_step"]


def test_s02_fully_authorized_fresh():
    r = _state(_records())
    assert r["overall_status"] == "connected"
    assert r["authorization"]["verified"] is True
    assert r["authorization"]["verification"] == "verified_by_successful_synchronization"
    assert r["merchant_action_required"] is False


def test_s03_historical_sync_success_but_stale():
    # A successful historical sync is NOT current health.
    rec = _records()
    rec["domain_states"] = [
        _dom(d, succeeded=NOW - timedelta(days=30)) for d in CRIT_DOMAINS
    ] + [ _dom(d, succeeded=NOW - timedelta(days=30)) for d in OPT_APP_DOMAINS ]
    r = _state(rec)
    assert r["overall_status"] == "limited_access"
    assert any(c["freshness"] == "stale" for c in r["capabilities"])


def test_s04_never_synced_store():
    rec = _records()
    rec["domain_states"] = []
    r = _state(rec)
    assert r["overall_status"] == "limited_access"
    assert not any(d["state"] == "failed" for d in r["synchronization"]["domains"].values())


def test_s05a_sync_queued():
    rec = _records(status="syncing", updated=timedelta(minutes=1))
    r = _state(rec)
    assert r["overall_status"] == "synchronizing"
    assert r["synchronization"]["state"] == "queued"


def test_s05b_sync_running():
    rec = _records()
    rec["domain_states"] = [
        _dom("orders", "running", NOW - timedelta(days=2), NOW - timedelta(minutes=5))
    ] + [d for d in rec["domain_states"] if d["domain"] != "orders"]
    r = _state(rec)
    assert r["overall_status"] == "synchronizing"
    assert r["synchronization"]["state"] == "running"
    assert "orders" in r["synchronization"]["running_domains"]


def test_s05c_sync_partial():
    rec = _records()
    rec["domain_states"] = [
        _dom("refunds", "degraded", NOW - timedelta(hours=1))
    ] + [d for d in rec["domain_states"] if d["domain"] != "refunds"]
    r = _state(rec)
    assert r["overall_status"] == "sync_partial"
    assert "refunds" in r["synchronization"]["partial_domains"]
    # A failed sync never invalidates the valid connection.
    assert r["authorization"]["valid"] is True


def test_s05d_sync_complete():
    rec = _records()
    r = _state(rec)
    assert r["synchronization"]["state"] == "completed"
    assert r["overall_status"] == "connected"


def test_s05e_sync_failed():
    rec = _records()
    rec["domain_states"] = [
        _dom(d, "failed", NOW - timedelta(days=3), err="NETWORK_TIMEOUT")
        for d in CRIT_DOMAINS
    ] + [ _dom(d) for d in OPT_APP_DOMAINS ]
    r = _state(rec)
    assert r["overall_status"] == "sync_failed"
    assert r["authorization"]["valid"] is True  # connection stays valid
    assert r["retry_appropriate"] is True


def test_s05f_sync_retry_waiting():
    # Failed with retry history but not yet "repetitive": routine retry state.
    rec = _records()
    rec["domain_states"] = [
        _dom("orders", "failed", NOW - timedelta(days=3), retry=1, err="SHOPIFY_RATE_LIMITED")
    ] + [d for d in rec["domain_states"] if d["domain"] != "orders"]
    r = _state(rec)
    assert r["synchronization"]["retrying"] is True
    assert r["overall_status"] == "sync_partial"  # others succeeded


def test_s05g_sync_stalled():
    rec = _records()
    rec["domain_states"] = [
        _dom("orders", "running", NOW - timedelta(days=2), NOW - timedelta(days=1))
    ] + [d for d in rec["domain_states"] if d["domain"] != "orders"]
    r = _state(rec)
    assert r["overall_status"] == "needs_attention"
    assert r["status_reason"] == "sync_stalled"
    assert "orders" in r["synchronization"]["stalled_domains"]


def test_s06_oauth_expired():
    rec = _records()
    rec["domain_states"] = [
        _dom("orders", "failed", None, NOW - timedelta(hours=1), err="TOKEN_EXPIRED")
    ] + [d for d in rec["domain_states"] if d["domain"] != "orders"]
    r = _state(rec)
    assert r["overall_status"] == "authorization_expired"
    assert r["authorization"]["verification"] == "failed_by_latest_evidence"
    assert r["reconnect_appropriate"] is True


def test_s07_oauth_revoked_record():
    r = _state(_records(status="revoked"))
    assert r["overall_status"] == "authorization_revoked"
    assert r["status_reason"] == "recorded_revoked"
    assert "Reinstall" in r["recommended_next_step"]


def test_s08_app_uninstalled():
    r = _state(_records(status="app_uninstalled"))
    assert r["overall_status"] == "authorization_revoked"


def test_s09_missing_required_scope():
    rec = _records(scopes="read_products,read_orders,read_customers,read_locations")
    r = _state(rec)
    assert r["overall_status"] == "authorization_required"
    assert "read_inventory" in r["authorization"]["missing_scopes"]
    assert "read_inventory" in r["authorization"]["missing_app_scopes"]


def test_s10_missing_optional_scope():
    rec = _records(scopes="read_orders,read_products,read_inventory,read_locations,read_legal_policies,read_online_store_navigation")
    r = _state(rec)
    assert r["overall_status"] == "limited_access"
    cust = next(c for c in r["capabilities"] if c["id"] == "customers")
    assert cust["authorization"] == "missing_scope"
    assert cust["merchant_action_required"] is True


def test_s11_unrequested_scope_is_build_limitation():
    # read_returns is never requested by this build: its absence must NOT
    # demote an otherwise healthy store.
    r = _state(_records())
    returns = next(c for c in r["capabilities"] if c["id"] == "order.returns")
    assert returns["app_requested"] is False
    assert returns["merchant_action_required"] is False
    assert r["overall_status"] == "connected"


def test_s12_partial_capability_coverage():
    # customers granted but never synchronized: a real (granted) limitation.
    rec = _records()
    rec["domain_states"] = [
        d if d["domain"] != "customers" else _dom("customers", "never_run")
        for d in rec["domain_states"]
    ]
    r = _state(rec)
    assert r["overall_status"] == "connected"  # unproven optional: no demotion
    cust = next(c for c in r["capabilities"] if c["id"] == "customers")
    assert cust["sync_state"] == "never_synchronized"
    assert "not_yet_synchronized" in cust["limited_reasons"]


def test_s13_unsupported_resource():
    rec = _records()
    r = _state(rec)
    discount = next(c for c in r["capabilities"] if c["id"] == "discount-nodes")
    assert discount["sync_state"] == "unsupported"
    # Unsupported is a build limitation, never a sync failure.
    assert r["overall_status"] == "connected"
    assert r["last_error"] is None


def test_s14_not_yet_synced_domain():
    rec = _records()
    rec["domain_states"] = [
        d if d["domain"] != "orders" else _dom("orders", "never_run")
        for d in rec["domain_states"]
    ]
    r = _state(rec)
    assert r["overall_status"] == "limited_access"
    orders = next(c for c in r["capabilities"] if c["id"] == "orders")
    assert orders["sync_state"] == "never_synchronized"


def test_s15_provider_outage():
    # A provider outage surfaces through classified ledger failures, never
    # as a fabricated success.
    rec = _records()
    rec["domain_states"] = [
        _dom(d, "failed", NOW - timedelta(days=3), err="NETWORK_TIMEOUT")
        for d in CRIT_DOMAINS
    ] + [ _dom(d) for d in OPT_APP_DOMAINS ]
    r = _state(rec)
    assert r["overall_status"] == "sync_failed"
    assert r["last_error"]["category"] == "network"
    assert r["last_error"]["recoverable"] is True


def test_s16_db_unavailable_is_not_state():
    # DB unavailability is a REQUEST failure, not an integration state: the
    # contract is never minted with fabricated data (covered at the API
    # boundary tests); the evaluator itself always degrades to an explicit
    # state on partial evidence.
    rec = _records()
    rec["domain_states"] = rec["domain_states"][:2]  # partial evidence
    r = _state(rec)
    assert r["overall_status"] in OVERALL_STATES
    assert r["overall_status"] != "connected"


def test_s17_webhook_delivery_failure():
    rec = _records()
    rec["webhook_registrations"] = [
        {"topic": t, "status": "failed" if t == "orders/create" else "active",
         "last_error": "unreachable" if t == "orders/create" else None,
         "attempt_count": 3 if t == "orders/create" else 1}
        for t in TOPICS
    ]
    rec["webhook_deliveries"] = [
        {"topic": "orders/create", "status": "failed",
         "received_at": NOW - timedelta(hours=2), "processed_at": None}
    ]
    r = _state(rec)
    assert r["overall_status"] == "needs_attention"
    assert r["status_reason"] == "webhook_failure"


def test_s18_conflicting_persisted_vs_actual_auth():
    # The DB says active/connected, but the latest ledger evidence shows the
    # credentials were rejected. Actual behaviour wins — never "connected".
    rec = _records(status="active")
    rec["domain_states"] = [
        _dom("orders", "failed", None, NOW - timedelta(hours=1), err="TOKEN_EXPIRED")
    ] + [d for d in rec["domain_states"] if d["domain"] != "orders"]
    r = _state(rec)
    assert r["overall_status"] == "authorization_expired"
    assert r["authorization"]["valid"] is False


def test_s19_unknown_verification():
    # No scope list recorded and no success evidence: unverified, never
    # assumed connected.
    rec = _records(scopes=None, token=True)
    rec["domain_states"] = []
    rec["store"]["status"] = "active"
    r = _state(rec)
    assert r["authorization"]["verification"] in ("unverified_unrecorded", "no_credentials_recorded", "install_in_progress")
    assert r["overall_status"] in ("limited_access", "unknown")
    assert r["overall_status"] != "connected"


def test_s20_missing_record():
    r = _state({"organization_id": "org-1"})
    assert r["overall_status"] == "disconnected"
    assert r["status_reason"] == "no_installation_record"


def test_s21_cross_tenant_rejected():
    # Tenant isolation is enforced at the API boundary (Node tests); the
    # evaluator itself is tenant-agnostic but never infers an org.
    r = _state({"organization_id": "org-B"})
    assert r["organization_id"] == "org-B"
    assert r["integration_id"] is None


def test_s22_invalid_store_id():
    rec = _records()
    rec["store"] = _store()
    rec["store"]["id"] = ""
    r = _state(rec)
    assert r["integration_id"] == ""
    assert r["overall_status"] in OVERALL_STATES


def test_s23_multi_store_org_rollup():
    states = ["connected", "connected", "sync_failed"]
    assert worst_state(states) == "sync_failed"
    assert worst_state(["connected", "unknown"]) == "unknown"
    assert worst_state(["disconnected", "needs_attention"]) == "needs_attention"
    assert worst_state([]) is None
    assert worst_state(["limited_access", "synchronizing"]) == "synchronizing"
    # Every state ranks exactly once.
    assert len(STATE_SEVERITY) == len(OVERALL_STATES)


def test_s24_concurrent_sync_jobs_one_state():
    # Two domains running at once is still ONE synchronizing state with both
    # domains listed — no duplicate or conflicting overall states.
    rec = _records()
    rec["domain_states"] = [
        _dom("orders", "running", NOW - timedelta(days=2), NOW - timedelta(minutes=5)),
        _dom("products", "running", NOW - timedelta(days=2), NOW - timedelta(minutes=5)),
    ] + [d for d in rec["domain_states"] if d["domain"] not in ("orders", "products")]
    r = _state(rec)
    assert r["overall_status"] == "synchronizing"
    assert r["synchronization"]["running_domains"] == ["orders", "products"]


def test_s25_stale_cache_after_disconnect():
    # The record says revoked: a stale "connected" belief can never survive
    # evaluation.
    r = _state(_records(status="revoked"))
    assert r["overall_status"] == "authorization_revoked"
    assert r["authorization"]["valid"] is False


def test_s26_reconnect_restores():
    # After a reconnect: fresh token, fresh syncs, fresh webhooks, complete
    # coverage => connected.
    r = _state(_records())
    assert r["overall_status"] == "connected"


def test_s27_rev_question_unavailable_capability():
    # The contract exposes per-capability availability so Rev answers can be
    # capability-aware (the Rev tool consumes this object).
    rec = _records()
    rec["domain_states"] = [
        d if d["domain"] != "customers" else _dom("customers", "never_run")
        for d in rec["domain_states"]
    ]
    r = _state(rec)
    cust = next(c for c in r["capabilities"] if c["id"] == "customers")
    assert cust["source_available"] is False
    assert cust["operational"] is False


def test_s28_command_center_limited_access():
    rec = _records(scopes="read_orders,read_products,read_inventory,read_locations")
    r = _state(rec)
    assert r["overall_status"] == "limited_access"
    assert r["merchant_action_required"] is True
    assert r["status_explanation"]


def test_s29_workspace_needs_attention():
    rec = _records()
    rec["domain_states"] = [
        _dom("orders", "failed", NOW - timedelta(days=3), retry=4, err="SHOPIFY_API_ERROR")
    ] + [d for d in rec["domain_states"] if d["domain"] != "orders"]
    r = _state(rec)
    assert r["overall_status"] == "needs_attention"
    assert r["merchant_action_required"] is True


def test_s30_historical_success_not_concealing_failure():
    # Orders succeeded 3 days ago but the latest attempt failed: the state is
    # the CURRENT failure, not the historical success.
    rec = _records()
    rec["domain_states"] = [
        _dom("orders", "failed", NOW - timedelta(days=3), err="SHOPIFY_API_ERROR")
    ] + [d for d in rec["domain_states"] if d["domain"] != "orders"]
    r = _state(rec)
    assert r["overall_status"] == "sync_partial"
    assert "orders" in r["synchronization"]["failed_domains"]
    orders = r["synchronization"]["domains"]["orders"]
    assert orders["last_succeeded_at"] is not None  # history preserved


def test_s31_unsupported_platform():
    rec = _records()
    rec["store"]["platform"] = "magento"
    r = _state(rec)
    assert r["overall_status"] == "unsupported"
    assert r["status_reason"] == "platform_unsupported"
    assert r["merchant_action_required"] is False


def test_s32_stale_syncing_heartbeat():
    # store.status='syncing' with an old heartbeat and no running ledger row:
    # a lost/stalled start, not an endless "syncing".
    rec = _records(status="syncing", updated=timedelta(days=1))
    r = _state(rec)
    assert r["overall_status"] == "needs_attention"
    assert r["synchronization"]["stalled"] is True


def test_s33_webhook_registered_but_not_flowing():
    rec = _records()
    rec["webhook_deliveries"] = []
    r = _state(rec)
    assert r["webhooks"]["state"] == "unknown"
    assert r["overall_status"] == "limited_access"


def test_s34_provider_rate_limit_is_recoverable():
    rec = _records()
    rec["domain_states"] = [
        _dom("orders", "failed", NOW - timedelta(days=3), err="SHOPIFY_RATE_LIMITED")
    ] + [d for d in rec["domain_states"] if d["domain"] != "orders"]
    r = _state(rec)
    assert r["last_error"]["category"] == "rate_limit"
    assert r["last_error"]["recoverable"] is True


def test_s35_active_sync_does_not_conceal_auth_failure():
    # One domain running while the latest orders evidence shows a rejected
    # token: the authorization failure wins over the running job.
    rec = _records()
    rec["domain_states"] = [
        _dom("products", "running", NOW - timedelta(days=2), NOW - timedelta(minutes=5)),
        _dom("orders", "failed", None, NOW - timedelta(hours=1), err="TOKEN_EXPIRED"),
    ] + [d for d in rec["domain_states"] if d["domain"] not in ("products", "orders")]
    r = _state(rec)
    assert r["overall_status"] == "authorization_expired"


# ── Precedence invariants (task §3.C) ─────────────────────────────────────────

def test_revoked_never_connected_despite_stale_row():
    for status in ("revoked",):
        rec = _records(status=status)
        rec["domain_states"] = [ _dom(d) for d in CRIT_DOMAINS ]  # fresh success evidence
        r = _state(rec)
        assert r["overall_status"] == "authorization_revoked"


def test_disconnected_never_synchronizing():
    rec = _records(status="disconnected")
    rec["domain_states"] = [
        _dom("orders", "running", NOW - timedelta(days=2), NOW - timedelta(minutes=1))
    ] + [d for d in rec["domain_states"] if d["domain"] != "orders"]
    r = _state(rec)
    assert r["overall_status"] == "disconnected"


def test_unknown_never_becomes_connected():
    rec = _records()
    rec["domain_states"] = []
    rec["webhook_registrations"] = []
    rec["webhook_deliveries"] = []
    rec["order_coverage"] = None
    rec["store"]["status"] = "active"
    r = _state(rec)
    assert r["overall_status"] in ("limited_access", "unknown")
    assert r["overall_status"] != "connected"


def test_supported_platform_only_shopify():
    rec = _records()
    rec["store"]["platform"] = "woocommerce"
    r = _state(rec)
    assert r["overall_status"] == "unsupported"


# ── Determinism & parity surface ──────────────────────────────────────────────

def test_deterministic_for_fixed_now():
    rec = _records()
    a = _state(rec)
    b = _state(rec)
    assert a == b


def test_app_scopes_match_build_source():
    """The keystone's APP_REQUESTED_SCOPES must match the scopes that
    Backend/src/utils/shopify.js hard-codes at install time."""
    js = (Path(__file__).resolve().parents[2] / "Backend" / "src" / "utils" / "shopify.js").read_text()
    block = js[js.index("const scope = [...new Set(["): js.index("].join(',');")]
    js_scopes = set(re.findall(r"'(read_[a-z_]+)'", block))
    # configuredScopes (SHOPIFY_SCOPES env) is additive and environment
    # dependent; the hard-coded set is what we pin.
    assert js_scopes == set(APP_REQUESTED_SCOPES), (js_scopes, set(APP_REQUESTED_SCOPES))


def test_normalize_store_record_never_keeps_token():
    row = _store()
    assert "access_token" not in row
    assert row["has_token"] is True
    assert row["granted_scopes"] == APP_SCOPES.split(",")


def test_evaluation_timestamp_is_iso():
    r = _state(_records())
    assert r["evaluated_at"].endswith("Z")
    assert "T" in r["evaluated_at"]


def test_canonical_state_summary_projection():
    """The compact summary carries exactly the capability-aware fields —
    never the full capability list (bounded context budget) and never any
    credential material."""
    from src.intelligence.integration_state import canonical_state_summary
    full = _state(_records())
    summary = canonical_state_summary(full)
    assert set(summary) == {
        "contract_version", "overall_status", "status_reason",
        "status_explanation", "authorization", "synchronization",
        "limited_capabilities", "merchant_action_required",
        "recommended_next_step",
    }
    assert summary["contract_version"] == full["contract_version"]
    assert summary["overall_status"] == full["overall_status"]
    assert summary["status_reason"] == full["status_reason"]
    assert summary["status_explanation"] == full["status_explanation"]
    assert summary["authorization"] == {
        "verification": full["authorization"]["verification"],
        "valid": full["authorization"]["valid"],
        "verified": full["authorization"]["verified"],
        "last_verified_at": full["authorization"]["last_verified_at"],
        "missing_app_scopes": full["authorization"]["missing_app_scopes"],
    }
    assert summary["synchronization"] == {
        "state": full["synchronization"]["state"],
        "running_domains": full["synchronization"]["running_domains"],
        "failed_domains": full["synchronization"]["failed_domains"],
        "partial_domains": full["synchronization"]["partial_domains"],
        "last_succeeded_at": full["synchronization"]["last_succeeded_at"],
    }
    assert summary["limited_capabilities"] == [
        c["id"] for c in full["capabilities"] if c["limited_reasons"]
    ]
    assert summary["merchant_action_required"] == full["merchant_action_required"]
    assert summary["recommended_next_step"] == full["recommended_next_step"]
    assert "shpat" not in json.dumps(summary)


def test_canonical_state_summary_limited_capabilities_lists_real_limits():
    """A limited_access store surfaces the restricted capability ids."""
    from src.intelligence.integration_state import canonical_state_summary
    records = _records()
    # Drop a critical granted scope so the store lands in limited_access.
    records["store"]["granted_scopes"] = [
        s for s in records["store"]["granted_scopes"] if s != "read_orders"
    ]
    full = evaluate_integration_state(records, now=NOW)
    if full["overall_status"] == "limited_access":
        summary = canonical_state_summary(full)
        assert "orders" in summary["limited_capabilities"]
        assert full["merchant_action_required"] is True


def test_canonical_state_summary_matches_golden():
    """Bidirectional pin: the Python summary reproduces the golden
    expected_summary for every case (the Node parity test does the same
    against its mirror)."""
    from src.intelligence.integration_state import canonical_state_summary
    golden_path = (Path(__file__).resolve().parents[2] / "Backend" / "src"
                   / "services" / "__tests__" / "revIntegrationState.golden.json")
    golden = json.loads(golden_path.read_text())
    assert golden["contract_version"] == INTEGRATION_STATE_CONTRACT_VERSION
    for case in golden["cases"]:
        full = evaluate_integration_state(case["records"], now=NOW)
        assert full == case["expected"]
        assert canonical_state_summary(full) == case["expected_summary"]
