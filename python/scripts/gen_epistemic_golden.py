"""Generate golden claim-validation outputs from the Python contract.

Run:  python scripts/gen_epistemic_golden.py
Writes Backend/src/services/__tests__/revEpistemics.golden.json so the Node
mirror (Backend/src/services/revEpistemics.js) can be asserted against the
same expected values. Fully deterministic: fixed org/store/ids, fixed
timestamps (``computed_at`` pinned after construction).
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.intelligence.epistemics import (  # noqa: E402
    build_calculation_claim,
    build_fact_claim,
    build_hypothesis_claim,
    build_unknown_claim,
    epistemic_rollup,
    validate_claim,
    validate_claims,
)

ORG = "11111111-1111-4111-8111-111111111111"
OTHER_ORG = "99999999-9999-4999-8999-999999999999"
STORES = ["store-a1"]
OTHER_STORES = ["store-b2"]
INVEST = "inv-golden-1"
FIXED_COMPUTED_AT = "2026-11-07T12:00:00Z"

PERIOD = {"start": "2026-11-06T12:00:00Z", "end": "2026-11-07T12:00:00Z",
          "timezone": "UTC", "label": "the last 24 hours"}


def item(iid="ev-aaaa", currency="USD", status="available"):
    return {
        "id": iid, "status": status, "currency": currency,
        "retrieved_at": "2026-11-07T12:00:00Z",
        "source": {"system": "shopify", "resource": "orders"},
        "quality": {"schema_version": "rev-evidence-quality-v1", "availability": "available",
                    "coverage": "complete", "freshness": "fresh", "value_state": "observed_nonzero",
                    "consistency": "consistent", "currency_integrity": "single_verified_currency",
                    "sufficiency": "sufficient", "reasons": []},
        "limitations": [],
    }


ITEMS = {
    "ev-aaaa": item("ev-aaaa"),
    "ev-bbbb": item("ev-bbbb"),
    "ev-unavailable": item("ev-unavailable", status="unavailable"),
}


def count_fact(**over):
    fact = {"text": "4 non-cancelled orders recorded", "evidence_ids": ["ev-aaaa"],
            "metric": "recorded_order_count", "value": 4, "unit": "count",
            "currency": None, "period": PERIOD, "source": "orders"}
    fact.update(over)
    return fact


def money_fact(**over):
    fact = {"text": "Recorded order value USD 30.31", "evidence_ids": ["ev-aaaa"],
            "metric": "recorded_order_value", "value": "30.31", "unit": "currency",
            "currency": "usd", "period": PERIOD, "source": "orders"}
    fact.update(over)
    return fact


def change(**over):
    c = {"metric": "recorded_order_value", "currency": "USD", "current": "30.31",
         "previous": "20.00", "percent": "51.55", "direction": "up",
         "current_evidence_id": "ev-aaaa", "previous_evidence_id": "ev-bbbb"}
    c.update(over)
    return c


def freeze(claim):
    if claim.get("computed_at") is not None:
        claim = dict(claim, computed_at=FIXED_COMPUTED_AT)
    return claim


def make_count():
    return freeze(build_fact_claim(count_fact(), organization_id=ORG, store_ids=STORES,
                                   investigation_id=INVEST, item=ITEMS["ev-aaaa"]))


def make_money():
    return freeze(build_fact_claim(money_fact(), organization_id=ORG, store_ids=STORES,
                                   investigation_id=INVEST, item=ITEMS["ev-aaaa"]))


def make_calc():
    return freeze(build_calculation_claim(
        change=change(), fact=count_fact(evidence_ids=["ev-aaaa", "ev-bbbb"]),
        organization_id=ORG, store_ids=STORES, investigation_id=INVEST,
        items_by_id=ITEMS))


def make_hypo():
    return freeze(build_hypothesis_claim(
        {"statement": "Possible contributor, not established.", "verified": False,
         "confidence": 0.2, "basis_evidence_ids": ["ev-aaaa"], "note": "Not a finding."},
        organization_id=ORG, store_ids=STORES, investigation_id=INVEST))


def make_unknown():
    return freeze(build_unknown_claim(
        "Abandonment reason not recorded.", organization_id=ORG, store_ids=STORES,
        investigation_id=INVEST, attempts=["checkout_observations"]))


def case(name, claim, *, known=None, organization_id=ORG, store_ids=STORES):
    return {
        "name": name,
        "claim": claim,
        "known_evidence": known if known is not None else dict(ITEMS),
        "organization_id": organization_id,
        "store_ids": store_ids,
        "errors": validate_claim(claim, known_evidence=known if known is not None else dict(ITEMS),
                                 organization_id=organization_id, store_ids=store_ids),
    }


def calc_case(name, mutation):
    claim = make_calc()
    mutation(claim)
    return case(name, claim)


def money_case(name, mutation):
    claim = make_money()
    mutation(claim)
    return case(name, claim)


CASES = [
    case("count_claim_valid", make_count()),
    case("money_claim_valid", make_money()),
    money_case("money_false_precision", lambda c: c.update(value="30.315")),
    money_case("money_missing_rounding", lambda c: c.update(rounding=None)),
    money_case("money_without_currency", lambda c: c.update(currency=None)),
    money_case("money_not_numeric", lambda c: c.update(value="thirty")),
    money_case("count_value_on_currency_claim", lambda c: c.update(value=4)),
    case("count_fractional", {**make_count(), "value": 4.5}),
    case("fact_cites_unknown_evidence", make_count(), known={}),
    case("fact_cites_unavailable_evidence",
         {**make_count(), "evidence_ids": ["ev-unavailable"]}, known=dict(ITEMS)),
    case("fact_currency_mismatch",
         {**make_money(), "evidence_ids": ["ev-unavailable"]} | {"currency": "USD"},
         known={"ev-unavailable": item("ev-unavailable", currency="NGN", status="available")}),
    case("cross_tenant", make_count(), organization_id=OTHER_ORG),
    case("cross_store", make_count(), store_ids=OTHER_STORES),
    case("established_claim_without_value", {**make_count(), "value": None}),
    case("unknown_contract_version", {**make_count(), "contract_version": "rev-claim-v0"}),
    case("invalid_grade", {**make_count(), "classification": "maybe"}),
    case("calculation_claim_valid", make_calc()),
    calc_case("calculation_missing_block", lambda c: c.update(calculation=None)),
    calc_case("calculation_missing_formula", lambda c: c["calculation"].update(formula="")),
    calc_case("calculation_missing_version", lambda c: c["calculation"].update(version="")),
    calc_case("calculation_missing_rounding", lambda c: c["calculation"].update(rounding="")),
    calc_case("calculation_no_inputs", lambda c: c["calculation"].update(inputs=[])),
    calc_case("calculation_input_missing_value", lambda c: c["calculation"].update(inputs=[
        {"role": "current", "evidence_id": "ev-aaaa", "value": "30.31", "currency": "USD"},
        {"role": "previous", "evidence_id": "ev-bbbb", "value": None, "currency": "USD"}])),
    calc_case("calculation_zero_denominator", lambda c: c["calculation"].update(inputs=[
        {"role": "current", "evidence_id": "ev-aaaa", "value": "30.31", "currency": "USD"},
        {"role": "previous", "evidence_id": "ev-bbbb", "value": 0, "currency": "USD"}])),
    calc_case("calculation_mixed_currencies", lambda c: c["calculation"].update(inputs=[
        {"role": "current", "evidence_id": "ev-aaaa", "value": "30.31", "currency": "USD"},
        {"role": "previous", "evidence_id": "ev-bbbb", "value": "1000.00", "currency": "NGN"}])),
    calc_case("calculation_input_unknown_evidence", lambda c: c["calculation"].update(inputs=[
        {"role": "current", "evidence_id": "ev-ghost", "value": "30.31", "currency": "USD"}])),
    calc_case("calculation_input_no_evidence_id", lambda c: c["calculation"].update(inputs=[
        {"role": "current", "evidence_id": None, "value": "30.31", "currency": "USD"}])),
    calc_case("calculation_percent_false_precision", lambda c: c.update(value="51.55")),
    case("hypothesis_valid", make_hypo()),
    case("hypothesis_claimed_verified",
         {**make_hypo(), "hypothesis": {**make_hypo()["hypothesis"], "verified": True}}),
    case("hypothesis_without_missing_evidence",
         {**make_hypo(), "hypothesis": {**make_hypo()["hypothesis"], "missing_evidence": []}}),
    case("hypothesis_carries_impact", {**make_hypo(), "financial_impact": "lost"}),
    case("hypothesis_without_block", {**make_hypo(), "hypothesis": None}),
    case("unknown_valid", make_unknown()),
    case("unknown_carries_value", {**make_unknown(), "value": 0}),
    case("unknown_without_block", {**make_unknown(), "unknown": None}),
    case("unknown_without_reason",
         {**make_unknown(), "unknown": {**make_unknown()["unknown"], "reason": "  "}}),
    money_case("asserted_impact_without_method", lambda c: c.update(financial_impact="lost")),
    money_case("potential_impact_on_fact", lambda c: c.update(financial_impact="potential")),
    money_case("observed_impact_on_fact", lambda c: c.update(financial_impact="observed")),
    case("unknown_impact_kind", {**make_money(), "financial_impact": "windfall"}),
    calc_case("recoverable_impact_on_calculation", lambda c: c.update(financial_impact="recoverable")),
    case("restated_claim_valid",
         {**make_money(), "restated": True, "source_investigation": "inv-0"}, known={}),
    case("restated_claim_without_source",
         {**make_money(), "restated": True}, known={}),
    case("restated_claim_without_id",
         {**make_money(), "restated": True, "source_investigation": "inv-0", "claim_id": "x"},
         known={}),
    case("percent_ratio_claim_valid",
         {**make_count(), "unit": "ratio", "value": 0.42, "rounding": None,
          "metric": "observed_checkout_completion_rate"}),
]

# validate_claims (set-level) golden: includes a non-object entry.
SET_CASE = {
    "claims": [make_calc(), make_money(), "not-a-dict"],
    "items": [ITEMS["ev-aaaa"], ITEMS["ev-bbbb"]],
    "organization_id": ORG,
    "store_ids": STORES,
    "errors": validate_claims([make_calc(), make_money(), "not-a-dict"],
                              [ITEMS["ev-aaaa"], ITEMS["ev-bbbb"]],
                              organization_id=ORG, store_ids=STORES),
}

ROLLUP_CASES = [
    {
        "name": "mixed_set",
        "claims": [make_count(), make_calc(), make_hypo(), make_unknown()],
        "rollup": epistemic_rollup([make_count(), make_calc(), make_hypo(), make_unknown()]),
    },
    {
        "name": "empty",
        "claims": [],
        "rollup": epistemic_rollup([]),
    },
]

out = {
    "contract_version": "rev-claim-v1",
    "generated_by": "python/scripts/gen_epistemic_golden.py",
    "cases": CASES,
    "set_case": SET_CASE,
    "rollup_cases": ROLLUP_CASES,
}

target = ROOT.parent / "Backend" / "src" / "services" / "__tests__" / "revEpistemics.golden.json"
target.write_text(json.dumps(out, indent=2, sort_keys=True, ensure_ascii=False) + "\n")
print(f"wrote {target} ({len(CASES)} cases)")
