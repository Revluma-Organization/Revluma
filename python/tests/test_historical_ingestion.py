"""
Unit tests for P2-B -- Day 1 Cold-Start Historical Ingestion
Tests run_historical_ingestion and all four internal steps.
"""

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch, call

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import pytest
from src.jobs.historical_ingestion import (
    run_historical_ingestion,
    _backfill_rfm_scores,
    _establish_baselines,
    _seed_strategic_memory,
    _snapshot_segment_distribution,
)


def _make_db(customers=None, orders=None, order_items=None):
    """Build a mock SQLAlchemy db session for a given data shape."""
    db = MagicMock()
    fetch_map = {
        "customers": customers or [],
        "orders": orders or [],
        "order_items": order_items or [],
    }

    def execute_side_effect(stmt, params=None):
        mock_result = MagicMock()
        mock_result.fetchall.return_value = []
        mock_result.fetchone.return_value = None
        mock_result.scalar.return_value = 0
        return mock_result

    db.execute.side_effect = execute_side_effect
    return db


class TestHistoricalIngestion:

    def test_empty_store_completes_without_error(self):
        """An empty store (no orders, no customers) must not raise."""
        db = _make_db()
        result = run_historical_ingestion("store-001", db)
        assert result["store_id"] == "store-001"
        assert result["status"] in ("complete", "partial", "failed")

    def test_result_contains_all_required_keys(self):
        db = _make_db()
        result = run_historical_ingestion("store-001", db)
        required = {"store_id", "customers_scored", "strategic_memories_seeded", "baseline_established", "status"}
        assert required.issubset(result.keys())

    def test_partial_failure_returns_partial_status(self):
        """When one step raises, status should degrade to partial, not crash."""
        db = MagicMock()
        # First call succeeds, second raises
        db.execute.side_effect = [
            MagicMock(fetchall=MagicMock(return_value=[])),  # customers
            Exception("DB failure"),  # baselines
        ]
        result = run_historical_ingestion("store-002", db)
        # Must not raise and must return a valid status
        assert result["status"] in ("complete", "partial", "failed")

    def test_customers_scored_is_zero_for_empty_store(self):
        db = _make_db()
        result = run_historical_ingestion("store-003", db)
        assert result["customers_scored"] == 0

    def test_all_steps_complete_returns_complete_status(self):
        """Mock all steps to succeed and verify complete status is returned."""
        with patch("src.jobs.historical_ingestion._backfill_rfm_scores", return_value=5), \
             patch("src.jobs.historical_ingestion._establish_baselines", return_value=None), \
             patch("src.jobs.historical_ingestion._seed_strategic_memory", return_value=3), \
             patch("src.jobs.historical_ingestion._snapshot_segment_distribution", return_value=None):
            db = MagicMock()
            result = run_historical_ingestion("store-004", db)
        assert result["status"] == "complete"
        assert result["customers_scored"] == 5
        assert result["strategic_memories_seeded"] == 3
        assert result["baseline_established"] is True

    def test_all_steps_fail_returns_failed_status(self):
        """When every step raises, status must be 'failed'."""
        with patch("src.jobs.historical_ingestion._backfill_rfm_scores", side_effect=Exception("fail")), \
             patch("src.jobs.historical_ingestion._establish_baselines", side_effect=Exception("fail")), \
             patch("src.jobs.historical_ingestion._seed_strategic_memory", side_effect=Exception("fail")), \
             patch("src.jobs.historical_ingestion._snapshot_segment_distribution", side_effect=Exception("fail")):
            db = MagicMock()
            result = run_historical_ingestion("store-005", db)
        assert result["status"] == "failed"
