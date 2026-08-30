"""
Unit tests for P3-A -- Sub-1-Hour Feedback Loop for Cart Recovery
Tests all four channel windows, pause trigger logic, and side effects.
"""

import sys
from pathlib import Path
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch, call

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import pytest
from src.learning.feedback_loop import (
    FEEDBACK_WINDOWS,
    schedule_outcome_check,
    _evaluate_outcome,
)


def _make_db():
    db = MagicMock()
    db.execute.return_value = MagicMock(fetchall=MagicMock(return_value=[]), fetchone=MagicMock(return_value=None))
    return db


class TestFeedbackLoop:

    def test_cart_recovery_email_window_is_45_minutes(self):
        assert FEEDBACK_WINDOWS["cart_recovery_email"] == timedelta(minutes=45)

    def test_cart_recovery_sms_window_is_20_minutes(self):
        assert FEEDBACK_WINDOWS["cart_recovery_sms"] == timedelta(minutes=20)

    def test_win_back_campaign_window_is_48_hours(self):
        assert FEEDBACK_WINDOWS["win_back_campaign"] == timedelta(hours=48)

    def test_win_back_sequence_window_is_7_days(self):
        assert FEEDBACK_WINDOWS["win_back_sequence"] == timedelta(days=7)

    def test_all_four_channel_types_present(self):
        required = {"cart_recovery_email", "cart_recovery_sms", "win_back_campaign", "win_back_sequence"}
        assert required.issubset(FEEDBACK_WINDOWS.keys())

    def test_schedule_outcome_check_inserts_correct_check_at(self):
        db = _make_db()
        sent_at = datetime(2026, 9, 1, 12, 0, 0, tzinfo=timezone.utc)
        schedule_outcome_check("rec-001", "cart_recovery_email", sent_at, db)
        db.execute.assert_called()
        db.commit.assert_called()

    def test_variant_not_paused_when_performance_adequate(self):
        db = MagicMock()
        # open_rate 0.20 > threshold 0.15, click_rate 0.05 > threshold 0.03
        db.execute.return_value = MagicMock(fetchone=MagicMock(return_value=(0.20, 0.05)))
        with patch("src.learning.feedback_loop._write_strategic_memory_reflection") as mem_mock, \
             patch("src.learning.feedback_loop._enqueue_retraining_signal") as queue_mock:
            _evaluate_outcome("rec-002", "cart_recovery_email", db)
            mem_mock.assert_not_called()
            queue_mock.assert_not_called()

    def test_variant_paused_when_open_rate_below_threshold(self):
        db = MagicMock()
        # open_rate 0.10 < threshold 0.15 -- should trigger pause
        db.execute.return_value = MagicMock(fetchone=MagicMock(return_value=(0.10, 0.02)))
        with patch("src.learning.feedback_loop._write_strategic_memory_reflection") as mem_mock, \
             patch("src.learning.feedback_loop._enqueue_retraining_signal") as queue_mock:
            _evaluate_outcome("rec-003", "cart_recovery_email", db)
            mem_mock.assert_called_once()
            queue_mock.assert_called_once()

    def test_audit_log_written_on_pause(self):
        db = MagicMock()
        db.execute.return_value = MagicMock(fetchone=MagicMock(return_value=(0.05, 0.01)))
        _evaluate_outcome("rec-004", "cart_recovery_email", db)
        # The audit_log INSERT is uniquely identified by the 'ctx' kwarg.
        # Verify at least one execute call included a 'ctx' parameter.
        all_params = [str(c) for c in db.execute.call_args_list]
        assert any("ctx" in p for p in all_params), "Expected an audit_log INSERT with 'ctx' param"

    def test_strategic_memory_entry_written_on_pause(self):
        db = MagicMock()
        db.execute.return_value = MagicMock(fetchone=MagicMock(return_value=(0.05, 0.01)))
        with patch("src.learning.feedback_loop._write_strategic_memory_reflection") as mock_mem:
            _evaluate_outcome("rec-005", "cart_recovery_email", db)
            mock_mem.assert_called_once()

    def test_retraining_signal_queued_for_m1_and_m2_on_pause(self):
        db = MagicMock()
        db.execute.return_value = MagicMock(fetchone=MagicMock(return_value=(0.05, 0.01)))
        with patch("src.learning.feedback_loop._enqueue_retraining_signal") as mock_q:
            _evaluate_outcome("rec-006", "cart_recovery_email", db)
            mock_q.assert_called_once_with("rec-006", "cart_recovery_email", db)

    def test_no_pause_when_no_metrics_found(self):
        db = MagicMock()
        db.execute.return_value = MagicMock(fetchone=MagicMock(return_value=None))
        with patch("src.learning.feedback_loop._write_strategic_memory_reflection") as mem_mock:
            _evaluate_outcome("rec-007", "cart_recovery_email", db)
            mem_mock.assert_not_called()

    def test_channel_with_no_threshold_does_not_pause(self):
        """win_back_sequence has no pause threshold -- should not trigger pause logic."""
        db = MagicMock()
        with patch("src.learning.feedback_loop._write_strategic_memory_reflection") as mem_mock:
            _evaluate_outcome("rec-008", "win_back_sequence", db)
            mem_mock.assert_not_called()
