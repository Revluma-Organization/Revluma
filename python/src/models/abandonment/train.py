"""
M1 — Abandonment Probability Predictor: Training Script
=========================================================
Model type  : Logistic Regression
Purpose     : Scores live checkout sessions every 60 seconds to predict
              abandonment before it happens. Triggers exit-intent
              interventions when score exceeds threshold.

Features consumed (5):
    scroll_depth_pct         (float)
    tab_switch_count         (int)
    time_on_page_ms          (float)
    checkout_step_reached    (int)
    failed_payment_attempt   (bool)

Output:
    abandonment_probability (float 0.0–1.0)
    Threshold for intervention: TBD in Week 4 model tuning.
"""

import sys
import os
import pickle
import numpy as np
import pandas as pd
import mlflow
import mlflow.sklearn
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, roc_auc_score

# Ensure the config module can be imported
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../../..")))
try:
    from src.config.mlflow_config import get_or_create_experiment
except ImportError:
    # Fallback if config is missing during isolated execution
    def get_or_create_experiment():
        mlflow.set_experiment("Revluma-MVP")

def _generate_synthetic_data(n=5000):
    """
    Generates synthetic training data for the abandonment model.
    Mandatory Correlation Logic:
      - Abandonment rate ~ 70%
      - failed_payment_attempt strongly increases abandonment
      - high checkout_step_reached decreases abandonment
      - high tab_switch_count increases abandonment
      - low scroll_depth_pct increases abandonment
      - low time_on_page_ms increases abandonment
    """
    np.random.seed(42)
    
    # 1. Base features
    scroll_depth_pct = np.random.uniform(0, 100, n)
    tab_switch_count = np.random.poisson(lam=1.5, size=n)
    time_on_page_ms = np.random.exponential(scale=15000, size=n) + 1000
    checkout_step_reached = np.random.randint(0, 6, n)
    failed_payment_attempt = np.random.choice([0, 1], size=n, p=[0.9, 0.1])
    
    # 2. Log-odds calculation based on features
    # Base intercept tuned to aim for ~70% abandonment
    intercept = 4.5 
    
    log_odds = (
        intercept
        + 3.5 * failed_payment_attempt           # Massive friction
        - 0.8 * checkout_step_reached            # Reaching further decreases abandonment
        + 0.5 * tab_switch_count                 # Switching tabs (price comparison) increases abandonment
        - 0.02 * scroll_depth_pct                # Scrolling down decreases abandonment
        - 0.00005 * time_on_page_ms              # Spending more time decreases abandonment
    )
    
    # Sigmoid function for probability
    probabilities = 1 / (1 + np.exp(-log_odds))
    
    # 3. Label assignment
    abandoned = np.random.binomial(1, probabilities)
    
    df = pd.DataFrame({
        "scroll_depth_pct": scroll_depth_pct,
        "tab_switch_count": tab_switch_count,
        "time_on_page_ms": time_on_page_ms,
        "checkout_step_reached": checkout_step_reached,
        "failed_payment_attempt": failed_payment_attempt,
        "abandoned": abandoned
    })
    
    return df


def load_training_data(db_connection=None):
    """
    Loads labelled training data for the abandonment model.
    """
    if db_connection is None:
        return _generate_synthetic_data()
    else:
        raise NotImplementedError("Database connection will be implemented in Week 4.")


def build_model():
    """
    Defines the Logistic Regression model.
    """
    return LogisticRegression(
        solver="lbfgs",
        max_iter=1000,
        C=1.0,
        class_weight="balanced",
        random_state=42
    )


def train(run_name: str = "m1-abandonment-training", db_connection=None):
    """
    Full training loop with MLflow experiment tracking.
    """
    # Initialize MLflow experiment
    get_or_create_experiment()
    mlflow.set_experiment("Revluma-MVP")
    
    print("Loading data...")
    data = load_training_data(db_connection)
    
    # Split Data
    X = data.drop(columns=["abandoned"])
    y = data["abandoned"]
    
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, stratify=y, random_state=42
    )
    
    print(f"Data loaded. Total samples: {len(data)}, Abandonment Rate: {y.mean():.2%}")
    
    # Start MLflow run
    with mlflow.start_run(run_name=run_name):
        # Scale
        scaler = StandardScaler()
        X_train_scaled = scaler.fit_transform(X_train)
        X_test_scaled = scaler.transform(X_test)
        
        # Model Training
        print("Training model...")
        model = build_model()
        model.fit(X_train_scaled, y_train)
        
        # Predictions
        y_pred = model.predict(X_test_scaled)
        y_prob = model.predict_proba(X_test_scaled)[:, 1]
        
        # Metrics Computation
        accuracy = accuracy_score(y_test, y_pred)
        precision = precision_score(y_test, y_pred)
        recall = recall_score(y_test, y_pred)
        f1 = f1_score(y_test, y_pred)
        auc_roc = roc_auc_score(y_test, y_prob)
        
        print("\n--- Model Metrics ---")
        print(f"Accuracy:  {accuracy:.4f}")
        print(f"Precision: {precision:.4f}")
        print(f"Recall:    {recall:.4f}")
        print(f"F1:        {f1:.4f}")
        print(f"AUC-ROC:   {auc_roc:.4f}")
        print("---------------------\n")
        
        # Logging to MLflow
        mlflow.log_param("solver", model.solver)
        mlflow.log_param("max_iter", model.max_iter)
        mlflow.log_param("C", model.C)
        mlflow.log_param("n_training_samples", len(X_train))
        mlflow.log_param("feature_list", list(X.columns))
        
        mlflow.log_metric("accuracy", accuracy)
        mlflow.log_metric("precision", precision)
        mlflow.log_metric("recall", recall)
        mlflow.log_metric("f1", f1)
        mlflow.log_metric("auc_roc", auc_roc)
        
        # Artifacts
        mlflow.sklearn.log_model(model, "model")
        
        os.makedirs("artifacts", exist_ok=True)
        scaler_path = "artifacts/scaler.pkl"
        with open(scaler_path, "wb") as f:
            pickle.dump(scaler, f)
        mlflow.log_artifact(scaler_path, "preprocessing")
        
        print("MLflow tracking completed successfully.")
        
        return {
            "model": model,
            "scaler": scaler,
            "metrics": {
                "accuracy": accuracy,
                "precision": precision,
                "recall": recall,
                "f1": f1,
                "auc_roc": auc_roc
            }
        }


if __name__ == "__main__":
    train()
