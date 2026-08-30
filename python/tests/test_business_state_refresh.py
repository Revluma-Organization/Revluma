"""
Unit tests for P2-A -- Dynamic Business State Refresh
Tests the _get_next_rebuild_interval function in business_state.py.
"""

import sys
from pathlib import Path
from datetime import timedelta

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import pytest
from src.intelligence.business_state import _get_next_rebuild_interval, TRAFFIC_THRESHOLDS


class TestBusinessStateRefresh:

    def test_normal_load_returns_15_minutes(self):
        result = _get_next_rebuild_interval(current_event_rate=10, baseline_rate=10)
        assert result == timedelta(minutes=15)

    def test_elevated_load_returns_5_minutes(self):
        result = _get_next_rebuild_interval(current_event_rate=20, baseline_rate=10)
        assert result == timedelta(minutes=5)

    def test_spike_load_returns_1_minute(self):
        result = _get_next_rebuild_interval(current_event_rate=50, baseline_rate=10)
        assert result == timedelta(minutes=1)

    def test_boundary_exactly_2x_baseline_returns_5_minutes(self):
        result = _get_next_rebuild_interval(current_event_rate=20, baseline_rate=10)
        assert result == timedelta(minutes=5)

    def test_boundary_exactly_5x_baseline_returns_1_minute(self):
        result = _get_next_rebuild_interval(current_event_rate=50, baseline_rate=10)
        assert result == timedelta(minutes=1)

    def test_zero_baseline_does_not_raise_division_error(self):
        # A new merchant with no history must not cause a ZeroDivisionError.
        result = _get_next_rebuild_interval(current_event_rate=0, baseline_rate=0)
        assert result == timedelta(minutes=15)

    def test_just_below_2x_stays_normal(self):
        # 1.9x ratio should not trigger elevated
        result = _get_next_rebuild_interval(current_event_rate=19, baseline_rate=10)
        assert result == timedelta(minutes=15)

    def test_just_below_5x_stays_elevated(self):
        # 4.9x ratio should not trigger spike
        result = _get_next_rebuild_interval(current_event_rate=49, baseline_rate=10)
        assert result == timedelta(minutes=5)
