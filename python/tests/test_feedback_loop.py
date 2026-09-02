"""
Unit tests for P3-A -- Sub-1-Hour Feedback Loop for Cart Recovery
Tests all four channel windows, pause trigger logic, and side effects.
"""

import sys
from pathlib import Path
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import pytest
from src.learning.feedback_loop import (
    FEEDBACK_WINDOWS,
    _enqueue_retraining_signals,
    _evaluate_outcome,
    _write_audit_log,
    run_due_outcome_checks,
    schedule_outcome_check,
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

    def test_schedule_rejects_unknown_channel(self):
        with pytest.raises(ValueError, match="Unsupported feedback channel"):
            schedule_outcome_check(
                "rec-unknown",
                "unknown",
                datetime.now(timezone.utc),
                MagicMock(),
            )

    def test_variant_not_paused_when_performance_adequate(self):
        db = MagicMock()
        with patch("src.learning.feedback_loop._load_delivery_metrics", return_value=(100, 20, 5)), \
             patch("src.learning.feedback_loop._upsert_outcome", return_value="outcome-id"), \
             patch("src.learning.feedback_loop._write_strategic_memory_reflection") as mem_mock, \
             patch("src.learning.feedback_loop._enqueue_retraining_signals") as queue_mock:
            _evaluate_outcome(
                "rec-002",
                "cart_recovery_email",
                db,
                organization_id="organisation-id",
            )
            mem_mock.assert_not_called()
            queue_mock.assert_not_called()

    def test_variant_paused_when_open_rate_below_threshold(self):
        db = MagicMock()
        with patch("src.learning.feedback_loop._load_delivery_metrics", return_value=(100, 10, 2)), \
             patch("src.learning.feedback_loop._upsert_outcome", return_value="outcome-id"), \
             patch("src.learning.feedback_loop._write_audit_log") as audit_mock, \
             patch("src.learning.feedback_loop._write_strategic_memory_reflection") as mem_mock, \
             patch("src.learning.feedback_loop._enqueue_retraining_signals") as queue_mock:
            _evaluate_outcome(
                "rec-003",
                "cart_recovery_email",
                db,
                organization_id="organisation-id",
            )
            audit_mock.assert_called_once()
            mem_mock.assert_called_once()
            queue_mock.assert_called_once()

    def test_audit_log_written_on_pause(self):
        db = MagicMock()
        _write_audit_log(
            "rec-004",
            "organisation-id",
            "cart_recovery_email",
            "open_rate_below_threshold",
            {"open_rate": 0.05},
            datetime.now(timezone.utc),
            db,
        )

        statement = str(db.execute.call_args.args[0])
        assert "INSERT INTO audit_logs" in statement
        assert "organization_id" in statement

    def test_strategic_memory_entry_written_on_pause(self):
        db = MagicMock()
        with patch("src.learning.feedback_loop._load_delivery_metrics", return_value=(100, 5, 1)), \
             patch("src.learning.feedback_loop._upsert_outcome", return_value="outcome-id"), \
             patch("src.learning.feedback_loop._write_audit_log"), \
             patch("src.learning.feedback_loop._write_strategic_memory_reflection") as mock_mem, \
             patch("src.learning.feedback_loop._enqueue_retraining_signals"):
            _evaluate_outcome(
                "rec-005",
                "cart_recovery_email",
                db,
                organization_id="organisation-id",
            )
            mock_mem.assert_called_once()

    def test_retraining_signal_queued_for_m1_and_m2_on_pause(self):
        db = MagicMock()
        _enqueue_retraining_signals(
            "rec-006",
            "outcome-id",
            "organisation-id",
            "cart_recovery_email",
            {"open_rate": 0.05, "click_rate": 0.01},
            db,
        )

        assert db.execute.call_count == 2
        model_names = {call.args[1]["model_name"] for call in db.execute.call_args_list}
        assert model_names == {"m1_abandonment", "m2_sensitivity"}

    def test_no_pause_when_no_metrics_found(self):
        db = MagicMock()
        with patch("src.learning.feedback_loop._load_delivery_metrics", return_value=(0, 0, 0)), \
             patch("src.learning.feedback_loop._upsert_outcome", return_value="outcome-id"), \
             patch("src.learning.feedback_loop._write_strategic_memory_reflection") as mem_mock:
            _evaluate_outcome(
                "rec-007",
                "cart_recovery_email",
                db,
                organization_id="organisation-id",
            )
            mem_mock.assert_not_called()

    def test_channel_with_no_threshold_does_not_pause(self):
        """win_back_sequence has no pause threshold -- should not trigger pause logic."""
        db = MagicMock()
        with patch("src.learning.feedback_loop._load_delivery_metrics", return_value=(10, 0, 0)), \
             patch("src.learning.feedback_loop._upsert_outcome", return_value="outcome-id"), \
             patch("src.learning.feedback_loop._write_strategic_memory_reflection") as mem_mock:
            _evaluate_outcome(
                "rec-008",
                "win_back_sequence",
                db,
                organization_id="organisation-id",
            )
            mem_mock.assert_not_called()

    def test_due_worker_commits_one_atomic_recommendation(self):
        db = MagicMock()
        due = ("rec-009", "organisation-id", "cart_recovery_sms")
        with patch("src.learning.feedback_loop._require_feedback_persistence"), \
             patch("src.learning.feedback_loop._claim_one_due_recommendation", side_effect=[due, None]), \
             patch("src.learning.feedback_loop._evaluate_outcome") as evaluate:
            processed = run_due_outcome_checks(db, limit=2)

        assert processed == 1
        evaluate.assert_called_once()
        db.commit.assert_called_once()
        db.rollback.assert_called_once()

    def test_due_worker_rolls_back_failed_recommendation(self):
        db = MagicMock()
        due = ("rec-010", "organisation-id", "cart_recovery_email")
        with patch("src.learning.feedback_loop._require_feedback_persistence"), \
             patch("src.learning.feedback_loop._claim_one_due_recommendation", return_value=due), \
             patch("src.learning.feedback_loop._evaluate_outcome", side_effect=RuntimeError):
            processed = run_due_outcome_checks(db, limit=1)

        assert processed == 0
        db.commit.assert_not_called()
        db.rollback.assert_called_once()
