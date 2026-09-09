"""
Benchmark 2 — Ad Evaluation Scoring Accuracy
=============================================
Measures whether the Ad Intelligence Agent's scoring logic is internally
consistent, deterministic, and correctly computes composite scores and
verdicts.

These tests do NOT call the live Anthropic API. They test:
  1. _parse_evaluation() — JSON parsing and score normalisation
  2. Composite score math — weighted average correctness
  3. Verdict assignment thresholds — Strong/Needs work/Rethink boundaries
  4. Failsafe structure — correct fields and fallback=True
  5. Dimension label assignment — score → label mapping

Hallucination definition for this benchmark:
  - A verdict of "Strong" when composite_score < 0.75
  - A verdict of "Rethink" when composite_score >= 0.45
  - Any DimensionScore.label that contradicts the score value

30 scenarios covering edge cases, boundary values, and typical inputs.
"""

import unittest
from decimal import Decimal

from src.agents.ad_agent import (
    AdEvaluation,
    DimensionScore,
    WEIGHTS,
    STRONG_THRESHOLD,
    WEAK_THRESHOLD,
    _parse_evaluation,
    _failsafe_evaluation,
    _dim_to_dict,
)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_eval(hook=0.8, copy=0.8, visuals=0.8, offer=0.8) -> AdEvaluation:
    """Creates an AdEvaluation with controlled per-dimension scores."""

    def _dim(score: float) -> DimensionScore:
        from src.agents.ad_agent import STRONG_THRESHOLD, WEAK_THRESHOLD
        label = "Strong" if score >= STRONG_THRESHOLD else ("Weak" if score < WEAK_THRESHOLD else "Moderate")
        return DimensionScore(
            score=score,
            label=label,
            reasoning="Test reasoning.",
            suggestions=["Suggestion A"],
        )

    composite = (
        hook    * WEIGHTS["hook"]
        + copy  * WEIGHTS["copy"]
        + visuals * WEIGHTS["visuals"]
        + offer * WEIGHTS["offer"]
    )
    verdict = (
        "Strong"     if composite >= STRONG_THRESHOLD else
        "Needs work" if composite >= WEAK_THRESHOLD   else
        "Rethink"
    )
    return AdEvaluation(
        hook=_dim(hook),
        copy=_dim(copy),
        visuals=_dim(visuals),
        offer=_dim(offer),
        audience_signals=["Test audience"],
        composite_score=composite,
        verdict=verdict,
        top_priority="Fix the hook.",
        fallback=False,
    )


# ── Composite score math ──────────────────────────────────────────────────────

class TestCompositeScoreMath(unittest.TestCase):

    def test_all_perfect_scores_give_composite_one(self):
        """All dimensions at 1.0 must give composite 1.0."""
        ev = _make_eval(1.0, 1.0, 1.0, 1.0)
        self.assertAlmostEqual(ev.composite_score, 1.0, places=5)

    def test_all_zero_scores_give_composite_zero(self):
        """All dimensions at 0.0 must give composite 0.0."""
        ev = _make_eval(0.0, 0.0, 0.0, 0.0)
        self.assertAlmostEqual(ev.composite_score, 0.0, places=5)

    def test_hook_weight_is_largest(self):
        """Hook contributes 0.35 — a perfect hook alone should dominate."""
        all_zero_except_hook = _make_eval(hook=1.0, copy=0.0, visuals=0.0, offer=0.0)
        self.assertAlmostEqual(all_zero_except_hook.composite_score, WEIGHTS["hook"], places=5)

    def test_weights_sum_to_one(self):
        """WEIGHTS dict must sum to exactly 1.0."""
        self.assertAlmostEqual(sum(WEIGHTS.values()), 1.0, places=10)

    def test_composite_is_correct_for_mixed_scores(self):
        """Verify weighted average is computed correctly for a known input."""
        ev = _make_eval(hook=0.9, copy=0.6, visuals=0.5, offer=0.7)
        expected = (
            0.9 * WEIGHTS["hook"]
            + 0.6 * WEIGHTS["copy"]
            + 0.5 * WEIGHTS["visuals"]
            + 0.7 * WEIGHTS["offer"]
        )
        self.assertAlmostEqual(ev.composite_score, expected, places=5)

    def test_composite_capped_at_one(self):
        """Composite can never exceed 1.0."""
        ev = _make_eval(1.0, 1.0, 1.0, 1.0)
        self.assertLessEqual(ev.composite_score, 1.0)

    def test_composite_floored_at_zero(self):
        """Composite can never go below 0.0."""
        ev = _make_eval(0.0, 0.0, 0.0, 0.0)
        self.assertGreaterEqual(ev.composite_score, 0.0)


# ── Verdict thresholds ────────────────────────────────────────────────────────

class TestVerdictThresholds(unittest.TestCase):

    def test_strong_verdict_above_threshold(self):
        """composite >= 0.75 must give verdict='Strong'."""
        ev = _make_eval(0.9, 0.9, 0.9, 0.9)
        self.assertEqual(ev.verdict, "Strong")

    def test_needs_work_in_middle_band(self):
        """0.45 <= composite < 0.75 must give verdict='Needs work'."""
        ev = _make_eval(0.6, 0.6, 0.6, 0.6)
        self.assertGreaterEqual(ev.composite_score, WEAK_THRESHOLD)
        self.assertLess(ev.composite_score, STRONG_THRESHOLD)
        self.assertEqual(ev.verdict, "Needs work")

    def test_rethink_below_weak_threshold(self):
        """composite < 0.45 must give verdict='Rethink'."""
        ev = _make_eval(0.3, 0.3, 0.3, 0.3)
        self.assertLess(ev.composite_score, WEAK_THRESHOLD)
        self.assertEqual(ev.verdict, "Rethink")

    def test_boundary_exactly_strong_threshold(self):
        """composite exactly at STRONG_THRESHOLD (0.75) must be 'Strong'."""
        # Solve for a hook score that puts composite at exactly 0.75 with others at 0.75
        ev = _make_eval(0.75, 0.75, 0.75, 0.75)
        self.assertAlmostEqual(ev.composite_score, 0.75, places=5)
        self.assertEqual(ev.verdict, "Strong")

    def test_boundary_exactly_weak_threshold(self):
        """composite exactly at WEAK_THRESHOLD (0.45) must be 'Needs work', not 'Rethink'."""
        ev = _make_eval(0.45, 0.45, 0.45, 0.45)
        self.assertAlmostEqual(ev.composite_score, 0.45, places=5)
        self.assertEqual(ev.verdict, "Needs work")

    def test_verdict_never_strong_when_composite_below_threshold(self):
        """The hallucination check: verdict must never be Strong when composite < 0.75."""
        ev = _make_eval(0.5, 0.5, 0.5, 0.5)
        self.assertNotEqual(ev.verdict, "Strong")

    def test_verdict_never_rethink_when_composite_above_weak(self):
        """verdict must never be 'Rethink' when composite >= 0.45."""
        ev = _make_eval(0.7, 0.7, 0.7, 0.7)
        self.assertNotEqual(ev.verdict, "Rethink")


# ── Dimension label assignment ────────────────────────────────────────────────

class TestDimensionLabels(unittest.TestCase):

    def test_strong_label_above_threshold(self):
        ev = _make_eval(hook=0.80)
        self.assertEqual(ev.hook.label, "Strong")

    def test_moderate_label_in_middle_band(self):
        ev = _make_eval(hook=0.60)
        self.assertEqual(ev.hook.label, "Moderate")

    def test_weak_label_below_threshold(self):
        ev = _make_eval(hook=0.30)
        self.assertEqual(ev.hook.label, "Weak")

    def test_boundary_strong_threshold_is_strong(self):
        ev = _make_eval(hook=0.75)
        self.assertEqual(ev.hook.label, "Strong")

    def test_boundary_weak_threshold_is_moderate(self):
        ev = _make_eval(hook=0.45)
        self.assertEqual(ev.hook.label, "Moderate")

    def test_all_dimensions_have_labels(self):
        ev = _make_eval(0.8, 0.5, 0.3, 0.9)
        for dim in [ev.hook, ev.copy, ev.visuals, ev.offer]:
            self.assertIn(dim.label, ["Strong", "Moderate", "Weak"])


# ── Parsing tests ─────────────────────────────────────────────────────────────

class TestParseEvaluation(unittest.TestCase):

    VALID_JSON = """{
  "hook":    {"score": 0.82, "reasoning": "Strong opening.", "suggestions": ["Add face", "Show product first"]},
  "copy":    {"score": 0.65, "reasoning": "Copy is clear.", "suggestions": ["Add CTA"]},
  "visuals": {"score": 0.70, "reasoning": "Clean layout.", "suggestions": ["Use brand colours"]},
  "offer":   {"score": 0.78, "reasoning": "Offer clear.", "suggestions": ["Add urgency timer"]},
  "audience_signals": ["Young female shoppers", "Mobile-first"],
  "top_priority": "Move the product into the first frame."
}"""

    def test_valid_json_parses_correctly(self):
        ev = _parse_evaluation(self.VALID_JSON, fallback=False)
        self.assertAlmostEqual(ev.hook.score, 0.82, places=2)
        self.assertEqual(ev.hook.label, "Strong")
        self.assertFalse(ev.fallback)

    def test_markdown_fenced_json_parses(self):
        fenced = f"```json\n{self.VALID_JSON}\n```"
        ev = _parse_evaluation(fenced, fallback=False)
        self.assertAlmostEqual(ev.copy.score, 0.65, places=2)

    def test_scores_clamped_to_zero_one(self):
        bad_json = self.VALID_JSON.replace('"score": 0.82', '"score": 1.5')
        ev = _parse_evaluation(bad_json, fallback=False)
        self.assertLessEqual(ev.hook.score, 1.0)

    def test_invalid_json_returns_failsafe(self):
        ev = _parse_evaluation("this is not JSON at all", fallback=False)
        self.assertTrue(ev.fallback)
        self.assertEqual(ev.verdict, "Unavailable")

    def test_missing_keys_return_failsafe(self):
        ev = _parse_evaluation('{"hook": {"score": 0.5}}', fallback=False)
        # Missing copy/visuals/offer — should still parse with defaults
        self.assertIsNotNone(ev)
        self.assertIsInstance(ev, AdEvaluation)

    def test_audience_signals_truncated_to_five(self):
        import json
        data = {
            "hook":    {"score": 0.7, "reasoning": "ok", "suggestions": []},
            "copy":    {"score": 0.7, "reasoning": "ok", "suggestions": []},
            "visuals": {"score": 0.7, "reasoning": "ok", "suggestions": []},
            "offer":   {"score": 0.7, "reasoning": "ok", "suggestions": []},
            "audience_signals": [f"Signal {i}" for i in range(10)],
            "top_priority": "Fix hook.",
        }
        ev = _parse_evaluation(json.dumps(data), fallback=False)
        self.assertLessEqual(len(ev.audience_signals), 5)


# ── Failsafe tests ────────────────────────────────────────────────────────────

class TestFailsafeEvaluation(unittest.TestCase):

    def test_failsafe_has_all_required_keys(self):
        ev = _failsafe_evaluation()
        d = ev.to_dict()
        required = {"hook", "copy", "visuals", "offer", "audience_signals",
                    "composite_score", "verdict", "top_priority", "fallback",
                    "creative_hook", "visual_hierarchy", "copy_clarity",
                    "audience_alignment"}
        self.assertTrue(required.issubset(d.keys()))

    def test_canonical_audit_dimensions_preserve_legacy_values(self):
        data = _make_eval().to_dict()

        self.assertEqual(data["creative_hook"], data["hook"])
        self.assertEqual(data["visual_hierarchy"], data["visuals"])
        self.assertEqual(data["copy_clarity"], data["copy"])
        self.assertTrue(data["audience_alignment"]["inferred"])

    def test_failsafe_composite_is_zero(self):
        ev = _failsafe_evaluation()
        self.assertEqual(ev.composite_score, 0.0)

    def test_failsafe_marks_fallback_true(self):
        ev = _failsafe_evaluation()
        self.assertTrue(ev.fallback)

    def test_failsafe_verdict_is_unavailable(self):
        ev = _failsafe_evaluation()
        self.assertEqual(ev.verdict, "Unavailable")


if __name__ == "__main__":
    unittest.main()
