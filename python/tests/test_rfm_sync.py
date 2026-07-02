"""
Unit tests for rfm_sync.py
Framework: unittest + unittest.mock.MagicMock
"""

import unittest
from unittest.mock import MagicMock, patch
import sys
import os

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from python.src.jobs.rfm_sync import get_rfm_segment, calculate_rfm_for_all_customers


class TestGetRfmSegment(unittest.TestCase):

    def test_champion(self):
        self.assertEqual(get_rfm_segment(5, 5, 5), "champion")
        self.assertEqual(get_rfm_segment(4, 4, 4), "champion")

    def test_loyal(self):
        self.assertEqual(get_rfm_segment(3, 3, 1), "loyal")
        self.assertEqual(get_rfm_segment(3, 4, 2), "loyal")

    def test_at_risk(self):
        self.assertEqual(get_rfm_segment(1, 3, 1), "at_risk")
        self.assertEqual(get_rfm_segment(2, 5, 1), "at_risk")

    def test_hibernating(self):
        self.assertEqual(get_rfm_segment(2, 2, 2), "hibernating")
        self.assertEqual(get_rfm_segment(1, 1, 3), "hibernating")

    def test_lost_fallback(self):
        self.assertEqual(get_rfm_segment(1, 1, 1), "lost")
        self.assertEqual(get_rfm_segment(2, 2, 1), "lost")

    def test_priority_order_champion_before_loyal(self):
        # r=4,f=4,m=4 would also satisfy 'loyal' conditions but champion wins
        result = get_rfm_segment(4, 4, 4)
        self.assertEqual(result, "champion")

    def test_priority_order_at_risk_before_hibernating(self):
        # r=1,f=3 satisfies at_risk; should not fall through to hibernating
        result = get_rfm_segment(1, 3, 1)
        self.assertEqual(result, "at_risk")

    def test_always_returns_valid_string(self):
        valid_segments = {"champion", "loyal", "at_risk", "hibernating", "lost"}
        for r in range(1, 6):
            for f in range(1, 6):
                for m in range(1, 6):
                    result = get_rfm_segment(r, f, m)
                    self.assertIn(result, valid_segments)


class TestCalculateRfmForAllCustomers(unittest.TestCase):

    def _build_mock_db(self, customer_ids, rfm_side_effects):
        """
        Builds a mock db where:
        - SELECT id FROM customers returns customer_ids
        - calculate_rfm_scores is patched to return rfm_side_effects in order
        """
        mock_cursor = MagicMock()
        mock_cursor.fetchall.return_value = [(cid,) for cid in customer_ids]

        mock_db = MagicMock()
        mock_db.cursor.return_value = mock_cursor
        return mock_db, mock_cursor

    @patch("src.jobs.rfm_sync.calculate_rfm_scores")
    def test_normal_batch_processing(self, mock_rfm):
        mock_db, cursor = self._build_mock_db(["c1", "c2"], None)
        mock_rfm.side_effect = [
            {"rfm_recency_score": 5, "rfm_frequency_score": 5, "rfm_monetary_score": 5,
             "days_since_last_purchase": 1, "past_orders_total": 25, "avg_order_value": 300.0},
            {"rfm_recency_score": 1, "rfm_frequency_score": 1, "rfm_monetary_score": 1,
             "days_since_last_purchase": 400, "past_orders_total": 0, "avg_order_value": 0.0},
        ]

        result = calculate_rfm_for_all_customers("store_1", mock_db)

        self.assertEqual(result["processed_count"], 2)
        self.assertEqual(result["segment_distribution"]["champion"], 1)
        self.assertEqual(result["segment_distribution"]["lost"], 1)
        mock_db.commit.assert_called_once()

    @patch("src.jobs.rfm_sync.calculate_rfm_scores")
    def test_empty_customer_list(self, mock_rfm):
        mock_db, cursor = self._build_mock_db([], None)

        result = calculate_rfm_for_all_customers("store_empty", mock_db)

        self.assertEqual(result["processed_count"], 0)
        mock_rfm.assert_not_called()
        mock_db.commit.assert_called_once()

    @patch("src.jobs.rfm_sync.calculate_rfm_scores")
    def test_per_customer_failure_does_not_abort_batch(self, mock_rfm):
        mock_db, cursor = self._build_mock_db(["c1", "c2", "c3"], None)
        mock_rfm.side_effect = [
            {"rfm_recency_score": 5, "rfm_frequency_score": 5, "rfm_monetary_score": 5,
             "days_since_last_purchase": 1, "past_orders_total": 25, "avg_order_value": 300.0},
            Exception("simulated failure for c2"),
            {"rfm_recency_score": 1, "rfm_frequency_score": 1, "rfm_monetary_score": 1,
             "days_since_last_purchase": 400, "past_orders_total": 0, "avg_order_value": 0.0},
        ]

        result = calculate_rfm_for_all_customers("store_1", mock_db)

        # c1 and c3 should succeed despite c2 failing
        self.assertEqual(result["processed_count"], 2)
        self.assertIn("c2", result["failed_customer_ids"])
        mock_db.commit.assert_called_once()

    def test_customer_fetch_failure_returns_safe_default(self):
        mock_cursor = MagicMock()
        mock_cursor.execute.side_effect = Exception("DB connection lost")
        mock_db = MagicMock()
        mock_db.cursor.return_value = mock_cursor

        try:
            result = calculate_rfm_for_all_customers("store_1", mock_db)
        except Exception as e:
            self.fail(f"calculate_rfm_for_all_customers raised: {e}")

        self.assertEqual(result["processed_count"], 0)
        self.assertEqual(result["failed_customer_ids"], [])

    @patch("src.jobs.rfm_sync.calculate_rfm_scores")
    def test_commit_called_once_not_per_customer(self, mock_rfm):
        mock_db, cursor = self._build_mock_db(["c1", "c2", "c3"], None)
        mock_rfm.side_effect = [
            {"rfm_recency_score": 3, "rfm_frequency_score": 3, "rfm_monetary_score": 3,
             "days_since_last_purchase": 10, "past_orders_total": 5, "avg_order_value": 50.0}
        ] * 3

        calculate_rfm_for_all_customers("store_1", mock_db)

        # Must be called exactly once regardless of customer count
        self.assertEqual(mock_db.commit.call_count, 1)

    @patch("src.jobs.rfm_sync.calculate_rfm_scores")
    def test_segment_distribution_sums_correctly(self, mock_rfm):
        mock_db, cursor = self._build_mock_db(["c1", "c2"], None)
        mock_rfm.side_effect = [
            {"rfm_recency_score": 4, "rfm_frequency_score": 4, "rfm_monetary_score": 4,
             "days_since_last_purchase": 5, "past_orders_total": 15, "avg_order_value": 150.0},
            {"rfm_recency_score": 4, "rfm_frequency_score": 4, "rfm_monetary_score": 4,
             "days_since_last_purchase": 3, "past_orders_total": 12, "avg_order_value": 120.0},
        ]

        result = calculate_rfm_for_all_customers("store_1", mock_db)

        total_in_distribution = sum(result["segment_distribution"].values())
        self.assertEqual(total_in_distribution, result["processed_count"])


if __name__ == "__main__":
    unittest.main()