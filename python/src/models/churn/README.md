# M4 — Churn Risk Scorer

## What this model does

M4 scores customer churn risk using a four-class Gradient Boosting model and a
separate early-warning layer. The main classes are `HEALTHY`, `AT_RISK`,
`HIGH_RISK`, and `CRITICAL`. A customer whose main tier is `HEALTHY` can be
promoted to `EARLY_WARNING` when engagement decay is high.

The inference result contains:

- `churn_probability`
- `churn_tier`
- `win_back_urgency`
- `primary_churn_signal`
- `engagement_decay_score`
- `recommended_channel`
- `offer_required`
- `escalate_to_human`
- `fallback`
- `model_version`

## Canonical 21-feature contract

The S3 heading mentions 24 features, but the assignment names exactly 21. The
named signals are authoritative; no undocumented model inputs are invented.

### Purchase History (8)

| Feature | Unit | Real-data source |
|---|---:|---|
| `past_orders_total` | count | Order history through `calculate_rfm_scores` |
| `days_since_last_purchase` | days | Order history through `calculate_rfm_scores` |
| `avg_order_value` | currency | Order history through `calculate_rfm_scores` |
| `purchase_frequency_trend` | -1, 0, or 1 | `calculate_purchase_frequency_trend` |
| `rfm_recency_score` | 1–5 | `calculate_rfm_scores` |
| `rfm_frequency_score` | 1–5 | `calculate_rfm_scores` |
| `rfm_monetary_score` | 1–5 | `calculate_rfm_scores` |
| `historical_aov_trend` | -1, 0, or 1 | Recent 90-day AOV compared with the preceding 90 days |

### Engagement Drift (8)

| Feature | Unit | Real-data source |
|---|---:|---|
| `email_open_rate_30d` | 0–1 rate | Optional `sequence_sends` and `sequence_events` tables |
| `email_open_rate_90d` | 0–1 rate | Optional `sequence_sends` and `sequence_events` tables |
| `email_open_rate_delta` | rate difference | 30-day rate minus 90-day rate |
| `sms_click_rate_30d` | 0–1 rate | Optional `sequence_sends` and `sequence_events` tables |
| `site_visit_frequency_30d` | session count | Distinct event sessions in 30 days |
| `site_visit_frequency_90d` | session count | Distinct event sessions in 90 days |
| `site_visit_delta` | count difference | 30-day count minus one-third of the 90-day count |
| `browse_to_cart_conversion_trend` | -1, 0, or 1 | Current and prior 30-day add-to-cart/view conversion |

### Sentiment Signals (3)

| Feature | Unit | Real-data source |
|---|---:|---|
| `coupon_dependency_score` | 0–1 ratio | Coupon usage percentage divided by 100 and clamped |
| `return_rate` | 0–1 rate | Neutral `0` until a reviewed return source exists |
| `support_contact_frequency_90d` | count | Neutral `0` until a reviewed support source exists |

### Competitive Exposure (2)

| Feature | Unit | Real-data source |
|---|---:|---|
| `discount_seeking_escalation` | 0 or 1 | Recent discount/coupon search events compared with the prior monthly rate |
| `unsubscribe_risk_score` | 0–1 rate | Optional 90-day unsubscribe events per email sent |

Unavailable optional sources use neutral zero values. This preserves the model
contract without generating a false production signal.

## Accepted legacy names

Input boundaries accept these equivalent names for backward compatibility:

| Legacy name | Canonical name |
|---|---|
| `sms_click_rate` | `sms_click_rate_30d` |
| `site_visit_frequency_delta` | `site_visit_delta` |
| `browse_to_cart_trend` | `browse_to_cart_conversion_trend` |

When both forms are supplied, the canonical value wins. Signals with different
units or meanings are not aliased.

## Training-data policy

- Without `db_connection`, training uses 4,000 synthetic records for local
  development and testing.
- With `db_connection`, training uses qualifying real customers only. Query
  failure or zero qualifying customers stops training; there is no silent
  synthetic fallback.
- Fewer than 500 real customers is allowed but explicitly tagged as below the
  recommended minimum, so resulting metrics remain provisional.
- The main model must be evaluated against AUC-ROC ≥ 0.78 and HIGH_RISK
  precision ≥ 0.72 on each run. No fixed score is claimed in this document.
- The early-warning model uses `engagement_decay_score`. If its training cohort
  does not contain both labels, inference uses the documented decay threshold.

## Backend and database integration

Python owns feature calculation, training, and inference. Backend-owned work,
including optional sequence tables, persistence, scheduling, indexes,
idempotency, and rollout steps, is specified in
[`BACKEND_D_S_IMPLEMENTATION_HANDOFF.md`](../../../../docs/BACKEND_D_S_IMPLEMENTATION_HANDOFF.md).
No Python training path applies migrations or writes Backend schema files.

## MLflow

The main model is registered as `churn_risk`. The optional early-warning model
is registered as `churn_early_warning`. Inference uses those exact names.
