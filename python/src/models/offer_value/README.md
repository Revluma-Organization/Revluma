# Offer Value Model — Training & System Spec

## 1. Problem Statement
This model determines the optimal discount percentage required to recover an abandoning or hesitant customer.
It predicts:
"What discount % (0–30%) would have converted this user?"
This is a revenue optimization regression problem.

## 2. Target Variable Definition
**Target:** `discount_pct`
**Continuous regression target:**
- Range: 0 → 30
**Definition:**
The discount percentage that historically:
- led to conversion OR recovery
- prevented abandonment

**Important:**
- 0 means: no discount needed
- >0 means: discount required to influence conversion

## 3. Feature Inputs (Must Match Pipeline)
Must use exact function names mapping directly to `python/src/features/pipeline.py`:

**3.1 Behavioral Features**
- `calculate_scroll_depth(events)`
- `calculate_cursor_hesitation_count(events)`
- `calculate_time_on_page_ms(events)`
- `calculate_checkout_step_reached(events)`

**3.2 Purchase History Features**
- `calculate_avg_order_value(customer_id, db)`
- `calculate_past_orders_total(customer_id, db)`
- `calculate_coupon_usage_pct(customer_id, db)`

**3.3 Risk Features**
- `calculate_days_since_last_purchase(customer_id, db)`
- `calculate_purchase_frequency_trend(customer_id, db)`

**3.4 RFM Features (Critical)**
- `calculate_rfm_scores(customer_id, db)`

## 4. Model Type
**Algorithm:** GradientBoostingRegressor

**Recommended Hyperparameters:**
- `n_estimators = 200`
- `max_depth = 4`
- `learning_rate = 0.05`
- `random_state = 42`

## 5. Hard Business Constraints
MUST enforce:

**5.1 Upper Bound**
- Never recommend discount > 30%
`clip(predicted_discount, 0, 30)`

**5.2 PSS Guardrail**
If: `pss_score < 30`
Then: DO NOT recommend any discount (return 0.0)

## 6. Schema Dependency Warning
A new DB field is required:
`orders` table update required

```sql
ALTER TABLE orders ADD COLUMN discount_pct FLOAT;
```

**Purpose:**
- store historical discount effectiveness
- train regression target
- enable causal learning

## 7. Output Schema
**Model Output**
```json
{
  "recommended_discount_pct": 0.0 - 30.0,
  "confidence": 0.0 - 1.0
}
```

**Interpretation:**
- 0.0 = no discount required
- higher values = stronger incentive needed

## 8. Business Logic Constraints
- Must not recommend unnecessary discounting
- Must prioritize margin preservation
- Must align with behavioral signals (hesitation, abandonment, RFM risk)

## 9. Training Requirements
- Requires labeled historical recovery data
- Must include:
  - discount offered
  - conversion outcome
  - behavioral state at decision time

## 10. Validation Checklist
- [ ] Uses correct pipeline functions
- [ ] Uses GradientBoostingRegressor
- [ ] Enforces 0–30 clipping
- [ ] Implements PSS guardrail
- [ ] Requires orders.discount_pct field
- [ ] Produces valid regression output
- [ ] Includes confidence score

## 11. Business Objective
**Maximize:**
- recovered revenue
- conversion rate
**Minimize:**
- unnecessary discount leakage
- margin loss
