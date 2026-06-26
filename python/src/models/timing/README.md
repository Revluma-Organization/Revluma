# M3 — Optimal Send-Time Predictor

## What this model does
Predicts the best **hour and day** to send a recovery message to each individual customer, based on when they personally tend to shop and engage with communications.

## Model type
Gradient Boosting

## What it predicts
- `best_send_hour` (int 0–23) — in the shopper's local timezone
- `best_send_day` (int 0–6) — 0=Monday … 6=Sunday

## Features consumed (2 session + historical)

| Feature | Type | Source |
|---|---|---|
| `local_hour_of_session` | int | Tracking pixel — `Intl.DateTimeFormat().resolvedOptions().timeZone` |
| `day_of_week_session` | int | Tracking pixel — same session_start event |
| `email_open_hour_history` | derived | SendGrid webhook → recovery_events |
| `email_click_hour_history` | derived | SendGrid webhook → recovery_events |
| `sms_response_hour_history` | derived | Twilio callbacks → recovery_events |

## Important: Timezone handling
All features use the shopper's **local timezone**, not UTC. The pixel captures `Intl.DateTimeFormat().resolvedOptions().timeZone` on session start. JavaScript's `Date.getDay()` returns Sunday=0 — the pixel must convert to ISO 8601 (Monday=0) before sending.

## Schema gaps (Backend Engineer 1 action needed)
- Confirm SendGrid open/click webhook events are writing to `recovery_events` with granular `event_type` values (P1)
- FCM push interaction history — marked ❌ MISSING, not available at MVP launch

## MVP fallback
At launch, no messages have been sent yet, so the model has no training data. **Default to 10 AM and 7 PM local time** for all customers. The model learns individual patterns after 2–4 weeks of live sends.
