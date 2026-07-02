"""
Unit tests for event_processor.py
Framework: unittest (stdlib only, no external dependencies)

Each function tested for:
    1. Normal case (valid events)
    2. Empty input
    3. Malformed input (missing keys, invalid timestamps, corrupted payload)
"""

import unittest
import sys
import os

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from src.features.event_processor import (
    parse_raw_event,
    filter_events_by_type,
    extract_session_timeline,
    detect_platform,
    normalize_checkout_step,
    group_events_by_session,
)


class TestParseRawEvent(unittest.TestCase):

    def test_valid_payload(self):
        payload = {
            "event_type": "scroll_depth",
            "session_id": "sess_1",
            "timestamp": "2026-06-26T10:00:00Z",
            "payload": {"depth_pct": 45.0}
        }
        result = parse_raw_event(payload)
        self.assertEqual(result["event_type"], "scroll_depth")
        self.assertEqual(result["session_id"], "sess_1")
        self.assertTrue(result["_valid"])

    def test_missing_event_type(self):
        payload = {"session_id": "sess_1", "timestamp": "2026-06-26T10:00:00Z"}
        result = parse_raw_event(payload)
        self.assertEqual(result["event_type"], "unknown")
        self.assertFalse(result["_valid"])

    def test_missing_timestamp(self):
        payload = {"event_type": "scroll_depth", "session_id": "sess_1"}
        result = parse_raw_event(payload)
        self.assertIsNone(result["timestamp"])
        self.assertFalse(result["_valid"])

    def test_empty_dict(self):
        result = parse_raw_event({})
        self.assertEqual(result["event_type"], "unknown")
        self.assertFalse(result["_valid"])
        self.assertEqual(result["payload"], {})

    def test_non_dict_input(self):
        result = parse_raw_event("not a dict")
        self.assertEqual(result["event_type"], "unknown")
        self.assertFalse(result["_valid"])

    def test_none_input(self):
        result = parse_raw_event(None)
        self.assertEqual(result["event_type"], "unknown")
        self.assertFalse(result["_valid"])

    def test_invalid_timestamp_format(self):
        payload = {
            "event_type": "scroll_depth",
            "session_id": "sess_1",
            "timestamp": "not-a-real-timestamp"
        }
        result = parse_raw_event(payload)
        self.assertFalse(result["_valid"])

    def test_corrupted_payload_field(self):
        payload = {
            "event_type": "scroll_depth",
            "session_id": "sess_1",
            "timestamp": "2026-06-26T10:00:00Z",
            "payload": "not a dict"
        }
        result = parse_raw_event(payload)
        self.assertEqual(result["payload"], {})

    def test_never_raises(self):
        # Should never throw regardless of weird input types
        try:
            parse_raw_event(12345)
            parse_raw_event([1, 2, 3])
            parse_raw_event(object())
        except Exception as e:
            self.fail(f"parse_raw_event raised an exception: {e}")


class TestFilterEventsByType(unittest.TestCase):

    def test_normal_filter(self):
        events = [
            {"event_type": "scroll_depth"},
            {"event_type": "tab_switch"},
            {"event_type": "scroll_depth"}
        ]
        result = filter_events_by_type(events, "scroll_depth")
        self.assertEqual(len(result), 2)

    def test_empty_list(self):
        result = filter_events_by_type([], "scroll_depth")
        self.assertEqual(result, [])

    def test_no_matches(self):
        events = [{"event_type": "tab_switch"}]
        result = filter_events_by_type(events, "scroll_depth")
        self.assertEqual(result, [])

    def test_malformed_events_list(self):
        events = ["not a dict", None, {"event_type": "scroll_depth"}, 42]
        result = filter_events_by_type(events, "scroll_depth")
        self.assertEqual(len(result), 1)

    def test_non_list_input(self):
        result = filter_events_by_type("not a list", "scroll_depth")
        self.assertEqual(result, [])

    def test_none_input(self):
        result = filter_events_by_type(None, "scroll_depth")
        self.assertEqual(result, [])


class TestExtractSessionTimeline(unittest.TestCase):

    def test_normal_case(self):
        events = [
            {"event_type": "session_start", "timestamp": "2026-06-26T10:00:00Z"},
            {"event_type": "checkout_step", "timestamp": "2026-06-26T10:01:00Z"},
            {"event_type": "tab_switch", "timestamp": "2026-06-26T10:02:00Z",
             "payload": {"direction": "blur"}},
            {"event_type": "exit_intent", "timestamp": "2026-06-26T10:03:00Z"},
            {"event_type": "failed_payment", "timestamp": "2026-06-26T10:04:00Z"},
        ]
        result = extract_session_timeline(events)
        self.assertEqual(result["session_start"], "2026-06-26T10:00:00Z")
        self.assertEqual(result["session_end"], "2026-06-26T10:04:00Z")
        self.assertEqual(len(result["checkout_steps"]), 1)
        self.assertEqual(len(result["tab_hidden_events"]), 1)
        self.assertEqual(result["exit_intent_at"], "2026-06-26T10:03:00Z")
        self.assertEqual(result["payment_failed_at"], "2026-06-26T10:04:00Z")

    def test_empty_list(self):
        result = extract_session_timeline([])
        self.assertIsNone(result["session_start"])
        self.assertIsNone(result["session_end"])
        self.assertEqual(result["checkout_steps"], [])

    def test_malformed_events(self):
        events = ["garbage", None, {"event_type": "checkout_step"}, 42]
        result = extract_session_timeline(events)
        # Should not raise — missing timestamp means session_start/end stay None
        self.assertIsNone(result["session_start"])
        self.assertEqual(len(result["checkout_steps"]), 1)

    def test_mixed_valid_and_invalid_timestamps(self):
        events = [
            {"event_type": "session_start", "timestamp": "garbage-timestamp"},
            {"event_type": "checkout_step", "timestamp": "2026-06-26T10:00:00Z"},
        ]
        try:
            result = extract_session_timeline(events)
        except Exception as e:
            self.fail(f"extract_session_timeline raised: {e}")
        self.assertEqual(result["session_start"], "2026-06-26T10:00:00Z")

    def test_none_input(self):
        result = extract_session_timeline(None)
        self.assertIsNone(result["session_start"])


class TestDetectPlatform(unittest.TestCase):

    class MockCursor:
        def __init__(self, return_value=None, raise_exception=False):
            self.return_value = return_value
            self.raise_exception = raise_exception

        def execute(self, query, params):
            if self.raise_exception:
                raise Exception("DB connection failed")

        def fetchone(self):
            return self.return_value

    class MockDB:
        def __init__(self, cursor):
            self._cursor = cursor

        def cursor(self):
            return self._cursor

    def test_normal_case_shopify(self):
        mock_cursor = self.MockCursor(return_value=("shopify",))
        db = self.MockDB(mock_cursor)
        result = detect_platform("merchant_123", db)
        self.assertEqual(result, "shopify")

    def test_no_row_found(self):
        mock_cursor = self.MockCursor(return_value=None)
        db = self.MockDB(mock_cursor)
        result = detect_platform("merchant_999", db)
        self.assertEqual(result, "unknown")

    def test_db_exception(self):
        mock_cursor = self.MockCursor(raise_exception=True)
        db = self.MockDB(mock_cursor)
        try:
            result = detect_platform("merchant_123", db)
        except Exception as e:
            self.fail(f"detect_platform raised: {e}")
        self.assertEqual(result, "unknown")

    def test_invalid_platform_value(self):
        mock_cursor = self.MockCursor(return_value=("magento",))
        db = self.MockDB(mock_cursor)
        result = detect_platform("merchant_123", db)
        self.assertEqual(result, "unknown")

    def test_none_db(self):
        result = detect_platform("merchant_123", None)
        self.assertEqual(result, "unknown")

    def test_none_merchant_id(self):
        mock_cursor = self.MockCursor(return_value=("shopify",))
        db = self.MockDB(mock_cursor)
        result = detect_platform(None, db)
        self.assertEqual(result, "unknown")


class TestNormalizeCheckoutStep(unittest.TestCase):

    def test_shopify_mapping(self):
        self.assertEqual(normalize_checkout_step("shopify", "shipping_method"), 3)
        self.assertEqual(normalize_checkout_step("shopify", "payment_method"), 4)

    def test_woocommerce_mapping(self):
        self.assertEqual(normalize_checkout_step("woocommerce", "shipping"), 3)
        self.assertEqual(normalize_checkout_step("woocommerce", "payment"), 4)

    def test_already_normalized_int(self):
        self.assertEqual(normalize_checkout_step("shopify", 3), 3)
        self.assertEqual(normalize_checkout_step("woocommerce", 0), 0)

    def test_unknown_step_string(self):
        self.assertEqual(normalize_checkout_step("shopify", "made_up_step"), 0)

    def test_unknown_platform(self):
        self.assertEqual(normalize_checkout_step("magento", "cart"), 0)

    def test_none_inputs(self):
        self.assertEqual(normalize_checkout_step(None, None), 0)
        self.assertEqual(normalize_checkout_step("shopify", None), 0)

    def test_deterministic(self):
        # Same input always produces same output
        result1 = normalize_checkout_step("shopify", "cart")
        result2 = normalize_checkout_step("shopify", "cart")
        self.assertEqual(result1, result2)

    def test_out_of_range_int(self):
        # int outside 0-5 range should not be returned as-is
        self.assertEqual(normalize_checkout_step("shopify", 99), 0)


class TestGroupEventsBySession(unittest.TestCase):

    def test_multiple_sessions(self):
        events = [
            {"event_type": "a", "session_id": "s1", "timestamp": "2026-06-26T10:01:00Z"},
            {"event_type": "b", "session_id": "s2", "timestamp": "2026-06-26T10:00:00Z"},
            {"event_type": "c", "session_id": "s1", "timestamp": "2026-06-26T10:00:00Z"},
        ]
        result = group_events_by_session(events)
        self.assertEqual(len(result), 2)
        self.assertEqual(len(result["s1"]), 2)
        # Verify sorted ascending within session
        self.assertEqual(result["s1"][0]["event_type"], "c")
        self.assertEqual(result["s1"][1]["event_type"], "a")

    def test_missing_session_id(self):
        events = [
            {"event_type": "a", "timestamp": "2026-06-26T10:00:00Z"},
            {"event_type": "b", "session_id": "", "timestamp": "2026-06-26T10:00:00Z"},
        ]
        result = group_events_by_session(events)
        self.assertIn("__no_session__", result)
        self.assertEqual(len(result["__no_session__"]), 2)

    def test_empty_list(self):
        result = group_events_by_session([])
        self.assertEqual(result, {})

    def test_malformed_events(self):
        events = ["garbage", None, 42, {"event_type": "a", "session_id": "s1"}]
        try:
            result = group_events_by_session(events)
        except Exception as e:
            self.fail(f"group_events_by_session raised: {e}")
        self.assertIn("s1", result)

    def test_none_input(self):
        result = group_events_by_session(None)
        self.assertEqual(result, {})


if __name__ == "__main__":
    unittest.main()