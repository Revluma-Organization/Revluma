"""
M2 — Price vs. Convenience Sensitivity Classifier: Training Script
===================================================================
Model type  : Gradient Boosting
Purpose     : Classifies each shopper as price-sensitive, convenience-
              sensitive, or neutral. Outputs PSS (0–100) and CSS (0–100)
              scores that determine the recovery offer strategy.

Features consumed (7 behavioural + transactional signals):
    scroll_depth_checkout_pct            (float)  — medium CSS signal
    tab_switch_count_session             (int)    — low PSS signal
    checkout_step_abandoned              (int)    — high CSS signal
    cursor_hesitation_ms_on_price_field  (int)    — HIGH PSS signal
    past_orders_with_coupon_pct          (float)  — HIGH PSS signal
    visited_coupon_page                  (bool)   — medium PSS signal
    searched_discount_terms              (bool)   — medium PSS signal
    abandoned_at_shipping_reveal         (bool)   — VERY HIGH CSS signal

Output:
    pss_score (int 0–100) — stored in abandoned_carts.pss_score
    css_score (int 0–100) — stored in abandoned_carts.css_score

PSS/CSS Decision Matrix:
    PSS≥60, CSS<40  → Price-Sensitive    → Discount offer
    PSS<40, CSS≥60  → Convenience-Sens.  → Free shipping / friction fix
    PSS≥60, CSS≥60  → Dual-Sensitive     → Discount + free shipping
    PSS<40, CSS<40  → Neutral            → Soft nudge only
    PSS 40-59       → Ambiguous          → Soft nudge / hold

Note: AI/ML Engineer 3 owns the PSS/CSS weighting logic.

"""

import mlflow
import sys, os
sys.path.append(os.path.join(os.path.dirname(__file__), "../../.."))
from src.config.mlflow_config import get_or_create_experiment


def load_training_data():
    """
    Loads labelled sessions with known PSS/CSS outcomes.
    Ground truth derived from post-recovery conversion data —
    which offer type (discount vs friction-fix) actually converted the shopper.

    Returns:
        tuple: (X_train, X_test, y_train, y_test)
               y: multi-label — (pss_score, css_score) per session
    """
    pass


def build_model():
    """
    Gradient Boosting classifier with MinMaxScaler preprocessing.
    Two outputs: PSS score and CSS score (two separate regressors or
    multi-output wrapper — to be decided in Week 4).

    Returns:
        model pipeline
    """
    pass


def train(run_name: str = "m2-sensitivity-training"):
    """
    Full training loop with MLflow tracking.
    Logs: hyperparams, PSS/CSS RMSE, feature importances, confusion matrix.
    """
    get_or_create_experiment()
    with mlflow.start_run(run_name=run_name):
        pass


if __name__ == "__main__":
    train()
