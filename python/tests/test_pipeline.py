import pytest
from src.features.pipeline import (
    calculate_scroll_depth,
    calculate_tab_switch_count,
    calculate_cursor_hesitation,
    calculate_checkout_step_reached,
    calculate_failed_payment_attempt,
    calculate_local_hour_of_session,
    calculate_day_of_week_session,
    calculate_time_on_page_ms,
    calculate_cart_item_add_count,
    calculate_cart_item_remove_count,
    calculate_time_first_view_to_cart_add_hrs,
    calculate_shipping_eta_dwell_sec,
    compute_feature_vector,
)

# ---------------------------------------------------------------------------
# calculate_scroll_depth Tests
# ---------------------------------------------------------------------------
def test_scroll_depth_normal():
    events = [
        {"event_type": "scroll", "payload": {"depth_pct": 25}},
        {"event_type": "scroll", "payload": {"depth_pct": 75}},
        {"event_type": "scroll", "payload": {"depth_pct": 50}}
    ]
    assert calculate_scroll_depth(events) == 75.0

def test_scroll_depth_empty():
    assert calculate_scroll_depth([]) == 0.0

def test_scroll_depth_malformed():
    events = [
        None,
        "not a dict",
        {"event_type": "scroll"},  # Missing payload
        {"event_type": "scroll", "payload": "not a dict"},
        {"event_type": "scroll", "payload": {"depth_pct": "seventy-five"}},
        {"event_type": "other", "payload": {"depth_pct": 100}}
    ]
    assert calculate_scroll_depth(events) == 0.0


# ---------------------------------------------------------------------------
# calculate_tab_switch_count Tests
# ---------------------------------------------------------------------------
def test_tab_switch_count_normal():
    events = [
        {"event_type": "tab_switch", "payload": {"direction": "blur"}},
        {"event_type": "tab_switch", "payload": {"direction": "focus"}},
        {"event_type": "tab_switch", "payload": {"direction": "blur"}}
    ]
    assert calculate_tab_switch_count(events) == 2

def test_tab_switch_count_empty():
    assert calculate_tab_switch_count([]) == 0

def test_tab_switch_count_malformed():
    events = [
        {"event_type": "tab_switch"},
        {"event_type": "tab_switch", "payload": None},
        {"event_type": "tab_switch", "payload": {"direction": 123}},
        None
    ]
    assert calculate_tab_switch_count(events) == 0


# ---------------------------------------------------------------------------
# calculate_cursor_hesitation Tests
# ---------------------------------------------------------------------------
def test_cursor_hesitation_normal():
    events = [
        {"event_type": "field_focus", "timestamp": "2026-08-25T14:30:00Z", "payload": {"field_name": "coupon"}},
        {"event_type": "scroll", "timestamp": "2026-08-25T14:30:02Z", "payload": {}},
        {"event_type": "field_blur", "timestamp": "2026-08-25T14:30:05Z", "payload": {"field_name": "coupon"}}
    ]
    # 5 seconds duration = 5000ms. 5000 // 1000 = 5.
    assert calculate_cursor_hesitation(events) == 5

def test_cursor_hesitation_capped():
    events = [
        {"event_type": "field_focus", "timestamp": "2026-08-25T14:30:00Z", "payload": {"field_name": "email"}},
        # 20 seconds later = 20,000ms. 20,000 // 1000 = 20. But max is capped at 10.
        {"event_type": "field_blur", "timestamp": "2026-08-25T14:30:20Z", "payload": {"field_name": "email"}}
    ]
    assert calculate_cursor_hesitation(events) == 10

def test_cursor_hesitation_empty():
    assert calculate_cursor_hesitation([]) == 0

def test_cursor_hesitation_malformed():
    events = [None, 123, {"event_type": None}, {"no_event_type": "exit_intent"}]
    assert calculate_cursor_hesitation(events) == 0


def test_time_first_view_to_cart_add_accepts_created_at_alias():
    events = [
        {"event_type": "page_view", "created_at": "2026-08-30T10:00:00Z"},
        {"event_type": "add_to_cart", "created_at": "2026-08-30T11:30:00Z"},
    ]
    assert calculate_time_first_view_to_cart_add_hrs(events) == 1.5


def test_shipping_eta_dwell_accepts_created_at_alias():
    events = [
        {
            "event_type": "element_focus",
            "created_at": "2026-08-30T10:00:00Z",
            "payload": {"element_id": "shipping_eta"},
        },
        {
            "event_type": "element_blur",
            "created_at": "2026-08-30T10:00:05Z",
            "payload": {"element_id": "shipping_eta"},
        },
    ]
    assert calculate_shipping_eta_dwell_sec(events) == 5.0


# ---------------------------------------------------------------------------
# calculate_cart_item_add_count Tests
# ---------------------------------------------------------------------------
def test_cart_item_add_count_normal():
    events = [
        {"event_type": "add_to_cart"},
        {"event_type": "page_view"},
        {"event_type": "add_to_cart"}
    ]
    assert calculate_cart_item_add_count(events) == 2

def test_cart_item_add_count_empty():
    assert calculate_cart_item_add_count([]) == 0

def test_cart_item_add_count_malformed():
    events = [None, 123, {"event_type": None}, {"no_event_type": "add_to_cart"}]
    assert calculate_cart_item_add_count(events) == 0


# ---------------------------------------------------------------------------
# calculate_cart_item_remove_count Tests
# ---------------------------------------------------------------------------
def test_cart_item_remove_count_normal():
    events = [
        {"event_type": "remove_from_cart"},
        {"event_type": "add_to_cart"},
        {"event_type": "remove_from_cart"}
    ]
    assert calculate_cart_item_remove_count(events) == 2

def test_cart_item_remove_count_empty():
    assert calculate_cart_item_remove_count([]) == 0

def test_cart_item_remove_count_malformed():
    events = [None, 123, {"event_type": None}, {"no_event_type": "remove_from_cart"}]
    assert calculate_cart_item_remove_count(events) == 0


# ---------------------------------------------------------------------------
# calculate_checkout_step_reached Tests
# ---------------------------------------------------------------------------
def test_checkout_step_reached_normal():
    events = [
        {"event_type": "checkout_step", "payload": {"step": 1}},
        {"event_type": "checkout_step", "payload": {"step": 3}},
        {"event_type": "checkout_step", "payload": {"step": 2}}
    ]
    assert calculate_checkout_step_reached(events) == 3

def test_checkout_step_reached_empty():
    assert calculate_checkout_step_reached([]) == 0

def test_checkout_step_reached_malformed():
    events = [
        {"event_type": "checkout_step"},
        {"event_type": "checkout_step", "payload": "string"},
        {"event_type": "checkout_step", "payload": {"step": "three"}}
    ]
    assert calculate_checkout_step_reached(events) == 0


# ---------------------------------------------------------------------------
# calculate_failed_payment_attempt Tests
# ---------------------------------------------------------------------------
def test_failed_payment_attempt_normal():
    events = [
        {"event_type": "checkout_step"},
        {"event_type": "failed_payment"},
        {"event_type": "page_view"}
    ]
    assert calculate_failed_payment_attempt(events) is True

def test_failed_payment_attempt_empty():
    assert calculate_failed_payment_attempt([]) is False

def test_failed_payment_attempt_malformed():
    events = [
        {"event_type": "failed_payment_success"},
        {"type": "failed_payment"},
        None
    ]
    assert calculate_failed_payment_attempt(events) is False


# ---------------------------------------------------------------------------
# calculate_local_hour_of_session Tests
# ---------------------------------------------------------------------------
def test_local_hour_of_session_normal():
    events = [
        {"event_type": "page_view", "timestamp": "2026-06-28T15:30:00Z"},
        {"event_type": "page_view", "timestamp": "2026-06-28T14:15:00Z"},
        {"event_type": "page_view", "timestamp": "2026-06-28T16:45:00Z"}
    ]
    assert calculate_local_hour_of_session(events) == 14

def test_local_hour_of_session_empty():
    assert calculate_local_hour_of_session([]) == 12

def test_local_hour_of_session_malformed():
    events = [
        {"event_type": "page_view", "timestamp": "invalid_date"},
        {"event_type": "page_view"},
        {"event_type": "page_view", "timestamp": 12345},
        None
    ]
    assert calculate_local_hour_of_session(events) == 12


# ---------------------------------------------------------------------------
# calculate_day_of_week_session Tests
# ---------------------------------------------------------------------------
def test_day_of_week_session_normal():
    # 2026-06-28 is a Sunday (weekday() == 6)
    events = [
        {"event_type": "page_view", "timestamp": "2026-06-28T15:30:00Z"},
        {"event_type": "page_view", "timestamp": "2026-06-29T14:15:00Z"} # Monday
    ]
    assert calculate_day_of_week_session(events) == 6

def test_day_of_week_session_empty():
    assert calculate_day_of_week_session([]) == 0

def test_day_of_week_session_malformed():
    events = [
        {"event_type": "page_view", "timestamp": "invalid_date"},
        {"event_type": "page_view"}
    ]
    assert calculate_day_of_week_session(events) == 0


# ---------------------------------------------------------------------------
# calculate_time_on_page_ms Tests
# ---------------------------------------------------------------------------
def test_time_on_page_ms_normal():
    events = [
        {"event_type": "page_view", "timestamp": "2026-06-28T15:30:00Z"},
        {"event_type": "scroll", "timestamp": "2026-06-28T15:30:05Z"}
    ]
    # Difference is 5 seconds = 5000 milliseconds
    assert calculate_time_on_page_ms(events) == 5000

def test_time_on_page_ms_empty():
    assert calculate_time_on_page_ms([]) == 0
    # Less than 2 valid timestamps
    events = [{"event_type": "page_view", "timestamp": "2026-06-28T15:30:00Z"}]
    assert calculate_time_on_page_ms(events) == 0

def test_time_on_page_ms_malformed():
    events = [
        {"event_type": "page_view", "timestamp": "invalid"},
        {"event_type": "scroll"},
        {"event_type": "exit", "timestamp": "2026-06-28T15:30:00Z"}
    ]
    # Only 1 valid timestamp, should return 0
    assert calculate_time_on_page_ms(events) == 0


# ---------------------------------------------------------------------------
# TRANSACTIONAL DB FEATURE TESTS (unittest format as per contract)
# ---------------------------------------------------------------------------

import unittest
from unittest.mock import MagicMock, patch
from src.features.pipeline import (
    calculate_past_orders_total,
    calculate_avg_order_value,
    calculate_days_since_last_purchase,
    calculate_purchase_frequency_trend,
    calculate_coupon_usage_pct,
    calculate_rfm_scores
)

class TestDatabaseFeatures(unittest.TestCase):
    
    def setUp(self):
        self.db = MagicMock()
        self.cursor = MagicMock()
        self.db.cursor.return_value.__enter__.return_value = self.cursor

    # 1. past_orders_total
    def test_past_orders_total_normal(self):
        self.cursor.fetchone.return_value = (10,)
        self.assertEqual(calculate_past_orders_total("cus_1", self.db), 10)
        
    def test_past_orders_total_empty(self):
        self.cursor.fetchone.return_value = None
        self.assertEqual(calculate_past_orders_total("cus_1", self.db), 0)
        
    def test_past_orders_total_exception(self):
        self.cursor.execute.side_effect = Exception("DB Error")
        self.assertEqual(calculate_past_orders_total("cus_1", self.db), 0)

    # 2. avg_order_value
    def test_avg_order_value_normal(self):
        self.cursor.fetchone.return_value = (150.5,)
        self.assertEqual(calculate_avg_order_value("cus_1", self.db), 150.5)
        
    def test_avg_order_value_empty(self):
        self.cursor.fetchone.return_value = None
        self.assertEqual(calculate_avg_order_value("cus_1", self.db), 0.0)
        
    def test_avg_order_value_exception(self):
        self.cursor.execute.side_effect = Exception("DB Error")
        self.assertEqual(calculate_avg_order_value("cus_1", self.db), 0.0)

    # 3. days_since_last_purchase
    def test_days_since_last_purchase_normal(self):
        from datetime import datetime, timezone, timedelta
        now = datetime.now(timezone.utc)
        last_order = now - timedelta(days=45)
        self.cursor.fetchone.return_value = (last_order,)
        self.assertEqual(calculate_days_since_last_purchase("cus_1", self.db), 45)

    def test_days_since_last_purchase_empty(self):
        self.cursor.fetchone.return_value = None
        self.assertEqual(calculate_days_since_last_purchase("cus_1", self.db), -1)

    def test_days_since_last_purchase_exception(self):
        self.cursor.execute.side_effect = Exception("DB Error")
        self.assertEqual(calculate_days_since_last_purchase("cus_1", self.db), -1)

    # 4. purchase_frequency_trend
    def test_purchase_frequency_trend_normal(self):
        self.cursor.fetchone.return_value = (5, 2, True)
        self.assertEqual(calculate_purchase_frequency_trend("cus_1", self.db), 1)
        self.cursor.fetchone.return_value = (1, 4, True)
        self.assertEqual(calculate_purchase_frequency_trend("cus_1", self.db), -1)
        self.cursor.fetchone.return_value = (3, 3, True)
        self.assertEqual(calculate_purchase_frequency_trend("cus_1", self.db), 0)

    def test_purchase_frequency_trend_is_neutral_without_sixty_days_of_history(self):
        self.cursor.fetchone.return_value = (1, 0, False)
        self.assertEqual(calculate_purchase_frequency_trend("cus_1", self.db), 0)

    def test_purchase_frequency_trend_empty(self):
        self.cursor.fetchone.return_value = None
        self.assertEqual(calculate_purchase_frequency_trend("cus_1", self.db), 0)

    def test_purchase_frequency_trend_exception(self):
        self.cursor.execute.side_effect = Exception("DB Error")
        self.assertEqual(calculate_purchase_frequency_trend("cus_1", self.db), 0)

    # 5. coupon_usage_pct
    def test_coupon_usage_pct_normal(self):
        self.cursor.fetchone.return_value = (0.75,)
        self.assertEqual(calculate_coupon_usage_pct("cus_1", self.db), 0.75)
        query, params = self.cursor.execute.call_args.args
        self.assertIn("COUNT(*) FILTER", query)
        self.assertEqual(params, ("cus_1",))

    def test_coupon_usage_pct_empty(self):
        self.cursor.fetchone.return_value = None
        self.assertEqual(calculate_coupon_usage_pct("cus_1", self.db), 0.0)

    def test_coupon_usage_pct_exception(self):
        self.cursor.execute.side_effect = Exception("DB Error")
        self.assertEqual(calculate_coupon_usage_pct("cus_1", self.db), 0.0)

    # 6. rfm_scores
    def test_rfm_scores_normal(self):
        with patch("src.features.pipeline.calculate_days_since_last_purchase", return_value=15), \
             patch("src.features.pipeline.calculate_past_orders_total", return_value=8), \
             patch("src.features.pipeline.calculate_avg_order_value", return_value=150.0):
             
             res = calculate_rfm_scores("cus_1", self.db)
             self.assertEqual(res["rfm_recency_score"], 5)
             self.assertEqual(res["rfm_frequency_score"], 4)
             self.assertEqual(res["rfm_monetary_score"], 4)

    def test_rfm_scores_empty_defaults(self):
        with patch("src.features.pipeline.calculate_days_since_last_purchase", return_value=-1), \
             patch("src.features.pipeline.calculate_past_orders_total", return_value=0), \
             patch("src.features.pipeline.calculate_avg_order_value", return_value=0.0):
             
             res = calculate_rfm_scores("cus_1", self.db)
             self.assertEqual(res["rfm_recency_score"], 1)
             self.assertEqual(res["rfm_frequency_score"], 1)
             self.assertEqual(res["rfm_monetary_score"], 1)
             self.assertEqual(res["days_since_last_purchase"], -1)

    def test_rfm_scores_exception(self):
        self.cursor.execute.side_effect = Exception("DB Error")
        res = calculate_rfm_scores("cus_1", self.db)
        self.assertEqual(res["rfm_recency_score"], 1)

    def test_rfm_scores_assigns_one_order_to_frequency_band_one(self):
        with patch("src.features.pipeline.calculate_days_since_last_purchase", return_value=15), \
             patch("src.features.pipeline.calculate_past_orders_total", return_value=1), \
             patch("src.features.pipeline.calculate_avg_order_value", return_value=15.0):
            res = calculate_rfm_scores("cus_1", self.db)

        self.assertEqual(res["rfm_frequency_score"], 1)
        self.assertEqual(res["rfm_monetary_score"], 1)

# ---------------------------------------------------------------------------
# Extended Database Tests
# These tests add additional edge cases and validation without modifying
# the existing database test suite.
# ---------------------------------------------------------------------------

"""
Unit tests for pipeline.py (database-backed feature functions)
Framework: unittest + unittest.mock.MagicMock

Each function tested for:
    1. Normal DB response (cursor returns valid row(s))
    2. No data (cursor returns empty/None result)
    3. DB exception (cursor.execute raises an exception)
"""

import unittest
from unittest.mock import MagicMock
import sys
import os
from datetime import datetime, timedelta

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from src.features.pipeline import (
    calculate_past_orders_total,
    calculate_avg_order_value,
    calculate_days_since_last_purchase,
    calculate_purchase_frequency_trend,
    calculate_coupon_usage_pct,
    calculate_rfm_scores,
)


def make_mock_db(fetchone_return=None, execute_side_effect=None):
    """Helper to build a mock db with a mock cursor."""
    mock_cursor = MagicMock()
    mock_cursor.fetchone.return_value = fetchone_return
    if execute_side_effect:
        mock_cursor.execute.side_effect = execute_side_effect
        
    mock_cursor.__enter__.return_value = mock_cursor

    mock_db = MagicMock()
    mock_db.cursor.return_value = mock_cursor
    return mock_db, mock_cursor


class TestCalculatePastOrdersTotal(unittest.TestCase):

    def test_normal_response(self):
        db, cursor = make_mock_db(fetchone_return=(10,))
        result = calculate_past_orders_total("cust_1", db)
        self.assertEqual(result, 10)
        cursor.execute.assert_called_once()
        # Verify parameterized query — customer_id passed as param, not interpolated
        args, kwargs = cursor.execute.call_args
        self.assertIn("%s", args[0])
        self.assertEqual(args[1], ("cust_1",))

    def test_no_data(self):
        db, cursor = make_mock_db(fetchone_return=None)
        result = calculate_past_orders_total("cust_999", db)
        self.assertEqual(result, 0)

    def test_null_value(self):
        db, cursor = make_mock_db(fetchone_return=(None,))
        result = calculate_past_orders_total("cust_1", db)
        self.assertEqual(result, 0)

    def test_db_exception(self):
        db, cursor = make_mock_db(execute_side_effect=Exception("DB connection failed"))
        try:
            result = calculate_past_orders_total("cust_1", db)
        except Exception as e:
            self.fail(f"calculate_past_orders_total raised: {e}")
        self.assertEqual(result, 0)

    def test_none_customer_id(self):
        db, _ = make_mock_db(fetchone_return=(10,))
        result = calculate_past_orders_total(None, db)
        self.assertEqual(result, 0)

    def test_none_db(self):
        result = calculate_past_orders_total("cust_1", None)
        self.assertEqual(result, 0)


class TestCalculateAvgOrderValue(unittest.TestCase):

    def test_normal_response(self):
        db, cursor = make_mock_db(fetchone_return=(75.50,))
        result = calculate_avg_order_value("cust_1", db)
        self.assertEqual(result, 75.50)

    def test_no_data(self):
        db, cursor = make_mock_db(fetchone_return=None)
        result = calculate_avg_order_value("cust_999", db)
        self.assertEqual(result, 0.0)

    def test_null_average(self):
        db, cursor = make_mock_db(fetchone_return=(None,))
        result = calculate_avg_order_value("cust_1", db)
        self.assertEqual(result, 0.0)

    def test_db_exception(self):
        db, cursor = make_mock_db(execute_side_effect=Exception("query failed"))
        try:
            result = calculate_avg_order_value("cust_1", db)
        except Exception as e:
            self.fail(f"calculate_avg_order_value raised: {e}")
        self.assertEqual(result, 0.0)


class TestCalculateDaysSinceLastPurchase(unittest.TestCase):

    def test_normal_response(self):
        ten_days_ago = datetime.now() - timedelta(days=10)
        db, cursor = make_mock_db(fetchone_return=(ten_days_ago,))
        result = calculate_days_since_last_purchase("cust_1", db)
        self.assertIn(result, [9, 10, 11])  # allow for timing flex

    def test_no_orders_returns_sentinel(self):
        db, cursor = make_mock_db(fetchone_return=(None,))
        result = calculate_days_since_last_purchase("cust_1", db)
        self.assertEqual(result, -1)

    def test_no_row_returns_sentinel(self):
        db, cursor = make_mock_db(fetchone_return=None)
        result = calculate_days_since_last_purchase("cust_1", db)
        self.assertEqual(result, -1)

    def test_db_exception_returns_sentinel(self):
        db, cursor = make_mock_db(execute_side_effect=Exception("boom"))
        try:
            result = calculate_days_since_last_purchase("cust_1", db)
        except Exception as e:
            self.fail(f"calculate_days_since_last_purchase raised: {e}")
        self.assertEqual(result, -1)

    def test_invalid_data_type_returns_sentinel(self):
        db, cursor = make_mock_db(fetchone_return=("not-a-date",))
        result = calculate_days_since_last_purchase("cust_1", db)
        self.assertEqual(result, -1)


class TestCalculatePurchaseFrequencyTrend(unittest.TestCase):

    def test_increasing_trend(self):
        db, cursor = make_mock_db(fetchone_return=(5, 2, True))  # current > previous
        result = calculate_purchase_frequency_trend("cust_1", db)
        self.assertEqual(result, 1)

    def test_decreasing_trend(self):
        db, cursor = make_mock_db(fetchone_return=(1, 5, True))  # current < previous
        result = calculate_purchase_frequency_trend("cust_1", db)
        self.assertEqual(result, -1)

    def test_stable_trend(self):
        db, cursor = make_mock_db(fetchone_return=(3, 3, True))
        result = calculate_purchase_frequency_trend("cust_1", db)
        self.assertEqual(result, 0)

    def test_no_data(self):
        db, cursor = make_mock_db(fetchone_return=None)
        result = calculate_purchase_frequency_trend("cust_1", db)
        self.assertEqual(result, 0)

    def test_null_values_treated_as_zero(self):
        db, cursor = make_mock_db(fetchone_return=(None, None, False))
        result = calculate_purchase_frequency_trend("cust_1", db)
        self.assertEqual(result, 0)

    def test_recent_only_history_is_insufficient(self):
        db, cursor = make_mock_db(fetchone_return=(3, 0, False))
        result = calculate_purchase_frequency_trend("cust_1", db)
        self.assertEqual(result, 0)

    def test_db_exception(self):
        db, cursor = make_mock_db(execute_side_effect=Exception("query failed"))
        try:
            result = calculate_purchase_frequency_trend("cust_1", db)
        except Exception as e:
            self.fail(f"calculate_purchase_frequency_trend raised: {e}")
        self.assertEqual(result, 0)


class TestCalculateCouponUsagePct(unittest.TestCase):

    def test_normal_response(self):
        db, cursor = make_mock_db(fetchone_return=(0.4,))
        result = calculate_coupon_usage_pct("cust_1", db)
        self.assertEqual(result, 0.4)

    def test_no_orders_null_result(self):
        # NULLIF(COUNT(*), 0) makes this NULL when no orders exist
        db, cursor = make_mock_db(fetchone_return=(None,))
        result = calculate_coupon_usage_pct("cust_1", db)
        self.assertEqual(result, 0.0)

    def test_no_row(self):
        db, cursor = make_mock_db(fetchone_return=None)
        result = calculate_coupon_usage_pct("cust_1", db)
        self.assertEqual(result, 0.0)

    def test_zero_pct(self):
        db, cursor = make_mock_db(fetchone_return=(0.0,))
        result = calculate_coupon_usage_pct("cust_1", db)
        self.assertEqual(result, 0.0)

    def test_full_pct(self):
        db, cursor = make_mock_db(fetchone_return=(1.0,))
        result = calculate_coupon_usage_pct("cust_1", db)
        self.assertEqual(result, 1.0)

    def test_db_exception(self):
        db, cursor = make_mock_db(execute_side_effect=Exception("boom"))
        try:
            result = calculate_coupon_usage_pct("cust_1", db)
        except Exception as e:
            self.fail(f"calculate_coupon_usage_pct raised: {e}")
        self.assertEqual(result, 0.0)


class TestCalculateRfmScores(unittest.TestCase):
    """
    These tests mock the cursor at a lower level since calculate_rfm_scores
    calls three other functions internally, each issuing its own query.
    We use side_effect on fetchone to return different values per call.
    """

    def test_normal_high_value_customer(self):
        five_days_ago = datetime.now() - timedelta(days=5)

        mock_cursor = MagicMock()
        mock_cursor.__enter__.return_value = mock_cursor
        # Order of internal calls: days_since_last_purchase, past_orders_total, avg_order_value
        mock_cursor.fetchone.side_effect = [
            (five_days_ago,),  # days_since_last_purchase query
            (25,),              # past_orders_total query
            (250.0,),            # avg_order_value query
        ]
        mock_db = MagicMock()
        mock_db.cursor.return_value = mock_cursor

        result = calculate_rfm_scores("cust_1", mock_db)

        self.assertEqual(result["rfm_recency_score"], 5)
        self.assertEqual(result["rfm_frequency_score"], 5)
        self.assertEqual(result["rfm_monetary_score"], 5)
        self.assertEqual(result["past_orders_total"], 25)
        self.assertEqual(result["avg_order_value"], 250.0)

    def test_new_customer_no_history(self):
        mock_cursor = MagicMock()
        mock_cursor.__enter__.return_value = mock_cursor
        mock_cursor.fetchone.side_effect = [
            None,    # no purchase history
            (0,),    # zero orders
            None,    # no avg
        ]
        mock_db = MagicMock()
        mock_db.cursor.return_value = mock_cursor

        result = calculate_rfm_scores("cust_new", mock_db)

        self.assertEqual(result["days_since_last_purchase"], -1)
        self.assertEqual(result["rfm_recency_score"], 1)
        self.assertEqual(result["past_orders_total"], 0)
        self.assertEqual(result["rfm_frequency_score"], 1)
        self.assertEqual(result["avg_order_value"], 0.0)
        self.assertEqual(result["rfm_monetary_score"], 1)

    def test_db_exception_does_not_propagate(self):
        mock_cursor = MagicMock()
        mock_cursor.__enter__.return_value = mock_cursor
        mock_cursor.execute.side_effect = Exception("connection dropped")
        mock_db = MagicMock()
        mock_db.cursor.return_value = mock_cursor

        try:
            result = calculate_rfm_scores("cust_1", mock_db)
        except Exception as e:
            self.fail(f"calculate_rfm_scores raised: {e}")

        self.assertEqual(result["days_since_last_purchase"], -1)
        self.assertEqual(result["past_orders_total"], 0)
        self.assertEqual(result["avg_order_value"], 0.0)

    def test_output_schema_complete(self):
        mock_cursor = MagicMock()
        mock_cursor.__enter__.return_value = mock_cursor
        mock_cursor.fetchone.side_effect = [None, (0,), None]
        mock_db = MagicMock()
        mock_db.cursor.return_value = mock_cursor

        result = calculate_rfm_scores("cust_1", mock_db)

        expected_keys = {
            "rfm_recency_score", "rfm_frequency_score", "rfm_monetary_score",
            "days_since_last_purchase", "past_orders_total", "avg_order_value"
        }
        self.assertEqual(set(result.keys()), expected_keys)


if __name__ == "__main__":
    unittest.main()


# ---------------------------------------------------------------------------
# compute_feature_vector Tests
# Verifies anonymous_id extraction, created_at timestamp fallback, and the
# safe empty-session guarantee — the three schema alignment properties from
# the critical alignment sweep (August 2026).
# ---------------------------------------------------------------------------

class TestComputeFeatureVector(unittest.TestCase):

    def test_anonymous_id_extracted_from_events(self):
        """anonymous_id must be surfaced in the envelope when present in events."""
        events = [
            {
                "event_type": "page_view",
                "session_id": "sess_anon_1",
                "anonymous_id": "anon-abc-123",
                "timestamp": "2026-08-20T10:00:00Z",
                "payload": {},
            }
        ]
        result = compute_feature_vector("cust_1", events, db=None)
        self.assertEqual(result["anonymous_id"], "anon-abc-123")
        self.assertIn("features", result)

    def test_timestamp_fallback_created_at(self):
        """
        When events carry created_at (DB source) instead of timestamp (pixel source),
        the envelope timestamp must still be populated correctly.
        This verifies the dual-source timestamp strategy.
        """
        events = [
            {
                "event_type": "page_view",
                "session_id": "sess_db_1",
                "created_at": "2026-08-20T09:00:00Z",
                # No 'timestamp' key — simulates a row returned from DB
                "payload": {},
            }
        ]
        result = compute_feature_vector("cust_2", events, db=None)
        self.assertEqual(result["timestamp"], "2026-08-20T09:00:00Z")

    def test_empty_session_returns_safe_defaults(self):
        """Empty session must never raise — all features default safely."""
        result = compute_feature_vector("cust_3", [], db=None)
        self.assertIn("features", result)
        self.assertIsNone(result["session_id"])
        self.assertIsNone(result["anonymous_id"])
        self.assertEqual(result["features"]["scroll_depth_pct"], 0.0)
        self.assertEqual(result["features"]["tab_switch_count"], 0)
        self.assertFalse(result["features"]["failed_payment_attempt"])


if __name__ == "__main__":
    unittest.main()
