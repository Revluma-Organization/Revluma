"""
Rev Intelligence — Morning Briefing Generator
==============================================
Runs at 05:00 UTC daily for all active merchants.
Produces a structured 6-section briefing from the current Business State
via the Orchestrator in Briefing mode.

Design rules (from spec):
  - Reads from Business State only, never queries DB directly.
  - Greeting is exactly one sentence with one key metric and one hook.
  - "Yesterday in numbers" suppresses stable metrics — only changes appear.
  - "Today's priority" is one action only, not a list.
  - "Active concerns" explicitly states "No active concerns today." if none.
  - "Opportunities" lists only actions executable right now with available tools.
  - "What Rev did overnight" is a full, unfiltered log — nothing hidden.

Availability target: ready within 10 minutes of 05:00 UTC.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import text

from .business_state import BusinessState, load_current_business_state

logger = logging.getLogger("rev.morning_briefing")

# Metric is considered "stable" (suppressed from yesterday section) if the
# absolute percentage change is below this threshold.
STABLE_DELTA_THRESHOLD_PCT = 5.0


# ── Data classes ──────────────────────────────────────────────────────────────

@dataclass
class BriefingSection:
    title: str
    content: str
    action_label: str | None = None
    action_tool: str | None = None


@dataclass
class MorningBriefing:
    id: str
    organization_id: str
    generated_at: datetime
    merchant_name: str

    greeting: str
    yesterday_in_numbers: list[dict]        # [{metric, value, delta, direction}]
    todays_priority: dict                   # {description, estimated_impact, action_label}
    active_concerns: list[dict]             # [{severity, description, action_label}]
    opportunities: list[dict]               # [{description, estimated_value, action_label}]
    overnight_log: list[str]               # chronological list of autonomous actions

    has_concerns: bool = False
    fallback_used: bool = False             # True if Business State was unavailable

    def to_dict(self) -> dict:
        return {
            "id":                   self.id,
            "organization_id":      self.organization_id,
            "generated_at":         self.generated_at.isoformat(),
            "merchant_name":        self.merchant_name,
            "greeting":             self.greeting,
            "yesterday_in_numbers": self.yesterday_in_numbers,
            "todays_priority":      self.todays_priority,
            "active_concerns":      self.active_concerns,
            "opportunities":        self.opportunities,
            "overnight_log":        self.overnight_log,
            "has_concerns":         self.has_concerns,
            "fallback_used":        self.fallback_used,
        }


# ── Public entry points ───────────────────────────────────────────────────────

def generate_briefing(
    organization_id: str,
    db,
    user_id: str | None = None,
) -> MorningBriefing:
    """
    Generates the morning briefing for a single merchant.

    Loads the current Business State, then builds all 6 sections from it.
    If the Business State is unavailable, returns a safe fallback briefing
    that acknowledges the data gap without crashing.

    Args:
        organization_id: The merchant's organisation UUID.
        db: SQLAlchemy session.
        user_id: Authorized organization member receiving the briefing.

    Returns:
        MorningBriefing — always. Never raises.
    """
    briefing_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)

    merchant_name = _load_merchant_name(organization_id, db)

    state = load_current_business_state(organization_id, db)

    if state is None or state.computation_status == "failed":
        logger.warning(
            "morning_briefing_no_state",
            extra={"org_id": organization_id},
        )
        return _fallback_briefing(briefing_id, organization_id, merchant_name, now)

    overnight_actions = _load_overnight_actions(organization_id, db)

    greeting          = _build_greeting(merchant_name, state)
    yesterday_numbers = _build_yesterday_in_numbers(state)
    todays_priority   = _build_todays_priority(state)
    if user_id:
        orchestration = _run_briefing_orchestration(
            organization_id,
            user_id,
            db,
        )
        todays_priority = _apply_orchestrator_priority(
            todays_priority,
            orchestration,
        )
    concerns          = _build_active_concerns(state)
    opportunities     = _build_opportunities(state)

    briefing = MorningBriefing(
        id=briefing_id,
        organization_id=organization_id,
        generated_at=now,
        merchant_name=merchant_name,
        greeting=greeting,
        yesterday_in_numbers=yesterday_numbers,
        todays_priority=todays_priority,
        active_concerns=concerns,
        opportunities=opportunities,
        overnight_log=overnight_actions,
        has_concerns=len(concerns) > 0 and concerns[0].get("description") != "No active concerns today.",
        fallback_used=False,
    )

    _persist_briefing(briefing, db)
    return briefing


def run_briefings_for_all_merchants(db) -> dict:
    """
    Generates and persists morning briefings for every active merchant.

    Intended to be called by the scheduler at 05:00 UTC daily.
    Errors for individual merchants are caught and logged — one failed
    merchant must never stop briefings for all others.

    Args:
        db: SQLAlchemy session.

    Returns:
        dict: {"total": int, "success": int, "failed": int, "errors": list}
    """
    results = {"total": 0, "success": 0, "failed": 0, "errors": []}

    try:
        rows = db.execute(
            text("""
                SELECT o.id, o.owner_id
                FROM organizations o
                JOIN stores s ON s.organization_id = o.id
                WHERE s.status = 'connected'
                  AND o.status = 'active'
                GROUP BY o.id, o.owner_id
            """)
        ).fetchall()
        merchants = [(str(row[0]), str(row[1])) for row in rows]
    except Exception as exc:
        logger.error(
            "morning_briefing_org_fetch_failed",
            extra={"error_type": type(exc).__name__},
        )
        results["errors"].append("Could not fetch organizations.")
        return results

    results["total"] = len(merchants)

    for org_id, user_id in merchants:
        try:
            generate_briefing(org_id, db, user_id=user_id)
            results["success"] += 1
            logger.info("morning_briefing_generated", extra={"org_id": org_id})
        except Exception as exc:
            results["failed"] += 1
            results["errors"].append(f"{org_id}: briefing generation failed")
            logger.error(
                "morning_briefing_failed",
                extra={"org_id": org_id, "error_type": type(exc).__name__},
            )

    logger.info(
        "morning_briefing_run_complete",
        extra={
            "total": results["total"],
            "success": results["success"],
            "failed": results["failed"],
        },
    )
    return results


def _run_briefing_orchestration(organization_id: str, user_id: str, db):
    """Run the full D5 pipeline for the scheduled proactive briefing."""
    try:
        from ..agents.orchestrator import orchestrate

        return orchestrate(
            organization_id=organization_id,
            user_id=user_id,
            message="Prepare today's morning business briefing.",
            conversation_id=None,
            db=db,
            trigger_type="scheduler",
            trigger_priority="normal",
            context_payload={"schedule": "morning_briefing"},
        )
    except Exception as exc:
        logger.error(
            "morning_briefing_orchestration_failed",
            extra={"error_type": type(exc).__name__},
        )
        return None


def _apply_orchestrator_priority(priority: dict, orchestration) -> dict:
    """Use only a verified Orchestrator analysis to replace the primary action."""
    if (
        orchestration is None
        or not getattr(orchestration, "success", False)
        or getattr(orchestration, "response_type", None) != "analysis"
        or not str(getattr(orchestration, "recommendation", "") or "").strip()
    ):
        return priority

    actions = getattr(orchestration, "actions", None) or []
    action = actions[0] if actions and isinstance(actions[0], dict) else {}
    tool = action.get("tool")
    if tool not in {
        "view_carts",
        "view_customers",
        "view_revenue",
        "create_campaign",
        "view_analytics",
        "view_products",
        "view_checkout",
    }:
        return priority

    return {
        "description": str(orchestration.recommendation).strip(),
        "estimated_impact": (
            str(getattr(orchestration, "implication", "") or "").strip()
            or priority["estimated_impact"]
        ),
        "action_label": str(action.get("label") or priority["action_label"]),
        "action_tool": tool,
        "action_params": action.get("params") or {},
    }


# ── Section builders ──────────────────────────────────────────────────────────

def _build_greeting(merchant_name: str, state: BusinessState) -> str:
    """
    Builds the single-sentence greeting line.

    Spec: one sentence, one key metric, one hook to the priority section.
    Never: "Good morning! I hope you are doing well today!"
    The most significant metric available is chosen as the hook.

    Args:
        merchant_name: First name or display name of the merchant.
        state: Current Business State.

    Returns:
        str: A single complete sentence.
    """
    name = merchant_name.split()[0] if merchant_name else "there"

    # Pick the single most impactful metric for the greeting
    if state.revenue_anomaly and state.revenue_delta_pct is not None:
        direction = "up" if state.revenue_delta_pct > 0 else "down"
        magnitude = abs(state.revenue_delta_pct)
        hook = "one revenue anomaly needs your attention." if state.revenue_delta_pct < 0 else "strong growth to review."
        return (
            f"Good morning {name} — revenue is {direction} "
            f"{magnitude:.0f}% vs yesterday, and there is {hook}"
        )

    if state.cart_anomaly and state.abandoned_cart_value:
        val = float(state.abandoned_cart_value)
        return (
            f"Good morning {name} — ${val:,.0f} in carts abandoned overnight "
            f"and one recovery action is ready to launch."
        )

    if state.revenue_today is not None:
        rev = float(state.revenue_today)
        if state.revenue_delta_pct is not None and abs(state.revenue_delta_pct) >= STABLE_DELTA_THRESHOLD_PCT:
            direction = "up" if state.revenue_delta_pct > 0 else "down"
            return (
                f"Good morning {name} — revenue is {direction} "
                f"{abs(state.revenue_delta_pct):.0f}% today at ${rev:,.0f}."
            )
        return f"Good morning {name} — revenue is ${rev:,.0f} today, stable vs yesterday."

    if state.churn_risk_count and state.churn_risk_count > 0:
        return (
            f"Good morning {name} — {state.churn_risk_count} customers "
            f"are showing early churn signals and need attention today."
        )

    return f"Good morning {name} — your store is active and Rev has your overnight summary ready."


def _build_yesterday_in_numbers(state: BusinessState) -> list[dict]:
    """
    Returns metrics that changed significantly vs their baseline.

    Spec: only metrics that changed are included — stable metrics are suppressed.
    Returns 3 to 5 items maximum.

    Args:
        state: Current Business State.

    Returns:
        list[dict]: [{metric, value, delta, direction, formatted_value}]
    """
    metrics = []

    # Revenue delta
    if (state.revenue_delta_pct is not None
            and abs(state.revenue_delta_pct) >= STABLE_DELTA_THRESHOLD_PCT):
        metrics.append({
            "metric":          "revenue_today",
            "label":           "Revenue",
            "value":           float(state.revenue_today) if state.revenue_today else 0,
            "delta":           state.revenue_delta_pct,
            "direction":       "up" if state.revenue_delta_pct > 0 else "down",
            "formatted_value": f"${float(state.revenue_today):,.2f}" if state.revenue_today else "$0",
            "formatted_delta": f"{state.revenue_delta_pct:+.1f}% vs yesterday",
        })

    # 7-day trend
    if (state.revenue_trend_7d is not None
            and abs(state.revenue_trend_7d) >= STABLE_DELTA_THRESHOLD_PCT):
        metrics.append({
            "metric":          "revenue_trend_7d",
            "label":           "7-day revenue trend",
            "value":           state.revenue_trend_7d,
            "delta":           state.revenue_trend_7d,
            "direction":       "up" if state.revenue_trend_7d > 0 else "down",
            "formatted_value": f"{state.revenue_trend_7d:+.1f}%",
            "formatted_delta": "vs prior 7 days",
        })

    # Cart abandonment (always include if non-zero — it's always actionable)
    cart_delta = state.cart_delta_pct_vs_avg
    if (
        state.abandoned_cart_count
        and state.abandoned_cart_count > 0
        and (
            state.cart_anomaly
            or (
                cart_delta is not None
                and abs(cart_delta) >= STABLE_DELTA_THRESHOLD_PCT
            )
        )
    ):
        metrics.append({
            "metric":          "abandoned_cart_count",
            "label":           "Abandoned carts",
            "value":           state.abandoned_cart_count,
            "delta":           cart_delta,
            "direction":       "down",   # abandonment is always bad
            "formatted_value": str(state.abandoned_cart_count),
            "formatted_delta": (
                f"{cart_delta:+.1f}% vs 30-day average"
                if cart_delta is not None
                else "outside the expected range"
            ),
        })

    # Churn risk (include only if there are at-risk customers)
    if state.churn_risk_count and state.churn_risk_count > 0:
        metrics.append({
            "metric":          "churn_risk_count",
            "label":           "Customers at churn risk",
            "value":           state.churn_risk_count,
            "delta":           None,
            "direction":       "down",
            "formatted_value": str(state.churn_risk_count),
            "formatted_delta": "require attention",
        })

    # Returning customer rate change
    if (state.returning_customer_rate is not None
            and state.returning_customer_rate < 0.20):
        # Low returning rate is notable — include it
        metrics.append({
            "metric":          "returning_customer_rate",
            "label":           "Returning customer rate",
            "value":           state.returning_customer_rate,
            "delta":           None,
            "direction":       "down",
            "formatted_value": f"{state.returning_customer_rate:.1%}",
            "formatted_delta": "below healthy baseline of 20%",
        })

    return metrics[:5]   # cap at 5 per spec


def _build_todays_priority(state: BusinessState) -> dict:
    """
    Identifies the single most important action for the merchant today.

    Spec: one recommended action with estimated impact and one action button.
    Not a list — exactly one thing.

    Args:
        state: Current Business State.

    Returns:
        dict: {description, estimated_impact, action_label, action_tool}
    """
    # Priority order: anomalies > abandoned carts > churn > VIP reactivation
    if state.revenue_anomaly and state.revenue_delta_pct is not None and state.revenue_delta_pct < -20:
        return {
            "description":      "Revenue has dropped significantly. Investigate today's orders for payment failures, traffic source changes, or stockouts before the pattern continues.",
            "estimated_impact": f"Observed revenue gap: {abs(state.revenue_delta_pct):.0f}% versus yesterday",
            "action_label":     "Investigate revenue drop",
            "action_tool":      "view_revenue",
        }

    if state.abandoned_cart_count and state.abandoned_cart_count > 0:
        val = float(state.abandoned_cart_value or 0)
        return {
            "description":      f"Launch a recovery sequence for {state.abandoned_cart_count} abandoned carts worth ${val:,.0f}. The sooner the recovery fires, the higher the conversion rate.",
            "estimated_impact": f"At-risk cart value: ${val:,.0f}",
            "action_label":     "Review abandoned carts",
            "action_tool":      "view_carts",
        }

    if state.churn_risk_count and state.churn_risk_count > 5:
        return {
            "description":      f"Send a win-back sequence to {state.churn_risk_count} customers showing early churn signals before they go cold.",
            "estimated_impact": f"Customers requiring review: {state.churn_risk_count}",
            "action_label":     "Review at-risk customers",
            "action_tool":      "view_customers",
        }

    if state.vip_inactive_count and state.vip_inactive_count > 0:
        return {
            "description":      f"Re-engage {state.vip_inactive_count} VIP customers who have been inactive for 45+ days. These are your highest-LTV customers.",
            "estimated_impact": f"Inactive VIPs requiring review: {state.vip_inactive_count}",
            "action_label":     "Review inactive VIPs",
            "action_tool":      "view_customers",
        }

    if state.opportunities:
        opp = state.opportunities[0]
        return {
            "description":      opp.get("description", "No critical actions required today."),
            "estimated_impact": f"${opp['estimated_value']:,.0f} estimated value" if opp.get("estimated_value") else "Positive impact expected",
            "action_label":     opp.get("action", "View details"),
            "action_tool":      _opp_tool(opp.get("category", "")) or "view_analytics",
        }

    return {
        "description":      "No critical actions required today. Monitor incoming orders and keep recovery sequences live.",
        "estimated_impact": "Preventative",
        "action_label":     "View store overview",
        "action_tool":      "view_analytics",
    }


def _build_active_concerns(state: BusinessState) -> list[dict]:
    """
    Builds the list of active concerns.

    Spec: up to 3 concerns. If no concerns, explicitly return a single-item
    list with the message "No active concerns today." — never return an
    empty list, as that is ambiguous to the frontend.

    Args:
        state: Current Business State.

    Returns:
        list[dict]: [{severity, description, action_label}] — min 1 item.
    """
    concerns = []

    for risk in state.risks[:3]:
        concerns.append({
            "severity":    risk.get("severity", "medium"),
            "description": risk.get("description", "Unknown risk."),
            "action_label": "Investigate",
            "action_tool": "view_analytics",
        })

    if state.revenue_anomaly and not any(c["description"].startswith("Revenue") for c in concerns):
        delta = state.revenue_delta_pct or 0
        concerns.append({
            "severity":    "high" if delta < -30 else "medium",
            "description": f"Revenue anomaly detected: {delta:+.1f}% vs yesterday.",
            "action_label": "View revenue",
            "action_tool": "view_revenue",
        })

    if state.cart_anomaly and not any("cart" in c["description"].lower() for c in concerns):
        concerns.append({
            "severity":    "medium",
            "description": "Cart abandonment rate is elevated above the 30-day average.",
            "action_label": "View carts",
            "action_tool": "view_carts",
        })

    concerns = concerns[:3]

    # Spec: never return an empty list
    if not concerns:
        return [{
            "severity":    "none",
            "description": "No active concerns today.",
            "action_label": None,
            "action_tool": None,
        }]

    return concerns


def _build_opportunities(state: BusinessState) -> list[dict]:
    """
    Builds ranked opportunities — only those executable right now.

    Spec: up to 3, ranked by estimated value, only list opportunities
    that can be executed immediately with available tools.

    Args:
        state: Current Business State.

    Returns:
        list[dict]: [{description, estimated_value, action_label, action_tool}]
    """
    opps = []

    for raw in state.opportunities:
        action_tool = _opp_tool(raw.get("category", ""))
        if raw.get("estimated_value") is not None and action_tool:
            opps.append({
                "description":     raw.get("description", ""),
                "estimated_value": raw.get("estimated_value"),
                "action_label":    raw.get("action", "Take action"),
                "action_tool":     action_tool,
            })

    # Sort by estimated value descending
    opps.sort(key=lambda x: x["estimated_value"] or 0, reverse=True)
    return opps[:3]


def _opp_tool(category: str) -> str | None:
    """Maps an opportunity category to an available tool identifier."""
    return {
        "cart_recovery":    "view_carts",
        "churn_prevention": "view_customers",
        "retention":        "view_customers",
        "revenue":          "view_revenue",
        "product":          "view_products",
    }.get(category)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _load_merchant_name(organization_id: str, db) -> str:
    """Loads the merchant's display name from the organizations table."""
    try:
        row = db.execute(
            text("SELECT name FROM organizations WHERE id = :o LIMIT 1"),
            {"o": organization_id},
        ).fetchone()
        return str(row[0]) if row else "Merchant"
    except Exception:
        return "Merchant"


def _load_overnight_actions(organization_id: str, db) -> list[str]:
    """
    Loads a log of any autonomous actions Rev took while the merchant was offline.

    Queries the canonical audit_logs table for actions in the last 12 hours
    that were triggered autonomously (not by the merchant directly).

    Returns an empty list if no autonomous actions were taken — the frontend
    will render "Rev did not take any autonomous actions overnight."
    """
    try:
        rows = db.execute(
            text("""
                SELECT action, created_at
                FROM audit_logs
                WHERE organization_id = :o
                  AND context->>'actor' = 'rev_autonomous'
                  AND created_at >= NOW() - INTERVAL '12 hours'
                ORDER BY created_at ASC
            """),
            {"o": organization_id},
        ).fetchall()
        return [f"{r[0]} ({_format_time(r[1])})" for r in rows]
    except Exception as exc:
        logger.warning(
            "overnight_actions_load_failed",
            extra={"error_type": type(exc).__name__},
        )
        return []


def _format_time(dt: datetime) -> str:
    """Formats a datetime as a short time string for the overnight log."""
    if dt is None:
        return ""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.strftime("%H:%M UTC")


def _persist_briefing(briefing: MorningBriefing, db) -> None:
    """
    Writes the generated briefing to the morning_briefings table.

    Non-fatal: a persistence failure must never prevent the briefing from
    being returned to the caller.
    """
    import json
    try:
        db.execute(
            text("""
                INSERT INTO morning_briefings (
                    id, organization_id, generated_at, merchant_name,
                    greeting, yesterday_in_numbers, todays_priority,
                    active_concerns, opportunities, overnight_log,
                    has_concerns, fallback_used
                ) VALUES (
                    :id, :org, :gen_at, :name,
                    :greeting, CAST(:yin AS jsonb), CAST(:tp AS jsonb),
                    CAST(:ac AS jsonb), CAST(:opp AS jsonb), CAST(:log AS jsonb),
                    :has_concerns, :fallback
                )
                ON CONFLICT (organization_id, generated_at::date)
                DO UPDATE SET
                    greeting             = EXCLUDED.greeting,
                    yesterday_in_numbers = EXCLUDED.yesterday_in_numbers,
                    todays_priority      = EXCLUDED.todays_priority,
                    active_concerns      = EXCLUDED.active_concerns,
                    opportunities        = EXCLUDED.opportunities,
                    overnight_log        = EXCLUDED.overnight_log,
                    has_concerns         = EXCLUDED.has_concerns,
                    fallback_used        = EXCLUDED.fallback_used,
                    updated_at           = NOW()
            """),
            {
                "id":          briefing.id,
                "org":         briefing.organization_id,
                "gen_at":      briefing.generated_at,
                "name":        briefing.merchant_name,
                "greeting":    briefing.greeting,
                "yin":         json.dumps(briefing.yesterday_in_numbers),
                "tp":          json.dumps(briefing.todays_priority),
                "ac":          json.dumps(briefing.active_concerns),
                "opp":         json.dumps(briefing.opportunities),
                "log":         json.dumps(briefing.overnight_log),
                "has_concerns": briefing.has_concerns,
                "fallback":    briefing.fallback_used,
            },
        )
        db.commit()
    except Exception as exc:
        logger.error(
            "morning_briefing_persist_failed",
            extra={"error_type": type(exc).__name__},
        )
        try:
            db.rollback()
        except Exception:
            logger.error("morning_briefing_persist_rollback_failed")


def _fallback_briefing(
    briefing_id: str,
    organization_id: str,
    merchant_name: str,
    now: datetime,
) -> MorningBriefing:
    """
    Returns a safe fallback briefing when Business State is unavailable.

    The merchant always gets a briefing — even if it just tells them
    that Rev could not load the data and they should check their store connection.
    """
    name = merchant_name.split()[0] if merchant_name else "there"
    return MorningBriefing(
        id=briefing_id,
        organization_id=organization_id,
        generated_at=now,
        merchant_name=merchant_name,
        greeting=f"Good morning {name} — Rev could not load your store data this morning.",
        yesterday_in_numbers=[],
        todays_priority={
            "description":      "Check your store connection in Revluma settings. If the issue persists, Rev will retry automatically.",
            "estimated_impact": "Data will be available once store sync completes.",
            "action_label":     "Check store connection",
            "action_tool":      "view_analytics",
        },
        active_concerns=[{
            "severity":    "medium",
            "description": "Business State could not be loaded. Store data may be unavailable.",
            "action_label": "Check store connection",
            "action_tool": "view_analytics",
        }],
        opportunities=[],
        overnight_log=[],
        has_concerns=True,
        fallback_used=True,
    )
