"""
M5 — Offer Value Optimizer: Training Script
============================================
Model type  : Gradient Boosting
Purpose     : Given that M2 has classified a shopper as price-sensitive,
              determines the MINIMUM discount percentage needed to convert
              them. Goal: recover the sale while protecting merchant margins.

Dependency: M2 must run before M5. M5 requires pss_score and css_score
            as inputs (stored in abandoned_carts after M2 runs).

Features consumed (9):
    pss_score                            (float) — output of M2
    css_score                            (float) — output of M2
    cursor_hesitation  (int)   — HIGH price signal
    past_orders_total                    (int)   — loyalty context
    past_orders_with_coupon_pct          (float) — coupon history
    days_since_last_purchase             (int)   — recency
    avg_order_value                      (float) — order value context
    visited_coupon_page                  (bool)  — price signal
    searched_discount_terms              (bool)  — price signal

Constraints (from merchant store_config):
    max_discount_pct   — hard cap on offer (default 20%)
    min_margin_pct     — floor to protect margins (optional, P2)

Output:
    recommended_discount_pct (int 0–max_discount_pct)
"""

import mlflow
import sys, os
sys.path.append(os.path.join(os.path.dirname(__file__), "../../.."))
from src.config.mlflow_config import get_or_create_experiment


def load_training_data():
    """
    Loads historical recovery offers with known conversion outcomes.
    Ground truth: which discount % actually converted each shopper.

    Data from: abandoned_carts (pss/css scores, offer sent) +
               recovery_events (conversion outcome) + Order table (confirmed order).

    Returns:
        tuple: (X_train, X_test, y_train, y_test)
               y: minimum discount % that led to conversion
    """
    pass


def build_model():
    """
    Gradient Boosting regressor predicting minimum effective discount %.
    Output is clipped to [0, max_discount_pct] from store_config.

    Returns:
        model pipeline
    """
    pass


def train(run_name: str = "m5-offervalue-training"):
    """Full training loop with MLflow tracking."""
    get_or_create_experiment()
    with mlflow.start_run(run_name=run_name):
        pass


if __name__ == "__main__":
    train()
