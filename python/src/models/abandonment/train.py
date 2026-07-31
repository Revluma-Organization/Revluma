"""
Abandonment Probability Predictor (M1) — Training Script.

Trains a Logistic Regression classifier to score live checkout sessions every
60 seconds and predict cart abandonment probability.
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

from src.features.pipeline import (
    calculate_scroll_depth,
    calculate_tab_switch_count,
    calculate_time_on_page_ms,
    calculate_checkout_step_reached,
    calculate_failed_payment_attempt,
)
from src.features.event_processor import group_events_by_session

# Minimum labelled sessions required for real-data training.
# Below this row count the model is not considered reliable; fall back to
# synthetic data and flag it loudly in the console + MLflow tags.
MIN_REAL_LABELED_SESSIONS = 1000

FEATURE_COLUMNS = [
    "scroll_depth_pct",
    "tab_switch_count",
    "time_on_page_ms",
    "checkout_step_reached",
    "failed_payment_attempt",
]


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


def _load_real_session_rows(db_connection):
    """
    Queries labelled checkout sessions from Postgres and computes the 5 M1
    features for each session using the exact pipeline.py functions (per
    the non-negotiable "feature names must match exactly" rule in
    PIXEL_EVENT_SPEC.md).

    Label source: `checkout.status` — ABANDONED -> 1, RECOVERED/COMPLETED -> 0.
    Only ABANDONED/RECOVERED/COMPLETED sessions are used; ACTIVE sessions
    have no terminal label yet and are excluded.

    STRICT POLICY: when db_connection is provided, this is the only data
    source used — there is no silent fallback to synthetic data. Any query
    failure propagates to the caller (wrapped with context) instead of
    being swallowed, so a broken real-data pipeline is caught immediately
    rather than masked by training on fake data without anyone noticing.

    Returns:
        pd.DataFrame with FEATURE_COLUMNS + "abandoned". Returns an empty
        DataFrame (not None) if the query succeeds but finds zero rows —
        the caller distinguishes "zero rows" from "query failed" and
        raises a clear error for the zero-row case.

    Raises:
        RuntimeError: if the underlying query fails for any reason.
    """
    try:
        with db_connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT c.session_id, c.status
                FROM checkout c
                WHERE c.status IN ('ABANDONED', 'RECOVERED', 'COMPLETED')
                """
            )
            session_rows = cursor.fetchall()

        if not session_rows:
            return pd.DataFrame(columns=FEATURE_COLUMNS + ["abandoned"])

        session_ids = [r[0] for r in session_rows]
        labels = {r[0]: (1 if r[1] == "ABANDONED" else 0) for r in session_rows}

        # Pull every raw event for these sessions in one parameterized query,
        # then group in-process — avoids an N+1 query pattern per session.
        with db_connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT session_id, event_type, timestamp, payload
                FROM customer_events
                WHERE session_id = ANY(%s)
                """,
                (session_ids,)
            )
            event_rows = cursor.fetchall()

        raw_events = [
            {
                "session_id": row[0],
                "event_type": row[1],
                "timestamp": row[2].isoformat() if hasattr(row[2], "isoformat") else row[2],
                "payload": row[3] if isinstance(row[3], dict) else {},
            }
            for row in event_rows
        ]
        events_by_session = group_events_by_session(raw_events)

        records = []
        for session_id in session_ids:
            events = events_by_session.get(session_id, [])
            records.append({
                "scroll_depth_pct": calculate_scroll_depth(events),
                "tab_switch_count": calculate_tab_switch_count(events),
                "time_on_page_ms": calculate_time_on_page_ms(events),
                "checkout_step_reached": calculate_checkout_step_reached(events),
                "failed_payment_attempt": int(calculate_failed_payment_attempt(events)),
                "abandoned": labels[session_id],
            })

        return pd.DataFrame.from_records(records)

    except Exception as e:
        raise RuntimeError(
            f"[M1] Real-data query against checkout/customer_events failed: {e}"
        ) from e


def load_training_data(db_connection=None):
    """
    Loads labelled training data for the abandonment model.

    Queries real database records when a connection is provided, raising an exception if rows are insufficient... the db_connection parameter
    was reserved for this exact purpose"):
      - db_connection is None  -> synthetic data (dev/local path only).
      - db_connection provided -> real data ALWAYS used. No silent
        fallback to synthetic. A query failure or zero real rows raises
        immediately rather than substituting fake data. Real data below
        the documented minimum (MIN_REAL_LABELED_SESSIONS) is still used
        for training, but a loud warning is logged and the run is tagged
        so nobody mistakes an under-powered run for a fully-reliable one.

    Returns:
        (pd.DataFrame, used_real_data: bool, below_minimum: bool)

    Raises:
        RuntimeError: if db_connection is provided and the query fails,
            or succeeds but finds zero labelled sessions.
    """
    if db_connection is None:
        print("[M1] No db_connection provided — using synthetic data.")
        return _generate_synthetic_data(), False, False

    real_df = _load_real_session_rows(db_connection)

    if len(real_df) == 0:
        raise RuntimeError(
            "[M1] db_connection was provided but zero labelled sessions "
            "(ABANDONED/RECOVERED/COMPLETED) were found in `checkout`. "
            "Cannot train on real data — check that the sync job has "
            "populated the checkout table before retrying."
        )

    below_minimum = len(real_df) < MIN_REAL_LABELED_SESSIONS
    if below_minimum:
        print(
            f"[M1] WARNING: training on {len(real_df)} real labelled sessions, "
            f"below the recommended minimum of {MIN_REAL_LABELED_SESSIONS}. "
            f"Proceeding per strict real-data policy — treat this model's "
            f"metrics as provisional, not production-reliable."
        )
    else:
        print(f"[M1] Training on {len(real_df)} real labelled sessions.")

    return real_df, True, below_minimum


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
    data, used_real_data, below_minimum = load_training_data(db_connection)

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
        mlflow.set_tag("data_source", "real" if used_real_data else "synthetic")
        mlflow.set_tag("below_minimum_threshold", str(below_minimum))
        mlflow.log_param("min_real_labeled_sessions_threshold", MIN_REAL_LABELED_SESSIONS)

        mlflow.log_metric("accuracy", accuracy)
        mlflow.log_metric("precision", precision)
        mlflow.log_metric("recall", recall)
        mlflow.log_metric("f1", f1)
        mlflow.log_metric("auc_roc", auc_roc)

        # Artifacts
        mlflow.sklearn.log_model(model, "model", registered_model_name="abandonment")

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
            },
            "used_real_data": used_real_data,
            "below_minimum_threshold": below_minimum,
        }


if __name__ == "__main__":
    train()