"""
M2 — Price vs. Convenience Sensitivity Classifier: Training Script
===================================================================
Model type  : Gradient Boosting
Purpose     : Classifies each shopper as price-sensitive, convenience-
              sensitive, or neutral. Outputs PSS (0–100) and CSS (0–100)
              scores that determine the recovery offer strategy.

#--
#Phase 3 — P3.1 real data integration
#--
_generate_synthetic_sensitivity_data() is now only used when db_connection
is None. When a real db_connection is supplied, load_training_data() pulls
customers + orders + customer_events and derives PSS_label / CSS_label
from the *actual* recovery outcome recorded in `orders.recovery_status`
(per Phase 3 spec: "Label: which recovery_action actually converted in
orders.recovery_status"), rather than the synthetic probability-threshold
labels. Falls back to synthetic data below the 500-record minimum defined
in AI_DATA_REQUIREMENTS.md / Phase 3 spec (P3.1 M2), or on any query
failure.
#--
#end new
#--
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
    calculate_time_on_page_ms,
)
from src.features.event_processor import group_events_by_session

# M2 real-data minimum per Phase 3 spec (P3.1): "M2 needs 500 customer
# records with recovery outcomes."
MIN_REAL_RECORDS = 500

FEATURES = [
    "coupon_usage_pct", "visited_coupon_page", "searched_discount_terms",
    "cursor_hesitation", "abandoned_at_shipping_reveal",
    "checkout_step_reached", "scroll_depth_pct", "time_on_page_ms"
]

# Recovery actions in orders.recovery_status that indicate the recovery
# offer converted the shopper because of price motivation vs. convenience
# motivation. This mirrors the M2 decision matrix in SENSITIVITY_SCORING_RULES.md:
# DISCOUNT/HYBRID -> price-driven conversion (PSS_label=1);
# FRICTION_FIX/HYBRID -> convenience-driven conversion (CSS_label=1).
PRICE_DRIVEN_ACTIONS = {"DISCOUNT", "HYBRID"}
CONVENIENCE_DRIVEN_ACTIONS = {"FRICTION_FIX", "HYBRID"}


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


def _load_real_sensitivity_rows(db_connection):
    """
    Builds real M2 training rows from customers + orders + customer_events.

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

        # Recovery outcomes: which recovery_action converted each session,
        # per orders.recovery_status. One row per session_id is expected;
        # if multiple recovery attempts exist, the most recent converting
        # order wins.
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

        converted_action_by_session = {}
        for session_id, recovery_action in recovery_rows:
            converted_action_by_session.setdefault(session_id, recovery_action)

        records = []
        for session_id in session_ids:
            customer_id = customer_by_session[session_id]
            events = events_by_session.get(session_id, [])

            action = converted_action_by_session.get(session_id)
            pss_label = int(action in PRICE_DRIVEN_ACTIONS) if action else 0
            css_label = int(action in CONVENIENCE_DRIVEN_ACTIONS) if action else 0

            records.append({
                "coupon_usage_pct": calculate_coupon_usage_pct(customer_id, db_connection) * 100.0,
                "visited_coupon_page": int(calculate_visited_coupon_page(events)),
                "searched_discount_terms": int(calculate_searched_discount_terms(events)),
                "cursor_hesitation": calculate_cursor_hesitation(events),
                "abandoned_at_shipping_reveal": int(calculate_abandoned_at_shipping_reveal(events)),
                "checkout_step_reached": calculate_checkout_step_reached(events),
                "scroll_depth_pct": calculate_scroll_depth(events),
                "time_on_page_ms": calculate_time_on_page_ms(events),
                "PSS_label": pss_label,
                "CSS_label": css_label,
            })

        return pd.DataFrame.from_records(records)

    except Exception as e:
        raise RuntimeError(
            f"[M2] Real-data query against checkout/orders/customer_events failed: {e}"
        ) from e


def load_training_data(db_connection=None):
    """
    Loads M2 training data.

    STRICT POLICY (per Phase 3 task doc P3.1): db_connection is None ->
    synthetic (dev/local path only). db_connection provided -> real data
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

    y_pss_pred = pss_model.predict(X_test_scaled)
    y_pss_prob = pss_model.predict_proba(X_test_scaled)[:, 1]

    pss_metrics = {
        "accuracy": accuracy_score(y_pss_test, y_pss_pred),
        "f1": f1_score(y_pss_test, y_pss_pred),
        "auc_roc": roc_auc_score(y_pss_test, y_pss_prob)
    }

    with mlflow.start_run(run_name="m2-pss-training") as run:
        mlflow.set_tag("target", "pss")
        mlflow.set_tag("data_source", "real" if used_real_data else "synthetic")
        mlflow.set_tag("below_minimum_threshold", str(below_minimum))
        mlflow.log_param("n_training_samples", len(X_train))
        mlflow.log_metrics(pss_metrics)
        mlflow.sklearn.log_model(pss_model, "model", registered_model_name="sensitivity_pss")

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
        mlflow.set_tag("data_source", "real" if used_real_data else "synthetic")
        mlflow.set_tag("below_minimum_threshold", str(below_minimum))
        mlflow.log_param("n_training_samples", len(X_train))
        mlflow.log_metrics(css_metrics)
        mlflow.sklearn.log_model(css_model, "model", registered_model_name="sensitivity_css")

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
        "css_metrics": css_metrics,
        "used_real_data": used_real_data,
        "below_minimum_threshold": below_minimum,
    }


if __name__ == "__main__":
    train()