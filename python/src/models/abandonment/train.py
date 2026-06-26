"""
M1 — Abandonment Probability Predictor: Training Script
=========================================================
Model type  : Logistic Regression
Purpose     : Scores live checkout sessions every 60 seconds to predict
              abandonment before it happens. Triggers exit-intent
              interventions when score exceeds threshold.

Features consumed (5):
    scroll_depth_checkout_pct         (float)
    tab_switch_count_session          (int)
    time_on_checkout_step_sec         (float)
    checkout_step_abandoned           (int)
    failed_payment_attempt            (bool)

Output:
    abandonment_probability (float 0.0–1.0)
    Threshold for intervention: TBD in Week 4 model tuning.

Source: FEATURE_VECTOR_SPEC v1.0.0, AI_DATA_REQUIREMENTS v1.0.0

"""

import mlflow
import sys
import os

sys.path.append(os.path.join(os.path.dirname(__file__), "../../.."))
from src.config.mlflow_config import get_or_create_experiment


def load_training_data():
    """
    Loads labelled training data for the abandonment model.

    Data source:
        checkout table — sessions with status ABANDONED or RECOVERED
        customer_events — behavioural feature events per session
        Redis Feature Store — precomputed feature vectors

    Returns:
        tuple: (X_train, X_test, y_train, y_test)
               X shape: (n_sessions, 5 features)
               y: binary label — 1 = abandoned, 0 = converted
    """
    pass


def build_model():
    """
    Defines the Logistic Regression model with preprocessing pipeline.

    Pipeline steps:
        1. MinMaxScaler — scale continuous features to [0, 1] per merchant
        2. LogisticRegression — binary classifier

    Returns:
        sklearn.pipeline.Pipeline
    """
    pass


def train(run_name: str = "m1-abandonment-training"):
    """
    Full training loop with MLflow experiment tracking.

    Logs to MLflow:
        Params  : model hyperparameters, feature list, data split ratio
        Metrics : accuracy, precision, recall, F1, AUC-ROC
        Artifacts: trained model, confusion matrix, feature importance plot

    Args:
        run_name (str): MLflow run display name
    """
    get_or_create_experiment()

    with mlflow.start_run(run_name=run_name):
        pass


if __name__ == "__main__":
    train()
