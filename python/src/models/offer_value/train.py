"""
Offer Value Optimiser (M5) — Training Script.

Trains a Gradient Boosting Regressor to predict the optimal recovery discount
percentage required to convert an abandoned cart.
"""

import mlflow
import sys, os
import logging
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score


logger = logging.getLogger("rev.models.offer_value.train")

sys.path.append(os.path.join(os.path.dirname(__file__), "../../.."))
from src.config.mlflow_config import get_or_create_experiment, get_run_url
from src.features.pipeline import (
    calculate_cursor_hesitation,
    calculate_past_orders_total,
    calculate_coupon_usage_pct,
    calculate_days_since_last_purchase,
    calculate_avg_order_value,
    calculate_visited_coupon_page,
    calculate_searched_discount_terms,
)
from src.features.event_processor import group_events_by_session

MAX_DISCOUNT_PCT = 25
TSS_THRESHOLD = 60
PSS_NUDGE_FLOOR = 35
CSS_NUDGE_FLOOR = 35

# Minimum recovered orders required for real-data training.
# orders with discount data."
MIN_REAL_RECOVERED_ORDERS = 200
MAX_MAE = 5.0
MIN_R2 = 0.70
SYNTHETIC_GENERATOR_VERSION = "2.0"

FEATURE_COLUMNS = [
    'pss_score', 'css_score', 'tss_score', 'cursor_hesitation',
    'past_orders_total', 'past_orders_with_coupon_pct',
    'days_since_last_purchase', 'avg_order_value',
    'visited_coupon_page', 'searched_discount_terms',
]


def apply_hard_constraints(
    discount_pct,
    pss_score,
    css_score,
    tss_score,
) -> np.ndarray:
    """
    Enforces the merchant-safety rules on top of any raw prediction.
    Two SEPARATE gates per the task doc (not a single OR):
      1. tss_score >= 60                       -> force 0 (TRUST_SIGNAL)
      2. pss_score < 35 AND css_score < 35     -> force 0 (NUDGE)
    Vectorized: accepts numpy arrays or scalars.
    """
    discount_pct = np.clip(discount_pct, 0, MAX_DISCOUNT_PCT)
    trust_gate = tss_score >= TSS_THRESHOLD
    nudge_gate = (pss_score < PSS_NUDGE_FLOOR) & (css_score < CSS_NUDGE_FLOOR)
    zero_mask = trust_gate | nudge_gate
    return np.where(zero_mask, 0, discount_pct)


def _generate_synthetic_data(n: int = 3000) -> tuple:
    """
    Generates synthetic historical recovery-offer records with the 9 real
    features and a discount_pct label that respects the hard constraints.

    Returns:
        tuple: (X_train, X_test, y_train, y_test)
               y: minimum discount % (0-25) that led to conversion
    """
    if n < 1:
        raise ValueError("n must be at least 1")

    rng = np.random.default_rng(42)
    price_friction = rng.beta(2.0, 2.8, n)
    convenience_friction = rng.beta(1.8, 3.0, n)
    trust_friction = rng.beta(1.5, 5.0, n)

    pss_score = np.clip(100 * price_friction + rng.normal(0, 7, n), 0, 100)
    css_score = np.clip(100 * convenience_friction + rng.normal(0, 7, n), 0, 100)
    # tss_score: synthetic placeholder. No real backing data exists yet -
    # see module docstring. Distribution skewed low since most sessions
    # aren't trust-blocked, with a meaningful tail so the TRUST_SIGNAL
    # gate actually gets exercised in training/testing.
    tss_score = np.clip(100 * trust_friction + rng.normal(0, 5, n), 0, 100)
    cursor_hesitation = np.clip(
        rng.poisson(0.4 + 3.5 * price_friction + 2.0 * convenience_friction),
        0,
        10,
    )
    past_orders_total = np.clip(rng.negative_binomial(3, 0.25, n), 0, 50)
    past_orders_with_coupon_pct = np.clip(
        0.05 + 0.82 * price_friction + rng.normal(0, 0.1, n), 0, 1
    )
    days_since_last_purchase = np.clip(rng.exponential(70, n), 0, 365).astype(int)
    avg_order_value = np.clip(rng.lognormal(4.5, 0.65, n), 10, 500)
    visited_coupon_page = rng.binomial(
        1, np.clip(0.05 + 0.7 * price_friction, 0, 0.85)
    )
    searched_discount_terms = rng.binomial(
        1, np.clip(0.02 + 0.5 * price_friction, 0, 0.7)
    )

    # Base discount driven by price-sensitivity signals
    base = (
        (pss_score / 100.0) * 15.0
        + (cursor_hesitation / 10.0) * 4.0
        + past_orders_with_coupon_pct * 6.0
        + visited_coupon_page * 5.0
        + searched_discount_terms * 4.0
        - (css_score / 100.0) * 8.0
        - np.minimum(past_orders_total, 20) * 0.08
    )
    base += rng.normal(0, 2.2, n)

    y = apply_hard_constraints(base, pss_score, css_score, tss_score)

    X = pd.DataFrame({
        'pss_score': pss_score,
        'css_score': css_score,
        'tss_score': tss_score,
        'cursor_hesitation': cursor_hesitation,
        'past_orders_total': past_orders_total,
        'past_orders_with_coupon_pct': past_orders_with_coupon_pct,
        'days_since_last_purchase': days_since_last_purchase,
        'avg_order_value': avg_order_value,
        'visited_coupon_page': visited_coupon_page,
        'searched_discount_terms': searched_discount_terms,
    })

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
    return X_train, X_test, y_train, y_test


def _load_real_offer_rows(db_connection) -> pd.DataFrame:
    """
    Queries recovered orders carrying a discount_pct and builds the 9 real
    behavioural/history features with pipeline.py functions, per Phase 3
    spec P3.1: "Query recovered orders with discount_amount and
    coupon_used. Label: discount_pct that led to conversion."

    pss_score / css_score are read from abandoned_carts (M2's own scored
    output for that session, per MODEL_INPUT_OUTPUT_MAP.md Section 4.3) —
    NOT recomputed here, since M5 is trained on M2's actual historical
    output, not a re-derivation of it. tss_score has no backing column
    (confirmed blocker — see module docstring) and is read from
    orders.metadata->>'tss_score' if present, else defaults to 0.

    STRICT POLICY: when db_connection is provided, this is the only data
    source used for M5 training — no silent fallback to synthetic data.
    Query failures propagate (wrapped with context) instead of being
    swallowed. This includes the still-outstanding orders.discount_pct
    schema dependency flagged in this model's README Section 6 — if that
    column doesn't exist yet, the query will fail loudly here rather than
    silently training on fake discount labels.

    Returns:
        pd.DataFrame with FEATURE_COLUMNS + "discount_pct". Returns an
        empty DataFrame (not None) if the query succeeds but finds zero
        rows.

    Raises:
        RuntimeError: if the underlying query fails for any reason.
    """
    try:
        with db_connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    o.customer_id,
                    o.session_id,
                    o.discount_pct,
                    o.metadata,
                    ac.pss_score,
                    ac.css_score
                FROM orders o
                JOIN abandoned_carts ac ON ac.session_id = o.session_id
                WHERE o.recovery_status = 'CONVERTED'
                  AND o.discount_pct IS NOT NULL
                """
            )
            rows = cursor.fetchall()

        if not rows:
            return pd.DataFrame(columns=FEATURE_COLUMNS + ["discount_pct"])

        records = [
            _build_offer_feature_record(row, db_connection)
            for row in rows
        ]
        return pd.DataFrame.from_records(records)

    except Exception as e:
        raise RuntimeError(
            f"[M5] Real-data query against orders/abandoned_carts/events failed: {e}"
        ) from e


def _build_offer_feature_record(row: tuple, db_connection) -> dict:
    """Builds a single M5 feature record from a recovered-order row.

    Extracted from _load_real_offer_rows to keep it under 80 lines.
    Fetches the session's raw events and computes all 9 behavioural features
    plus the discount_pct label.

    Args:
        row (tuple): (customer_id, session_id, discount_pct, metadata,
                      pss_score, css_score) from the orders/abandoned_carts join.
        db_connection: Active Postgres connection.

    Returns:
        dict: One record with FEATURE_COLUMNS + 'discount_pct'.
    """
    customer_id, session_id, discount_pct, metadata, pss_score, css_score = row
    meta = metadata if isinstance(metadata, dict) else {}
    tss_score = float(meta.get("tss_score", 0) or 0)

    with db_connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT event_type, created_at as timestamp, payload
            FROM events
            WHERE session_id = %s
            """,
            (session_id,)
        )
        event_rows = cursor.fetchall()

    events = [
        {
            "event_type": r[0],
            "timestamp": r[1].isoformat() if hasattr(r[1], "isoformat") else r[1],
            "payload": r[2] if isinstance(r[2], dict) else {},
        }
        for r in event_rows
    ]
    return {
        "pss_score": float(pss_score) if pss_score is not None else 0.0,
        "css_score": float(css_score) if css_score is not None else 0.0,
        "tss_score": tss_score,
        "cursor_hesitation": calculate_cursor_hesitation(events),
        "past_orders_total": calculate_past_orders_total(customer_id, db_connection),
        "past_orders_with_coupon_pct": calculate_coupon_usage_pct(customer_id, db_connection),
        "days_since_last_purchase": calculate_days_since_last_purchase(customer_id, db_connection),
        "avg_order_value": calculate_avg_order_value(customer_id, db_connection),
        "visited_coupon_page": int(calculate_visited_coupon_page(events)),
        "searched_discount_terms": int(calculate_searched_discount_terms(events)),
        "discount_pct": float(discount_pct),
    }


def load_training_data(n: int = 3000, db_connection=None) -> tuple:
    """
    Phase 3 entry point (per task doc P3.1 — the function whose
    db_connection parameter "was reserved for this exact purpose").

    STRICT POLICY: db_connection is None -> synthetic data (dev/local path
    only). db_connection provided -> real recovered-order data ALWAYS
    used, no silent fallback. Zero real rows or a query failure raises
    immediately. Real rows below MIN_REAL_RECOVERED_ORDERS still train,
    with a loud warning and a below-threshold MLflow tag.

    Returns:
        (X_train, X_test, y_train, y_test, used_real_data: bool, below_minimum: bool)

    Raises:
        RuntimeError: if db_connection is provided and the query fails,
            or succeeds but finds zero recovered orders with a discount_pct.
    """
    if db_connection is None:
        logger.info("m5_synthetic_training_data_selected")
        X_train, X_test, y_train, y_test = _generate_synthetic_data(n=n)
        return X_train, X_test, y_train, y_test, False, False

    real_df = _load_real_offer_rows(db_connection)

    if len(real_df) == 0:
        raise RuntimeError(
            "[M5] db_connection was provided but zero recovered orders with "
            "a discount_pct were found. Cannot train on real data — check "
            "that orders.discount_pct exists and is populated (README "
            "Section 6 flags this as an outstanding schema dependency)."
        )

    below_minimum = len(real_df) < MIN_REAL_RECOVERED_ORDERS
    if below_minimum:
        logger.warning(
            "m5_training_data_below_minimum",
            extra={
                "order_count": len(real_df),
                "minimum_order_count": MIN_REAL_RECOVERED_ORDERS,
            },
        )
    else:
        logger.info("m5_real_training_data_selected", extra={"order_count": len(real_df)})

    X = real_df[FEATURE_COLUMNS]
    y = real_df["discount_pct"]
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42
    )
    return X_train, X_test, y_train, y_test, True, below_minimum


def build_model() -> GradientBoostingRegressor:
    """Gradient Boosting regressor predicting minimum effective discount %."""
    return GradientBoostingRegressor(
        n_estimators=150,
        learning_rate=0.05,
        max_depth=3,
        random_state=42
    )


def _is_production_eligible(
    used_real_data: bool,
    below_minimum: bool,
    mae: float,
    r2: float,
) -> bool:
    """Require sufficient real data and minimum regression quality."""
    return (
        used_real_data
        and not below_minimum
        and mae <= MAX_MAE
        and r2 >= MIN_R2
    )


def train(run_name: str = "m5-offervalue-training", db_connection=None) -> dict:
    """Full training loop with MLflow tracking."""
    get_or_create_experiment()

    logger.info("m5_training_data_loading")
    X_train, X_test, y_train, y_test, used_real_data, below_minimum = load_training_data(
        n=3000, db_connection=db_connection
    )

    logger.info("m5_model_building")
    model = build_model()

    with mlflow.start_run(run_name=run_name) as run:
        mlflow.set_tag("model", "offer_value")
        mlflow.set_tag("data_source", "real" if used_real_data else "synthetic")
        mlflow.set_tag("below_minimum_threshold", str(below_minimum))
        if not used_real_data:
            mlflow.set_tag("synthetic_generator_version", SYNTHETIC_GENERATOR_VERSION)
            mlflow.set_tag("synthetic_only_not_for_registration", "true")

        logger.info("m5_model_training_started")
        model.fit(X_train, y_train)

        logger.info("m5_model_evaluation_started")
        raw_pred = model.predict(X_test)
        # Safety net: enforce hard constraints on predictions too, not just labels
        y_pred = apply_hard_constraints(
            raw_pred,
            X_test['pss_score'].values,
            X_test['css_score'].values,
            X_test['tss_score'].values,
        )

        # np.sqrt(mse) used instead of mean_squared_error(squared=False) -
        # that kwarg was removed in newer scikit-learn versions.
        rmse = np.sqrt(mean_squared_error(y_test, y_pred))
        mae = mean_absolute_error(y_test, y_pred)
        r2 = r2_score(y_test, y_pred)
        production_eligible = _is_production_eligible(
            used_real_data,
            below_minimum,
            mae,
            r2,
        )
        mlflow.set_tag("quality_gates_passed", str(
            mae <= MAX_MAE and r2 >= MIN_R2
        ).lower())
        mlflow.set_tag("production_eligible", str(production_eligible).lower())

        mlflow.log_params({
            "n_estimators": 150,
            "learning_rate": 0.05,
            "max_depth": 3,
            "random_state": 42,
            "max_discount_pct": MAX_DISCOUNT_PCT,
            "tss_threshold": TSS_THRESHOLD,
            "pss_nudge_floor": PSS_NUDGE_FLOOR,
            "css_nudge_floor": CSS_NUDGE_FLOOR,
            "n_training_samples": len(X_train),
            "min_real_recovered_orders_threshold": MIN_REAL_RECOVERED_ORDERS,
            "max_mae": MAX_MAE,
            "min_r2": MIN_R2,
        })

        mlflow.log_metrics({
            "rmse": rmse,
            "mae": mae,
            "r2": r2,
            "label_zero_discount_rate": float(np.mean(y_train == 0)),
        })

        registration = (
            {"registered_model_name": "offer_value"}
            if production_eligible
            else {}
        )
        mlflow.sklearn.log_model(
            model,
            "m5_offer_value_model",
            **registration,
        )

        logger.info(
            "m5_model_metrics",
            extra={
                "data_source": "real" if used_real_data else "synthetic",
                "rmse": float(rmse),
                "mae": float(mae),
                "r2": float(r2),
                "mlflow_run_id": run.info.run_id,
                "mlflow_run_name": run.info.run_name,
            },
        )

        return {"model": model, "used_real_data": used_real_data,
                "below_minimum_threshold": below_minimum,
                "production_eligible": production_eligible,
                "run_id": run.info.run_id,
                "run_url": get_run_url(
                    run.info.run_id,
                    run.info.experiment_id,
                ),
                "metrics": {"rmse": rmse, "mae": mae, "r2": r2}}


if __name__ == "__main__":
    train()
