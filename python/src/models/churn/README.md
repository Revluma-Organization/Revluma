# M4 — Churn risk scorer

M4 scores customers with a four-class gradient-boosting model:
`HEALTHY`, `AT_RISK`, `HIGH_RISK`, and `CRITICAL`. A separate early-warning
layer can promote an otherwise healthy result to `EARLY_WARNING` when
engagement decay is high.

The response includes churn probability and tier, win-back urgency, primary
signal, engagement-decay score, recommended channel, offer requirement,
human-escalation flag, model version, and fallback status.

## Canonical 21-feature contract

The source requirement names 21 signals even though its heading says 24. The
named signals are authoritative; no undocumented inputs are invented.

| Group | Features |
| --- | --- |
| Purchase history | `past_orders_total`, `days_since_last_purchase`, `avg_order_value`, `purchase_frequency_trend`, `rfm_recency_score`, `rfm_frequency_score`, `rfm_monetary_score`, `historical_aov_trend` |
| Engagement drift | `email_open_rate_30d`, `email_open_rate_90d`, `email_open_rate_delta`, `sms_click_rate_30d`, `site_visit_frequency_30d`, `site_visit_frequency_90d`, `site_visit_delta`, `browse_to_cart_conversion_trend` |
| Sentiment | `coupon_dependency_score`, `return_rate`, `support_contact_frequency_90d` |
| Competitive exposure | `discount_seeking_escalation`, `unsubscribe_risk_score` |

Rates and ratios use 0–1 units. In particular, `coupon_dependency_score` uses
the 0–1 result of `calculate_coupon_usage_pct` directly; it is not divided by
100. Optional sequence, return, or support sources default to neutral zero only
when the relevant backend table is unavailable.

Input boundaries retain three same-unit aliases: `sms_click_rate` maps to
`sms_click_rate_30d`, `site_visit_frequency_delta` maps to `site_visit_delta`,
and `browse_to_cart_trend` maps to `browse_to_cart_conversion_trend`. Canonical
values win.

## Training and label safety

- Without a database connection, training uses 4,000 deterministic synthetic
  records for development.
- With a database connection, Python reads complete immutable 21-feature
  snapshots and finalized tiers from `churn_training_observations`; it never
  silently substitutes synthetic rows or reconstructs features using later data.
- Incomplete snapshots and unfinalized outcomes are excluded. Zero usable rows
  stops training.
- Production registration requires at least 500 observed customers, AUC-ROC ≥
  0.78, and HIGH_RISK precision ≥ 0.72.

The final fit gives the actionable `AT_RISK` class a logged sample weight of
1.5. That value improves class balance without changing labels or decision
thresholds. Synthetic metrics remain development evidence only.

Eligible future artifacts register as `churn_risk` and, when trainable,
`churn_early_warning`. Serving loads only their `Production` stages and uses the
documented deterministic fallback when unavailable.

Observed-outcome storage, completed observation windows, optional engagement
tables, webhooks, indexes, and backfill requirements are in
[`docs/BACKEND_IMPLEMENTATION_GUIDE.md`](../../../../docs/BACKEND_IMPLEMENTATION_GUIDE.md).

Tests are in `python/tests/test_churn_model.py` and `python/tests/test_api.py`.
