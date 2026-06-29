import pytest
from src.features.pipeline import (
    calculate_scroll_depth,
    calculate_tab_switch_count,
    calculate_cursor_hesitation,
    calculate_checkout_step_reached,
    calculate_failed_payment_attempt,
    calculate_local_hour_of_session,
    calculate_day_of_week_session,
    calculate_time_on_page_ms
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
        {"event_type": "exit_intent"},
        {"event_type": "scroll"},
        {"event_type": "exit_intent"}
    ]
    assert calculate_cursor_hesitation(events) == 2

def test_cursor_hesitation_empty():
    assert calculate_cursor_hesitation([]) == 0

def test_cursor_hesitation_malformed():
    events = [None, 123, {"event_type": None}, {"no_event_type": "exit_intent"}]
    assert calculate_cursor_hesitation(events) == 0


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
