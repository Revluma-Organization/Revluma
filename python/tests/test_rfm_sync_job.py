import unittest
from unittest.mock import MagicMock, patch
from src.jobs.rfm_sync import (
    get_rfm_segment,
    calculate_rfm_for_all_customers,
    _process_single_customer,
    run
)

class TestRfmSyncJob(unittest.TestCase):

    def test_get_rfm_segment_champion(self):
        # all 4-5 = champion
        self.assertEqual(get_rfm_segment(4, 4, 4), "champion")
        self.assertEqual(get_rfm_segment(5, 5, 5), "champion")
        self.assertEqual(get_rfm_segment(4, 5, 4), "champion")

    def test_get_rfm_segment_loyal(self):
        # f>=3 AND r>=3 = loyal (and not champion)
        self.assertEqual(get_rfm_segment(3, 3, 5), "loyal")
        self.assertEqual(get_rfm_segment(5, 3, 1), "loyal")
        self.assertEqual(get_rfm_segment(3, 5, 1), "loyal")

    def test_get_rfm_segment_at_risk(self):
        # r<=2 AND f>=3 = at_risk
        self.assertEqual(get_rfm_segment(2, 3, 5), "at_risk")
        self.assertEqual(get_rfm_segment(1, 5, 1), "at_risk")
        self.assertEqual(get_rfm_segment(2, 4, 3), "at_risk")

    def test_get_rfm_segment_hibernating(self):
        # r<=2 AND f<=2 AND m>=2 = hibernating
        self.assertEqual(get_rfm_segment(2, 2, 2), "hibernating")
        self.assertEqual(get_rfm_segment(1, 1, 5), "hibernating")
        self.assertEqual(get_rfm_segment(2, 1, 3), "hibernating")

    def test_get_rfm_segment_lost(self):
        # else = lost
        # e.g., r=3, f=2 (doesn't fit loyal or at_risk or hibernating)
        self.assertEqual(get_rfm_segment(3, 2, 5), "lost")
        # e.g., r<=2, f<=2, m<2
        self.assertEqual(get_rfm_segment(2, 2, 1), "lost")
        self.assertEqual(get_rfm_segment(1, 1, 1), "lost")

    @patch("src.jobs.rfm_sync.calculate_rfm_scores")
    def test_per_customer_failure_does_not_abort_batch(self, mock_calc):
        mock_db = MagicMock()
        mock_cursor = MagicMock()
        mock_db.cursor.return_value = mock_cursor
        
        mock_cursor.fetchall.return_value = [("cust-1",), ("cust-2",)]
        
        def side_effect(customer_id, db):
            if customer_id == "cust-1":
                raise Exception("Simulated database error")
            return {
                "rfm_recency_score": 5,
                "rfm_frequency_score": 5,
                "rfm_monetary_score": 5,
                "days_since_last_purchase": 10,
                "past_orders_total": 20,
                "avg_order_value": 100
            }
            
        mock_calc.side_effect = side_effect
        
        result = calculate_rfm_for_all_customers("store-123", mock_db)
        
        self.assertEqual(result["processed_count"], 1)
        self.assertEqual(result["failed_customer_ids"], ["cust-1"])
        self.assertEqual(result["failed_count"], 1)
        self.assertFalse(result["success"])
        self.assertEqual(result["segment_distribution"]["champion"], 1)
        
        calls = mock_cursor.execute.call_args_list
        savepoint_calls = [c for c in calls if c[0] and c[0][0] == "SAVEPOINT sp_customer"]
        rollback_calls = [c for c in calls if c[0] and c[0][0] == "ROLLBACK TO SAVEPOINT sp_customer"]
        release_calls = [c for c in calls if c[0] and c[0][0] == "RELEASE SAVEPOINT sp_customer"]
        
        self.assertEqual(len(savepoint_calls), 2)
        self.assertEqual(len(rollback_calls), 1)
        self.assertEqual(len(release_calls), 2)
        
        mock_db.commit.assert_called_once()

    @patch("src.jobs.rfm_sync.calculate_rfm_scores")
    def test_commit_failure_is_not_reported_as_success(self, mock_calc):
        """A failed commit means nothing persisted - the summary must say so.

        The Node backend treats a 200 with a non-zero processed_count as a
        successful sync, so reporting per-customer successes after the single
        commit failed would hide total data loss.
        """
        mock_db = MagicMock()
        mock_cursor = MagicMock()
        mock_db.cursor.return_value = mock_cursor
        mock_cursor.fetchall.return_value = [("cust-1",), ("cust-2",)]
        mock_db.commit.side_effect = Exception("connection lost before commit")

        mock_calc.return_value = {
            "rfm_recency_score": 5,
            "rfm_frequency_score": 5,
            "rfm_monetary_score": 5,
        }

        result = calculate_rfm_for_all_customers("store-123", mock_db)

        self.assertEqual(result["processed_count"], 0)
        self.assertEqual(result["failed_customer_ids"], ["cust-1", "cust-2"])
        self.assertEqual(result["failed_count"], 2)
        self.assertFalse(result["success"])
        self.assertEqual(result["error"], "commit_failed")
        self.assertEqual(sum(result["segment_distribution"].values()), 0)
        mock_db.rollback.assert_called_once()

    @patch("src.jobs.rfm_sync.calculate_rfm_scores")
    def test_calculate_rfm_for_all_customers_empty(self, mock_calc):
        mock_db = MagicMock()
        mock_cursor = MagicMock()
        mock_db.cursor.return_value = mock_cursor
        mock_cursor.fetchall.return_value = []
        
        result = calculate_rfm_for_all_customers("store-123", mock_db)
        
        self.assertEqual(result["processed_count"], 0)
        self.assertEqual(result["failed_customer_ids"], [])
        self.assertEqual(result["failed_count"], 0)
        self.assertTrue(result["success"])
        self.assertEqual(sum(result["segment_distribution"].values()), 0)
        mock_calc.assert_not_called()
        mock_db.commit.assert_called_once()

    def test_customer_fetch_failure_rolls_back_and_closes_cursor(self):
        mock_db = MagicMock()
        mock_cursor = MagicMock()
        mock_db.cursor.return_value = mock_cursor
        mock_cursor.execute.side_effect = RuntimeError("query failed")

        result = calculate_rfm_for_all_customers("store-123", mock_db)

        self.assertFalse(result["success"])
        self.assertEqual(result["error"], "customer_fetch_failed")
        self.assertEqual(result["failed_count"], 0)
        mock_db.rollback.assert_called_once()
        mock_cursor.close.assert_called_once()

    @patch("src.jobs.rfm_sync.calculate_rfm_scores")
    def test_customer_update_includes_optional_rfm_timestamp(self, mock_calc):
        mock_db = MagicMock()
        mock_cursor = MagicMock()
        mock_db.cursor.return_value = mock_cursor
        mock_calc.return_value = {
            "rfm_recency_score": 5,
            "rfm_frequency_score": 4,
            "rfm_monetary_score": 4,
        }

        segment, success = _process_single_customer(
            "customer-1",
            mock_db,
            include_rfm_updated_at=True,
        )

        self.assertTrue(success)
        self.assertEqual(segment, "champion")
        update_query = next(
            call.args[0]
            for call in mock_cursor.execute.call_args_list
            if "UPDATE customers" in call.args[0]
        )
        self.assertIn("rfm_updated_at = NOW()", update_query)

    @patch("src.jobs.rfm_sync.calculate_rfm_scores")
    def test_batch_logs_failure_count_without_customer_ids(self, mock_calc):
        mock_db = MagicMock()
        mock_cursor = MagicMock()
        mock_db.cursor.return_value = mock_cursor
        mock_cursor.fetchall.return_value = [("private-customer-id",)]
        mock_calc.side_effect = RuntimeError("feature calculation failed")

        with self.assertLogs("src.jobs.rfm_sync", level="WARNING") as captured:
            result = calculate_rfm_for_all_customers("store-123", mock_db)

        self.assertEqual(result["failed_count"], 1)
        self.assertNotIn("private-customer-id", "\n".join(captured.output))
        self.assertTrue(
            any(getattr(record, "failed_count", None) == 1 for record in captured.records)
        )

    @patch("src.jobs.rfm_sync.calculate_rfm_for_all_customers")
    @patch("psycopg2.connect")
    @patch("src.jobs.rfm_sync.os.getenv")
    def test_run_success(self, mock_getenv, mock_connect, mock_calc):
        mock_getenv.return_value = "postgresql://dummy"
        mock_db = MagicMock()
        mock_connect.return_value = mock_db
        mock_calc.return_value = {"processed_count": 5}
        
        result = run("store-123")
        
        self.assertEqual(result["processed_count"], 5)
        mock_connect.assert_called_once_with("postgresql://dummy")
        mock_calc.assert_called_once_with("store-123", mock_db)
        mock_db.close.assert_called_once()

    @patch("src.jobs.rfm_sync.os.getenv")
    def test_run_missing_database_url(self, mock_getenv):
        mock_getenv.return_value = None
        result = run("store-123")
        self.assertEqual(result["processed_count"], 0)

    @patch("psycopg2.connect")
    @patch("src.jobs.rfm_sync.os.getenv")
    def test_run_connection_failure(self, mock_getenv, mock_connect):
        mock_getenv.return_value = "postgresql://dummy"
        mock_connect.side_effect = Exception("DB down")
        
        result = run("store-123")
        self.assertEqual(result["processed_count"], 0)

if __name__ == "__main__":
    unittest.main()
