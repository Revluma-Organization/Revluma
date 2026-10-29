"""Evidence-only briefing: no model can invent metrics or assert checkout coverage."""
from decimal import Decimal
from datetime import date


def compose_seven_day_briefing(evidence: dict) -> str:
    start = evidence["period_start_utc"][:10]
    end = evidence["period_end_utc"][:10]
    start_label = date.fromisoformat(start).strftime("%-d %B %Y")
    end_label = date.fromisoformat(end).strftime("%-d %B %Y")
    lines = [f"## Your Shopify performance briefing ({start_label} - {end_label})",
             "Here's what Revluma can verify from your connected store records."]

    if evidence["store_count"] == 0:
        lines.append("I couldn't find an active connected store for your organization. Connect your store and complete the initial sync before we review performance.")
        return "\n\n".join(lines)

    sync = evidence.get("last_store_sync_at")
    if sync:
        lines.append(f"**Data freshness:** The oldest last-sync timestamp among connected stores is {sync}. This is a recorded sync time, not proof that all events are complete.")
    else:
        lines.append("**Data freshness:** No completed sync timestamp is available. Treat the numbers below as potentially incomplete.")

    orders = evidence["orders"]
    if orders["status"] != "available":
        lines.append("**Orders:** Unavailable. I can't verify order counts or recorded sales values right now.")
    elif not orders["by_currency"]:
        lines.append("**Orders:** No orders were recorded in this seven-day window. This is not proof that Shopify had no sales if ingestion is incomplete.")
    else:
        parts = [f'{r["order_count"]} orders totalling {r["gross_recorded_order_value"]} {r["currency"]} (average {r["average_order_value"]} {r["currency"]})' for r in orders["by_currency"]]
        lines.append("**Recorded orders:** " + "; ".join(parts) + ". These are recorded order totals, not verified net revenue.")

    carts = evidence["abandoned_carts"]
    if carts["status"] != "available":
        lines.append("**Abandoned carts:** Unavailable.")
    elif not carts["by_currency"]:
        lines.append("**Abandoned carts:** None recorded in the window. Tracking completeness is not verified.")
    else:
        lines.append("**Abandoned carts:** " + "; ".join(f'{r["cart_count"]} carts with recorded value {r["cart_value"]} {r["currency"]}' for r in carts["by_currency"]) + ".")

    recovered = evidence["recovered_carts"]
    if recovered["status"] == "available":
        lines.append(f'**Recoveries:** {recovered["count"]} carts have a recovery timestamp within this window. This is not a recovery rate or proof of attributed revenue.')
    else:
        lines.append("**Recoveries:** Unavailable.")

    lines.append("**Checkout funnel:** Not yet verified. I won't calculate checkout conversion or drop-off without a validated event source.")

    priorities = []
    if orders["status"] != "available" or carts["status"] != "available":
        priorities.append("Restore the missing data query before making decisions from these figures.")
    if not sync:
        priorities.append("Confirm the initial Shopify sync completed and that recent orders and checkouts are arriving.")
    if carts["status"] == "available" and carts["by_currency"]:
        priorities.append("Review the abandoned-cart list and recovery eligibility before deciding on follow-up messages.")
    priorities.append("Compare these recorded counts against Shopify Admin to verify ingestion completeness.")
    lines.append("## What I'd check next\n" + "\n".join(f"{i}. {p}" for i, p in enumerate(priorities, 1)))
    lines.append("Want me to start by checking whether your most recent orders and abandoned carts match Shopify?")
    return "\n\n".join(lines)
