"""
M2 — Shopper Sensitivity Classifier: Training Script (Task I2)
=================================================================
Trains THREE independent binary GradientBoostingClassifier models:
    - PSS (Price Sensitivity Score)
    - CSS (Convenience Sensitivity Score)
    - TSS (Trust Sensitivity Score)   <-- new in this revision

Each score is the calibration-free predict_proba()[:, 1] * 100 of its
respective binary classifier, matching the pattern already established by
the PSS/CSS pair in the earlier version of this file.

#--
#newly added (Task I2, Ire)
#--
CHANGES IN THIS REVISION:

1. Added TSS (Trust Sensitivity Score) as a third model

2. FEATURE SET EXPANDED from 8 to 13 columns, and re-scoped per score
   rather than shared indiscriminately.

#--
#end new
#--
"""

import os
import sys
import pickle
import tempfile

import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import accuracy_score, f1_score, roc_auc_score, classification_report
import mlflow
import mlflow.sklearn

sys.path.append(os.path.join(os.path.dirname(__file__), "../../.."))
from src.config.mlflow_config import get_or_create_experiment

# The 13-column feature contract shared by all three M2 models. Order
# matters — predict.py must assemble feature vectors in this exact order.
FEATURE_COLUMNS = [
    "past_orders_with_coupon_pct",   # float 0.0-1.0  (PSS)
    "visited_coupon_page",           # bool -> 0/1    (PSS)
    "searched_discount_terms",       # bool -> 0/1    (PSS)
    "cart_item_remove_count",        # int            (PSS) [pipeline gap]
    "coupon_field_visited",          # bool -> 0/1    (PSS) [I1 function]
    "abandoned_at_shipping_reveal",  # bool -> 0/1    (CSS)
    "checkout_step_reached",         # int 0-5        (CSS, TSS)
    "cursor_hesitation_ms",          # int            (CSS)
    "time_on_page_ms",               # int            (CSS)
    "failed_payment_attempt",        # bool -> 0/1    (CSS)
    "failed_payment_count",          # int            (TSS) [pipeline gap]
    "is_return_visitor",             # bool -> 0/1    (TSS, derived)
    "avg_order_value",               # float          (TSS)
]

MIN_F1_PER_CLASS = 0.68
MIN_AUC_ROC = 0.72


def _generate_synthetic_sensitivity_data(n: int = 3000, seed: int = 42) -> pd.DataFrame:
    """
    Generates n synthetic sessions across the 13-column feature contract
    plus three independent binary labels (PSS_label, CSS_label, TSS_label).
    ~15% stochastic noise is injected into each label's underlying
    probability, matching the noise level used by the original PSS/CSS
    generator, to avoid trivially learnable synthetic patterns.
    """
    rng = np.random.default_rng(seed)

    past_orders_with_coupon_pct = rng.uniform(0, 1, n)
    visited_coupon_page = rng.choice([0, 1], size=n, p=[0.6, 0.4])
    searched_discount_terms = rng.choice([0, 1], size=n, p=[0.75, 0.25])
    cart_item_remove_count = rng.poisson(0.6, n)
    coupon_field_visited = rng.choice([0, 1], size=n, p=[0.7, 0.3])

    abandoned_at_shipping_reveal = rng.choice([0, 1], size=n, p=[0.6, 0.4])
    checkout_step_reached = rng.integers(0, 6, n)
    cursor_hesitation_ms = np.clip(rng.exponential(1500, n), 0, 30000)
    time_on_page_ms = rng.exponential(20000, n) + 1000
    failed_payment_attempt = rng.choice([0, 1], size=n, p=[0.85, 0.15])

    failed_payment_count = np.where(
        failed_payment_attempt == 1, rng.poisson(1, n) + 1, 0
    )
    is_return_visitor = rng.choice([0, 1], size=n, p=[0.5, 0.5])
    avg_order_value = rng.uniform(10, 600, n)

    # ---- PSS label: coupon/discount-seeking behaviour ----
    pss_prob = (
        0.35 * past_orders_with_coupon_pct
        + 0.25 * visited_coupon_page
        + 0.15 * searched_discount_terms
        + 0.15 * np.clip(cart_item_remove_count / 3.0, 0, 1)
        + 0.10 * coupon_field_visited
    )
    pss_prob += rng.uniform(-0.15, 0.15, n)
    pss_label = (pss_prob > 0.5).astype(int)

    # ---- CSS label: checkout friction behaviour ----
    css_prob = (
        0.30 * abandoned_at_shipping_reveal
        + 0.25 * (checkout_step_reached / 5.0)
        + 0.20 * np.clip(cursor_hesitation_ms / 10000.0, 0, 1)
        + 0.15 * np.clip(time_on_page_ms / 120000.0, 0, 1)
        + 0.10 * failed_payment_attempt
    )
    css_prob += rng.uniform(-0.15, 0.15, n)
    css_label = (css_prob > 0.5).astype(int)

    # ---- TSS label: trust/friction-at-final-step behaviour ----
    tss_prob = (
        0.50 * (failed_payment_count > 1).astype(float)
        + 0.30 * (checkout_step_reached == 5).astype(float)
        + 0.35 * ((is_return_visitor == 0) & (avg_order_value > 150)).astype(float)
    )
    tss_prob += rng.uniform(-0.15, 0.15, n)
    tss_label = (tss_prob > 0.5).astype(int)

    return pd.DataFrame({
        "past_orders_with_coupon_pct": past_orders_with_coupon_pct,
        "visited_coupon_page": visited_coupon_page,
        "searched_discount_terms": searched_discount_terms,
        "cart_item_remove_count": cart_item_remove_count,
        "coupon_field_visited": coupon_field_visited,
        "abandoned_at_shipping_reveal": abandoned_at_shipping_reveal,
        "checkout_step_reached": checkout_step_reached,
        "cursor_hesitation_ms": cursor_hesitation_ms,
        "time_on_page_ms": time_on_page_ms,
        "failed_payment_attempt": failed_payment_attempt,
        "failed_payment_count": failed_payment_count,
        "is_return_visitor": is_return_visitor,
        "avg_order_value": avg_order_value,
        "PSS_label": pss_label,
        "CSS_label": css_label,
        "TSS_label": tss_label,
    })


def build_model() -> Pipeline:
    """
    GradientBoostingClassifier wrapped in a StandardScaler Pipeline.
    Bundling the scaler INSIDE the pipeline (rather than logging it as a
    separate pickle artifact, as the pre-I2 version of this file did) means
    the single mlflow.sklearn.log_model() call captures scaler + classifier
    together — eliminating the scaler/model version-drift risk called out
    elsewhere in this repo (e.g. M3's CHANNEL_MAP sync warning). This
    matches the more recent house style used in churn/train.py,
    timing/train.py, and offer_value/train.py.
    """
    return Pipeline([
        ("scaler", StandardScaler()),
        ("classifier", GradientBoostingClassifier(
            n_estimators=100, max_depth=3, learning_rate=0.1, random_state=42
        )),
    ])


def _log_and_train(target: str, X_train, X_test, y_train, y_test, run_name: str) -> dict:
    """
    Trains one target's model (pss | css | tss), logs a dedicated MLflow
    run tagged target=<target>, registers the model as
    `sensitivity_<target>` (matching the MODEL_NAMES / _load_model naming
    convention used by the serving layer), and returns its metrics dict.
    """
    model = build_model()
    model.fit(X_train, y_train)

    y_pred = model.predict(X_test)
    y_prob = model.predict_proba(X_test)[:, 1]

    f1_per_class = f1_score(y_test, y_pred, average=None, zero_division=0)
    metrics = {
        "accuracy": accuracy_score(y_test, y_pred),
        "f1_positive_class": f1_score(y_test, y_pred, zero_division=0),
        "f1_min_per_class": float(min(f1_per_class)) if len(f1_per_class) else 0.0,
        "auc_roc": roc_auc_score(y_test, y_prob),
    }

    with mlflow.start_run(run_name=run_name) as run:
        mlflow.set_tag("model", "sensitivity")
        mlflow.set_tag("target", target)
        mlflow.log_param("n_estimators", 100)
        mlflow.log_param("max_depth", 3)
        mlflow.log_param("learning_rate", 0.1)
        mlflow.log_param("random_state", 42)
        mlflow.log_param("feature_columns", FEATURE_COLUMNS)
        mlflow.log_metrics(metrics)
        mlflow.sklearn.log_model(
            model, "model", registered_model_name=f"sensitivity_{target}"
        )
        metrics["run_id"] = run.info.run_id
        metrics["run_name"] = run.info.run_name

    print(f"\n--- M2 {target.upper()} MODEL METRICS ---")
    print(f"Accuracy:            {metrics['accuracy']:.4f}")
    print(f"F1 (positive class): {metrics['f1_positive_class']:.4f}")
    print(f"F1 (min per class):  {metrics['f1_min_per_class']:.4f}  (gate: >= {MIN_F1_PER_CLASS})")
    print(f"AUC-ROC:             {metrics['auc_roc']:.4f}  (gate: >= {MIN_AUC_ROC})")
    print(classification_report(y_test, y_pred, digits=3, zero_division=0))

    gate_pass = metrics["f1_min_per_class"] >= MIN_F1_PER_CLASS and metrics["auc_roc"] >= MIN_AUC_ROC
    print(f"[{'PASS' if gate_pass else 'FAIL'}] Production gate for {target.upper()}")

    return metrics


def train(run_name: str = None, db_connection=None) -> dict:
    """
    Main training pipeline for PSS, CSS, and TSS models. Each is logged as
    an independent MLflow run under Revluma-MVP so DagsHub shows three
    distinct, individually-comparable run histories.
    """
    get_or_create_experiment()

    print("\n--- Generating Synthetic Sensitivity Data (N=3000, 13 features) ---")
    data = _generate_synthetic_sensitivity_data(n=3000)

    X = data[FEATURE_COLUMNS]
    y_pss = data["PSS_label"]
    y_css = data["CSS_label"]
    y_tss = data["TSS_label"]

    # Single 80/20 split shared across all three targets (stratified on
    # PSS_label, matching the precedent set by the original PSS/CSS file)
    # so all three models are evaluated on the exact same held-out sessions.
    X_train, X_test, y_pss_train, y_pss_test, y_css_train, y_css_test, y_tss_train, y_tss_test = (
        train_test_split(
            X, y_pss, y_css, y_tss, test_size=0.2, random_state=42, stratify=y_pss
        )
    )

    results = {}
    results["pss_metrics"] = _log_and_train(
        "pss", X_train, X_test, y_pss_train, y_pss_test, "m2-pss-training"
    )
    results["css_metrics"] = _log_and_train(
        "css", X_train, X_test, y_css_train, y_css_test, "m2-css-training"
    )
    results["tss_metrics"] = _log_and_train(
        "tss", X_train, X_test, y_tss_train, y_tss_test, "m2-tss-training"
    )

    print("\n===============================")
    print("M2 SENSITIVITY CLASSIFIER — SUMMARY")
    for target in ("pss", "css", "tss"):
        m = results[f"{target}_metrics"]
        print(f"  {target.upper()}: acc={m['accuracy']:.4f} "
              f"f1_min_per_class={m['f1_min_per_class']:.4f} auc_roc={m['auc_roc']:.4f} "
              f"run={m['run_name']}")
    print("===============================\n")

    return results


if __name__ == "__main__":
    train()