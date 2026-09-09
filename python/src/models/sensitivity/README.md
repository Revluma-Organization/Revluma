# M2 — Shopper sensitivity classifier

M2 uses three independent sigmoid-calibrated gradient-boosting classifiers to
produce 0–100 Price Sensitivity (PSS), Convenience Sensitivity (CSS), and Trust
Sensitivity (TSS) scores. A deterministic nine-condition matrix converts those
scores into a classification, recovery action, recommended offer, and channel
priority.

## Canonical 13-feature contract

Training and inference share this exact ordered list:

1. `past_orders_with_coupon_pct`
2. `visited_coupon_page`
3. `searched_discount_terms`
4. `cart_item_remove_count`
5. `coupon_field_visited`
6. `abandoned_at_shipping_reveal`
7. `checkout_step_reached`
8. `cursor_hesitation`
9. `time_on_page_ms`
10. `failed_payment_attempt`
11. `failed_payment_count`
12. `is_return_visitor`
13. `avg_order_value`

`cursor_hesitation` is the canonical 0–10 value. Inference accepts
`cursor_hesitation_score` as a same-unit alias and `cursor_hesitation_ms` as a
raw-millisecond alias converted once with
`min(floor(milliseconds / 1000), 10)`. Canonical input wins. If omitted,
`is_return_visitor` can be derived from `past_orders_total > 0`.

Scores are `HIGH` at 60 or above, `LOW` below 40, and `MID` otherwise. Exact
single- and dual-sensitivity combinations select `DISCOUNT`, `FRICTION_FIX`,
`TRUST_REASSURE`, `HYBRID_BUNDLE`, `TRUST_PLUS_DEAL`, or
`FRICTION_PLUS_TRUST`. All scores at least `MID` select `FULL_PERSONALISE`; all
`LOW` select `NUDGE`; remaining combinations select `SOFT_NUDGE`.

## Training and registration

Each classifier uses 160 estimators, `learning_rate=0.05`, `max_depth=2`,
`min_samples_leaf=20`, and `subsample=0.85`, followed by five-fold sigmoid
calibration. The calibration was selected because the 0–100 outputs are used
as scores, and a fixed validation plus untouched-test comparison improved the
overall probability/classification trade-off, especially for TSS. Without a
database connection, training uses deterministic synthetic development data.
With a connection, it reads complete immutable snapshots and finalized
PSS/CSS/TSS labels from
`sensitivity_training_observations`; zero usable rows or a one-class target
stops training rather than silently substituting synthetic data.

Each target logs accuracy, positive-class precision/recall/F1, minimum
per-class F1, AUC-ROC, average precision, Brier score, and log loss in a
separate MLflow run. A real-data run may register
`sensitivity_pss`, `sensitivity_css`, and `sensitivity_tss` only when it has at
least 500 labeled sessions and achieves AUC-ROC ≥ 0.75 and minimum per-class F1
≥ 0.65. Synthetic runs are logged with `production_eligible=false`, are not
registered, and do not establish production performance or fairness. Serving
loads only the `Production` stage and returns the documented neutral fallback
when any of the three models is unavailable.

The backend work needed to collect immutable sensitivity labels and persist
scores is in
[`docs/BACKEND_IMPLEMENTATION_GUIDE.md`](../../../../docs/BACKEND_IMPLEMENTATION_GUIDE.md).
