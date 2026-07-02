"""
M4 — Churn Risk Scorer: Training Script
=========================================
Model type  : Gradient Boosting
Purpose     : Continuously scores every customer's churn probability.
              When score crosses 61 (High Risk), automatically triggers
              a 3-touch win-back sequence via the Recovery Queue.

Features consumed (4 + RFM inputs):
    past_orders_total          (int)    — Frequency (F)
    days_since_last_purchase   (int)    — Recency (R), -1 sentinel = no history
    avg_order_value            (float)  — Monetary (M)
    purchase_frequency_trend   (int)    — -1 decreasing / 0 stable / +1 increasing

    RFM sub-scores (computed by calculate_rfm_scores() in pipeline.py):
    rfm_recency_score          (float)  — from customer_crm
    rfm_frequency_score        (float)  — from customer_crm
    rfm_monetary_score         (float)  — from customer_crm

Output:
    churn_score (float 0–100) — stored in customer_crm.churn_score
    Intervention threshold: 61 (High Risk)

Runs: Daily cron job scoring all customer profiles.

"""

import mlflow
import sys, os
sys.path.append(os.path.join(os.path.dirname(__file__), "../../.."))
from src.config.mlflow_config import get_or_create_experiment


def load_training_data():
    """
    Loads historical customer records with known churn outcomes.
    Ground truth: customers who did not return within 180 days = churned.

    Data from: Order table + customer_crm + recovery_events outcomes.

    Returns:
        tuple: (X_train, X_test, y_train, y_test)
               y: binary — 1 = churned, 0 = retained
    """
    pass


def build_model():
    """
    Gradient Boosting classifier with per-merchant MinMaxScaler.

    Key signal: purchase_frequency_trend = -1 combined with high
    days_since_last_purchase is the strongest churn predictor.

    Returns:
        model pipeline
    """
    pass


def train(run_name: str = "m4-churn-training"):
    """Full training loop with MLflow tracking."""
    get_or_create_experiment()
    with mlflow.start_run(run_name=run_name):
        pass


if __name__ == "__main__":
    train()
