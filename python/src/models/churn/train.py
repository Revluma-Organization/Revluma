"""
M4 - Churn Risk Scorer: Training Script
=========================================
Model type  : Gradient Boosting
Purpose     : Continuously scores every customer's churn probability.
              When score crosses 61 (High Risk), automatically triggers
              a 3-touch win-back sequence via the Recovery Queue.

Features consumed (7):
    past_orders_total          (int)    - Frequency (F)
    days_since_last_purchase   (int)    - Recency (R), -1 sentinel = no history
    avg_order_value            (float)  - Monetary (M)
    purchase_frequency_trend   (int)    - -1 decreasing / 0 stable / +1 increasing
    rfm_recency_score          (int)  - from customer_crm
    rfm_frequency_score        (int)  - from customer_crm
    rfm_monetary_score         (int)  - from customer_crm

Output:
    churn_tier (str) - HEALTHY, AT_RISK, HIGH_RISK, CRITICAL
    Intervention threshold: HIGH_RISK or CRITICAL

Runs: Daily cron job scoring all customer profiles.

#--
#Phase 3 — P3.1 real data integration
#--
load_training_data() now accepts db_connection. When provided, it queries
every customer with 90+ days of order history (per Phase 3 spec: "M4
needs 500 customers with 90+ days of history") and computes the 7 real
features with the exact pipeline.py functions (calculate_rfm_scores,
calculate_purchase_frequency_trend, etc.) instead of drawing them from
independent random distributions. The churn_tier label is derived from
days_since_last_purchase using the same quartile-style bucketing rule
documented in the README (avoids the 75%-CRITICAL collapse that fixed
cutoffs produced), so the real-data path stays consistent with the
existing model contract. Falls back to synthetic data below the
500-customer minimum or on any query failure.
#--
#end new
#--
"""

import os
import sys

import mlflow
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import classification_report, roc_auc_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../../..")))
from src.config.mlflow_config import get_or_create_experiment
from src.features.pipeline import (
    calculate_past_orders_total,
    calculate_days_since_last_purchase,
    calculate_avg_order_value,
    calculate_purchase_frequency_trend,
    calculate_rfm_scores,
)

# M4 real-data minimum per Phase 3 spec (P3.1): "M4 needs 500 customers
# with 90+ days of history."
MIN_REAL_CUSTOMERS = 500
MIN_HISTORY_DAYS = 90

FEATURE_COLUMNS = [
    "past_orders_total", "days_since_last_purchase", "avg_order_value",
    "purchase_frequency_trend", "rfm_recency_score", "rfm_frequency_score",
    "rfm_monetary_score",
]


def _generate_synthetic_data(n=4000):
    """
    Generates synthetic historical customer records with known churn outcomes.
    Returns:
        tuple: (X_train, X_test, y_train, y_test)
    """
    np.random.seed(42)

    past_orders_total = np.random.randint(0, 50, n)
    days_since_last_purchase = np.random.randint(-1, 365, n)
    avg_order_value = np.random.uniform(10.0, 1000.0, n)
    purchase_frequency_trend = np.random.choice([-1, 0, 1], n)

    rfm_recency_score = np.random.randint(1, 6, n)
    rfm_frequency_score = np.random.randint(1, 6, n)
    rfm_monetary_score = np.random.randint(1, 6, n)

    # Calculate churn probability logic
    # High recency (days_since_last_purchase > 90) + decreasing trend = higher churn risk
    risk_score = np.zeros(n)
    for i in range(n):
        if days_since_last_purchase[i] == -1:
            risk_score[i] = 0.5  # Ambiguous
        else:
            risk_score[i] += min(days_since_last_purchase[i] / 180.0, 1.0)
            if purchase_frequency_trend[i] == -1:
                risk_score[i] += 0.3
            elif purchase_frequency_trend[i] == 1:
                risk_score[i] -= 0.3

            if rfm_recency_score[i] <= 2:
                risk_score[i] += 0.2
            if rfm_frequency_score[i] >= 4:
                risk_score[i] -= 0.2

    # Normalize risk score to 0.0 - 1.0
    risk_score = np.clip(risk_score, 0.0, 1.0)

    # Map to classes
    y = []
    for score in risk_score:
        if score <= 0.30:
            y.append("HEALTHY")
        elif score <= 0.60:
            y.append("AT_RISK")
        elif score <= 0.80:
            y.append("HIGH_RISK")
        else:
            y.append("CRITICAL")

    X = pd.DataFrame(
        {
            "past_orders_total": past_orders_total,
            "days_since_last_purchase": days_since_last_purchase,
            "avg_order_value": avg_order_value,
            "purchase_frequency_trend": purchase_frequency_trend,
            "rfm_recency_score": rfm_recency_score,
            "rfm_frequency_score": rfm_frequency_score,
            "rfm_monetary_score": rfm_monetary_score,
        }
    )

    return train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)


def _risk_score_to_tier(risk_score: float) -> str:
    """Same quartile-style boundaries used by the synthetic generator, kept
    identical for the real-data path so churn_tier semantics don't drift
    between synthetic and real training runs."""
    if risk_score <= 0.30:
        return "HEALTHY"
    elif risk_score <= 0.60:
        return "AT_RISK"
    elif risk_score <= 0.80:
        return "HIGH_RISK"
    return "CRITICAL"


def _load_real_customer_rows(db_connection):
    """
    Queries every customer with at least MIN_HISTORY_DAYS of order history
    and computes the 7 real M4 features using the exact pipeline.py
    functions, per the "no aliases, no deviations" rule in
    PIXEL_EVENT_SPEC.md.

    Label derivation: since a real, confirmed churn outcome (did the
    customer actually fail to reorder within the merchant's window) needs
    a completed future observation window that most customers won't have
    yet this early in Phase 3, the interim label uses the same
    risk-score-from-signals rule as the synthetic generator, but computed
    from each customer's *real* days_since_last_purchase,
    purchase_frequency_trend, and RFM scores rather than random values.
    This is documented in CHURN_MODEL_RESEARCH.md Section 3.3 as the
    approach to use until enough completed prediction windows exist for
    a true time-to-event label.

    STRICT POLICY: when db_connection is provided, this is the only data
    source used for M4 training — no silent fallback to synthetic data.
    Query failures propagate (wrapped with context) instead of being
    swallowed.

    Returns:
        pd.DataFrame with FEATURE_COLUMNS + "churn_tier". Returns an
        empty DataFrame (not None) if the query succeeds but finds zero
        qualifying customers.

    Raises:
        RuntimeError: if the underlying query fails for any reason.
    """
    try:
        with db_connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT DISTINCT c.id
                FROM customers c
                JOIN orders o ON o.customer_id = c.id
                WHERE o.ordered_at <= NOW() - INTERVAL '%s days'
                """,
                (MIN_HISTORY_DAYS,)
            )
            rows = cursor.fetchall()

        customer_ids = [r[0] for r in rows]
        if not customer_ids:
            return pd.DataFrame(columns=FEATURE_COLUMNS + ["churn_tier"])

        records = []
        for customer_id in customer_ids:
            rfm = calculate_rfm_scores(customer_id, db_connection)
            trend = calculate_purchase_frequency_trend(customer_id, db_connection)

            days = rfm["days_since_last_purchase"]
            orders = rfm["past_orders_total"]
            aov = rfm["avg_order_value"]

            if days == -1:
                risk_score = 0.5
            else:
                risk_score = min(days / 180.0, 1.0)
                if trend == -1:
                    risk_score += 0.3
                elif trend == 1:
                    risk_score -= 0.3
                if rfm["rfm_recency_score"] <= 2:
                    risk_score += 0.2
                if rfm["rfm_frequency_score"] >= 4:
                    risk_score -= 0.2
            risk_score = float(np.clip(risk_score, 0.0, 1.0))

            records.append({
                "past_orders_total": orders,
                "days_since_last_purchase": days,
                "avg_order_value": aov,
                "purchase_frequency_trend": trend,
                "rfm_recency_score": rfm["rfm_recency_score"],
                "rfm_frequency_score": rfm["rfm_frequency_score"],
                "rfm_monetary_score": rfm["rfm_monetary_score"],
                "churn_tier": _risk_score_to_tier(risk_score),
            })

        return pd.DataFrame.from_records(records)

    except Exception as e:
        raise RuntimeError(
            f"[M4] Real-data query against customers/orders failed: {e}"
        ) from e


def load_training_data(n=4000, db_connection=None):
    """
    Phase 3 entry point (per task doc P3.1 — the function whose
    db_connection parameter "was reserved for this exact purpose").

    STRICT POLICY: db_connection is None -> synthetic data (dev/local path
    only). db_connection provided -> real customer records ALWAYS used, no
    silent fallback. Zero qualifying customers or a query failure raises
    immediately. Real rows below MIN_REAL_CUSTOMERS still train, with a
    loud warning and a below-threshold MLflow tag.

    Returns:
        (X_train, X_test, y_train, y_test, used_real_data: bool, below_minimum: bool)

    Raises:
        RuntimeError: if db_connection is provided and the query fails,
            or succeeds but finds zero customers with the required
            purchase history.
    """
    if db_connection is None:
        print("[M4] No db_connection provided — using synthetic data.")
        X_train, X_test, y_train, y_test = _generate_synthetic_data(n=n)
        return X_train, X_test, y_train, y_test, False, False

    real_df = _load_real_customer_rows(db_connection)

    if len(real_df) == 0:
        raise RuntimeError(
            f"[M4] db_connection was provided but zero customers with "
            f"{MIN_HISTORY_DAYS}+ days of order history were found. Cannot "
            f"train on real data — check that `customers`/`orders` are "
            f"populated (see rfm_sync.py's known gap re: these tables)."
        )

    below_minimum = len(real_df) < MIN_REAL_CUSTOMERS
    if below_minimum:
        print(
            f"[M4] WARNING: training on {len(real_df)} real customer "
            f"records, below the recommended minimum of {MIN_REAL_CUSTOMERS}. "
            f"Proceeding per strict real-data policy — treat churn_tier "
            f"metrics as provisional, not production-reliable."
        )
    else:
        print(f"[M4] Training on {len(real_df)} real customer records.")

    X = real_df[FEATURE_COLUMNS]
    y = real_df["churn_tier"]
    try:
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42, stratify=y
        )
    except ValueError:
        # Stratification requires >=2 members per class; a very small real
        # dataset (explicitly allowed under the strict policy) can violate
        # that. Fall back to a non-stratified split rather than crashing —
        # this does not touch synthetic data, it only changes the split
        # strategy for a genuinely tiny real dataset.
        print(
            "[M4] WARNING: stratified split not possible (a churn_tier "
            "class has fewer than 2 real examples) — using a plain random "
            "split instead."
        )
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42
        )
    return X_train, X_test, y_train, y_test, True, below_minimum


def build_model():
    """
    Gradient Boosting classifier with StandardScaler pipeline.
    """
    return Pipeline(
        [
            ("scaler", StandardScaler()),
            (
                "classifier",
                GradientBoostingClassifier(
                    n_estimators=100, max_depth=3, random_state=42
                ),
            ),
        ]
    )


def train(run_name: str = "m4-churn-training", db_connection=None):
    """Full training loop with MLflow tracking."""
    get_or_create_experiment()

    print("Loading training data (real if db_connection given, else synthetic N=4000)...")
    X_train, X_test, y_train, y_test, used_real_data, below_minimum = load_training_data(
        n=4000, db_connection=db_connection
    )

    print("Building M4 GradientBoostingClassifier...")
    model = build_model()

    with mlflow.start_run(run_name=run_name) as run:
        mlflow.set_tag("model", "churn_risk")
        mlflow.set_tag("data_source", "real" if used_real_data else "synthetic")
        mlflow.set_tag("below_minimum_threshold", str(below_minimum))

        print("Training M4 model...")
        model.fit(X_train, y_train)

        print("Evaluating model...")
        y_pred = model.predict(X_test)
        y_prob = model.predict_proba(X_test)

        report = classification_report(y_test, y_pred, output_dict=True)
        # roc_auc_score for multi-class requires OvR and probability
        auc_roc = roc_auc_score(y_test, y_prob, multi_class="ovr")

        mlflow.log_params({
            "n_estimators": 100, "max_depth": 3, "random_state": 42,
            "n_training_samples": len(X_train),
            "min_real_customers_threshold": MIN_REAL_CUSTOMERS,
        })

        # Log overall metrics
        mlflow.log_metrics(
            {
                "accuracy": report["accuracy"],
                "macro_avg_f1": report["macro avg"]["f1-score"],
                "auc_roc": auc_roc,
            }
        )

        mlflow.sklearn.log_model(model, "m4_churn_risk_model", registered_model_name="churn_risk")

        print(f"\n--- M4 CHURN RISK MODEL METRICS ---")
        print(f"Data source: {'real' if used_real_data else 'synthetic'}")
        print(f"Accuracy: {report['accuracy']:.4f}")
        print(f"Macro F1: {report['macro avg']['f1-score']:.4f}")
        print(f"AUC-ROC:  {auc_roc:.4f}")

        print(f"\n[OK] MLflow Run ID: {run.info.run_id}")
        print(f"MLflow Run Name: {run.info.run_name}")

        return {"model": model, "used_real_data": used_real_data,
                "below_minimum_threshold": below_minimum,
                "metrics": {"accuracy": report["accuracy"],
                            "macro_avg_f1": report["macro avg"]["f1-score"],
                            "auc_roc": auc_roc}}


if __name__ == "__main__":
    train()