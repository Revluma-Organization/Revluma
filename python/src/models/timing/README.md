# M3 — Optimal Send-Time Predictor

## 1. Problem Statement
This model determines the optimal send time for lifecycle recovery messages that maximize engagement.
The goal is to predict:
- when a message sent via a given channel is most likely to convert (open AND click) within 120 minutes
This is a temporal behavioral optimization problem, scored per candidate hour and grid-searched by the serving layer.

## 2. Target Variable Definition
**Binary Label:** `conversion_within_120min`

**Positive class (1):**
A send is considered successful if:
- user opens message
- AND user clicks message
- AND both occur within 120 minutes of send timestamp

**Negative class (0):**
- opened but no click
- click outside 120 minutes
- no interaction at all

## 3. Feature Inputs

> **Correction (see chat audit):** the previous version of this README listed 11 raw `pipeline.py` event functions (`calculate_scroll_depth`, `calculate_cursor_hesitation_count`, etc.) as the required inputs. Auditing `api.py`'s actual `/predict/send-time` endpoint against the task doc showed the real `SendTimeFeatures` Pydantic schema is a completely different, smaller set of fields — the endpoint takes business context already decided upstream (by M2's recovery decision), not raw session events. Section rewritten to match what's actually served. The old function names also had a naming-drift bug (`calculate_cursor_hesitation_count` isn't a real function in `pipeline.py` — the real one is `calculate_cursor_hesitation`), which no longer matters here since those features aren't used by this model at all.

**3.1 Session Context**
- `local_hour_of_session` (int, 0–23) — grid-searched by the endpoint across all 24 hours
- `day_of_week_session` (int, 0–6, ISO)
- `customer_timezone_offset` (int, UTC offset in hours) — used to convert local hour to `send_at_utc`

**3.2 Channel**
- `channel` (str: `email` | `sms` | `whatsapp`)

**3.3 Upstream Business Context (from M2's decision matrix, not raw pipeline.py functions)**
- `recovery_action` (str: `DISCOUNT` | `FRICTION_FIX` | `HYBRID` | `NUDGE` | `SOFT_NUDGE`)
- `cart_value_tier` (str: `low` | `medium` | `high`)

**3.4 Critical Rule**
`channel`, `recovery_action`, and `cart_value_tier` are categorical and must be encoded identically in both `train.py` and `api.py` — the exact maps used are:
```python
CHANNEL_MAP = {"email": 0, "sms": 1, "whatsapp": 2}
RECOVERY_ACTION_MAP = {"DISCOUNT": 0, "FRICTION_FIX": 1, "HYBRID": 2, "NUDGE": 3, "SOFT_NUDGE": 4}
CART_VALUE_TIER_MAP = {"low": 0, "medium": 1, "high": 2}
```
If these maps ever drift out of sync between the two files, predictions become meaningless without raising any error.

**3.5 Known gap (flagged, not fixed)**
The task doc also references a "historical open rate" signal. No corresponding function or data source exists anywhere in the repo yet — left out until that data exists.

## 4. Required Database Schema
Still required for future real (non-synthetic) training data collection — unchanged from the original spec:

**4.1 sequence_sends**
```sql
CREATE TABLE sequence_sends (
    id UUID PRIMARY KEY,
    customer_id UUID NOT NULL,
    campaign_id UUID,
    channel TEXT NOT NULL, -- email | push | sms | whatsapp
    sent_at TIMESTAMP NOT NULL,
    template_id TEXT,
    metadata JSONB
);
```

**4.2 sequence_events**
```sql
CREATE TABLE sequence_events (
    id UUID PRIMARY KEY,
    send_id UUID REFERENCES sequence_sends(id),
    customer_id UUID NOT NULL,
    event_type TEXT NOT NULL, -- open | click | ignore
    event_time TIMESTAMP NOT NULL,
    metadata JSONB
);
```

**4.3 Required Indexes (Performance Critical)**
- `sequence_events(send_id)`
- `sequence_events(customer_id)`
- `sequence_sends(customer_id, sent_at)`

## 5. Model Type
**Algorithm:** GradientBoostingClassifier, wrapped in CalibratedClassifierCV

**Hyperparameters (as built):**
- `n_estimators = 150`
- `max_depth = 3`
- `learning_rate = 0.05`
- `random_state = 42`

**Why this model:**
- handles nonlinear time/channel/context interactions
- robust to sparse behavioral signals
- calibrated probabilities are essential since the endpoint compares scores across 24 candidate hours, not a single threshold

## 6. Calibration Method
`CalibratedClassifierCV(method='sigmoid', cv=3)` — Platt Scaling, applied at training time so `predict_proba` outputs are directly comparable across candidates.

## 7. Training Requirements
**Spec minimum:** 500 labeled send events before a model is considered reliable enough for production; below this, fallback logic is used.
**Current status:** built on 2000 **synthetic** records per the P2.2 task spec (MVP stage — real `sequence_sends`/`sequence_events` data doesn't exist yet). **AUC-ROC 0.845** on held-out synthetic test data, clearing the doc's 0.70 production threshold. This number will change once retrained on real data — treat it as a code-correctness check, not a real-world performance guarantee.

## 8. Output Schema

> **Correction (see chat audit):** the previous version of this README specified `{optimal_send_hour, optimal_send_day, confidence}`. The actual implemented `/predict/send-time` endpoint (matching the task doc's real P2.1 spec) returns a different, richer schema — rewritten below to match what's actually running.

**Model-backed response:**
```json
{
  "send_at": "2026-07-21T10:00:00+02:00",
  "send_at_utc": "2026-07-21T08:00:00+00:00",
  "confidence": 0.0 - 1.0,
  "reasoning_layer": "personalised",
  "channel": "email",
  "fallback": false
}
```

**Fallback response (mandatory, per doc's global baseline rule):**
```json
{
  "send_at": "...(next Tue 10:00 local for email, Thu 18:30 for sms/whatsapp)...",
  "send_at_utc": "...",
  "confidence": 0.0,
  "reasoning_layer": "global_baseline",
  "channel": "email",
  "fallback": true
}
```

## 9. Constraints
- Never predict outside valid hour (0–23) / day (0–6) ranges
- Must not output negative time values
- Must not output probabilities outside [0,1]
- Must degrade gracefully (never 500) if the model is unavailable

## 10. Business Objective
**Improve:** open rate, click-through rate, conversion speed
**Reduce:** notification fatigue, irrelevant timing delivery

## 11. Validation Checklist
- [x] Feature set matches the real `/predict/send-time` endpoint contract (not raw pipeline.py event functions)
- [x] Categorical encodings match exactly between `train.py` and `api.py`
- [ ] Trained on real `sequence_sends` + `sequence_events` data (currently synthetic — MVP stage)
- [x] Target correctly defined (open + click ≤120min)
- [x] Outputs valid time ranges, ISO 8601 timestamps
- [x] Has fallback values implemented (global baseline per channel)
- [x] AUC-ROC ≥ 0.70 production threshold met (0.845)