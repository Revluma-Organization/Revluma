"""Task 203 - automated tests for the unified evidence-quality model.

Deterministic fixtures and timestamps only; no network, no production data.
Covers the mandatory Section 10 matrix across the five consolidated tasks:
currency safety, zero-vs-missing, incomplete-evidence fallback, source-specific
freshness, contradiction handling, plus security (tenant/store isolation) and
the six-dimension independence guarantees.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from src.intelligence.evidence import (
    UNIT_CURRENCY,
    UNIT_COUNT,
    evidence_context,
    evidence_item,
    period,
)
from src.intelligence import evidence_quality as eq

NOW = datetime(2026, 11, 7, 12, 0, 0, tzinfo=timezone.utc)
ORG = "org-1"
STORE = "store-1"


def _window(days_back: int = 1) -> dict:
    return period(NOW - timedelta(days=days_back), NOW)


def _make_item(metric, value, unit, currency, status, coverage, freshness_state, source, disc, window):
    # evidence_item does not expose an arbitrary status; build via the contract
    # by choosing inputs that yield the status, or patch after the fact for the
    # states that cannot be produced from available inputs.
    coverage_block = {"complete": coverage[1], "status": coverage[0]}
    freshness_block = {"state": freshness_state, "as_of": None, "age_seconds": 10,
                       "policy": "3600s", "note": "n"}
    with evidence_context(ORG, [STORE]):
        item = evidence_item(
            metric, label="label", value=value, unit=unit, currency=currency,
            window=window, source=source, definition="definition",
            discriminator=disc, coverage=coverage_block, freshness=freshness_block,
        )
    item["status"] = status
    return item


# =========================================================================
# A. Currency safety (Task 207)
# =========================================================================

def test_single_currency_aggregation():
    result = eq.aggregate_currency([
        {"amount": "10.50", "currency": "usd"},
        {"amount": 4, "currency": "USD"},
        {"amount": Decimal("0.25"), "currency": "Usd"},
    ])
    assert result["mixed"] is False
    assert result["usable"] is True
    assert result["combined"] == "14.75"
    assert result["currencies"] == {"USD": {"total": "14.75", "count": 3}}


def test_mixed_currency_aggregation_is_rejected():
    result = eq.aggregate_currency([
        {"amount": "100", "currency": "USD"},
        {"amount": "100000", "currency": "NGN"},
    ])
    assert result["mixed"] is True
    assert result["combined"] is None
    assert result["usable"] is False
    # Original currencies preserved, never a combined 100100.
    assert result["currencies"]["USD"]["total"] == "100.00"
    assert result["currencies"]["NGN"]["total"] == "100000.00"
    assert "100100" not in str(result["currencies"])


def test_unknown_currency_is_quarantined():
    result = eq.aggregate_currency([
        {"amount": "5", "currency": "USD"},
        {"amount": "7", "currency": None},
        {"amount": "9", "currency": "$"},  # symbol, not a code
    ])
    assert result["usable"] is False
    assert result["reason"].startswith("one or more amounts have an unknown")
    assert len(result["unknown_currency_amounts"]) == 2


def test_invalid_currency_code_is_rejected():
    assert eq.normalize_currency("US") is None
    assert eq.normalize_currency("USDA") is None
    assert eq.normalize_currency(123) is None
    assert eq.normalize_currency("$") is None


def test_currency_decimal_precision_and_rounding():
    result = eq.aggregate_currency([
        {"amount": "0.1", "currency": "USD"},
        {"amount": "0.2", "currency": "USD"},
    ])
    # 0.1 + 0.2 must be exactly 0.30 (no floating point 0.30000000000000004).
    assert result["combined"] == "0.30"
    # ROUND_HALF_UP: 1.005 -> 1.01 (not banker's 1.00).
    result2 = eq.aggregate_currency([{"amount": "1.005", "currency": "USD"}])
    assert result2["combined"] == "1.01"


def test_cross_currency_comparison_rejected_without_conversion():
    result = eq.compare_currency({"amount": "100", "currency": "USD"},
                                 {"amount": "100000", "currency": "NGN"})
    assert result["comparable"] is False
    assert result["a"]["currency"] == "USD" and result["b"]["currency"] == "NGN"


def test_cross_currency_comparison_with_documented_conversion():
    # Convention: 1 USD == 1600 NGN. 160000 NGN therefore equals 100 USD.
    result = eq.compare_currency(
        {"amount": "100", "currency": "USD"}, {"amount": "160000", "currency": "NGN"},
        conversion={"from_currency": "USD", "to_currency": "NGN", "rate": "1600",
                    "documented": True, "source": "fx-table", "rate_at": "2026-11-07T00:00:00Z"},
    )
    assert result["comparable"] is True
    assert result["basis"] == "explicit_conversion"
    assert result["conversion"]["source"] == "fx-table"
    assert result["higher"] == "equal"
    assert result["difference"] == "0.00"


def test_cross_currency_comparison_direction_is_respected():
    # Same documented rate expressed the other way must give the same answer.
    result = eq.compare_currency(
        {"amount": "160000", "currency": "NGN"}, {"amount": "100", "currency": "USD"},
        conversion={"from_currency": "USD", "to_currency": "NGN", "rate": "1600",
                    "documented": True, "source": "fx-table"},
    )
    assert result["comparable"] is True and result["higher"] == "equal"


def test_cross_currency_comparison_rejects_undocumented_conversion():
    result = eq.compare_currency(
        {"amount": "100", "currency": "USD"}, {"amount": "160000", "currency": "NGN"},
        conversion={"from_currency": "USD", "to_currency": "NGN", "rate": "1600",
                    "documented": False, "source": None},
    )
    assert result["comparable"] is False


def test_same_currency_comparison():
    result = eq.compare_currency({"amount": "100", "currency": "USD"}, {"amount": "90", "currency": "USD"})
    assert result["comparable"] is True and result["basis"] == "same_currency"
    assert result["higher"] == "a" and result["difference"] == "10.00"


def test_currency_preserved_through_item():
    item = _make_item("x", "30.31", UNIT_CURRENCY, "usd", "available",
                      ("complete", True), "fresh", "orders", "c1", _window())
    assert item["currency"] == "USD"
    q = eq.quality_of(item)
    assert q["currency_integrity"] == eq.CURRENCY_SINGLE


# =========================================================================
# B. Zero vs missing (Task 208)
# =========================================================================

def test_verified_zero_amount():
    r = eq.classify_zero_value({"value": 0, "kind": "amount", "coverage_complete": True,
                                "authorized": True, "sync_state": "ok", "queried": True})
    assert r["state"] == "verified_zero" and r["verified_zero"] is True


def test_verified_zero_count_no_match():
    r = eq.classify_zero_value({"value": 0, "kind": "count", "records_found": 0,
                                "coverage_complete": True, "authorized": True,
                                "sync_state": "ok", "queried": True})
    assert r["state"] == "no_match_verified_population" and r["verified_zero"] is True


def test_zero_over_incomplete_coverage_is_not_verified():
    r = eq.classify_zero_value({"value": 0, "coverage_complete": False,
                                "authorized": True, "sync_state": "ok", "queried": True})
    assert r["state"] == "incomplete_coverage" and r["verified_zero"] is False


def test_missing_record():
    r = eq.classify_zero_value({"value": None, "authorized": True, "sync_state": "ok",
                                "queried": True, "records_found": None})
    assert r["state"] == "missing_record" and r["verified_zero"] is False


def test_null_field_is_not_zero():
    r = eq.classify_zero_value({"value": None, "value_is_null_field": True, "records_found": 4,
                                "coverage_complete": True, "authorized": True,
                                "sync_state": "ok", "queried": True})
    assert r["state"] == "null_field" and r["verified_zero"] is False


def test_failed_sync_is_not_zero():
    r = eq.classify_zero_value({"value": None, "authorized": True, "sync_state": "failed",
                                "queried": False})
    assert r["state"] == "failed_or_incomplete_sync" and r["verified_zero"] is False


def test_unauthorized_source_is_not_zero():
    r = eq.classify_zero_value({"value": None, "authorized": False})
    assert r["state"] == "unauthorized_or_unavailable"


def test_zero_denominator_safe():
    r = eq.safe_ratio(1, 0)
    assert r["ok"] is False and r["reason"] == "zero_denominator" and r["value"] is None
    assert "nan" not in str(r["value"]).lower()


def test_zero_percent_baseline_safe():
    r = eq.safe_percent_change(10, 0)
    assert r["ok"] is False and r["percent"] is None


def test_no_nan_or_infinity_in_outputs():
    assert eq.safe_ratio(float("nan"), 1)["ok"] is False
    assert eq.safe_ratio(float("inf"), 1)["ok"] is False
    r = eq.aggregate_currency([{"amount": float("inf"), "currency": "USD"}])
    assert r["usable"] is False


# =========================================================================
# C. Incomplete evidence fallback / sufficiency (Task 209)
# =========================================================================

def test_complete_fresh_evidence_is_sufficient():
    item = _make_item("x", "100.00", UNIT_CURRENCY, "USD", "available",
                      ("complete", True), "fresh", "orders", "s1", _window())
    q = eq.quality_of(item)
    assert q["sufficiency"] == "sufficient" and q["reasons"] == []


def test_partial_coverage_is_partial():
    item = _make_item("x", "100.00", UNIT_CURRENCY, "USD", "available",
                      ("partial", False), "fresh", "orders", "s2", _window())
    q = eq.quality_of(item)
    assert q["sufficiency"] == "partial"
    assert "partial_coverage" in q["reasons"]


def test_unauthorized_is_unavailable():
    item = _make_item("x", None, UNIT_CURRENCY, None, "unauthorized",
                      ("unknown", False), "unknown", "orders", "s3", _window())
    q = eq.quality_of(item)
    assert q["sufficiency"] == "unavailable"
    assert q["availability"] == "unauthorized"


def test_retrieval_failed_is_unavailable():
    item = _make_item("x", None, UNIT_CURRENCY, None, "retrieval_failed",
                      ("unknown", False), "unknown", "orders", "s4", _window())
    q = eq.quality_of(item)
    assert q["sufficiency"] == "unavailable"
    assert q["freshness"] == "failed"


def test_not_synchronized_is_unavailable():
    item = _make_item("x", None, UNIT_COUNT, None, "not_synchronized",
                      ("unknown", False), "never_synchronized", "orders", "s5", _window())
    q = eq.quality_of(item)
    assert q["sufficiency"] == "unavailable"
    assert q["availability"] == "not_synchronized"
    assert q["freshness"] == "never_synchronized"


def test_syncing_is_not_sufficient_for_current():
    item = _make_item("x", 5, UNIT_COUNT, None, "pending",
                      ("unknown", False), "synchronizing", "orders", "s6", _window())
    q = eq.quality_of(item)
    assert q["sufficiency"] != "sufficient"
    assert "synchronizing_for_current_claim" in q["reasons"]


def test_valid_conclusion_from_partial_evidence():
    # A fresh, available item with a real value supports a conclusion even if a
    # *different* dimension (coverage) is partial - it is partial, not discarded.
    item = _make_item("x", "42.00", UNIT_CURRENCY, "USD", "available",
                      ("partial", False), "fresh", "orders", "s7", _window())
    q = eq.quality_of(item)
    assert q["value_state"] == "observed_nonzero"
    assert q["sufficiency"] == "partial"


# =========================================================================
# D. Source-specific freshness (Task 210)
# =========================================================================

def test_fresh_evidence():
    r = eq.evaluate_freshness(as_of=NOW - timedelta(seconds=60), last_successful_sync=None,
                              now=NOW, policy_seconds=3600, question="current")
    assert r["state"] == "fresh" and r["supports_current_claim"] is True


def test_aging_evidence():
    r = eq.evaluate_freshness(as_of=NOW - timedelta(seconds=7200), last_successful_sync=None,
                              now=NOW, policy_seconds=3600, question="current")
    assert r["state"] == "aging" and r["supports_current_claim"] is True


def test_stale_evidence_blocks_current_claim():
    r = eq.evaluate_freshness(as_of=NOW - timedelta(days=6), last_successful_sync=None,
                              now=NOW, policy_seconds=3600, question="current")
    assert r["state"] == "stale" and r["supports_current_claim"] is False


def test_never_synchronized():
    r = eq.evaluate_freshness(as_of=None, last_successful_sync=None, now=NOW,
                              policy_seconds=3600, question="current")
    assert r["state"] == "never_synchronized" and r["supports_current_claim"] is False


def test_failed_sync():
    r = eq.evaluate_freshness(as_of=NOW, last_successful_sync=None, now=NOW,
                              policy_seconds=3600, sync_state="failed", question="current")
    assert r["state"] == "failed" and r["supports_current_claim"] is False


def test_synchronizing():
    r = eq.evaluate_freshness(as_of=None, last_successful_sync=None, now=NOW,
                              policy_seconds=3600, sync_state="synchronizing", question="current")
    assert r["state"] == "synchronizing" and r["supports_current_claim"] is False


def test_historical_question_with_old_evidence():
    r = eq.evaluate_freshness(
        as_of=datetime(2026, 10, 15, 12, 0, 0, tzinfo=timezone.utc), last_successful_sync=None,
        now=NOW, policy_seconds=3600, question="historical",
        period={"start": "2026-10-01T00:00:00Z", "end": "2026-11-01T00:00:00Z"},
    )
    # Old relative to now, but valid for the October historical window.
    assert r["state"] == "stale"
    assert r["supports_historical_claim"] is True


def test_source_specific_thresholds():
    # Inventory has a tighter policy (1800s) than orders (3600s); the same 45
    # minute age is "aging" for inventory but still "fresh" for orders.
    age = NOW - timedelta(minutes=45)
    inv = eq.evaluate_freshness(as_of=age, last_successful_sync=None, now=NOW,
                                policy_seconds=1800, question="current")
    orders = eq.evaluate_freshness(as_of=age, last_successful_sync=None, now=NOW,
                                   policy_seconds=3600, question="current")
    assert inv["state"] == "aging" and inv["supports_current_claim"] is True
    assert orders["state"] == "fresh" and orders["supports_current_claim"] is True


# =========================================================================
# E. Contradiction handling (Task 211)
# =========================================================================

def test_conflicting_current_values_unresolved():
    a = _make_item("net_revenue", "100.00", UNIT_CURRENCY, "USD", "available",
                   ("complete", True), "fresh", "orders", "cA", _window())
    b = _make_item("net_revenue", "90.00", UNIT_CURRENCY, "USD", "available",
                   ("complete", True), "fresh", "checkout", "cB", _window())
    conflicts = eq.detect_contradictions([a, b])
    assert len(conflicts) == 1
    assert conflicts[0]["resolved"] is False
    assert conflicts[0]["confidence_impact"] == "reduce"
    assert conflicts[0]["values"] == ["90.00", "100.00"]  # numeric order


def test_different_periods_are_not_contradictions():
    a = _make_item("net_revenue", "100.00", UNIT_CURRENCY, "USD", "available",
                   ("complete", True), "fresh", "orders", "pA", _window(1))
    b = _make_item("net_revenue", "90.00", UNIT_CURRENCY, "USD", "available",
                   ("complete", True), "fresh", "orders", "pB", _window(2))
    assert eq.detect_contradictions([a, b]) == []


def test_different_currencies_are_not_contradictions():
    a = _make_item("net_revenue", "100.00", UNIT_CURRENCY, "USD", "available",
                   ("complete", True), "fresh", "orders", "uA", _window())
    b = _make_item("net_revenue", "100.00", UNIT_CURRENCY, "NGN", "available",
                   ("complete", True), "fresh", "orders", "uB", _window())
    assert eq.detect_contradictions([a, b]) == []


def test_different_metrics_are_not_contradictions():
    a = _make_item("net_revenue", "100.00", UNIT_CURRENCY, "USD", "available",
                   ("complete", True), "fresh", "orders", "mA", _window())
    b = _make_item("gross_revenue", "90.00", UNIT_CURRENCY, "USD", "available",
                   ("complete", True), "fresh", "orders", "mB", _window())
    assert eq.detect_contradictions([a, b]) == []


def test_duplicate_identical_values_are_not_contradictions():
    a = _make_item("net_revenue", "100.00", UNIT_CURRENCY, "USD", "available",
                   ("complete", True), "fresh", "orders", "dA", _window())
    b = _make_item("net_revenue", "100.00", UNIT_CURRENCY, "USD", "available",
                   ("complete", True), "fresh", "orders", "dB", _window())
    assert eq.detect_contradictions([a, b]) == []


def test_source_of_truth_resolves_conflict():
    a = _make_item("net_revenue", "100.00", UNIT_CURRENCY, "USD", "available",
                   ("complete", True), "fresh", "orders", "tA", _window())
    b = _make_item("net_revenue", "90.00", UNIT_CURRENCY, "USD", "available",
                   ("complete", True), "fresh", "checkout", "tB", _window())
    conflicts = eq.detect_contradictions([a, b], source_of_truth={"net_revenue": "orders"})
    assert conflicts[0]["resolved"] is True
    assert conflicts[0]["winner_id"] == a["id"]
    assert conflicts[0]["resolution"] == "source_of_truth"


def test_recency_supersedes_stale():
    a = _make_item("net_revenue", "100.00", UNIT_CURRENCY, "USD", "available",
                   ("complete", True), "fresh", "orders", "rA", _window())
    b = _make_item("net_revenue", "90.00", UNIT_CURRENCY, "USD", "stale",
                   ("complete", True), "stale", "orders", "rB", _window())
    conflicts = eq.detect_contradictions([a, b])
    assert conflicts[0]["resolved"] is True
    assert conflicts[0]["resolution"] == "recency_supersession"
    assert conflicts[0]["winner_id"] == a["id"]


def test_unresolvable_conflict_never_averages():
    a = _make_item("net_revenue", "100.00", UNIT_CURRENCY, "USD", "available",
                   ("complete", True), "fresh", "orders", "x1", _window())
    b = _make_item("net_revenue", "80.00", UNIT_CURRENCY, "USD", "available",
                   ("complete", True), "fresh", "checkout", "x2", _window())
    conflicts = eq.detect_contradictions([a, b])
    assert conflicts[0]["resolved"] is False
    # No averaged 90.00 winner is invented.
    assert conflicts[0]["winner_value"] is None


# =========================================================================
# F. Six-dimension independence + collection rollup
# =========================================================================

def test_available_but_stale_is_represented_independently():
    item = _make_item("x", "100.00", UNIT_CURRENCY, "USD", "stale",
                      ("complete", True), "stale", "orders", "i1", _window())
    q = eq.quality_of(item)
    assert q["availability"] == "available"
    assert q["freshness"] == "stale"
    assert q["sufficiency"] == "partial"
    assert "stale_for_current_claim" in q["reasons"]


def test_fresh_but_incomplete_is_represented_independently():
    item = _make_item("x", "100.00", UNIT_CURRENCY, "USD", "available",
                      ("partial", False), "fresh", "orders", "i2", _window())
    q = eq.quality_of(item)
    assert q["freshness"] == "fresh" and q["coverage"] == "partial"


def test_complete_but_conflicting():
    a = _make_item("x", "100.00", UNIT_CURRENCY, "USD", "available",
                   ("complete", True), "fresh", "orders", "i3a", _window())
    b = _make_item("x", "90.00", UNIT_CURRENCY, "USD", "available",
                   ("complete", True), "fresh", "checkout", "i3b", _window())
    conflicts = eq.detect_contradictions([a, b])
    assert conflicts[0]["contradictory"] is True
    # Each item alone is complete+available; the conflict is a collection fact.
    assert eq.quality_of(a)["coverage"] == "complete"


def test_collection_rollup_is_worst_and_preserves_zero():
    good = _make_item("x", "100.00", UNIT_CURRENCY, "USD", "available",
                      ("complete", True), "fresh", "orders", "g", _window())
    zero = _make_item("y", 0, UNIT_COUNT, None, "verified_zero",
                      ("complete", True), "fresh", "orders", "z", _window())
    bad = _make_item("z", None, UNIT_CURRENCY, None, "unavailable",
                     ("unknown", False), "unknown", "orders", "b", _window())
    rollup = eq.quality_of_collection([good, zero, bad])
    assert rollup["overall_sufficiency"] == "unavailable"
    # The verified zero is preserved as its own item, not lost.
    states = {it["id"]: it["value_state"] for it in rollup["items"]}
    assert states[zero["id"]] == "verified_zero"
    assert rollup["item_count"] == 3


def test_collection_mixed_currency_integrity():
    a = _make_item("x", "100.00", UNIT_CURRENCY, "USD", "available",
                   ("complete", True), "fresh", "orders", "m1", _window())
    b = _make_item("y", "100.00", UNIT_CURRENCY, "NGN", "available",
                   ("complete", True), "fresh", "orders", "m2", _window())
    assert eq.quality_of_collection([a, b])["currency_integrity"] == "mixed_not_comparable"


# =========================================================================
# G. Security / tenant isolation
# =========================================================================

def test_quality_never_crosses_store_scope():
    # store-scoped item must carry exactly its store; quality derivation keeps it.
    with evidence_context(ORG, [STORE]):
        item = evidence_item(
            "x", label="l", value="1.00", unit=UNIT_CURRENCY, currency="USD",
            window=_window(), source="orders", definition="d", store_scope="store",
            coverage={"complete": True, "status": "complete"},
            freshness={"state": "fresh", "as_of": None, "age_seconds": 1, "policy": "1s", "note": "n"},
        )
    q = eq.quality_of(item)
    assert item["store_ids"] == [STORE]
    assert q["availability"] == "available"


def test_non_numeric_units_have_no_value_state():
    with evidence_context(ORG, [STORE]):
        item = evidence_item(
            "ref", label="l", value={"id": "abc"}, unit="reference",
            window=_window(), source="orders", definition="d",
        )
    assert eq.quality_of(item)["value_state"] == "not_applicable"
    assert eq.quality_of(item)["currency_integrity"] == "not_applicable"
