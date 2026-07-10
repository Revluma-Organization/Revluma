# M3 — Optimal Send-Time Predictor

## Problem Statement
Determines the optimal send time for lifecycle messages (email/push/SMS) that maximize engagement. The goal is to predict when a user is most likely to **open AND click a message within 120 minutes** of it being sent. This is a temporal behavioral optimization problem based on historical event sequences.

## Exact Feature Inputs
All inputs are derived via exact functions in `pipeline.py`:
- `local_hour_of_session` (int 0–23) — extracted from the shopper's timezone via browser tracking.
- `day_of_week_session` (int 0–6) — Monday=0, Sunday=6 at session start.
- `channel` (string) — e.g., 'email', 'sms'.
- `historical_open_rate` (float) — aggregated historical engagement score for the user.

## Target Variable
- **Binary**: `opened_and_clicked_within_120m` (1 if the user opened AND clicked the message within 120 minutes of the send event, 0 otherwise).

## Schema Requirements
- **sequence_sends**: Must contain timestamps for when the message was sent (`sent_at`), opened (`opened_at`), and clicked (`clicked_at`).
- **sequence_events**: Must capture timezone configurations and session metadata to accurately anchor the `local_hour_of_session`.

## Model Type
- **GradientBoostingClassifier** wrapped in **CalibratedClassifierCV** (Platt scaling) to ensure the output probabilities are true calibrated confidences.

## Minimum Training Data Requirement
- 500 labeled send events with fully resolved outcomes (either definitively clicked within 120 minutes, or the 120-minute window has expired).

## Output Schema & Fallback Values
If the model cannot predict or the user lacks history, apply the global baseline rules:
- `optimal_send_hour`: 10
- `optimal_send_day`: 1 (Tuesday)
- `confidence`: 0.0
- `fallback`: true
