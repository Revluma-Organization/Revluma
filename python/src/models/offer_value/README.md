# M5 — Offer value optimizer

M5 recommends the smallest useful recovery incentive while protecting margin.
It combines a five-feature histogram-gradient-boosting regressor with
deterministic gates, customer modifiers, merchant caps, and an exact-formula
fallback.

## Decision flow

1. A trust score of at least 60 returns `TRUST_SIGNAL` with no discount.
2. PSS and CSS both below 35 return `NUDGE` with no discount.
3. Otherwise, the model estimates a base discount from five inputs:
   `pss_score`, `past_orders_with_coupon_pct`, `visited_coupon_page`,
   `searched_discount_terms`, and `failed_coupon_count`.
4. Rules adjust the result using `ltv`, `past_orders_total`, `cart_value`,
   `churn_tier`, `is_first_purchase`, and `failed_payment_count`.
5. The result is clipped to 0–25% and to the merchant's lower configured
   `store_config.discount_cap`, when available.
6. The final category may be `TRUST_SIGNAL`, `NUDGE`, `PAYMENT_FIX`,
   `VIP_ACCESS`, `FREE_SHIPPING`, `DISCOUNT_PLUS_FREE_SHIPPING`,
   `PERCENTAGE_DISCOUNT`, or `CART_REMINDER`.

The rule context also includes `css_score`, `tss_score`, and
`recovery_action`. These are not learned regressor inputs. The formula fallback
uses the same five-input relationship as synthetic training and is identified by
`fallback=true` and model version `1.0.0-formula-fallback`.

## Training and registration

The regressor uses 200 boosting iterations, `learning_rate=0.05`, 15 maximum
leaf nodes, 20 minimum samples per leaf, L2 regularization of 1.0, and
`random_state=42`. This configuration beat the prior gradient boosting model
on both validation and untouched test RMSE, MAE, and R². Local development
training starts from 6,000 deterministic synthetic sessions, removes rows
blocked by the pre-model gates, and logs the remaining split. Metrics are
calculated after clipping predictions to 0–25%.

Real training reads converted recovery orders, their recorded `discount_pct`,
the abandoned-cart PSS value, and the corresponding session events. A caller
requesting real data receives an error rather than a silent synthetic fallback
when usable rows are unavailable.

A run is registered as `offer_value` only when it uses at least 200 real
recovered orders, has MAE ≤ 5.0, and has R² ≥ 0.70. Synthetic and below-gate
runs are logged but not registered. Serving loads only
`models:/offer_value/Production`. Per-run metrics must be read from MLflow;
synthetic metrics do not establish real-world performance or fairness.

## Backend dependencies

Real training requires finalized recovered-order outcomes, `orders.discount_pct`,
session linkage, persisted PSS values, and merchant discount constraints. The
backend migration, webhook, validation, and backfill steps are in
[`docs/BACKEND_IMPLEMENTATION_GUIDE.md`](../../../../docs/BACKEND_IMPLEMENTATION_GUIDE.md).

Tests are in `python/tests/test_synthetic_model_quality.py`,
`python/tests/test_model_registration_guards.py`, and `python/tests/test_api.py`.
