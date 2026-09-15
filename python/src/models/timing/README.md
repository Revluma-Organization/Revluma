# M3 — Optimal Send-Time Predictor

M3 schedules a recovery message using deterministic safety rules, customer
engagement history, and a calibrated model. Rules are evaluated before model
inference, and the endpoint always returns valid local and UTC timestamps.

## Seven-feature model contract

The model is trained and served with these columns in this exact order:

| Column | Type | Meaning |
| --- | --- | --- |
| `send_hour` | integer, 0–23 | Candidate hour in the customer's local time |
| `send_day` | integer, 0–6 | Candidate local weekday, Monday = 0 |
| `channel` | encoded category | Email, SMS, or WhatsApp |
| `historical_open_rate` | float, 0–1 | Prior open rate for this customer, channel, and hour slot |
| `days_since_last_purchase` | integer, -1+ | Purchase recency; `-1` means no history |
| `cart_value_tier` | encoded category | Low, medium, or premium (`high` is an accepted alias) |
| `recovery_action` | encoded category | Canonical M2 action |

Canonical recovery actions are `DISCOUNT`, `FRICTION_FIX`,
`TRUST_REASSURE`, `HYBRID_BUNDLE`, `TRUST_PLUS_DEAL`,
`FRICTION_PLUS_TRUST`, `FULL_PERSONALISE`, `NUDGE`, and `SOFT_NUDGE`.
Legacy `HYBRID` is accepted only at the input boundary and normalized to
`HYBRID_BUNDLE`.

The target is `engaged_within_120min`: both an open and a click must occur at
or after the send and within 120 minutes. This is an engagement/CTR target,
not a purchase-conversion label.

## Four scheduling layers

1. Immediate overrides: a failed payment schedules SMS after five minutes. A
   risk score of at least 0.80 with a premium/high cart schedules after eight
   minutes.
2. Global baselines: email uses the next Tuesday at 10:00 local; SMS and
   WhatsApp use the next Thursday at 18:30 local.
3. Individual history: at least three observations are required. The 24 hourly
   probabilities are Gaussian-smoothed with sigma 1.5 hours. The first future
   slot at or above 0.55 is selected, capped at 18 hours.
4. Sequence cadence: message 2 waits 24 hours after message 1, or 36 hours when
   message 1 was opened but not clicked. Message 3 waits 48 hours after message
   2 and uses the supplied secondary channel.

All layers enforce quiet hours from 22:00 through 07:59 local. SMS messages are
never scheduled within 24 hours of the previous SMS. When history is sparse or
invalid, the channel baseline is returned immediately without registry access.

## API output

`POST /predict/send-time` returns:

```json
{
  "send_at": "2026-09-03T18:30:00+01:00",
  "send_at_utc": "2026-09-03T17:30:00+00:00",
  "confidence": 0.72,
  "reasoning_layer": "immediate | global_baseline | personalised | hybrid",
  "channel": "email | sms | whatsapp | push",
  "fallback": false
}
```

`fallback` is an additive serving field. It is `true` only when a global
baseline is used because sufficient personalized evidence is unavailable.

The API reads only its startup model cache. It never contacts MLflow during a
request.

## Training and production gates

Development training may use 5,000 deterministic synthetic records, but such a
run is tagged `data_source=synthetic` and is never production-eligible.
Production training requires at least 500 chronologically ordered, labeled real
send events containing both outcome classes. A send is eligible only after its
full 120-minute outcome window has closed and only when its immutable feature
snapshot is complete. No synthetic fallback or default-filled real row is
allowed when a database connection is supplied.

The calibrated classifier is a regularized 200-tree
`GradientBoostingClassifier` (`learning_rate=0.05`, `max_depth=2`,
`min_samples_leaf=20`, `subsample=0.85`) wrapped in five-fold sigmoid
`CalibratedClassifierCV`. Sigmoid calibration avoids the small-cohort
overfitting risk of isotonic calibration at the 500-event production minimum.
Synthetic development uses stratified folds. Real training uses the largest
valid expanding-window split up to five folds so no calibration fold learns
from future sends.

An artifact is registered as `send_time` only when all of these checks pass:

- Real, complete, mature send outcomes are used.
- Score-selected engagement lift is at least 0.08 and its 95% bootstrap
  interval remains above zero.
- Expected calibration error is at most 0.12.
- The lower 95% bootstrap bounds show AUC-ROC above 0.50, average precision
  above the held-out positive rate, and both Brier score and log loss better
  than a constant-rate predictor.
- At least 500 recent events from a backend-recorded randomized control
  evaluation show policy CTR improvement of at least 0.08.

`score_selection_lift` measures enrichment among high-scoring held-out rows; it
is useful for model comparison but is not causal uplift. The compatibility
metric `ctr_improvement` carries the same non-causal value for old dashboards.
Only `randomized_policy_ctr_improvement`, produced from an approved control
design, satisfies the live policy gate.

Serving loads only `models:/send_time/Production`; if it is unavailable, the
scheduling rules return a safe baseline.

MLflow logs data source, production eligibility, exact feature order, sample
count, the descriptive evaluation threshold, accuracy, precision, recall, F1,
AUC-ROC, average precision, Brier score, log loss, null-model comparisons,
selection rate, score-selected engagement lift, calibration error, 95%
bootstrap intervals, controlled-policy evidence, run ID, and a credential-free
run URL when the tracking server is HTTP(S).

## Required real-data fields

Each `sequence_sends.metadata` record must capture the M2 recovery action, cart
value tier, purchase recency at decision time, and historical open rate
computed strictly from earlier events. It must also retain the policy version,
eligible slots, chosen slot, assignment arm, and assignment probability needed
for controlled evaluation. These values are immutable training evidence; later
profile changes must not rewrite them. The detailed database, index, webhook,
idempotency, experiment, and backfill requirements are in
[`docs/BACKEND_IMPLEMENTATION_GUIDE.md`](../../../../docs/BACKEND_IMPLEMENTATION_GUIDE.md).

Tests are in `python/tests/test_timing_model.py` and `python/tests/test_api.py`.
