# M1 — Abandonment Probability Predictor

## What this model does
Scores every active checkout session every **60 seconds** to predict whether the shopper is about to abandon before it happens. When the score crosses the intervention threshold (0.65), it triggers an exit-intent action via the Recovery Queue.

## Model type
Logistic Regression (binary classifier)

## What it predicts
- **Output:** `abandonment_probability` — float between 0.0 and 1.0
- **Label:** 1 = abandoned, 0 = converted
- **Intervention trigger:** `should_intervene = True` when score > 0.65

## Features consumed (7)

| Feature | Type | Source | Signal meaning |
|---|---|---|---|
| `scroll_depth_pct` | float | Tracking pixel | Low scroll = disengaged |
| `tab_switch_count` | int | Tracking pixel | High switches = comparison shopping |
| `time_on_page_ms` | int | Tracking pixel + checkout table | Very long = hesitation |
| `checkout_step_reached` | int | Pixel + checkout table | Step 3–4 = near-miss abandonment |
| `failed_payment_attempt` | bool | Platform webhooks | True = intent was there, friction blocked |
| `cart_item_add_count` | int | Tracking pixel | High adds with low step = window-shopping |
| `cart_item_remove_count` | int | Tracking pixel | Repeated removals = price hesitation |

> **Note:** All 7 features are implemented in `pipeline.py` and must be
> provided in exactly this shape by the `/predict/abandonment-probability`
> endpoint. `train.py` is trained on all 7.

## Pipeline functions
- `calculate_scroll_depth(events)` → `scroll_depth_pct`
- `calculate_tab_switch_count(events)` → `tab_switch_count`
- `calculate_time_on_page_ms(events)` → `time_on_page_ms`
- `calculate_checkout_step_reached(events)` → `checkout_step_reached`
- `calculate_failed_payment_attempt(events)` → `failed_payment_attempt`
- `calculate_cart_item_add_count(events)` → `cart_item_add_count`
- `calculate_cart_item_remove_count(events)` → `cart_item_remove_count`

## Data sources
- `customer_events` table (S4) — pixel events
- `checkout` table (S5) — session status and step data
- Platform webhooks (S3) — payment failure signals
- Redis Feature Store (S8) — cached feature reads at inference time

## Schema gaps (Backend Engineer 1 action needed)
- `checkout.last_step_reached` (SMALLINT) — column needs adding (P0)
- `payment_failed` event type — needs extracting from Shopify/WooCommerce webhook processors (P0)
- `add_to_cart` and `remove_from_cart` event types — pixel must emit these for real-data training

## Training data
Sessions from `checkout` table with status `ABANDONED` or `RECOVERED`. Minimum viable training set: 1,000 labelled sessions per merchant.

## Where output goes
`abandonment_probability` → Recovery Queue → Channel Dispatcher (SendGrid / Twilio)
