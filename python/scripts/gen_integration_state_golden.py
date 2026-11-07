"""Task 213: generate the canonical integration-state golden fixture.

Run (from the python/ directory):
    /home/user/.venv-rev/bin/python scripts/gen_integration_state_golden.py
or with any interpreter that has the project imports on the path:
    python scripts/gen_integration_state_golden.py

Writes Backend/src/services/__tests__/revIntegrationState.golden.json: the
authoritative evaluator outputs (Python) for a fixed evaluation timestamp and
a battery of records. The Node mirror test
(Backend/src/services/__tests__/revIntegrationState.test.js) feeds the same
records into revIntegrationState.evaluateIntegrationState and deep-compares
the results — this is what pins "two implementations, one contract"
(REV-DEC-0013) for rev-integration-state-v1.

Regenerate ONLY after a deliberate, documented change to the state machine in
python/src/intelligence/integration_state.py; update the Node mirror and the
docs in the same change.
"""
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.intelligence.integration_state import (  # noqa: E402
    INTEGRATION_STATE_CONTRACT_VERSION,
    canonical_state_summary,
    evaluate_integration_state,
    worst_state,
)

NOW = datetime(2026, 11, 7, 12, 0, 0, tzinfo=timezone.utc)

APP_SCOPES = "read_orders,read_customers,read_products,read_inventory,read_locations,read_legal_policies,read_online_store_navigation"
CRIT = ("store_domains", "products", "variants", "orders", "refunds", "inventory", "webhooks")
OPT = ("customers", "locations", "transactions", "fulfillments", "abandoned_checkouts")
TOPICS = (
    "orders/create", "orders/updated", "products/create", "products/update",
    "products/delete", "inventory_levels/updated",
    "shopify_payments/terms_of_service_acceptance", "app/uninstalled",
    "customers/data_request",
)


def _iso(dt):
    return dt.isoformat().replace("+00:00", "Z")


def _t(hours=1.0, minutes=None, days=None):
    delta = timedelta(hours=hours, minutes=minutes or 0, days=days or 0)
    return _iso(NOW - delta)


def store(status="active", scopes=APP_SCOPES, token=True, platform="shopify",
          updated_minutes=5, domain="test.myshopify.com"):
    return {
        "id": "11111111-1111-4111-8111-111111111111",
        "organization_id": "11111111-1111-4111-8111-222222222222",
        "platform": platform,
        "shop_domain": domain,
        "status": status,
        "granted_scopes": scopes,
        "access_token": "shpat_GOLDEN_SECRET_NEVER_IN_OUTPUT" if token else None,
        "installed_at": _t(days=10),
        "last_synced_at": _t(hours=1),
        "updated_at": _iso(NOW - timedelta(minutes=updated_minutes)),
    }


def dom(domain, status="ok", succeeded_hours=1.0, attempted_hours=1.0,
        attempted_minutes=None, retry=0, err=None, succeeded_days=None,
        attempted_days=None):
    succeeded = _t(days=succeeded_days) if succeeded_days is not None else _t(hours=succeeded_hours)
    if attempted_days is not None:
        attempted = _t(days=attempted_days)
    elif attempted_minutes is not None:
        attempted = _iso(NOW - timedelta(minutes=attempted_minutes))
    else:
        attempted = _t(hours=attempted_hours)
    return {
        "domain": domain, "status": status,
        "last_succeeded_at": succeeded, "last_attempted_at": attempted,
        "retry_count": retry,
        "records_discovered": 100, "records_inserted": 50, "records_updated": 50,
        "pages_completed": 10, "pagination_complete": True,
        "error_code": err,
        "error_since": _t(hours=2) if err else None,
    }


def full_domains():
    return [dom(d) for d in CRIT] + [dom(d) for d in OPT]


def webhook_failed_regs():
    out = []
    for topic in TOPICS:
        if topic == "orders/create":
            out.append({"topic": topic, "status": "failed", "last_error": "unreachable", "attempt_count": 3})
        else:
            out.append({"topic": topic, "status": "active", "last_error": None, "attempt_count": 1})
    return out


def without(domains, *names):
    return [d for d in domains if d["domain"] not in names]


def regs(mutate=None):
    out = []
    for topic in TOPICS:
        row = {"topic": topic, "status": "active", "last_error": None, "attempt_count": 1}
        if mutate:
            row = mutate(topic, row) or row
        out.append(row)
    return out


def processed_delivery():
    return [{"topic": "orders/create", "status": "processed",
             "received_at": _t(hours=1), "processed_at": _t(minutes=50)}]


def coverage(status="complete"):
    if status is None:
        return None
    return {"status": status, "start": _t(days=20), "end": _iso(NOW),
            "certified_at": _t(hours=1), "customer_lifetime_verified": False}


def records(store_row=None, domains=None, regs_=None, delivs=None, cov="complete",
            org="11111111-1111-4111-8111-222222222222"):
    return {
        "organization_id": org,
        "store": store_row if store_row is not None else store(),
        "domain_states": full_domains() if domains is None else domains,
        "webhook_registrations": regs() if regs_ is None else regs_,
        "webhook_deliveries": processed_delivery() if delivs is None else delivs,
        "order_coverage": coverage(cov),
    }


CASES = [
    ("connected_fully_authorized", records()),
    ("disconnected_no_record", {"organization_id": "11111111-1111-4111-8111-222222222222"}),
    ("authorization_revoked_record", records(store_row=store(status="revoked"))),
    ("authorization_revoked_uninstalled", records(store_row=store(status="app_uninstalled"))),
    ("disconnected_record", records(store_row=store(status="disconnected"))),
    ("authorization_required_no_token",
     records(store_row=store(status="active", token=False, scopes=None),
             domains=[], regs_=[], delivs=[], cov=None)),
    ("authorization_expired_token",
     records(domains=without(full_domains(), "orders") + [
         dom("orders", "failed", succeeded_days=3, attempted_hours=1, err="TOKEN_EXPIRED")])),
    ("authorization_required_permission_rejected",
     records(domains=without(full_domains(), "orders") + [
         dom("orders", "failed", succeeded_days=3, attempted_hours=1, err="FORBIDDEN_SCOPE")])),
    ("authorization_required_missing_critical_scope",
     records(store_row=store(scopes="read_products,read_orders,read_customers,read_locations"))),
    ("limited_access_missing_optional_scope",
     records(store_row=store(scopes="read_orders,read_products,read_inventory,read_locations,read_legal_policies,read_online_store_navigation"))),
    ("synchronizing_running",
     records(domains=without(full_domains(), "orders") + [
         dom("orders", "running", succeeded_days=2, attempted_minutes=5)])),
    ("synchronizing_queued",
     records(store_row=store(status="syncing", updated_minutes=1))),
    ("needs_attention_stalled_running",
     records(domains=without(full_domains(), "orders") + [
         dom("orders", "running", succeeded_days=2, attempted_days=1)])),
    ("needs_attention_stale_syncing_heartbeat",
     records(store_row=store(status="syncing", updated_minutes=60 * 24))),
    ("sync_partial_degraded_refunds",
     records(domains=without(full_domains(), "refunds") + [
         dom("refunds", "degraded")])),
    ("sync_failed_all_critical",
     records(domains=[dom(d, "failed", succeeded_days=3, err="NETWORK_TIMEOUT") for d in CRIT]
             + [dom(d) for d in OPT])),
    ("needs_attention_repeated_failure",
     records(domains=without(full_domains(), "orders") + [
         dom("orders", "failed", succeeded_days=3, retry=4, err="SHOPIFY_API_ERROR")])),
    ("needs_attention_webhook_failed",
     records(regs_=webhook_failed_regs(),
             delivs=[{"topic": "orders/create", "status": "failed",
                      "received_at": _t(hours=2), "processed_at": None}])),
    ("limited_access_no_webhook_flow", records(delivs=[])),
    ("limited_access_stale_orders",
     records(domains=without(full_domains(), "orders") + [dom("orders", "ok", succeeded_days=2)])),
    ("limited_access_partial_coverage", records(cov="partial")),
    ("limited_access_critical_never_synced",
     records(domains=without(full_domains(), "orders"))),
    ("limited_access_no_sync_yet",
     records(domains=[], regs_=[], delivs=[], cov=None)),
    ("limited_access_optional_failed",
     records(domains=without(full_domains(), "customers") + [
         dom("customers", "failed", succeeded_days=2, err="SHOPIFY_API_ERROR")])),
    ("unsupported_platform", records(store_row=store(platform="magento"))),
    ("unknown_unrecognized_status", records(store_row=store(status="weird_status"))),
    ("connected_no_recorded_scopes",
     records(store_row=store(scopes=None))),
    ("authorization_expired_beats_running_sync",
     records(domains=without(full_domains(), "products", "orders") + [
         dom("products", "running", succeeded_days=2, attempted_minutes=5),
         dom("orders", "failed", succeeded_days=3, attempted_hours=1, err="TOKEN_EXPIRED")])),
    ("limited_access_unverified_no_success",
     records(domains=[], delivs=[])),
]

ROLLUP_CASES = [
    (["connected", "connected", "sync_failed"], "sync_failed"),
    (["connected", "unknown"], "unknown"),
    (["disconnected", "needs_attention"], "needs_attention"),
    (["limited_access", "synchronizing"], "synchronizing"),
    (["authorization_revoked", "connected"], "authorization_revoked"),
    ([], None),
]

out = {
    "contract_version": INTEGRATION_STATE_CONTRACT_VERSION,
    "generated_by": "python/scripts/gen_integration_state_golden.py",
    "generated_at": _iso(NOW),
    "now": _iso(NOW),
    "cases": [
        {"name": name, "records": rec,
         "expected": evaluate_integration_state(rec, now=NOW),
         "expected_summary": canonical_state_summary(
             evaluate_integration_state(rec, now=NOW))}
        for name, rec in CASES
    ],
    "rollup_cases": [
        {"states": states, "expected": worst_state(states)} for states, _ in ROLLUP_CASES
    ],
}

target = ROOT.parent / "Backend" / "src" / "services" / "__tests__" / "revIntegrationState.golden.json"
target.write_text(json.dumps(out, indent=2, sort_keys=True, ensure_ascii=False) + "\n")
print(f"wrote {target} ({len(CASES)} cases, {len(ROLLUP_CASES)} rollup cases)")
