"""
M4 - Churn Risk Scorer: Training Script
=========================================
Model type  : Gradient Boosting
Purpose     : Continuously scores every customer's churn probability.
              When score crosses 61 (High Risk), automatically triggers
              a 3-touch win-back sequence via the Recovery Queue.

Features consumed (4 + RFM inputs):
    past_orders_total          (int)    - Frequency (F)
    days_since_last_purchase   (int)    - Recency (R), -1 sentinel = no history
    avg_order_value            (float)  - Monetary (M)
    purchase_frequency_trend   (int)    - -1 decreasing / 0 stable / +1 increasing

    RFM sub-scores (computed by calculate_rfm_scores() in pipeline.py):
    rfm_recency_score          (int)  - from customer_crm
    rfm_frequency_score        (int)  - from customer_crm
    rfm_monetary_score         (int)  - from customer_crm

Output:
    churn_tier (str) - HEALTHY, AT_RISK, HIGH_RISK, CRITICAL
    Intervention threshold: HIGH_RISK or CRITICAL

Runs: Daily cron job scoring all customer profiles.
"""

import os
import sys

import mlflow
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import classification_report, roc_auc_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../../..")))
from src.config.mlflow_config import get_or_create_experiment


def load_training_data(n=4000):
    """
    Generates synthetic historical customer records with known churn outcomes.
    Returns:
        tuple: (X_train, X_test, y_train, y_test)
    """
    np.random.seed(42)

    past_orders_total = np.random.randint(0, 50, n)
    days_since_last_purchase = np.random.randint(-1, 365, n)
    avg_order_value = np.random.uniform(10.0, 1000.0, n)
    purchase_frequency_trend = np.random.choice([-1, 0, 1], n)

    rfm_recency_score = np.random.randint(1, 6, n)
    rfm_frequency_score = np.random.randint(1, 6, n)
    rfm_monetary_score = np.random.randint(1, 6, n)

    # Calculate churn probability logic
    # High recency (days_since_last_purchase > 90) + decreasing trend = higher churn risk
    risk_score = np.zeros(n)
    for i in range(n):
        if days_since_last_purchase[i] == -1:
            risk_score[i] = 0.5  # Ambiguous
        else:
            risk_score[i] += min(days_since_last_purchase[i] / 180.0, 1.0)
            if purchase_frequency_trend[i] == -1:
                risk_score[i] += 0.3
            elif purchase_frequency_trend[i] == 1:
                risk_score[i] -= 0.3

            if rfm_recency_score[i] <= 2:
                risk_score[i] += 0.2
            if rfm_frequency_score[i] >= 4:
                risk_score[i] -= 0.2

    # Normalize risk score to 0.0 - 1.0
    risk_score = np.clip(risk_score, 0.0, 1.0)

    # Map to classes
    y = []
    for score in risk_score:
        if score <= 0.30:
            y.append("HEALTHY")
        elif score <= 0.60:
            y.append("AT_RISK")
        elif score <= 0.80:
            y.append("HIGH_RISK")
        else:
            y.append("CRITICAL")

    X = pd.DataFrame(
        {
            "past_orders_total": past_orders_total,
            "days_since_last_purchase": days_since_last_purchase,
            "avg_order_value": avg_order_value,
            "purchase_frequency_trend": purchase_frequency_trend,
            "rfm_recency_score": rfm_recency_score,
            "rfm_frequency_score": rfm_frequency_score,
            "rfm_monetary_score": rfm_monetary_score,
        }
    )

    return train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)


def build_model():
    """
    Gradient Boosting classifier with StandardScaler pipeline.
    """
    return Pipeline(
        [
            ("scaler", StandardScaler()),
            (
                "classifier",
                GradientBoostingClassifier(
                    n_estimators=100, max_depth=3, random_state=42
                ),
            ),
        ]
    )


def train(run_name: str = "m4-churn-training"):
    """Full training loop with MLflow tracking."""
    get_or_create_experiment()

    print("Loading synthetic training data for M4 (N=4000)...")
    X_train, X_test, y_train, y_test = load_training_data(n=4000)

    print("Building M4 GradientBoostingClassifier...")
    model = build_model()

    with mlflow.start_run(run_name=run_name) as run:
        mlflow.set_tag("model", "churn_risk")

        print("Training M4 model...")
        model.fit(X_train, y_train)

        print("Evaluating model...")
        y_pred = model.predict(X_test)
        y_prob = model.predict_proba(X_test)

        report = classification_report(y_test, y_pred, output_dict=True)
        # roc_auc_score for multi-class requires OvR and probability
        auc_roc = roc_auc_score(y_test, y_prob, multi_class="ovr")

        mlflow.log_params({"n_estimators": 100, "max_depth": 3, "random_state": 42})

        # Log overall metrics
        mlflow.log_metrics(
            {
                "accuracy": report["accuracy"],
                "macro_avg_f1": report["macro avg"]["f1-score"],
                "auc_roc": auc_roc,
            }
        )

        mlflow.sklearn.log_model(model, "m4_churn_risk_model")

        print(f"\n--- M4 CHURN RISK MODEL METRICS ---")
        print(f"Accuracy: {report['accuracy']:.4f}")
        print(f"Macro F1: {report['macro avg']['f1-score']:.4f}")
        print(f"AUC-ROC:  {auc_roc:.4f}")

        print(f"\n[OK] MLflow Run ID: {run.info.run_id}")
        print(f"MLflow Run Name: {run.info.run_name}")


if __name__ == "__main__":
    train()
