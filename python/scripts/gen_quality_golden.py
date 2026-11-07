"""Generate golden outputs from the Python evidence-quality module.

Run:  python scripts/gen_quality_golden.py
Writes Backend/src/services/__tests__/revEvidenceQuality.golden.json so the
Node mirror can be asserted against byte-identical expected values.
Deterministic timestamps only.
"""
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.intelligence import evidence_quality as eq  # noqa: E402

NOW = "2026-11-07T12:00:00+00:00"
NOW_DT = datetime.fromisoformat(NOW)
ORG = "org-1"
STORE = "store-1"
WINDOW = {"start": (NOW_DT - timedelta(days=1)).isoformat(),
          "end": NOW_DT.isoformat(), "timezone": "UTC", "semantics": "[start, end)"}


def item(id_, metric, status, unit, currency, value, cov_status, cov_complete,
         period_status, fresh_state, source, domain=None, extra=None):
    it = {
        "id": id_, "metric": metric, "status": status, "unit": unit,
        "currency": currency, "value": value,
        "period": dict(WINDOW), "store_ids": [STORE], "organization_id": ORG,
        "source": {"system": "shopify", "resource": source, "references": []},
        "coverage": {"status": cov_status, "complete": cov_complete,
                     "period_status": period_status, "source": source, "note": "n"},
        "freshness": {"state": fresh_state, "as_of": None, "age_seconds": 10,
                      "policy": "3600s", "note": "n"},
    }
    if domain:
        it["domain"] = domain
    if extra:
        it.update(extra)
    return it


ITEMS = {
    "healthy": item("ev-a1", "net_revenue", "available", "currency", "USD", "100.00",
                    "complete", True, "covered", "fresh", "orders"),
    "stale": item("ev-a2", "net_revenue", "stale", "currency", "USD", "100.00",
                  "complete", True, "covered", "stale", "orders"),
    "partial_coverage": item("ev-a3", "net_revenue", "available", "currency", "USD",
                             "100.00", "partial", False, "partial", "fresh", "orders"),
    "unauthorized": item("ev-a4", "net_revenue", "unauthorized", "currency", None,
                         None, "missing_authorization", False, "unavailable",
                         "unknown", "orders"),
    "retrieval_failed": item("ev-a5", "net_revenue", "retrieval_failed", "currency",
                             None, None, "retrieval_failed", False, "unavailable",
                             "unknown", "orders"),
    "not_synchronized": item("ev-a6", "net_revenue", "not_synchronized", "count",
                             None, None, "not_synchronized", False, "unavailable",
                             "never_synchronized", "orders"),
    "synchronizing": item("ev-a7", "active_checkouts", "pending", "count", None, 5,
                          "unknown", False, "unavailable", "synchronizing", "orders"),
    "verified_zero": item("ev-a8", "refunds", "verified_zero", "currency", "USD",
                          0, "complete", True, "covered", "fresh", "refunds"),
    "zero_incomplete": item("ev-a9", "refunds", "available", "currency", "USD",
                            0, "partial", False, "partial", "fresh", "refunds"),
    "null_field": item("ev-a10", "net_revenue", "available", "currency", "USD",
                       None, "complete", True, "covered", "fresh", "orders"),
    "unsupported_currency": item("ev-a11", "net_revenue", "unsupported", "currency",
                                 None, None, "unsupported", False, "unavailable",
                                 "fresh", "orders"),
    "contradictory": item("ev-a12", "net_revenue", "contradictory", "currency",
                          "USD", "100.00", "complete", True, "covered", "fresh",
                          "orders"),
    "record_unit": item("ev-a13", "latest_order", "available", "record", None,
                        {"id": "abc"}, "complete", True, "current_snapshot",
                        "fresh", "orders"),
    "ratio_unit": item("ev-a14", "refund_rate", "available", "ratio", None,
                       0.5, "complete", True, "covered", "fresh", "refunds"),
}

golden = {
    "quality_of": {name: eq.quality_of(it) for name, it in ITEMS.items()},

    "aggregate_currency": {
        "single": eq.aggregate_currency([
            {"amount": "10.50", "currency": "usd"},
            {"amount": 4, "currency": "USD"},
            {"amount": "0.25", "currency": "Usd"},
        ]),
        "mixed": eq.aggregate_currency([
            {"amount": "100", "currency": "USD"},
            {"amount": "100000", "currency": "NGN"},
        ]),
        "unknown": eq.aggregate_currency([
            {"amount": "5", "currency": "USD"},
            {"amount": "7", "currency": None},
            {"amount": "9", "currency": "$"},
        ]),
        "precision": eq.aggregate_currency([
            {"amount": "0.1", "currency": "USD"}, {"amount": "0.2", "currency": "USD"},
        ]),
        "rounding": eq.aggregate_currency([{"amount": "1.005", "currency": "USD"}]),
        "inf": eq.aggregate_currency([{"amount": "inf", "currency": "USD"}]),
        "empty": eq.aggregate_currency([]),
    },

    "compare_currency": {
        "same": eq.compare_currency({"amount": "100", "currency": "USD"},
                                    {"amount": "90", "currency": "USD"}),
        "none": eq.compare_currency({"amount": "100", "currency": "USD"},
                                    {"amount": "160000", "currency": "NGN"}),
        "documented": eq.compare_currency(
            {"amount": "100", "currency": "USD"}, {"amount": "160000", "currency": "NGN"},
            conversion={"from_currency": "USD", "to_currency": "NGN", "rate": "1600",
                        "documented": True, "source": "fx-table",
                        "rate_at": "2026-11-07T00:00:00Z"}),
        "documented_reverse": eq.compare_currency(
            {"amount": "160000", "currency": "NGN"}, {"amount": "100", "currency": "USD"},
            conversion={"from_currency": "USD", "to_currency": "NGN", "rate": "1600",
                        "documented": True, "source": "fx-table"}),
        "undocumented": eq.compare_currency(
            {"amount": "100", "currency": "USD"}, {"amount": "160000", "currency": "NGN"},
            conversion={"from_currency": "USD", "to_currency": "NGN", "rate": "1600",
                        "documented": False, "source": None}),
        "wrong_pair": eq.compare_currency(
            {"amount": "100", "currency": "USD"}, {"amount": "160000", "currency": "NGN"},
            conversion={"from_currency": "EUR", "to_currency": "GBP", "rate": "840",
                        "documented": True, "source": "fx"}),
        "zero_rate": eq.compare_currency(
            {"amount": "100", "currency": "USD"}, {"amount": "160000", "currency": "NGN"},
            conversion={"from_currency": "USD", "to_currency": "NGN", "rate": "0",
                        "documented": True, "source": "fx"}),
    },

    "classify_zero_value": {
        "verified_zero_amount": eq.classify_zero_value(
            {"value": 0, "kind": "amount", "coverage_complete": True, "authorized": True,
             "sync_state": "ok", "queried": True}),
        "verified_zero_count": eq.classify_zero_value(
            {"value": 0, "kind": "count", "records_found": 0, "coverage_complete": True,
             "authorized": True, "sync_state": "ok", "queried": True}),
        "incomplete": eq.classify_zero_value(
            {"value": 0, "coverage_complete": False, "authorized": True,
             "sync_state": "ok", "queried": True}),
        "missing": eq.classify_zero_value(
            {"value": None, "authorized": True, "sync_state": "ok", "queried": True}),
        "null_field": eq.classify_zero_value(
            {"value": None, "value_is_null_field": True, "records_found": 4,
             "coverage_complete": True, "authorized": True, "sync_state": "ok",
             "queried": True}),
        "records_but_null": eq.classify_zero_value(
            {"value": None, "records_found": 4, "coverage_complete": True,
             "authorized": True, "sync_state": "ok", "queried": True}),
        "failed_sync": eq.classify_zero_value(
            {"value": None, "authorized": True, "sync_state": "failed", "queried": False}),
        "never_synced": eq.classify_zero_value(
            {"value": None, "authorized": True, "sync_state": "never", "queried": False}),
        "unauthorized": eq.classify_zero_value({"value": None, "authorized": False}),
        "nonzero": eq.classify_zero_value(
            {"value": 7, "coverage_complete": True, "authorized": True,
             "sync_state": "ok", "queried": True}),
    },

    "safe_ratio": {
        "ok": eq.safe_ratio(10, 4),
        "third": eq.safe_ratio(1, 3),
        "zero_denominator": eq.safe_ratio(1, 0),
        "nan": eq.safe_ratio(float("nan"), 1),
        "inf": eq.safe_ratio(float("inf"), 1),
    },

    "safe_percent_change": {
        "up": eq.safe_percent_change(30, 20),
        "down": eq.safe_percent_change(10, 20),
        "zero_baseline": eq.safe_percent_change(10, 0),
        "negative_baseline": eq.safe_percent_change(10, -5),
        "missing": eq.safe_percent_change(None, 20),
    },

    "evaluate_freshness": {
        "fresh": eq.evaluate_freshness(as_of=NOW_DT - timedelta(seconds=60),
                                       last_successful_sync=None, now=NOW_DT,
                                       policy_seconds=3600, question="current"),
        "aging": eq.evaluate_freshness(as_of=NOW_DT - timedelta(seconds=7200),
                                       last_successful_sync=None, now=NOW_DT,
                                       policy_seconds=3600, question="current"),
        "stale": eq.evaluate_freshness(as_of=NOW_DT - timedelta(days=6),
                                       last_successful_sync=None, now=NOW_DT,
                                       policy_seconds=3600, question="current"),
        "never": eq.evaluate_freshness(as_of=None, last_successful_sync=None,
                                       now=NOW_DT, policy_seconds=3600, question="current"),
        "failed": eq.evaluate_freshness(as_of=NOW_DT, last_successful_sync=None,
                                        now=NOW_DT, policy_seconds=3600,
                                        sync_state="failed", question="current"),
        "synchronizing": eq.evaluate_freshness(as_of=None, last_successful_sync=None,
                                               now=NOW_DT, policy_seconds=3600,
                                               sync_state="synchronizing", question="current"),
        "historical_ok": eq.evaluate_freshness(
            as_of=datetime(2026, 10, 15, 12, 0, 0, tzinfo=timezone.utc),
            last_successful_sync=None, now=NOW_DT, policy_seconds=3600,
            question="historical",
            period={"start": "2026-10-01T00:00:00Z", "end": "2026-11-01T00:00:00Z"}),
        "historical_before_period": eq.evaluate_freshness(
            as_of=datetime(2026, 9, 15, 12, 0, 0, tzinfo=timezone.utc),
            last_successful_sync=None, now=NOW_DT, policy_seconds=3600,
            question="historical",
            period={"start": "2026-10-01T00:00:00Z", "end": "2026-11-01T00:00:00Z"}),
        "inventory_aging": eq.evaluate_freshness(as_of=NOW_DT - timedelta(minutes=45),
                                                 last_successful_sync=None, now=NOW_DT,
                                                 policy_seconds=1800, question="current"),
        "orders_fresh": eq.evaluate_freshness(as_of=NOW_DT - timedelta(minutes=45),
                                              last_successful_sync=None, now=NOW_DT,
                                              policy_seconds=3600, question="current"),
    },

    "detect_contradictions": {
        "unresolved": eq.detect_contradictions([
            dict(ITEMS["healthy"], id="ev-c1", source={"system": "shopify", "resource": "orders", "references": []}),
            item("ev-c2", "net_revenue", "available", "currency", "USD", "90.00",
                 "complete", True, "covered", "fresh", "checkout"),
        ]),
        "source_of_truth": eq.detect_contradictions(
            [dict(ITEMS["healthy"], id="ev-c1", source={"system": "shopify", "resource": "orders", "references": []}),
             item("ev-c3", "net_revenue", "available", "currency", "USD", "90.00",
                  "complete", True, "covered", "fresh", "checkout")],
            source_of_truth={"net_revenue": "orders"}),
        "recency": eq.detect_contradictions([
            dict(ITEMS["healthy"], id="ev-c1"),
            item("ev-c4", "net_revenue", "stale", "currency", "USD", "90.00",
                 "complete", True, "covered", "stale", "orders"),
        ]),
        "different_periods": eq.detect_contradictions([
            dict(ITEMS["healthy"], id="ev-c1"),
            item("ev-c5", "net_revenue", "available", "currency", "USD", "90.00",
                 "complete", True, "covered", "fresh", "orders",
                 extra={"period": {"start": (NOW_DT - timedelta(days=2)).isoformat(),
                                   "end": (NOW_DT - timedelta(days=1)).isoformat(),
                                   "timezone": "UTC", "semantics": "[start, end)"}}),
        ]),
        "different_currencies": eq.detect_contradictions([
            dict(ITEMS["healthy"], id="ev-c1"),
            item("ev-c6", "net_revenue", "available", "currency", "NGN", "90.00",
                 "complete", True, "covered", "fresh", "orders"),
        ]),
        "identical_values": eq.detect_contradictions([
            dict(ITEMS["healthy"], id="ev-c1"),
            item("ev-c7", "net_revenue", "available", "currency", "USD", "100.00",
                 "complete", True, "covered", "fresh", "orders"),
        ]),
    },

    "quality_of_collection": eq.quality_of_collection(
        [ITEMS["healthy"], ITEMS["verified_zero"], ITEMS["unauthorized"]]),
    "quality_of_collection_mixed": eq.quality_of_collection(
        [ITEMS["healthy"],
         item("ev-c8", "net_revenue", "available", "currency", "NGN", "100.00",
              "complete", True, "covered", "fresh", "orders")]),
}

out = ROOT.parent / "Backend" / "src" / "services" / "__tests__" / "revEvidenceQuality.golden.json"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(golden, indent=2, sort_keys=True) + "\n")
print(f"wrote {out} ({out.stat().st_size} bytes)")
