"""Data health supplied by Node (rev-data-health-v1, compact form).

Node's ``dataHealth.js`` is the single source of truth for whether store data
exists, is fresh, is authorized, is syncing or is unsupported. It reaches the
investigation as ``merchant_context.data_health``: bounded, PII-free strings
in three kinds (see ``compactForAgent`` in Backend/src/services/dataHealth.js):

    health | <store_id> | <overall> | <core_state> | <last_store_sync>
    complete | <store_id> | <resource,resource,...>
    resource | <store_id> | <resource> | <capability> | <state> | <reason[:scopes]> | <last_success>

This module parses those lines defensively (they are tenant-scoped by Node but
still untrusted input), gives the agent a compact view of availability, and
derives *question-relevant* limitation sentences. A limitation is disclosed
only when it is material to the capabilities the investigation actually used;
unrelated gaps (e.g. URL redirects on a revenue question) are not mentioned.
Nothing here invents a value: unparseable lines are dropped, never guessed.
"""
from __future__ import annotations

import re

STATES = frozenset({"complete", "incomplete", "stale", "unavailable", "unauthorized", "unsupported"})
OVERALL_STATES = frozenset({
    "healthy", "healthy_with_limitations", "syncing", "recovering", "degraded",
    "action_required", "disconnected",
})
CORE_CAPABILITIES = frozenset({"orders", "checkouts", "products", "inventory"})
_ID = re.compile(r"^[0-9A-Za-z_.:+\-,]{1,700}$")
_MAX_LINES = 60

# Tool → permission-registry capability (mirrors investigation_outcomes.TOOL_DOMAINS;
# refunds are part of the orders capability in the registry).
_DOMAIN_TO_CAPABILITY = {
    "orders": "orders", "refunds": "orders", "checkouts": "checkouts",
    "customers": "customers", "products": "products", "inventory": "inventory",
    "storefront_events": "storefront_events",
}


def _clean(value: str) -> str | None:
    value = (value or "").strip()
    return value if value and _ID.match(value) else None


def parse_data_health(merchant_context: dict | None) -> dict:
    """Return {"available": bool, "stores": [...], "resources": [...], "complete": {...}}."""
    parsed = {"available": False, "stores": [], "resources": [], "complete": {}, "truncated": False}
    if not isinstance(merchant_context, dict):
        return parsed
    lines = merchant_context.get("data_health")
    if not isinstance(lines, list) or not lines:
        return parsed
    for raw in lines[:_MAX_LINES]:
        if not isinstance(raw, str):
            continue
        parts = [part.strip() for part in raw.split(" | ")]
        kind = parts[0] if parts else ""
        if kind == "truncated":
            parsed["truncated"] = True
        elif kind == "health" and len(parts) == 5:
            store_id, overall, core_state, last_sync = (_clean(p) for p in parts[1:])
            if store_id and overall in OVERALL_STATES and core_state in STATES:
                parsed["stores"].append({"store_id": store_id, "overall": overall,
                                         "core_state": core_state, "last_sync": last_sync})
        elif kind == "complete" and len(parts) == 3:
            store_id = _clean(parts[1])
            if store_id:
                parsed["complete"][store_id] = [r for r in parts[2].split(",") if _clean(r)][:60]
        elif kind == "resource" and len(parts) == 7:
            store_id, resource, capability, state, reason, last_success = parts[1:]
            store_id, resource, capability = _clean(store_id), _clean(resource), _clean(capability)
            if not (store_id and resource and capability and state in STATES):
                continue
            reason_code, _, scopes = reason.partition(":")
            parsed["resources"].append({
                "store_id": store_id, "resource": resource, "capability": capability,
                "state": state, "reason": _clean(reason_code) or "unknown",
                "missing_scopes": [s for s in scopes.split("+") if re.match(r"^read_[a-z_]+$", s)][:6],
                "last_success": _clean(last_success) if last_success != "never" else None,
            })
    parsed["available"] = bool(parsed["stores"])
    return parsed


def objective_summary(parsed: dict) -> dict:
    """A compact availability view for the agent objective (untrusted-input safe)."""
    if not parsed.get("available"):
        return {"status": "not_evaluated",
                "instruction": "Data freshness and completeness were not evaluated; do not claim data is complete or current."}
    gaps: dict[str, list[str]] = {}
    for resource in parsed["resources"]:
        gaps.setdefault(resource["state"], [])
        label = resource["resource"]
        if label not in gaps[resource["state"]] and len(gaps[resource["state"]]) < 12:
            gaps[resource["state"]].append(label)
    return {
        "stores": [{k: store[k] for k in ("overall", "core_state", "last_sync")} for store in parsed["stores"][:4]],
        "not_complete": gaps,
        "instruction": ("Only state what the available data supports. If a resource needed for the answer is "
                        "stale, incomplete, unavailable, unauthorized or unsupported, say so plainly in the "
                        "answer instead of treating missing data as zero."),
    }


def capabilities_for_domains(domains) -> set[str]:
    out: set[str] = set()
    for domain in domains or []:
        capability = _DOMAIN_TO_CAPABILITY.get(str(domain))
        if capability:
            out.add(capability)
    return out


def _sentence(resource: dict) -> str | None:
    name = resource["resource"].replace("_", " ").replace("-", " ").replace(".", " ")
    state, reason = resource["state"], resource["reason"]
    if state == "unauthorized":
        if reason == "permission_not_granted" and resource["missing_scopes"]:
            return (f"Shopify {name} data is excluded: the store has not granted the "
                    f"{', '.join(resource['missing_scopes'])} permission.")
        return f"Shopify {name} data is excluded because Shopify access is not currently authorized."
    if state == "unsupported":
        if reason == "not_collected_by_revluma":
            return f"{name.capitalize()} data is not collected by Revluma yet, so it is not part of this answer."
        return f"{name.capitalize()} data is not available from Shopify for this store."
    if state == "unavailable":
        return f"Shopify {name} data has not been retrieved yet, so it is not part of this answer."
    if state == "stale":
        when = resource["last_success"] or "an unknown time"
        return f"Shopify {name} data was last refreshed at {when}; more recent activity may be missing."
    if state == "incomplete":
        if reason == "insufficient_history":
            return f"Only limited Shopify {name} history is available."
        return f"Shopify {name} retrieval is still in progress, so these figures may be incomplete."
    return None


def relevant_limitations(parsed: dict, capabilities: set[str], *, limit: int = 4) -> list[str]:
    """Material limitations for the capabilities this answer depends on."""
    if not parsed.get("available") or not capabilities:
        return []
    sentences: list[str] = []
    for store in parsed["stores"]:
        if store["overall"] == "disconnected":
            sentences.append("The Shopify connection is not currently authorized, so store data may be out of date.")
        elif store["overall"] == "syncing" and capabilities & CORE_CAPABILITIES:
            sentences.append("Revluma is still synchronizing this store; figures may be incomplete until it finishes.")
    for resource in parsed["resources"]:
        if resource["capability"] not in capabilities:
            continue
        sentence = _sentence(resource)
        if sentence:
            sentences.append(sentence)
    return list(dict.fromkeys(sentences))[:limit]
