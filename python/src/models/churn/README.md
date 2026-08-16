# M4 — Churn Risk Scorer

## What this model does
Scores every customer daily for churn tier. When a customer reaches **HIGH_RISK** or **CRITICAL**, it automatically triggers a win-back sequence via the Recovery Queue, with human escalation for high-value CRITICAL customers.

## Model type
Gradient Boosting (multi-class, 4 classes)

## What it predicts
- `churn_tier` — one of `HEALTHY` | `AT_RISK` | `HIGH_RISK` | `CRITICAL`
- `churn_probability` — float, P(not HEALTHY)
- `win_back_urgency` — `LOW` | `MEDIUM` | `HIGH` | `CRITICAL` (1:1 with tier)
- `engagement_decay_score`, `recommended_channel`, `offer_required`, `escalate_to_human` — derived in the serving layer, see `api.py`

## Features consumed (24 across 4 dimensions)

**Dimension 1 — Purchase History (8 features)**

| Feature | Type | Source |
|---|---|---|
| `past_orders_total` | int | `pipeline.py: calculate_past_orders_total` |
| `days_since_last_purchase` | int | `pipeline.py: calculate_days_since_last_purchase` |
| `avg_order_value` | float | `pipeline.py: calculate_avg_order_value` |
| `purchase_frequency_trend` | int {-1,0,1} | `pipeline.py: calculate_purchase_frequency_trend` |
| `rfm_recency_score` | int 1–5 | `pipeline.py: calculate_rfm_scores` |
| `rfm_frequency_score` | int 1–5 | `pipeline.py: calculate_rfm_scores` |
| `rfm_monetary_score` | int 1–5 | `pipeline.py: calculate_rfm_scores` |
| `historical_aov_trend` | int {-1,0,1} | TODO: requires time-series AOV data |

**Dimension 2 — Engagement Drift (8 features, synthetic until tracking tables exist)**

| Feature | TODO Pipeline Function |
|---|---|
| `email_open_rate_30d` | `calculate_email_open_rate_30d(customer_id, db)` |
| `email_open_rate_90d` | `calculate_email_open_rate_90d(customer_id, db)` |
| `email_open_rate_delta` | Derived: 30d − 90d |
| `sms_click_rate` | `calculate_sms_click_rate(customer_id, db)` |
| `site_visit_frequency_delta` | `calculate_site_visit_frequency_delta(customer_id, db)` |
| `browse_to_cart_trend` | `calculate_browse_to_cart_trend(customer_id, db)` |
| `push_open_rate` | `calculate_push_open_rate(customer_id, db)` |
| `whatsapp_response_rate` | `calculate_whatsapp_response_rate(customer_id, db)` |

**Dimension 3 — Sentiment Signals (4 features, synthetic until data exists)**

| Feature | TODO Pipeline Function |
|---|---|
| `coupon_dependency_score` | `calculate_coupon_dependency_score(customer_id, db)` |
| `return_rate` | `calculate_return_rate(customer_id, db)` |
| `review_sentiment_score` | `calculate_review_sentiment_score(customer_id, db)` |
| `support_ticket_count_90d` | `calculate_support_ticket_count_90d(customer_id, db)` |

**Dimension 4 — Competitive Exposure (5 features, synthetic until data exists)**

| Feature | TODO Pipeline Function |
|---|---|
| `discount_seeking_escalation` | `calculate_discount_seeking_escalation(customer_id, db)` |
| `unsubscribe_risk_score` | `calculate_unsubscribe_risk_score(customer_id, db)` |
| `competitor_referral_flag` | `calculate_competitor_referral_flag(customer_id, db)` |
| `price_comparison_session_count` | `calculate_price_comparison_session_count(customer_id, db)` |
| `social_proof_sensitivity` | `calculate_social_proof_sensitivity(customer_id, db)` |

## Schema gaps (flagged, not fixed)
- Dimensions 2–4 (17 features) have no backing pipeline.py functions or DB columns yet. They train on synthetic data until the relevant tracking tables (`sequence_events`, email engagement, SMS click logs) are live.
- `escalate_to_human` requires customer LTV; approximated as `past_orders_total × avg_order_value` until a real LTV field exists in `customer_crm`.

## Key churn signal
`purchase_frequency_trend = -1` combined with high `days_since_last_purchase` is the strongest churn predictor in the feature set — this holds true in both the old binary design and the current 4-class design.

## Training data
4000 synthetic records (per spec). Labels driven primarily by `days_since_last_purchase` (mirroring the endpoint's fallback tier boundaries), amplified by `purchase_frequency_trend` and low RFM frequency/monetary scores, bucketed by quartile so all 4 tiers are meaningfully represented (fixed cutoffs initially produced 75% CRITICAL and starved HIGH_RISK — quartile bucketing corrected this). **AUC-ROC (OvR) 0.998** on held-out test set.

## Run schedule
Daily cron job — scores all customer profiles, writes `churn_tier` back to wherever the serving layer's caller persists it (see schema gap above re: `customer_crm` columns).

## MLflow
Registered under `churn_risk` (tag `model=churn`) — this exact registry name is required for `api.py`'s `_load_model("churn_risk")` to find it.