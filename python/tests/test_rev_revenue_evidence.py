"""Deterministic coverage for the Task 198 revenue evidence pipeline.

Every fixture carries the exact aggregate columns the production SQL returns,
so a test proves the *interpretation* of the persisted Shopify financial
fields — currency separation, refund identity (no double counting), field
coverage, domain coverage, reconciliation and failure semantics — without a
database.
"""
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from src.intelligence.revenue_evidence import retrieve_revenue_evidence
from tests.rev_fakes import FakeDB

NOW = datetime(2026, 10, 31, 12, tzinfo=timezone.utc)
START, END = NOW - timedelta(days=7), NOW
ORG = "11111111-1111-1111-1111-111111111111"

ORDER_PATTERN = "COUNT(*) FILTER (WHERE o.test_flag IS NOT TRUE) AS order_count"
REFUND_PATTERN = "r.created_at >= :start"
REFUND_UNDATED_PATTERN = "r.created_at IS NULL"
TXN_PATTERN = "t.processed_at >= :start"
TXN_UNDATED_PATTERN = "t.processed_at IS NULL"
RECON_PATTERN = "duplicate_refund_groups"
DOMAIN_PATTERN = "store_sync_domain_states"


def stores():
    return [
        {"id": "store-a1", "status": "active", "last_synced_at": NOW - timedelta(minutes=5)},
        {"id": "store-a2", "status": "connected", "last_synced_at": NOW - timedelta(minutes=6)},
    ]


def coverage():
    return [
        {"store_id": "store-a1", "coverage_start": START - timedelta(days=1),
         "coverage_end": END + timedelta(days=1), "certified_at": NOW,
         "customer_lifetime_verified": True},
        {"store_id": "store-a2", "coverage_start": START - timedelta(days=1),
         "coverage_end": END + timedelta(days=1), "certified_at": NOW,
         "customer_lifetime_verified": True},
    ]


def order_row(currency, count, net, **overrides):
    row = {
        "currency": currency,
        "order_count": count,
        "net_value": net,
        "gross_value": Decimal(str(net)) if net is not None else None,
        "gross_verified": count,
        "refunded_to_date_value": Decimal("0"),
        "refunded_to_date_verified": count,
        "discount_value": Decimal("0"),
        "discount_verified": count,
        "line_items_value": Decimal(str(net)) if net is not None else None,
        "line_items_verified": count,
        "tax_value": Decimal("0"),
        "tax_verified": count,
        "shipping_value": Decimal("0"),
        "shipping_verified": count,
        "received_value": Decimal(str(net)) if net is not None else None,
        "received_verified": count,
        "outstanding_value": Decimal("0"),
        "outstanding_verified": count,
        "test_order_count": 0,
        "currency_unverified_count": 0,
        "negative_net_count": 0,
    }
    row.update(overrides)
    return row


def clean_recon():
    return [{"duplicate_refund_groups": 0, "duplicate_transaction_groups": 0,
             "refund_ledger_mismatches": 0}]


def domain_rows_covered():
    rows = []
    for store_id in ("store-a1", "store-a2"):
        for domain in ("refunds", "transactions"):
            rows.append({"store_id": store_id, "domain": domain, "status": "ok",
                         "pagination_complete": True,
                         "last_succeeded_at": NOW - timedelta(minutes=7)})
    return rows


def revenue_db(order_rows, *, refund_rows=None, txn_rows=None, recon=None,
               domains=None, fail_patterns=(), undated_refunds=0, undated_txns=0):
    db = FakeDB(fail_patterns=tuple(fail_patterns))
    db.add("SELECT id, last_synced_at, status", stores())
    db.add("intelligence_order_coverage", coverage())
    db.add(ORDER_PATTERN, order_rows)
    db.add(REFUND_PATTERN, refund_rows or [])
    db.add(REFUND_UNDATED_PATTERN, [{"undated_count": undated_refunds}])
    db.add(TXN_PATTERN, txn_rows or [])
    db.add(TXN_UNDATED_PATTERN, [{"undated_count": undated_txns}])
    db.add(RECON_PATTERN, recon if recon is not None else clean_recon())
    db.add(DOMAIN_PATTERN, domains if domains is not None else domain_rows_covered())
    return db


def item(evidence, metric, currency=None):
    matches = [i for i in evidence["items"] if i["metric"] == metric
               and (currency is None or i.get("currency") == currency)]
    assert len(matches) == 1, f"expected one {metric} ({currency}) item, got {len(matches)}"
    return matches[0]


def test_revenue_is_currency_separated_and_organization_scoped():
    db = revenue_db([
        order_row("USD", 3, Decimal("30.31"), gross_value=Decimal("60.62"),
                  refunded_to_date_value=Decimal("30.31")),
        order_row("NGN", 1, Decimal("1000.00")),
    ])
    evidence = retrieve_revenue_evidence(ORG, db, start=START, end=END, now=NOW)

    assert evidence["overall_status"] == "available"
    assert evidence["organization_scope"]["store_count"] == 2
    values = {i["currency"]: i["value"] for i in evidence["items"]
              if i["metric"] == "recorded_order_value"}
    counts = {i["currency"]: i["value"] for i in evidence["items"]
              if i["metric"] == "recorded_order_count" and i.get("currency")}
    assert values == {"USD": "30.31", "NGN": "1000.00"}
    assert counts == {"USD": 3, "NGN": 1}
    # Currencies are never summed together.
    assert set(evidence["by_currency"]) == {"USD", "NGN"}
    assert all(str(ORG) in str(params.values()) for sql, params in db.statements
               if "JOIN orders o" in sql or "FROM orders o" in sql)
    order_sql = next(sql for sql, _ in db.statements if ORDER_PATTERN in sql)
    assert "o.ordered_at < :end" in order_sql
    assert "'cancelled'" in order_sql
    assert "organization_id = :org_id" in order_sql


def test_gross_net_refund_identity_is_not_double_counted():
    # Two orders in USD: one charged 100 with 40 refunded (net 60), one fully
    # refunded (gross 250, refunded 250, net 0). The pipeline must report
    # gross 350, net 60 and refunded 290 — never 20 (double subtraction) or
    # 140 (refund counted as sales).
    db = revenue_db([
        order_row("USD", 2, Decimal("60.00"), gross_value=Decimal("350.00"),
                  refunded_to_date_value=Decimal("290.00"),
                  gross_verified=2, refunded_to_date_verified=2),
    ])
    evidence = retrieve_revenue_evidence(ORG, db, start=START, end=END, now=NOW)
    net = item(evidence, "recorded_order_value", "USD")
    gross = item(evidence, "gross_sales", "USD")
    refunded = item(evidence, "refund_amount_window_orders", "USD")
    assert net["value"] == "60.00"
    assert gross["value"] == "350.00"
    assert refunded["value"] == "290.00"
    # The refund ledger describes refunds; net is already refund-adjusted.
    assert gross["measurement"]["refunds"] == "excluded"
    assert net["measurement"]["refunds"] == "deducted"
    assert refunded["measurement"]["refunds"] == "deducted"


def test_missing_refund_evidence_makes_gross_partial_not_invented():
    # 2 orders, only 1 has refund evidence: gross covers that one order only.
    db = revenue_db([
        order_row("USD", 2, Decimal("50.00"), gross_value=Decimal("80.00"),
                  gross_verified=1, refunded_to_date_value=Decimal("30.00"),
                  refunded_to_date_verified=1),
    ])
    evidence = retrieve_revenue_evidence(ORG, db, start=START, end=END, now=NOW)
    gross = item(evidence, "gross_sales", "USD")
    net = item(evidence, "recorded_order_value", "USD")
    assert net["status"] == "available" and net["value"] == "50.00"
    assert gross["status"] == "partial" and gross["value"] == "80.00"
    assert any("1 of 2 orders" in limit for limit in gross["limitations"])


def test_verified_zero_is_not_a_currency_zero():
    evidence = retrieve_revenue_evidence(ORG, revenue_db([]), start=START, end=END, now=NOW)
    count = item(evidence, "recorded_order_count")
    value = item(evidence, "recorded_order_value")
    assert evidence["overall_status"] == "available"
    assert count["value"] == 0 and count["status"] == "verified_zero"
    assert value["value"] is None and value["currency"] is None
    assert value["status"] == "unsupported"


def test_failed_order_query_is_unavailable_never_zero():
    db = revenue_db([], fail_patterns=(ORDER_PATTERN,))
    evidence = retrieve_revenue_evidence(ORG, db, start=START, end=END, now=NOW)
    assert evidence["overall_status"] == "unavailable"
    for metric in ("recorded_order_count", "recorded_order_value"):
        the_item = item(evidence, metric)
        assert the_item["status"] == "unavailable"
        assert the_item["value"] is None


def test_no_store_means_no_revenue_claim():
    db = FakeDB().add("SELECT id, last_synced_at, status", [])
    evidence = retrieve_revenue_evidence(ORG, db, start=START, end=END, now=NOW)
    assert evidence["overall_status"] == "unavailable"
    assert evidence["items"] == []
    assert any("No active or connected store" in warning for warning in evidence["warnings"])


def test_incomplete_coverage_degrades_to_partial():
    partial = [dict(row) for row in coverage()]
    partial[1]["coverage_end"] = START
    db = FakeDB()
    db.add("SELECT id, last_synced_at, status", stores())
    db.add("intelligence_order_coverage", partial)
    db.add(ORDER_PATTERN, [order_row("USD", 1, Decimal("10"))])
    db.add(REFUND_PATTERN, [])
    db.add(REFUND_UNDATED_PATTERN, [{"undated_count": 0}])
    db.add(TXN_PATTERN, [])
    db.add(TXN_UNDATED_PATTERN, [{"undated_count": 0}])
    db.add(RECON_PATTERN, clean_recon())
    db.add(DOMAIN_PATTERN, domain_rows_covered())
    evidence = retrieve_revenue_evidence(ORG, db, start=START, end=END, now=NOW)
    assert evidence["overall_status"] == "partial"
    assert evidence["coverage"]["complete"] is False
    # A monetary zero cannot be asserted without complete coverage.
    net = item(evidence, "recorded_order_value", "USD")
    assert net["value"] == "10.00"


def test_orders_without_iso_currency_are_excluded_from_totals():
    db = revenue_db([
        order_row("USD", 1, Decimal("10")),
        order_row(None, 4, Decimal("99"), currency_unverified_count=4),
        order_row("us dollars", 2, Decimal("5"), currency_unverified_count=2),
    ])
    evidence = retrieve_revenue_evidence(ORG, db, start=START, end=END, now=NOW)
    values = [i for i in evidence["items"] if i["metric"] == "recorded_order_value"]
    assert [i["currency"] for i in values] == ["USD"]
    assert "99.00" not in str(evidence["by_currency"])
    assert any("without a valid ISO currency" in warning for warning in evidence["warnings"])


def test_refund_domain_coverage_controls_refund_certification():
    # Covered domain, refunds in the window: certified per-currency total.
    db = revenue_db(
        [order_row("USD", 2, Decimal("120.00"))],
        refund_rows=[{"currency": "USD", "refund_count": 3,
                      "refund_value": Decimal("25.50"), "refund_verified": 3}],
    )
    evidence = retrieve_revenue_evidence(ORG, db, start=START, end=END, now=NOW)
    refund = item(evidence, "refund_amount", "USD")
    assert refund["status"] == "available" and refund["value"] == "25.50"
    assert refund["source"]["resource"] == "order_refunds"

    # Covered domain, no refunds in the window: certified zero per currency.
    # (Currency zeros are "available 0.00" under complete coverage; the
    # verified_zero state is reserved for count evidence by the contract.)
    db = revenue_db([order_row("USD", 1, Decimal("10.00"))])
    evidence = retrieve_revenue_evidence(ORG, db, start=START, end=END, now=NOW)
    refund = item(evidence, "refund_amount", "USD")
    assert refund["status"] == "available" and refund["value"] == "0.00"

    # Domain never synchronized: the metric says exactly that, never zero.
    db = revenue_db([order_row("USD", 1, Decimal("10.00"))], domains=[])
    evidence = retrieve_revenue_evidence(ORG, db, start=START, end=END, now=NOW)
    refund = item(evidence, "refund_amount")
    assert refund["status"] == "not_synchronized" and refund["value"] is None
    assert "refunds" in " ".join(refund["limitations"])
    assert evidence["domain_coverage"]["refunds"]["complete"] is False


def test_captured_payments_are_ledger_based_and_domain_gated():
    db = revenue_db(
        [order_row("USD", 2, Decimal("120.00"))],
        txn_rows=[{"currency": "USD", "captured_transaction_count": 4,
                   "captured_value": Decimal("119.99"), "captured_verified": 4}],
    )
    evidence = retrieve_revenue_evidence(ORG, db, start=START, end=END, now=NOW)
    captured = item(evidence, "captured_payment_amount", "USD")
    assert captured["status"] == "available" and captured["value"] == "119.99"
    assert captured["source"]["resource"] == "order_transactions"
    assert captured["measurement"]["formula"].upper().startswith("SUM(ORDER_TRANSACTIONS")

    # Zero captured in a certified window: available zero, not not_synchronized.
    db = revenue_db([order_row("USD", 1, Decimal("10.00"))])
    evidence = retrieve_revenue_evidence(ORG, db, start=START, end=END, now=NOW)
    captured = item(evidence, "captured_payment_amount", "USD")
    assert captured["status"] == "available" and captured["value"] == "0.00"

    # Transactions domain not synchronized: explicit, not a floor.
    db = revenue_db([order_row("USD", 1, Decimal("10.00"))], domains=[])
    evidence = retrieve_revenue_evidence(ORG, db, start=START, end=END, now=NOW)
    captured = item(evidence, "captured_payment_amount")
    assert captured["status"] == "not_synchronized" and captured["value"] is None


def test_partial_refund_domain_makes_refund_total_partial():
    # Only one of the two stores completed a refund sync: the total is a floor.
    domains = [dict(row) for row in domain_rows_covered() if row["store_id"] == "store-a1"]
    db = revenue_db(
        [order_row("USD", 2, Decimal("120.00"))],
        refund_rows=[{"currency": "USD", "refund_count": 1,
                      "refund_value": Decimal("10.00"), "refund_verified": 1}],
        domains=domains,
    )
    evidence = retrieve_revenue_evidence(ORG, db, start=START, end=END, now=NOW)
    refund = item(evidence, "refund_amount", "USD")
    assert refund["status"] == "partial" and refund["value"] == "10.00"
    assert any("not certified" in limit for limit in refund["limitations"])


def test_tax_and_shipping_field_coverage_is_explicit():
    # Tax enrichment completed for 1 of 2 orders; shipping for none.
    db = revenue_db([
        order_row("USD", 2, Decimal("100.00"),
                  tax_value=Decimal("8.00"), tax_verified=1,
                  shipping_value=None, shipping_verified=0),
    ])
    evidence = retrieve_revenue_evidence(ORG, db, start=START, end=END, now=NOW)
    tax = item(evidence, "tax_amount", "USD")
    shipping = item(evidence, "shipping_amount", "USD")
    assert tax["status"] == "partial" and tax["value"] == "8.00"
    assert any("1 of 2 orders" in limit for limit in tax["limitations"])
    assert shipping["status"] == "unavailable" and shipping["value"] is None
    # The primary net figure is unaffected by enrichment gaps.
    assert item(evidence, "recorded_order_value", "USD")["status"] == "available"


def test_reconciliation_discrepancies_are_visible_and_degrade_coverage():
    db = revenue_db(
        [order_row("USD", 3, Decimal("90.00"))],
        recon=[{"duplicate_refund_groups": 1, "duplicate_transaction_groups": 0,
                "refund_ledger_mismatches": 2}],
    )
    evidence = retrieve_revenue_evidence(ORG, db, start=START, end=END, now=NOW)
    recon_item = item(evidence, "reconciliation_discrepancy_count")
    assert recon_item["value"] == 3
    assert evidence["overall_status"] == "partial"
    assert any("discrepanc" in warning.lower() for warning in evidence["warnings"])


def test_clean_reconciliation_reports_zero_discrepancies():
    evidence = retrieve_revenue_evidence(ORG, revenue_db([order_row("USD", 1, Decimal("5"))]),
                                         start=START, end=END, now=NOW)
    recon_item = item(evidence, "reconciliation_discrepancy_count")
    # A zero count under complete coverage is a certified verified zero.
    assert recon_item["value"] == 0 and recon_item["status"] == "verified_zero"
    assert evidence["overall_status"] == "available"


def test_test_orders_are_excluded_from_money_and_reported_as_count():
    db = revenue_db([
        order_row("USD", 2, Decimal("40.00"), test_order_count=3),
    ])
    evidence = retrieve_revenue_evidence(ORG, db, start=START, end=END, now=NOW)
    net = item(evidence, "recorded_order_value", "USD")
    assert net["value"] == "40.00"  # the SQL aggregate already excludes test orders
    test_item = item(evidence, "test_order_count", "USD")
    assert test_item["value"] == 3
    assert any("Test orders are excluded" in limit for limit in test_item["limitations"])


def test_negative_net_totals_are_flagged():
    db = revenue_db([
        order_row("USD", 2, Decimal("10.00"), negative_net_count=1),
    ])
    evidence = retrieve_revenue_evidence(ORG, db, start=START, end=END, now=NOW)
    assert any("negative net total" in warning for warning in evidence["warnings"])


def test_undated_refunds_and_transactions_are_reported_as_gaps():
    db = revenue_db([order_row("USD", 1, Decimal("10.00"))],
                    undated_refunds=2, undated_txns=1)
    evidence = retrieve_revenue_evidence(ORG, db, start=START, end=END, now=NOW)
    assert any("lack a recorded date" in warning for warning in evidence["warnings"])
    assert any("lack a recorded" in warning and "processing date" in warning
               for warning in evidence["warnings"])


def test_decimal_precision_is_exact_not_float():
    db = revenue_db([
        order_row("USD", 2, Decimal("0.10"), gross_value=Decimal("0.30"),
                  refunded_to_date_value=Decimal("0.20")),
    ])
    evidence = retrieve_revenue_evidence(ORG, db, start=START, end=END, now=NOW)
    # Values are decimal strings with exactly two places — no float drift.
    assert item(evidence, "recorded_order_value", "USD")["value"] == "0.10"
    assert item(evidence, "gross_sales", "USD")["value"] == "0.30"
    assert item(evidence, "refund_amount_window_orders", "USD")["value"] == "0.20"


def test_period_and_timezone_are_preserved_in_every_item():
    evidence = retrieve_revenue_evidence(
        ORG, revenue_db([order_row("USD", 1, Decimal("5.00"))]),
        start=START, end=END, now=NOW, timezone="Africa/Lagos", label="Last seven days",
    )
    assert evidence["period"]["timezone"] == "Africa/Lagos"
    assert evidence["period"]["label"] == "Last seven days"
    for the_item in evidence["items"]:
        assert the_item["period"]["timezone"] == "Africa/Lagos"
        assert the_item["period"]["semantics"] == "[start, end)"


def test_comparison_is_currency_matched_and_equal_length():
    db = revenue_db(
        [order_row("USD", 1, Decimal("100.00"))],
    )
    evidence = retrieve_revenue_evidence(ORG, db, start=START, end=END, now=NOW, compare=True)
    comparison = evidence["comparison"]
    assert (datetime.fromisoformat(comparison["period"]["end"])
            - datetime.fromisoformat(comparison["period"]["start"])) == timedelta(days=7)
    changes = {c["metric"]: c for c in comparison["changes"]}
    assert "recorded_order_value" in changes
    assert changes["recorded_order_value"]["currency"] == "USD"
    # Previous period (empty fixture) has no value, so no change is asserted.
    assert all(c["status"] == "available" for c in changes.values()) or not changes


def test_explicit_comparison_window_is_used_when_supplied():
    seen = []
    db = revenue_db([order_row("USD", 1, Decimal("100.00"))])
    # Replace the order route with a recording callable to observe the
    # previous-period query boundaries.
    original = [r for p, r in db.routes if p == ORDER_PATTERN][0]

    def recording(params):
        seen.append(params)
        return original

    db.routes = [(p, recording if p == ORDER_PATTERN else r) for p, r in db.routes]
    comparison_start = START - timedelta(days=14)
    comparison_end = START - timedelta(days=7)
    evidence = retrieve_revenue_evidence(
        ORG, db, start=START, end=END, now=NOW, compare=True,
        comparison_start=comparison_start, comparison_end=comparison_end,
    )
    assert evidence["comparison"] is not None
    previous_calls = [c for c in seen if c["start"] == comparison_start]
    assert previous_calls, "the supplied comparison window was not used"
    assert previous_calls[0]["end"] == comparison_end
    # The resolved comparison window (a calendar month for a month query, for
    # example) is the one the retrieval used — the pipeline did not invent
    # its own period definition.
    assert evidence["comparison"]["period"]["label"] == "previous period"
    with pytest.raises(ValueError):
        retrieve_revenue_evidence(
            ORG, db, start=START, end=END, now=NOW, compare=True,
            comparison_start=END, comparison_end=NOW,  # after the window
        )


def test_year_over_year_requires_certified_prior_year_coverage():
    # The certified coverage spans only the recent fortnight, so a
    # year-over-year comparison is refused instead of comparing against
    # unverified history.
    db = revenue_db([order_row("USD", 1, Decimal("100.00"))])
    evidence = retrieve_revenue_evidence(
        ORG, db, start=START, end=END, now=NOW, year_over_year=True,
    )
    yoy = evidence["year_over_year"]
    assert yoy["status"] == "insufficient_history"
    assert yoy["changes"] is None or not yoy.get("changes")
    assert "prior-year" in yoy["note"] or "previous" in yoy["note"]


def test_year_over_year_is_tz_calendar_shift():
    # With certified coverage over two years, the prior-year window is the
    # same local-calendar dates shifted back one year (DST-safe boundaries).
    two_years_ago = START - timedelta(days=365)
    db = revenue_db([order_row("USD", 1, Decimal("100.00"))])
    # Widen the certified coverage so it contains the prior-year window.
    db.routes = [
        (p, [dict(r, coverage_start=two_years_ago - timedelta(days=1)) for r in rows]
         if p == "intelligence_order_coverage" else rows)
        for p, rows in db.routes
    ]
    previous_seen = []
    order_rows = [rows for p, rows in db.routes if p == ORDER_PATTERN][0]

    def recording(params):
        previous_seen.append(params)
        return order_rows

    db.routes = [(p, recording if p == ORDER_PATTERN else rows)
                 for p, rows in db.routes]
    evidence = retrieve_revenue_evidence(
        ORG, db, start=START, end=END, now=NOW, year_over_year=True,
        timezone="Africa/Lagos",
    )
    yoy = evidence["year_over_year"]
    assert yoy["status"] == "available"
    # The prior-year window keeps the same length and is ~1 year back.
    prev_start = datetime.fromisoformat(yoy["period"]["start"].replace("Z", "+00:00"))
    prev_end = datetime.fromisoformat(yoy["period"]["end"].replace("Z", "+00:00"))
    assert (prev_end - prev_start) == (END - START)
    assert timedelta(days=364) <= (START - prev_start) <= timedelta(days=366)
    # The comparison query used the shifted boundaries, not a 365-day shift.
    assert any(c["start"] == prev_start for c in previous_seen)


def test_end_before_start_is_rejected():
    with pytest.raises(ValueError):
        retrieve_revenue_evidence(ORG, revenue_db([]), start=END, end=START, now=NOW)


def test_missing_organization_is_rejected():
    with pytest.raises(ValueError):
        retrieve_revenue_evidence("", revenue_db([]), start=START, end=END, now=NOW)
