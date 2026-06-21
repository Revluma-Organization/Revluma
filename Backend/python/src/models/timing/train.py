"""
M3 — Optimal Send-Time Predictor: Training Script
===================================================
Model type  : Gradient Boosting
Purpose     : Predicts the best hour and day to send recovery messages
              for each individual customer, maximising open and click rates.

Features consumed (2 session signals + historical engagement):
    local_hour_of_session     (int 0–23)  — shopper's local hour at session start
    day_of_week_session       (int 0–6)   — 0=Mon … 6=Sun at session start

    Historical engagement signals (from recovery_events table):
    email_open_hour_history    — SendGrid webhook callbacks
    email_click_hour_history   — SendGrid webhook callbacks
    sms_response_hour_history  — Twilio status callbacks

Output:
    best_send_hour  (int 0–23) — optimal local hour to send
    best_send_day   (int 0–6)  — optimal day of week to send

MVP fallback: At launch, no recovery messages have been sent yet,
so training data is very limited. Default to 10 AM and 7 PM local time
and learn from real outcomes over first 2–4 weeks.

"""
import mlflow
import sys, os
sys.path.append(os.path.join(os.path.dirname(__file__), "../../.."))
from src.config.mlflow_config import get_or_create_experiment


def load_training_data():
    """
    Loads historical message engagement data from recovery_events.

    Gap: SendGrid open/click webhooks may not be writing to recovery_events
    yet. Backend Engineer 1 must confirm this is wired (P1 gap).

    Returns:
        tuple: (X_train, X_test, y_train, y_test)
               y: binary engagement label per sent message (opened = 1)
    """
    pass


def build_model():
    """Gradient Boosting regressor predicting engagement probability by hour/day."""
    pass


def train(run_name: str = "m3-sendtime-training"):
    """Full training loop with MLflow tracking."""
    get_or_create_experiment()
    with mlflow.start_run(run_name=run_name):
        pass


if __name__ == "__main__":
    train()
