"""
M4 — Churn Risk Scorer: Inference Script
Runs daily as a cron job across all customer profiles.
"""


def load_model(merchant_id: str):
    """Loads trained M4 model for the given merchant."""
    pass


def predict(customer_id: str, feature_vector: dict, merchant_id: str) -> dict:
    """
    Scores a single customer's churn probability.

    Args:
        customer_id    (str) : UUID of the customer
        feature_vector (dict): The 4 M4 features + RFM sub-scores
        merchant_id    (str) : UUID of the merchant

    Returns:
        dict: {
            "churn_score"         : float,  # 0–100, stored in customer_crm
            "risk_level"          : str,    # 'low' | 'medium' | 'high'
            "trigger_winback"     : bool,   # True if churn_score > 61
            "customer_segment"    : str,    # 'champion'|'loyal'|'at_risk'
                                            # |'hibernating'|'lost'
            "model_version"       : str
        }
    """
    pass
