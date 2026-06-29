"""
M2 — Price vs. Convenience Sensitivity Classifier: Training Script
===================================================================
Model type  : Gradient Boosting
Purpose     : Classifies each shopper as price-sensitive, convenience-
              sensitive, or neutral. Outputs PSS (0–100) and CSS (0–100)
              scores that determine the recovery offer strategy.
"""

import os
import sys
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import accuracy_score, f1_score, roc_auc_score
import mlflow
import mlflow.sklearn
import tempfile
import pickle

sys.path.append(os.path.join(os.path.dirname(__file__), "../../.."))
from src.config.mlflow_config import get_or_create_experiment


def _generate_synthetic_sensitivity_data(n=3000):
    """
    Generates synthetic session data for M2 training.
    Includes ~15% stochastic noise to simulate real-world uncertainty.
    """
    np.random.seed(42)
    
    # 8 features specified by the M2 ClickUp contract
    coupon_usage_pct = np.random.uniform(0, 100, n)
    visited_coupon_page = np.random.randint(0, 2, n)
    searched_discount_terms = np.random.randint(0, 2, n)
    cursor_hesitation = np.random.uniform(0, 5000, n)
    abandoned_at_shipping_reveal = np.random.randint(0, 2, n)
    checkout_step_reached = np.random.randint(1, 6, n)
    scroll_depth_pct = np.random.uniform(0, 100, n)
    time_on_page_ms = np.random.uniform(1000, 120000, n)

    # Base PSS logic: High when coupon usage is high, repeated discount searches, high hesitation, etc.
    pss_prob = (coupon_usage_pct / 100.0 * 0.4 +
                visited_coupon_page * 0.2 +
                searched_discount_terms * 0.2 +
                (np.clip(cursor_hesitation, 0, 5000) / 5000.0) * 0.2)
    
    # Base CSS logic: High when early checkout abandonment, low scroll depth, shipping-step dropoff
    css_prob = ((6 - checkout_step_reached) / 5.0 * 0.4 +
                (1 - scroll_depth_pct / 100.0) * 0.3 +
                abandoned_at_shipping_reveal * 0.3)
    
    # Inject ~15% noise
    pss_prob += np.random.uniform(-0.15, 0.15, n)
    css_prob += np.random.uniform(-0.15, 0.15, n)
    
    pss_label = (pss_prob > 0.5).astype(int)
    css_label = (css_prob > 0.5).astype(int)
    
    return pd.DataFrame({
        "coupon_usage_pct": coupon_usage_pct,
        "visited_coupon_page": visited_coupon_page,
        "searched_discount_terms": searched_discount_terms,
        "cursor_hesitation": cursor_hesitation,
        "abandoned_at_shipping_reveal": abandoned_at_shipping_reveal,
        "checkout_step_reached": checkout_step_reached,
        "scroll_depth_pct": scroll_depth_pct,
        "time_on_page_ms": time_on_page_ms,
        "PSS_label": pss_label,
        "CSS_label": css_label
    })


def build_pss_model():
    """Builds the Gradient Boosting Classifier for Price Sensitivity Score."""
    return GradientBoostingClassifier(
        n_estimators=100,
        max_depth=3,
        learning_rate=0.1,
        random_state=42
    )


def build_css_model():
    """Builds the Gradient Boosting Classifier for Convenience Sensitivity Score."""
    return GradientBoostingClassifier(
        n_estimators=100,
        max_depth=3,
        learning_rate=0.1,
        random_state=42
    )


def train(run_name=None, db_connection=None):
    """
    Main training pipeline for both PSS and CSS models.
    Logs independently to MLflow.
    """
    get_or_create_experiment()
    
    print("\n--- Generating Synthetic Sensitivity Data ---")
    data = _generate_synthetic_sensitivity_data(n=3000)
    
    features = [
        "coupon_usage_pct", "visited_coupon_page", "searched_discount_terms",
        "cursor_hesitation", "abandoned_at_shipping_reveal",
        "checkout_step_reached", "scroll_depth_pct", "time_on_page_ms"
    ]
    
    X = data[features]
    y_pss = data["PSS_label"]
    y_css = data["CSS_label"]

    # 80/20 train-test split, stratified on PSS_label as requested
    X_train, X_test, y_pss_train, y_pss_test, y_css_train, y_css_test = train_test_split(
        X, y_pss, y_css, test_size=0.2, stratify=y_pss, random_state=42
    )

    # Scaling
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled = scaler.transform(X_test)

    # -------------------------------------------------------------------------
    # Train PSS Model
    # -------------------------------------------------------------------------
    print("Training PSS Model...")
    pss_model = build_pss_model()
    pss_model.fit(X_train_scaled, y_pss_train)
    
    y_pss_pred = pss_model.predict(X_test_scaled)
    y_pss_prob = pss_model.predict_proba(X_test_scaled)[:, 1]
    
    pss_metrics = {
        "accuracy": accuracy_score(y_pss_test, y_pss_pred),
        "f1": f1_score(y_pss_test, y_pss_pred),
        "auc_roc": roc_auc_score(y_pss_test, y_pss_prob)
    }

    with mlflow.start_run(run_name="m2-pss-training") as run:
        mlflow.set_tag("target", "pss")
        mlflow.log_metrics(pss_metrics)
        mlflow.sklearn.log_model(pss_model, "model")
        
        # Log scaler artifact
        with tempfile.TemporaryDirectory() as tmp_dir:
            scaler_path = os.path.join(tmp_dir, "scaler.pkl")
            with open(scaler_path, "wb") as f:
                pickle.dump(scaler, f)
            mlflow.log_artifact(scaler_path, "scaler")
            
    # -------------------------------------------------------------------------
    # Train CSS Model
    # -------------------------------------------------------------------------
    print("Training CSS Model...")
    css_model = build_css_model()
    css_model.fit(X_train_scaled, y_css_train)
    
    y_css_pred = css_model.predict(X_test_scaled)
    y_css_prob = css_model.predict_proba(X_test_scaled)[:, 1]
    
    css_metrics = {
        "accuracy": accuracy_score(y_css_test, y_css_pred),
        "f1": f1_score(y_css_test, y_css_pred),
        "auc_roc": roc_auc_score(y_css_test, y_css_prob)
    }

    with mlflow.start_run(run_name="m2-css-training") as run:
        mlflow.set_tag("target", "css")
        mlflow.log_metrics(css_metrics)
        mlflow.sklearn.log_model(css_model, "model")
        
        # Log scaler artifact
        with tempfile.TemporaryDirectory() as tmp_dir:
            scaler_path = os.path.join(tmp_dir, "scaler.pkl")
            with open(scaler_path, "wb") as f:
                pickle.dump(scaler, f)
            mlflow.log_artifact(scaler_path, "scaler")
            
    # Output Requirement
    print("\n===============================")
    print("PSS Metrics:")
    for k, v in pss_metrics.items():
        print(f"  {k}: {v:.4f}")
        
    print("\nCSS Metrics:")
    for k, v in css_metrics.items():
        print(f"  {k}: {v:.4f}")
    print("===============================\n")

    return {
        "pss_model": pss_model,
        "css_model": css_model,
        "pss_metrics": pss_metrics,
        "css_metrics": css_metrics
    }


if __name__ == "__main__":
    train()
