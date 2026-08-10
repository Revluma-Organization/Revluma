"""
Revluma Raw Event Processor
============================
Converts raw tracking pixel events (from POST /api/tracking/event)
into a clean, normalised, feature-ready format before the feature
engineering pipeline processes them.

This sits between:
    [Tracking Pixel] → POST /api/tracking/event
                     → customer_events table (S4)
                     → [THIS PROCESSOR]
                     → Feature Engineering Pipeline (pipeline.py)
                     → Redis Feature Store (S8)

"""

from __future__ import annotations
from datetime import datetime
from typing import Any

def _safe_parse_timestamp(ts: str) -> datetime | None:
    """
    Attempts to parse an ISO 8601 timestamp string into a datetime object.
    Returns None on any failure — never raises.

    Args:
        ts (str): Raw timestamp string from the pixel event.

    Returns:
        datetime | None: Parsed datetime (UTC-aware if 'Z' suffix present),
                         or None if the string is absent, malformed, or not a string.
    """
    if not ts or not isinstance(ts, str):
        return None
    try:
        normalized = ts.replace("Z", "+00:00")
        return datetime.fromisoformat(normalized)
    except (ValueError, TypeError):
        return None
    
def parse_raw_event(raw_payload: dict) -> dict:
    """
    Validates and normalises a single raw event payload from the tracking pixel.

    The pixel sends events to POST /api/tracking/event in this shape:
        {
            "event_type": "scroll_depth" | "tab_visibility" | "page_view" |
                          "checkout_step_completed" | "field_focus" |
                          "field_blur" | "search_query" | "exit_intent" |
                          "payment_failed" | "session_start",
            "session_id": "uuid-v4",
            "customer_id": "uuid-v4",
            "merchant_id": "uuid-v4",
            "timestamp": "ISO8601",
            "payload": { ...event-specific fields... }
        }

    Args:
        raw_payload (dict): Raw JSON body from the tracking pixel POST request

    Returns:
        dict: Validated, normalised event with guaranteed required fields.
              Unknown event types are returned with event_type = 'unknown'
              so they can be logged without crashing the pipeline.

    Engineering note:
        Pixel gap — the generic POST /api/tracking/event endpoint is marked
        "TO BUILD" in the engineering spec. This processor must handle
        malformed or partial payloads gracefully (missing fields, null values).
    """
    if not isinstance(raw_payload, dict):
        return {
            "event_type": "unknown",
            "session_id": None,
            "timestamp": None,
            "payload": {},
            "_valid": False
        }

    event_type = raw_payload.get("event_type")
    session_id = raw_payload.get("session_id")
    timestamp = raw_payload.get("timestamp")
    payload = raw_payload.get("payload")

    is_valid = True

    if not event_type or not isinstance(event_type, str):
        event_type = "unknown"
        is_valid = False

    if not session_id or not isinstance(session_id, str):
        session_id = None
        is_valid = False

    if not timestamp or not isinstance(timestamp, str):
        timestamp = None
        is_valid = False
    elif _safe_parse_timestamp(timestamp) is None:
        is_valid = False

    if not isinstance(payload, dict):
        payload = {}

    return {
        "event_type": event_type,
        "session_id": session_id,
        "timestamp": timestamp,
        "payload": payload,
        "_valid": is_valid
    }

    # pass


def filter_events_by_type(events: list, event_type: str) -> list:
    """
    Filters a session's event list to only those matching a given event_type.

    Used by feature functions in pipeline.py to efficiently isolate
    the events they need without re-scanning the full session list.

    Example usage:
        scroll_events = filter_events_by_type(session_events, 'scroll')
        tab_events    = filter_events_by_type(session_events, 'tab_switch')

    Args:
        events     (list): Full list of raw parsed events for a session
        event_type (str) : The event_type string to filter by
                           (e.g. 'scroll_depth', 'tab_visibility', 'page_view')

    Returns:
        list: Subset of events matching the given event_type.
              Returns empty list if no matching events found.
    """
    if not isinstance(events, list):
        return []

    result = []
    for e in events:
        if isinstance(e, dict) and e.get("event_type") == event_type:
            result.append(e)
    return result


def _sort_events_by_timestamp(events: list) -> list:
    """Sorts a list of event dicts by their 'timestamp' field ascending.

    Events with missing or unparseable timestamps are placed last.
    Used internally by extract_session_timeline and group_events_by_session.

    Args:
        events (list): List of event dicts, each expected to have a 'timestamp' key.

    Returns:
        list: New list sorted ascending by timestamp; unparseable entries last.
    """
    def _sort_key(e: dict) -> tuple:
        parsed = _safe_parse_timestamp(e.get("timestamp"))
        return (parsed is None, parsed or datetime.min)

    return sorted(events, key=_sort_key)


def _extract_timeline_fields(sorted_events: list) -> dict:
    """Extracts key timeline fields from a pre-sorted list of session events.

    Pulled out of extract_session_timeline to keep each function under 80 lines.
    Assumes all entries in sorted_events are valid dicts.

    Args:
        sorted_events (list): Events already sorted ascending by timestamp.

    Returns:
        dict: Timeline fields — session_start, session_end, checkout_steps,
              tab_hidden_events, exit_intent_at, payment_failed_at.
    """
    timestamped = [
        e for e in sorted_events
        if _safe_parse_timestamp(e.get("timestamp")) is not None
    ]
    session_start = timestamped[0]["timestamp"] if timestamped else None
    session_end   = timestamped[-1]["timestamp"] if timestamped else None

    checkout_steps = [
        e for e in sorted_events if e.get("event_type") == "checkout_step"
    ]
    tab_hidden_events = [
        e for e in sorted_events
        if e.get("event_type") == "tab_switch"
        and e.get("payload", {}).get("direction") == "blur"
    ]
    exit_intent_events = [
        e for e in sorted_events if e.get("event_type") == "exit_intent"
    ]
    failed_payment_events = [
        e for e in sorted_events if e.get("event_type") == "failed_payment"
    ]
    return {
        "session_start":      session_start,
        "session_end":        session_end,
        "checkout_steps":     checkout_steps,
        "tab_hidden_events":  tab_hidden_events,
        "exit_intent_at":     exit_intent_events[0]["timestamp"] if exit_intent_events else None,
        "payment_failed_at":  failed_payment_events[0]["timestamp"] if failed_payment_events else None,
    }


def extract_session_timeline(events: list) -> dict:
    """
    Reconstructs a chronological timeline of key moments in a shopper's session,
    used by features that depend on event sequencing and time deltas.

    Features that need this:
        - time_on_checkout_step_sec (Feature 3) — needs step start/end timestamps
        - cursor_hesitation_ms_on_price_field (Feature 4) — needs focus/blur pairs
        - abandoned_at_shipping_reveal (Feature 13) — needs step 2→exit sequence
        - failed_payment_attempt (Feature 14) — needs payment_failed event timing

    Args:
        events (list): Full list of parsed events for a session.

    Returns:
        dict: Structured timeline with session_start, session_end,
              checkout_steps, tab_hidden_events, exit_intent_at,
              and payment_failed_at.
    """
    empty_result = {
        "session_start": None,
        "session_end": None,
        "checkout_steps": [],
        "tab_hidden_events": [],
        "exit_intent_at": None,
        "payment_failed_at": None,
    }
    if not isinstance(events, list) or len(events) == 0:
        return empty_result

    valid_events = [e for e in events if isinstance(e, dict)]
    if not valid_events:
        return empty_result

    sorted_events = _sort_events_by_timestamp(valid_events)
    return _extract_timeline_fields(sorted_events)


def detect_platform(merchant_id: str, db) -> str:
    """
    Identifies the eCommerce platform (Shopify / WooCommerce / BigCommerce)
    for a given merchant, used to apply platform-specific parsing rules.

    Platform differences that affect event processing:
        - Checkout step numbering differs between Shopify and WooCommerce
          (platform adapters normalise to standard 1–5 scale)
        - Price field CSS selectors differ per platform:
            Shopify    → .order-summary__total
            WooCommerce → .wc-block-components-totals-item
        - Coupon fields differ:
            Shopify    → discount_codes array
            WooCommerce → coupon_lines array
            BigCommerce → coupons array

    Args:
        merchant_id (str): UUID of the merchant
        db          : Active database session

    Returns:
        str: One of 'shopify' | 'woocommerce' | 'bigcommerce' | 'unknown'

    Engineering note:
        Platform is stored in store_config table. Query:
        SELECT platform FROM store_config WHERE merchant_id = <merchant_id>
        Cache result in Redis to avoid repeated DB lookups per event.
    """
    valid_platforms = {"shopify", "woocommerce"}

    if not merchant_id or db is None:
        return "unknown"

    try:
        cursor = db.cursor()
        cursor.execute(
            "SELECT platform FROM stores WHERE merchant_id = %s",
            (merchant_id,)
        )
        row = cursor.fetchone()

        if not row or not row[0]:
            return "unknown"

        platform = str(row[0]).strip().lower()
        return platform if platform in valid_platforms else "unknown"

    except Exception:
        return "unknown"
    # pass

_SHOPIFY_STEP_MAP = {
    "product": 0,
    "cart": 1,
    "shipping": 2,
    "payment": 3,
    "review": 4,
    "thank_you": 5,
}

_WOOCOMMERCE_STEP_MAP = {
    "product_view": 0,
    "cart": 1,
    "checkout_shipping": 2,
    "checkout_payment": 3,
    "order_review": 4,
    "order_received": 5,
}


def normalize_checkout_step(platform: str, platform_step: Any) -> int:
    """
    Converts a platform-native checkout step identifier into the
    normalised step number (0–5) used across all Revluma models.

    Normalised step scale:
        0 = Never reached checkout
        1 = Cart Review
        2 = Shipping Information
        3 = Shipping Method / Cost Reveal  ← convenience sensitivity trigger
        4 = Payment Information
        5 = Order Review / Confirmation

    Shopify uses string identifiers ('contact_information', 'shipping', etc.)
    WooCommerce uses numeric steps that differ from this scale.
    BigCommerce has its own checkout flow.

    Args:
        platform      (str): 'shopify' | 'woocommerce' | 'bigcommerce'
        platform_step (Any): The raw step identifier from the platform event

    Returns:
        int: Normalised step number 0–5.
             Returns 0 if the mapping is unknown or step is None.

    Engineering note:
        Full mapping tables to be defined in Week 4 once platform adapter
        code is reviewed. The adapters should emit a normalised step number
        directly — this function is a safety fallback for any cases where
        the raw platform value leaks through.
    """
    if isinstance(platform_step, int) and 0 <= platform_step <= 5:
        return platform_step

    if not isinstance(platform_step, str) or not platform:
        return 0

    step_key = platform_step.strip().lower()
    platform_key = platform.strip().lower()

    if platform_key == "shopify":
        return _SHOPIFY_STEP_MAP.get(step_key, 0)
    elif platform_key == "woocommerce":
        return _WOOCOMMERCE_STEP_MAP.get(step_key, 0)
    return 0
    # pass


def group_events_by_session(events: list) -> dict:
    """
    Groups a list of mixed events into per-session buckets.

    Used by the batch Feature Engineering job (runs every 5 minutes for
    active sessions, hourly for all profiles) to process multiple sessions
    in a single job run efficiently.

    Args:
        events (list): Flat list of raw events from customer_events table,
                       potentially spanning multiple sessions and customers.

    Returns:
        dict: {
            "session_id_1": [event, event, ...],
            "session_id_2": [event, event, ...],
            ...
        }
        Events within each session are sorted by timestamp ascending.

    Engineering note:
        Feature freshness requirements (FEATURE_VECTOR_SPEC Section 4.3):
            Behavioural  → Real-time, recomputed on every pixel event
            Transactional → Every 5 min (active) / hourly (all profiles)
            Temporal     → Captured once at session start, static for session
    """
    if not isinstance(events, list) or len(events) == 0:
        return {}

    grouped: dict = {}

    for e in events:
        if not isinstance(e, dict):
            continue
        session_id = e.get("session_id") or "__no_session__"
        grouped.setdefault(session_id, []).append(e)

    for session_id in grouped:
        grouped[session_id] = _sort_events_by_timestamp(grouped[session_id])

    return grouped
