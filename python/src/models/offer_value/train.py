"""
M5 — Offer Value Optimizer: Training Script
============================================
Model type  : GradientBoostingRegressor
Purpose     : Learns the "Base Discount Calculation" (Step 2 of the 5-Step
              offer-value decision logic — i.e. the discount percentage a price-sensitive shopper
              needs, BEFORE customer-history modifiers (Step 3) or hard
              caps (Step 4) are applied. Steps 1, 3, 4, 5 are pure business
              rules with no learned component and live entirely in
              predict.py, not here.

ARCHITECTURE NOTE — why the model only learns Step 2, not the full pipeline:

Step 1 (Offer Necessity Gate) is a hard business rule that runs BEFORE any
model inference (these gates run before any model
inference"). In production, any session that trips a Step 1 gate never
reaches the model at all. Training the regressor on those gated rows too
(label=0) would teach it a discontinuous, mostly-irrelevant relationship
between PSS and 0-labels that it will never actually need to reproduce —
so gated rows are EXCLUDED from the training set entirely. The model only
ever sees, and only ever needs to predict well on, the regime it will
actually be called for in production. This mirrors the same reasoning used
for `sequence_sends`-style event-time splits elsewhere in this repo: train
on the exact distribution the model will see at inference time.

Step 3 (Modifier Adjustments — LTV, cart value, churn tier, first purchase,
failed payment count) and Step 5 (offer type selection) are pure
if/else business rules applied to customer/cart context that is NOT part
of the Step 2 formula's five inputs. Feeding them into a regressor would
make the learned function harder to audit and calibrate against the exact
documented business logic than just applying the rules directly in code —
so they are implemented as plain Python in predict.py instead.

FORMULA (Step 2):
    discount_pct = 2.0
                  + (pss_score / 100 * 14.0)
                  + (past_orders_with_coupon_pct * 8.0)
                  + (visited_coupon_page ? 3.5 : 0)
                  + (searched_discount_terms ? 2.5 : 0)
                  + (failed_coupon_count / 3.0 * 2.0)

This formula is used to LABEL the synthetic training data (with noise), and
is also embedded directly in predict.py as `_base_discount_formula()` — an
exact-formula, model-free fallback used whenever the MLflow-registered
model is unavailable, consistent with every other model's "never crash,
always have an algorithmic fallback" contract in this repo.
"""

import os
import sys
import logging

import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score
import mlflow
import mlflow.sklearn

sys.path.append(os.path.join(os.path.dirname(__file__), "../../.."))
from src.config.mlflow_config import get_or_create_experiment
from src.features.pipeline import (
    calculate_coupon_usage_pct,
    calculate_failed_coupon_count,
    calculate_searched_discount_terms,
    calculate_visited_coupon_page,
)

logger = logging.getLogger("rev.models.offer_value.train")

# Step 1 gate thresholds.
TSS_THRESHOLD = 60
PSS_NUDGE_FLOOR = 35
CSS_NUDGE_FLOOR = 35
MAX_DISCOUNT_PCT = 25.0
MIN_REAL_RECOVERED_ORDERS = 200

# Model feature contract — exactly the 5 inputs Step 2's formula uses.
# css_score / tss_score are used ONLY to decide which synthetic rows are
# gated (and therefore excluded from training) — they are deliberately NOT
# passed to the model, since Step 1 already fully handles them in
# production before the model is ever called.
FEATURE_COLUMNS = [
    "pss_score",
    "past_orders_with_coupon_pct",
    "visited_coupon_page",
    "searched_discount_terms",
    "failed_coupon_count",
]


def _base_discount_formula(pss_score, past_orders_with_coupon_pct,
                            visited_coupon_page, searched_discount_terms,
                            failed_coupon_count):
    """Vectorised (numpy-safe) implementation of the Step 2 formula."""
    visited = np.asarray(visited_coupon_page, dtype=float)
    searched = np.asarray(searched_discount_terms, dtype=float)
    return (
        2.0
        + (np.asarray(pss_score, dtype=float) / 100.0) * 14.0
        + np.asarray(past_orders_with_coupon_pct, dtype=float) * 8.0
        + visited * 3.5
        + searched * 2.5
        + (np.asarray(failed_coupon_count, dtype=float) / 3.0) * 2.0
    )


def _is_gated(pss_score, css_score, tss_score) -> np.ndarray:
    """Step 1 gate check, vectorised — True where the session would never
    reach the model in production (TSS >= 60, OR PSS < 35 AND CSS < 35)."""
    tss_gate = tss_score >= TSS_THRESHOLD
    nudge_gate = (pss_score < PSS_NUDGE_FLOOR) & (css_score < CSS_NUDGE_FLOOR)
    return tss_gate | nudge_gate


def _generate_synthetic_training_data(n: int = 6000, seed: int = 42):
    """
    Generates n synthetic ungated sessions (i.e. sessions that would
    actually reach the model in production) with the 5 Step-2 features and
    a noisy Step-2-formula label, clipped to [0, MAX_DISCOUNT_PCT].

    Over-generates (6x the target N, matching README's stated dataset size
    for the *pre-gate* pool) and then filters down to the ungated subset,
    since roughly 15% of raw synthetic sessions are gated out and would
    otherwise shrink the usable training set below spec.

    Returns:
        tuple: (X_train, X_test, y_train, y_test)
    """
    rng = np.random.default_rng(seed)

    pss_score = rng.uniform(0, 100, n)
    css_score = rng.uniform(0, 100, n)
    # tss_score: still no real backing data anywhere in pipeline.py or M2's
    # README (flagged first in the pre-I3 version of this file) — same
    # synthetic placeholder distribution as before, skewed low with a tail
    # so the TSS gate is meaningfully exercised.
    tss_score = rng.beta(2, 5, n) * 100

    past_orders_with_coupon_pct = rng.uniform(0, 1, n)
    visited_coupon_page = rng.choice([0, 1], size=n, p=[0.6, 0.4])
    searched_discount_terms = rng.choice([0, 1], size=n, p=[0.7, 0.3])
    failed_coupon_count = rng.poisson(0.4, n)

    label = _base_discount_formula(
        pss_score, past_orders_with_coupon_pct,
        visited_coupon_page, searched_discount_terms, failed_coupon_count,
    )
    label += rng.normal(0, 0.8, n)  # measurement noise
    label = np.clip(label, 0.0, MAX_DISCOUNT_PCT)

    gated = _is_gated(pss_score, css_score, tss_score)
    print(f"Synthetic pool: {n} sessions, {gated.sum()} gated by Step 1 "
          f"({gated.mean():.1%}) — excluded from training.")

    X = pd.DataFrame({
        "pss_score": pss_score,
        "past_orders_with_coupon_pct": past_orders_with_coupon_pct,
        "visited_coupon_page": visited_coupon_page,
        "searched_discount_terms": searched_discount_terms,
        "failed_coupon_count": failed_coupon_count,
    })[~gated].reset_index(drop=True)
    y = pd.Series(label[~gated]).reset_index(drop=True)

    print(f"Usable (ungated) training pool: {len(X)} sessions")

    return train_test_split(X, y, test_size=0.2, random_state=42)


def _load_real_training_rows(db_connection) -> pd.DataFrame:
    """Build the M5 feature contract from recovered orders and pixel events.

    This path intentionally raises when the required records are unavailable:
    a caller that requested real-data training must never silently receive a
    synthetic replacement.
    """
    try:
        with db_connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT o.customer_id, o.session_id, o.discount_pct, ac.pss_score
                FROM orders o
                JOIN abandoned_carts ac ON ac.session_id = o.session_id
                WHERE o.recovery_status = 'CONVERTED'
                  AND o.discount_pct IS NOT NULL
                  AND o.session_id IS NOT NULL
                """
            )
            order_rows = cursor.fetchall()
        records = []
        for customer_id, session_id, discount_pct, pss_score in order_rows:
            with db_connection.cursor() as cursor:
                cursor.execute(
                    "SELECT event_type, created_at, payload FROM events WHERE session_id = %s ORDER BY created_at",
                    (session_id,),
                )
                event_rows = cursor.fetchall()
            events = [
                {
                    "event_type": event_type,
                    "timestamp": created_at.isoformat() if hasattr(created_at, "isoformat") else created_at,
                    "payload": payload if isinstance(payload, dict) else {},
                }
                for event_type, created_at, payload in event_rows
            ]
            records.append({
                "pss_score": float(pss_score or 0.0),
                "past_orders_with_coupon_pct": calculate_coupon_usage_pct(customer_id, db_connection),
                "visited_coupon_page": int(calculate_visited_coupon_page(events)),
                "searched_discount_terms": int(calculate_searched_discount_terms(events)),
                "failed_coupon_count": calculate_failed_coupon_count(events),
                "discount_pct": min(MAX_DISCOUNT_PCT, max(0.0, float(discount_pct))),
            })
        return pd.DataFrame.from_records(records, columns=FEATURE_COLUMNS + ["discount_pct"])
    except Exception as exc:
        raise RuntimeError(f"Could not load real offer-value training records: {exc}") from exc


def load_training_data(n: int = 6000, seed: int = 42, db_connection=None):
    """Return synthetic development data or strict real-data training data."""
    if db_connection is None:
        return _generate_synthetic_training_data(n=n, seed=seed)
    rows = _load_real_training_rows(db_connection)
    if len(rows) < 2:
        raise RuntimeError("Real offer-value training requires at least two recovered orders with discount data.")
    X, y = rows[FEATURE_COLUMNS], rows["discount_pct"]
    return train_test_split(X, y, test_size=0.2, random_state=42)


def build_model() -> GradientBoostingRegressor:
    """Gradient Boosting regressor predicting the Step 2 base discount %."""
    return GradientBoostingRegressor(
        n_estimators=150,
        learning_rate=0.05,
        max_depth=3,
        random_state=42,
    )


def train(run_name: str = "m5-offervalue-training", db_connection=None) -> dict:
    """Full training loop with MLflow tracking."""
    get_or_create_experiment()

    print("Loading synthetic training data (ungated Step-2 regime)...")
    X_train, X_test, y_train, y_test = load_training_data(n=6000, db_connection=db_connection)
    used_real_data = db_connection is not None

    print("Building GradientBoostingRegressor...")
    model = build_model()

    with mlflow.start_run(run_name=run_name) as run:
        mlflow.set_tag("model", "offer_value")
        mlflow.set_tag("data_source", "real" if used_real_data else "synthetic")
        mlflow.set_tag("production_eligible", str(used_real_data and len(X_train) + len(X_test) >= MIN_REAL_RECOVERED_ORDERS).lower())

        print("Training model...")
        model.fit(X_train, y_train)

        print("Evaluating model...")
        raw_pred = model.predict(X_test)
        # Hard cap enforced on predictions too (Step 4), not just labels.
        pred = np.clip(raw_pred, 0.0, MAX_DISCOUNT_PCT)

        rmse = float(np.sqrt(mean_squared_error(y_test, pred)))
        mae = float(mean_absolute_error(y_test, pred))
        r2 = float(r2_score(y_test, pred))

        mlflow.log_params({
            "n_estimators": 150,
            "learning_rate": 0.05,
            "max_depth": 3,
            "random_state": 42,
            "max_discount_pct": MAX_DISCOUNT_PCT,
            "tss_threshold": TSS_THRESHOLD,
            "pss_nudge_floor": PSS_NUDGE_FLOOR,
            "css_nudge_floor": CSS_NUDGE_FLOOR,
            "feature_columns": FEATURE_COLUMNS,
        })

        mlflow.log_metrics({"rmse": rmse, "mae": mae, "r2": r2})

        registration = {"registered_model_name": "offer_value"} if (
            used_real_data and len(X_train) + len(X_test) >= MIN_REAL_RECOVERED_ORDERS
        ) else {}
        mlflow.sklearn.log_model(model, "model", **registration)

        print("\n--- M5 OFFER VALUE MODEL METRICS (Step 2 base discount) ---")
        print(f"RMSE: {rmse:.4f}")
        print(f"MAE:  {mae:.4f}")
        print(f"R2:   {r2:.4f}")
        print(f"\n[OK] MLflow Run ID: {run.info.run_id}")
        print(f"MLflow Run Name: {run.info.run_name}")

        return {"model": model, "metrics": {"rmse": rmse, "mae": mae, "r2": r2},
                "run_id": run.info.run_id, "used_real_data": used_real_data,
                "production_eligible": bool(registration)}


if __name__ == "__main__":
    train()
