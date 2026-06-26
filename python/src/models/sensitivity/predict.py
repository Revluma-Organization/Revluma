"""
M2 — Price vs. Convenience Sensitivity Classifier: Inference Script
"""


def load_model(merchant_id: str):
    """
    Loads trained M2 model for the given merchant.

    Returns:
        Trained gradient boosting pipeline
    """
    pass


def predict(feature_vector: dict, merchant_id: str) -> dict:
    """
    Classifies a shopper's sensitivity profile and returns PSS + CSS scores.

    Args:
        feature_vector (dict): The 8 M2 features from the feature store.
        merchant_id    (str) : UUID of the merchant.

    Returns:
        dict: {
            "pss_score"       : int,   # 0–100, stored in abandoned_carts
            "css_score"       : int,   # 0–100, stored in abandoned_carts
            "classification"  : str,   # 'price_sensitive' | 'convenience_sensitive'
                                       # | 'dual_sensitive' | 'neutral' | 'ambiguous'
            "recovery_action" : str,   # 'DISCOUNT' | 'FRICTION_FIX' | 'HYBRID'
                                       # | 'NUDGE' | 'SOFT_NUDGE'
            "model_version"   : str
        }
    """
    pass
