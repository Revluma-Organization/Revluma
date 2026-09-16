"""Score Rev Intelligence responses against reviewed lab ground truth."""

from __future__ import annotations

import argparse
import json
import math
import re
from pathlib import Path


DEFAULT_GROUND_TRUTH_DIR = Path(__file__).resolve().parents[1] / "ground_truth"
_SCENARIO_ID_PATTERN = re.compile(r"SCN-\d{3}\Z")
_TOKEN_PATTERN = re.compile(r"[a-z0-9]+")
_CONTENT_STOPWORDS = {
    "all",
    "and",
    "are",
    "but",
    "for",
    "from",
    "into",
    "not",
    "the",
    "this",
    "was",
    "were",
    "while",
    "with",
}
_REQUIRED_GROUND_TRUTH_FIELDS = {
    "scenario_id",
    "name",
    "hidden_cause",
    "expected_diagnosis",
    "expected_recommendation",
}


def _tokens(value: str) -> list[str]:
    return _TOKEN_PATTERN.findall(value.casefold())


def _meaningful_tokens(value: str) -> list[str]:
    return [
        token
        for token in _tokens(value)
        if len(token) >= 3 and token not in _CONTENT_STOPWORDS
    ]


def _token_forms(token: str) -> set[str]:
    """Return conservative inflection variants without fuzzy substring matching."""
    forms = {token}
    if len(token) > 5 and token.endswith("ies"):
        forms.add(f"{token[:-3]}y")
    if len(token) > 5 and token.endswith("ed"):
        forms.update({token[:-2], token[:-1]})
    if len(token) > 6 and token.endswith("ing"):
        stem = token[:-3]
        forms.update({stem, f"{stem}e"})
    if len(token) > 5 and token.endswith("s"):
        forms.add(token[:-1])
    return forms


def _token_present(expected: str, actual_tokens: set[str]) -> bool:
    expected_forms = _token_forms(expected)
    return any(expected_forms.intersection(_token_forms(actual)) for actual in actual_tokens)


def load_ground_truth(
    scenario_id: str,
    gt_dir: str | Path = DEFAULT_GROUND_TRUTH_DIR,
) -> dict:
    """Load one reviewed scenario without allowing path traversal."""
    if not _SCENARIO_ID_PATTERN.fullmatch(scenario_id):
        raise ValueError("scenario_id must use the SCN-000 format.")

    path = Path(gt_dir).resolve() / f"{scenario_id}.json"
    with path.open(encoding="utf-8") as handle:
        ground_truth = json.load(handle)

    missing = _REQUIRED_GROUND_TRUTH_FIELDS.difference(ground_truth)
    if missing:
        raise ValueError(
            f"Ground truth {scenario_id} is missing: {', '.join(sorted(missing))}."
        )
    if ground_truth["scenario_id"] != scenario_id:
        raise ValueError("Ground-truth scenario_id does not match the requested scenario.")
    return ground_truth


def phrase_present(text: str, phrase: str, min_words: int = 2) -> bool:
    """Return whether enough complete, meaningful phrase tokens occur in text."""
    phrase_tokens = list(dict.fromkeys(_meaningful_tokens(phrase)))
    if len(phrase_tokens) < min_words:
        return False
    text_tokens = set(_tokens(text))
    matches = sum(_token_present(token, text_tokens) for token in phrase_tokens)
    return matches >= min(min_words, len(phrase_tokens))


def is_false_diagnosis(response: str, gt: dict) -> tuple[bool, str]:
    """Detect a false diagnosis only when most of its meaningful words match."""
    response_tokens = set(_tokens(response))
    for diagnosis in gt.get("false_diagnoses", []):
        key_tokens = list(dict.fromkeys(_meaningful_tokens(diagnosis)))
        if len(key_tokens) < 2:
            continue
        matches = sum(_token_present(token, response_tokens) for token in key_tokens)
        if matches >= max(2, math.ceil(len(key_tokens) * 0.6)):
            return True, diagnosis
    return False, ""


def score_detection(rev_response: str, gt: dict) -> tuple[int, str]:
    signals = gt.get("signals_available_to_rev", [])
    detected = sum(1 for signal in signals if phrase_present(rev_response, signal))
    if detected >= 2:
        return 2, f"Rev detected {detected}/{len(signals)} relevant signals"
    if detected == 1:
        return 1, "Rev partially detected the situation"
    return 0, "Rev did not detect the relevant signals"


def score_diagnosis(rev_response: str, gt: dict) -> tuple[int, str]:
    false_hit, false_phrase = is_false_diagnosis(rev_response, gt)
    if false_hit:
        return 0, f"Rev produced false diagnosis: '{false_phrase[:50]}'"

    if phrase_present(rev_response, gt.get("expected_diagnosis", ""), min_words=3):
        return 2, "Rev correctly diagnosed the root cause"

    evidence = gt.get("expected_evidence", [])
    partial = sum(1 for concept in evidence[:3] if phrase_present(rev_response, concept))
    if partial >= 2:
        return 1, "Rev partially identified the correct cause"
    return 0, "Rev did not correctly diagnose the cause"


def score_evidence(rev_response: str, gt: dict) -> tuple[int, str]:
    expected_evidence = gt.get("expected_evidence", [])
    cited = sum(
        1 for evidence in expected_evidence if phrase_present(rev_response, evidence)
    )
    ratio = cited / max(len(expected_evidence), 1)
    if ratio >= 0.5:
        return 2, f"Rev cited strong evidence ({cited}/{len(expected_evidence)} signals)"
    if ratio >= 0.25:
        return 1, f"Rev cited partial evidence ({cited}/{len(expected_evidence)} signals)"
    return 0, "Rev did not cite appropriate evidence"


def _priority_present(response: str, priority: str) -> bool:
    priority_tokens = _tokens(priority)
    if not priority_tokens:
        return False
    if len(priority_tokens) == 1:
        return priority_tokens[0] in set(_tokens(response))
    return phrase_present(response, priority, min_words=min(2, len(priority_tokens)))


def score_prioritization(rev_response: str, gt: dict) -> tuple[int, str]:
    response_lower = rev_response.casefold()
    critical = str(gt.get("critical_behavior", "")).casefold()

    if "must prioritize" in critical:
        list_markers = [
            "additionally,",
            "furthermore,",
            "also,",
            "another issue",
            "also note",
        ]
        if sum(marker in response_lower for marker in list_markers) >= 2:
            return 0, "Rev listed multiple problems without clear prioritization"

    priority = str(gt.get("expected_priority", ""))
    if _priority_present(rev_response, priority):
        return 2, "Rev correctly prioritized the situation"
    return 0, "Rev did not demonstrate the expected prioritization"


def score_recommendation(rev_response: str, gt: dict) -> tuple[int, str]:
    for trap in gt.get("trap_answers", []):
        if phrase_present(rev_response, trap):
            return 0, f"Rev gave trap recommendation: '{trap}'"

    expected = gt.get("expected_recommendation", "")
    if phrase_present(rev_response, expected, min_words=3):
        return 2, "Rev recommended an appropriate action"
    if phrase_present(rev_response, expected, min_words=2):
        return 1, "Rev's recommendation was partially appropriate"
    return 0, "Rev did not recommend an appropriate action"


def evaluate(
    scenario_id: str,
    rev_response: str,
    gt_dir: str | Path = DEFAULT_GROUND_TRUTH_DIR,
) -> dict:
    if not rev_response.strip():
        raise ValueError("rev_response must not be empty.")
    ground_truth = load_ground_truth(scenario_id, gt_dir)
    scores = {
        "detection": score_detection(rev_response, ground_truth),
        "diagnosis": score_diagnosis(rev_response, ground_truth),
        "evidence": score_evidence(rev_response, ground_truth),
        "prioritization": score_prioritization(rev_response, ground_truth),
        "recommendation": score_recommendation(rev_response, ground_truth),
    }
    total = sum(score[0] for score in scores.values())
    return {
        "scenario_id": scenario_id,
        "scenario_name": ground_truth["name"],
        "total_score": total,
        "max_score": 10,
        "percentage": round(total / 10 * 100),
        "breakdown": {
            dimension: {"score": score[0], "max": 2, "reasoning": score[1]}
            for dimension, score in scores.items()
        },
        "hidden_cause": ground_truth["hidden_cause"],
        "expected_diagnosis": ground_truth["expected_diagnosis"],
        "expected_recommendation": ground_truth["expected_recommendation"],
    }


def print_result(result: dict) -> None:
    print(f"\n{'=' * 62}")
    print("  REVLUMA INTELLIGENCE LAB — EVALUATION REPORT")
    print(f"{'=' * 62}")
    print(f"  Scenario : {result['scenario_id']} — {result['scenario_name']}")
    score_bar = "█" * result["total_score"] + "░" * (10 - result["total_score"])
    print(
        f"  Score    : {result['total_score']}/10  "
        f"[{score_bar}]  {result['percentage']}%"
    )
    print(f"{'=' * 62}")
    for dimension, data in result["breakdown"].items():
        bar = "█" * data["score"] + "░" * (2 - data["score"])
        print(
            f"  {dimension.capitalize():<20} [{bar}] "
            f"{data['score']}/2  {data['reasoning']}"
        )
    print(f"{'─' * 62}")
    print(f"  Hidden cause   : {result['hidden_cause']}")
    print(f"  Expected diag  : {result['expected_diagnosis']}")
    print(f"  Expected action: {result['expected_recommendation']}")
    print(f"{'=' * 62}\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--scenario", required=True)
    parser.add_argument("--rev-response", required=True)
    parser.add_argument(
        "--ground-truth-dir",
        default=str(DEFAULT_GROUND_TRUTH_DIR),
    )
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    result = evaluate(args.scenario, args.rev_response, args.ground_truth_dir)
    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print_result(result)


if __name__ == "__main__":
    main()
