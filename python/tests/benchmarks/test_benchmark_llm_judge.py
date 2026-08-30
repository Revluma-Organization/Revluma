"""
P2-C -- LLM-as-a-Judge Benchmark Runner
=========================================
Feeds Rev's compose_knowledge() responses to a secondary LLM judge that
scores each response for correctness, hallucination, and actionability.

Skipped automatically when ANTHROPIC_API_KEY is not set so CI never fails
on missing credentials.

Thresholds (all must pass for the suite to pass):
  - correctness average  >= 7.0 / 10
  - hallucination rate    = 0%
  - actionability average >= 6.0 / 10

Results are written to python/tests/benchmarks/results/llm_judge_results.json
after every run so the team can track improvement over time.
"""

from __future__ import annotations

import json
import os
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

# Root of the python/ package
sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

SCENARIOS_PATH = Path(__file__).parent / "data" / "strategy_scenarios.json"
RESULTS_PATH = Path(__file__).parent / "results" / "llm_judge_results.json"

# Minimum thresholds that must pass
MIN_CORRECTNESS   = 7.0
MIN_ACTIONABILITY = 6.0
MAX_HALLUCINATION = 0.0   # zero tolerance


def _is_ci_without_key() -> bool:
    """Returns True when no API key is present so CI can skip gracefully."""
    return not os.environ.get("ANTHROPIC_API_KEY")


def _get_rev_response(question: str) -> str:
    """
    Calls Rev's compose_knowledge() to generate a response to the question.
    Falls back to a short stub if the import fails (e.g., missing DB env).
    """
    try:
        from src.agents.responder import compose_knowledge
        return compose_knowledge(question)
    except Exception:
        # During benchmark runs without a full environment, return a stub that
        # will score low -- this surfaces the issue rather than hiding it.
        return "I am unable to generate a response at this time."


def _judge_response(question: str, rev_response: str, ground_truth: str, required_keywords: list, must_not_contain: list) -> dict:
    """
    Uses a secondary Claude call to score Rev's response.
    Returns {"correctness": float, "hallucination": bool, "actionability": float}

    Falls back to keyword-based heuristic scoring when the judge call fails.
    """
    import anthropic

    client = anthropic.Anthropic()

    prompt = f"""You are an expert e-commerce consultant acting as an impartial judge.

Question asked: {question}
Ground truth answer: {ground_truth}
Response to evaluate: {rev_response}

Score the response strictly on:
1. Correctness (0-10): How factually accurate is it compared to the ground truth?
2. Hallucination (true/false): Does it state any facts that are clearly invented or not in the ground truth?
3. Actionability (0-10): Can a merchant act on this advice immediately without further research?

Return JSON only, no other text:
{{"correctness": 0.0, "hallucination": false, "actionability": 0.0}}"""

    try:
        message = client.messages.create(
            model="claude-3-5-haiku-20241022",
            max_tokens=128,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = message.content[0].text.strip()
        return json.loads(raw)
    except Exception:
        # Heuristic fallback: keyword presence scoring
        response_lower = rev_response.lower()
        keyword_hits = sum(1 for kw in required_keywords if kw.lower() in response_lower)
        hallucinated = any(phrase.lower() in response_lower for phrase in must_not_contain)
        correctness = min(10.0, (keyword_hits / max(len(required_keywords), 1)) * 10)
        actionability = min(10.0, correctness * 0.8)
        return {"correctness": correctness, "hallucination": hallucinated, "actionability": actionability}


class TestLLMJudgeBenchmark(unittest.TestCase):
    """
    Runs all 20 strategy scenarios through Rev and evaluates each response.
    The suite is skipped when ANTHROPIC_API_KEY is not set.
    """

    @classmethod
    def setUpClass(cls):
        if _is_ci_without_key():
            raise unittest.SkipTest("ANTHROPIC_API_KEY not set -- skipping LLM judge benchmark")

        with open(SCENARIOS_PATH, encoding="utf-8") as f:
            cls.scenarios = json.load(f)

        cls.results = []

    def test_all_scenarios_meet_thresholds(self):
        """
        Feeds all 20 scenarios through Rev and the judge, then asserts
        aggregate scores meet the minimum thresholds defined above.
        """
        correctness_scores = []
        hallucination_flags = []
        actionability_scores = []

        for scenario in self.scenarios:
            question      = scenario["question"]
            ground_truth  = scenario["ground_truth"]
            required_kws  = scenario.get("required_keywords", [])
            must_not      = scenario.get("must_not_contain", [])

            rev_response = _get_rev_response(question)
            scores = _judge_response(question, rev_response, ground_truth, required_kws, must_not)

            correctness_scores.append(scores["correctness"])
            hallucination_flags.append(scores["hallucination"])
            actionability_scores.append(scores["actionability"])

            self.results.append({
                "question":      question,
                "rev_response":  rev_response,
                "scores":        scores,
            })

        avg_correctness   = sum(correctness_scores) / len(correctness_scores)
        hallucination_rate = sum(1 for h in hallucination_flags if h) / len(hallucination_flags)
        avg_actionability = sum(actionability_scores) / len(actionability_scores)

        # Write results for tracking over time
        RESULTS_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(RESULTS_PATH, "w", encoding="utf-8") as f:
            json.dump({
                "run_at":              datetime.now(timezone.utc).isoformat(),
                "avg_correctness":     avg_correctness,
                "hallucination_rate":  hallucination_rate,
                "avg_actionability":   avg_actionability,
                "scenarios":           self.results,
            }, f, indent=2)

        self.assertGreaterEqual(avg_correctness, MIN_CORRECTNESS,
            f"Average correctness {avg_correctness:.2f} is below minimum {MIN_CORRECTNESS}")
        self.assertEqual(hallucination_rate, MAX_HALLUCINATION,
            f"Hallucination rate {hallucination_rate:.0%} must be 0%")
        self.assertGreaterEqual(avg_actionability, MIN_ACTIONABILITY,
            f"Average actionability {avg_actionability:.2f} is below minimum {MIN_ACTIONABILITY}")


if __name__ == "__main__":
    unittest.main()
