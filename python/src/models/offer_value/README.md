# Offer Value Model — Training & System Spec

## 1. Problem Statement
This model determines the optimal discount percentage required to recover an abandoning or hesitant customer, given that M2 has already classified their price/convenience/trust sensitivity.
It predicts:
"What discount % (0–25%) would have converted this user?"
This is a revenue optimization regression problem, gated by hard business rules evaluated before the model ever runs.

## 2. Target Variable Definition
**Target:** `discount_pct`
**Continuous regression target:**
- Range: 0 → 25

> **Correction (see chat audit):** the previous version of this README specified a 0–30 range. A different section of the same original doc states the hard constraint "never >25%" — training a model to output values it's never allowed to actually use wastes model capacity and risks predictions that look reasonable internally while being silently clipped downstream. Range corrected to 0–25 throughout.

**Definition:**
The discount percentage that historically:
- led to conversion OR recovery
- prevented abandonment

**Important:**
- 0 means: no discount needed (or a hard gate forced it to 0 — see Section 5)
- >0 means: discount required to influence conversion

## 3. Feature Inputs

> **Correction (see chat audit):** the previous version listed 9 features, all pipeline.py-mapped, which is mostly still correct — but was missing `tss_score`, a third M2 output the task doc explicitly requires ("PSS + CSS + TSS"). Added below, flagged as not-yet-real data.

**3.1 M2 Sensitivity Outputs**
- `pss_score` (int, 0–100) — Price Sensitivity Score
- `css_score` (int, 0–100) — Convenience Sensitivity Score
- `tss_score` (int, 0–100) — Trust Sensitivity Score — **flagged: no backing function or data source exists anywhere in `pipeline.py` or M2's own README yet.** Accepted as an input with a safe default of 0 until M2's owner (Engineer 3) implements real output.

**3.2 Behavioral Features**
- `calculate_cursor_hesitation(customer_id, db)` — HIGH price signal
- `calculate_visited_coupon_page(customer_id, db)`
- `calculate_searched_discount_terms(customer_id, db)`

**3.3 Purchase History Features**
- `calculate_avg_order_value(customer_id, db)`
- `calculate_past_orders_total(customer_id, db)`
- `calculate_coupon_usage_pct(customer_id, db)` — returned as `past_orders_with_coupon_pct`, a 0.0–1.0 ratio (not a 0–100 percentage — this was a real scale bug caught in `api.py`'s earlier draft)

**3.4 Risk Features**
- `calculate_days_since_last_purchase(customer_id, db)`

**3.5 Note on RFM**
Unlike M4, this model does not consume RFM sub-scores directly — price/convenience/trust sensitivity (PSS/CSS/TSS) already captures the relevant risk signal for discount sizing.

## 4. Model Type
**Algorithm:** GradientBoostingRegressor

**Hyperparameters (as built):**
- `n_estimators = 150`
- `max_depth = 3`
- `learning_rate = 0.05`
- `random_state = 42`

> Note: the previous version of this README specified `n_estimators=200, max_depth=4`. Built with 150/3 to stay consistent with M3/M4's hyperparameters for this MVP phase — revisit if the larger model materially improves real-data performance later.

## 5. Hard Business Constraints
MUST enforce — **two separate gates**, not one combined rule:

**5.1 Trust Gate**
If: `tss_score >= 60`
Then: return `offer_type = TRUST_SIGNAL`, `discount_pct = 0.0` immediately — a discount doesn't address a trust/friction blocker.

**5.2 Nudge Gate**
If: `pss_score < 35 AND css_score < 35`
Then: return `offer_type = NUDGE`, `discount_pct = 0.0` — low sensitivity on both axes means a soft reminder is more appropriate than a discount.

> **Correction:** the previous version specified a single "PSS Guardrail: if pss_score < 30, return 0.0." The actual task doc spec has two independent gates using different fields (TSS alone, and PSS+CSS combined) — corrected above. This also resolves an earlier draft of this project that incorrectly assumed TSS was the same thing as CSS; they are confirmed distinct in the doc's own wording ("PSS + CSS + TSS").

**5.3 Upper Bound (all other cases)**
- Never recommend discount > 25%
- `clip(predicted_discount, 0, 25)`

## 6. Schema Dependency Warning
A new DB field is required (unchanged from original spec — still outstanding):
```sql
ALTER TABLE orders ADD COLUMN discount_pct FLOAT;
```
**Purpose:** store historical discount effectiveness, train regression target, enable causal learning. **Flag to Afolabi** — per the task doc's own note.

## 7. Output Schema

> **Correction (see chat audit):** the previous version specified `{recommended_discount_pct, confidence}`. The actual implemented `/predict/offer-value` endpoint returns a richer schema matching the task doc's real P2.1 spec — rewritten below.

```json
{
  "discount_pct": 0.0 - 25.0,
  "offer_type": "DISCOUNT | TRUST_SIGNAL | NUDGE",
  "offer_expires_hours": 24,
  "minimum_order_value": 0.0,
  "expected_recovery_probability": 0.0 - 1.0,
  "margin_cost_estimate_pct": 0.0 - 25.0,
  "reasoning": "string explanation",
  "fallback": false
}
```

## 8. Business Logic Constraints
- Must not recommend unnecessary discounting (Section 5 gates run before the model)
- Must prioritize margin preservation (25% hard cap enforced twice — in training labels and again at prediction time as a safety net)
- Must align with behavioral signals (hesitation, coupon history, sensitivity scores)

## 9. Training Requirements
- 3000 synthetic records (per spec) — real labeled recovery-offer data doesn't exist yet, same MVP-stage caveat as M3/M4
- Must eventually include, once real data exists: discount offered, conversion outcome, behavioral state at decision time
- **RMSE 2.20, MAE 1.58, R² 0.90** on held-out synthetic test set

## 10. Validation Checklist
- [x] Uses correct pipeline functions (with corrected names/scales)
- [x] Uses GradientBoostingRegressor
- [x] Enforces 0–25 clipping (corrected from 0–30)
- [x] Implements both hard gates (TRUST_SIGNAL + NUDGE, corrected from single PSS guardrail)
- [ ] Requires `orders.discount_pct` field — still outstanding, flagged to Afolabi
- [x] Produces valid regression output
- [ ] `tss_score` is real M2 output — currently synthetic placeholder, flagged blocker

## 11. Business Objective
**Maximize:** recovered revenue, conversion rate
**Minimize:** unnecessary discount leakage, margin loss

## MLflow
Registered under `offer_value` (tag `model=offer_value`) — this exact registry name is required for `api.py`'s `_load_model("offer_value")` to find it.