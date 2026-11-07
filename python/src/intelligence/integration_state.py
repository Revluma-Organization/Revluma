"""Canonical integration state model — ``rev-integration-state-v1``.

Task 213. ONE versioned, typed contract that represents the real condition of
a merchant's Shopify integration, shared by the backend and the frontend.
The backend is authoritative: this module is the pure, deterministic
evaluator. The Node service mirrors it byte-for-semantics
(``Backend/src/services/revIntegrationState.js``) and a Python-generated
golden fixture pins the two together (Tasks 203/204/207/208/210 pattern).

Design rules
------------

* The overall status is a CLOSED set of 12 states. Distinct conditions are
  never collapsed into a connected/disconnected boolean.
* The evaluator is PURE: it reads normalized records (store row, sync
  ledger, webhook ledger, coverage) and produces the contract. No I/O, no
  provider calls, no randomness. The caller resolves tenant scope BEFORE
  calling and normalizes the store row so the evaluator only ever sees
  ``has_token`` — never the token.
* Authorization truth is derived from the strongest RECORDED evidence:
  a recent successful synchronization verifies the credentials; a recorded
  scope grant without success evidence is ``granted_unverified``; a failed
  ledger attempt with an authentication-class error is ``failed``. This
  module never claims a real-time provider verification that did not occur.
* Connection health and synchronization health are related but DISTINCT
  dimensions: a failed sync never invalidates a valid authorization, and a
  historical success never implies the integration is currently healthy
  (freshness gates the ``connected`` state).
* Everything the frontend displays must come from this object. The frontend
  never manufactures, infers or optimistically declares a state.

Precedence (deterministic, first match wins — see ``_resolve_overall``):

    1  no store record                             -> disconnected
    2  recorded revocation / app uninstall         -> authorization_revoked
    3  recorded disconnected / inactive / deleted  -> disconnected
    4  platform unsupported by this build          -> unsupported
    5  no access token recorded                    -> authorization_required
    6  unrecognized / contradictory record         -> unknown
    7  latest ledger evidence: credentials rejected
       - token expired / invalid                   -> authorization_expired
       - permission / scope rejection              -> authorization_required
    8  required (critical) scopes missing from a RECORDED scope list
                                             -> authorization_required
    9  synchronization currently running / queued -> synchronizing
   10  repeated / stalled failures (escalates
       before simple outcomes: automatic retries
       have not resolved it)                      -> needs_attention
   11  critical sync outcomes (non-auth):
       mix succeeded + failed/partial             -> sync_partial
       all critical failed                        -> sync_failed
   12  persistent webhook failure                 -> needs_attention
   13  capability restrictions without active
       failures (optional missing scopes, approval
       gates, unsupported capabilities, stale or
       incomplete coverage, degraded webhooks)
                                             -> limited_access
   14  all critical capabilities operational and
       fresh, authorization verified              -> connected
   15  otherwise                                   -> unknown

The invariants the precedence enforces (task §3.C):

* a revoked authorization can never display as connected (2/5/7 precede 13);
* a disconnected integration can never display as synchronizing
  (2/3 precede 9);
* an active sync job never conceals an authorization failure (7/8 precede
  9);
* a failed sync never invalidates an otherwise valid connection (the
  ``authorization`` component is independent of the ``synchronization``
  component);
* a successful historical sync never implies current health (rule 12's
  freshness/restriction gate precedes 13);
* unknown never silently becomes connected (14 is the default);
* unsupported resources are availability limits (rule 12), never
  synchronization failures (rule 10 only counts ledger domains).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from .evidence import ensure_utc, iso, utc_now
from .integration_evidence import (
    DEFAULT_FRESH_SECONDS,
    DOMAIN_FRESH_SECONDS,
    INTEGRATION_RESOURCES,
    SYNC_DOMAINS,
    _granted_scopes,
    _normalize_domain_states,
    _resource_capability,
    _scope_satisfied,
    _webhook_evidence,
)

INTEGRATION_STATE_CONTRACT_VERSION = "rev-integration-state-v1"

# The CLOSED overall-state set. Nothing outside it may be emitted, and the
# Node validator + frontend normalizer fail closed on anything outside it.
OVERALL_STATES = (
    "connected",
    "synchronizing",
    "limited_access",
    "needs_attention",
    "disconnected",
    "authorization_required",
    "authorization_expired",
    "authorization_revoked",
    "sync_failed",
    "sync_partial",
    "unsupported",
    "unknown",
)

# Rollup precedence for multi-store organizations (worst first). A single
# unhealthy store prevents the organization from displaying as connected;
# the ordering mirrors the evaluator precedence so the rollup and the
# per-store state agree about what is "worst".
STATE_SEVERITY = {
    "authorization_revoked": 0,
    "authorization_expired": 1,
    "authorization_required": 2,
    "needs_attention": 3,
    "sync_failed": 4,
    "sync_partial": 5,
    "disconnected": 6,
    "unsupported": 7,
    "unknown": 8,
    "synchronizing": 9,
    "limited_access": 10,
    "connected": 11,
}

# Closed synchronization-phase set (task §6). The evaluator only emits the
# phases the recorded evidence supports; the reserved names keep the
# contract complete for future worker telemetry.
SYNC_PHASES = (
    "queued",
    "scheduled",
    "running",
    "waiting_retrying",
    "partially_completed",
    "completed",
    "failed",
    "cancelled",
    "stalled",
    "unknown",
)

# A store-level 'syncing' heartbeat older than this without any running
# domain ledger row is a stalled (or lost) synchronization start, not an
# indefinitely "syncing" store.
_SYNC_HEARTBEAT_MAX_SECONDS = 30 * 60

# Repeated-failure / stall thresholds (recorded evidence only).
_REPETITIVE_RETRY_COUNT = 3
_ERROR_SINCE_MAX_SECONDS = 24 * 3600
_RUNNING_STALL_SECONDS = 2 * 3600  # 2x the default freshness policy

# A success verifies the credentials that produced it, but only while it is
# recent enough to say something about CURRENT validity.
_VERIFICATION_WINDOW_SECONDS = 30 * 24 * 3600

# Platforms the current build supports. Anything else is `unsupported` —
# a named limitation, never a synchronization failure.
_SUPPORTED_PLATFORMS = ("shopify",)

# The OAuth scopes this build ALWAYS requests at install time. Mirrors
# ``Backend/src/utils/shopify.js`` (buildOAuthAuthorizeUrl) — a parity test
# pins the two together so they cannot drift. Scopes for optional
# capabilities that are NOT in this set (e.g. read_returns, read_discounts,
# read_content, read_themes, read_shipping) are build limitations: they are
# disclosed per capability but must NOT demote the overall state from
# ``connected`` to ``limited_access`` (no merchant action can grant what the
# app never requests). Scopes the app DOES request but a store has not
# granted are real authorization gaps (fixable by reconnecting) and DO count.
APP_REQUESTED_SCOPES = frozenset({
    "read_orders",
    "read_customers",
    "read_products",
    "read_inventory",
    "read_locations",
    "read_legal_policies",
    "read_online_store_navigation",
})

# Store record states.
_RECORDED_REVOKED = ("revoked",)
_APP_UNINSTALLED = ("app_uninstalled", "uninstalled")
_RECORDED_DISCONNECTED = ("disconnected", "inactive", "deleted")
_ACTIVE_STATUSES = ("active", "connected", "syncing")
_INSTALL_STATUSES = ("not_connected", "connecting")


# ── Merchant-action table (task §8) ──────────────────────────────────────────
# Each state has a structured, safe, merchant-readable remediation. No
# internal implementation details, no stack traces, and no "reconnect"
# advice for conditions a reconnect cannot fix.

def _action_for(state: str, *, reason: str, missing_scopes: list[str]) -> dict:
    if state == "connected":
        return {"merchant_action_required": False, "retry_appropriate": False,
                "reconnect_appropriate": False,
                "next_step": "No action required — your store is connected and its data is synchronized."}
    if state == "synchronizing":
        return {"merchant_action_required": False, "retry_appropriate": False,
                "reconnect_appropriate": False,
                "next_step": "No action required — synchronization is in progress and the status updates when it completes."}
    if state == "disconnected":
        if reason == "no_installation_record":
            return {"merchant_action_required": False, "retry_appropriate": False,
                    "reconnect_appropriate": True,
                    "next_step": "Connect your store to start synchronization."}
        return {"merchant_action_required": True, "retry_appropriate": False,
                "reconnect_appropriate": True,
                "next_step": "Your store is not connected. Reconnect it from the Integrations page to restore data flow."}
    if state == "authorization_revoked":
        return {"merchant_action_required": True, "retry_appropriate": False,
                "reconnect_appropriate": True,
                "next_step": "Reinstall the Revluma app from your Shopify admin — the authorization was revoked or the app was uninstalled."}
    if state == "authorization_expired":
        return {"merchant_action_required": True, "retry_appropriate": False,
                "reconnect_appropriate": True,
                "next_step": "Reconnect your store — its authorization has expired. Reconnecting restores access."}
    if state == "authorization_required":
        if missing_scopes:
            note = " Reconnect so Revluma can request the missing permissions: " + ", ".join(missing_scopes) + "."
        else:
            note = " Complete or restart the Shopify connection to store valid credentials."
        return {"merchant_action_required": True, "retry_appropriate": False,
                "reconnect_appropriate": True,
                "next_step": "Reconnect your store to restore authorization." + note}
    if state == "sync_failed":
        return {"merchant_action_required": False, "retry_appropriate": True,
                "reconnect_appropriate": False,
                "next_step": "A data synchronization failed. It will be retried automatically; if it keeps failing, review the store on the Integrations page."}
    if state == "sync_partial":
        return {"merchant_action_required": False, "retry_appropriate": True,
                "reconnect_appropriate": False,
                "next_step": "Part of the data synchronization completed with gaps. The next synchronization run will complete the missing parts."}
    if state == "needs_attention":
        return {"merchant_action_required": True, "retry_appropriate": True,
                "reconnect_appropriate": False,
                "next_step": "The integration has a persistent problem that automatic retries have not resolved. Open the Integrations page to review the details and retry the setup."}
    if state == "limited_access":
        if missing_scopes:
            return {"merchant_action_required": True, "retry_appropriate": False,
                    "reconnect_appropriate": True,
                    "next_step": "Some capabilities are limited. Reconnect your store to grant the missing permissions: " + ", ".join(missing_scopes) + "."}
        return {"merchant_action_required": False, "retry_appropriate": False,
                "reconnect_appropriate": False,
                "next_step": "Your store is connected with some capabilities limited (see the capability list). No action is required unless you need a limited capability."}
    if state == "unsupported":
        return {"merchant_action_required": False, "retry_appropriate": False,
                "reconnect_appropriate": False,
                "next_step": "This platform is not supported by the current Revluma build."}
    # unknown
    return {"merchant_action_required": True, "retry_appropriate": False,
            "reconnect_appropriate": True,
            "next_step": "The integration state could not be verified from the recorded evidence. Check the store on the Integrations page, or reconnect if the problem persists."}


def _explanation_for(state: str, reason: str, missing_scopes: list[str],
                     failed_domains: list[str], running_domains: list[str],
                     store_domain: str | None) -> str:
    domain = store_domain or "your store"
    if state == "connected":
        return f"{domain} is connected, its authorization is verified, and its data is synchronized."
    if state == "synchronizing":
        where = " for " + ", ".join(running_domains) if running_domains else ""
        return f"{domain} is connected; data synchronization is currently running{where}."
    if state == "limited_access":
        if missing_scopes:
            return (f"{domain} is connected, but some capabilities are limited because permissions are missing: "
                    + ", ".join(missing_scopes) + ".")
        return (f"{domain} is connected, but some capabilities are limited (unsupported resources, "
                "approval-gated data, stale data, or bounded history).")
    if state == "needs_attention":
        if reason == "webhook_failure":
            return (f"{domain} is connected, but webhook delivery is persistently failing; "
                    "new events may not be captured reliably until it is fixed.")
        if reason == "sync_stalled":
            return f"{domain} is connected, but a synchronization appears stalled and has not made progress."
        if failed_domains:
            return (f"{domain} is connected, but data synchronization has failed repeatedly "
                    f"({', '.join(failed_domains)}) and automatic retries have not resolved it.")
        return f"{domain} is connected, but the integration has a persistent problem that automatic retries have not resolved."
    if state == "disconnected":
        if reason == "no_installation_record":
            return "No Shopify store is connected for this account."
        return f"{domain} is not connected; its data is not being synchronized."
    if state == "authorization_revoked":
        return f"The authorization for {domain} was revoked (the app was uninstalled or access was withdrawn)."
    if state == "authorization_expired":
        return (f"The authorization for {domain} has expired or its credentials were rejected "
                "by Shopify; the connection must be re-established.")
    if state == "authorization_required":
        if missing_scopes:
            return f"{domain} is missing required permissions: " + ", ".join(missing_scopes) + ". Reconnect to grant them."
        return f"No valid credentials are recorded for {domain}; the Shopify connection must be (re)established."
    if state == "sync_failed":
        return (f"{domain} is connected, but the latest data synchronization failed for: "
                + ", ".join(failed_domains) + ". The connection itself remains valid.")
    if state == "sync_partial":
        return (f"{domain} is connected; the latest data synchronization partially completed "
                f"(gaps in: {', '.join(failed_domains)}).")
    if state == "unsupported":
        return "This platform is not supported by the current Revluma build, so no capabilities are available."
    return f"The state of {domain} could not be verified from the recorded evidence; no state is assumed."


# ── Normalization helpers ────────────────────────────────────────────────────

def _row(value: Any, key: str, default: Any = None) -> Any:
    try:
        return value[key]
    except (KeyError, IndexError, TypeError):
        return getattr(value, key, default)


def _row_keys(value: Any) -> set:
    if isinstance(value, dict):
        return set(value.keys())
    try:
        return set(value.keys())
    except AttributeError:
        return {}


def _dt(value: Any) -> datetime | None:
    """Normalize a timestamp (datetime or ISO-8601 string) to timezone-aware
    UTC (naive values are interpreted as UTC). The keystone contract is
    tz-aware UTC, matching the Task 201 evidence machine."""
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is None or value.utcoffset() is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _coerce_row_timestamps(rows: list, keys: tuple) -> list:
    """Copy raw ledger rows, converting ISO-string timestamps to aware-UTC
    datetimes. The Task 201 normalizers accept datetime instances only, and
    the keystone's JSON surface (the Node mirror, the golden fixture, API
    tests) carries ISO strings."""
    out = []
    for row in rows or []:
        if isinstance(row, dict):
            copy = dict(row)
            for key in keys:
                if isinstance(copy.get(key), str):
                    copy[key] = _dt(copy[key])
            out.append(copy)
        else:
            out.append(row)
    return out


_DOMAIN_TS_KEYS = ("last_succeeded_at", "last_attempted_at", "last_checked_at", "error_since")
_DELIVERY_TS_KEYS = ("received_at", "processed_at")


def normalize_store_record(row: Any, *, organization_id: str = "") -> dict | None:
    """Normalize a stores row into the keystone's input shape.

    The access token is NEVER carried into the evaluator — only ``has_token``
    is derived (and discarded from the output contract).
    """
    if row is None:
        return None
    keys = _row_keys(row)
    if "access_token" in keys:
        has_token = row["access_token"] is not None
    else:
        has_token = bool(_row(row, "has_token"))
    scopes_raw = _row(row, "granted_scopes")
    return {
        "id": str(_row(row, "id") or ""),
        "organization_id": str(_row(row, "organization_id") or organization_id),
        "platform": str(_row(row, "platform") or ""),
        "shop_domain": str(_row(row, "shop_domain") or ""),
        "status": str(_row(row, "status") or "unknown"),
        "has_token": bool(has_token),
        "granted_scopes": _granted_scopes(scopes_raw),
        # A non-EMPTY grant list is "recorded". A NULL or empty list is a
        # data gap, not proof of missing grants (Task 201 convention) —
        # capability then rests on observed synchronization behaviour.
        "scope_list_recorded": bool(_granted_scopes(scopes_raw)),
        "installed_at": _dt(_row(row, "installed_at")),
        "last_synced_at": _dt(_row(row, "last_synced_at")),
        "updated_at": _dt(_row(row, "updated_at")),
    }


# ── Dimension evaluators ─────────────────────────────────────────────────────

def _required_scopes() -> list[str]:
    return sorted({scope for resource in INTEGRATION_RESOURCES
                   if resource["critical"] for scope in resource["scopes"]})


def _iso_verified(domains: dict[str, dict], now: datetime) -> str | None:
    """When the credentials were last proven by a successful sync.

    A success verifies the credentials that produced it; an ancient success
    (older than the verification window) is not evidence of CURRENT validity
    and is reported as no verification.
    """
    successes = [d["last_succeeded_at"] for d in domains.values()
                 if d["last_succeeded_at"] is not None]
    if not successes:
        return None
    latest = max(successes)
    return iso(latest) if _within(latest, _VERIFICATION_WINDOW_SECONDS, now) else None


def _within(dt_value: datetime, seconds: int, now: datetime) -> bool:
    # Naive vs aware tolerance: the DB returns naive UTC datetimes; compare
    # against the evaluation timestamp regardless of tzinfo.
    try:
        age = (now - dt_value).total_seconds()
    except TypeError:
        return True
    return age <= seconds


def _missing_app(granted: list[str], recorded: bool) -> list[str]:
    """App-requested scopes absent from a RECORDED grant list."""
    if not recorded:
        return []
    return sorted(scope for scope in APP_REQUESTED_SCOPES
                  if not _scope_satisfied(granted, scope))


def _authorization(store: dict | None, domains: dict[str, dict], now: datetime) -> dict:
    """Authorization dimension from the strongest recorded evidence.

    Verification vocabulary (honest, evidence-bound):
      * ``verified_by_successful_synchronization`` — a recent successful
        authenticated sync proves the credentials work.
      * ``granted_unverified`` — scopes are recorded as granted but nothing
        has proven current access.
      * ``unverified_unrecorded`` — no scope list recorded and no success
        evidence; the token row alone is not asserted.
      * ``failed_by_latest_evidence`` — the most recent ledger attempt was
        rejected by Shopify (auth class); current validity is NOT asserted.
      * ``no_credentials_recorded`` / ``not_installed`` — nothing to verify.
    """
    required = _required_scopes()
    if store is None:
        return {"valid": False, "verified": False, "verification": "not_installed",
                "auth_failure_class": None, "last_verified_at": None,
                "granted_scopes": [], "required_scopes": required,
                "missing_scopes": required, "missing_app_scopes": [],
                "scope_list_recorded": False,
                "note": "No installation record exists; there is no authorization to evaluate."}
    # A recorded revocation / disconnect / uninstall dominates any success
    # evidence: the authorization is no longer valid, full stop (a stale
    # "connected" belief never survives evaluation).
    if store["status"] in _RECORDED_REVOKED or store["status"] in _APP_UNINSTALLED:
        return {"valid": False, "verified": False, "verification": "recorded_revoked",
                "auth_failure_class": None, "last_verified_at": None,
                "granted_scopes": store["granted_scopes"], "required_scopes": required,
                "missing_scopes": [], "missing_app_scopes": [],
                "scope_list_recorded": store["scope_list_recorded"],
                "note": "The record shows the authorization was revoked or the app was "
                        "uninstalled; success evidence predating it does not restore it."}
    if store["status"] in _RECORDED_DISCONNECTED:
        return {"valid": False, "verified": False, "verification": "recorded_disconnected",
                "auth_failure_class": None, "last_verified_at": None,
                "granted_scopes": store["granted_scopes"], "required_scopes": required,
                "missing_scopes": [], "missing_app_scopes": [],
                "scope_list_recorded": store["scope_list_recorded"],
                "note": "The record shows the store is disconnected; no current access is asserted."}
    granted = store["granted_scopes"]
    recorded = store["scope_list_recorded"]
    # Missing required scopes are only proven when a scope list is RECORDED;
    # a NULL scope list is a data gap (Task 201 decision), not proof of a
    # missing grant — access then rests on observed synchronization.
    missing_required = [s for s in required if not _scope_satisfied(granted, s)] if recorded else []
    missing_all = [s for resource in INTEGRATION_RESOURCES
                   for s in resource["scopes"] if not _scope_satisfied(granted, s)] if recorded else []
    missing_all = sorted(set(missing_all))

    # Latest credential behaviour from the ledger (authentication class).
    auth_failures = [d for d, s in domains.items()
                     if s["state"] in ("failed", "partial")
                     and s["failure_class"] in ("authentication", "authorization")]
    if auth_failures:
        worst = max(auth_failures,
                    key=lambda d: (domains[d]["attempted"] or datetime.min))
        cls = domains[worst]["failure_class"]
        expired = cls == "authentication"
        note = ("The most recent synchronization evidence indicates the token was expired "
                f"or invalid (domain: {worst}); reconnect to restore the authorization."
                if expired else
                "The most recent synchronization evidence indicates the credentials were "
                f"rejected by Shopify for a permission reason (domain: {worst}); the "
                "authorization is not currently valid.")
        return {"valid": False, "verified": False,
                "verification": "failed_by_latest_evidence",
                "auth_failure_class": cls,
                "last_verified_at": _iso_verified(domains, now),
                "granted_scopes": granted, "required_scopes": required,
                "missing_scopes": missing_all if recorded else missing_required,
                "missing_app_scopes": _missing_app(granted, recorded),
                "scope_list_recorded": recorded, "note": note}

    verified_at = _iso_verified(domains, now)
    if verified_at is not None:
        return {"valid": True, "verified": True,
                "verification": "verified_by_successful_synchronization",
                "auth_failure_class": None, "last_verified_at": verified_at,
                "granted_scopes": granted, "required_scopes": required,
                "missing_scopes": missing_all, "missing_app_scopes": _missing_app(granted, recorded),
                "scope_list_recorded": recorded,
                "note": "Authorization validity is established by the most recent "
                        "successful, authenticated synchronization."}
    if store["status"] in _INSTALL_STATUSES:
        return {"valid": False, "verified": False,
                "verification": "no_credentials_recorded" if not store["has_token"] else "install_in_progress",
                "auth_failure_class": None, "last_verified_at": None,
                "granted_scopes": granted, "required_scopes": required,
                "missing_scopes": missing_required, "missing_app_scopes": _missing_app(granted, recorded),
                "scope_list_recorded": recorded,
                "note": "Installation is in progress; no authorization has been verified yet."}
    if not store["has_token"]:
        return {"valid": False, "verified": False,
                "verification": "no_credentials_recorded",
                "auth_failure_class": None, "last_verified_at": None,
                "granted_scopes": granted, "required_scopes": required,
                "missing_scopes": missing_required, "missing_app_scopes": _missing_app(granted, recorded),
                "scope_list_recorded": recorded,
                "note": "No credentials are recorded; there is nothing to verify."}
    if not recorded:
        return {"valid": False, "verified": False,
                "verification": "unverified_unrecorded",
                "auth_failure_class": None, "last_verified_at": None,
                "granted_scopes": granted, "required_scopes": required,
                "missing_scopes": missing_required, "missing_app_scopes": _missing_app(granted, recorded),
                "scope_list_recorded": recorded,
                "note": "No granted scopes are recorded and no successful synchronization "
                        "has proven current access; the record alone is not asserted."}
    return {"valid": False, "verified": False,
            "verification": "granted_unverified",
            "auth_failure_class": None, "last_verified_at": None,
            "granted_scopes": granted, "required_scopes": required,
            "missing_scopes": missing_all, "missing_app_scopes": _missing_app(granted, recorded),
            "scope_list_recorded": recorded,
            "note": "Scopes are recorded as granted, but no successful synchronization "
                    "has verified current access."}


def _synchronization(domains: dict[str, dict], store: dict | None, now: datetime) -> dict:
    """Synchronization dimension: phase, per-domain detail, timestamps."""
    by_state: dict[str, list[str]] = {}
    for domain, state in domains.items():
        by_state.setdefault(state["state"], []).append(domain)
    running = sorted(by_state.get("running", []))
    failed = sorted(by_state.get("failed", []))
    partial = sorted(by_state.get("partial", []))
    succeeded = sorted(by_state.get("succeeded", []))

    last_attempted = max((d["last_attempted_at"] for d in domains.values()
                          if d["last_attempted_at"] is not None), default=None)
    last_succeeded = max((d["last_succeeded_at"] for d in domains.values()
                          if d["last_succeeded_at"] is not None), default=None)

    # Stall detection (recorded evidence only): a domain marked running whose
    # last attempt is far older than any plausible sync duration.
    stalled = []
    for domain in running:
        attempted = domains[domain]["last_attempted_at"]
        if attempted is None:
            continue
        policy = DOMAIN_FRESH_SECONDS.get(domain, DEFAULT_FRESH_SECONDS)
        if _within(attempted, max(_RUNNING_STALL_SECONDS, 2 * policy), now) is False:
            stalled.append(domain)
    running_confirmed = [d for d in running if d not in stalled]

    # Store-level 'syncing' with a fresh heartbeat but no running domain row
    # is a queued/scheduled start, not an active synchronization.
    store_syncing = bool(store and store["status"] == "syncing")
    heartbeat_fresh = False
    store_stalled_sync = False
    if store_syncing and store.get("updated_at") is not None:
        heartbeat_fresh = _within(store["updated_at"], _SYNC_HEARTBEAT_MAX_SECONDS, now)
        store_stalled_sync = (not heartbeat_fresh and not running_confirmed)
    elif store_syncing:
        store_stalled_sync = not running_confirmed

    retrying = any(d["retry_count"] > 0 for d in domains.values()
                   if d["state"] == "failed")

    if stalled or store_stalled_sync:
        phase = "stalled"
    elif running_confirmed:
        phase = "running"
    elif store_syncing and heartbeat_fresh:
        phase = "queued"
    elif failed and not succeeded:
        phase = "waiting_retrying" if retrying else "failed"
    elif failed or partial:
        phase = "partially_completed"
    elif succeeded:
        if SYNC_DOMAINS and set(SYNC_DOMAINS) <= set(succeeded):
            phase = "completed"
        else:
            phase = "partially_completed"
    else:
        phase = "unknown"

    return {
        "state": phase,
        "active": bool(running_confirmed or (store_syncing and heartbeat_fresh)),
        "running_domains": running_confirmed,
        "stalled_domains": sorted(stalled),
        "failed_domains": failed,
        "partial_domains": partial,
        "succeeded_domains": succeeded,
        "retrying": retrying,
        "stalled": bool(stalled or store_stalled_sync),
        "last_attempted_at": iso(last_attempted) if last_attempted else None,
        "last_succeeded_at": iso(last_succeeded) if last_succeeded else None,
        "domains": {
            domain: {
                "state": d["state"],
                "freshness": d["freshness"]["state"],
                "last_succeeded_at": iso(d["last_succeeded_at"]) if d["last_succeeded_at"] else None,
                "last_attempted_at": iso(d["last_attempted_at"]) if d["last_attempted_at"] else None,
                "retry_count": d["retry_count"],
                "pagination_complete": d["pagination_complete"],
                "failure_class": d["failure_class"],
                "error_code": d["error_code"],
            } for domain, d in sorted(domains.items())
        },
    }


def _capabilities(store: dict | None, domains: dict[str, dict], now: datetime) -> list[dict]:
    """Per-capability blocks with the task §7 field set."""
    granted = store["granted_scopes"] if store else []
    out = []
    for resource in INTEGRATION_RESOURCES:
        base = _resource_capability(
            resource, granted,
            domains.get(resource["domain"]) if resource["domain"] else None,
            now)
        auth = base["authorization"]
        sync = base["sync"] or {}
        app_requested = all(sc in APP_REQUESTED_SCOPES for sc in resource["scopes"]) \
            if resource["scopes"] else True
        limited_reasons = []
        merchant_action = False
        remediation = None
        if auth["state"] == "missing_scope" and app_requested:
            limited_reasons.append("missing_scope")
            merchant_action = True
            remediation = "Reconnect the store and grant: " + ", ".join(auth["missing_scopes"])
        elif auth["state"] == "unverified_unrecorded":
            limited_reasons.append("access_unverified")
        elif sync.get("state") in ("failed", "partial"):
            # A sync that RAN and failed is a real, current limitation
            # (Task 201: availability limits vs real failures). Critical
            # failures are caught by rule 10 before rule 12 runs; this
            # surfaces optional real failures to the limited_access rollup.
            limited_reasons.append("sync_failed" if sync.get("state") == "failed" else "sync_partial")
        elif sync.get("state") == "unsupported":
            # No ledger domain: a build limitation. Disclosed per capability,
            # never counted as a restriction (see _has_restrictions).
            pass
        elif sync.get("state") == "never_synchronized":
            limited_reasons.append("not_yet_synchronized")
        elif sync.get("stale"):
            limited_reasons.append("stale_data")
        # Platform approval gates (read_all_orders window, protected customer
        # data) are DISCLOSED, not counted as restrictions: the bounded
        # window is expressed through coverage, and granted-but-unverified
        # access is expressed through sync_state. A reconnect cannot grant
        # app-level approval, so these must not present merchant actions.
        out.append({
            "id": resource["id"],
            "name": resource["id"].replace(".", " ").replace("-", " "),
            "category": resource["category"],
            "critical": resource["critical"],
            "supported": resource["domain"] is not None or auth["effective"],
            "app_requested": app_requested,
            "authorization": auth["state"],
            "required_permissions": list(resource["scopes"]),
            "missing_permissions": list(auth["missing_scopes"]),
            "source_available": sync.get("state") not in ("never_synchronized", "unsupported", None),
            "sync_state": sync.get("state"),
            "freshness": (sync.get("freshness") or {}).get("state"),
            "operational": base["operational"],
            "limited_reasons": limited_reasons,
            "merchant_action_required": merchant_action,
            "remediation": remediation,
            "restrictions": base["restrictions"],
        })
    return out


def _coverage(coverage: dict | None) -> dict:
    status = (coverage or {}).get("status", "unknown")
    return {
        "status": status,
        "certified_start": (coverage or {}).get("start"),
        "certified_end": (coverage or {}).get("end"),
        "certified_at": (coverage or {}).get("certified_at"),
        "customer_lifetime_verified": bool((coverage or {}).get("customer_lifetime_verified")),
        "note": ("Certified order-history coverage is complete for this store."
                 if status == "complete" else
                 "Certified order-history coverage is not complete; historical "
                 "evidence may be bounded."),
    }


def _webhook_persistent_failure(webhooks: dict) -> bool:
    return webhooks.get("state") == "failed"


def _webhook_limited(webhooks: dict) -> bool:
    return webhooks.get("state") in ("degraded", "unknown", "not_registered")


# ── Overall state resolution (the precedence algorithm) ──────────────────────

def _resolve_overall(store: dict | None, authorization: dict,
                     synchronization: dict, capabilities: list[dict],
                     webhooks: dict, coverage_block: dict) -> tuple[str, str]:
    """Return ``(overall_status, status_reason)`` per the documented
    precedence. Pure and deterministic — first match wins."""
    # 1. no installation record
    if store is None:
        return "disconnected", "no_installation_record"
    status = store["status"]
    # 2. recorded revocation / app uninstall
    if status in _RECORDED_REVOKED or status in _APP_UNINSTALLED:
        return "authorization_revoked", "recorded_revoked"
    # 3. recorded disconnect
    if status in _RECORDED_DISCONNECTED:
        return "disconnected", "recorded_disconnected"
    # 4. unsupported platform (only for records that are not install-pending)
    if status not in ("", "unknown") and status not in _INSTALL_STATUSES \
            and store["platform"] not in _SUPPORTED_PLATFORMS:
        return "unsupported", "platform_unsupported"
    # 5. no credentials recorded
    if not store["has_token"]:
        return "authorization_required", "no_credentials_recorded"
    # 6. unrecognized / contradictory record
    if status not in _ACTIVE_STATUSES:
        return "unknown", "unrecognized_record"
    # 7. latest ledger evidence: credentials rejected (an active sync never
    #    conceals an authorization failure — this rule precedes rule 9)
    if authorization["verification"] == "failed_by_latest_evidence":
        if authorization["auth_failure_class"] == "authentication":
            return "authorization_expired", "credential_expired"
        return "authorization_required", "credential_rejected"
    # 8. required scopes missing from a RECORDED list
    if any(c["critical"] and c["authorization"] == "missing_scope"
           for c in capabilities):
        return "authorization_required", "required_scope_missing"
    # 9. synchronization currently running / queued
    if synchronization["state"] in ("running", "queued"):
        return "synchronizing", "sync_running"
    # 10. repeated / stalled failures escalate BEFORE simple outcomes: a
    #     failure that automatic retries have not resolved is a
    #     needs_attention, not a routine sync_failed (task §3.C: repeated or
    #     stalled failures are never hidden).
    if synchronization["stalled"]:
        return "needs_attention", "sync_stalled"
    if _repetitive_failure(synchronization):
        return "needs_attention", "repeated_failure"
    # 11. critical sync outcomes (non-auth): failures here do NOT invalidate
    #     the connection — the authorization dimension is independent
    if _has_critical_sync_failure(synchronization):
        if _has_critical_success(synchronization):
            return "sync_partial", "sync_partial"
        return "sync_failed", "sync_failed"
    # 12. persistent webhook failure
    if _webhook_persistent_failure(webhooks):
        return "needs_attention", "webhook_failure"
    # 13. capability restrictions without active failures
    if _has_restrictions(capabilities, coverage_block, webhooks):
        return "limited_access", "limited_capabilities"
    # 14. connected: authorization verified + no restrictions
    if authorization["verified"]:
        return "connected", "all_verified"
    # 15. default
    return "unknown", "evidence_incomplete"


def _has_critical_sync_failure(synchronization: dict) -> bool:
    """Any CRITICAL ledger domain shows a failed/partial latest attempt.

    Unsupported resources are availability limits, never sync failures:
    only domains with ledger evidence are counted here."""
    critical_domains = {resource["domain"] for resource in INTEGRATION_RESOURCES
                        if resource["critical"] and resource["domain"]}
    return bool(critical_domains & set(
        synchronization["failed_domains"] + synchronization["partial_domains"]))


def _has_critical_success(synchronization: dict) -> bool:
    critical_domains = {resource["domain"] for resource in INTEGRATION_RESOURCES
                        if resource["critical"] and resource["domain"]}
    return bool(critical_domains & set(synchronization["succeeded_domains"]))


def _repetitive_failure(synchronization: dict) -> bool:
    for d in synchronization["domains"].values():
        if d["state"] == "failed" and d["retry_count"] >= _REPETITIVE_RETRY_COUNT:
            return True
    return False


def _has_restrictions(capabilities: list[dict], coverage_block: dict,
                      webhooks: dict) -> bool:
    """Rule 12 — restrictions that limit the integration WITHOUT an active
    failure, per the Task 213 §7 semantics and Task 201's availability-vs-
    failure distinction:

    COUNTED (limit the integration):
      * a CRITICAL capability that has never been synchronized (no usable
        data yet — not a failure, but the baseline is not available);
      * a REAL sync failure of any capability (a sync that ran and failed;
        critical failures were handled by rule 10 first);
      * stale data on any capability (a successful historical sync is not
        current health);
      * a missing scope the app actually requests (the merchant can fix it
        by reconnecting — "a capability requiring additional Shopify
        authorization");
      * incomplete certified coverage (bounded history, e.g. the 60-day
        window before read_all_orders approval);
      * degraded / unknown / unregistered webhooks (reliability limit).

    NOT counted (disclosed per capability, never a demotion):
      * optional capabilities that have never been synchronized ("unproven"
        — Task 201: must not degrade an otherwise healthy store);
      * resources with no ledger domain in this build ("unsupported" is a
        build limitation, never a sync failure);
      * scopes the app never requests (no merchant action exists)."""
    for c in capabilities:
        if c["sync_state"] in ("failed", "partial"):
            return True
        if c["freshness"] == "stale":
            return True
        if c["critical"] and c["sync_state"] == "never_synchronized":
            return True
        if c["authorization"] == "missing_scope" and c["app_requested"]:
            return True
    if coverage_block["status"] != "complete":
        return True
    if _webhook_limited(webhooks):
        return True
    return False


# ── Public evaluator ─────────────────────────────────────────────────────────

def evaluate_integration_state(records: dict, *, now: datetime | None = None) -> dict:
    """Evaluate ONE store's canonical integration state.

    ``records`` (all optional):
      store                 normalized store row (see normalize_store_record)
      domain_states         store_sync_domain_states rows (list)
      webhook_registrations webhook_registrations rows (list)
      webhook_deliveries    webhook_deliveries rows, caller-bounded to ~7d
      order_coverage        normalized coverage row or None
      organization_id       tenant context (resolved by the caller)

    Returns the ``rev-integration-state-v1`` contract. The evaluator never
    raises on missing evidence — it degrades to explicit states
    (``unknown``/``disconnected``) with machine-readable reasons.
    """
    now = ensure_utc(now or utc_now(), field="now")
    organization_id = str(records.get("organization_id") or "")
    store = records.get("store")
    # Normalize unless the caller already passed a normalized record
    # (marker: granted_scopes is a LIST — raw rows carry the CSV string).
    granted = _row(store, "granted_scopes")
    if store is not None and not isinstance(granted, list):
        store = normalize_store_record(store, organization_id=organization_id)

    domain_rows = _coerce_row_timestamps(records.get("domain_states") or [], _DOMAIN_TS_KEYS)
    delivery_rows = _coerce_row_timestamps(records.get("webhook_deliveries") or [], _DELIVERY_TS_KEYS)
    domains = _normalize_domain_states(domain_rows, now)
    # error_since is recorded evidence the Task 201 state machine does not
    # carry; the keystone reads it from the raw rows for repeat detection.
    for row in domain_rows:
        domain = str(_row(row, "domain") or "")
        since = _dt(_row(row, "error_since"))
        if domain and domain in domains and since is not None:
            domains[domain]["error_since"] = since
    webhooks = _webhook_evidence(records.get("webhook_registrations") or [],
                                 delivery_rows, now)
    coverage_block = _coverage(records.get("order_coverage"))

    authorization = _authorization(store, domains, now)
    synchronization = _synchronization(domains, store, now)
    capabilities = _capabilities(store, domains, now)

    overall, reason = _resolve_overall(store, authorization, synchronization,
                                       capabilities, webhooks, coverage_block)
    # Merchant-facing remediation lists only scopes the app actually
    # requests (critical scopes are always a subset of that set).
    missing = authorization.get("missing_app_scopes", [])
    failed_domains = synchronization["failed_domains"]
    running = synchronization["running_domains"]
    action = _action_for(overall, reason=reason, missing_scopes=missing)

    last_error = None
    error_domains = [(name, d) for name, d in domains.items() if d["state"] == "failed"]
    if error_domains:
        name, worst = max(error_domains, key=lambda item: (item[1]["attempted"] or datetime.min))
        last_error = {
            "category": worst["failure_class"],
            "domain": name,
            "recoverable": worst["failure_class"] not in ("authorization", "authentication"),
            "code": worst["error_code"],
        }

    return {
        "contract_version": INTEGRATION_STATE_CONTRACT_VERSION,
        "integration_id": store["id"] if store else None,
        "organization_id": organization_id,
        "store": {
            "id": store["id"] if store else None,
            "shop_domain": store["shop_domain"] if store else None,
            "provider": ("shopify" if store["platform"] == "shopify" else store["platform"]) if store else None,
            "installed_at": iso(store["installed_at"]) if store and store["installed_at"] else None,
            "last_synced_at": iso(store["last_synced_at"]) if store and store["last_synced_at"] else None,
        },
        "overall_status": overall,
        "status_reason": reason,
        "status_explanation": _explanation_for(
            overall, reason, missing, failed_domains, running,
            store["shop_domain"] if store else None),
        "authorization": authorization,
        "capabilities": capabilities,
        "synchronization": synchronization,
        "webhooks": {
            "state": webhooks["state"],
            "note": webhooks["note"],
            "registered_topics": webhooks["registered_topics"],
            "active_topics": webhooks["active_topics"],
            "failed_topics": webhooks["failed_topics"],
            "last_event_received_at": webhooks.get("last_received_at"),
            "last_event_processed_at": webhooks.get("last_processed_at"),
        },
        "coverage": coverage_block,
        "last_error": last_error,
        "merchant_action_required": action["merchant_action_required"],
        "retry_appropriate": action["retry_appropriate"],
        "reconnect_appropriate": action["reconnect_appropriate"],
        "recommended_next_step": action["next_step"],
        "evaluated_at": iso(now),
        "source": "stores+store_sync_domain_states+webhook_registrations+webhook_deliveries+intelligence_order_coverage",
    }


def canonical_state_summary(state: dict) -> dict:
    """Compact projection of the canonical state for bounded contexts (the
    Rev merchant context has a hard size budget; the full contract is served
    by the product API). Carries exactly what a capability-aware answer
    needs: the state, its reason, the authorization verification basis, the
    synchronization phase, and the concrete limitations."""
    limited = [c["id"] for c in state["capabilities"] if c["limited_reasons"]]
    sync = state["synchronization"]
    return {
        "contract_version": state["contract_version"],
        "overall_status": state["overall_status"],
        "status_reason": state["status_reason"],
        "status_explanation": state["status_explanation"],
        "authorization": {
            "verification": state["authorization"]["verification"],
            "valid": state["authorization"]["valid"],
            "verified": state["authorization"]["verified"],
            "last_verified_at": state["authorization"]["last_verified_at"],
            "missing_app_scopes": state["authorization"]["missing_app_scopes"],
        },
        "synchronization": {
            "state": sync["state"],
            "running_domains": sync["running_domains"],
            "failed_domains": sync["failed_domains"],
            "partial_domains": sync["partial_domains"],
            "last_succeeded_at": sync["last_succeeded_at"],
        },
        "limited_capabilities": limited,
        "merchant_action_required": state["merchant_action_required"],
        "recommended_next_step": state["recommended_next_step"],
    }


def worst_state(states: list[str]) -> str | None:
    """Multi-store rollup: the worst overall state per STATE_SEVERITY.

    A single unhealthy store prevents the organization from displaying as
    connected. Unknown does not hide real failures: it ranks below every
    concrete failure but above healthy states."""
    present = [s for s in states if s in STATE_SEVERITY]
    if not present:
        return None
    return min(present, key=lambda s: STATE_SEVERITY[s])
