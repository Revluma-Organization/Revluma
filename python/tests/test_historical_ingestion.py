"""
Unit tests for P2-B -- Day 1 Cold-Start Historical Ingestion
Tests run_historical_ingestion and all four internal steps.
"""

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import pytest
from src.jobs.historical_ingestion import (
    OptionalTableUnavailable,
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
        """A failed step rolls back and later steps still run."""
        with patch("src.jobs.historical_ingestion._backfill_rfm_scores", return_value=5), \
             patch("src.jobs.historical_ingestion._establish_baselines", side_effect=RuntimeError), \
             patch("src.jobs.historical_ingestion._seed_strategic_memory", return_value=2), \
             patch("src.jobs.historical_ingestion._snapshot_segment_distribution"):
            db = MagicMock()
            result = run_historical_ingestion("store-002", db)

        assert result["status"] == "partial"
        db.rollback.assert_called_once()
        assert db.commit.call_count == 2

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

    def test_invalid_lookback_fails_without_touching_database(self):
        db = MagicMock()

        result = run_historical_ingestion("store-006", db, lookback_months=0)

        assert result["status"] == "failed"
        db.execute.assert_not_called()


class TestHistoricalIngestionSteps:

    def test_rfm_backfill_delegates_to_canonical_job(self):
        with patch(
            "src.jobs.historical_ingestion.run_rfm_sync",
            return_value={"processed_count": 7, "failed_customer_ids": []},
        ) as rfm_sync:
            processed = _backfill_rfm_scores("store-rfm")

        assert processed == 7
        rfm_sync.assert_called_once_with("store-rfm")

    def test_rfm_backfill_rejects_partial_customer_failures(self):
        with patch(
            "src.jobs.historical_ingestion.run_rfm_sync",
            return_value={"processed_count": 2, "failed_customer_ids": ["hidden-id"]},
        ):
            with pytest.raises(RuntimeError, match="1 customers"):
                _backfill_rfm_scores("store-rfm")

    def test_missing_baseline_table_is_reported_explicitly(self):
        db = MagicMock()
        db.execute.return_value.scalar.return_value = False

        with pytest.raises(OptionalTableUnavailable):
            _establish_baselines("store-007", db, 12)

    def test_baseline_queries_use_canonical_order_columns(self):
        db = MagicMock()
        statements = []

        def execute(statement, _params=None):
            sql = str(statement)
            statements.append(sql)
            result = MagicMock()
            if "to_regclass" in sql:
                result.scalar.return_value = True
            elif "SELECT organization_id" in sql:
                result.scalar.return_value = "organisation-id"
            elif "WITH daily_revenue" in sql and "STDDEV_SAMP" not in sql:
                result.fetchone.return_value = (100.0, 90.0)
            elif "STDDEV_SAMP" in sql:
                result.fetchall.return_value = []
            else:
                result.scalar.return_value = 0
            return result

        db.execute.side_effect = execute

        assert _establish_baselines("store-008", db, 12) is True
        combined_sql = "\n".join(statements)
        assert "ordered_at" in combined_sql
        assert "SUM(total)" in combined_sql
        assert "total_price" not in combined_sql

    def test_strategic_memory_uses_existing_memory_table(self):
        db = MagicMock()
        insert_statements = []

        def execute(statement, _params=None):
            sql = str(statement)
            result = MagicMock()
            if "SELECT organization_id" in sql:
                result.scalar.return_value = "organisation-id"
            elif "EXTRACT(DOW" in sql:
                result.fetchone.return_value = (1, 500.0)
            elif "to_regclass" in sql:
                result.scalar.return_value = False
            elif "EXTRACT(HOUR" in sql:
                result.fetchone.return_value = (14, 3)
            elif "INSERT INTO merchant_memories" in sql:
                insert_statements.append(sql)
            return result

        db.execute.side_effect = execute

        assert _seed_strategic_memory("store-009", db, 12) == 2
        assert len(insert_statements) == 2
        assert all("memory_type" in sql for sql in insert_statements)
