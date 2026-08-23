"""
Customer Sensitivity Classifier (M2) — Training Script.

Trains dual Logistic Regression classifiers to evaluate customer price and
convenience sensitivities.
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
from src.features.pipeline import (
    calculate_coupon_usage_pct,
    calculate_scroll_depth,
    calculate_cursor_hesitation,
    calculate_checkout_step_reached,
    calculate_abandoned_at_shipping_reveal,
    calculate_visited_coupon_page,
    calculate_searched_discount_terms,
    calculate_tab_switch_count,
)
from src.features.event_processor import group_events_by_session

# Minimum customer records required for real-data training.
# records with recovery outcomes."
MIN_REAL_RECORDS = 500

FEATURES = [
    "past_orders_with_coupon_pct", "visited_coupon_page", "searched_discount_terms",
    "cursor_hesitation", "abandoned_at_shipping_reveal",
    "checkout_step_reached", "scroll_depth_pct", "tab_switch_count"
]

# Recovery actions in orders.recovery_status that indicate the recovery
# offer converted the shopper because of price motivation vs. convenience
# motivation. This mirrors the M2 decision matrix in SENSITIVITY_SCORING_RULES.md:
# DISCOUNT/HYBRID -> price-driven conversion (PSS_label=1);
# FRICTION_FIX/HYBRID -> convenience-driven conversion (CSS_label=1).
PRICE_DRIVEN_ACTIONS = {"DISCOUNT", "HYBRID"}
CONVENIENCE_DRIVEN_ACTIONS = {"FRICTION_FIX", "HYBRID"}


def _generate_synthetic_sensitivity_data(n: int = 3000) -> pd.DataFrame:
    """
    Generates synthetic session data for M2 training.
    Includes ~15% stochastic noise to simulate real-world uncertainty.
    """
    np.random.seed(42)

    # --- Generate Features ---
    # past_orders_with_coupon_pct: 0.0 to 1.0 ratio
    past_orders_with_coupon_pct = np.random.uniform(0.0, 1.0, n)
    visited_coupon_page = np.random.choice([False, True], n, p=[0.7, 0.3])
    searched_discount_terms = np.random.choice([False, True], n, p=[0.85, 0.15])
    cursor_hesitation = np.random.poisson(lam=1.5, size=n)
    abandoned_at_shipping_reveal = np.random.choice([False, True], n, p=[0.8, 0.2])
    checkout_step_reached = np.random.randint(1, 5, n)
    scroll_depth_pct = np.random.uniform(10.0, 100.0, n)
    tab_switch_count = np.random.poisson(lam=1.0, size=n)

    # PSS logic: strong influence from past_orders_with_coupon_pct and hesitations
    # Noise added to create realistic overlaps.
    pss_base = (
        (past_orders_with_coupon_pct * 40) +
        (visited_coupon_page * 20) +
        (searched_discount_terms * 15) +
        np.clip(cursor_hesitation * 5, 0, 15) +
        np.clip(tab_switch_count * 2, 0, 10) +
        np.random.normal(0, 10, n)
    )
    
    # CSS logic: High when early checkout abandonment, low scroll depth, shipping-step dropoff
    css_base = (
        ((5 - checkout_step_reached) * 15) +
        ((100 - scroll_depth_pct) * 0.5) +
        (abandoned_at_shipping_reveal * 25) +
        np.random.normal(0, 10, n)
    )

    pss_score = (pss_base / 100.0).clip(0, 1)
    css_score = (css_base / 100.0).clip(0, 1)

    pss_label = (pss_score > 0.5).astype(int)
    css_label = (css_score > 0.5).astype(int)

    return pd.DataFrame({
        "past_orders_with_coupon_pct": past_orders_with_coupon_pct,
        "visited_coupon_page": visited_coupon_page.astype(int),
        "searched_discount_terms": searched_discount_terms.astype(int),
        "cursor_hesitation": cursor_hesitation,
        "abandoned_at_shipping_reveal": abandoned_at_shipping_reveal.astype(int),
        "checkout_step_reached": checkout_step_reached,
        "scroll_depth_pct": scroll_depth_pct,
        "tab_switch_count": tab_switch_count,
        "PSS_label": pss_label,
        "CSS_label": css_label
    })


def _load_real_sensitivity_rows(db_connection) -> pd.DataFrame:
    """
    Builds real M2 training rows from customers + orders + events.

    Row unit: one abandoned/recovered checkout session per customer.
    Features: computed with the exact pipeline.py functions from that
    session's raw events, plus calculate_coupon_usage_pct(customer_id, db)
    for the customer's historical coupon-usage ratio.

    Label source: orders.recovery_status — the recovery_action that
    actually led to a completed order for that customer/session, per
    Phase 3 spec ("Label: which recovery_action actually converted in
    orders.recovery_status"). PSS_label=1 if a DISCOUNT/HYBRID action
    converted; CSS_label=1 if a FRICTION_FIX/HYBRID action converted.
    Sessions with no converting recovery action get PSS_label=CSS_label=0
    (i.e. neither sensitivity dimension was confirmed to be the deciding
    factor).

    STRICT POLICY: when db_connection is provided, this is the only data
    source used for M2 training — there is no silent fallback to
    synthetic data. Any query failure propagates (wrapped with context)
    instead of being swallowed.

    Returns:
        pd.DataFrame with FEATURES + PSS_label + CSS_label. Returns an
        empty DataFrame (not None) if the query succeeds but finds zero
        rows — the caller distinguishes "zero rows" from "query failed"
        and raises a clear error for the zero-row case.

    Raises:
        RuntimeError: if the underlying query fails for any reason.
    """
    try:
        with db_connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT c.session_id, c.customer_id
                FROM checkout c
                WHERE c.status IN ('ABANDONED', 'RECOVERED')
                  AND c.customer_id IS NOT NULL
                """
            )
            session_rows = cursor.fetchall()

        if not session_rows:
            return pd.DataFrame(columns=FEATURES + ["PSS_label", "CSS_label"])

        session_ids = [r[0] for r in session_rows]
        customer_by_session = {r[0]: r[1] for r in session_rows}

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
        converted_action_by_session = _fetch_recovery_actions(db_connection, session_ids)
        return _build_sensitivity_records(session_ids, customer_by_session, events_by_session, converted_action_by_session, db_connection)

    except Exception as e:
        raise RuntimeError(
            f"[M2] Real-data query against checkout/orders/events failed: {e}"
        ) from e


def _fetch_recovery_actions(db_connection, session_ids: list) -> dict:
    """Fetches the most recent converting recovery action for each session.

    Extracted from _load_real_sensitivity_rows to keep it under 80 lines.
    Returns a dict mapping session_id -> recovery_action string (or absent).

    Args:
        db_connection: Active Postgres connection.
        session_ids (list): List of session UUID strings to look up.

    Returns:
        dict: {session_id: recovery_action} for sessions with CONVERTED orders.
    """
    with db_connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT session_id, recovery_action
            FROM orders
            WHERE session_id = ANY(%s)
              AND recovery_status = 'CONVERTED'
            ORDER BY ordered_at DESC
            """,
            (session_ids,)
        )
        recovery_rows = cursor.fetchall()
    result: dict = {}
    for session_id, recovery_action in recovery_rows:
        result.setdefault(session_id, recovery_action)
    return result


def _build_sensitivity_records(
    session_ids: list,
    customer_by_session: dict,
    events_by_session: dict,
    converted_action_by_session: dict,
    db_connection,
) -> pd.DataFrame:
    """Builds M2 feature rows from pre-fetched session data.

    Extracted from _load_real_sensitivity_rows to keep it under 80 lines.
    Applies all 8 pipeline.py feature functions and assigns PSS/CSS labels.

    Args:
        session_ids (list): Ordered list of session UUID strings.
        customer_by_session (dict): session_id -> customer_id mapping.
        events_by_session (dict): Output of group_events_by_session().
        converted_action_by_session (dict): session_id -> recovery_action.
        db_connection: Active Postgres connection (used for coupon_usage_pct).

    Returns:
        pd.DataFrame: Rows of FEATURES + PSS_label + CSS_label.
    """
    records = []
    for session_id in session_ids:
        customer_id = customer_by_session[session_id]
        events = events_by_session.get(session_id, [])
        action = converted_action_by_session.get(session_id)
        pss_label = int(action in PRICE_DRIVEN_ACTIONS) if action else 0
        css_label = int(action in CONVENIENCE_DRIVEN_ACTIONS) if action else 0
        records.append({
            "past_orders_with_coupon_pct": float(calculate_coupon_usage_pct(customer_id, db_connection)),
            "visited_coupon_page": int(calculate_visited_coupon_page(events)),
            "searched_discount_terms": int(calculate_searched_discount_terms(events)),
            "cursor_hesitation": calculate_cursor_hesitation(events),
            "abandoned_at_shipping_reveal": int(calculate_abandoned_at_shipping_reveal(events)),
            "checkout_step_reached": calculate_checkout_step_reached(events),
            "scroll_depth_pct": calculate_scroll_depth(events),
            "tab_switch_count": calculate_tab_switch_count(events),
            "PSS_label": pss_label,
            "CSS_label": css_label,
        })
    return pd.DataFrame.from_records(records)


def load_training_data(db_connection=None) -> tuple:
    """
    Loads M2 training data.

    Queries real database records when a connection is provided, raising an exception if rows are insufficient. db_connection provided -> real data
    ALWAYS used, no silent fallback. Zero real rows or a query failure
    raises. Real rows below MIN_REAL_RECORDS still train, with a loud
    warning and an MLflow tag marking the run as below-threshold.

    Returns:
        (pd.DataFrame, used_real_data: bool, below_minimum: bool)

    Raises:
        RuntimeError: if db_connection is provided and the query fails,
            or succeeds but finds zero rows.
    """
    if db_connection is None:
        print("[M2] No db_connection provided — using synthetic data.")
        return _generate_synthetic_sensitivity_data(), False, False

    real_df = _load_real_sensitivity_rows(db_connection)

    if len(real_df) == 0:
        raise RuntimeError(
            "[M2] db_connection was provided but zero customer records with "
            "recovery outcomes were found. Cannot train on real data — "
            "check that abandoned/recovered checkout sessions and "
            "orders.recovery_status are being populated."
        )

    below_minimum = len(real_df) < MIN_REAL_RECORDS
    if below_minimum:
        print(
            f"[M2] WARNING: training on {len(real_df)} real customer records, "
            f"below the recommended minimum of {MIN_REAL_RECORDS}. Proceeding "
            f"per strict real-data policy — treat PSS/CSS metrics as "
            f"provisional, not production-reliable."
        )
    else:
        print(f"[M2] Training on {len(real_df)} real customer records.")

    return real_df, True, below_minimum


def build_pss_model() -> GradientBoostingClassifier:
    """Builds the Gradient Boosting Classifier for Price Sensitivity Score."""
    return GradientBoostingClassifier(
        n_estimators=100,
        max_depth=3,
        learning_rate=0.1,
        random_state=42
    )


def build_css_model() -> GradientBoostingClassifier:
    """Builds the Gradient Boosting Classifier for Convenience Sensitivity Score."""
    return GradientBoostingClassifier(
        n_estimators=100,
        max_depth=3,
        learning_rate=0.1,
        random_state=42
    )


def train(run_name: str = None, db_connection=None) -> dict:
    """Main training pipeline for both PSS and CSS models.

    Trains two separate GradientBoostingClassifiers (PSS and CSS) and logs
    each independently to MLflow under the Revluma-MVP experiment.

    Args:
        run_name (str | None): Optional MLflow run name override.
        db_connection: Optional Postgres connection. None -> synthetic data.

    Returns:
        dict: Keys 'pss_model', 'css_model', 'pss_metrics', 'css_metrics',
              'used_real_data', 'below_minimum_threshold'.
    """
    get_or_create_experiment()

    print("\n--- Loading M2 Training Data ---")
    data, used_real_data, below_minimum = load_training_data(db_connection)

    X = data[FEATURES]
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
    pss_metrics = _train_and_log_sensitivity_model(
        model=pss_model,
        X_train_scaled=X_train_scaled, X_test_scaled=X_test_scaled,
        y_train=y_pss_train, y_test=y_pss_test,
        target="pss", registered_name="sensitivity_pss",
        n_train=len(X_train), used_real_data=used_real_data,
        below_minimum=below_minimum, scaler=scaler,
    )

    print("Training CSS Model...")
    css_model = build_css_model()
    css_model.fit(X_train_scaled, y_css_train)
    css_metrics = _train_and_log_sensitivity_model(
        model=css_model,
        X_train_scaled=X_train_scaled, X_test_scaled=X_test_scaled,
        y_train=y_css_train, y_test=y_css_test,
        target="css", registered_name="sensitivity_css",
        n_train=len(X_train), used_real_data=used_real_data,
        below_minimum=below_minimum, scaler=scaler,
    )

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
        "css_metrics": css_metrics,
        "used_real_data": used_real_data,
        "below_minimum_threshold": below_minimum,
    }


def _train_and_log_sensitivity_model(
    model: GradientBoostingClassifier,
    X_train_scaled,
    X_test_scaled,
    y_train,
    y_test,
    target: str,
    registered_name: str,
    n_train: int,
    used_real_data: bool,
    below_minimum: bool,
    scaler: StandardScaler,
) -> dict:
    """Evaluates a trained sensitivity model and logs it to MLflow.

    Extracted from train() to keep that function under 80 lines.
    Handles metrics computation, MLflow logging, and scaler artifact upload.

    Args:
        model: Fitted GradientBoostingClassifier (PSS or CSS).
        X_train_scaled: Scaled training feature matrix.
        X_test_scaled: Scaled test feature matrix.
        y_train: Training labels (unused here but kept for API symmetry).
        y_test: Test labels used for metric computation.
        target (str): 'pss' or 'css' — used for MLflow tag and run name.
        registered_name (str): MLflow registered model name.
        n_train (int): Number of training samples (logged as a param).
        used_real_data (bool): Whether real data was used.
        below_minimum (bool): Whether the row count was below the minimum.
        scaler (StandardScaler): Scaler artifact to log alongside the model.

    Returns:
        dict: Metrics dict with 'accuracy', 'f1', 'auc_roc'.
    """
    y_pred = model.predict(X_test_scaled)
    y_prob = model.predict_proba(X_test_scaled)[:, 1]
    metrics = {
        "accuracy": accuracy_score(y_test, y_pred),
        "f1": f1_score(y_test, y_pred),
        "auc_roc": roc_auc_score(y_test, y_prob),
    }
    with mlflow.start_run(run_name=f"m2-{target}-training"):
        mlflow.set_tag("target", target)
        mlflow.set_tag("data_source", "real" if used_real_data else "synthetic")
        mlflow.set_tag("below_minimum_threshold", str(below_minimum))
        mlflow.log_param("n_training_samples", n_train)
        mlflow.log_metrics(metrics)
        mlflow.sklearn.log_model(model, "model", registered_model_name=registered_name)
        with tempfile.TemporaryDirectory() as tmp_dir:
            scaler_path = os.path.join(tmp_dir, "scaler.pkl")
            with open(scaler_path, "wb") as f:
                pickle.dump(scaler, f)
            mlflow.log_artifact(scaler_path, "scaler")
    return metrics


if __name__ == "__main__":
    train()