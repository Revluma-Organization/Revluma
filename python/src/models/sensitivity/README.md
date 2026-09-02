# M2 — Price vs. Convenience Sensitivity Classifier

## What this model does
Classifies each abandoning shopper as **price-sensitive**, **convenience-sensitive**, **dual-sensitive**, or **neutral**. The output directly determines what type of recovery offer to send — a discount, a free-shipping offer, both, or just a reminder nudge.

## Model type
Two Gradient Boosting binary classifiers: one for price sensitivity and one
for convenience sensitivity. Inference converts their probabilities to the
0-100 PSS and CSS scores.

Each classifier uses 160 estimators, `learning_rate=0.05`, `max_depth=2`,
`min_samples_leaf=20`, and `subsample=0.85` to reduce synthetic overfitting.

## What it predicts
- `pss_score` (int 0–100) — Price Sensitivity Score
- `css_score` (int 0–100) — Convenience Sensitivity Score
- `classification` — derived from PSS/CSS thresholds (see matrix below)

## PSS/CSS Decision Matrix

| PSS | CSS | Classification | Recovery Action |
|---|---|---|---|
| ≥ 60 | < 40 | Price-Sensitive | Discount (% determined by M5) |
| < 40 | ≥ 60 | Convenience-Sensitive | Free shipping / fast delivery emphasis |
| ≥ 60 | ≥ 60 | Dual-Sensitive | Discount + free shipping |
| < 40 | < 40 | Neutral | Soft reminder nudge, no offer |
| 40–59 | 40–59 | Ambiguous | Hold or soft nudge with 5% discount |

## Features consumed (8)

| Feature | Type | PSS/CSS | Weight |
|---|---|---|---|
| `cursor_hesitation` | int | PSS | HIGH |
| `past_orders_with_coupon_pct` | float | PSS | HIGH |
| `abandoned_at_shipping_reveal` | bool | CSS | VERY HIGH |
| `checkout_step_reached` | int | CSS | HIGH |
| `visited_coupon_page` | bool | PSS | MEDIUM |
| `searched_discount_terms` | bool | PSS | MEDIUM |
| `scroll_depth_pct` | float | CSS | MEDIUM |
| `tab_switch_count` | int | PSS | LOW |
The longer 18-signal list is a future expansion proposal, not the current
training contract. Adding those fields requires a separately versioned model
and migration plan.

## Schema dependencies

The required PSS/CSS persistence and coupon-use contracts are specified in
`docs/BACKEND_D_S_IMPLEMENTATION_HANDOFF.md`. The Python repository does not
apply those backend migrations.

## Training and MLflow

Without a database connection, training logs deterministic synthetic PSS and
CSS artifacts for development evidence. Synthetic runs are tagged
`production_eligible=false` and are never registered. Registration under
`sensitivity_pss` and `sensitivity_css` requires at least 500 real labeled
records and requires that classifier to achieve `AUC-ROC >= 0.75` and
`F1 >= 0.65`. Synthetic metrics do not establish production performance or
fairness.

## Ownership boundary

The model module owns PSS/CSS training and scoring. The feature pipeline owns
canonical input assembly. Backend owns persistence and delivery integration.
