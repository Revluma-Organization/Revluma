"""Task 209 — canonical question understanding and bounded orchestration.

The investigation runtime remains the sole evidence/narrative authority. This
module resolves domains, creates a dependency-aware plan, executes the already
validated Task 208 specialists over shared evidence, and reconciles their
outputs without granting routing or generation any new authority.
"""
from __future__ import annotations

import hashlib
import re
import time
import uuid
from concurrent.futures import Future, ThreadPoolExecutor, TimeoutError as FutureTimeout
from datetime import datetime, timezone
from typing import Any, Callable

from .specialists import SPECIALISTS, execute_specialists

CONTRACT_VERSION = "rev-question-orchestration-v1"
QUESTION_CONTRACT_VERSION = "rev-question-understanding-v1"
STATES = ("received", "understanding", "planning", "executing", "reconciling",
          "composing", "validating", "completed", "partial_success",
          "needs_clarification", "unsupported", "failed", "cancelled")
DOMAINS = ("revenue", "checkout", "integration", "operational", "retention")
DOMAIN_SPECIALISTS = {"revenue": "revenue", "operational": "operational", "retention": "retention"}
DOMAIN_TOOLS = {
    "revenue": ("revenue_observations", "order_observations"),
    "checkout": ("checkout_observations",),
    "integration": ("integration_health", "data_coverage"),
    "operational": ("product_observations", "order_observations"),
    "retention": ("customer_observations", "order_observations"),
}
# Store health is the authorization gate; integration evidence is retrieved
# before domain work. Domain tools remain sequential on one SQLAlchemy session;
# independent specialist analysis is parallel because it touches no DB session.
DOMAIN_DEPENDENCIES = {name: ([] if name == "integration" else ["integration"]) for name in DOMAINS}
PATTERNS = {
    "revenue": re.compile(r"\b(?:revenue|sales|aov|average order|order value|orders?|refunds?|discounts?|cancell?|financial|profit|income|declin|drop|fell|falling|best[- ]performing products?|product revenue)\b", re.I),
    "checkout": re.compile(r"\b(?:checkouts?|abandon(?:ed|ment|ing)?|carts?)\b", re.I),
    "integration": re.compile(r"\b(?:integrat|connect(?:ed|ion|ivity)?|disconnect|oauth|authori[sz]|revok|expired|scopes?|permissions?|sync(?:ing|hroni[sz]ation)?|stale|freshness|webhooks?|latest orders?|missing evidence|data (?:availability|coverage)|retrieval fail|can't see|cannot see)\b", re.I),
    "operational": re.compile(r"\b(?:inventory|stock|stockouts?|fulfil|fulfill|shipping|delivery|unfulfilled|availability|warehouse|locations?)\b", re.I),
    "retention": re.compile(r"\b(?:retention|repeat|returning customers?|cohorts?|second purchase|customer history|customers? (?:buying|purchasing|returning)|fewer customers|churn|loyal)\b", re.I),
}
FOLLOWUP = re.compile(r"^(?:what about|could|can|is|are|why|how|which|tell me|explain|and|also|those|that|it)\b|\b(?:that|those orders|it|the decline|mentioned earlier|we discussed)\b", re.I)
OVERVIEW = re.compile(r"\b(?:biggest problem|store (?:health|performing poorly)|overall|business health|what should i fix|issue first)\b", re.I)


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def understand_question(message: str, intent: str, *, classification: dict | None = None,
                        context: dict | None = None) -> dict:
    """Resolve the smallest sufficient domain set, including elliptical context."""
    text = (message or "").strip()
    classification = classification or {}
    context = context or {}
    previous = context.get("last_orchestration") or {}
    previous_understanding = previous.get("question_understanding") or {}
    inherited_intent = ((context.get("last_investigation") or {}).get("intent")
                        or previous_understanding.get("primary_intent"))
    # The routing layer has already distinguished a standalone question from
    # an elliptical follow-up. Do not reinterpret ordinary questions beginning
    # with "how" or "why" as follow-ups when it explicitly decided otherwise.
    followup = (bool(classification["followup"]) if "followup" in classification
                else bool(FOLLOWUP.search(text) and inherited_intent))
    explicit = {name for name, pattern in PATTERNS.items() if pattern.search(text)}
    if re.search(r"which products? are affected|products? affected|product availability", text, re.I):
        explicit.add("operational")
    # "Why can't you see latest orders?" is data availability, not an unrelated
    # revenue performance investigation. Explicit integration language wins
    # unless the merchant independently asks for financial analysis.
    if re.search(r"why (?:can't|cannot) you see|data availability|sync(?:ing|hroni[sz]ation)? problem", text, re.I):
        explicit.discard("revenue")
    if OVERVIEW.search(text):
        explicit.update(("revenue", "checkout", "integration", "operational", "retention"))
    if followup and not explicit:
        inherited = previous_understanding.get("required_domains") or []
        if inherited:
            explicit.update(d for d in inherited if d in DOMAINS)
        elif inherited_intent:
            explicit.update(_intent_defaults(inherited_intent))
    # Expansions such as "could checkout explain it?" retain the previous
    # primary revenue investigation and add the newly requested domain.
    primary_intent = inherited_intent if followup and explicit and inherited_intent else intent
    primary_domain = _primary_domain(primary_intent, explicit)
    if followup and primary_domain and primary_domain not in explicit:
        explicit.add(primary_domain)
    if not explicit:
        explicit.update(_intent_defaults(intent))
    ordered = [name for name in DOMAINS if name in explicit]
    primary = primary_domain if primary_domain in ordered else (ordered[0] if ordered else None)
    if not followup and len(ordered) == 1:
        primary_intent = {
            "revenue": "revenue_investigation", "checkout": "checkout_investigation",
            "integration": "data_coverage", "operational": "product_investigation",
            "retention": "customer_retention",
        }[ordered[0]]
        primary = ordered[0]
    if "revenue" in explicit and re.search(r"\b(?:revenue|sales)\b[^.?!]*(?:declin|drop|fell|falling)|(?:declin|drop|fell|falling)[^.?!]*\b(?:revenue|sales)\b", text, re.I):
        primary_intent = "revenue_investigation"
        primary = "revenue"
    secondary = [name for name in ordered if name != primary]
    confidence = 0.96 if PATTERNS.get(primary or "", re.compile(r"$^")).search(text) else (0.86 if followup else 0.9)
    candidate_intents = [f"{domain}_investigation" for domain in ordered]
    return {
        "contract_version": QUESTION_CONTRACT_VERSION,
        "primary_intent": primary_intent,
        "primary_domain": primary,
        "secondary_intents": [f"{domain}_investigation" for domain in secondary],
        "candidate_intents": candidate_intents,
        "confidence": confidence,
        "classification_certainty": "resolved",
        "required_domains": ordered,
        "missing_information": [],
        "clarification_required": False,
        "partial_answer_allowed": True,
        "context_used": {
            "followup": followup,
            "inherited_intent": inherited_intent if followup else None,
            "previous_investigation_id": (context.get("last_investigation") or {}).get("id"),
            "reporting_period_inherited": bool(followup and (context.get("last_investigation") or {}).get("period")),
        },
    }


def _intent_defaults(intent: str) -> list[str]:
    return {
        "revenue_investigation": ["revenue"], "refund_investigation": ["revenue"],
        "checkout_investigation": ["checkout"], "customer_retention": ["retention"],
        "product_investigation": ["operational"], "data_coverage": ["integration"],
        "store_overview": list(DOMAINS), "finding_investigation": ["revenue", "integration", "operational"],
    }.get(intent, [])


def _primary_domain(intent: str, explicit: set[str]) -> str | None:
    defaults = _intent_defaults(intent)
    if defaults:
        return defaults[0]
    return next((name for name in DOMAINS if name in explicit), None)


def build_investigation_plan(*, message: str, intent: str, understanding: dict,
                             investigation_id: str, organization_id: str,
                             store_ids: list[str], period: dict,
                             available_tools: set[str] | None = None) -> dict:
    available_tools = available_tools or set()
    domains = list(understanding.get("required_domains") or [])
    # Baseline authorization and integration context always run first, but are
    # not falsely reported as merchant-requested domains.
    tools = ["store_health", "integration_health"]
    excluded = []
    for domain in domains:
        for tool in DOMAIN_TOOLS[domain]:
            if tool not in available_tools:
                excluded.append({"domain": domain, "capability": tool, "reason": "capability_unavailable"})
            elif tool not in tools:
                tools.append(tool)
    # Certified history is needed for temporal/coverage qualification even when
    # the integration domain itself was not requested.
    if any(domain != "integration" for domain in domains) and "data_coverage" in available_tools and "data_coverage" not in tools:
        tools.append("data_coverage")
    if re.search(r"\brefunds?|discounts?|cancell?", message, re.I) and "revenue" in domains and "refund_observations" in available_tools:
        tools.append("refund_observations")
    if intent == "product_investigation" and "inventory_observations" in available_tools:
        tools.append("inventory_observations")
    if intent in {"finding_investigation", "store_overview"} and "findings" in available_tools:
        tools.append("findings")
    selected = [DOMAIN_SPECIALISTS[d] for d in domains if d in DOMAIN_SPECIALISTS]
    selected = list(dict.fromkeys(selected))
    tasks = []
    for domain in domains:
        specialist = DOMAIN_SPECIALISTS.get(domain)
        tasks.append({
            "task_id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"rev:{investigation_id}:{domain}")),
            "domain": domain, "specialist": specialist,
            "requested_capability": f"{domain}_investigation",
            "dependencies": list(DOMAIN_DEPENDENCIES[domain]),
            "tools": [tool for tool in DOMAIN_TOOLS[domain] if tool in tools],
            "status": "planned", "attempts": 0, "result_execution_id": None,
            "failure": None, "started_at": None, "finished_at": None, "duration_ms": None,
        })
    fingerprint_payload = "\x1f".join([organization_id, ",".join(sorted(store_ids)), message.strip(),
        period.get("start") or "", period.get("end") or "", ",".join(domains)])
    return {
        "contract_version": CONTRACT_VERSION, "investigation_id": investigation_id,
        "request_fingerprint": hashlib.sha256(fingerprint_payload.encode()).hexdigest(),
        "tenant": {"organization_id": organization_id, "store_ids": sorted(store_ids)},
        "period": period, "question": message, "question_understanding": understanding,
        "required_domains": domains, "tools": tools, "tasks": tasks,
        "selected_specialists": selected,
        "excluded_specialists": [
            {"name": name, "reason": "not_required_by_resolved_domains"}
            for name in SPECIALISTS if name not in selected
        ] + excluded,
        "max_specialist_fanout": 3, "per_specialist_timeout_ms": 5000,
        "overall_deadline_ms": 12000, "max_transient_retries": 1,
        "max_recursion_depth": 0, "recursion_depth": 0,
        "shared_evidence": True, "parallel_analysis": True,
        "state": "planning", "state_history": [{"state": "received"}, {"state": "understanding"}, {"state": "planning"}],
        "started_at": _iso(), "finished_at": None,
        "reconciliation": {"shared_evidence_ids": [], "duplicate_fact_count": 0,
                           "contradictions": [], "relationships": [], "unresolved": []},
        "execution_records": [], "warnings": [],
    }


def _transition(plan: dict, state: str) -> None:
    if state not in STATES:
        raise ValueError("invalid orchestration state")
    plan["state"] = state
    plan["state_history"].append({"state": state, "at": _iso()})


def record_domain_evidence_execution(plan: dict, tools: dict) -> None:
    """Close canonical checkout/integration tasks from their real tool results."""
    for task in plan.get("tasks") or []:
        if task.get("specialist"):
            continue
        task["attempts"] = 1
        task["started_at"] = task["started_at"] or plan.get("started_at")
        unavailable = [name for name in task.get("tools") or []
                       if name in tools and tools[name].status in {"unavailable", "unsupported", "unauthorized", "storage_failure"}]
        task["status"] = "failed" if unavailable else "completed"
        task["finished_at"] = _iso()
        task["failure"] = {"error_class": "EvidenceUnavailable", "tools": unavailable} if unavailable else None
        plan["execution_records"].append({key: task.get(key) for key in (
            "task_id", "domain", "specialist", "requested_capability", "status", "attempts",
            "result_execution_id", "failure", "started_at", "finished_at", "duration_ms")})


def _safe_failure(name: str, task: dict, plan: dict, error_class: str, retryable: bool) -> dict:
    from .specialists import _base  # same canonical failed-result contract
    result = _base(name, str(uuid.uuid5(uuid.NAMESPACE_URL, f"rev:{plan['investigation_id']}:{name}:failure")),
        plan["question"], plan["question_understanding"].get("primary_intent") or "",
        plan["tenant"]["organization_id"], plan["tenant"]["store_ids"], plan["period"], plan["investigation_id"])
    result["diagnostics"] = {"error_class": error_class, "read_only": True, "retry_eligible": retryable}
    result["unknowns"] = [f"The {name} investigation did not complete; its domain conclusion is unavailable."]
    return result


def execute_orchestrated_specialists(plan: dict, *, period: dict, items: list[dict], tools: dict,
                                     executor: Callable[..., list[dict]] = execute_specialists,
                                     sleep: Callable[[float], None] = time.sleep) -> list[dict]:
    """Run independent pure analyses concurrently with bounded fan-out/retry.

    A timeout or permanent error affects only its domain. SQL/evidence retrieval
    has already completed, so no session or unvalidated context crosses threads.
    """
    selected = list(plan.get("selected_specialists") or [])
    if not selected:
        _transition(plan, "reconciling")
        return []
    _transition(plan, "executing")
    by_task = {task["specialist"]: task for task in plan["tasks"] if task.get("specialist")}
    results: dict[str, dict] = {}
    pending: dict[Future, tuple[str, int]] = {}
    pool = ThreadPoolExecutor(max_workers=min(3, len(selected)), thread_name_prefix="rev-domain")
    deadline = time.monotonic() + plan["overall_deadline_ms"] / 1000
    try:
        for name in selected:
            task = by_task[name]
            task.update(status="running", attempts=1, started_at=_iso())
            task["_started_monotonic"] = time.monotonic()
            future = pool.submit(executor, intent=plan["question_understanding"]["primary_intent"],
                question=plan["question"],
                organization_id=plan["tenant"]["organization_id"], store_ids=plan["tenant"]["store_ids"],
                investigation_id=plan["investigation_id"], period=period, items=items, tools=tools, selected=[name])
            pending[future] = (name, 1)
        while pending:
            remaining = max(0, deadline - time.monotonic())
            future = next(iter(pending))
            name, attempt = pending.pop(future)
            task = by_task[name]
            try:
                value = future.result(timeout=min(plan["per_specialist_timeout_ms"] / 1000, remaining))
                result = value[0] if value else _safe_failure(name, task, plan, "EmptySpecialistResult", False)
            except (FutureTimeout, TimeoutError):
                if attempt <= plan["max_transient_retries"] and time.monotonic() < deadline:
                    task["attempts"] = attempt + 1
                    task["_started_monotonic"] = time.monotonic()
                    sleep(min(0.01 * attempt, max(0, deadline - time.monotonic())))
                    retry = pool.submit(executor, intent=plan["question_understanding"]["primary_intent"],
                        question=plan["question"],
                        organization_id=plan["tenant"]["organization_id"], store_ids=plan["tenant"]["store_ids"],
                        investigation_id=plan["investigation_id"], period=period, items=items, tools=tools, selected=[name])
                    pending[retry] = (name, attempt + 1)
                    continue
                result = _safe_failure(name, task, plan, "SpecialistTimeout", True)
            except Exception as exc:
                transient = isinstance(exc, (ConnectionError, OSError)) and not isinstance(exc, PermissionError)
                if transient and attempt <= plan["max_transient_retries"] and time.monotonic() < deadline:
                    task["attempts"] = attempt + 1
                    task["_started_monotonic"] = time.monotonic()
                    sleep(0.01 * attempt)
                    retry = pool.submit(executor, intent=plan["question_understanding"]["primary_intent"],
                        question=plan["question"],
                        organization_id=plan["tenant"]["organization_id"], store_ids=plan["tenant"]["store_ids"],
                        investigation_id=plan["investigation_id"], period=period, items=items, tools=tools, selected=[name])
                    pending[retry] = (name, attempt + 1)
                    continue
                result = _safe_failure(name, task, plan, type(exc).__name__, transient)
            results[name] = result
            task.update(status="failed" if result.get("status") == "error" else "completed",
                finished_at=_iso(), result_execution_id=result.get("execution_id"),
                duration_ms=max(0, round((time.monotonic() - task.pop("_started_monotonic", time.monotonic())) * 1000)),
                failure=result.get("diagnostics") if result.get("status") == "error" else None)
            plan["execution_records"].append({key: task.get(key) for key in (
                "task_id", "domain", "specialist", "requested_capability", "status", "attempts",
                "result_execution_id", "failure", "started_at", "finished_at", "duration_ms")})
        if time.monotonic() >= deadline and len(results) < len(selected):
            plan["warnings"].append("The orchestration deadline was reached; unfinished domains remain unavailable.")
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
    _transition(plan, "reconciling")
    return [results[name] for name in selected if name in results]


def reconcile_orchestration(plan: dict, specialists: list[dict], items: list[dict], *, finalize: bool = True) -> dict:
    """Deduplicate shared evidence and expose only genuinely comparable conflicts."""
    item_by_id = {item.get("id"): item for item in items}
    usage: dict[str, set[str]] = {}
    observations: dict[tuple, list[tuple[str, dict]]] = {}
    hypotheses = set()
    for result in specialists:
        name = (result.get("specialist") or {}).get("name") or "unknown"
        for ref in result.get("evidence_references") or []:
            usage.setdefault(ref, set()).add(name)
        for fact in [*(result.get("verified_facts") or []), *(result.get("calculated_findings") or [])]:
            p = fact.get("period") or {}
            key = (fact.get("metric"), fact.get("definition"), fact.get("unit"), fact.get("currency"), p.get("start"), p.get("end"))
            observations.setdefault(key, []).append((name, fact))
        for hypothesis in result.get("hypotheses") or []:
            hypotheses.add((name, hypothesis.get("statement")))
    shared = sorted(ref for ref, owners in usage.items() if len(owners) > 1 and ref in item_by_id)
    contradictions = []
    duplicate_count = 0
    for key, entries in observations.items():
        values = {str(fact.get("value")) for _, fact in entries}
        if len(entries) > 1:
            duplicate_count += len(entries) - 1
        if len(values) > 1:
            refs = sorted({ref for _, fact in entries for ref in fact.get("evidence_references") or []})
            freshness = sorted({str((item_by_id.get(ref, {}).get("freshness") or {}).get("state")) for ref in refs})
            contradictions.append({"metric": key[0], "status": "unresolved", "specialists": sorted({n for n, _ in entries}),
                "evidence_references": refs, "freshness_states": freshness,
                "reason": "Same definition, unit, currency and period have different values; values are preserved, not averaged."})
    relationships = []
    domains = set(plan.get("required_domains") or [])
    if "revenue" in domains and domains & {"checkout", "operational", "retention"}:
        relationships.append({"type": "cross_domain_dependency_review",
            "domains": sorted(domains), "causal_status": "not_established",
            "statement": "The domains were compared over their own authorized evidence; concurrent patterns alone do not establish causation."})
    unresolved = [c["metric"] for c in contradictions]
    unresolved.extend(f"{name}_specialist_failed" for name, result in (( (r.get("specialist") or {}).get("name"), r) for r in specialists) if result.get("status") == "error")
    reconciliation = {"shared_evidence_ids": shared, "duplicate_fact_count": duplicate_count,
        "contradictions": contradictions, "relationships": relationships,
        "unresolved": sorted(set(unresolved)), "hypotheses_promoted_to_facts": 0,
        "repeated_hypotheses": len(hypotheses) < sum(len(r.get("hypotheses") or []) for r in specialists)}
    plan["reconciliation"] = reconciliation
    failed = any(r.get("status") == "error" for r in specialists) or any(
        record.get("status") == "failed" for record in plan.get("execution_records") or [])
    if finalize:
        _transition(plan, "partial_success" if failed or contradictions else "completed")
        plan["finished_at"] = _iso()
    else:
        plan["terminal_state"] = "partial_success" if failed or contradictions else "completed"
    return reconciliation


def cross_domain_narrative(plan: dict) -> str:
    if len(plan.get("required_domains") or []) < 2:
        return ""
    lines = ["## Cross-domain reading"]
    for relation in plan.get("reconciliation", {}).get("relationships", []):
        lines.append(relation["statement"])
    for contradiction in plan.get("reconciliation", {}).get("contradictions", []):
        lines.append(f"The {contradiction['metric'].replace('_', ' ')} values conflict and remain unresolved; I have not chosen or averaged them.")
    failed = [r["domain"] for r in plan.get("execution_records", []) if r.get("status") == "failed"]
    if failed:
        lines.append("The " + ", ".join(failed) + " investigation did not complete. Other domain findings remain valid independently, but no conclusion is made for the failed domain.")
    return "\n".join(lines) if len(lines) > 1 else ""


def validate_orchestration(value: dict, *, organization_id: str, evidence_ids: set[str]) -> list[str]:
    errors = []
    if value.get("contract_version") != CONTRACT_VERSION:
        errors.append("orchestration_contract_version")
    if value.get("state") not in STATES:
        errors.append("orchestration_state")
    if (value.get("tenant") or {}).get("organization_id") != organization_id:
        errors.append("orchestration_tenant")
    if value.get("recursion_depth") != 0 or value.get("max_recursion_depth") != 0:
        errors.append("orchestration_recursion")
    if len(value.get("selected_specialists") or []) > value.get("max_specialist_fanout", 0):
        errors.append("orchestration_fanout")
    for task in value.get("tasks") or []:
        if task.get("domain") not in DOMAINS or task.get("specialist") not in {None, *SPECIALISTS}:
            errors.append("orchestration_capability")
        if set(task.get("dependencies") or []) - set(DOMAINS):
            errors.append("orchestration_dependency")
    for contradiction in (value.get("reconciliation") or {}).get("contradictions", []):
        if any(ref not in evidence_ids for ref in contradiction.get("evidence_references") or []):
            errors.append("orchestration_evidence_reference")
    return sorted(set(errors))
