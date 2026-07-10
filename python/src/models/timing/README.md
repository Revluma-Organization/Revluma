# M3 — Optimal Send-Time Predictor

## 1. Problem Statement
This model determines the optimal send time for lifecycle messages (email / push / SMS) that maximize engagement.
The goal is to predict:
- when a user is most likely to open AND click a message within 120 minutes
This is a temporal behavioral optimization problem based on historical event sequences.

## 2. Target Variable Definition
**Binary Label:** `conversion_within_120min`

**Positive class (1):**
A send event is considered successful if:
- user opens message
- AND user clicks message
- AND both occur within 120 minutes of send timestamp

**Negative class (0):**
- opened but no click
- click outside 120 minutes
- no interaction at all

## 3. Feature Inputs (Must Match Pipeline Exactly)
These must map directly to functions in `python/src/features/pipeline.py`:

**3.1 Time-Based Features**
- `calculate_local_hour_of_session(events)`
- `calculate_day_of_week_session(events)`
- `calculate_time_on_page_ms(events)`
- `calculate_days_since_last_purchase(customer_id, db)`

**3.2 Engagement Features**
- `calculate_scroll_depth(events)`
- `calculate_cursor_hesitation_count(events)`
- `calculate_tab_switch_count(events)`

**3.3 Behavioral Strength Features**
- `calculate_checkout_step_reached(events)`
- `calculate_purchase_frequency_trend(customer_id, db)`

**3.4 Customer Value Features**
- `calculate_avg_order_value(customer_id, db)`
- `calculate_past_orders_total(customer_id, db)`

**3.5 Critical Rule**
All feature names in training code MUST match function names in `pipeline.py` exactly. No renaming allowed.

## 4. Required Database Schema
These tables must exist before training begins.

**4.1 sequence_sends**
```sql
CREATE TABLE sequence_sends (
    id UUID PRIMARY KEY,
    customer_id UUID NOT NULL,
    campaign_id UUID,
    channel TEXT NOT NULL, -- email | push | sms
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
**Algorithm:** GradientBoostingClassifier

**Recommended Hyperparameters:**
- `n_estimators = 150`
- `max_depth = 3`
- `learning_rate = 0.05`
- `random_state = 42`

**Why this model:**
- handles nonlinear time patterns
- robust to sparse behavioral signals
- works well on tabular session data

## 6. Calibration Method
After training:
- apply Platt Scaling or Isotonic Regression
- ensure probability outputs are well calibrated

## 7. Training Requirements
**Minimum dataset size:** 500 labeled send events
Below this threshold:
- model is considered unreliable
- fallback logic should be used in production

## 8. Output Schema
**Model Prediction Output**
```json
{
  "optimal_send_hour": 0-23,
  "optimal_send_day": 0-6,
  "confidence": 0.0 - 1.0
}
```

**Fallback Output (mandatory)**
If model unavailable:
```json
{
  "optimal_send_hour": 10,
  "optimal_send_day": 1,
  "confidence": 0.0
}
```
**Interpretation:**
- hour = local time (24h format)
- day = ISO weekday (0=Monday → 6=Sunday)
- fallback corresponds to: Tuesday 10am (safe baseline engagement window)

## 9. Constraints
- Never predict outside valid ranges
- Must not output negative time values
- Must not output probabilities outside [0,1]
- Must degrade gracefully if features missing

## 10. Business Objective
**Improve:**
- open rate
- click-through rate
- conversion speed
**Reduce:**
- notification fatigue
- irrelevant timing delivery

## 11. Validation Checklist
- [x] Uses exact pipeline feature functions
- [x] Requires both event + DB features
- [x] Uses sequence_sends + sequence_events tables
- [x] Target correctly defined (open + click ≤120min)
- [x] Outputs valid time ranges
- [x] Has fallback values implemented
- [x] Minimum data threshold defined
