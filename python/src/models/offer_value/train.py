"""
M5 - Offer Value Optimizer: Training Script
============================================
Model type  : Gradient Boosting (regression)
Purpose     : Given that M2 has classified a shopper as price-sensitive,
              determines the MINIMUM discount percentage needed to convert
              them, without exceeding merchant margin protection limits.

CORRECTION (previous version of this file had a wrong assumption):
Auditing api.py against the task doc confirmed M2 outputs THREE scores -
"PSS + CSS + TSS" - not two. TSS (Trust Sensitivity Score) is a distinct
signal from CSS. My earlier version assumed TSS == css_score; that was
wrong and is now fixed. TSS has NO backing function anywhere in
pipeline.py or in M2's README - this is a confirmed blocker for whoever
owns M2 (Engineer 3), not something fixable here. tss_score is added as
an accepted input with a safe default (0 = "not trust-sensitive", so the
gate doesn't spuriously fire) until real TSS data exists.

Hard gates corrected to match the doc's exact two separate rules
(previously collapsed into one incorrect OR condition):
  1. tss_score >= 60          -> offer_type TRUST_SIGNAL, discount = 0
  2. pss_score < 35 AND
     css_score < 35           -> offer_type NUDGE,        discount = 0
  else                        -> regression output, clipped 0-25

Features consumed (10 - 9 original + tss_score):
    pss_score                            (float) - output of M2
    css_score                            (float) - output of M2
    tss_score                            (float) - output of M2 [NOT YET REAL DATA]
    cursor_hesitation                    (int)   - HIGH price signal
    past_orders_total                    (int)   - loyalty context
    past_orders_with_coupon_pct          (float) - coupon history
    days_since_last_purchase             (int)   - recency
    avg_order_value                      (float) - order value context
    visited_coupon_page                  (bool)  - price signal
    searched_discount_terms              (bool)  - price signal

Hard constraints (enforced in both label generation AND at prediction time):
    - recommended_discount_pct clipped to [0, 25]
    - TRUST_SIGNAL gate: tss_score >= 60 forces discount = 0
    - NUDGE gate: pss_score < 35 AND css_score < 35 forces discount = 0

Output:
    recommended_discount_pct (int 0-25), offer_type

#--
#Phase 3 — P3.1 real data integration
#--
load_training_data() now accepts db_connection. When provided, it queries
recovered orders that carry a discount_pct (per Phase 3 spec: "M5: Query
recovered orders with discount_amount and coupon_used. Label: discount_pct
that led to conversion") and builds the 9 real behavioural/history
features with pipeline.py functions. tss_score still has no real backing
column anywhere (confirmed blocker, see above) so it is read from
orders.metadata->>'tss_score' if present, else defaults to 0 exactly as
in the synthetic path. Falls back to synthetic data below the
200-recovered-order minimum from the Phase 3 spec, or on any query
failure — including the still-outstanding orders.discount_pct schema
dependency flagged in this model's README Section 6.
#--
#end new
#--
"""

import mlflow
import sys, os
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score

sys.path.append(os.path.join(os.path.dirname(__file__), "../../.."))
from src.config.mlflow_config import get_or_create_experiment
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

# M5 real-data minimum per Phase 3 spec (P3.1): "M5 needs 200 recovered
# orders with discount data."
MIN_REAL_RECOVERED_ORDERS = 200

FEATURE_COLUMNS = [
    'pss_score', 'css_score', 'tss_score', 'cursor_hesitation',
    'past_orders_total', 'past_orders_with_coupon_pct',
    'days_since_last_purchase', 'avg_order_value',
    'visited_coupon_page', 'searched_discount_terms',
]


def apply_hard_constraints(discount_pct, pss_score, css_score, tss_score):
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


def _generate_synthetic_data(n=3000):
    """
    Generates synthetic historical recovery-offer records with the 9 real
    features and a discount_pct label that respects the hard constraints.

    Returns:
        tuple: (X_train, X_test, y_train, y_test)
               y: minimum discount % (0-25) that led to conversion
    """
    np.random.seed(42)

    pss_score = np.random.uniform(0, 100, n)
    css_score = np.random.uniform(0, 100, n)
    # tss_score: synthetic placeholder. No real backing data exists yet -
    # see module docstring. Distribution skewed low since most sessions
    # aren't trust-blocked, with a meaningful tail so the TRUST_SIGNAL
    # gate actually gets exercised in training/testing.
    tss_score = np.random.beta(2, 5, n) * 100
    cursor_hesitation = np.random.randint(0, 10, n)
    past_orders_total = np.random.randint(0, 50, n)
    past_orders_with_coupon_pct = np.random.uniform(0, 1, n)
    days_since_last_purchase = np.random.randint(0, 365, n)
    avg_order_value = np.random.uniform(10.0, 500.0, n)
    visited_coupon_page = np.random.choice([0, 1], size=n, p=[0.6, 0.4])
    searched_discount_terms = np.random.choice([0, 1], size=n, p=[0.7, 0.3])

    # Base discount driven by price-sensitivity signals
    base = (
        (pss_score / 100.0) * 15.0
        + (cursor_hesitation / 10.0) * 4.0
        + past_orders_with_coupon_pct * 6.0
        + visited_coupon_page * 5.0
        + searched_discount_terms * 4.0
        - (css_score / 100.0) * 10.0   # convenience-sensitive shoppers need less $ off
    )
    base += np.random.normal(0, 2.0, n)

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


def _load_real_offer_rows(db_connection):
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

        records = []
        for customer_id, session_id, discount_pct, metadata, pss_score, css_score in rows:
            meta = metadata if isinstance(metadata, dict) else {}
            tss_score = float(meta.get("tss_score", 0) or 0)

            with db_connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT event_type, timestamp, payload
                    FROM customer_events
                    WHERE session_id = %s
                    """,
                    (session_id,)
                )
                event_rows = cursor.fetchall()

            events = [
                {
                    "event_type": row[0],
                    "timestamp": row[1].isoformat() if hasattr(row[1], "isoformat") else row[1],
                    "payload": row[2] if isinstance(row[2], dict) else {},
                }
                for row in event_rows
            ]

            records.append({
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
            })

        return pd.DataFrame.from_records(records)

    except Exception as e:
        raise RuntimeError(
            f"[M5] Real-data query against orders/abandoned_carts/customer_events failed: {e}"
        ) from e


def load_training_data(n=3000, db_connection=None):
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
        print("[M5] No db_connection provided — using synthetic data.")
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
        print(
            f"[M5] WARNING: training on {len(real_df)} real recovered "
            f"orders, below the recommended minimum of "
            f"{MIN_REAL_RECOVERED_ORDERS}. Proceeding per strict real-data "
            f"policy — treat discount_pct predictions as provisional."
        )
    else:
        print(f"[M5] Training on {len(real_df)} real recovered orders.")

    X = real_df[FEATURE_COLUMNS]
    y = real_df["discount_pct"]
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42
    )
    return X_train, X_test, y_train, y_test, True, below_minimum


def build_model():
    """Gradient Boosting regressor predicting minimum effective discount %."""
    return GradientBoostingRegressor(
        n_estimators=150,
        learning_rate=0.05,
        max_depth=3,
        random_state=42
    )


def train(run_name: str = "m5-offervalue-training", db_connection=None):
    """Full training loop with MLflow tracking."""
    get_or_create_experiment()

    print("Loading training data (real if db_connection given, else synthetic N=3000)...")
    X_train, X_test, y_train, y_test, used_real_data, below_minimum = load_training_data(
        n=3000, db_connection=db_connection
    )

    print("Building GradientBoostingRegressor...")
    model = build_model()

    with mlflow.start_run(run_name=run_name) as run:
        mlflow.set_tag("model", "offer_value")
        mlflow.set_tag("data_source", "real" if used_real_data else "synthetic")
        mlflow.set_tag("below_minimum_threshold", str(below_minimum))

        print("Training model...")
        model.fit(X_train, y_train)

        print("Evaluating model...")
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
        })

        mlflow.log_metrics({
            "rmse": rmse,
            "mae": mae,
            "r2": r2,
        })

        # registered_model_name added: api.py calls
        # mlflow.sklearn.load_model("models:/offer_value/latest") - without
        # this, the model never registers and /predict/offer-value always
        # falls back.
        mlflow.sklearn.log_model(model, "m5_offer_value_model", registered_model_name="offer_value")

        print(f"\n--- M5 OFFER VALUE MODEL METRICS ---")
        print(f"Data source: {'real' if used_real_data else 'synthetic'}")
        print(f"RMSE: {rmse:.4f}")
        print(f"MAE:  {mae:.4f}")
        print(f"R2:   {r2:.4f}")

        print(f"\n[OK] MLflow Run ID: {run.info.run_id}")
        print(f"MLflow Run Name: {run.info.run_name}")
        print(f"Check DagsHub UI for the full tracking details.")

        return {"model": model, "used_real_data": used_real_data,
                "below_minimum_threshold": below_minimum,
                "metrics": {"rmse": rmse, "mae": mae, "r2": r2}}


if __name__ == "__main__":
    train()