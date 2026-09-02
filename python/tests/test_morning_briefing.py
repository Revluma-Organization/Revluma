"""
Unit tests for the Morning Briefing Generator.

Tests validate:
  - Correct greeting selection logic (anomaly vs normal vs fallback)
  - Stable metric suppression in yesterday_in_numbers
  - Exactly one action returned from todays_priority
  - Active concerns always returns at least one item
  - Fallback briefing structure when Business State unavailable
"""

import unittest
import logging
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import MagicMock, patch

from src.intelligence.business_state import BusinessState
from src.intelligence.morning_briefing import (
    MorningBriefing,
    generate_briefing,
    _build_greeting,
    _build_yesterday_in_numbers,
    _build_todays_priority,
    _build_active_concerns,
    _build_opportunities,
    _load_overnight_actions,
    _fallback_briefing,
    STABLE_DELTA_THRESHOLD_PCT,
)


def _make_state(**overrides) -> BusinessState:
    """Factory for BusinessState with safe defaults."""
    defaults = dict(
        id=str("test-state-id"),
        organization_id="org-123",
        schema_version="1.1",
        generated_at=datetime(2026, 8, 23, 5, 0, tzinfo=timezone.utc),
        data_freshness_at=None,
        staleness_threshold_mins=30,
        computation_status="complete",
        warnings=[],
        revenue_today=Decimal("4500.00"),
        revenue_yesterday=Decimal("4000.00"),
        revenue_delta_pct=12.5,
        revenue_trend_7d=8.0,
        revenue_anomaly=False,
        abandoned_cart_count=18,
        abandoned_cart_value=Decimal("2340.00"),
        cart_anomaly=False,
        churn_risk_count=4,
        vip_inactive_count=2,
        returning_customer_rate=0.34,
        returning_customer_rate_delta=0.0,
        opportunities=[],
        risks=[],
        anomalies=[],
        trends=[],
        ml_signals={},
        inventory_signals={"status": "unavailable"},
        anomaly_severity="normal",
        root_causes=[],
        current_event_rate=10.0,
        baseline_event_rate=10.0,
        next_rebuild_at=(
            datetime(2026, 8, 23, 5, 0, tzinfo=timezone.utc)
            + timedelta(minutes=15)
        ),
    )
    defaults.update(overrides)
    return BusinessState(**defaults)


# ── Greeting tests ─────────────────────────────────────────────────────────────

class TestBuildGreeting(unittest.TestCase):

    def test_anomaly_greeting_on_revenue_drop(self):
        """When revenue_anomaly=True and delta is negative, greeting must mention anomaly."""
        state = _make_state(
            revenue_anomaly=True,
            revenue_delta_pct=-25.0,
        )
        greeting = _build_greeting("David Okanlawon", state)
        self.assertIn("down", greeting)
        self.assertIn("25", greeting)

    def test_anomaly_greeting_on_revenue_spike(self):
        """Positive anomaly (spike) should mention the upward direction."""
        state = _make_state(
            revenue_anomaly=True,
            revenue_delta_pct=55.0,
        )
        greeting = _build_greeting("David", state)
        self.assertIn("up", greeting)

    def test_greeting_uses_first_name_only(self):
        """Greeting must address only the first name, not the full name."""
        state = _make_state(revenue_anomaly=False, revenue_delta_pct=3.0)
        greeting = _build_greeting("Sarah Jones", state)
        self.assertIn("Sarah", greeting)
        self.assertNotIn("Jones", greeting)

    def test_greeting_cart_anomaly_when_no_revenue_anomaly(self):
        """When no revenue anomaly but cart_anomaly is true, greeting mentions carts."""
        state = _make_state(
            revenue_anomaly=False,
            revenue_delta_pct=2.0,
            cart_anomaly=True,
            abandoned_cart_value=Decimal("3200.00"),
        )
        greeting = _build_greeting("Omar", state)
        self.assertIn("3,200", greeting)

    def test_greeting_stable_uses_revenue_value(self):
        """When everything is stable, greeting still includes today's revenue."""
        state = _make_state(
            revenue_anomaly=False,
            revenue_delta_pct=2.0,
            cart_anomaly=False,
        )
        greeting = _build_greeting("Ade", state)
        self.assertIn("4,500", greeting)

    def test_greeting_fallback_when_no_revenue(self):
        """When revenue_today is None, greeting falls back gracefully."""
        state = _make_state(
            revenue_today=None,
            revenue_yesterday=None,
            revenue_delta_pct=None,
            revenue_anomaly=False,
            cart_anomaly=False,
            churn_risk_count=0,
        )
        greeting = _build_greeting("Zara", state)
        # Must be a full sentence with a name and never crash
        self.assertIn("Zara", greeting)
        self.assertGreater(len(greeting), 10)


# ── Yesterday in numbers tests ────────────────────────────────────────────────

class TestBuildYesterdayInNumbers(unittest.TestCase):

    def test_stable_revenue_delta_suppressed(self):
        """Revenue delta below threshold must NOT appear in yesterday section."""
        state = _make_state(revenue_delta_pct=3.0)  # below STABLE_DELTA_THRESHOLD_PCT
        metrics = _build_yesterday_in_numbers(state)
        labels = [m["metric"] for m in metrics]
        self.assertNotIn("revenue_today", labels)

    def test_significant_delta_included(self):
        """Revenue delta above threshold MUST appear in yesterday section."""
        state = _make_state(revenue_delta_pct=15.0)
        metrics = _build_yesterday_in_numbers(state)
        labels = [m["metric"] for m in metrics]
        self.assertIn("revenue_today", labels)

    def test_stable_cart_count_is_suppressed_even_when_nonzero(self):
        state = _make_state(
            revenue_delta_pct=2.0,
            abandoned_cart_count=10,
            cart_anomaly=False,
            cart_delta_pct_vs_avg=2.0,
        )
        metrics = _build_yesterday_in_numbers(state)
        labels = [m["metric"] for m in metrics]
        self.assertNotIn("abandoned_cart_count", labels)

    def test_changed_cart_count_is_included(self):
        state = _make_state(
            revenue_delta_pct=2.0,
            abandoned_cart_count=10,
            cart_anomaly=True,
            cart_delta_pct_vs_avg=25.0,
        )
        metrics = _build_yesterday_in_numbers(state)
        labels = [m["metric"] for m in metrics]
        self.assertIn("abandoned_cart_count", labels)

    def test_max_five_metrics_returned(self):
        """Yesterday section must return at most 5 items."""
        state = _make_state(
            revenue_delta_pct=25.0,
            revenue_trend_7d=20.0,
            abandoned_cart_count=50,
            churn_risk_count=30,
            returning_customer_rate=0.10,
        )
        metrics = _build_yesterday_in_numbers(state)
        self.assertLessEqual(len(metrics), 5)

    def test_zero_carts_excluded(self):
        """If abandoned_cart_count is 0, it must not appear."""
        state = _make_state(abandoned_cart_count=0)
        metrics = _build_yesterday_in_numbers(state)
        labels = [m["metric"] for m in metrics]
        self.assertNotIn("abandoned_cart_count", labels)


# ── Today's priority tests ─────────────────────────────────────────────────────

class TestBuildTodaysPriority(unittest.TestCase):

    def test_revenue_anomaly_takes_top_priority(self):
        """A major revenue drop must always be today's priority over everything else."""
        state = _make_state(
            revenue_anomaly=True,
            revenue_delta_pct=-28.0,
            abandoned_cart_count=50,
            churn_risk_count=100,
        )
        priority = _build_todays_priority(state)
        self.assertIn("Investigate", priority["action_label"])
        self.assertEqual(priority["action_tool"], "view_revenue")

    def test_cart_recovery_second_priority(self):
        """When no revenue anomaly, abandoned carts must be the priority."""
        state = _make_state(
            revenue_anomaly=False,
            abandoned_cart_count=20,
            churn_risk_count=50,
        )
        priority = _build_todays_priority(state)
        self.assertEqual(priority["action_tool"], "view_carts")

    def test_priority_always_has_single_action(self):
        """The priority dict must always have exactly one action_label."""
        state = _make_state()
        priority = _build_todays_priority(state)
        self.assertIn("action_label", priority)
        self.assertIsInstance(priority["action_label"], str)
        self.assertGreater(len(priority["action_label"]), 0)

    def test_fallback_priority_when_nothing_urgent(self):
        """When store is healthy with no red flags, priority is reassuring."""
        state = _make_state(
            revenue_anomaly=False,
            revenue_delta_pct=3.0,
            abandoned_cart_count=0,
            churn_risk_count=0,
            vip_inactive_count=0,
            opportunities=[],
        )
        priority = _build_todays_priority(state)
        self.assertIn("description", priority)
        self.assertIn("action_label", priority)

    def test_vip_priority_uses_the_45_day_cohort(self):
        state = _make_state(
            revenue_anomaly=False,
            abandoned_cart_count=0,
            churn_risk_count=0,
            vip_inactive_count=2,
            opportunities=[],
        )

        priority = _build_todays_priority(state)

        self.assertEqual(priority["action_tool"], "view_customers")
        self.assertIn("45+ days", priority["description"])

    def test_priority_impact_uses_observed_evidence_not_typical_ranges(self):
        state = _make_state(
            revenue_anomaly=False,
            abandoned_cart_count=20,
            abandoned_cart_value=Decimal("2340.00"),
            churn_risk_count=0,
        )

        priority = _build_todays_priority(state)

        self.assertIn("2,340", priority["estimated_impact"])
        self.assertNotIn("18", priority["estimated_impact"])
        self.assertNotIn("25%", priority["estimated_impact"])


# ── Active concerns tests ──────────────────────────────────────────────────────

class TestBuildActiveConcerns(unittest.TestCase):

    def test_no_concerns_returns_explicit_message(self):
        """
        Spec: active_concerns must never be empty.
        When no real concerns exist, return the explicit 'No active concerns' item.
        """
        state = _make_state(
            revenue_anomaly=False,
            cart_anomaly=False,
            risks=[],
        )
        concerns = _build_active_concerns(state)
        self.assertEqual(len(concerns), 1)
        self.assertEqual(concerns[0]["description"], "No active concerns today.")
        self.assertEqual(concerns[0]["severity"], "none")

    def test_risks_appear_as_concerns(self):
        """Risks from BusinessState.risks must appear as concerns."""
        state = _make_state(risks=[
            {"severity": "high", "description": "Revenue dropped 25%."},
        ])
        concerns = _build_active_concerns(state)
        descs = [c["description"] for c in concerns]
        self.assertIn("Revenue dropped 25%.", descs)

    def test_max_three_concerns(self):
        """Concerns must be capped at 3 per the spec."""
        state = _make_state(
            risks=[
                {"severity": "high", "description": "Risk 1."},
                {"severity": "medium", "description": "Risk 2."},
                {"severity": "low", "description": "Risk 3."},
            ],
            revenue_anomaly=True,
            revenue_delta_pct=-30.0,
            cart_anomaly=True,
        )
        concerns = _build_active_concerns(state)
        self.assertLessEqual(len(concerns), 3)

    def test_anomaly_added_when_not_in_risks(self):
        """Revenue anomaly not already in risks must be surfaced as a concern."""
        state = _make_state(
            revenue_anomaly=True,
            revenue_delta_pct=-22.0,
            risks=[],
        )
        concerns = _build_active_concerns(state)
        self.assertTrue(any("Revenue" in c["description"] or "anomaly" in c["description"].lower()
                            for c in concerns))


# ── Opportunities tests ───────────────────────────────────────────────────────

class TestBuildOpportunities(unittest.TestCase):

    def test_sorted_by_value_descending(self):
        """Opportunities must be ranked by estimated_value, highest first."""
        state = _make_state(opportunities=[
            {"category": "cart_recovery",    "description": "Low value cart",  "estimated_value": 100.0,  "action": "Go"},
            {"category": "churn_prevention", "description": "High value churn", "estimated_value": 5000.0, "action": "Go"},
        ])
        opps = _build_opportunities(state)
        self.assertEqual(opps[0]["estimated_value"], 5000.0)

    def test_max_three_returned(self):
        """Opportunities must be capped at 3."""
        state = _make_state(opportunities=[
            {"category": "cart_recovery", "description": f"Opp {i}", "estimated_value": float(i * 100), "action": "Go"}
            for i in range(6)
        ])
        opps = _build_opportunities(state)
        self.assertLessEqual(len(opps), 3)

    def test_empty_when_no_valued_opportunities(self):
        """Opportunities without estimated_value are excluded."""
        state = _make_state(opportunities=[
            {"category": "churn_prevention", "description": "Some churn risk", "action": "Go"}
            # No estimated_value key
        ])
        opps = _build_opportunities(state)
        self.assertEqual(len(opps), 0)

    def test_only_d5_allowlisted_tools_are_returned(self):
        state = _make_state(opportunities=[
            {
                "category": "cart_recovery",
                "description": "Recover carts",
                "estimated_value": 500.0,
                "action": "Review carts",
            },
            {
                "category": "churn_prevention",
                "description": "Review churn risk",
                "estimated_value": 300.0,
                "action": "Review customers",
            },
        ])

        tools = {item["action_tool"] for item in _build_opportunities(state)}

        self.assertEqual(tools, {"view_carts", "view_customers"})


class TestOvernightActions(unittest.TestCase):

    def test_reads_the_canonical_audit_logs_contract(self):
        db = MagicMock()
        db.execute.return_value.fetchall.return_value = []

        _load_overnight_actions("org-123", db)

        sql = str(db.execute.call_args.args[0])
        self.assertIn("FROM audit_logs", sql)
        self.assertIn("context->>'actor'", sql)
        self.assertNotIn("FROM audit_log\n", sql)

    def test_failure_log_does_not_expose_exception_text(self):
        db = MagicMock()
        db.execute.side_effect = RuntimeError("private-customer@example.com")

        with self.assertLogs("rev.morning_briefing", level=logging.WARNING) as captured:
            result = _load_overnight_actions("org-123", db)

        self.assertEqual(result, [])
        self.assertNotIn("private-customer@example.com", " ".join(captured.output))


class TestBriefingModeIntegration(unittest.TestCase):

    @patch("src.intelligence.morning_briefing._persist_briefing")
    @patch("src.intelligence.morning_briefing._load_overnight_actions", return_value=[])
    @patch("src.intelligence.morning_briefing._load_merchant_name", return_value="Merchant")
    @patch("src.intelligence.morning_briefing.load_current_business_state")
    @patch("src.intelligence.morning_briefing._run_briefing_orchestration")
    def test_orchestrator_recommendation_drives_todays_priority(
        self,
        run_orchestration,
        load_state,
        _load_name,
        _load_actions,
        _persist,
    ):
        load_state.return_value = _make_state(
            abandoned_cart_count=0,
            churn_risk_count=0,
            vip_inactive_count=0,
            opportunities=[],
        )
        run_orchestration.return_value = MagicMock(
            success=True,
            response_type="analysis",
            recommendation="Review the verified revenue anomaly.",
            implication="The observed revenue gap may continue.",
            actions=[
                {
                    "label": "View revenue",
                    "tool": "view_revenue",
                    "params": {},
                }
            ],
        )

        briefing = generate_briefing("org-123", MagicMock(), user_id="user-123")

        run_orchestration.assert_called_once()
        self.assertEqual(
            briefing.todays_priority["description"],
            "Review the verified revenue anomaly.",
        )
        self.assertEqual(briefing.todays_priority["action_tool"], "view_revenue")


# ── Fallback briefing tests ───────────────────────────────────────────────────

class TestFallbackBriefing(unittest.TestCase):

    def test_fallback_briefing_has_all_sections(self):
        """Fallback briefing must include all 6 required sections."""
        now = datetime.now(timezone.utc)
        briefing = _fallback_briefing("bid-1", "org-123", "Emma Brown", now)
        self.assertIsInstance(briefing.greeting, str)
        self.assertIsInstance(briefing.yesterday_in_numbers, list)
        self.assertIsInstance(briefing.todays_priority, dict)
        self.assertIsInstance(briefing.active_concerns, list)
        self.assertIsInstance(briefing.opportunities, list)
        self.assertIsInstance(briefing.overnight_log, list)

    def test_fallback_briefing_marks_fallback_used(self):
        """fallback_used must be True."""
        now = datetime.now(timezone.utc)
        briefing = _fallback_briefing("bid-2", "org-456", "Merchant", now)
        self.assertTrue(briefing.fallback_used)

    def test_fallback_briefing_has_concern(self):
        """Fallback must always surface a concern about the data gap."""
        now = datetime.now(timezone.utc)
        briefing = _fallback_briefing("bid-3", "org-789", "Zoe", now)
        self.assertGreater(len(briefing.active_concerns), 0)
        self.assertTrue(briefing.has_concerns)

    def test_to_dict_includes_all_keys(self):
        """to_dict must include all 10 required keys."""
        now = datetime.now(timezone.utc)
        briefing = _fallback_briefing("bid-4", "org-000", "Ola", now)
        d = briefing.to_dict()
        required = {
            "id", "organization_id", "generated_at", "merchant_name",
            "greeting", "yesterday_in_numbers", "todays_priority",
            "active_concerns", "opportunities", "overnight_log",
            "has_concerns", "fallback_used",
        }
        self.assertTrue(required.issubset(d.keys()))


if __name__ == "__main__":
    unittest.main()
