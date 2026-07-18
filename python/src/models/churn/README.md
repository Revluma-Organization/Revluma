# M4 — Churn Risk Scorer

## What this model does
Scores every customer daily for churn tier. When a customer reaches **HIGH_RISK** or **CRITICAL**, it automatically triggers a win-back sequence via the Recovery Queue, with human escalation for high-value CRITICAL customers.

## Model type
Gradient Boosting (multi-class, 4 classes)

> **Correction (see chat audit):** the previous version of this README described a binary target (`churn_score` 0–100, threshold 61 = "High Risk") with `risk_level` low/medium/high. The Phase 2 task doc specifies a 4-class `churn_tier` target instead, which is what's actually built and trained. Section rewritten below to match.

## What it predicts
- `churn_tier` — one of `HEALTHY` | `AT_RISK` | `HIGH_RISK` | `CRITICAL`
- `churn_probability` — float, P(not HEALTHY)
- `win_back_urgency` — `LOW` | `MEDIUM` | `HIGH` | `CRITICAL` (1:1 with tier)
- `engagement_decay_score`, `recommended_channel`, `offer_required`, `escalate_to_human` — derived in the serving layer, see `api.py`

## Features consumed (7)

| Feature | Type | Source | Signal meaning |
|---|---|---|---|
| `past_orders_total` | int | `pipeline.py: calculate_past_orders_total` | Frequency (F) — loyalty depth |
| `days_since_last_purchase` | int | `pipeline.py: calculate_days_since_last_purchase` | Recency (R) — -1 = no history |
| `avg_order_value` | float | `pipeline.py: calculate_avg_order_value` | Monetary (M) — customer value |
| `purchase_frequency_trend` | int, {-1,0,1} | `pipeline.py: calculate_purchase_frequency_trend` | -1 = actively disengaging |
| `rfm_recency_score` | int, 1–5 | `pipeline.py: calculate_rfm_scores` | recency bucket |
| `rfm_frequency_score` | int, 1–5 | `pipeline.py: calculate_rfm_scores` | frequency bucket |
| `rfm_monetary_score` | int, 1–5 | `pipeline.py: calculate_rfm_scores` | monetary bucket |

> **Correction:** the previous version listed only 4 features plus RFM sub-scores described as "pre-computed by Feature Engineering job, stored in customer_crm." All 7 features above are computed directly from real `pipeline.py` functions, confirmed against the actual repo.

## Schema gaps (flagged, not fixed)
- The task doc describes 24 signals across 4 dimensions (purchase history, engagement drift, sentiment, competitive exposure). Only the **purchase history** dimension (the 7 features above) exists as real functions in `pipeline.py` today — engagement drift (email open rate, SMS click rate), sentiment (return rate, coupon dependency), and competitive exposure (unsubscribe risk) have no backing function or DB column anywhere in the repo. Needs new pipeline functions + new tracked data — outside this task's scope.
- `escalate_to_human` requires customer LTV, which isn't among these 7 features. The serving layer currently approximates LTV as `past_orders_total × avg_order_value` — needs confirming against a real LTV field if one exists in `customer_crm`.

## Key churn signal
`purchase_frequency_trend = -1` combined with high `days_since_last_purchase` is the strongest churn predictor in the feature set — this holds true in both the old binary design and the current 4-class design.

## Training data
4000 synthetic records (per spec). Labels driven primarily by `days_since_last_purchase` (mirroring the endpoint's fallback tier boundaries), amplified by `purchase_frequency_trend` and low RFM frequency/monetary scores, bucketed by quartile so all 4 tiers are meaningfully represented (fixed cutoffs initially produced 75% CRITICAL and starved HIGH_RISK — quartile bucketing corrected this). **AUC-ROC (OvR) 0.89** on held-out test set.

## Run schedule
Daily cron job — scores all customer profiles, writes `churn_tier` back to wherever the serving layer's caller persists it (see schema gap above re: `customer_crm` columns).

## MLflow
Registered under `churn_risk` (tag `model=churn`) — this exact registry name is required for `api.py`'s `_load_model("churn_risk")` to find it.