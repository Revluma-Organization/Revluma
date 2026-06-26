# M2 — Price vs. Convenience Sensitivity Classifier

## What this model does
Classifies each abandoning shopper as **price-sensitive**, **convenience-sensitive**, **dual-sensitive**, or **neutral**. The output directly determines what type of recovery offer to send — a discount, a free-shipping offer, both, or just a reminder nudge.

## Model type
Gradient Boosting (multi-output regressor → PSS + CSS scores)

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

## Features consumed (18)

| Feature | Type | PSS/CSS | Weight |
|---|---|---|---|
| `cursor_hesitation_ms_on_price_field` | int | PSS | HIGH |
| `past_orders_with_coupon_pct` | float | PSS | HIGH |
| `abandoned_at_shipping_reveal` | bool | CSS | VERY HIGH |
| `checkout_step_abandoned` | int | CSS | HIGH |
| `visited_coupon_page` | bool | PSS | MEDIUM |
| `searched_discount_terms` | bool | PSS | MEDIUM |
| `scroll_depth_checkout_pct` | float | CSS | MEDIUM |
| `tab_switch_count_session` | int | PSS | LOW |
| `google_shopping_referrer` | bool | PSS/CSS | TBD |
| `time_first_view_to_cart_add_hrs` | float | PSS/CSS | TBD |
| `sale_period_purchase_only` | bool | PSS/CSS | TBD |
| `failed_coupon_attempt` | bool | PSS/CSS | TBD |
| `merchant_avg_order_value` | float | PSS/CSS | TBD |
| `account_creation_abandonment` | bool | PSS/CSS | TBD |
| `repeat_checkout_attempts` | int | PSS/CSS | TBD |
| `device_type_mobile` | bool | PSS/CSS | TBD |
| `shipping_eta_dwell_sec` | float | PSS/CSS | TBD |
| `trust_page_visited` | bool | PSS/CSS | TBD |

## Schema gaps (Backend Engineer 1 action needed)
- `abandoned_carts.pss_score` (FLOAT) — column needs adding (P0)
- `abandoned_carts.css_score` (FLOAT) — column needs adding (P0)
- `Order.coupon_used` (BOOLEAN) — verify exists, populate from webhook (P0)

## Note on ownership
AI/ML Engineer 3 owns the PSS/CSS weighting and scoring logic.
AI/ML Engineer 2 owns the pipeline skeleton and feature input assembly.
