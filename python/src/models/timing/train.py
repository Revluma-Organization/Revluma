"""
M3 — Optimal Send-Time Predictor: Training Script
===================================================
Model type  : Gradient Boosting (Calibrated)
Purpose     : Predicts the best hour and day to send recovery messages
              for each individual customer, maximising open and click rates.
"""

import mlflow
import sys, os
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.calibration import CalibratedClassifierCV
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, roc_auc_score

sys.path.append(os.path.join(os.path.dirname(__file__), "../../.."))
from src.config.mlflow_config import get_or_create_experiment

def load_training_data(n=2000):
    """
    Generates synthetic historical message engagement data.
    Features: send_hour, send_day, channel (0=email, 1=sms), historical_open_rate
    Target: opened_and_clicked_within_120m
    """
    np.random.seed(42)
    
    # Features
    send_hour = np.random.randint(0, 24, n)
    send_day = np.random.randint(0, 7, n)
    channel = np.random.randint(0, 2, n) # 0 for email, 1 for sms
    historical_open_rate = np.random.uniform(0.0, 1.0, n)
    
    # Synthetic target generation
    # higher engagement typically seen during daytime hours (10-14) or evening (18-21)
    # and slightly better on weekdays (0-4) compared to weekends (5-6)
    
    prob = (historical_open_rate * 0.4)
    prob += np.where((send_hour >= 10) & (send_hour <= 14), 0.2, 0.0)
    prob += np.where((send_hour >= 18) & (send_hour <= 21), 0.25, 0.0)
    prob -= np.where((send_day >= 5), 0.1, 0.0)
    prob += np.where((channel == 1), 0.1, 0.0) # SMS generally has higher open rates
    
    prob = np.clip(prob, 0.0, 1.0)
    y = np.random.binomial(1, prob)
    
    X = pd.DataFrame({
        'send_hour': send_hour,
        'send_day': send_day,
        'channel': channel,
        'historical_open_rate': historical_open_rate
    })
    
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
    return X_train, X_test, y_train, y_test

def build_model():
    """Gradient Boosting classifier with probability calibration."""
    base_clf = GradientBoostingClassifier(n_estimators=100, learning_rate=0.1, max_depth=3, random_state=42)
    # Wrap in CalibratedClassifierCV for Platt scaling (sigmoid)
    calibrated_clf = CalibratedClassifierCV(base_clf, method='sigmoid', cv=3)
    return calibrated_clf

def train(run_name: str = "m3-sendtime-training"):
    """Full training loop with MLflow tracking."""
    get_or_create_experiment()
    
    print("Loading synthetic training data (N=2000)...")
    X_train, X_test, y_train, y_test = load_training_data(n=2000)
    
    print("Building GradientBoostingClassifier with Platt Scaling...")
    model = build_model()
    
    with mlflow.start_run(run_name=run_name) as run:
        mlflow.set_tag("model", "timing")
        
        print("Training model...")
        model.fit(X_train, y_train)
        
        print("Evaluating model...")
        y_pred = model.predict(X_test)
        y_prob = model.predict_proba(X_test)[:, 1]
        
        acc = accuracy_score(y_test, y_pred)
        prec = precision_score(y_test, y_pred, zero_division=0)
        rec = recall_score(y_test, y_pred, zero_division=0)
        f1 = f1_score(y_test, y_pred, zero_division=0)
        auc = roc_auc_score(y_test, y_prob)
        
        mlflow.log_params({
            "n_estimators": 100,
            "learning_rate": 0.1,
            "max_depth": 3,
            "calibration_method": "sigmoid",
            "cv_folds": 3
        })
        
        mlflow.log_metrics({
            "accuracy": acc,
            "precision": prec,
            "recall": rec,
            "f1_score": f1,
            "auc_roc": auc
        })
        
        mlflow.sklearn.log_model(model, "m3_timing_model")
        
        print(f"\n--- M3 TIMING MODEL METRICS ---")
        print(f"Accuracy:  {acc:.4f}")
        print(f"Precision: {prec:.4f}")
        print(f"Recall:    {rec:.4f}")
        print(f"F1 Score:  {f1:.4f}")
        print(f"AUC-ROC:   {auc:.4f}")
        
        print(f"\n✅ MLflow Run ID: {run.info.run_id}")
        print(f"MLflow Run Name: {run.info.run_name}")
        print(f"Check DagsHub UI for the full tracking details.")

if __name__ == "__main__":
    train()
