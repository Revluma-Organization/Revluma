# M1 — Abandonment probability predictor

M1 estimates whether an active checkout session will be abandoned. The serving
API returns a probability, applies an intervention threshold of `0.65`, and
falls back to a neutral `0.50` result when the production model is unavailable.
The dedicated prediction module also applies session-context risk modifiers and
maps the result to `abandoned`, `yellow`, `monitor`, or `none`.

## Eight-feature contract

The trainer, API, and predictor use these columns in this exact order:

| Feature | Unit | Source |
| --- | --- | --- |
| `scroll_depth_pct` | 0–100 percentage | Scroll events |
| `tab_switch_count` | Count | Tab-switch events |
| `time_on_page_ms` | Milliseconds | Event timestamps |
| `cursor_hesitation` | 0–10 normalized count | Matched field-focus/blur duration |
| `checkout_step_reached` | Integer 0–5 | Normalized checkout-step events |
| `failed_payment_attempt` | Boolean | Failed-payment events/webhooks |
| `cart_item_add_count` | Count | Add-to-cart events |
| `cart_item_remove_count` | Count | Remove-from-cart events |

`cursor_hesitation_count` remains a same-unit input alias only. New callers and
all stored feature vectors use `cursor_hesitation`.

## Training and registration

Training uses logistic regression with balanced classes. A fitted
`StandardScaler` and classifier are registered together as one sklearn pipeline,
so serving applies the same preprocessing used during training.

- Without a database connection, training uses 5,000 deterministic synthetic
  sessions for development evidence.
- With a database connection, training reads labels from `abandoned_carts` and
  builds features from `events`; there is no silent synthetic fallback.
- Real cohorts below 1,000 labeled sessions may be evaluated but cannot be
  registered.
- Production registration as `abandonment` requires real data, at least 1,000
  sessions, AUC-ROC ≥ 0.75, precision ≥ 0.70, and recall ≥ 0.65.
- Serving loads only `models:/abandonment/Production`.

Synthetic metrics are not evidence of production performance or fairness.

Backend must persist canonical event envelopes and terminal cart outcomes before
real training can run. Webhook, table, index, and outcome-finalization details
are in
[`docs/BACKEND_IMPLEMENTATION_GUIDE.md`](../../../../docs/BACKEND_IMPLEMENTATION_GUIDE.md).

Tests are in `python/tests/test_abandonment_model.py` and
`python/tests/test_api.py`.
