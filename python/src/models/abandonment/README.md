# M1 — Abandonment Probability Predictor

## What this model does
Scores every active checkout session every **60 seconds** to predict whether the shopper is about to abandon before it happens. When the score crosses the intervention threshold, it triggers an exit-intent action via the Recovery Queue.

## Model type
Logistic Regression (binary classifier)

## What it predicts
- **Output:** `abandonment_probability` — float between 0.0 and 1.0
- **Label:** 1 = abandoned, 0 = converted
- **Intervention trigger:** Score above threshold (TBD in Week 4 tuning)

## Features consumed (5)

| Feature | Type | Source | Signal meaning |
|---|---|---|---|
| `scroll_depth_pct` | float | Tracking pixel | Low scroll = disengaged |
| `tab_switch_count` | int | Tracking pixel | High switches = comparison shopping |
| `time_on_page_ms` | float | Tracking pixel + checkout table | Very long = hesitation |
| `checkout_step_reached` | int | Pixel + checkout table | Step 3–4 = near-miss abandonment |
| `failed_payment_attempt` | bool | Platform webhooks | True = intent was there, friction blocked |

## Data sources
- `customer_events` table (S4) — pixel events
- `checkout` table (S5) — session status and step data
- Platform webhooks (S3) — payment failure signals
- Redis Feature Store (S8) — cached feature reads at inference time

## Schema gaps (Backend Engineer 1 action needed)
- `checkout.last_step_reached` (SMALLINT) — column needs adding (P0)
- `payment_failed` event type — needs extracting from Shopify/WooCommerce webhook processors (P0)

## Training data
Sessions from `checkout` table with status `ABANDONED` or `RECOVERED`. Minimum viable training set: 1,000 labelled sessions per merchant.

## Where output goes
`abandonment_probability` → Recovery Queue → Channel Dispatcher (SendGrid / Twilio)
