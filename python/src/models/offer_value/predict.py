"""
M5 — Offer Value Optimizer: Inference Script
Runs after M2 classifies a shopper as price-sensitive.
"""


def load_model(merchant_id: str):
    """Loads trained M5 model for the given merchant."""
    pass


def load_merchant_constraints(merchant_id: str, db) -> dict:
    """
    Loads discount constraints from store_config for this merchant.

    Returns:
        dict: {
            "max_discount_pct": int,   # hard cap, default 20
            "min_margin_pct"  : int    # optional floor, None if not set
        }
    """
    pass


def predict(feature_vector: dict, merchant_id: str, db) -> dict:
    """
    Recommends the minimum discount % needed to convert this shopper.

    Args:
        feature_vector (dict): The 9 M5 features including pss_score + css_score
        merchant_id    (str) : UUID of the merchant
        db             : Database session for loading merchant constraints

    Returns:
        dict: {
            "recommended_discount_pct" : int,    # 0–max_discount_pct
            "capped_by_merchant_limit" : bool,   # True if model output was clipped
            "model_version"            : str
        }
    """
    pass
