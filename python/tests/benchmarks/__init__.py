"""
Rev Intelligence — Evaluation Benchmarks
==========================================
Permanent test suite that mathematically measures Rev's correctness,
hallucination rate, and reasoning quality across four scenario categories.

Categories:
    1. Intent Classification  — does Rev route messages correctly?
    2. Strategy Quality       — does Rev's advice match expert consensus?
    3. Diagnosis Accuracy     — does Rev identify root causes correctly?
    4. Ad Evaluation          — does Rev's creative scoring match human judges?

Each benchmark runs deterministically against synthetic scenarios.
No live API calls are made — all LLM outputs are mocked.
Results are scored as pass/fail with a hallucination_free flag per scenario.

Usage:
    pytest python/tests/benchmarks/ -v
    python -m pytest python/tests/benchmarks/ --tb=short -q
"""
