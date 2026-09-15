"""
M2 — Shopper Sensitivity Classifier: Training Script
====================================================
Trains THREE independent binary GradientBoostingClassifier models:
    - PSS (Price Sensitivity Score)
    - CSS (Convenience Sensitivity Score)
    - TSS (Trust Sensitivity Score)

Each score is the five-fold sigmoid-calibrated predict_proba()[:, 1] * 100 of
its respective binary classifier.

The 13-feature contract is intentionally shared by all three scores so
training and inference use one ordered representation.
"""

import os
import sys
import json
import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    brier_score_loss,
    classification_report,
    f1_score,
    log_loss,
    precision_score,
    recall_score,
    roc_auc_score,
)
import mlflow
import mlflow.sklearn

sys.path.append(os.path.join(os.path.dirname(__file__), "../../.."))
from src.config.mlflow_config import get_or_create_experiment, get_run_url

# The 13-column feature contract shared by all three M2 models. Order
# matters — predict.py must assemble feature vectors in this exact order.
FEATURE_COLUMNS = [
    "past_orders_with_coupon_pct",   # float 0.0-1.0  (PSS)
    "visited_coupon_page",           # bool -> 0/1    (PSS)
    "searched_discount_terms",       # bool -> 0/1    (PSS)
    "cart_item_remove_count",        # int            (PSS)
    "coupon_field_visited",          # bool -> 0/1    (PSS)
    "abandoned_at_shipping_reveal",  # bool -> 0/1    (CSS)
    "checkout_step_reached",         # int 0-5        (CSS, TSS)
    "cursor_hesitation",             # int 0-10       (CSS)
    "time_on_page_ms",               # int            (CSS)
    "failed_payment_attempt",        # bool -> 0/1    (CSS)
    "failed_payment_count",          # int            (TSS)
    "is_return_visitor",             # bool -> 0/1    (TSS, derived)
    "avg_order_value",               # float          (TSS)
]

# Backward-compatible export used by existing training-quality checks.
FEATURES = FEATURE_COLUMNS

MIN_F1_PER_CLASS = 0.65
MIN_AUC_ROC = 0.75
MIN_REAL_LABELED_SESSIONS = 500
SYNTHETIC_GENERATOR_VERSION = "2.0"


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
    cursor_hesitation = np.minimum(rng.poisson(2.0, n), 10)
    time_on_page_ms = rng.exponential(20000, n) + 1000
    failed_payment_attempt = rng.choice([0, 1], size=n, p=[0.85, 0.15])

    failed_payment_count = np.where(
        failed_payment_attempt == 1, rng.poisson(1, n) + 1, 0
    )
    is_return_visitor = rng.choice([0, 1], size=n, p=[0.5, 0.5])
    avg_order_value = rng.uniform(10, 600, n)

    # ---- PSS label: coupon/discount-seeking behavior ----
    pss_prob = (
        0.35 * past_orders_with_coupon_pct
        + 0.25 * visited_coupon_page
        + 0.15 * searched_discount_terms
        + 0.15 * np.clip(cart_item_remove_count / 3.0, 0, 1)
        + 0.10 * coupon_field_visited
    )
    pss_prob += rng.uniform(-0.15, 0.15, n)
    pss_label = (pss_prob > 0.5).astype(int)

    # ---- CSS label: checkout friction behavior ----
    css_prob = (
        0.30 * abandoned_at_shipping_reveal
        + 0.25 * (checkout_step_reached / 5.0)
        + 0.20 * (cursor_hesitation / 10.0)
        + 0.15 * np.clip(time_on_page_ms / 120000.0, 0, 1)
        + 0.10 * failed_payment_attempt
    )
    css_prob += rng.uniform(-0.15, 0.15, n)
    css_label = (css_prob > 0.5).astype(int)

    # ---- TSS label: trust/friction-at-final-step behavior ----
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
        "cursor_hesitation": cursor_hesitation,
        "time_on_page_ms": time_on_page_ms,
        "failed_payment_attempt": failed_payment_attempt,
        "failed_payment_count": failed_payment_count,
        "is_return_visitor": is_return_visitor,
        "avg_order_value": avg_order_value,
        "PSS_label": pss_label,
        "CSS_label": css_label,
        "TSS_label": tss_label,
    })


def _load_real_sensitivity_rows(db_connection) -> pd.DataFrame:
    """Load complete feature snapshots with finalized observed labels."""
    try:
        with db_connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT feature_snapshot, pss_label, css_label, tss_label
                FROM sensitivity_training_observations
                WHERE finalized_at IS NOT NULL
                  AND pss_label IS NOT NULL
                  AND css_label IS NOT NULL
                  AND tss_label IS NOT NULL
                ORDER BY decision_at
                """,
                (),
            )
            rows = cursor.fetchall()

        records = []
        for raw_snapshot, pss_label, css_label, tss_label in rows:
            try:
                snapshot = (
                    json.loads(raw_snapshot)
                    if isinstance(raw_snapshot, str)
                    else raw_snapshot
                )
                if not isinstance(snapshot, dict):
                    continue
                if any(name not in snapshot for name in FEATURE_COLUMNS):
                    continue
                record = {name: float(snapshot[name]) for name in FEATURE_COLUMNS}
                record.update({
                    "PSS_label": int(bool(pss_label)),
                    "CSS_label": int(bool(css_label)),
                    "TSS_label": int(bool(tss_label)),
                })
                records.append(record)
            except (TypeError, ValueError, json.JSONDecodeError):
                continue

        return pd.DataFrame.from_records(
            records,
            columns=FEATURE_COLUMNS + ["PSS_label", "CSS_label", "TSS_label"],
        )
    except Exception as exc:
        raise RuntimeError(
            f"Could not load observed M2 training records: {exc}"
        ) from exc


def build_model() -> CalibratedClassifierCV:
    """
    Calibrated GradientBoostingClassifier with synchronized preprocessing.

    Logging the complete pipeline as one artifact keeps preprocessing and
    classifier versions synchronized. Five-fold sigmoid calibration improves
    the probability scores used as PSS, CSS, and TSS values without changing
    the 13-feature contract.
    """
    base_model = Pipeline([
        ("scaler", StandardScaler()),
        ("classifier", GradientBoostingClassifier(
            n_estimators=160,
            max_depth=2,
            learning_rate=0.05,
            min_samples_leaf=20,
            subsample=0.85,
            random_state=42,
        )),
    ])
    return CalibratedClassifierCV(base_model, method="sigmoid", cv=5)


def _is_production_eligible(
    used_real_data: bool,
    below_minimum: bool,
    metrics: dict,
) -> bool:
    """Require sufficient real labels and both quality gates."""
    minimum_f1 = metrics.get("f1_min_per_class", metrics.get("f1", 0.0))
    return (
        used_real_data
        and not below_minimum
        and metrics.get("auc_roc", 0.0) >= MIN_AUC_ROC
        and minimum_f1 >= MIN_F1_PER_CLASS
    )


def _log_and_train(
    target: str,
    X_train,
    X_test,
    y_train,
    y_test,
    run_name: str,
    *,
    used_real_data: bool = False,
    below_minimum: bool = False,
) -> dict:
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
        "accuracy": float(accuracy_score(y_test, y_pred)),
        "precision_positive_class": float(
            precision_score(y_test, y_pred, zero_division=0)
        ),
        "recall_positive_class": float(
            recall_score(y_test, y_pred, zero_division=0)
        ),
        "f1_positive_class": float(f1_score(y_test, y_pred, zero_division=0)),
        "f1_min_per_class": float(min(f1_per_class)) if len(f1_per_class) else 0.0,
        "auc_roc": float(roc_auc_score(y_test, y_prob)),
        "average_precision": float(average_precision_score(y_test, y_prob)),
        "brier_score": float(brier_score_loss(y_test, y_prob)),
        "log_loss": float(log_loss(y_test, y_prob, labels=[0, 1])),
    }
    quality_gates_passed = (
        metrics["f1_min_per_class"] >= MIN_F1_PER_CLASS
        and metrics["auc_roc"] >= MIN_AUC_ROC
    )
    production_eligible = _is_production_eligible(
        used_real_data,
        below_minimum,
        metrics,
    )

    with mlflow.start_run(run_name=run_name) as run:
        mlflow.set_tag("model", "sensitivity")
        mlflow.set_tag("target", target)
        mlflow.set_tag("data_source", "real" if used_real_data else "synthetic")
        if not used_real_data:
            mlflow.set_tag("synthetic_generator_version", SYNTHETIC_GENERATOR_VERSION)
        mlflow.set_tag("quality_gates_passed", str(quality_gates_passed).lower())
        mlflow.set_tag("production_eligible", str(production_eligible).lower())
        mlflow.log_param("n_estimators", 160)
        mlflow.log_param("max_depth", 2)
        mlflow.log_param("learning_rate", 0.05)
        mlflow.log_param("min_samples_leaf", 20)
        mlflow.log_param("subsample", 0.85)
        mlflow.log_param("calibration_method", "sigmoid")
        mlflow.log_param("calibration_cv_folds", 5)
        mlflow.log_param("random_state", 42)
        mlflow.log_param("minimum_real_labeled_sessions", MIN_REAL_LABELED_SESSIONS)
        mlflow.log_param("feature_columns", FEATURE_COLUMNS)
        mlflow.log_metrics(metrics)
        registration = (
            {"registered_model_name": f"sensitivity_{target}"}
            if production_eligible
            else {}
        )
        mlflow.sklearn.log_model(model, "model", **registration)
        metrics["run_id"] = run.info.run_id
        metrics["run_url"] = get_run_url(
            run.info.run_id,
            run.info.experiment_id,
        )
        metrics["run_name"] = run.info.run_name
        metrics["quality_gates_passed"] = quality_gates_passed
        metrics["production_eligible"] = production_eligible

    print(f"\n--- M2 {target.upper()} MODEL METRICS ---")
    print(f"Accuracy:            {metrics['accuracy']:.4f}")
    print(f"F1 (positive class): {metrics['f1_positive_class']:.4f}")
    print(f"F1 (min per class):  {metrics['f1_min_per_class']:.4f}  (gate: >= {MIN_F1_PER_CLASS})")
    print(f"AUC-ROC:             {metrics['auc_roc']:.4f}  (gate: >= {MIN_AUC_ROC})")
    print(classification_report(y_test, y_pred, digits=3, zero_division=0))

    print(f"[{'PASS' if quality_gates_passed else 'FAIL'}] Quality gates for {target.upper()}")
    print(f"Production eligible: {production_eligible}")

    return metrics


def train(run_name: str = None, db_connection=None) -> dict:
    """
    Main training pipeline for PSS, CSS, and TSS models. Each is logged as
    an independent MLflow run under Revluma-MVP so DagsHub shows three
    distinct, individually-comparable run histories.
    """
    get_or_create_experiment()

    if db_connection is None:
        print("\n--- Generating Synthetic Sensitivity Data (N=3000, 13 features) ---")
        data = _generate_synthetic_sensitivity_data(n=3000)
        used_real_data = False
        below_minimum = False
    else:
        print("\n--- Loading Observed Sensitivity Data (13 features) ---")
        data = _load_real_sensitivity_rows(db_connection)
        if data.empty:
            raise RuntimeError(
                "No complete finalized sensitivity observations are available."
            )
        used_real_data = True
        below_minimum = len(data) < MIN_REAL_LABELED_SESSIONS

    X = data[FEATURE_COLUMNS]
    y_pss = data["PSS_label"]
    y_css = data["CSS_label"]
    y_tss = data["TSS_label"]
    for name, labels in (("PSS", y_pss), ("CSS", y_css), ("TSS", y_tss)):
        if labels.nunique() < 2:
            raise RuntimeError(f"M2 real training requires both {name} label classes.")

    # Single 80/20 split shared across all three targets (stratified on
    # PSS_label, matching the precedent set by the original PSS/CSS file)
    # so all three models are evaluated on the exact same held-out sessions.
    X_train, X_test, y_pss_train, y_pss_test, y_css_train, y_css_test, y_tss_train, y_tss_test = (
        train_test_split(
            X, y_pss, y_css, y_tss, test_size=0.2, random_state=42, stratify=y_pss
        )
    )
    for name, train_labels, test_labels in (
        ("PSS", y_pss_train, y_pss_test),
        ("CSS", y_css_train, y_css_test),
        ("TSS", y_tss_train, y_tss_test),
    ):
        if train_labels.nunique() < 2 or test_labels.nunique() < 2:
            raise RuntimeError(
                f"M2 {name} requires both label classes in training and test splits."
            )

    results = {}
    results["pss_metrics"] = _log_and_train(
        "pss", X_train, X_test, y_pss_train, y_pss_test, "m2-pss-training",
        used_real_data=used_real_data, below_minimum=below_minimum,
    )
    results["css_metrics"] = _log_and_train(
        "css", X_train, X_test, y_css_train, y_css_test, "m2-css-training",
        used_real_data=used_real_data, below_minimum=below_minimum,
    )
    results["tss_metrics"] = _log_and_train(
        "tss", X_train, X_test, y_tss_train, y_tss_test, "m2-tss-training",
        used_real_data=used_real_data, below_minimum=below_minimum,
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
