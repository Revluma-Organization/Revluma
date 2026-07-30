"""
Revluma Feature Engineering Pipeline
Source: FEATURE_VECTOR_SPEC v1.0.0 — Okanlawon David (AI/ML Engineer 1)

Computes the 30-feature Shopper Feature Vector fed into all five ML models.
All 30 features fully implemented.
"""

from __future__ import annotations


# ---------------------------------------------------------------------------
# BEHAVIOURAL FEATURES — from tracking pixel events (real-time, per session)
# ---------------------------------------------------------------------------
from datetime import datetime

def _parse_timestamp(ts: str) -> datetime | None:
    if not ts or not isinstance(ts, str):
        return None
    try:
        if ts.endswith('Z'):
            ts = ts[:-1] + '+00:00'
        return datetime.fromisoformat(ts)
    except (ValueError, TypeError):
        return None

def calculate_scroll_depth(events: list) -> float:
    """
    Feature: scroll_depth_pct

    Calculates the maximum scroll percentage reached on any checkout page
    during the session. Uses IntersectionObserver ratios from the pixel.
    Formula: max(depth_pct values) from scroll_depth events on checkout pages.

    Models: M1 (Abandonment), M2 (Price/Convenience Classifier)
    Source: customer_events — event_type='scroll', page_type='checkout'

    Returns:
        float: 0.0–100.0. Default 0.0 if no scroll data captured.
    """
    if not isinstance(events, list):
        return 0.0

    max_depth = 0.0
    for event in events:
        if not isinstance(event, dict):
            continue
        if event.get("event_type") != "scroll":
            continue
        
        payload = event.get("payload")
        if not isinstance(payload, dict):
            continue
            
        depth = payload.get("depth_pct")
        if isinstance(depth, (int, float)):
            if depth > max_depth:
                max_depth = float(depth)
                
    return max_depth


def calculate_tab_switch_count(events: list) -> int:
    """
    Feature: tab_switch_count

    Counts how many times the shopper switched away from the merchant tab
    during the session. Each visibilitychange to 'hidden' = +1.
    Formula: COUNT(tab_visibility events WHERE state='hidden').

    Models: M1 (Abandonment), M2 (Price/Convenience Classifier)
    Source: customer_events — event_type='tab_switch', state='hidden'

    Returns:
        int: 0–50 (capped at 50). Default 0. Values 4+ signal price comparison.
    """
    if not isinstance(events, list):
        return 0

    count = 0
    for event in events:
        if not isinstance(event, dict):
            continue
        if event.get("event_type") != "tab_switch":
            continue
            
        payload = event.get("payload")
        if not isinstance(payload, dict):
            continue
            
        if payload.get("direction") == "blur":
            count += 1
            
    return count


def calculate_time_on_checkout_step(events: list) -> float:
    """
    Feature: time_on_checkout_step_sec

    Time in seconds spent on the last checkout step before abandonment.
    Formula: timestamp(step_completed) - timestamp(step_started) for last step.

    Models: M1 (Abandonment Probability Predictor)
    Source: customer_events — event_type='checkout_step' timestamps

    Returns:
        float: 0.0–3600.0 seconds. Returns -1.0 if no checkout step was reached
               (-1.0 is a sentinel value — models treat it as a separate category).
    """
    if not isinstance(events, list):
        return -1.0

    checkout_events = []
    for event in events:
        if not isinstance(event, dict):
            continue
        if event.get("event_type") != "checkout_step":
            continue
        ts = _parse_timestamp(event.get("timestamp"))
        if ts is not None:
            checkout_events.append(ts)

    if len(checkout_events) < 2:
        return -1.0

    checkout_events.sort()
    duration = (checkout_events[-1] - checkout_events[0]).total_seconds()
    return min(float(duration), 3600.0)
def calculate_cursor_hesitation(events: list) -> int:
    """
    Feature: cursor_hesitation

    Duration in milliseconds between focus and blur on any price-related field
    during the session. Uses the maximum hesitation across all price field interactions.
    Formula: max(blur_timestamp - focus_timestamp) WHERE field_name IN price fields.

    Models: M2 (Price/Convenience Classifier), M5 (Offer Value Optimizer)
    Source: customer_events — event_type='field_focus' and 'field_blur'

    Returns:
        int: 0–30000ms (capped at 30000). Default 0 if no price field interaction.
    """
    if not isinstance(events, list):
        return 0

    count = 0
    for event in events:
        if not isinstance(event, dict):
            continue
        if event.get("event_type") == "exit_intent":
            count += 1
            
    return count


def calculate_checkout_step_reached(events: list) -> int:
    """
    Feature: checkout_step_reached

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
    if not isinstance(events, list):
        return 0

    max_step = 0
    for event in events:
        if not isinstance(event, dict):
            continue
        if event.get("event_type") != "checkout_step":
            continue
            
        payload = event.get("payload")
        if not isinstance(payload, dict):
            continue
            
        step = payload.get("step")
        if isinstance(step, (int, float)):
            if step > max_step:
                max_step = int(step)
                
    return max_step


# ---------------------------------------------------------------------------
# TRANSACTIONAL FEATURES — from Order table + platform webhooks (historical)
# ---------------------------------------------------------------------------

def calculate_past_orders_total(customer_id: str, db) -> int:
    """
    Feature: past_orders_total



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
        with db.cursor() as cursor:
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


def calculate_coupon_usage_pct(customer_id: str, db) -> float:
    """
    Feature: past_orders_with_coupon_pct

    Percentage of the customer's completed orders that used a coupon or discount.
    Formula: COUNT(orders WHERE coupon_used=True) / COUNT(all orders).
    Uses NULLIF to avoid division by zero when customer has no orders.

    Models: M2 (Price/Convenience Classifier), M5 (Offer Value Optimizer)
    Source: Order table — fields: coupon_used (bool)

    Args:
        customer_id: UUID of the customer
        db: Active database connection

    Returns:
        float: 0.0–1.0 ratio. Default 0.0. High values = strong price sensitivity signal.
    """
    if not customer_id or db is None:
        return 0.0

    try:
        with db.cursor() as cursor:
            cursor.execute(
                """
                SELECT CAST(SUM(CASE WHEN coupon_used THEN 1 ELSE 0 END) AS FLOAT)
                       / NULLIF(COUNT(*), 0)
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
def calculate_days_since_last_purchase(customer_id: str, db) -> int:
    """
    Feature: days_since_last_purchase

    Number of days between today and the customer's most recent completed order.
    Formula: DATEDIFF(NOW(), MAX(ordered_at)).

    Models: M4 (Churn Risk Scorer), M5 (Offer Value Optimizer)
    Source: Order table — ordered_at / created_at field

    Args:
        customer_id: UUID of the customer
        db: Active database connection

    Returns:
        int: 0–730+. Returns -1 as sentinel if customer has no purchase history.
             Values above 180 days indicate at-risk or hibernating customers.
    """
    if not customer_id or db is None:
        return -1

    try:
        from datetime import datetime, timezone
        with db.cursor() as cursor:
            cursor.execute(
                "SELECT MAX(ordered_at) FROM orders WHERE customer_id = %s",
                (customer_id,)
            )
            row = cursor.fetchone()
        if not row or row[0] is None:
            return -1

        last_order = row[0]
        if isinstance(last_order, str):
            try:
                last_order = datetime.fromisoformat(last_order.replace('Z', '+00:00'))
            except Exception:
                try:
                    last_order = datetime.strptime(last_order, "%Y-%m-%d %H:%M:%S")
                except Exception:
                    pass
        # Handle both naive and timezone-aware datetimes
        if not isinstance(last_order, datetime):
            return -1

        now = datetime.now(timezone.utc)
        if last_order.tzinfo is None:
            last_order = last_order.replace(tzinfo=timezone.utc)

        delta = now - last_order
        return int(delta.days)
    except Exception:
        return -1
def calculate_avg_order_value(customer_id: str, db) -> float:
    """
    Feature: avg_order_value



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
        with db.cursor() as cursor:
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

def calculate_purchase_frequency_trend(customer_id: str, db) -> int:
    """
    Feature: purchase_frequency_trend

    Compares order frequency in the current 30-day window vs the previous 30 days.
    Formula:
        current_30d  = COUNT orders WHERE ordered_at >= NOW() - 30 days
        previous_30d = COUNT orders WHERE ordered_at BETWEEN NOW()-60d AND NOW()-30d
        if current > previous → +1 (increasing)
        if current = previous →  0 (stable)
        if current < previous → -1 (decreasing)

    Models: M4 (Churn Risk Scorer)
    Source: Order table aggregated by ordered_at over rolling 30-day windows

    Args:
        customer_id: UUID of the customer
        db: Active database connection

    Returns:
        int: -1 (decreasing), 0 (stable), or +1 (increasing).
             Default 0 for customers with less than 60 days of history.
    """
    if not customer_id or db is None:
        return 0

    try:
        with db.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    COUNT(CASE WHEN ordered_at >= NOW() - INTERVAL '30 days' THEN 1 END),
                    COUNT(CASE WHEN ordered_at >= NOW() - INTERVAL '60 days'
                               AND ordered_at  < NOW() - INTERVAL '30 days' THEN 1 END)
                FROM orders
                WHERE customer_id = %s
                """,
                (customer_id,)
            )
            row = cursor.fetchone()
        if not row:
            return 0

        current = int(row[0]) if row[0] is not None else 0
        previous = int(row[1]) if row[1] is not None else 0

        if current > previous:
            return 1
        elif current < previous:
            return -1
        else:
            return 0
    except Exception:
        return 0
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
    if not isinstance(events, list):
        return False

    DISCOUNT_TERMS = ("discount", "sale", "promo", "coupon", "deal", "offer")

    for event in events:
        if not isinstance(event, dict):
            continue
        if event.get("event_type") != "page_view":
            continue
        payload = event.get("payload")
        if not isinstance(payload, dict):
            continue
        url = payload.get("url", "")
        if not isinstance(url, str):
            continue
        url_lower = url.lower()
        if any(term in url_lower for term in DISCOUNT_TERMS):
            return True

    return False
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
    if not isinstance(events, list):
        return False

    DISCOUNT_TERMS = ("discount", "promo", "code", "coupon", "sale", "deal",
                      "free shipping", "% off", "percent off")

    for event in events:
        if not isinstance(event, dict):
            continue
        if event.get("event_type") != "search_query":
            continue
        payload = event.get("payload")
        if not isinstance(payload, dict):
            continue
        query = payload.get("query", "")
        if not isinstance(query, str):
            continue
        query_lower = query.lower()
        if any(term in query_lower for term in DISCOUNT_TERMS):
            return True

    return False
def calculate_abandoned_at_shipping_reveal(events: list) -> bool:
    """
    Feature: abandoned_at_shipping_reveal

    Boolean flag — did the shopper abandon specifically after seeing shipping costs?
    Formula: checkout_step_reached IN (2,3) AND exit_intent event fired AFTER
             step 2 completed AND step 3 was never completed.

    Models: M2 (Price/Convenience Classifier) — primary CSS signal
    Source: customer_events (exit_intent + step events) + checkout table

    Returns:
        bool: True = abandoned at shipping cost reveal (strong convenience sensitivity).
              False = abandonment occurred at a different stage. Default False.
    """
    if not isinstance(events, list):
        return False

    max_step = 0
    has_exit_intent = False

    for event in events:
        if not isinstance(event, dict):
            continue

        event_type = event.get("event_type")

        if event_type == "checkout_step":
            payload = event.get("payload")
            if isinstance(payload, dict):
                step = payload.get("step")
                if isinstance(step, (int, float)):
                    max_step = max(max_step, int(step))

        elif event_type == "exit_intent":
            has_exit_intent = True

    # Abandoned at shipping reveal = reached step 2 or 3 but not further,
    # and an exit intent was detected
    return has_exit_intent and max_step in (2, 3)
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
    if not isinstance(events, list):
        return False

    for event in events:
        if not isinstance(event, dict):
            continue
        if event.get("event_type") == "failed_payment":
            return True
            
    return False


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
    if not isinstance(events, list):
        return 12

    earliest_time = None
    for event in events:
        if not isinstance(event, dict):
            continue
        ts = _parse_timestamp(event.get("timestamp"))
        if ts is not None:
            if earliest_time is None or ts < earliest_time:
                earliest_time = ts
                
    if earliest_time is not None:
        return earliest_time.hour
    return 12


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
    if not isinstance(events, list):
        return 0

    earliest_time = None
    for event in events:
        if not isinstance(event, dict):
            continue
        ts = _parse_timestamp(event.get("timestamp"))
        if ts is not None:
            if earliest_time is None or ts < earliest_time:
                earliest_time = ts
                
    if earliest_time is not None:
        return earliest_time.weekday()
    return 0


def calculate_time_on_page_ms(events: list) -> int:
    """
    Feature: time_on_page_ms

    Total time spent by the shopper on the page.
    Formula: max_timestamp - min_timestamp across all events.

    Models: M1 (Abandonment Probability Predictor), M2 (Price/Convenience Classifier)
    Source: customer_events

    Returns:
        int: Total milliseconds spent. Default 0.
    """
    if not isinstance(events, list):
        return 0

    min_time = None
    max_time = None
    
    for event in events:
        if not isinstance(event, dict):
            continue
        ts = _parse_timestamp(event.get("timestamp"))
        if ts is not None:
            if min_time is None or ts < min_time:
                min_time = ts
            if max_time is None or ts > max_time:
                max_time = ts
                
    if min_time is not None and max_time is not None and min_time != max_time:
        diff = max_time - min_time
        return int(diff.total_seconds() * 1000)
        
    return 0


# ---------------------------------------------------------------------------
# EXTENDED M2 SENSITIVITY SIGNALS — introduced in v1.1.0
# ---------------------------------------------------------------------------

def calculate_google_shopping_referrer(events: list) -> bool:
    """
    Feature: google_shopping_referrer

    Boolean flag indicating whether the session originated from Google Shopping.
    Detected via the referrer URL on the first page_view event of the session.

    Models: M2 (Price/Convenience Classifier)
    Source: customer_events — event_type='page_view', payload.referrer field

    Returns:
        bool: True = session came from Google Shopping. Default False.
    """
    if not isinstance(events, list):
        return False

    GOOGLE_SHOPPING_SIGNALS = ("google.com/shopping", "google.com/aclk",
                                "shopping.google", "googleadservices.com")

    for event in events:
        if not isinstance(event, dict):
            continue
        if event.get("event_type") != "page_view":
            continue
        payload = event.get("payload")
        if not isinstance(payload, dict):
            continue
        referrer = payload.get("referrer", "")
        if not isinstance(referrer, str):
            continue
        referrer_lower = referrer.lower()
        if any(signal in referrer_lower for signal in GOOGLE_SHOPPING_SIGNALS):
            return True

    return False
def calculate_time_first_view_to_cart_add_hrs(events: list) -> float:
    """
    Feature: time_first_view_to_cart_add_hrs

    Hours elapsed between the first product page_view and the first add_to_cart event.
    A longer deliberation window signals higher price sensitivity.

    Models: M2 (Price/Convenience Classifier)
    Source: customer_events — event_type='page_view' and 'add_to_cart'

    Returns:
        float: Hours elapsed. 0.0 if add_to_cart happened before or simultaneously
               with first view. -1.0 sentinel if no cart add event found.
    """
    if not isinstance(events, list):
        return -1.0

    first_view_ts = None
    first_cart_ts = None

    for event in events:
        if not isinstance(event, dict):
            continue

        event_type = event.get("event_type")
        ts = _parse_timestamp(event.get("timestamp"))
        if ts is None:
            continue

        if event_type == "page_view":
            if first_view_ts is None or ts < first_view_ts:
                first_view_ts = ts

        elif event_type == "add_to_cart":
            if first_cart_ts is None or ts < first_cart_ts:
                first_cart_ts = ts

    if first_cart_ts is None:
        return -1.0

    if first_view_ts is None:
        return 0.0

    delta = first_cart_ts - first_view_ts
    hours = delta.total_seconds() / 3600.0
    return max(0.0, hours)
def calculate_sale_period_purchase_only(customer_id: str, db) -> bool:
    """
    Feature: sale_period_purchase_only

    Boolean flag indicating 80%+ of the customer's historical orders were placed
    during known sale periods (Black Friday, Cyber Monday, seasonal sales).
    Signals a price-gated buyer who waits for deals.

    Models: M2 (Price/Convenience Classifier)
    Source: Order table — ordered_at field cross-referenced with sale windows

    Args:
        customer_id: UUID of the customer
        db: Active database connection

    Returns:
        bool: True = shopper predominantly buys during sale periods. Default False.
    """
    if not customer_id or db is None:
        return False

    try:
        with db.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    COUNT(*) AS total_orders,
                    COUNT(CASE WHEN is_sale_period THEN 1 END) AS sale_orders
                FROM orders
                WHERE customer_id = %s
                """,
                (customer_id,)
            )
            row = cursor.fetchone()
        if not row or row[0] is None or int(row[0]) == 0:
            return False

        total = int(row[0])
        sale = int(row[1]) if row[1] is not None else 0
        return (sale / total) >= 0.8
    except Exception:
        return False
def calculate_failed_coupon_attempt(events: list) -> bool:
    """
    Feature: failed_coupon_attempt

    Boolean flag indicating the shopper attempted to apply a coupon code that
    was rejected. Detected via coupon_error or coupon_applied events with
    a failed status in the payload.

    Models: M2 (Price/Convenience Classifier), M5 (Offer Value Optimizer)
    Source: customer_events — event_type='coupon_error' or coupon_applied with error

    Returns:
        bool: True = a discount code was rejected this session. Default False.
    """
    if not isinstance(events, list):
        return False

    for event in events:
        if not isinstance(event, dict):
            continue

        event_type = event.get("event_type")

        if event_type == "coupon_error":
            return True

        if event_type == "coupon_applied":
            payload = event.get("payload")
            if isinstance(payload, dict):
                status = payload.get("status", "")
                if isinstance(status, str) and status.lower() in ("failed", "error", "invalid"):
                    return True

        # Also detect via page_view payload coupon interaction flags
        if event_type == "page_view":
            payload = event.get("payload")
            if isinstance(payload, dict):
                if payload.get("coupon_field_error") is True:
                    return True

    return False
def calculate_merchant_avg_order_value(merchant_id: str, db) -> float:
    """
    Feature: merchant_avg_order_value

    The merchant's global average order value across all customers.
    Used as a benchmark to contextualise the shopper's current cart value.

    Models: M2 (Price/Convenience Classifier)
    Source: Order table — aggregated across all orders for the store

    Args:
        merchant_id: UUID of the merchant/store
        db: Active database connection

    Returns:
        float: Average order value in the merchant's currency. Default 0.0.
    """
    if not merchant_id or db is None:
        return 0.0

    try:
        with db.cursor() as cursor:
            cursor.execute(
                "SELECT AVG(total) FROM orders WHERE store_id = %s",
                (merchant_id,)
            )
            row = cursor.fetchone()
        if row and row[0] is not None:
            return float(row[0])
        return 0.0
    except Exception:
        return 0.0
def calculate_account_creation_abandonment(events: list) -> bool:
    """
    Feature: account_creation_abandonment

    Boolean flag indicating the shopper started but abandoned the account
    creation / registration step during checkout. Signals friction with
    forced account creation as a checkout gate.

    Models: M2 (Price/Convenience Classifier)
    Source: customer_events — event_type='account_create_start' without completion

    Returns:
        bool: True = abandoned at account registration. Default False.
    """
    if not isinstance(events, list):
        return False

    started = False
    completed = False

    for event in events:
        if not isinstance(event, dict):
            continue

        event_type = event.get("event_type")

        if event_type in ("account_create_start", "registration_start"):
            started = True

        elif event_type in ("account_create_complete", "registration_complete"):
            completed = True

    return started and not completed
def calculate_repeat_checkout_attempts(events: list) -> int:
    """
    Feature: repeat_checkout_attempts

    Count of distinct checkout initiation events in the same session.
    Multiple checkout initiations indicate strong purchase intent paired
    with repeated friction — a high-value recovery target.

    Models: M2 (Price/Convenience Classifier)
    Source: customer_events — event_type='checkout_start'

    Returns:
        int: 0+ count of checkout initiations. Default 0.
    """
    if not isinstance(events, list):
        return 0

    count = 0
    for event in events:
        if not isinstance(event, dict):
            continue
        if event.get("event_type") in ("checkout_start", "checkout_initiated"):
            count += 1

    return count
def calculate_device_type_mobile(events: list) -> bool:
    """
    Feature: device_type_mobile

    Boolean flag indicating the session originated from a mobile device.
    Mobile sessions have higher abandonment rates, especially at payment step.

    Models: M2 (Price/Convenience Classifier)
    Source: customer_events — payload.user_agent or payload.device_type field

    Returns:
        bool: True = mobile device. False = desktop/tablet/unknown. Default False.
    """
    if not isinstance(events, list):
        return False

    MOBILE_SIGNALS = ("mobile", "android", "iphone", "ipad", "ipod",
                      "blackberry", "windows phone")

    for event in events:
        if not isinstance(event, dict):
            continue

        payload = event.get("payload")
        if not isinstance(payload, dict):
            continue

        # Check explicit device_type field first
        device_type = payload.get("device_type", "")
        if isinstance(device_type, str) and device_type.lower() == "mobile":
            return True

        # Fall back to user_agent sniffing
        user_agent = payload.get("user_agent", "")
        if not isinstance(user_agent, str):
            continue
        ua_lower = user_agent.lower()
        if any(signal in ua_lower for signal in MOBILE_SIGNALS):
            return True

    return False
def calculate_shipping_eta_dwell_sec(events: list) -> float:
    """
    Feature: shipping_eta_dwell_sec

    Seconds spent viewing the shipping ETA / delivery timeline element.
    Long dwell on shipping information signals delivery timeline sensitivity.

    Models: M2 (Price/Convenience Classifier)
    Source: customer_events — event_type='element_view' with element_id
            containing 'shipping-eta', 'delivery-estimate', or similar

    Returns:
        float: Total dwell seconds on shipping ETA elements. Default 0.0.
    """
    if not isinstance(events, list):
        return 0.0

    SHIPPING_ETA_SIGNALS = ("shipping-eta", "delivery-estimate", "delivery-date",
                             "shipping_eta", "estimated-delivery")

    focus_times = {}
    total_dwell = 0.0

    for event in events:
        if not isinstance(event, dict):
            continue

        event_type = event.get("event_type")
        payload = event.get("payload")
        if not isinstance(payload, dict):
            continue

        element_id = payload.get("element_id", "")
        if not isinstance(element_id, str):
            continue

        element_lower = element_id.lower()
        is_shipping = any(sig in element_lower for sig in SHIPPING_ETA_SIGNALS)
        if not is_shipping:
            # Also check dwell_element events
            element_type = payload.get("element_type", "")
            if not isinstance(element_type, str):
                continue
            is_shipping = any(sig in element_type.lower() for sig in SHIPPING_ETA_SIGNALS)

        if not is_shipping:
            continue

        ts = _parse_timestamp(event.get("timestamp"))
        if ts is None:
            continue

        if event_type in ("element_focus", "element_view_start"):
            focus_times[element_id] = ts
        elif event_type in ("element_blur", "element_view_end"):
            if element_id in focus_times:
                dwell = (ts - focus_times.pop(element_id)).total_seconds()
                total_dwell += max(0.0, dwell)
        elif event_type == "element_dwell":
            dwell = payload.get("dwell_ms", 0)
            if isinstance(dwell, (int, float)):
                total_dwell += float(dwell) / 1000.0

    return total_dwell
def calculate_trust_page_visited(events: list) -> bool:
    """
    Feature: trust_page_visited

    Boolean flag indicating the shopper visited a return policy, FAQ,
    shipping policy, or trust/security page during the session.
    Signals uncertainty or friction with purchase commitment.

    Models: M2 (Price/Convenience Classifier)
    Source: customer_events — event_type='page_view', payload.url field

    Returns:
        bool: True = shopper viewed a trust/policy page. Default False.
    """
    if not isinstance(events, list):
        return False

    TRUST_TERMS = ("return", "refund", "faq", "policy", "shipping-info",
                   "shipping_info", "trust", "guarantee", "secure",
                   "privacy", "terms", "about", "contact")

    for event in events:
        if not isinstance(event, dict):
            continue
        if event.get("event_type") != "page_view":
            continue
        payload = event.get("payload")
        if not isinstance(payload, dict):
            continue
        url = payload.get("url", "")
        if not isinstance(url, str):
            continue
        url_lower = url.lower()
        if any(term in url_lower for term in TRUST_TERMS):
            return True

    return False
def calculate_failed_coupon_count(events: list) -> int:
    """
    Feature: failed_coupon_count

    Integer count of how many times the shopper attempted a rejected discount
    code during the session. Multiple failures signal strong price sensitivity.

    Models: M2 (Price/Convenience Classifier), M5 (Offer Value Optimizer)
    Source: customer_events — event_type='coupon_error'

    Returns:
        int: 0+ count of failed coupon attempts. Default 0.
    """
    if not isinstance(events, list):
        return 0

    count = 0
    for event in events:
        if not isinstance(event, dict):
            continue

        event_type = event.get("event_type")

        if event_type == "coupon_error":
            count += 1

        elif event_type == "coupon_applied":
            payload = event.get("payload")
            if isinstance(payload, dict):
                status = payload.get("status", "")
                if isinstance(status, str) and status.lower() in ("failed", "error", "invalid"):
                    count += 1

        elif event_type == "page_view":
            payload = event.get("payload")
            if isinstance(payload, dict):
                if payload.get("coupon_field_error") is True:
                    count += 1

    return count
def calculate_copied_product_title(events: list) -> bool:
    """
    Feature: copied_product_title

    Boolean flag indicating the shopper copied the product title during the
    session. Copying a product name is a strong price-comparison signal —
    the shopper is likely checking competitor prices.

    Models: M2 (Price/Convenience Classifier)
    Source: customer_events — event_type='clipboard_copy' with element context

    Returns:
        bool: True = product title was copied (strong PSS signal). Default False.
    """
    if not isinstance(events, list):
        return False

    PRODUCT_TITLE_SIGNALS = ("product-title", "product_title", "item-name",
                              "item_name", "product-name", "product_name")

    for event in events:
        if not isinstance(event, dict):
            continue

        event_type = event.get("event_type")
        if event_type not in ("clipboard_copy", "copy"):
            continue

        payload = event.get("payload")
        if not isinstance(payload, dict):
            continue

        element_id = payload.get("element_id", "")
        element_class = payload.get("element_class", "")
        context = payload.get("context", "")

        for value in (element_id, element_class, context):
            if not isinstance(value, str):
                continue
            if any(signal in value.lower() for signal in PRODUCT_TITLE_SIGNALS):
                return True

    return False
def calculate_cart_value_vs_avg_order_value_ratio(customer_id: str, events: list, db) -> float:
    """
    Feature: cart_value_vs_avg_order_value_ratio

    Float ratio of the current checkout cart value vs the shopper's lifetime
    average order value. A ratio > 1.0 means the current cart is larger than
    usual — higher stakes, higher abandonment risk and higher offer value needed.

    Models: M1 (Abandonment Predictor), M5 (Offer Value Optimizer)
    Source: customer_events (cart_value from payload) + orders table (avg_order_value)

    Args:
        customer_id: UUID of the customer
        events: Raw session event list
        db: Active database connection

    Returns:
        float: Ratio >= 0.0. Returns 1.0 as neutral default if avg is unavailable.
    """
    if not isinstance(events, list):
        return 1.0

    # Extract cart value from events (last checkout_step or cart_update event)
    cart_value = None
    for event in events:
        if not isinstance(event, dict):
            continue
        if event.get("event_type") not in ("checkout_step", "cart_update", "cart_view"):
            continue
        payload = event.get("payload")
        if not isinstance(payload, dict):
            continue
        value = payload.get("cart_value") or payload.get("cart_total")
        if isinstance(value, (int, float)) and value >= 0:
            cart_value = float(value)

    if cart_value is None:
        return 1.0

    avg_order = calculate_avg_order_value(customer_id, db)

    if avg_order <= 0.0:
        return 1.0

    return round(cart_value / avg_order, 4)
def calculate_pss_score(feature_dict: dict) -> int:
    """
    Feature: pss_score (Price Sensitivity Score)

    Composite score representing how price-sensitive this shopper is.
    Weighted combination of PSS signals:
        HIGH   (30pts) — cursor_hesitation count (capped contribution)
        HIGH   (25pts) — past_orders_with_coupon_pct
        MEDIUM (20pts) — visited_coupon_page
        MEDIUM (15pts) — searched_discount_terms
        LOW    (10pts) — tab_switch_count (capped contribution)

    Models: M2 output, M5 input. Stored in abandoned_carts.pss_score.

    Args:
        feature_dict: Flat dict of all pre-computed feature values

    Returns:
        int: 0–100. Threshold for price-sensitive action: 60+.
    """
    if not isinstance(feature_dict, dict):
        return 0

    score = 0.0

    # HIGH: cursor hesitation (0-30 pts) — normalised over 10 events
    hesitation = feature_dict.get("cursor_hesitation", 0) or 0
    score += min(30.0, (hesitation / 10.0) * 30.0)

    # HIGH: coupon usage pct (0-25 pts) — already 0.0-1.0 ratio
    coupon_pct = feature_dict.get("past_orders_with_coupon_pct", 0.0) or 0.0
    score += float(coupon_pct) * 25.0

    # MEDIUM: visited coupon page (0 or 20 pts)
    if feature_dict.get("visited_coupon_page"):
        score += 20.0

    # MEDIUM: searched discount terms (0 or 15 pts)
    if feature_dict.get("searched_discount_terms"):
        score += 15.0

    # LOW: tab switch count (0-10 pts) — normalised over 5 switches
    tab_switches = feature_dict.get("tab_switch_count", 0) or 0
    score += min(10.0, (tab_switches / 5.0) * 10.0)

    return min(100, int(round(score)))
def calculate_css_score(feature_dict: dict) -> int:
    """
    Feature: css_score (Convenience Sensitivity Score)

    Composite score representing how much friction drove the abandonment.
    Weighted combination of CSS signals:
        VERY HIGH (40pts) — abandoned_at_shipping_reveal
        HIGH      (35pts) — checkout_step_reached (higher step = more friction)
        MEDIUM    (25pts) — scroll_depth_pct (low scroll = early drop-off friction)

    Models: M2 output, M5 input. Stored in abandoned_carts.css_score.

    Args:
        feature_dict: Flat dict of all pre-computed feature values

    Returns:
        int: 0–100. Threshold for convenience-sensitive action: 60+.
    """
    if not isinstance(feature_dict, dict):
        return 0

    score = 0.0

    # VERY HIGH: abandoned at shipping reveal (0 or 40 pts)
    if feature_dict.get("abandoned_at_shipping_reveal"):
        score += 40.0

    # HIGH: checkout step reached (0-35 pts) — normalised over 5 steps
    step = feature_dict.get("checkout_step_reached", 0) or 0
    score += min(35.0, (step / 5.0) * 35.0)

    # MEDIUM: scroll depth (0-25 pts) — inverted: low depth = high friction score
    scroll = feature_dict.get("scroll_depth_pct", 0.0) or 0.0
    inverted_scroll = max(0.0, 100.0 - float(scroll))
    score += (inverted_scroll / 100.0) * 25.0

    return min(100, int(round(score)))
def compute_feature_vector(customer_id: str, session_events: list, db) -> dict:
    """
    Assembles the complete 30-feature Shopper Feature Vector for a session.
    Calls all individual feature functions and returns the unified dict
    passed to any model at inference time.

    Models: All five (M1–M5)
    Source: All data sources

    Args:
        customer_id   : UUID of the customer
        session_events: Raw pixel event list for the current session
        db            : Active database connection (or None for inference without DB)

    Returns:
        dict: Full feature vector with metadata envelope and 'features' sub-dict.
    """
    if not isinstance(session_events, list):
        session_events = []

    # Extract metadata from events
    session_id = None
    merchant_id = None
    timestamp = None
    for event in session_events:
        if isinstance(event, dict):
            if session_id is None:
                session_id = event.get("session_id")
            if merchant_id is None:
                merchant_id = event.get("merchant_id") or event.get("store_id")
            if timestamp is None:
                timestamp = event.get("timestamp")

    # Build the raw feature dict first (needed for composite scores)
    raw = {
        "scroll_depth_pct":                    calculate_scroll_depth(session_events),
        "tab_switch_count":                    calculate_tab_switch_count(session_events),
        "time_on_checkout_step_sec":           calculate_time_on_checkout_step(session_events),
        "cursor_hesitation":                   calculate_cursor_hesitation(session_events),
        "checkout_step_reached":               calculate_checkout_step_reached(session_events),
        "past_orders_total":                   calculate_past_orders_total(customer_id, db),
        "past_orders_with_coupon_pct":         calculate_coupon_usage_pct(customer_id, db),
        "days_since_last_purchase":            calculate_days_since_last_purchase(customer_id, db),
        "avg_order_value":                     calculate_avg_order_value(customer_id, db),
        "purchase_frequency_trend":            calculate_purchase_frequency_trend(customer_id, db),
        "visited_coupon_page":                 calculate_visited_coupon_page(session_events),
        "searched_discount_terms":             calculate_searched_discount_terms(session_events),
        "abandoned_at_shipping_reveal":        calculate_abandoned_at_shipping_reveal(session_events),
        "failed_payment_attempt":              calculate_failed_payment_attempt(session_events),
        "local_hour_of_session":               calculate_local_hour_of_session(session_events),
        "day_of_week_session":                 calculate_day_of_week_session(session_events),
        "time_on_page_ms":                     calculate_time_on_page_ms(session_events),
        "google_shopping_referrer":            calculate_google_shopping_referrer(session_events),
        "time_first_view_to_cart_add_hrs":     calculate_time_first_view_to_cart_add_hrs(session_events),
        "sale_period_purchase_only":           calculate_sale_period_purchase_only(customer_id, db),
        "failed_coupon_attempt":               calculate_failed_coupon_attempt(session_events),
        "merchant_avg_order_value":            calculate_merchant_avg_order_value(merchant_id, db),
        "account_creation_abandonment":        calculate_account_creation_abandonment(session_events),
        "repeat_checkout_attempts":            calculate_repeat_checkout_attempts(session_events),
        "device_type_mobile":                  calculate_device_type_mobile(session_events),
        "shipping_eta_dwell_sec":              calculate_shipping_eta_dwell_sec(session_events),
        "trust_page_visited":                  calculate_trust_page_visited(session_events),
        "failed_coupon_count":                 calculate_failed_coupon_count(session_events),
        "copied_product_title":                calculate_copied_product_title(session_events),
        "cart_value_vs_avg_order_value_ratio": calculate_cart_value_vs_avg_order_value_ratio(
                                                   customer_id, session_events, db),
    }

    return {
        "session_id":  session_id,
        "customer_id": customer_id,
        "merchant_id": merchant_id,
        "timestamp":   timestamp,
        "features":    raw,
    }
def calculate_rfm_scores(customer_id: str, db) -> dict:
    days = calculate_days_since_last_purchase(customer_id, db)
    orders = calculate_past_orders_total(customer_id, db)
    aov = calculate_avg_order_value(customer_id, db)
    
    # Recency Score
    if days == -1 or days > 365:
        r_score = 1
    elif days < 30:
        r_score = 5
    elif days <= 90:
        r_score = 4
    elif days <= 180:
        r_score = 3
    else:
        r_score = 2
        
    # Frequency Score
    if orders > 10:
        f_score = 5
    elif orders >= 6:
        f_score = 4
    elif orders >= 3:
        f_score = 3
    elif orders >= 1:
        f_score = 2
    else:
        f_score = 1
        
    # Monetary Score
    if aov > 200:
        m_score = 5
    elif aov >= 100:
        m_score = 4
    elif aov >= 50:
        m_score = 3
    elif aov >= 10:
        m_score = 2
    else:
        m_score = 1
        
    return {
        "rfm_recency_score": r_score,
        "rfm_frequency_score": f_score,
        "rfm_monetary_score": m_score,
        "days_since_last_purchase": days,
        "past_orders_total": orders,
        "avg_order_value": aov
    }
