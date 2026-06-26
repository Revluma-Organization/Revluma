# M5 — Offer Value Optimizer

## What this model does
Once M2 confirms a shopper is price-sensitive, this model calculates the **minimum discount percentage** needed to convert them — protecting the merchant's margins while maximising recovery.

## Model type
Gradient Boosting (regressor)

## Dependency
**M2 must run first.** M5 requires `pss_score` and `css_score` from `abandoned_carts` as inputs. M2 output → M5 input is a hard dependency in the inference pipeline.

## What it predicts
- `recommended_discount_pct` (int) — clipped to merchant's `max_discount_pct` (default 20%)

## Features consumed (10)

| Feature | Type | Source |
|---|---|---|
| `pss_score` | float | M2 output → `abandoned_carts.pss_score` |
| `css_score` | float | M2 output → `abandoned_carts.css_score` |
| `cursor_hesitation_ms_on_price_field` | int | Tracking pixel |
| `past_orders_total` | int | Order table |
| `past_orders_with_coupon_pct` | float | Order table |
| `days_since_last_purchase` | int | Order table |
| `avg_order_value` | float | Order table |
| `visited_coupon_page` | bool | Tracking pixel |
| `searched_discount_terms` | bool | Tracking pixel |
| `failed_coupon_attempt` | bool | Tracking pixel |

## Merchant constraints
- `store_config.max_discount_pct` — hard cap (default 20%). **P0 gap: verify this column exists.**
- `store_config.min_margin_pct` — optional margin floor. **❌ MISSING — P2 addition.**

## Schema gaps (Backend Engineer 1 action needed)
- `abandoned_carts.pss_score` (FLOAT) — needs adding (P0)
- `abandoned_carts.css_score` (FLOAT) — needs adding (P0)
- `Order.coupon_used` / `coupon_code` — verify populated from webhooks (P0)
- `store_config.max_discount_pct` — verify exists (P1)
- `store_config.min_margin_pct` — add if possible (P2, not a blocker)
