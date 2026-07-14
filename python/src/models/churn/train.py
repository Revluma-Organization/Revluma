"""
M4 — Churn Risk Scorer: Training Script
=========================================
Model type  : Gradient Boosting (multi-class)
Purpose     : Scores every customer's churn tier so recovery sequences can
              be triggered for AT_RISK / HIGH_RISK / CRITICAL customers.

Design decisions applied (see chat review for full reasoning):
  - Target is churn_tier (4-class: HEALTHY, AT_RISK, HIGH_RISK, CRITICAL),
    per the Phase 2 task doc — NOT the older binary/continuous design
    implied by this file's original docstring. The 4-class boundaries
    mirror the fallback logic already in the /predict/churn-risk endpoint
    (<=30d / 31-60d / 61-90d / >90d) so the model and the fallback agree.

FLAGGED (not fixed): the task doc asks for 24 signals across 4 dimensions
(purchase history, engagement drift, sentiment, competitive exposure).
Only the "purchase history" dimension exists in pipeline.py today. The
other 17 signals (email open rate deltas, SMS click rate, return rate,
unsubscribe risk, etc.) have no backing function or DB column yet — this
is a blocker for whoever owns CRM/engagement data, not something fixable
in code. Built here on the 7 real features only.

Features consumed (7, all real pipeline.py functions):
    past_orders_total          (int)    — calculate_past_orders_total
    days_since_last_purchase   (int)    — calculate_days_since_last_purchase
    avg_order_value            (float)  — calculate_avg_order_value
    purchase_frequency_trend   (int)    — calculate_purchase_frequency_trend, {-1,0,1}
    rfm_recency_score          (int 1-5)— calculate_rfm_scores
    rfm_frequency_score        (int 1-5)— calculate_rfm_scores
    rfm_monetary_score         (int 1-5)— calculate_rfm_scores

Output:
    churn_tier — one of HEALTHY / AT_RISK / HIGH_RISK / CRITICAL

Runs: Daily cron job scoring all customer profiles.
"""

import mlflow
import sys, os
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import precision_recall_fscore_support, roc_auc_score
from sklearn.preprocessing import label_binarize

sys.path.append(os.path.join(os.path.dirname(__file__), "../../.."))
from src.config.mlflow_config import get_or_create_experiment

TIERS = ["HEALTHY", "AT_RISK", "HIGH_RISK", "CRITICAL"]
TIER_TO_IDX = {t: i for i, t in enumerate(TIERS)}


def _rfm_scores(days, orders, aov):
    """Mirrors calculate_rfm_scores() bucket logic in pipeline.py exactly,
    so synthetic RFM sub-scores stay internally consistent with the raw
    features rather than being independently random."""
    if days == -1 or days > 365:
        r = 1
    elif days < 30:
        r = 5
    elif days <= 90:
        r = 4
    elif days <= 180:
        r = 3
    else:
        r = 2

    if orders > 10:
        f = 5
    elif orders >= 6:
        f = 4
    elif orders >= 3:
        f = 3
    elif orders >= 1:
        f = 2
    else:
        f = 1

    if aov > 200:
        m = 5
    elif aov >= 100:
        m = 4
    elif aov >= 50:
        m = 3
    elif aov >= 10:
        m = 2
    else:
        m = 1

    return r, f, m


def load_training_data(n=4000):
    """
    Generates synthetic customer records with the 7 real churn-relevant
    features and a 4-class churn_tier label.

    Label logic: days_since_last_purchase is the primary driver (mirrors
    the endpoint's fallback tier boundaries), amplified by
    purchase_frequency_trend and low RFM frequency/monetary scores, plus
    noise so the model can't just re-derive a lookup table on days alone.

    Returns:
        tuple: (X_train, X_test, y_train, y_test)
               y: integer-encoded churn_tier (0=HEALTHY .. 3=CRITICAL)
    """
    np.random.seed(42)

    days_since_last_purchase = np.random.randint(0, 400, n)
    past_orders_total = np.random.randint(1, 50, n)
    avg_order_value = np.random.uniform(10.0, 500.0, n)
    purchase_frequency_trend = np.random.choice([-1, 0, 1], size=n)

    r_scores, f_scores, m_scores = [], [], []
    for d, o, a in zip(days_since_last_purchase, past_orders_total, avg_order_value):
        r, f, m = _rfm_scores(int(d), int(o), float(a))
        r_scores.append(r)
        f_scores.append(f)
        m_scores.append(m)
    r_scores = np.array(r_scores)
    f_scores = np.array(f_scores)
    m_scores = np.array(m_scores)

    # Base risk from recency, matching the endpoint fallback boundaries
    risk = np.select(
        [days_since_last_purchase <= 30,
         days_since_last_purchase <= 60,
         days_since_last_purchase <= 90],
        [10.0, 40.0, 70.0],
        default=95.0
    )

    # Amplifiers: declining trend + weak frequency/monetary raise risk
    risk += np.where(purchase_frequency_trend == -1, 15.0, 0.0)
    risk -= np.where(purchase_frequency_trend == 1, 10.0, 0.0)
    risk += (5 - f_scores) * 3.0
    risk += (5 - m_scores) * 2.0

    # Noise so labels aren't a pure lookup on one feature
    risk += np.random.normal(0, 8, n)

    # Bucket by quartile on the UNCLIPPED score. With days_since_last_purchase
    # drawn uniformly over 0-400 plus the amplifiers above, ~30% of records
    # exceeded 100 before clipping — clipping first collapsed the upper
    # quartile boundaries to a single tied value (100), which zeroed out the
    # CRITICAL class entirely in testing. Bucketing before clipping avoids
    # the tie and keeps all 4 tiers meaningfully represented.
    q25, q50, q75 = np.quantile(risk, [0.25, 0.50, 0.75])
    y = np.select(
        [risk <= q25, risk <= q50, risk <= q75],
        [0, 1, 2],
        default=3
    )
    risk = np.clip(risk, 0, 100)  # kept for any future logging/inspection use

    X = pd.DataFrame({
        'past_orders_total': past_orders_total,
        'days_since_last_purchase': days_since_last_purchase,
        'avg_order_value': avg_order_value,
        'purchase_frequency_trend': purchase_frequency_trend,
        'rfm_recency_score': r_scores,
        'rfm_frequency_score': f_scores,
        'rfm_monetary_score': m_scores,
    })

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )
    return X_train, X_test, y_train, y_test


def build_model():
    """Gradient Boosting multi-class classifier for churn_tier."""
    return GradientBoostingClassifier(
        n_estimators=150,
        learning_rate=0.05,
        max_depth=3,
        random_state=42
    )


def train(run_name: str = "m4-churn-training"):
    """Full training loop with MLflow tracking."""
    get_or_create_experiment()

    print("Loading synthetic training data (N=4000)...")
    X_train, X_test, y_train, y_test = load_training_data(n=4000)

    print("Building GradientBoostingClassifier (4-class churn_tier)...")
    model = build_model()

    with mlflow.start_run(run_name=run_name) as run:
        mlflow.set_tag("model", "churn")

        print("Training model...")
        model.fit(X_train, y_train)

        print("Evaluating model...")
        y_pred = model.predict(X_test)
        y_proba = model.predict_proba(X_test)

        precision, recall, f1, support = precision_recall_fscore_support(
            y_test, y_pred, labels=[0, 1, 2, 3], zero_division=0
        )

        y_test_bin = label_binarize(y_test, classes=[0, 1, 2, 3])
        auc = roc_auc_score(y_test_bin, y_proba, multi_class='ovr')

        params = {
            "n_estimators": 150,
            "learning_rate": 0.05,
            "max_depth": 3,
            "random_state": 42,
            "n_classes": 4,
        }
        mlflow.log_params(params)

        metrics = {"auc_roc_ovr": auc}
        for i, tier in enumerate(TIERS):
            metrics[f"precision_{tier.lower()}"] = precision[i]
            metrics[f"recall_{tier.lower()}"] = recall[i]
            metrics[f"f1_{tier.lower()}"] = f1[i]
        mlflow.log_metrics(metrics)

        #--
        #newly added
        #--
        # registered_model_name added: api.py calls
        # mlflow.sklearn.load_model("models:/churn_risk/latest") — without
        # registering under this exact name, the model never loads and the
        # /predict/churn-risk endpoint silently falls back forever.
        mlflow.sklearn.log_model(model, "m4_churn_model", registered_model_name="churn_risk")
        #--
        #end new
        #--

        print(f"\n--- M4 CHURN MODEL METRICS ---")
        for i, tier in enumerate(TIERS):
            print(f"{tier:10s}  P={precision[i]:.3f}  R={recall[i]:.3f}  F1={f1[i]:.3f}  n={support[i]}")
        print(f"AUC-ROC (OvR): {auc:.4f}")

        print(f"\n✅ MLflow Run ID: {run.info.run_id}")
        print(f"MLflow Run Name: {run.info.run_name}")
        print(f"Check DagsHub UI for the full tracking details.")


if __name__ == "__main__":
    train()