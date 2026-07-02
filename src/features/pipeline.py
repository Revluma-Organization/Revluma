"""
Revluma Feature Engineering Pipeline
=======================================
Source: FEATURE_VECTOR_SPEC v1.0.0 — Okanlawon David (AI/ML Engineer 1)

Combines two function groups:
    1. Event-based behavioural/temporal features (skeletons — Week 4 logic)
    2. Database-backed transactional features (IMPLEMENTED — Task 2)

NON-NEGOTIABLE RULES FOR DB-BACKED FUNCTIONS:
    - MUST use parameterized queries (%s) — never string interpolation
    - MUST use cursor
    - MUST NOT raise exceptions for empty results or DB failures
    - MUST return safe defaults on ANY failure (no rows, NULL, missing
      customer, query failure, DB connection error)
"""

from __future__ import annotations
from datetime import datetime, date


# ---------------------------------------------------------------------------
# 2.1 calculate_past_orders_total
# ---------------------------------------------------------------------------

def calculate_past_orders_total(customer_id: str, db) -> int:
    """
    Total count of orders for this customer.

    Query: SELECT orders_count FROM customers WHERE id = %s

    Args:
        customer_id: UUID of the customer
        db: Active database connection

    Returns:
        int: orders_count if row exists, else 0. Never raises.
    """
    if not customer_id or db is None:
        return 0

    try:
        cursor = db.cursor()
        cursor.execute(
            "SELECT orders_count FROM customers WHERE id = %s",
            (customer_id,)
        )
        row = cursor.fetchone()
        if row and row[0] is not None:
            return int(row[0])
        return 0
    except Exception:
        return 0


# ---------------------------------------------------------------------------
# 2.2 calculate_avg_order_value
# ---------------------------------------------------------------------------

def calculate_avg_order_value(customer_id: str, db) -> float:
    """
    Average order value across all orders for this customer.

    Query: SELECT AVG(total) FROM orders WHERE customer_id = %s

    Args:
        customer_id: UUID of the customer
        db: Active database connection

    Returns:
        float: average order value if row exists, else 0.0. Never raises.
    """
    if not customer_id or db is None:
        return 0.0

    try:
        cursor = db.cursor()
        cursor.execute(
            "SELECT AVG(total) FROM orders WHERE customer_id = %s",
            (customer_id,)
        )
        row = cursor.fetchone()
        if row and row[0] is not None:
            return float(row[0])
        return 0.0
    except Exception:
        return 0.0


# ---------------------------------------------------------------------------
# 2.3 calculate_days_since_last_purchase
# ---------------------------------------------------------------------------

def calculate_days_since_last_purchase(customer_id: str, db) -> int:
    """
    Days between today and the customer's most recent order.

    Query: SELECT MAX(ordered_at) FROM orders WHERE customer_id = %s

    Sentinel: -1 means no purchase history. Models must treat this as a
    distinct feature class, not a numeric zero.

    Args:
        customer_id: UUID of the customer
        db: Active database connection

    Returns:
        int: days since last purchase if orders exist, else -1. Never raises.
    """
    if not customer_id or db is None:
        return -1

    try:
        cursor = db.cursor()
        cursor.execute(
            "SELECT MAX(ordered_at) FROM orders WHERE customer_id = %s",
            (customer_id,)
        )
        row = cursor.fetchone()

        if not row or row[0] is None:
            return -1

        last_order = row[0]

        # Normalize to a date object whether we got datetime or date
        if isinstance(last_order, datetime):
            last_order_date = last_order.date()
        elif isinstance(last_order, date):
            last_order_date = last_order
        else:
            return -1

        delta = date.today() - last_order_date
        return max(delta.days, 0)

    except Exception:
        return -1


# ---------------------------------------------------------------------------
# 2.4 calculate_purchase_frequency_trend
# ---------------------------------------------------------------------------

def calculate_purchase_frequency_trend(customer_id: str, db) -> int:
    """
    Compares order frequency in the last 30 days vs the prior 30 days.

    Single query using FILTER clauses:
        current_30d  = orders in the last 30 days
        previous_30d = orders in the 30 days before that

    Args:
        customer_id: UUID of the customer
        db: Active database connection

    Returns:
        int: -1 (decreasing), 0 (stable), or +1 (increasing).
             Defaults to 0 on any failure or insufficient data.
    """
    if not customer_id or db is None:
        return 0

    try:
        cursor = db.cursor()
        cursor.execute(
            """
            SELECT
              COUNT(*) FILTER (WHERE ordered_at >= NOW() - INTERVAL '30 days') AS current_30d,
              COUNT(*) FILTER (
                WHERE ordered_at < NOW() - INTERVAL '30 days'
                  AND ordered_at >= NOW() - INTERVAL '60 days'
              ) AS previous_30d
            FROM orders
            WHERE customer_id = %s
            """,
            (customer_id,)
        )
        row = cursor.fetchone()

        if not row:
            return 0

        current_30d = row[0] if row[0] is not None else 0
        previous_30d = row[1] if row[1] is not None else 0

        if current_30d > previous_30d:
            return 1
        elif current_30d < previous_30d:
            return -1
        return 0

    except Exception:
        return 0


# ---------------------------------------------------------------------------
# 2.5 calculate_coupon_usage_pct
# ---------------------------------------------------------------------------

def calculate_coupon_usage_pct(customer_id: str, db) -> float:
    """
    Percentage of this customer's orders that used a coupon, as a decimal.

    Query:
        SELECT
          COUNT(*) FILTER (WHERE coupon_used = true)::float /
          NULLIF(COUNT(*), 0)
        FROM orders
        WHERE customer_id = %s

    Args:
        customer_id: UUID of the customer
        db: Active database connection

    Returns:
        float: 0.0 to 1.0. Defaults to 0.0 on no data or failure.
    """
    if not customer_id or db is None:
        return 0.0

    try:
        cursor = db.cursor()
        cursor.execute(
            """
            SELECT
              COUNT(*) FILTER (WHERE coupon_used = true)::float /
              NULLIF(COUNT(*), 0)
            FROM orders
            WHERE customer_id = %s
            """,
            (customer_id,)
        )
        row = cursor.fetchone()
        if row and row[0] is not None:
            return float(row[0])
        return 0.0
    except Exception:
        return 0.0


# ---------------------------------------------------------------------------
# 2.6 calculate_rfm_scores
# ---------------------------------------------------------------------------

def _score_recency(days_since_last_purchase: int) -> int:
    """
    Recency scoring (1-5, higher = more recent = better).
    Sentinel -1 (no history) maps to lowest score 1.
    """
    if days_since_last_purchase < 0:
        return 1
    if days_since_last_purchase <= 7:
        return 5
    if days_since_last_purchase <= 30:
        return 4
    if days_since_last_purchase <= 90:
        return 3
    if days_since_last_purchase <= 180:
        return 2
    return 1


def _score_frequency(past_orders_total: int) -> int:
    """Frequency scoring (1-5, higher = more orders = better)."""
    if past_orders_total >= 20:
        return 5
    if past_orders_total >= 10:
        return 4
    if past_orders_total >= 5:
        return 3
    if past_orders_total >= 2:
        return 2
    return 1


def _score_monetary(avg_order_value: float) -> int:
    """Monetary scoring (1-5, higher = higher spend = better)."""
    if avg_order_value >= 200:
        return 5
    if avg_order_value >= 100:
        return 4
    if avg_order_value >= 50:
        return 3
    if avg_order_value >= 20:
        return 2
    return 1


def calculate_rfm_scores(customer_id: str, db) -> dict:
    """
    Computes Recency, Frequency, and Monetary scores for a customer by
    internally calling calculate_days_since_last_purchase,
    calculate_past_orders_total, and calculate_avg_order_value.

    Never raises — every internal call already defaults safely, so this
    function inherits that safety automatically.

    Args:
        customer_id: UUID of the customer
        db: Active database connection

    Returns:
        dict: {
            "rfm_recency_score": int,      # 1-5
            "rfm_frequency_score": int,    # 1-5
            "rfm_monetary_score": int,     # 1-5
            "days_since_last_purchase": int,  # -1 if no history
            "past_orders_total": int,
            "avg_order_value": float
        }
    """
    days_since_last_purchase = calculate_days_since_last_purchase(customer_id, db)
    past_orders_total = calculate_past_orders_total(customer_id, db)
    avg_order_value = calculate_avg_order_value(customer_id, db)

    return {
        "rfm_recency_score": _score_recency(days_since_last_purchase),
        "rfm_frequency_score": _score_frequency(past_orders_total),
        "rfm_monetary_score": _score_monetary(avg_order_value),
        "days_since_last_purchase": days_since_last_purchase,
        "past_orders_total": past_orders_total,
        "avg_order_value": avg_order_value
    }


# ===========================================================================
# EVENT-BASED BEHAVIOURAL / TRANSACTIONAL / TEMPORAL FEATURES
# Skeletons only — logic not yet implemented. Pending Week 4 assignment.
# ===========================================================================

def calculate_scroll_depth(events: list) -> float:
    """
    Feature: scroll_depth_checkout_pct

    Calculates the maximum scroll percentage reached on any checkout page
    during the session. Uses IntersectionObserver ratios from the pixel.
    Formula: max(depth_pct values) from scroll_depth events on checkout pages.

    Models: M1 (Abandonment), M2 (Price/Convenience Classifier)
    Source: customer_events — event_type='scroll_depth', page_type='checkout'

    Returns:
        float: 0.0–100.0. Default 0.0 if no scroll data captured.
    """
    pass


def calculate_tab_switch_count(events: list) -> int:
    """
    Feature: tab_switch_count_session

    Counts how many times the shopper switched away from the merchant tab
    during the session. Each visibilitychange to 'hidden' = +1.
    Formula: COUNT(tab_visibility events WHERE state='hidden').

    Models: M1 (Abandonment), M2 (Price/Convenience Classifier)
    Source: customer_events — event_type='tab_visibility', state='hidden'

    Returns:
        int: 0–50 (capped at 50). Default 0. Values 4+ signal price comparison.
    """
    pass


def calculate_time_on_checkout_step(events: list) -> float:
    """
    Feature: time_on_checkout_step_sec

    Time in seconds spent on the last checkout step before abandonment.
    Formula: timestamp(step_completed) - timestamp(step_started) for last step.

    Models: M1 (Abandonment Probability Predictor)
    Source: customer_events — event_type='checkout_step_completed' timestamps

    Returns:
        float: 0.0–3600.0 seconds. Returns -1.0 if no checkout step was reached
               (-1.0 is a sentinel value — models treat it as a separate category).
    """
    pass


def calculate_cursor_hesitation(events: list) -> int:
    """
    Feature: cursor_hesitation_ms_on_price_field

    Duration in milliseconds between focus and blur on any price-related field
    during the session. Uses the maximum hesitation across all price field interactions.
    Formula: max(blur_timestamp - focus_timestamp) WHERE field_name IN price fields.

    Models: M2 (Price/Convenience Classifier), M5 (Offer Value Optimizer)
    Source: customer_events — event_type='field_focus' and 'field_blur'

    Returns:
        int: 0–30000ms (capped at 30000). Default 0 if no price field interaction.
    """
    pass


def calculate_checkout_step_reached(events: list) -> int:
    """
    Feature: checkout_step_abandoned

    The highest normalised checkout step number reached before abandonment.
    Step scale (normalised across Shopify, WooCommerce, BigCommerce):
        0 = Never reached checkout
        1 = Cart Review
        2 = Shipping Information
        3 = Shipping Cost Reveal  ← strong convenience sensitivity signal
        4 = Payment Information
        5 = Order Review/Confirmation

    Formula: MAX(step_number) from checkout_step_completed events WHERE status=ABANDONED.

    Models: M1 (Abandonment), M2 (Price/Convenience Classifier)
    Source: customer_events + checkout table (S5) + platform webhooks (S3)

    Returns:
        int: 0–5. Default 0.
    """
    pass


def calculate_visited_coupon_page(events: list) -> bool:
    """
    Feature: visited_coupon_page

    Boolean flag — did the shopper visit any discount/sale/promo page this session?
    Formula: EXISTS page_view events WHERE url contains /discount, /sale, /promo,
             /coupon, /deal, or /offer (case-insensitive).

    Models: M2 (Price/Convenience Classifier), M5 (Offer Value Optimizer)
    Source: customer_events — event_type='page_view', url field

    Returns:
        bool: True = shopper actively sought discount pages (strong PSS signal).
              False = no discount page visits. Default False.
    """
    pass


def calculate_searched_discount_terms(events: list) -> bool:
    """
    Feature: searched_discount_terms

    Boolean flag — did the shopper search for discount-related terms on-site?
    Formula: EXISTS search_query events WHERE query contains 'discount', 'promo',
             'code', 'coupon', 'sale', 'deal', 'free shipping', or '% off'.

    Models: M2 (Price/Convenience Classifier), M5 (Offer Value Optimizer)
    Source: customer_events — event_type='search_query', query field

    Returns:
        bool: True = shopper explicitly searched for discounts (strongest PSS signal).
              False = no discount searches detected. Default False.
    """
    pass


def calculate_abandoned_at_shipping_reveal(events: list) -> bool:
    """
    Feature: abandoned_at_shipping_reveal

    Boolean flag — did the shopper abandon specifically after seeing shipping costs?
    Formula: checkout_step_abandoned IN (2,3) AND exit_intent event fired AFTER
             step 2 completed AND step 3 was never completed.

    Models: M2 (Price/Convenience Classifier) — primary CSS signal
    Source: customer_events (exit_intent + step events) + checkout table (S5)

    Returns:
        bool: True = abandoned at shipping cost reveal (strong convenience sensitivity).
              False = abandonment occurred at a different stage. Default False.
    """
    pass


def calculate_failed_payment_attempt(events: list) -> bool:
    """
    Feature: failed_payment_attempt

    Boolean flag — did the shopper attempt a payment that was declined?
    Detected via platform webhooks (Shopify checkouts/update with gateway error,
    WooCommerce order.failed) or pixel payment_failed events.

    Models: M1 (Abandonment Probability Predictor)
    Source: platform webhooks (S3) + customer_events payment_failed event type

    Returns:
        bool: True = payment was attempted but failed (shopper had full intent,
              blocked by friction — recovery should offer alternative payment, not discount).
              False = no failed payment detected. Default False.
    """
    pass


def calculate_local_hour_of_session(events: list) -> int:
    """
    Feature: local_hour_of_session

    Hour of the day (0–23) in the shopper's LOCAL timezone when the session started.
    Formula: EXTRACT(HOUR FROM session_start_time AT TIME ZONE shopper_timezone).
    Timezone captured from pixel via Intl.DateTimeFormat().resolvedOptions().timeZone.

    Models: M3 (Optimal Send-Time Predictor)
    Source: customer_events — event_type='session_start', timezone field

    Returns:
        int: 0–23. Default 12 (noon) when timezone detection fails.
    """
    pass


def calculate_day_of_week_session(events: list) -> int:
    """
    Feature: day_of_week_session

    Day of the week (0–6) in the shopper's LOCAL timezone when the session started.
    Formula: EXTRACT(DOW FROM session_start_time AT TIME ZONE shopper_timezone).
    Encoding: 0=Monday, 1=Tuesday, ..., 6=Sunday (ISO 8601).
    Note: JavaScript Date.getDay() returns Sunday=0 — pixel must convert before sending.

    Models: M3 (Optimal Send-Time Predictor)
    Source: customer_events — same session_start event as local_hour_of_session

    Returns:
        int: 0–6 (0=Monday). Default 0 when timezone detection fails.
    """
    pass


def calculate_pss_score(feature_dict: dict) -> int:
    """
    Feature: pss_score (Price Sensitivity Score)

    Composite score representing how price-sensitive this shopper is.
    Weighted combination of PSS signals (weights owned by AI/ML Engineer 3):
        HIGH   — cursor_hesitation_ms_on_price_field
        HIGH   — past_orders_with_coupon_pct
        MEDIUM — visited_coupon_page
        MEDIUM — searched_discount_terms
        LOW    — tab_switch_count_session

    Models: M2 output, M5 input. Stored in abandoned_carts.pss_score.

    Args:
        feature_dict: Flat dict of all pre-computed feature values from Redis

    Returns:
        int: 0–100. Threshold for price-sensitive action: 60+.
    """
    pass


def calculate_css_score(feature_dict: dict) -> int:
    """
    Feature: css_score (Convenience Sensitivity Score)

    Composite score representing how much friction drove the abandonment.
    Weighted combination of CSS signals (weights owned by AI/ML Engineer 3):
        VERY HIGH — abandoned_at_shipping_reveal
        HIGH      — checkout_step_abandoned
        MEDIUM    — scroll_depth_checkout_pct

    Models: M2 output, M5 input. Stored in abandoned_carts.css_score.

    Args:
        feature_dict: Flat dict of all pre-computed feature values from Redis

    Returns:
        int: 0–100. Threshold for convenience-sensitive action: 60+.
    """
    pass


def compute_feature_vector(customer_id: str, session_events: list, db) -> dict:
    """
    Assembles the complete 16-feature Shopper Feature Vector for a session.
    Calls all individual feature functions above and returns the unified dict
    passed to any model at inference time.

    Models: All five (M1–M5)
    Source: All 8 data sources (S1–S8)

    Args:
        customer_id   : UUID of the customer
        session_events: Raw pixel event list for the current session
        db            : Active database session

    Returns:
        dict: {
            "session_id"  : str,
            "customer_id" : str,
            "merchant_id" : str,
            "timestamp"   : str,  # ISO8601
            "features": {
                "scroll_depth_checkout_pct"          : float,  # 0.0–100.0
                "tab_switch_count_session"            : int,    # 0–50
                "time_on_checkout_step_sec"           : float,  # 0.0–3600.0, -1.0 sentinel
                "cursor_hesitation_ms_on_price_field" : int,   # 0–30000
                "checkout_step_abandoned"             : int,    # 0–5
                "past_orders_total"                   : int,    # 0–1000+
                "past_orders_with_coupon_pct"         : float,  # 0.0–100.0
                "days_since_last_purchase"            : int,    # -1 or 0–730+
                "avg_order_value"                     : float,  # 0.0–10000.0+
                "purchase_frequency_trend"            : int,    # -1, 0, or +1
                "visited_coupon_page"                 : bool,
                "searched_discount_terms"             : bool,
                "abandoned_at_shipping_reveal"        : bool,
                "failed_payment_attempt"              : bool,
                "local_hour_of_session"               : int,   # 0–23, default 12
                "day_of_week_session"                 : int    # 0=Mon–6=Sun, default 0
            }
        }

    Missing value defaults:
        Behavioural  → 0 or False
        Transactional → 0 or -1 sentinel for new customers
        Temporal     → 12 (hour), 0 (day of week)
    """
    pass