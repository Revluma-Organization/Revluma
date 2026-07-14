"""
M5 — Offer Value Optimizer: Training Script
============================================
Model type  : Gradient Boosting (regression)
Purpose     : Given that M2 has classified a shopper as price-sensitive,
              determines the MINIMUM discount percentage needed to convert
              them, without exceeding merchant margin protection limits.

#--
#newly added
#--
CORRECTION (previous version of this file had a wrong assumption):
Auditing api.py against the task doc confirmed M2 outputs THREE scores —
"PSS + CSS + TSS" — not two. TSS (Trust Sensitivity Score) is a distinct
signal from CSS. My earlier version assumed TSS == css_score; that was
wrong and is now fixed. TSS has NO backing function anywhere in
pipeline.py or in M2's README — this is a confirmed blocker for whoever
owns M2 (Engineer 3), not something fixable here. tss_score is added as
an accepted input with a safe default (0 = "not trust-sensitive", so the
gate doesn't spuriously fire) until real TSS data exists.

Hard gates corrected to match the doc's exact two separate rules
(previously collapsed into one incorrect OR condition):
  1. tss_score >= 60          -> offer_type TRUST_SIGNAL, discount = 0
  2. pss_score < 35 AND
     css_score < 35           -> offer_type NUDGE,        discount = 0
  else                        -> regression output, clipped 0-25
#--
#end new
#--

Features consumed (10 — 9 original + tss_score):
    pss_score                            (float) — output of M2
    css_score                            (float) — output of M2
    tss_score                            (float) — output of M2 [NOT YET REAL DATA]
    cursor_hesitation                    (int)   — HIGH price signal
    past_orders_total                    (int)   — loyalty context
    past_orders_with_coupon_pct          (float) — coupon history
    days_since_last_purchase             (int)   — recency
    avg_order_value                      (float) — order value context
    visited_coupon_page                  (bool)  — price signal
    searched_discount_terms              (bool)  — price signal

Hard constraints (enforced in both label generation AND at prediction time):
    - recommended_discount_pct clipped to [0, 25]
    - TRUST_SIGNAL gate: tss_score >= 60 forces discount = 0
    - NUDGE gate: pss_score < 35 AND css_score < 35 forces discount = 0

Output:
    recommended_discount_pct (int 0-25), offer_type
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

MAX_DISCOUNT_PCT = 25
TSS_THRESHOLD = 60
PSS_NUDGE_FLOOR = 35
CSS_NUDGE_FLOOR = 35


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


def load_training_data(n=3000):
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
    #--
    #newly added
    #--
    # tss_score: synthetic placeholder. No real backing data exists yet —
    # see module docstring. Distribution skewed low since most sessions
    # aren't trust-blocked, with a meaningful tail so the TRUST_SIGNAL
    # gate actually gets exercised in training/testing.
    tss_score = np.random.beta(2, 5, n) * 100
    #--
    #end new
    #--
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


def build_model():
    """Gradient Boosting regressor predicting minimum effective discount %."""
    return GradientBoostingRegressor(
        n_estimators=150,
        learning_rate=0.05,
        max_depth=3,
        random_state=42
    )


def train(run_name: str = "m5-offervalue-training"):
    """Full training loop with MLflow tracking."""
    get_or_create_experiment()

    print("Loading synthetic training data (N=3000)...")
    X_train, X_test, y_train, y_test = load_training_data(n=3000)

    print("Building GradientBoostingRegressor...")
    model = build_model()

    with mlflow.start_run(run_name=run_name) as run:
        mlflow.set_tag("model", "offer_value")

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

        # np.sqrt(mse) used instead of mean_squared_error(squared=False) —
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
        })

        mlflow.log_metrics({
            "rmse": rmse,
            "mae": mae,
            "r2": r2,
        })

        #--
        #newly added
        #--
        # registered_model_name added: api.py calls
        # mlflow.sklearn.load_model("models:/offer_value/latest") — without
        # this, the model never registers and /predict/offer-value always
        # falls back.
        mlflow.sklearn.log_model(model, "m5_offer_value_model", registered_model_name="offer_value")
        #--
        #end new
        #--

        print(f"\n--- M5 OFFER VALUE MODEL METRICS ---")
        print(f"RMSE: {rmse:.4f}")
        print(f"MAE:  {mae:.4f}")
        print(f"R2:   {r2:.4f}")

        print(f"\n✅ MLflow Run ID: {run.info.run_id}")
        print(f"MLflow Run Name: {run.info.run_name}")
        print(f"Check DagsHub UI for the full tracking details.")


if __name__ == "__main__":
    train()