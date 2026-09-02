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

The target is `conversion_within_120min`: both an open and a click must occur
at or after the send and within 120 minutes.

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
send events containing both outcome classes. No synthetic fallback is allowed
when a database connection is supplied.

The calibrated classifier is a regularized 200-tree
`GradientBoostingClassifier` (`learning_rate=0.05`, `max_depth=2`,
`min_samples_leaf=20`, `subsample=0.85`) wrapped in five-fold sigmoid
`CalibratedClassifierCV`. Sigmoid calibration avoids the small-cohort
overfitting risk of isotonic calibration at the 500-event production minimum.
A model artifact is registered as
`send_time` only when both gates pass:

- CTR improvement over the held-out global baseline is at least 0.08.
- Expected calibration error is at most 0.12.

MLflow logs the data-source and production-eligibility tags, exact feature
order, sample count, threshold parameters, accuracy, precision, recall, F1,
AUC-ROC, baseline CTR, selected-slot CTR, CTR improvement, calibration error,
run ID, and a credential-free run URL when the tracking server is HTTP(S).

## Required real-data fields

Each `sequence_sends.metadata` record must capture the M2 recovery action, cart
value tier, purchase recency at decision time, and the historical open rate
computed strictly from earlier events. These values are immutable training
evidence; later profile changes must not rewrite them. The detailed database,
index, webhook, idempotency, and backfill requirements are in
[`docs/BACKEND_D_S_IMPLEMENTATION_HANDOFF.md`](../../../../docs/BACKEND_D_S_IMPLEMENTATION_HANDOFF.md).
