"""
Revluma Intelligence Lab — Scenario Evaluator v0.2
Scores Rev Intelligence responses against ground truth.
Uses phrase-level matching rather than word-level to avoid false positives.
"""

import json, argparse, os, re

def load_ground_truth(scenario_id: str, gt_dir: str) -> dict:
    path = os.path.join(gt_dir, f"{scenario_id}.json")
    with open(path) as f:
        return json.load(f)

def phrase_present(text: str, phrase: str, min_words: int = 2) -> bool:
    """Check if a meaningful chunk of phrase appears in text."""
    words = [w for w in phrase.lower().split() if len(w) > 4]
    if len(words) < min_words:
        return False
    matches = sum(1 for w in words if w in text.lower())
    return matches >= min(min_words, len(words))

def is_false_diagnosis(response: str, gt: dict) -> tuple[bool, str]:
    """
    Check if response contains a false diagnosis.
    Requires the FULL INTENT of the false diagnosis to be present,
    not just one word from it.
    """
    response_lower = response.lower()
    for f in gt.get("false_diagnoses", []):
        # Need at least 2 key words from the false diagnosis to match
        key_words = [w for w in f.lower().split() if len(w) > 4]
        if len(key_words) < 2:
            continue
        matches = sum(1 for w in key_words if w in response_lower)
        # Only flag if majority of key words from false diagnosis are present
        if matches >= max(2, len(key_words) * 0.6):
            return True, f
    return False, ""

def score_detection(rev_response: str, gt: dict) -> tuple[int, str]:
    response_lower = rev_response.lower()
    signals = gt.get("signals_available_to_rev", [])
    detected = sum(1 for s in signals if phrase_present(response_lower, s))
    if detected >= 2:
        return 2, f"Rev detected {detected}/{len(signals)} relevant signals"
    elif detected == 1:
        return 1, "Rev partially detected the situation"
    return 0, "Rev did not detect the relevant signals"

def score_diagnosis(rev_response: str, gt: dict) -> tuple[int, str]:
    response_lower = rev_response.lower()
    false_hit, false_phrase = is_false_diagnosis(response_lower, gt)
    if false_hit:
        return 0, f"Rev produced false diagnosis: '{false_phrase[:50]}'"

    expected = gt.get("expected_diagnosis", "")
    if phrase_present(response_lower, expected, min_words=3):
        return 2, "Rev correctly diagnosed the root cause"

    # Partial: key concept present but not complete
    key_concepts = gt.get("expected_evidence", [])
    partial = sum(1 for c in key_concepts[:3] if phrase_present(response_lower, c))
    if partial >= 2:
        return 1, "Rev partially identified the correct cause"
    return 0, "Rev did not correctly diagnose the cause"

def score_evidence(rev_response: str, gt: dict) -> tuple[int, str]:
    response_lower = rev_response.lower()
    expected_evidence = gt.get("expected_evidence", [])
    cited = sum(1 for e in expected_evidence if phrase_present(response_lower, e))
    ratio = cited / max(len(expected_evidence), 1)
    if ratio >= 0.5:
        return 2, f"Rev cited strong evidence ({cited}/{len(expected_evidence)} signals)"
    elif ratio >= 0.25:
        return 1, f"Rev cited partial evidence ({cited}/{len(expected_evidence)} signals)"
    return 0, "Rev did not cite appropriate evidence"

def score_prioritization(rev_response: str, gt: dict) -> tuple[int, str]:
    response_lower = rev_response.lower()
    critical = gt.get("critical_behavior", "")

    # Multi-signal trap: penalize equal-weight lists
    if "must prioritize" in critical.lower():
        list_words = ["additionally,", "furthermore,", "also,", "another issue", "also note"]
        list_count = sum(1 for w in list_words if w in response_lower)
        if list_count >= 2:
            return 0, "Rev listed multiple problems without clear prioritization"

    priority = gt.get("expected_priority", "").lower()
    if priority in response_lower or phrase_present(response_lower, priority):
        return 2, "Rev correctly prioritized the situation"
    return 1, "Prioritization was partially correct"

def score_recommendation(rev_response: str, gt: dict) -> tuple[int, str]:
    response_lower = rev_response.lower()

    # Check trap answers
    for t in gt.get("trap_answers", []):
        if phrase_present(response_lower, t):
            return 0, f"Rev gave trap recommendation: '{t}'"

    expected_rec = gt.get("expected_recommendation", "")
    if phrase_present(response_lower, expected_rec, min_words=3):
        return 2, "Rev recommended an appropriate action"
    if phrase_present(response_lower, expected_rec, min_words=2):
        return 1, "Rev's recommendation was partially appropriate"
    return 0, "Rev did not recommend an appropriate action"

def evaluate(scenario_id: str, rev_response: str, gt_dir: str) -> dict:
    gt = load_ground_truth(scenario_id, gt_dir)
    scores = {
        "detection":      score_detection(rev_response, gt),
        "diagnosis":      score_diagnosis(rev_response, gt),
        "evidence":       score_evidence(rev_response, gt),
        "prioritization": score_prioritization(rev_response, gt),
        "recommendation": score_recommendation(rev_response, gt),
    }
    total = sum(s[0] for s in scores.values())
    return {
        "scenario_id":   scenario_id,
        "scenario_name": gt["name"],
        "total_score":   total,
        "max_score":     10,
        "percentage":    round(total / 10 * 100),
        "breakdown": {
            dim: {"score": s[0], "max": 2, "reasoning": s[1]}
            for dim, s in scores.items()
        },
        "hidden_cause":             gt["hidden_cause"],
        "expected_diagnosis":       gt["expected_diagnosis"],
        "expected_recommendation":  gt["expected_recommendation"],
    }

def print_result(result: dict):
    print(f"\n{'='*62}")
    print(f"  REVLUMA INTELLIGENCE LAB — EVALUATION REPORT")
    print(f"{'='*62}")
    print(f"  Scenario : {result['scenario_id']} — {result['scenario_name']}")
    score_bar = "█" * result['total_score'] + "░" * (10 - result['total_score'])
    print(f"  Score    : {result['total_score']}/10  [{score_bar}]  {result['percentage']}%")
    print(f"{'='*62}")
    for dim, data in result["breakdown"].items():
        bar = "█" * data["score"] + "░" * (2 - data["score"])
        print(f"  {dim.capitalize():<20} [{bar}] {data['score']}/2  {data['reasoning']}")
    print(f"{'─'*62}")
    print(f"  Hidden cause   : {result['hidden_cause']}")
    print(f"  Expected diag  : {result['expected_diagnosis']}")
    print(f"  Expected action: {result['expected_recommendation']}")
    print(f"{'='*62}\n")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--scenario",         required=True)
    parser.add_argument("--rev-response",     required=True)
    parser.add_argument("--ground-truth-dir", default="./ground_truth")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    result = evaluate(args.scenario, args.rev_response, args.ground_truth_dir)
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print_result(result)