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
from tempfile import NamedTemporaryFile

# Root of the python/ package
sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

SCENARIOS_PATH = Path(__file__).parent / "data" / "strategy_scenarios.json"
RESULTS_PATH = Path(__file__).parent / "results" / "llm_judge_results.json"

# Minimum thresholds that must pass
MIN_CORRECTNESS   = 7.0
MIN_ACTIONABILITY = 6.0
MAX_HALLUCINATION = 0.0   # zero tolerance
JUDGE_MODEL = "claude-haiku-4-5-20251001"


def _is_ci_without_key() -> bool:
    """Returns True when no API key is present so CI can skip gracefully."""
    return not os.environ.get("ANTHROPIC_API_KEY")


def _get_rev_response(question: str) -> str:
    """Generate Rev's response through the real non-store knowledge path."""
    from src.agents.responder import compose_knowledge
    from src.agents.understanding import MODE_EXPLANATION, Understanding

    understanding = Understanding(
        intent="strategy",
        goal="answer the ecommerce strategy question accurately",
        requires_store_data=False,
        requires_web=False,
        requires_action=False,
        response_mode=MODE_EXPLANATION,
        domains=[],
        confidence=1.0,
        reasoning="benchmark scenario",
    )
    return compose_knowledge(
        question,
        understanding,
        history_text="",
        memories=[],
        has_store=False,
    )


def _validate_scores(raw_scores: object) -> dict:
    """Validate the independent judge response before it becomes evidence."""
    if not isinstance(raw_scores, dict):
        raise ValueError("Judge response must be a JSON object.")
    if set(raw_scores) != {"correctness", "hallucination", "actionability"}:
        raise ValueError("Judge response has an unexpected schema.")

    correctness = raw_scores["correctness"]
    actionability = raw_scores["actionability"]
    hallucination = raw_scores["hallucination"]
    if isinstance(correctness, bool) or not isinstance(correctness, (int, float)):
        raise ValueError("Judge correctness must be numeric.")
    if isinstance(actionability, bool) or not isinstance(actionability, (int, float)):
        raise ValueError("Judge actionability must be numeric.")
    if not 0 <= correctness <= 10 or not 0 <= actionability <= 10:
        raise ValueError("Judge scores must be between 0 and 10.")
    if not isinstance(hallucination, bool):
        raise ValueError("Judge hallucination must be boolean.")
    return {
        "correctness": float(correctness),
        "hallucination": hallucination,
        "actionability": float(actionability),
    }


def _judge_response(
    question: str,
    rev_response: str,
    ground_truth: str,
    required_keywords: list,
    must_not_contain: list,
) -> dict:
    """
    Uses a secondary Claude call to score Rev's response.
    Returns {"correctness": float, "hallucination": bool, "actionability": float}

    A failed or malformed judge call fails the benchmark; synthetic scores are
    never substituted for independent evaluation evidence.
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

    message = client.messages.create(
        model=JUDGE_MODEL,
        max_tokens=128,
        messages=[{"role": "user", "content": prompt}],
    )
    text_blocks = [
        block.text
        for block in message.content
        if getattr(block, "type", "") == "text"
    ]
    if not text_blocks:
        raise ValueError("Judge returned no text response.")
    return _validate_scores(json.loads("".join(text_blocks).strip()))


def _write_results(payload: dict) -> None:
    """Atomically replace the previous evidence only after a complete run."""
    RESULTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile(
        "w",
        encoding="utf-8",
        dir=RESULTS_PATH.parent,
        prefix="llm_judge_",
        suffix=".json.tmp",
        delete=False,
    ) as output:
        json.dump(payload, output, indent=2)
        temporary_path = Path(output.name)
    temporary_path.replace(RESULTS_PATH)


class TestBenchmarkHelpers(unittest.TestCase):
    def test_validate_scores_accepts_exact_valid_schema(self):
        scores = _validate_scores(
            {"correctness": 8, "hallucination": False, "actionability": 7.5}
        )

        self.assertEqual(
            scores,
            {"correctness": 8.0, "hallucination": False, "actionability": 7.5},
        )

    def test_validate_scores_rejects_out_of_range_values(self):
        with self.assertRaises(ValueError):
            _validate_scores(
                {"correctness": 11, "hallucination": False, "actionability": 7}
            )


class TestLLMJudgeBenchmark(unittest.TestCase):
    """
    Runs all 20 strategy scenarios through Rev and evaluates each response.
    The suite is skipped when ANTHROPIC_API_KEY is not set.
    """

    @classmethod
    def setUpClass(cls):
        if _is_ci_without_key():
            raise unittest.SkipTest("ANTHROPIC_API_KEY not set -- skipping LLM judge benchmark")

        with open(SCENARIOS_PATH, encoding="utf-8-sig") as f:
            cls.scenarios = json.load(f)
        if len(cls.scenarios) < 20:
            raise AssertionError("P2-C requires at least 20 benchmark scenarios.")

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
        _write_results({
                "run_at":              datetime.now(timezone.utc).isoformat(),
                "judge_model":         JUDGE_MODEL,
                "avg_correctness":     avg_correctness,
                "hallucination_rate":  hallucination_rate,
                "avg_actionability":   avg_actionability,
                "scenarios":           self.results,
            })

        self.assertGreaterEqual(avg_correctness, MIN_CORRECTNESS,
            f"Average correctness {avg_correctness:.2f} is below minimum {MIN_CORRECTNESS}")
        self.assertEqual(hallucination_rate, MAX_HALLUCINATION,
            f"Hallucination rate {hallucination_rate:.0%} must be 0%")
        self.assertGreaterEqual(avg_actionability, MIN_ACTIONABILITY,
            f"Average actionability {avg_actionability:.2f} is below minimum {MIN_ACTIONABILITY}")


if __name__ == "__main__":
    unittest.main()
