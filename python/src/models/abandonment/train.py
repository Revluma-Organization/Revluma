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
    def get_or_create_experiment() -> str:
        """Fallback: sets local experiment when mlflow_config is unavailable."""
        mlflow.set_experiment("Revluma-MVP")
        return "0"

from src.features.pipeline import (
    calculate_scroll_depth,
    calculate_tab_switch_count,
    calculate_time_on_page_ms,
    calculate_checkout_step_reached,
    calculate_failed_payment_attempt,
    calculate_cart_item_add_count,
    calculate_cart_item_remove_count,
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
    "cart_item_add_count",
    "cart_item_remove_count",
]


def _generate_synthetic_data(n: int = 5000) -> pd.DataFrame:
    """
    Generates synthetic training data for the abandonment model.
    Mandatory Correlation Logic:
      - Abandonment rate ~ 70%
      - failed_payment_attempt strongly increases abandonment
      - high checkout_step_reached decreases abandonment
      - high tab_switch_count increases abandonment
      - low scroll_depth_pct increases abandonment
      - low time_on_page_ms increases abandonment
      - high cart_item_remove_count increases abandonment (price hesitation)
      - high cart_item_add_count with low checkout_step increases abandonment
    """
    np.random.seed(42)

    # 1. Base features
    scroll_depth_pct = np.random.uniform(0, 100, n)
    tab_switch_count = np.random.poisson(lam=1.5, size=n)
    time_on_page_ms = np.random.exponential(scale=15000, size=n) + 1000
    checkout_step_reached = np.random.randint(0, 6, n)
    failed_payment_attempt = np.random.choice([0, 1], size=n, p=[0.9, 0.1])
    # Cart behaviour: removals are rarer but a strong hesitation signal.
    cart_item_add_count = np.random.poisson(lam=2.0, size=n)
    cart_item_remove_count = np.random.poisson(lam=0.5, size=n)

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
        + 0.4 * cart_item_remove_count           # Repeated removals signal price hesitation
        + 0.1 * np.where(                        # Window-shopping: adds without progressing
            (cart_item_add_count > 3) & (checkout_step_reached < 2), 1, 0
        )
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
        "cart_item_add_count": cart_item_add_count,
        "cart_item_remove_count": cart_item_remove_count,
        "abandoned": abandoned
    })

    return df


def _load_real_session_rows(db_connection) -> pd.DataFrame:
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
                SELECT session_id, event_type, created_at as timestamp, payload
                FROM events
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
        return _compute_m1_feature_records(session_ids, labels, events_by_session)

    except Exception as e:
        raise RuntimeError(
            f"[M1] Real-data query against checkout/customer_events failed: {e}"
        ) from e


def _compute_m1_feature_records(
    session_ids: list,
    labels: dict,
    events_by_session: dict,
) -> pd.DataFrame:
    """Builds the M1 feature DataFrame from pre-fetched session events.

    Extracted from _load_real_session_rows to keep that function under 80 lines.
    Applies all seven pipeline.py feature functions to each session's events.

    Args:
        session_ids (list): Ordered list of session UUID strings.
        labels (dict): Mapping of session_id -> 0/1 abandonment label.
        events_by_session (dict): Output of group_events_by_session().

    Returns:
        pd.DataFrame: Rows of FEATURE_COLUMNS + 'abandoned' for each session.
    """
    records = []
    for session_id in session_ids:
        events = events_by_session.get(session_id, [])
        records.append({
            "scroll_depth_pct": calculate_scroll_depth(events),
            "tab_switch_count": calculate_tab_switch_count(events),
            "time_on_page_ms": calculate_time_on_page_ms(events),
            "checkout_step_reached": calculate_checkout_step_reached(events),
            "failed_payment_attempt": int(calculate_failed_payment_attempt(events)),
            "cart_item_add_count": calculate_cart_item_add_count(events),
            "cart_item_remove_count": calculate_cart_item_remove_count(events),
            "abandoned": labels[session_id],
        })
    return pd.DataFrame.from_records(records)


def load_training_data(db_connection=None) -> tuple:
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


def build_model() -> LogisticRegression:
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


def train(run_name: str = "m1-abandonment-training", db_connection=None) -> dict:
    """Full training loop with MLflow experiment tracking.

    Args:
        run_name (str): MLflow run name. Defaults to 'm1-abandonment-training'.
        db_connection: Optional live Postgres connection. When None, synthetic
                       data is used. When provided, real checkout sessions are
                       queried and used exclusively.

    Returns:
        dict: Keys 'model', 'scaler', 'metrics', 'used_real_data',
              'below_minimum_threshold'.
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

        _log_training_metrics(model, scaler, X, X_train, accuracy, precision, recall, f1, auc_roc, used_real_data, below_minimum)

        print("MLflow tracking completed successfully.")
        return _build_train_result(model, scaler, accuracy, precision, recall, f1, auc_roc, used_real_data, below_minimum)


def _build_train_result(
    model: LogisticRegression,
    scaler: StandardScaler,
    accuracy: float,
    precision: float,
    recall: float,
    f1: float,
    auc_roc: float,
    used_real_data: bool,
    below_minimum: bool,
) -> dict:
    """Constructs the final dictionary returned by the train() pipeline."""
    return {
        "model": model,
        "scaler": scaler,
        "metrics": {
            "accuracy": accuracy,
            "precision": precision,
            "recall": recall,
            "f1": f1,
            "auc_roc": auc_roc,
        },
        "used_real_data": used_real_data,
        "below_minimum_threshold": below_minimum,
    }


def _log_training_metrics(
    model: LogisticRegression,
    scaler: StandardScaler,
    X: pd.DataFrame,
    X_train: pd.DataFrame,
    accuracy: float,
    precision: float,
    recall: float,
    f1: float,
    auc_roc: float,
    used_real_data: bool,
    below_minimum: bool,
) -> None:
    """Logs model parameters, metrics, and artifacts to the active MLflow run.
    Extracted from train() to keep it under 80 lines."""
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
    mlflow.sklearn.log_model(model, "model", registered_model_name="abandonment")
    os.makedirs("artifacts", exist_ok=True)
    scaler_path = "artifacts/scaler.pkl"
    with open(scaler_path, "wb") as f:
        pickle.dump(scaler, f)
    mlflow.log_artifact(scaler_path, "preprocessing")


if __name__ == "__main__":
    train()