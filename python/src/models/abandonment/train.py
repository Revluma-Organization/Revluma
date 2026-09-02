"""
Abandonment Probability Predictor (M1) — Training Script.

Trains a Logistic Regression classifier to score live checkout sessions every
60 seconds and predict cart abandonment probability.
"""

import sys
import os
import pickle
import logging
import tempfile
import numpy as np
import pandas as pd
import mlflow
import mlflow.sklearn
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, roc_auc_score


logger = logging.getLogger("rev.models.abandonment.train")

# Ensure the config module can be imported
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../../..")))
try:
    from src.config.mlflow_config import get_or_create_experiment, get_run_url
except ImportError:
    # Fallback if config is missing during isolated execution
    def get_or_create_experiment() -> str:
        """Fallback: sets local experiment when mlflow_config is unavailable."""
        mlflow.set_experiment("Revluma-MVP")
        return "0"

    def get_run_url(run_id: str, experiment_id: str) -> str | None:
        return None

from src.features.pipeline import (
    calculate_scroll_depth,
    calculate_tab_switch_count,
    calculate_time_on_page_ms,
    calculate_cursor_hesitation,
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
MIN_AUC_ROC = 0.75
MIN_PRECISION = 0.70
MIN_RECALL = 0.65

FEATURE_COLUMNS = [
    "scroll_depth_pct",
    "tab_switch_count",
    "time_on_page_ms",
    "cursor_hesitation",
    "checkout_step_reached",
    "failed_payment_attempt",
    "cart_item_add_count",
    "cart_item_remove_count",
]
SYNTHETIC_GENERATOR_VERSION = "2.0"


def generate_synthetic_data(n: int = 5000) -> pd.DataFrame:
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
    if n < 1:
        raise ValueError("n must be at least 1")

    rng = np.random.default_rng(42)

    # These latent variables create realistic correlations without encoding
    # demographic or other protected characteristics into the synthetic data.
    engagement = rng.beta(2.2, 2.0, n)
    price_friction = rng.beta(1.8, 3.2, n)
    checkout_step_reached = np.clip(
        np.floor(engagement * 6 + rng.normal(0, 0.9, n)), 0, 5
    ).astype(int)
    scroll_depth_pct = np.clip(
        12 + 83 * engagement + rng.normal(0, 13, n), 0, 100
    )
    time_on_page_ms = np.clip(
        rng.lognormal(mean=9.25, sigma=0.65, size=n)
        * (0.75 + 0.65 * engagement),
        1_000,
        180_000,
    )
    tab_switch_count = rng.poisson(0.45 + 2.4 * price_friction, n)
    cursor_hesitation = np.clip(
        rng.poisson(0.35 + 4.0 * price_friction, n), 0, 10
    )
    cart_item_add_count = rng.poisson(0.8 + 3.0 * engagement, n)
    cart_item_remove_count = np.minimum(
        rng.poisson(0.15 + 1.25 * price_friction, n),
        cart_item_add_count,
    )
    payment_probability = np.clip(
        0.01 + 0.16 * (checkout_step_reached >= 4) + 0.08 * price_friction,
        0,
        0.35,
    )
    failed_payment_attempt = rng.binomial(1, payment_probability)

    # Unobserved noise prevents the label from being a perfect restatement of
    # the features and gives the evaluation a more honest difficulty level.
    intercept = 3.85

    log_odds = (
        intercept
        + 3.5 * failed_payment_attempt           # Massive friction
        - 0.8 * checkout_step_reached            # Reaching further decreases abandonment
        + 0.5 * tab_switch_count                 # Switching tabs (price comparison) increases abandonment
        - 0.02 * scroll_depth_pct                # Scrolling down decreases abandonment
        - 0.00005 * time_on_page_ms              # Spending more time decreases abandonment
        + 0.12 * cursor_hesitation                # Longer focus/blur hesitation raises risk
        + 0.4 * cart_item_remove_count           # Repeated removals signal price hesitation
        + 0.45 * np.where(                       # Window-shopping interaction
            (cart_item_add_count > 3) & (checkout_step_reached < 2), 1, 0
        )
        + rng.normal(0, 0.8, n)
    )

    # Sigmoid function for probability
    probabilities = 1 / (1 + np.exp(-log_odds))

    # 3. Label assignment
    abandoned = rng.binomial(1, probabilities)

    df = pd.DataFrame({
        "scroll_depth_pct": scroll_depth_pct,
        "tab_switch_count": tab_switch_count,
        "time_on_page_ms": time_on_page_ms,
        "cursor_hesitation": cursor_hesitation,
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

    Label source: `abandoned_carts`. An unrecovered abandoned cart is positive;
    a row with `recovered_at` or status RECOVERED is negative. Rows without a
    session ID and nonterminal statuses are excluded.

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
                SELECT
                    ac.session_id,
                    CASE
                        WHEN ac.recovered_at IS NOT NULL
                          OR UPPER(COALESCE(ac.status, '')) = 'RECOVERED'
                        THEN 'RECOVERED'
                        ELSE 'ABANDONED'
                    END AS outcome
                FROM abandoned_carts ac
                WHERE ac.session_id IS NOT NULL
                  AND (
                      ac.recovered_at IS NOT NULL
                      OR UPPER(COALESCE(ac.status, '')) IN ('ABANDONED', 'RECOVERED')
                  )
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

    except Exception as exc:
        raise RuntimeError(
            f"[M1] Real-data query failed ({type(exc).__name__})."
        ) from exc


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
            "cursor_hesitation": calculate_cursor_hesitation(events),
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
        logger.info("m1_synthetic_training_data_selected")
        return generate_synthetic_data(), False, False

    real_df = _load_real_session_rows(db_connection)

    if len(real_df) == 0:
        raise RuntimeError(
            "[M1] db_connection was provided but zero labelled sessions "
            "(ABANDONED/RECOVERED) were found in `abandoned_carts`. "
            "Cannot train on real data — check that the sync job has "
            "populated cart outcomes before retrying."
        )

    below_minimum = len(real_df) < MIN_REAL_LABELED_SESSIONS
    if below_minimum:
        logger.warning(
            "m1_training_data_below_minimum",
            extra={
                "session_count": len(real_df),
                "minimum_session_count": MIN_REAL_LABELED_SESSIONS,
            },
        )
    else:
        logger.info("m1_real_training_data_selected", extra={"session_count": len(real_df)})

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


def _is_production_eligible(
    *,
    used_real_data: bool,
    below_minimum: bool,
    auc_roc: float,
    precision: float,
    recall: float,
) -> bool:
    """Require real minimum data and every assigned M1 quality gate."""
    return (
        used_real_data
        and not below_minimum
        and auc_roc >= MIN_AUC_ROC
        and precision >= MIN_PRECISION
        and recall >= MIN_RECALL
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

    logger.info("m1_training_data_loading")
    data, used_real_data, below_minimum = load_training_data(db_connection)

    # Split Data
    X = data.drop(columns=["abandoned"])
    y = data["abandoned"]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, stratify=y, random_state=42
    )

    logger.info(
        "m1_training_data_loaded",
        extra={"sample_count": len(data), "abandonment_rate": float(y.mean())},
    )

    # Start MLflow run
    with mlflow.start_run(run_name=run_name) as run:
        # Scale
        scaler = StandardScaler()
        X_train_scaled = scaler.fit_transform(X_train)
        X_test_scaled = scaler.transform(X_test)

        # Model Training
        logger.info("m1_model_training_started")
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

        logger.info(
            "m1_model_metrics",
            extra={
                "accuracy": float(accuracy),
                "precision": float(precision),
                "recall": float(recall),
                "f1": float(f1),
                "auc_roc": float(auc_roc),
            },
        )
        production_eligible = _is_production_eligible(
            used_real_data=used_real_data,
            below_minimum=below_minimum,
            auc_roc=auc_roc,
            precision=precision,
            recall=recall,
        )
        _log_training_metrics(
            model,
            scaler,
            X,
            X_train,
            accuracy,
            precision,
            recall,
            f1,
            auc_roc,
            used_real_data,
            below_minimum,
            production_eligible,
            float(y.mean()),
        )

        logger.info("m1_mlflow_tracking_completed")
        result = _build_train_result(
            model,
            scaler,
            accuracy,
            precision,
            recall,
            f1,
            auc_roc,
            used_real_data,
            below_minimum,
        )
        result.update(
            {
                "production_eligible": production_eligible,
                "run_id": run.info.run_id,
                "run_url": get_run_url(
                    run.info.run_id,
                    run.info.experiment_id,
                ),
            }
        )
        return result


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
    production_eligible: bool,
    label_positive_rate: float,
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
    mlflow.set_tag("quality_gates_passed", str(
        auc_roc >= MIN_AUC_ROC
        and precision >= MIN_PRECISION
        and recall >= MIN_RECALL
    ).lower())
    mlflow.set_tag("production_eligible", str(production_eligible).lower())
    if not used_real_data:
        mlflow.set_tag("synthetic_generator_version", SYNTHETIC_GENERATOR_VERSION)
        mlflow.set_tag("synthetic_only_not_for_registration", "true")
    mlflow.log_param("min_real_labeled_sessions_threshold", MIN_REAL_LABELED_SESSIONS)
    mlflow.log_metric("accuracy", accuracy)
    mlflow.log_metric("precision", precision)
    mlflow.log_metric("recall", recall)
    mlflow.log_metric("f1", f1)
    mlflow.log_metric("auc_roc", auc_roc)
    mlflow.log_metric("label_positive_rate", label_positive_rate)
    registration = (
        {"registered_model_name": "abandonment"}
        if production_eligible
        else {}
    )
    mlflow.sklearn.log_model(model, "model", **registration)
    with tempfile.TemporaryDirectory(prefix="revluma-m1-") as temp_dir:
        scaler_path = os.path.join(temp_dir, "scaler.pkl")
        with open(scaler_path, "wb") as artifact_file:
            pickle.dump(scaler, artifact_file)
        mlflow.log_artifact(scaler_path, "preprocessing")


if __name__ == "__main__":
    train()
