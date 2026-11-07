"""Task 201 — canonical integration evidence for Rev.

Establishes the real operational state of a merchant integration (Shopify)
from persisted, tenant-scoped evidence. The governing rule:

* A stored connection record is not a healthy integration.
* A granted scope is not effective authorization.
* An enqueued job is not a completed synchronization.
* A registered webhook is not working event processing.

Every state asserted here is derived from one of these persisted sources:

* ``stores`` — connection record, status, granted scopes, last sync time;
* ``store_sync_domain_states`` — per-domain synchronization ledger
  (status, outcomes, retries, pagination completeness, timestamps);
* ``webhook_registrations`` / ``webhook_deliveries`` — registration and
  delivery/processing evidence;
* ``store_profiles`` / ``store_domains`` — store metadata sync;
* ``intelligence_order_coverage`` — certified order history coverage.

The result carries Task 197 evidence-contract items (stable ids, coverage,
freshness, limitations) so Rev can cite exactly why a capability is or is
not operational, and it never exposes access tokens, webhook secrets or
un-sanitized error prose.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta
from typing import Any

from .evidence import (
    STATUS_AVAILABLE,
    STATUS_PARTIAL,
    UNIT_REFERENCE,
    evidence_context,
    evidence_item,
    ensure_utc,
    iso,
    utc_now,
)
from .query import safe_query

# ── Capability map ───────────────────────────────────────────────────────────
# Mirrors the Node resource registry (Backend/src/services/resourceRegistry.js)
# for the resources the current build implements. ``domain`` is the
# store_sync_domain_states ledger domain that proves the resource; resources
# without an implemented sync domain report sync capability ``unsupported``.
# ``critical`` marks MVP-essential capabilities: their failure changes overall
# health, while optional failures are warnings.

INTEGRATION_RESOURCES: tuple[dict, ...] = (
    # Critical MVP capabilities.
    {"id": "shop.identity", "domain": "store_domains", "scopes": (),
     "approval": "none", "critical": True, "category": "store_configuration",
     "note": "Store profile, plan, currency and timezone metadata."},
    {"id": "products", "domain": "products", "scopes": ("read_products",),
     "approval": "none", "critical": True, "category": "catalogue",
     "note": "Product catalogue synced with complete pagination."},
    {"id": "product.variants", "domain": "variants", "scopes": ("read_products",),
     "approval": "none", "critical": True, "category": "catalogue",
     "note": "Variant pricing and availability."},
    {"id": "orders", "domain": "orders", "scopes": ("read_orders",),
     "approval": "read_all_orders", "critical": True, "category": "orders",
     "note": "Order history; full history requires read_all_orders app approval "
             "and otherwise defaults to a 60-day window."},
    {"id": "order.line_items", "domain": "orders", "scopes": ("read_orders",),
     "approval": "none", "critical": True, "category": "orders",
     "note": "Order line items synchronized with their order."},
    {"id": "order.refunds", "domain": "refunds", "scopes": ("read_orders",),
     "approval": "none", "critical": True, "category": "orders",
     "note": "Itemised refund ledger; revenue figures reconcile against it."},
    {"id": "inventory.items", "domain": "inventory", "scopes": ("read_inventory",),
     "approval": "none", "critical": True, "category": "inventory",
     "note": "Inventory items linked to variants."},
    {"id": "inventory.levels", "domain": "inventory", "scopes": ("read_inventory",),
     "approval": "none", "critical": True, "category": "inventory",
     "note": "Inventory quantities per location."},
    {"id": "webhooks", "domain": "webhooks", "scopes": (),
     "approval": "none", "critical": True, "category": "primitives",
     "note": "Webhook registrations keep the snapshot current between full syncs."},
    # Optional / consent-gated / detail capabilities.
    {"id": "inventory.locations", "domain": "locations", "scopes": ("read_locations",),
     "approval": "none", "critical": False, "category": "inventory",
     "note": "Fulfillment and inventory locations."},
    {"id": "order.transactions", "domain": "transactions", "scopes": ("read_orders",),
     "approval": "none", "critical": False, "category": "orders",
     "note": "Payment transaction ledger (captured money attribution)."},
    {"id": "order.fulfillments", "domain": "fulfillments", "scopes": ("read_orders",),
     "approval": "none", "critical": False, "category": "orders",
     "note": "Fulfillment status and tracking."},
    {"id": "order.returns", "domain": None, "scopes": ("read_returns",),
     "approval": "none", "critical": False, "category": "orders",
     "note": "Returns synchronized with order enrichment; no dedicated ledger."},
    {"id": "customers", "domain": "customers", "scopes": ("read_customers",),
     "approval": "protected_customer_data", "critical": False, "category": "customers",
     "note": "Customer profiles; protected customer data requires separate "
             "Shopify app approval beyond the OAuth scope."},
    {"id": "abandoned-checkouts", "domain": "abandoned_checkouts",
     "scopes": ("read_checkouts",), "approval": "none", "critical": False,
     "category": "checkouts",
     "note": "Abandoned checkout activity."},
    {"id": "discount-nodes", "domain": None, "scopes": ("read_discounts",),
     "approval": "none", "critical": False, "category": "discounts",
     "note": "Discount nodes and codes (read-only)."},
    {"id": "collections", "domain": None, "scopes": ("read_products",),
     "approval": "none", "critical": False, "category": "catalogue",
     "note": "Collections; synchronized with product enrichment."},
    {"id": "content.pages", "domain": None, "scopes": ("read_content",),
     "approval": "none", "critical": False, "category": "content",
     "note": "Store pages."},
    {"id": "content.blogs", "domain": None, "scopes": ("read_content",),
     "approval": "none", "critical": False, "category": "content",
     "note": "Blogs and articles."},
    {"id": "themes", "domain": None, "scopes": ("read_themes",),
     "approval": "none", "critical": False, "category": "content",
     "note": "Theme list and roles."},
    {"id": "shop.shipping_configuration", "domain": None, "scopes": ("read_shipping",),
     "approval": "none", "critical": False, "category": "store_configuration",
     "note": "Delivery profiles and shipping rate data."},
    {"id": "shop.taxes", "domain": None, "scopes": ("read_products",),
     "approval": "none", "critical": False, "category": "store_configuration",
     "note": "Tax configuration visibility."},
)

RESOURCE_BY_ID = {entry["id"]: entry for entry in INTEGRATION_RESOURCES}
SYNC_DOMAINS = {entry["domain"] for entry in INTEGRATION_RESOURCES if entry["domain"]}

# Freshness policy per sync domain (seconds), kept consistent with the Node
# gateway (revEvidenceService.DOMAIN_FRESHNESS).
DOMAIN_FRESH_SECONDS = {
    "orders": 3600, "transactions": 3600, "refunds": 3600, "inventory": 1800,
    "customers": 4 * 3600, "products": 2 * 3600, "variants": 2 * 3600,
    "content": 24 * 3600, "discounts": 3600, "abandoned_checkouts": 1800,
    "fulfillments": 4 * 3600, "locations": 24 * 3600, "store_domains": 24 * 3600,
    "webhooks": 24 * 3600,
}
DEFAULT_FRESH_SECONDS = 2 * 3600

# Connection record states Revluma persists for stores.
_ACTIVE_STORE_STATUSES = ("active", "connected", "syncing")
_DISCONNECTED_STORE_STATUSES = ("disconnected", "revoked", "inactive", "deleted", "not_connected")

# Error-code classification for the sync ledger. The ledger stores a short
# code (not raw prose); these patterns map it to a stable failure class.
_AUTH_ERROR_RE = re.compile(r"ACCESS_DENIED|PERMISSION|SCOPE|403|FORBIDDEN", re.I)
_TOKEN_ERROR_RE = re.compile(r"TOKEN_(EXPIRED|INVALID)|EXPIRED|401|UNAUTHORIZED|OAUTH", re.I)
_RATE_LIMIT_RE = re.compile(r"RATE_?LIMIT|429|THROTTLED", re.I)
_NETWORK_ERROR_RE = re.compile(r"TIMEOUT|ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN|NETWORK|502|503|504", re.I)
_PAGINATION_ERROR_RE = re.compile(r"PAGINATION|CURSOR|PAGE", re.I)
_DATABASE_ERROR_RE = re.compile(r"SQL|DATABASE|PGRST|UNIQUE|DEADLOCK|SERIALIZATION", re.I)
_SCHEDULER_ERROR_RE = re.compile(r"SCHEDUL|QUEUE|WORKER|LOCK", re.I)


def classify_failure(error_code: str | None, ledger_status: str | None = None) -> str:
    """Map a persisted ledger error code to a stable, safe failure class.

    The raw code is short and non-sensitive by construction (the ledger
    writer truncates it to 120 chars and stores codes, not payloads); this
    classifier only reads it and never the full error prose.
    """
    code = str(error_code or "").strip()
    if not code:
        return "unknown" if ledger_status in ("failed", "degraded") else "none"
    if _AUTH_ERROR_RE.search(code):
        return "authorization"
    if _TOKEN_ERROR_RE.search(code):
        return "authentication"
    if _RATE_LIMIT_RE.search(code):
        return "rate_limit"
    if _PAGINATION_ERROR_RE.search(code):
        return "pagination"
    if _DATABASE_ERROR_RE.search(code):
        return "database"
    if _SCHEDULER_ERROR_RE.search(code):
        return "scheduler"
    if _NETWORK_ERROR_RE.search(code):
        return "network"
    return "shopify_api" if ledger_status in ("failed", "degraded") else "unknown"


def _row_value(row: Any, key: str, default=None):
    try:
        return row[key]
    except (KeyError, IndexError, TypeError):
        return getattr(row, key, default)


def _int(value: Any) -> int | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _granted_scopes(raw: Any) -> list[str]:
    return [part.strip() for part in str(raw or "").split(",") if part.strip()]


def _scope_satisfied(granted: list[str], required: str) -> bool:
    """A read scope is satisfied by the matching write scope (Shopify semantics)."""
    if required in granted:
        return True
    if required.startswith("read_") and f"write_{required[5:]}" in granted:
        return True
    return False


def _freshness(domain: str, as_of: datetime | None, status: str | None, now: datetime) -> dict:
    policy = DOMAIN_FRESH_SECONDS.get(domain, DEFAULT_FRESH_SECONDS)
    if status == "running":
        return {"state": "synchronizing", "as_of": iso(as_of), "age_seconds": None,
                "policy": f"{policy}s",
                "note": "Synchronization is in progress; no completed result is asserted."}
    if as_of is None:
        return {"state": "never_synchronized", "as_of": None, "age_seconds": None,
                "policy": f"{policy}s",
                "note": "No successful synchronization timestamp is available."}
    age = max(0, int((now - as_of).total_seconds()))
    state = "fresh" if age <= policy else ("aging" if age <= policy * 2 else "stale")
    return {"state": state, "as_of": iso(as_of), "age_seconds": age,
            "policy": f"{policy}s",
            "note": f"Domain freshness policy: fresh <= {policy}s, aging <= {policy * 2}s."}


def _connection_state(store: dict | None, domains: dict[str, dict]) -> tuple[str, list[str]]:
    """Derive an explicit connection state from the record plus ledger evidence.

    Returns ``(state, notes)``. The record alone proves at most that an
    installation exists; ledger authentication errors downgrade it because
    they are the latest observed behaviour of the credentials.
    """
    notes: list[str] = []
    if store is None:
        return "not_installed", ["No Shopify installation record exists for this organization."]
    status = str(store.get("status") or "unknown")
    if status in ("disconnected", "revoked"):
        return status, ["The integration is recorded as " + status + "."]
    if status in _DISCONNECTED_STORE_STATUSES:
        return "disconnected", [f"The store record is in state '{status}'."]
    if status not in _ACTIVE_STORE_STATUSES:
        return "unknown", [f"Unrecognized store status '{status}'; connection state is unknown."]
    if not store.get("has_token"):
        notes.append("The store record carries no access token; no API call can be authenticated.")
        return "authentication_invalid", notes
    if status == "syncing" and store.get("last_synced_at") is None:
        return "installation_pending", ["Installation completed but the first synchronization has not run."]
    # Active record with a token: check the latest observed credential behaviour.
    auth_failures = [
        (domain, state) for domain, state in domains.items()
        if state["state"] in ("failed", "partial") and state["failure_class"] == "authentication"
    ]
    if auth_failures:
        worst = max(auth_failures, key=lambda pair: pair[1]["attempted"] or datetime.min.replace(tzinfo=None))
        notes.append(
            "The most recent synchronization evidence indicates the credentials were "
            f"rejected by Shopify (domain: {worst[0]}); the connection is not verified as "
            "currently valid.")
        return "verification_failed", notes
    return "authenticated", ["Connection record is active with stored credentials; validity is "
                             "established by the most recent successful synchronization below."]


def _resource_capability(resource: dict, granted: list[str], domain_state: dict | None,
                         now: datetime) -> dict:
    """Evaluate one resource: authorization, retrieval and sync capability."""
    rid = resource["id"]
    scopes_recorded = bool(granted)
    # A recorded-but-incomplete scope list is an authorization gap. A store
    # record with NO scope list at all is a data gap, not proof of a missing
    # grant — capability then rests on observed synchronization behaviour.
    missing = ([scope for scope in resource["scopes"]
                if not _scope_satisfied(granted, scope)] if scopes_recorded else [])
    approval = resource.get("approval", "none")
    restrictions: list[str] = []
    if approval == "read_all_orders":
        restrictions.append("Full order history requires read_all_orders application approval; "
                            "until granted the available window is bounded (60 days).")
    elif approval == "protected_customer_data":
        restrictions.append("Protected customer data requires separate Shopify app approval "
                            "beyond the OAuth scope; merchant consent may also limit fields.")
    elif approval not in (None, "none"):
        restrictions.append(f"Platform approval or plan gate applies: {approval}.")
    if resource["note"]:
        restrictions.append(resource["note"])

    ledger = domain_state or {}
    freshness = ledger.get("freshness") or {
        "state": "never_synchronized", "as_of": None, "age_seconds": None,
        "policy": f"{DOMAIN_FRESH_SECONDS.get(resource['domain'], DEFAULT_FRESH_SECONDS)}s",
        "note": "No successful synchronization timestamp is available."}

    if missing:
        authorization = {"state": "missing_scope", "missing_scopes": missing,
                         "effective": False,
                         "note": f"Required Shopify authorization is not granted: {', '.join(missing)}."}
    elif not scopes_recorded:
        # The store record carries no scope list at all: that is a data gap,
        # not proof of a missing grant. Access is proven only by sync.
        if ledger.get("state") == "succeeded":
            authorization = {"state": "effective_verified", "missing_scopes": [],
                             "effective": True,
                             "note": "No granted scopes are recorded on the store record, "
                                     "but a successful synchronization proves current access."}
        else:
            authorization = {"state": "unverified_unrecorded", "missing_scopes": [],
                             "effective": False,
                             "note": "No granted scopes are recorded on the store record, "
                                     "and no successful synchronization has proven current "
                                     "access; the record alone is not asserted."}
    elif approval == "protected_customer_data":
        authorization = {"state": "granted_approval_pending", "missing_scopes": [],
                         "effective": ledger.get("state") == "succeeded",
                         "note": "OAuth scope is granted, but protected customer data also "
                                 "requires app approval; effective access is established only "
                                 "by a successful retrieval."}
    elif approval not in (None, "none"):
        authorization = {"state": "granted_with_platform_gate", "missing_scopes": [],
                         "effective": ledger.get("state") == "succeeded",
                         "note": "Scope is granted; platform approval or plan gates may still "
                                 "limit the resource."}
    elif ledger.get("state") == "succeeded":
        authorization = {"state": "effective_verified", "missing_scopes": [],
                         "effective": True,
                         "note": "A successful authorized retrieval proves current access."}
    else:
        authorization = {"state": "granted_unverified", "missing_scopes": [],
                         "effective": False,
                         "note": "The scope is recorded as granted, but no successful retrieval "
                                 "has verified current access; granted is not proof of access."}

    if resource["domain"] is None:
        sync = {"state": "unsupported", "note": "No dedicated synchronization ledger domain "
                                                "exists for this resource in the current build."}
    else:
        sync = {key: ledger.get(key) for key in
                ("state", "retry_count",
                 "records_discovered", "records_inserted", "records_updated",
                 "pagination_complete", "pages_completed", "failure_class",
                 "error_code", "stale")}
        sync["last_succeeded_at"] = iso(ledger.get("last_succeeded_at"))
        sync["last_attempted_at"] = iso(ledger.get("last_attempted_at"))
        sync["freshness"] = freshness
        sync["note"] = ledger.get("note", "")

    if ledger.get("state") == "running" and ledger.get("last_succeeded_at") is not None:
        prior = _freshness(resource["domain"], ledger.get("last_succeeded_at"), "ok", now)
        running_on_recent_success = (
            prior["state"] in ("fresh", "aging")
            and ledger.get("pagination_complete") is True)
    else:
        running_on_recent_success = False
    operational = (
        not missing
        and (
            (ledger.get("state") == "succeeded"
             and ledger.get("pagination_complete") is True
             and freshness["state"] in ("fresh", "aging")
             and not ledger.get("stale"))
            or running_on_recent_success
        )
    )
    return {
        "resource_id": rid,
        "category": resource["category"],
        "critical": resource["critical"],
        "supported": True,
        "authorization": authorization,
        "sync": sync,
        "operational": operational,
        "restrictions": restrictions,
    }


def _webhook_evidence(registrations: list[dict], deliveries: list[dict], now: datetime) -> dict:
    """Registration is not processing: both halves are reported separately."""
    topics: dict[str, dict] = {}
    for row in registrations:
        topic = str(_row_value(row, "topic") or "unknown")
        status = str(_row_value(row, "status") or "unknown")
        error_code = str(_row_value(row, "last_error") or "")[:80] or None
        entry = topics.setdefault(topic, {"topics": [], "statuses": []})
        entry["statuses"].append(status)
    topic_states = {topic: entry for topic, entry in topics.items()}
    registration_failed = [topic for topic, entry in topic_states.items()
                           if any(s in ("failed", "error") for s in entry["statuses"])]
    registration_active = [topic for topic, entry in topic_states.items()
                           if any(s in ("active", "pending", "created") for s in entry["statuses"])]

    recent = now - timedelta(days=7)
    processed = [d for d in deliveries if str(_row_value(d, "status")) == "processed"]
    failed = [d for d in deliveries if str(_row_value(d, "status")) == "failed"]
    received = [d for d in deliveries if isinstance(_row_value(d, "received_at"), datetime)
                and ensure_utc(_row_value(d, "received_at")) >= recent]
    processed_recent = [d for d in processed if isinstance(_row_value(d, "processed_at"), datetime)
                        and ensure_utc(_row_value(d, "processed_at")) >= recent]
    last_received = max((ensure_utc(_row_value(d, "received_at")) for d in received), default=None)
    last_processed = max((ensure_utc(_row_value(d, "processed_at")) for d in processed_recent), default=None)
    last_failure = max((ensure_utc(_row_value(d, "received_at")) for d in failed
                        if isinstance(_row_value(d, "received_at"), datetime)), default=None)
    lags = []
    for d in processed_recent:
        rec, proc = _row_value(d, "received_at"), _row_value(d, "processed_at")
        if isinstance(rec, datetime) and isinstance(proc, datetime):
            lags.append(int((ensure_utc(proc) - ensure_utc(rec)).total_seconds()))
    p95_lag = sorted(lags)[int(0.95 * (len(lags) - 1))] if lags else None

    if not registrations:
        state = "not_registered"
        note = "No webhook registrations are recorded; the store relies on full scheduled " \
               "synchronization only, so data between syncs can be missed."
    elif failed and not processed_recent:
        state = "failed"
        note = "Webhook deliveries are failing and no recent event was processed successfully."
    elif processed_recent and not failed:
        state = "healthy"
        note = "Recent webhook events were delivered and processed successfully."
    elif processed_recent:
        state = "degraded"
        note = "Recent events were processed, but some deliveries failed; check the failing " \
               "topics and their affected resources."
    elif received and not processed_recent:
        state = "degraded"
        note = "Webhook events are arriving but none was processed successfully in the last " \
               "seven days; delivery is working, processing is not."
    elif registrations:
        state = "unknown"
        note = "Webhooks are registered but no event was observed in the last seven days; this " \
               "can mean either a quiet store or that events are not arriving. A registered " \
               "webhook does not prove events are flowing."
    return {
        "state": state,
        "note": note,
        "registered_topics": sorted(topic_states),
        "active_topics": sorted(registration_active),
        "failed_topics": sorted(registration_failed),
        "registrations": len(registrations),
        "failures_last_7d": len(failed),
        "delivered_last_7d": len(received),
        "processed_last_7d": len(processed_recent),
        "last_received_at": iso(last_received),
        "last_processed_at": iso(last_processed),
        "last_failure_at": iso(last_failure),
        "processing_lag_p95_seconds": p95_lag,
        "duplicate_handling": "Deduplicated at claim time on (provider, delivery id); repeated "
                              "deliveries of one event are not processed twice.",
        "limitations": ["Webhook secrets and raw delivery headers are never included.",
                        "Failed deliveries are counted, not quoted, to avoid leaking payload data."],
    }


def _domain_states(rows: list) -> dict[str, dict]:
    """Normalize store_sync_domain_states rows into per-domain state blocks."""
    result: dict[str, dict] = {}
    for row in rows:
        domain = str(_row_value(row, "domain") or "")
        if not domain:
            continue
        status = str(_row_value(row, "status") or "never_run")
        succeeded = _row_value(row, "last_succeeded_at")
        attempted = _row_value(row, "last_attempted_at") or _row_value(row, "last_checked_at")
        error_code = _row_value(row, "error_code")
        failure_class = classify_failure(error_code, status)
        result[domain] = {
            "status": status,
            "last_succeeded_at": succeeded if isinstance(succeeded, datetime) else None,
            "last_attempted_at": attempted if isinstance(attempted, datetime) else None,
            "retry_count": _int(_row_value(row, "retry_count")) or 0,
            "records_discovered": _int(_row_value(row, "records_discovered")),
            "records_inserted": _int(_row_value(row, "records_inserted")),
            "records_updated": _int(_row_value(row, "records_updated")),
            "pages_completed": _int(_row_value(row, "pages_completed")),
            "pagination_complete": bool(_row_value(row, "pagination_complete") is True),
            "error_code": str(error_code)[:120] if error_code else None,
            "failure_class": failure_class,
            "attempted": attempted if isinstance(attempted, datetime) else None,
        }
    return result


def _normalize_domain_states(rows: list, now: datetime) -> dict[str, dict]:
    """Turn ledger rows into per-domain state blocks with an explicit state.

    The latest observed attempt dominates the state (a failed attempt is
    never reported as merely "not yet synchronized"):

    * ``running``                  -> ``running`` (pending; nothing asserted)
    * ``failed``                   -> ``failed`` (latest attempt failed)
    * ``degraded``                 -> ``partial`` (completed with gaps)
    * ``never_run`` / no success   -> ``never_synchronized``
    * ``ok`` with stale freshness  -> ``succeeded`` + ``stale=True``
    * ``ok`` fresh/aging           -> ``succeeded``
    """
    states = _domain_states(rows)
    # Every known sync domain is reported, even when no ledger row exists yet:
    # an unsynchronized capability must surface as never_synchronized, not
    # simply disappear from the evidence.
    for domain in SYNC_DOMAINS:
        states.setdefault(domain, {
            "status": "never_run",
            "last_succeeded_at": None,
            "last_attempted_at": None,
            "retry_count": 0,
            "records_discovered": None,
            "records_inserted": None,
            "records_updated": None,
            "pages_completed": None,
            "pagination_complete": False,
            "error_code": None,
            "failure_class": "none",
            "attempted": None,
        })
    for domain, state in states.items():
        freshness = _freshness(domain, state["last_succeeded_at"], state["status"], now)
        state["freshness"] = freshness
        status = state["status"]
        if status == "running":
            state.update(state="running", stale=False,
                         note="Synchronization is in progress; no completed result is asserted.")
        elif status == "failed":
            state.update(state="failed", stale=False,
                         note=(f"Latest synchronization attempt did not complete "
                               f"({state['error_code'] or 'error'}); the previous successful "
                               "result, if any, still bounds usable data."))
        elif status == "degraded":
            state.update(state="partial", stale=False,
                         note="Synchronization completed with gaps or incomplete pagination; "
                              "data is usable but not certified complete.")
        elif status == "never_run" or state["last_succeeded_at"] is None:
            state.update(state="never_synchronized", stale=False,
                         note="No completed synchronization has been recorded for this domain.")
        else:
            stale = freshness["state"] == "stale"
            state.update(
                state="succeeded", stale=stale,
                note=("Synchronization completed but is now older than the "
                      f"{freshness['policy']} policy; treat data as stale, not current."
                      if stale else "Synchronization completed."))
    return states


def _evaluate_health(store: dict | None, connection: tuple[str, list[str]],
                     capabilities: list[dict], domains: dict[str, dict],
                     webhooks: dict, coverage: dict, now: datetime) -> dict:
    """Deterministic overall integration health from the evidence above.

    Rules, in precedence order (first match wins for the overall state):

    1. no installation record, or a recorded disconnect/revocation
       -> ``disconnected``
    2. credentials rejected by the latest sync evidence
       -> ``attention_required`` (merchant must reconnect the store)
    3. the first synchronization has not completed yet (installation
       pending, no domain ever succeeded) -> ``verification_pending``
    4. any critical capability not operational and every such failure is an
       authorization/authentication one -> ``unauthorized``; otherwise a
       critical failure                -> ``partially_operational``
    5. only optional problems (optional failures, webhook failures, silent
       or unregistered webhooks, aging freshness, incomplete coverage)
       -> ``degraded``
    6. all critical capabilities operational and fresh -> ``healthy``
    7. connection record unrecognized/contradictory, or core evidence
       missing -> ``unknown``
    """
    conn_state, conn_notes = connection
    critical = [c for c in capabilities if c["critical"]]
    optional = [c for c in capabilities if not c["critical"]]
    critical_failures: list[dict] = []
    for cap in critical:
        if cap["operational"]:
            continue
        sync_state = (cap["sync"] or {}).get("state")
        auth_state = cap["authorization"]["state"]
        if auth_state in ("missing_scope",):
            reason, error_class = "missing_scope", "authorization"
        elif sync_state in ("failed",) or (sync_state == "partial" and (cap["sync"] or {}).get("failure_class") in ("authentication", "authorization")):
            reason = f"sync_{(cap['sync'] or {}).get('failure_class') or 'failed'}"
            error_class = (cap["sync"] or {}).get("failure_class") or "sync_failure"
        elif (cap["sync"] or {}).get("stale"):
            reason, error_class = "stale", "stale"
        elif sync_state == "running":
            reason, error_class = "synchronizing", "synchronizing"
        elif sync_state in ("never_synchronized", None):
            reason, error_class = "never_synchronized", "never_synchronized"
        elif sync_state == "unsupported":
            reason, error_class = "sync_unsupported", "unsupported"
        else:
            reason, error_class = f"sync_{sync_state or 'not_operational'}", "sync_failure"
        critical_failures.append({
            "resource_id": cap["resource_id"], "reason": reason, "class": error_class,
            "detail": cap["authorization"]["note"] if auth_state == "missing_scope"
            else (cap["sync"] or {}).get("note", ""),
        })

    warnings: list[str] = []
    stale_resources = sorted({cap["resource_id"] for cap in capabilities
                              if (cap["sync"] or {}).get("stale")})
    optional_unavailable: list[dict] = []
    for cap in optional:
        if cap["operational"]:
            continue
        sync = cap["sync"] or {}
        sync_state = sync.get("state")
        if sync.get("stale"):
            continue  # already counted in stale_resources
        if sync.get("failure_class") in ("authorization", "authentication") and sync_state in ("failed", "partial"):
            warnings.append(f"{cap['resource_id']}: latest synchronization was rejected "
                            f"({sync.get('failure_class')}).")
        elif sync_state in ("failed", "partial"):
            warnings.append(f"{cap['resource_id']}: latest synchronization "
                            f"{sync_state} ({sync.get('error_code') or 'error'}).")
        elif cap["authorization"]["state"] == "missing_scope":
            optional_unavailable.append({
                "resource_id": cap["resource_id"],
                "reason": "missing_scope",
                "missing_scopes": cap["authorization"]["missing_scopes"],
                "detail": cap["authorization"]["note"],
            })
        elif sync_state == "unsupported":
            optional_unavailable.append({
                "resource_id": cap["resource_id"],
                "reason": "sync_unsupported",
                "missing_scopes": [],
                "detail": sync.get("note", "No dedicated sync ledger domain for this resource."),
            })
        elif sync_state == "never_synchronized":
            optional_unavailable.append({
                "resource_id": cap["resource_id"],
                "reason": "never_synchronized",
                "missing_scopes": [],
                "detail": "No completed synchronization recorded for this optional resource yet.",
            })
    if webhooks["state"] in ("failed", "degraded"):
        warnings.append(f"Webhook health is {webhooks['state']}: {webhooks['note']}")
    if webhooks["state"] == "not_registered":
        warnings.append(webhooks["note"])
    if coverage.get("status") != "complete":
        warnings.append("Certified order-history coverage is not complete for every store; "
                        "historical evidence may be bounded.")
    if any("No granted scopes are recorded" in cap["authorization"]["note"]
           for cap in capabilities):
        warnings.append("No granted Shopify scopes are recorded on this store's record; "
                        "capability states rest on observed synchronization behaviour.")

    critical_missing = sorted({
        scope for cap in critical for scope in cap["authorization"]["missing_scopes"]
    })
    optional_missing = sorted({
        scope for cap in optional for scope in cap["authorization"]["missing_scopes"]
    })
    critical_auth_failed = [cap["resource_id"] for cap in critical
                            if (cap["sync"] or {}).get("failure_class") in ("authorization", "authentication")
                            and (cap["sync"] or {}).get("state") in ("failed", "partial")]
    unsupported = sorted(entry["resource_id"] for entry in optional_unavailable
                         if entry["reason"] == "sync_unsupported")

    any_succeeded = any(state["last_succeeded_at"] is not None for state in domains.values())
    # Real (as opposed to merely unproven) problems with OPTIONAL resources: a
    # sync that ran and failed, or data that went stale. Never-synchronized,
    # missing-scope and no-ledger optionals are availability limits, not
    # failures, and must not degrade an otherwise-healthy store.
    optional_real_failures = [
        cap["resource_id"] for cap in optional
        if (cap["sync"] or {}).get("state") in ("failed", "partial")
    ]
    if conn_state in ("not_installed", "disconnected", "revoked"):
        overall = "disconnected"
    elif conn_state in ("verification_failed", "authentication_invalid"):
        overall = "attention_required"
    elif conn_state == "installation_pending" and not any_succeeded:
        # First synchronization has not completed yet: nothing is proven or
        # disproven, so the state is verification pending, not a failure.
        overall = "verification_pending"
    elif conn_state == "unknown":
        # The record contradicts itself or uses an unrecognized state: the
        # whole integration is unknown until the record is reconciled.
        overall = "unknown"
    elif critical_failures:
        auth_only = all(f["class"] in ("authorization", "authentication") for f in critical_failures)
        overall = "unauthorized" if auth_only else "partially_operational"
    elif webhooks["state"] == "failed":
        overall = "partially_operational"
    elif optional_real_failures or stale_resources \
            or webhooks["state"] in ("degraded", "unknown", "not_registered") \
            or coverage.get("status") != "complete":
        overall = "degraded"
    elif conn_state == "authenticated":
        overall = "healthy"
    else:
        overall = "unknown"

    # Explainable score: informational only — the state, not the number, is
    # authoritative, and real critical failures always cap the score below 60.
    stale_critical = [f for f in critical_failures if f["class"] == "stale"]
    unproven_critical = [f for f in critical_failures
                         if f["class"] in ("never_synchronized", "synchronizing")]
    real_critical = [f for f in critical_failures
                     if f["class"] not in ("stale", "never_synchronized", "synchronizing")]
    score = 100
    score -= 25 * len(real_critical)
    score -= 5 * len(unproven_critical)
    score -= 10 * len(stale_resources)
    score -= 5 * len(optional_real_failures)
    if webhooks["state"] in ("failed", "degraded"):
        score -= 15
    elif webhooks["state"] == "unknown":
        score -= 10
    if coverage.get("status") != "complete":
        score -= 5
    if overall in ("healthy", "verification_pending"):
        score = max(score, 70)
    if real_critical:
        score = min(score, 59)
    score = max(0, min(100, score))

    return {
        "overall_status": overall,
        "score": score,
        "score_formula": "100 - 25 per real critical failure - 5 per never-synchronized critical "
                         "capability - 10 per stale resource - 5 per failed optional capability "
                         "- 15 for webhook failures (10 when silent) - 5 for incomplete coverage; "
                         "floored at 70 when healthy/verification pending; capped at 59 while any "
                         "real critical failure exists. The overall_status, not the score, is "
                         "authoritative.",
        "components": {
            "authentication": _component_auth(conn_state, domains),
            "authorization": "failed" if critical_missing or critical_auth_failed
                             else ("degraded" if optional_missing else "healthy"),
            "synchronization": "failed" if any(not c["operational"] for c in critical)
                               else ("degraded" if optional_real_failures else "healthy"),
            "webhooks": {"healthy": "healthy", "failed": "failed", "degraded": "degraded",
                         "unknown": "unknown", "not_registered": "degraded"}.get(webhooks["state"], "unknown"),
            "freshness": "healthy" if not stale_resources else "degraded",
            "coverage": coverage.get("status", "unknown"),
        },
        "critical_failures": critical_failures,
        "warnings": warnings,
        "unsupported": unsupported,
        "missing_permissions": sorted(set(critical_missing + optional_missing)),
        "optional_unavailable": optional_unavailable,
        "stale_resources": stale_resources,
        "syncing_domains": sorted(d for d, s in domains.items() if s["state"] == "running"),
        "connection_notes": conn_notes,
        "last_verified_at": iso(now),
    }


def _component_auth(conn_state: str, domains: dict[str, dict]) -> str:
    if conn_state in ("not_installed", "disconnected", "revoked"):
        return "disconnected"
    if conn_state == "verification_failed":
        return "failed"
    auth_failed = [d for d, s in domains.items()
                   if s["state"] in ("failed", "partial") and s["failure_class"] == "authentication"]
    if auth_failed:
        return "degraded"
    if conn_state in ("authenticated", "installation_pending"):
        return "healthy"
    return "unknown"


_STORE_SQL = """
    SELECT s.id, s.platform, s.status, s.shop_domain, s.granted_scopes,
           s.last_synced_at, s.installed_at, s.updated_at,
           (s.access_token IS NOT NULL) AS has_token
    FROM stores s
    WHERE s.organization_id = :org_id
      AND s.status NOT IN ('deleted')
"""


def _store_sql(store_id: str | None) -> str:
    extra = " AND s.id = :store_id" if store_id else ""
    return _STORE_SQL.replace("WHERE s.organization_id = :org_id",
                              f"WHERE s.organization_id = :org_id{extra}")


def retrieve_integration_evidence(
    organization_id: str,
    db,
    *,
    store_id: str | None = None,
    now: datetime | None = None,
) -> dict:
    """Retrieve canonical integration evidence for an authenticated organization.

    ``organization_id`` must come from the authenticated request context; a
    client-supplied organization is never accepted. ``store_id`` optionally
    narrows the result to one store that must belong to the organization.
    No tokens, secrets or un-sanitized error prose are ever included.
    """
    if not organization_id or not isinstance(organization_id, str):
        raise ValueError("Authenticated organization is required")
    now = ensure_utc(now or utc_now(), field="now")

    params: dict[str, Any] = {"org_id": organization_id}
    if store_id:
        params["store_id"] = store_id

    stores, store_error = safe_query(db, _store_sql(store_id), params)
    if store_error:
        return {
            "schema_version": "rev-evidence-v2",
            "metric_family": "integration",
            "retrieved_at": iso(now),
            "overall_status": "unknown",
            "items": [],
            "stores": [],
            "warnings": ["Store records could not be read; no integration claim is possible."],
            "limitations": ["Integration evidence is unavailable; no capability is asserted."],
        }
    if not stores:
        return {
            "schema_version": "rev-evidence-v2",
            "metric_family": "integration",
            "retrieved_at": iso(now),
            "overall_status": "disconnected",
            "items": [],
            "stores": [],
            "warnings": ["No Shopify store is installed for this organization."],
            "limitations": ["No integration is configured; no capability is available."],
        }

    store_ids = [str(_row_value(row, "id")) for row in stores]
    items: list[dict] = []
    stores_out: list[dict] = []
    with evidence_context(organization_id, store_ids):
        for row in stores:
            store = {
                "id": str(_row_value(row, "id")),
                "platform": str(_row_value(row, "platform") or ""),
                "status": str(_row_value(row, "status") or "unknown"),
                "shop_domain": _row_value(row, "shop_domain"),
                "granted_scopes": _granted_scopes(_row_value(row, "granted_scopes")),
                "last_synced_at": _row_value(row, "last_synced_at")
                if isinstance(_row_value(row, "last_synced_at"), datetime) else None,
                "installed_at": _row_value(row, "installed_at")
                if isinstance(_row_value(row, "installed_at"), datetime) else None,
                "updated_at": _row_value(row, "updated_at")
                if isinstance(_row_value(row, "updated_at"), datetime) else None,
                "has_token": bool(_row_value(row, "has_token")),
            }
            sid = store["id"]
            store_params = {"org_id": organization_id, "store": sid}
            ledger_rows, _ = safe_query(db, """
                SELECT d.domain, d.status, d.last_attempted_at, d.last_succeeded_at,
                       d.last_checked_at, d.retry_count, d.records_discovered,
                       d.records_inserted, d.records_updated, d.pages_completed,
                       d.pagination_complete, d.error_code
                FROM store_sync_domain_states d
                JOIN stores s ON s.id = d.store_id
                WHERE s.organization_id = :org_id AND d.store_id = :store
            """, store_params)
            reg_rows, _ = safe_query(db, """
                SELECT r.topic, r.status, r.last_error, r.attempt_count
                FROM webhook_registrations r
                JOIN stores s ON s.id = r.store_id
                WHERE s.organization_id = :org_id AND r.store_id = :store
            """, store_params)
            deliv_rows, _ = safe_query(db, """
                SELECT t.topic, t.status, t.received_at, t.processed_at
                FROM webhook_deliveries t
                JOIN stores s ON s.id = t.store_id
                WHERE s.organization_id = :org_id AND t.store_id = :store
                  AND t.received_at >= :since
            """, {**store_params, "since": now - timedelta(days=7)})
            cov_rows, _ = safe_query(db, """
                SELECT c.coverage_start, c.coverage_end
                FROM intelligence_order_coverage c
                JOIN stores s ON s.id = c.store_id
                WHERE s.organization_id = :org_id AND c.store_id = :store
            """, store_params)

            domains = _normalize_domain_states(ledger_rows, now)

            granted = store["granted_scopes"]
            capabilities = [
                _resource_capability(resource, granted,
                                     domains.get(resource["domain"]), now)
                for resource in INTEGRATION_RESOURCES
            ]
            webhooks = _webhook_evidence(reg_rows, deliv_rows, now)
            coverage = _order_coverage(cov_rows)
            connection = _connection_state(store, domains)
            health = _evaluate_health(store, connection, capabilities, domains,
                                      webhooks, coverage, now)

            # Evidence items for the citable facts of this store.
            # Anchor the state window to the latest observed synchronization
            # (capped at the wall clock) so evidence ids stay stable across
            # retrievals: by-reference lookup must resolve a cited id until
            # the state actually changes. Falls back to the wall clock when
            # no sync has ever been recorded. The window is the one second up
            # to the as-of instant (a state, not a range measurement); it is
            # strictly half-open (end after start).
            if store["last_synced_at"] is not None:
                window_end = min(store["last_synced_at"], now)
            else:
                window_end = now
            base_window = {
                "start": iso(window_end - timedelta(seconds=1)),
                "end": iso(window_end),
                "timezone": "UTC",
                "semantics": "[start, end)",
                "label": "Current integration state",
            }
            # A state item is a complete determination (including bad or
            # undetermined ones — the VALUE carries the state, never the
            # item status): every state item is an available fact.
            conn_status = STATUS_AVAILABLE
            items.append(evidence_item(
                "integration.connection_state",
                label=f"Connection state: {store['shop_domain'] or store['id']}",
                value=connection[0], unit=UNIT_REFERENCE,
                window=base_window, source="stores", store_scope="organization",
                discriminator=store["id"],
                status=conn_status,
                definition="Explicit connection state derived from the installation record and "
                           "the latest observed credential behaviour in the sync ledger; a "
                           "stored record alone only proves an installation exists.",
                limitations=connection[1],
            ))
            items.append(evidence_item(
                "integration.authorization",
                label=f"Granted Shopify scopes: {store['shop_domain'] or store['id']}",
                value=", ".join(granted) if granted else None, unit=UNIT_REFERENCE,
                window=base_window, source="stores", store_scope="organization",
                discriminator=store["id"] + ":scopes",
                status=STATUS_AVAILABLE,
                definition="Scopes recorded as granted at OAuth time. A recorded scope is not "
                           "proof of current effective access; effective access is established "
                           "per resource by a successful authorized retrieval.",
                limitations=(health["missing_permissions"] and
                             [f"Missing scopes: {', '.join(health['missing_permissions'])}"]
                             or (["No granted Shopify scopes are recorded on this store's "
                                  "record; capability states rest on observed "
                                  "synchronization behaviour."]
                                 if not granted
                                 else ["No missing scopes recorded."])),
            ))
            for cap in capabilities:
                if not cap["critical"] and cap["operational"]:
                    continue
                sync = cap["sync"] or {}
                sync_state = sync.get("state") or "unsupported"
                cap_state = ("operational" if cap["operational"]
                             else cap["authorization"]["state"]
                             if cap["authorization"]["state"] in ("missing_scope", "granted_approval_pending")
                             else "stale" if sync.get("stale")
                             else sync_state)
                items.append(evidence_item(
                    f"integration.resource.{cap['resource_id']}",
                    label=f"{cap['resource_id']} capability: {cap_state}",
                    value=cap_state,
                    unit=UNIT_REFERENCE,
                    window=base_window,
                    source=sync.get("note") and "store_sync_domain_states" or "stores",
                    store_scope="organization", discriminator=store["id"] + ":cap:" + cap["resource_id"],
                    status=STATUS_AVAILABLE,
                    freshness=sync.get("freshness"),
                    definition=f"Capability state for {cap['resource_id']} combining recorded "
                               "authorization, latest synchronization outcome and freshness. "
                               "Operational requires a successful fully-paginated retrieval "
                               "within the domain freshness policy.",
                    limitations=[cap["authorization"]["note"], *cap["restrictions"][:2],
                                 *(sync.get("note") and [sync["note"]] or [])],
                ))
            items.append(evidence_item(
                "integration.webhook_health",
                label=f"Webhook health: {store['shop_domain'] or store['id']}",
                value=webhooks["state"], unit=UNIT_REFERENCE,
                window=base_window, source="webhook_deliveries", store_scope="organization",
                discriminator=store["id"] + ":webhooks",
                status=STATUS_AVAILABLE,
                definition="Webhook registration and delivery/processing evidence over the last "
                           "seven days. Registration is reported separately from successful "
                           "event processing; neither implies the other.",
                limitations=webhooks["limitations"] + [webhooks["note"]],
            ))
            items.append(evidence_item(
                "integration.health_overall",
                label=f"Integration health: {store['shop_domain'] or store['id']}",
                value=health["overall_status"], unit=UNIT_REFERENCE,
                window=base_window, source="stores", store_scope="organization",
                discriminator=store["id"] + ":health",
                status=STATUS_AVAILABLE,
                definition="Deterministic overall integration health from connection, "
                           "authorization, per-resource synchronization, webhook and coverage "
                           "evidence. Critical capability failures always dominate; optional "
                           "failures are warnings.",
                limitations=(health["critical_failures"] and
                             ["Critical: " + "; ".join(
                                 f"{f['resource_id']} ({f['reason']})" for f in health["critical_failures"])]
                             or health["warnings"][:2]
                             or ["No critical integration problems were found."]),
            ))

            # Task 213 — the canonical rev-integration-state-v1 contract for
            # this store, evaluated from the same persisted records (Python
            # keystone; the Node gateway mirror serves the same contract via
            # the product API). Capability-aware Rev answers read this block.
            from .integration_state import (
                canonical_state_summary, evaluate_integration_state,
            )
            canonical_cov = {"status": coverage.get("status")}
            cov_starts = [_row_value(r, "coverage_start") for r in cov_rows
                          if isinstance(_row_value(r, "coverage_start"), datetime)]
            cov_ends = [_row_value(r, "coverage_end") for r in cov_rows
                        if isinstance(_row_value(r, "coverage_end"), datetime)]
            if cov_starts:
                canonical_cov["start"] = iso(max(cov_starts))
            if cov_ends:
                canonical_cov["end"] = iso(max(cov_ends))
            canonical_state = evaluate_integration_state({
                "organization_id": organization_id,
                "store": {**store, "organization_id": organization_id,
                          "scope_list_recorded": bool(store["granted_scopes"])},
                "domain_states": ledger_rows,
                "webhook_registrations": reg_rows,
                "webhook_deliveries": deliv_rows,
                "order_coverage": canonical_cov,
            }, now=now)

            stores_out.append({
                "store_id": store["id"],
                "shop_domain": store["shop_domain"],
                "platform": store["platform"],
                # Compact projection only (the full rev-integration-state-v1
                # contract is served by the product API; the Rev merchant
                # context has a hard size budget).
                "integration_state": canonical_state_summary(canonical_state),
                "connection": {
                    "state": connection[0],
                    "notes": connection[1],
                    "record_status": store["status"],
                    "has_credentials": store["has_token"],
                    "installed_at": iso(store["installed_at"]),
                    "last_synced_at": iso(store["last_synced_at"]),
                },
                "granted_scopes": granted,
                "capabilities": capabilities,
                "synchronization": {
                    domain: {
                        "state": state["state"],
                        "last_succeeded_at": iso(state["last_succeeded_at"]),
                        "last_attempted_at": iso(state["last_attempted_at"]),
                        "retry_count": state["retry_count"],
                        "records_discovered": state["records_discovered"],
                        "records_inserted": state["records_inserted"],
                        "records_updated": state["records_updated"],
                        "pages_completed": state["pages_completed"],
                        "pagination_complete": state["pagination_complete"],
                        "failure_class": state["failure_class"] if state["state"] in ("failed", "partial") else None,
                        "error_code": state["error_code"] if state["state"] in ("failed", "partial") else None,
                        "freshness": state["freshness"],
                        "note": state["note"],
                    } for domain, state in sorted(domains.items())
                },
                "webhooks": webhooks,
                "order_coverage": coverage,
                "health": health,
            })

    if len(stores_out) == 1:
        overall = stores_out[0]["health"]["overall_status"]
        components = stores_out[0]["health"]["components"]
        critical_failures = stores_out[0]["health"]["critical_failures"]
        warnings = stores_out[0]["health"]["warnings"]
        limitations = stores_out[0]["health"]["connection_notes"]
    else:
        rank = {"disconnected": 0, "unauthorized": 1, "attention_required": 2,
                "partially_operational": 3, "verification_pending": 4,
                "degraded": 5, "healthy": 6, "unknown": -1}
        overall = min((s["health"]["overall_status"] for s in stores_out),
                      key=lambda state: rank.get(state, -1))
        critical_failures = [f for s in stores_out for f in s["health"]["critical_failures"]]
        warnings = [w for s in stores_out for w in s["health"]["warnings"]]
        limitations = []
        components = None
    warnings = list(dict.fromkeys(warnings))

    return {
        "schema_version": "rev-evidence-v2",
        "metric_family": "integration",
        "organization_id": organization_id,
        "store_ids": store_ids,
        "retrieved_at": iso(now),
        "overall_status": overall,
        "components": components,
        "critical_failures": critical_failures,
        "warnings": warnings,
        "limitations": limitations or [
            "A connected record, a granted scope or an enqueued job is never reported as a "
            "working capability; every state above is derived from persisted evidence."],
        "stores": stores_out,
        "items": items,
    }


def _order_coverage(rows: list) -> dict:
    if not rows:
        return {"status": "unavailable",
                "note": "No certified order-coverage record exists for this store."}
    if all(_row_value(row, "coverage_start") is not None for row in rows):
        return {"status": "complete",
                "note": "Order coverage is certified by the intelligence ledger."}
    return {"status": "partial",
            "note": "Order coverage is recorded but incomplete."}
