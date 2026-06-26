"""
M1 — Abandonment Probability Predictor: Inference Script
=========================================================
Runs every 60 seconds on all active checkout sessions.
When score exceeds abandonment threshold, triggers exit-intent
intervention via the Recovery Queue → Channel Dispatcher.
"""


def load_model(merchant_id: str):
    """
    Loads the trained M1 model for a specific merchant from MLflow
    model registry or local artifact store.

    Args:
        merchant_id (str): UUID of the merchant (models are per-merchant)

    Returns:
        Trained sklearn pipeline (scaler + logistic regression)
    """
    pass


def predict(feature_vector: dict, merchant_id: str) -> dict:
    """
    Scores a single live session for abandonment probability.

    Args:
        feature_vector (dict): The 5 M1 features from the feature store:
            {
                "scroll_depth_checkout_pct"  : float,
                "tab_switch_count_session"   : int,
                "time_on_checkout_step_sec"  : float,
                "checkout_step_abandoned"    : int,
                "failed_payment_attempt"     : bool
            }
        merchant_id (str): UUID of the merchant

    Returns:
        dict: {
            "abandonment_probability": float,  # 0.0–1.0
            "should_intervene"       : bool,   # True if above threshold
            "confidence"             : float,  # model confidence score
            "model_version"          : str
        }
    """
    pass
