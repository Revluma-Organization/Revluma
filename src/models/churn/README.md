# M4 — Churn Risk Scorer

## What this model does
Scores every customer daily for churn probability. When `churn_score` crosses **61 (High Risk)**, it automatically triggers a 3-touch win-back sequence via the Recovery Queue.

## Model type
Gradient Boosting

## What it predicts
- `churn_score` (float 0–100) — stored in `customer_crm.churn_score`
- `risk_level` — 'low' | 'medium' | 'high'
- `customer_segment` — 'champion' | 'loyal' | 'at_risk' | 'hibernating' | 'lost'

## Features consumed (4)

| Feature | Type | Source | Signal meaning |
|---|---|---|---|
| `past_orders_total` | int | Order table | Frequency (F) — loyalty depth |
| `days_since_last_purchase` | int | Order table | Recency (R) — -1 = no history |
| `avg_order_value` | float | Order table | Monetary (M) — customer value |
| `purchase_frequency_trend` | int | Order table (computed) | -1 = actively disengaging |

## RFM sub-scores (from customer_crm)
`rfm_recency`, `rfm_frequency`, `rfm_monetary` — pre-computed by Feature Engineering job, stored in `customer_crm`.

## Schema gaps (Backend Engineer 1 action needed)
- `customer_crm` — verify columns: `rfm_recency`, `rfm_frequency`, `rfm_monetary`, `churn_score`, `segment`, `ltv`, `lifecycle_stage` (P1)

## Key churn signal
`purchase_frequency_trend = -1` combined with `days_since_last_purchase > 90` is the strongest churn predictor in the feature set.

## Run schedule
Daily cron job — scores all customer profiles, updates `customer_crm.churn_score`.
