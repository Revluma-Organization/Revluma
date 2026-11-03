"""
Tests for the scheduled business_state_baselines producer.

business_state_baselines had never held a row in production because its only
INSERT sat behind run_historical_ingestion, a CLI cold-start script that nothing
in production invoked. establish_missing_baselines gives it a producer the
automation cycle can claim.

These tests pin two things that are easy to get wrong in either direction:

  * the pass actually writes a baseline when a connected store has real trading
    history, so an empty table is no longer the permanent state;
  * the selection refuses to write a baseline for a store with no observable
    history, so the table is never padded with fabricated zeros to make a count
    look healthy.
"""

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from src.jobs.historical_ingestion import establish_missing_baselines

MODULE = "src.jobs.historical_ingestion"


def _db_with_candidates(rows):
    """A mock session whose candidate-selection query returns `rows`."""
    db = MagicMock()
    db.execute.return_value.fetchall.return_value = rows
    return db


def _selection_sql(db):
    """The SQL text of the first execute() call — the candidate selection."""
    return str(db.execute.call_args[0][0])


class TestBaselineProducerGuards:
    def test_missing_table_is_skipped_without_writing(self):
        """A pending migration must not be reported as a failure or a success."""
        db = MagicMock()
        with patch(f"{MODULE}._table_exists", return_value=False):
            result = establish_missing_baselines(db)

        assert result["status"] == "skipped"
        assert result["established"] == 0
        assert result["refreshed"] == 0
        assert any("Phase 2 migration" in warning for warning in result["warnings"])
        db.commit.assert_not_called()

    def test_no_candidates_completes_cleanly(self):
        db = _db_with_candidates([])
        with patch(f"{MODULE}._table_exists", return_value=True):
            result = establish_missing_baselines(db)

        assert result["status"] == "complete"
        assert result["candidates"] == 0
        assert result["established"] == 0
        db.commit.assert_not_called()


class TestBaselineProducerWrites:
    def test_a_store_without_a_baseline_is_established(self):
        db = _db_with_candidates([("store-new", False)])

        with patch(f"{MODULE}._table_exists", return_value=True), \
             patch(f"{MODULE}._establish_baselines", return_value=True) as establish:
            result = establish_missing_baselines(db)

        assert result["status"] == "complete"
        assert result["established"] == 1
        assert result["refreshed"] == 0
        establish.assert_called_once()
        assert establish.call_args[0][0] == "store-new"
        db.commit.assert_called_once()

    def test_an_existing_baseline_is_refreshed_not_duplicated(self):
        db = _db_with_candidates([("store-old", True)])

        with patch(f"{MODULE}._table_exists", return_value=True), \
             patch(f"{MODULE}._establish_baselines", return_value=True):
            result = establish_missing_baselines(db)

        assert result["refreshed"] == 1
        assert result["established"] == 0
        # One row per organization is enforced by the upsert, not by the caller.
        db.commit.assert_called_once()

    def test_lookback_months_is_forwarded_to_the_computation(self):
        db = _db_with_candidates([("store-x", False)])

        with patch(f"{MODULE}._table_exists", return_value=True), \
             patch(f"{MODULE}._establish_baselines", return_value=True) as establish:
            establish_missing_baselines(db, lookback_months=6)

        assert establish.call_args[0][2] == 6

    def test_a_failing_store_does_not_stop_the_remaining_stores(self):
        db = _db_with_candidates([("store-bad", False), ("store-good", False)])

        with patch(f"{MODULE}._table_exists", return_value=True), \
             patch(
                 f"{MODULE}._establish_baselines",
                 side_effect=[RuntimeError("boom"), True],
             ):
            result = establish_missing_baselines(db)

        assert result["status"] == "partial"
        assert result["established"] == 1
        assert result["failed"] == 1
        db.rollback.assert_called()

    def test_all_stores_failing_is_reported_as_failed(self):
        db = _db_with_candidates([("store-a", False), ("store-b", False)])

        with patch(f"{MODULE}._table_exists", return_value=True), \
             patch(f"{MODULE}._establish_baselines", side_effect=RuntimeError):
            result = establish_missing_baselines(db)

        assert result["status"] == "failed"
        assert result["established"] == 0
        assert result["failed"] == 2

    def test_a_broken_selection_query_fails_without_writing(self):
        db = MagicMock()
        db.execute.side_effect = RuntimeError("selection exploded")

        with patch(f"{MODULE}._table_exists", return_value=True):
            result = establish_missing_baselines(db)

        assert result["status"] == "failed"
        assert result["established"] == 0
        db.rollback.assert_called()
        db.commit.assert_not_called()


class TestBaselineProducerBounds:
    def test_limit_is_passed_to_the_query(self):
        db = _db_with_candidates([])
        with patch(f"{MODULE}._table_exists", return_value=True):
            establish_missing_baselines(db, limit=3)

        assert db.execute.call_args[0][1]["limit"] == 3

    def test_limit_is_clamped_so_a_pass_stays_bounded(self):
        db = _db_with_candidates([])
        with patch(f"{MODULE}._table_exists", return_value=True):
            establish_missing_baselines(db, limit=100000)

        assert db.execute.call_args[0][1]["limit"] == 50

    def test_an_invalid_limit_falls_back_to_the_default(self):
        db = _db_with_candidates([])
        with patch(f"{MODULE}._table_exists", return_value=True):
            establish_missing_baselines(db, limit=-5)

        assert db.execute.call_args[0][1]["limit"] == 5

    def test_an_invalid_refresh_window_falls_back_to_the_default(self):
        db = _db_with_candidates([])
        with patch(f"{MODULE}._table_exists", return_value=True):
            establish_missing_baselines(db, refresh_after_days=0)

        assert db.execute.call_args[0][1]["refresh_days"] == 7


class TestBaselineSelectionIsHonest:
    """
    The selection query is the only thing standing between this job and a table
    full of meaningless zero baselines, so its guards are asserted directly.
    """

    def _sql(self):
        db = _db_with_candidates([])
        with patch(f"{MODULE}._table_exists", return_value=True):
            establish_missing_baselines(db)
        return _selection_sql(db)

    def test_only_connected_stores_that_have_synced_are_considered(self):
        sql = self._sql()
        assert "store.platform = 'shopify'" in sql
        assert "store.status IN ('active', 'connected')" in sql
        assert "store.last_synced_at IS NOT NULL" in sql

    def test_a_store_with_no_trading_history_gets_no_baseline(self):
        """
        Without this gate, an organization with zero orders would receive a
        baseline of zeros — a fabricated record that looks like real history.
        """
        sql = self._sql()
        assert "EXISTS" in sql
        assert "FROM orders AS order_row" in sql
        assert "FROM abandoned_carts AS cart" in sql

    def test_a_recent_baseline_is_not_recomputed(self):
        sql = self._sql()
        assert "baseline.computed_at IS NULL" in sql
        assert "INTERVAL '1 day'" in sql

    def test_baselines_are_scoped_by_the_stores_own_organization(self):
        """Tenant isolation: the join key must be the store's organization."""
        sql = self._sql()
        assert "baseline.organization_id = store.organization_id" in sql
        assert "store.organization_id IS NOT NULL" in sql

    def test_the_oldest_and_missing_baselines_are_served_first(self):
        sql = self._sql()
        assert "ORDER BY baseline.computed_at ASC NULLS FIRST" in sql

    def test_every_value_is_parameterised(self):
        sql = self._sql()
        assert ":refresh_days" in sql
        assert ":lookback_days" in sql
        assert ":limit" in sql
