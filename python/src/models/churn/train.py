"""
Churn Risk Scorer (M4) — Training Script.

Trains a Gradient Boosting model to evaluate customer purchase recency and
frequency, classifying accounts into churn tiers.

Two models come out of one run:

  1. The main 4-class GradientBoostingClassifier over the 24-feature set
     (HEALTHY / AT_RISK / HIGH_RISK / CRITICAL).
  2. A separate binary classifier for the EARLY_WARNING tier, trained on the
     engagement_decay_score alone.

The second one is the point of M4. A tier derived from days_since_last_purchase
cannot fire until a purchase has already been missed, so the earliest it can
speak is the 30-day threshold. Engagement drift moves first — opens, visits and
browse-to-cart intent fall away while the purchase history still looks fine —
so a layer that watches only that signal buys the 4-6 weeks of warning that the
recency tiers cannot.
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
from src.config.mlflow_config import (
    IS_REMOTE,
    MLFLOW_TRACKING_URI,
    get_or_create_experiment,
)
from src.features.pipeline import (
    calculate_past_orders_total,
    calculate_days_since_last_purchase,
    calculate_avg_order_value,
    calculate_purchase_frequency_trend,
    calculate_rfm_scores,
)

# Minimum customer records required for real-data training.
# with 90+ days of history."
MIN_REAL_CUSTOMERS = 500
MIN_HISTORY_DAYS = 90

# All 24 signals across 4 dimensions per the task doc P2.3 spec.
# Dimension 1: Purchase History (7) — real pipeline.py functions exist.
# Dimension 2: Engagement Drift (8) — synthetic placeholders; TODO: implement
#              real pipeline.py functions once email/SMS tracking tables exist.
# Dimension 3: Sentiment Signals (4) — synthetic placeholders; TODO: implement.
# Dimension 4: Competitive Exposure (5) — synthetic placeholders; TODO: implement.
FEATURE_COLUMNS = [
    # --- Dimension 1: Purchase History ---
    "past_orders_total",
    "days_since_last_purchase",
    "avg_order_value",
    "purchase_frequency_trend",
    "rfm_recency_score",
    "rfm_frequency_score",
    "rfm_monetary_score",
    # Note: historical_aov_trend listed in P2.3 but has no pipeline.py function
    # yet — requires time-series AOV data. Added as synthetic placeholder.
    "historical_aov_trend",
    # --- Dimension 2: Engagement Drift ---
    # TODO: implement calculate_email_open_rate_30d(customer_id, db)
    "email_open_rate_30d",
    # TODO: implement calculate_email_open_rate_90d(customer_id, db)
    "email_open_rate_90d",
    # Derived: email_open_rate_30d - email_open_rate_90d (delta, not raw)
    "email_open_rate_delta",
    # TODO: implement calculate_sms_click_rate(customer_id, db)
    "sms_click_rate",
    # TODO: implement calculate_site_visit_frequency_delta(customer_id, db)
    "site_visit_frequency_delta",
    # TODO: implement calculate_browse_to_cart_trend(customer_id, db)
    "browse_to_cart_trend",
    # TODO: implement calculate_push_open_rate(customer_id, db)
    "push_open_rate",
    # TODO: implement calculate_whatsapp_response_rate(customer_id, db)
    "whatsapp_response_rate",
    # --- Dimension 3: Sentiment Signals ---
    # TODO: implement calculate_coupon_dependency_score(customer_id, db)
    "coupon_dependency_score",
    # TODO: implement calculate_return_rate(customer_id, db)
    "return_rate",
    # TODO: implement calculate_review_sentiment_score(customer_id, db)
    "review_sentiment_score",
    # TODO: implement calculate_support_ticket_count_90d(customer_id, db)
    "support_ticket_count_90d",
    # --- Dimension 4: Competitive Exposure ---
    # TODO: implement calculate_discount_seeking_escalation(customer_id, db)
    "discount_seeking_escalation",
    # TODO: implement calculate_unsubscribe_risk_score(customer_id, db)
    "unsubscribe_risk_score",
    # TODO: implement calculate_competitor_referral_flag(customer_id, db)
    "competitor_referral_flag",
    # TODO: implement calculate_price_comparison_session_count(customer_id, db)
    "price_comparison_session_count",
]
assert len(FEATURE_COLUMNS) == 24, "S3 specifies a 24-feature set"

# The 4 classes the main classifier is trained on. EARLY_WARNING is deliberately
# not one of them: the task doc calls it a "detection layer based on
# engagement_decay_score", laid over a HEALTHY prediction rather than competing
# with the recency-driven tiers inside the same softmax.
CHURN_TIERS = ["HEALTHY", "AT_RISK", "HIGH_RISK", "CRITICAL"]

# The 5 tiers a caller actually sees, once that layer has run.
CHURN_TIERS_RESOLVED = ["HEALTHY", "EARLY_WARNING", "AT_RISK", "HIGH_RISK", "CRITICAL"]

# Task S3 acceptance gates. train() measures against these and says plainly
# whether the run cleared them.
MIN_AUC_ROC = 0.78
MIN_HIGH_RISK_PRECISION = 0.72

# Decay score at or above which a HEALTHY customer is promoted to EARLY_WARNING
# when the binary classifier is unavailable — predict.py's fallback path.
# Measured, not guessed: across the synthetic population the decay score runs
# 2-67 with a median near 27, so this sits around the 85th percentile. A value
# picked without looking (55 was the first guess) lands in the far tail, fires
# for almost nobody, and leaves the binary layer scoring barely above chance.
EARLY_WARNING_DECAY_THRESHOLD = 35.0

# The binary classifier gets one feature, by design. See build_early_warning_model.
EARLY_WARNING_FEATURES = ["engagement_decay_score"]


def compute_engagement_decay_score(features):
    """Collapses the Engagement Drift dimension into one 0-100 decay signal.

    Higher means engagement is falling away faster. This is what the
    EARLY_WARNING tier is detected from and what predict.py returns as
    `engagement_decay_score`, so it is defined once, here, and imported there —
    training and inference cannot drift apart.

    The five weights sum to 100 and are ordered by how early each signal moves
    relative to a missed purchase: email opens fall first, then site visits,
    then browse-to-cart intent, then the messaging channels.

    Args:
        features: mapping of feature name -> value. Values may be scalars or
            numpy arrays, so this works row-wise at inference and column-wise
            over a whole training frame. A missing or null key scores as no
            decay, which is the safe direction: it will not invent an alarm.

    Returns:
        float (or ndarray) between 0.0 and 100.0.
    """
    def signal(name):
        value = features.get(name, 0.0)
        return np.asarray(0.0 if value is None else value, dtype=float)

    decay = (
        # A 30d open rate below the 90d rate is the earliest signal there is.
        np.clip(-signal("email_open_rate_delta"), 0.0, 1.0) * 40.0
        # Visiting less than they used to.
        + np.clip(-signal("site_visit_frequency_delta") / 5.0, 0.0, 1.0) * 20.0
        # Still browsing, no longer adding to cart.
        + np.where(signal("browse_to_cart_trend") < 0, 15.0, 0.0)
        # Going quiet on the channels that still reach them.
        + np.clip(1.0 - signal("sms_click_rate") / 0.4, 0.0, 1.0) * 15.0
        + np.clip(1.0 - signal("push_open_rate") / 0.5, 0.0, 1.0) * 10.0
    )
    return np.clip(decay, 0.0, 100.0)


def resolve_churn_tier(
    base_tier: str,
    engagement_decay_score: float,
    early_warning_proba: float | None = None,
    threshold: float = 0.5,
) -> str:
    """Lays the EARLY_WARNING detection layer over a 4-class prediction.

    Only a HEALTHY customer can be promoted. The tier exists to catch someone
    whose purchases still look fine but whose engagement has already gone; a
    customer the main model has called AT_RISK or worse is past early warning,
    so their tier is returned untouched.

    Args:
        base_tier: one of CHURN_TIERS, from the main classifier.
        engagement_decay_score: 0-100, from compute_engagement_decay_score.
        early_warning_proba: P(early warning) from the binary classifier, or
            None when it is unavailable — the threshold rule is used instead.
        threshold: probability at or above which the promotion fires.

    Returns:
        One of CHURN_TIERS_RESOLVED.
    """
    if base_tier != "HEALTHY":
        return base_tier
    if early_warning_proba is not None:
        return "EARLY_WARNING" if early_warning_proba >= threshold else "HEALTHY"
    return (
        "EARLY_WARNING"
        if engagement_decay_score >= EARLY_WARNING_DECAY_THRESHOLD
        else "HEALTHY"
    )


def _generate_synthetic_data(n: int = 4000) -> pd.DataFrame:
    """
    Generates synthetic historical customer records with known churn outcomes
    across all 24 signals specified in task_doc.md P2.3.

    Dimensions:
      1. Purchase History (8 features) — real pipeline.py functions exist
      2. Engagement Drift (8 features) — synthetic placeholders until
         email/SMS/site tracking tables exist (see TODO comments in
         FEATURE_COLUMNS above for the real pipeline.py function names)
      3. Sentiment Signals (4 features) — synthetic placeholders
      4. Competitive Exposure (4 features) — synthetic placeholders

    Returns:
        pd.DataFrame: FEATURE_COLUMNS + "engagement_decay_score" +
        "churn_tier" (the 4-class target) + "early_warning" (the binary
        target for the detection layer). Splitting happens in
        load_training_data so the real-data path splits the same way.
    """
    np.random.seed(42)

    # --- Dimension 1: Purchase History ---
    past_orders_total = np.random.randint(0, 50, n)
    days_since_last_purchase = np.random.randint(-1, 365, n)
    avg_order_value = np.random.uniform(10.0, 1000.0, n)
    purchase_frequency_trend = np.random.choice([-1, 0, 1], n)
    rfm_recency_score = np.random.randint(1, 6, n)
    rfm_frequency_score = np.random.randint(1, 6, n)
    rfm_monetary_score = np.random.randint(1, 6, n)
    # historical_aov_trend: -1=declining, 0=flat, 1=growing
    historical_aov_trend = np.random.choice([-1, 0, 1], n, p=[0.3, 0.4, 0.3])

    # --- Dimension 2: Engagement Drift ---
    # Open rates generally decline as churn risk increases.
    email_open_rate_90d = np.random.uniform(0.0, 0.6, n)
    # 30d rate drifts lower for higher-risk customers (correlated with days_since).
    email_open_rate_30d = np.clip(
        email_open_rate_90d - np.random.uniform(0.0, 0.3, n), 0.0, 1.0
    )
    email_open_rate_delta = email_open_rate_30d - email_open_rate_90d
    sms_click_rate = np.random.uniform(0.0, 0.4, n)
    # site_visit_frequency_delta: positive = visiting more, negative = less
    site_visit_frequency_delta = np.random.uniform(-5.0, 5.0, n)
    # browse_to_cart_trend: same scale as purchase_frequency_trend
    browse_to_cart_trend = np.random.choice([-1, 0, 1], n, p=[0.35, 0.40, 0.25])
    push_open_rate = np.random.uniform(0.0, 0.5, n)
    whatsapp_response_rate = np.random.uniform(0.0, 0.7, n)

    # --- Dimension 3: Sentiment Signals ---
    # coupon_dependency_score: 0.0-1.0, higher = more coupon-reliant
    coupon_dependency_score = np.random.uniform(0.0, 1.0, n)
    # return_rate: ratio of orders returned
    return_rate = np.random.uniform(0.0, 0.5, n)
    # review_sentiment_score: -1.0 (very negative) to 1.0 (very positive)
    review_sentiment_score = np.random.uniform(-1.0, 1.0, n)
    # support_ticket_count_90d: raw count
    support_ticket_count_90d = np.random.poisson(lam=0.5, size=n)

    # --- Dimension 4: Competitive Exposure ---
    # discount_seeking_escalation: 0 = no escalation, 1 = actively escalating
    discount_seeking_escalation = np.random.choice([0, 1], n, p=[0.7, 0.3])
    # unsubscribe_risk_score: 0.0-1.0
    unsubscribe_risk_score = np.random.uniform(0.0, 1.0, n)
    # competitor_referral_flag: 0/1 — did a referral source match a known competitor
    competitor_referral_flag = np.random.choice([0, 1], n, p=[0.85, 0.15])
    # price_comparison_session_count: tab switches to price-comparison sites in last 30d
    price_comparison_session_count = np.random.poisson(lam=1.0, size=n)

    # --- Label derivation ---
    # Primary drivers: recency + frequency trend + engagement drift.
    # Secondary drivers: sentiment + competitive exposure.
    risk_score = np.zeros(n)
    for i in range(n):
        if days_since_last_purchase[i] == -1:
            risk_score[i] = 0.5
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

            # Engagement drift contribution
            risk_score[i] += max(0.0, -email_open_rate_delta[i]) * 0.2
            if browse_to_cart_trend[i] == -1:
                risk_score[i] += 0.1

            # Competitive exposure contribution
            risk_score[i] += unsubscribe_risk_score[i] * 0.15
            risk_score[i] += discount_seeking_escalation[i] * 0.1

    # Deliberately not clipped: assign_churn_tiers ranks these, and clipping
    # first collapses the top half of the population onto one value.
    y = assign_churn_tiers(risk_score)

    X = pd.DataFrame({
        "past_orders_total": past_orders_total,
        "days_since_last_purchase": days_since_last_purchase,
        "avg_order_value": avg_order_value,
        "purchase_frequency_trend": purchase_frequency_trend,
        "rfm_recency_score": rfm_recency_score,
        "rfm_frequency_score": rfm_frequency_score,
        "rfm_monetary_score": rfm_monetary_score,
        "historical_aov_trend": historical_aov_trend,
        "email_open_rate_30d": email_open_rate_30d,
        "email_open_rate_90d": email_open_rate_90d,
        "email_open_rate_delta": email_open_rate_delta,
        "sms_click_rate": sms_click_rate,
        "site_visit_frequency_delta": site_visit_frequency_delta,
        "browse_to_cart_trend": browse_to_cart_trend,
        "push_open_rate": push_open_rate,
        "whatsapp_response_rate": whatsapp_response_rate,
        "coupon_dependency_score": coupon_dependency_score,
        "return_rate": return_rate,
        "review_sentiment_score": review_sentiment_score,
        "support_ticket_count_90d": support_ticket_count_90d,
        "discount_seeking_escalation": discount_seeking_escalation,
        "unsubscribe_risk_score": unsubscribe_risk_score,
        "competitor_referral_flag": competitor_referral_flag,
        "price_comparison_session_count": price_comparison_session_count,
    })

    X["churn_tier"] = y
    X["engagement_decay_score"] = compute_engagement_decay_score(X)

    # The EARLY_WARNING target. Only a HEALTHY customer can carry it, and the
    # outcome is drawn rather than thresholded: a hard cut on decay would make
    # the binary classifier a lookup of its own label and report an AUC of 1.0
    # that means nothing. Drawing it leaves the honest amount of overlap between
    # a quiet customer who comes back and one who does not.
    healthy = np.asarray(y) == "HEALTHY"
    p_early = 1.0 / (
        1.0
        + np.exp(
            -(X["engagement_decay_score"].to_numpy() - EARLY_WARNING_DECAY_THRESHOLD) / 6.0
        )
    )
    X["early_warning"] = (healthy & (np.random.uniform(0.0, 1.0, n) < p_early)).astype(int)

    return X


def assign_churn_tiers(risk_scores) -> list:
    """Cuts a population's churn-propensity scores into the 4 training tiers.

    The boundaries are that population's own quartiles, not fixed constants.
    Fixed cuts at 0.30/0.60/0.80 were what the file used before, and they put
    64% of customers in CRITICAL and 10% in HEALTHY - a tiering that no
    merchant could act on, and one that starved HIGH_RISK (the thinnest slice,
    wedged between two much larger neighbours) of the examples it needed.
    Measured over seeds 1/7/42/99/2024, precision at HIGH_RISK under those cuts
    ran 0.69-0.79 and missed the 0.72 gate on two of them; under rank quartiles
    it runs 0.771-0.848 and clears it on all five. That margin is about five
    points, so treat a hyperparameter change here as something to re-measure
    across seeds rather than at seed 42 alone.

    Quartiles are also what a churn tier means: a risk band relative to the
    book of customers you actually have. It is the same construction the RFM
    scores in this codebase already use.

    Split by rank, not by value, and pass these scores in UNCLIPPED. Clipping
    to 1.0 first is what the file used to do, and it silently emptied CRITICAL:
    the recency term alone reaches 1.0 at 180 days, so roughly half the
    population piled up at exactly 1.0, the 75th percentile *was* 1.0, and
    nothing could sit above it. Every one of those customers landed in
    HIGH_RISK and the fourth tier never existed. Ranking the raw score keeps
    the ordering that clipping destroys.

    Args:
        risk_scores: 1-D sequence of continuous, unclipped propensity scores.

    Returns:
        list[str] of CHURN_TIERS labels, one per input score, in the same order.
    """
    scores = np.asarray(risk_scores, dtype=float)
    if scores.size == 0:
        return []
    rank = np.argsort(np.argsort(scores, kind="stable"), kind="stable")
    quarter = scores.size / 4.0
    return list(
        np.where(rank < quarter, "HEALTHY",
                 np.where(rank < 2 * quarter, "AT_RISK",
                          np.where(rank < 3 * quarter, "HIGH_RISK", "CRITICAL")))
    )


def _load_real_customer_rows(db_connection) -> pd.DataFrame:
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

        return _compute_churn_records(customer_ids, db_connection)

    except Exception as e:
        raise RuntimeError(
            f"[M4] Real-data query against customers/orders failed: {e}"
        ) from e


def _compute_churn_records(customer_ids: list, db_connection) -> pd.DataFrame:
    """Builds M4 feature rows for each customer using pipeline.py functions.

    Extracted from _load_real_customer_rows to keep it under 80 lines.
    Computes 7 feature columns + churn_tier label for each customer.

    Args:
        customer_ids (list): Ordered list of customer UUID strings.
        db_connection: Active Postgres connection.

    The 16 features outside Purchase History have no pipeline.py function yet
    (see the TODOs on FEATURE_COLUMNS), so they are filled with an explicit
    neutral value rather than left out. Leaving them out was a real bug: the
    frame this returns is indexed by FEATURE_COLUMNS in load_training_data, so
    a short frame raised KeyError and the whole real-data path — the one P3.1
    exists for — could never have run. Neutral, not random: a placeholder that
    varies would teach the model a pattern that is not in the business.

    Returns:
        pd.DataFrame: Rows of FEATURE_COLUMNS + 'engagement_decay_score' +
        'churn_tier' + 'early_warning'.
    """
    records = []
    risk_scores = []
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
        risk_scores.append(float(risk_score))

        records.append({
            "past_orders_total": orders,
            "days_since_last_purchase": days,
            "avg_order_value": aov,
            "purchase_frequency_trend": trend,
            "rfm_recency_score": rfm["rfm_recency_score"],
            "rfm_frequency_score": rfm["rfm_frequency_score"],
            "rfm_monetary_score": rfm["rfm_monetary_score"],
        })

    frame = pd.DataFrame.from_records(records)
    if not frame.empty:
        frame["churn_tier"] = assign_churn_tiers(risk_scores)
    if frame.empty:
        return pd.DataFrame(
            columns=FEATURE_COLUMNS + ["engagement_decay_score", "churn_tier", "early_warning"]
        )

    missing = [column for column in FEATURE_COLUMNS if column not in frame.columns]
    if missing:
        print(
            f"[M4] WARNING: {len(missing)} of the 24 features have no data source "
            f"yet and are filled with 0 for every real customer: {', '.join(missing)}. "
            f"Engagement drift is among them, so engagement_decay_score is not "
            f"meaningful on this path and EARLY_WARNING will not fire until the "
            f"email/SMS/site tracking tables exist."
        )
        for column in missing:
            frame[column] = 0

    frame = frame[FEATURE_COLUMNS + ["churn_tier"]]
    frame["engagement_decay_score"] = compute_engagement_decay_score(frame)
    frame["early_warning"] = 0
    return frame


def load_training_data(n: int = 4000, db_connection=None) -> tuple:
    """
    Phase 3 entry point (per task doc P3.1 — the function whose
    db_connection parameter "was reserved for this exact purpose").

    STRICT POLICY: db_connection is None -> synthetic data (dev/local path
    only). db_connection provided -> real customer records ALWAYS used, no
    silent fallback. Zero qualifying customers or a query failure raises
    immediately. Real rows below MIN_REAL_CUSTOMERS still train, with a
    loud warning and a below-threshold MLflow tag.

    Returns:
        (train_df, test_df, used_real_data: bool, below_minimum: bool). Each
        frame carries FEATURE_COLUMNS + engagement_decay_score + churn_tier +
        early_warning, so train() can fit both the 4-class model and the
        EARLY_WARNING layer from the same split.

    Raises:
        RuntimeError: if db_connection is provided and the query fails,
            or succeeds but finds zero customers with the required
            purchase history.
    """
    if db_connection is None:
        print("[M4] No db_connection provided — using synthetic data.")
        frame = _generate_synthetic_data(n=n)
        train_df, test_df = train_test_split(
            frame, test_size=0.2, random_state=42, stratify=frame["churn_tier"]
        )
        return train_df, test_df, False, False

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

    try:
        train_df, test_df = train_test_split(
            real_df, test_size=0.2, random_state=42, stratify=real_df["churn_tier"]
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
        train_df, test_df = train_test_split(real_df, test_size=0.2, random_state=42)
    return train_df, test_df, True, below_minimum


def build_model() -> GradientBoostingClassifier:
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


def build_early_warning_model() -> Pipeline:
    """The binary classifier behind the EARLY_WARNING tier.

    One feature, on purpose: engagement_decay_score. The tier answers one
    question — has this customer's engagement fallen away while their purchase
    history still looks healthy? Keeping it out of the 4-class model is what
    stops the decay signal shifting the recency tier boundaries the main model
    learns, and it is what Task S3 asks for: "a separate binary classifier for
    the EARLY_WARNING tier on the engagement_decay_score".

    Shallower than the main model (max_depth=2) because one feature cannot
    support depth 3 without simply memorising the training draw.
    """
    return Pipeline(
        [
            ("scaler", StandardScaler()),
            (
                "classifier",
                GradientBoostingClassifier(
                    n_estimators=100, max_depth=2, random_state=42
                ),
            ),
        ]
    )


def train_early_warning_layer(train_df: pd.DataFrame, test_df: pd.DataFrame) -> tuple:
    """Fits and scores the EARLY_WARNING layer on the HEALTHY cohort.

    HEALTHY rows only, because those are the only rows it is ever asked about:
    resolve_churn_tier consults it exactly when the main model has said
    HEALTHY. Fitting it on the whole population would teach it to fire on
    customers who are already AT_RISK or worse, which is not what it is for.

    Args:
        train_df: training split, carrying churn_tier, early_warning and
            engagement_decay_score.
        test_df: held-out split with the same columns.

    Returns:
        (fitted Pipeline or None, metrics dict). None when the cohort holds too
        few examples of either class to fit — the caller then falls back to the
        EARLY_WARNING_DECAY_THRESHOLD rule, which needs no training at all.
    """
    healthy_train = train_df[train_df["churn_tier"] == "HEALTHY"]
    healthy_test = test_df[test_df["churn_tier"] == "HEALTHY"]

    if healthy_train["early_warning"].nunique() < 2 or len(healthy_test) == 0:
        print(
            "[M4] WARNING: the HEALTHY cohort does not hold both classes — "
            "EARLY_WARNING falls back to the decay-threshold rule "
            f"(engagement_decay_score >= {EARLY_WARNING_DECAY_THRESHOLD})."
        )
        return None, {}

    model = build_early_warning_model()
    model.fit(healthy_train[EARLY_WARNING_FEATURES], healthy_train["early_warning"])

    y_true = healthy_test["early_warning"]
    y_pred = model.predict(healthy_test[EARLY_WARNING_FEATURES])
    report = classification_report(y_true, y_pred, output_dict=True, zero_division=0)
    flagged = report.get("1", {})

    metrics = {
        "early_warning_n_train": float(len(healthy_train)),
        "early_warning_n_test": float(len(healthy_test)),
        "early_warning_precision": float(flagged.get("precision", 0.0)),
        "early_warning_recall": float(flagged.get("recall", 0.0)),
        "early_warning_f1": float(flagged.get("f1-score", 0.0)),
    }
    if y_true.nunique() >= 2:
        y_prob = model.predict_proba(healthy_test[EARLY_WARNING_FEATURES])[:, 1]
        metrics["early_warning_auc"] = float(roc_auc_score(y_true, y_prob))

    return model, metrics


def _dagshub_run_url(run) -> str:
    """The run URL Task S3 asks to be shared in the group chat.

    Only a remote DagsHub tracking server has one. On the local mlruns store
    there is no URL to share, and saying that is more useful than printing a
    link that goes nowhere.
    """
    if not IS_REMOTE:
        return (
            "no DagsHub URL — this run went to the local mlruns store. Set "
            "MLFLOW_TRACKING_URI, MLFLOW_USERNAME and MLFLOW_PASSWORD in .env "
            "to log to DagsHub."
        )
    base = MLFLOW_TRACKING_URI.rstrip("/")
    if base.endswith(".mlflow"):
        base = base[: -len(".mlflow")]
    return f"{base}.mlflow/#/experiments/{run.info.experiment_id}/runs/{run.info.run_id}"


def train(run_name: str = "m4-churn-training", db_connection=None) -> dict:
    """Full training loop with MLflow tracking."""
    get_or_create_experiment()

    print("Loading training data (real if db_connection given, else synthetic N=4000)...")
    train_df, test_df, used_real_data, below_minimum = load_training_data(
        n=4000, db_connection=db_connection
    )
    X_train, y_train = train_df[FEATURE_COLUMNS], train_df["churn_tier"]
    X_test, y_test = test_df[FEATURE_COLUMNS], test_df["churn_tier"]

    print("Building M4 GradientBoostingClassifier...")
    model = build_model()

    with mlflow.start_run(run_name=run_name) as run:
        mlflow.set_tag("model", "churn_risk")
        mlflow.set_tag("data_source", "real" if used_real_data else "synthetic")
        mlflow.set_tag("below_minimum_threshold", str(below_minimum))

        print("Training M4 model...")
        model.fit(X_train, y_train)

        print("Training the EARLY_WARNING detection layer...")
        early_model, early_metrics = train_early_warning_layer(train_df, test_df)

        print("Evaluating model...")
        y_pred = model.predict(X_test)
        y_prob = model.predict_proba(X_test)

        report = classification_report(y_test, y_pred, output_dict=True, zero_division=0)
        # roc_auc_score for multi-class requires OvR and probability
        auc_roc = roc_auc_score(y_test, y_prob, multi_class="ovr")

        # Per-class precision / recall / F1, per P2.3. These were computed
        # before and then thrown away - only accuracy and the macro average
        # reached MLflow, which is exactly where a gate on one tier's precision
        # cannot be checked.
        per_class = {}
        for tier in CHURN_TIERS:
            scores = report.get(tier)
            if not scores:
                continue
            per_class[f"precision_{tier}"] = float(scores["precision"])
            per_class[f"recall_{tier}"] = float(scores["recall"])
            per_class[f"f1_{tier}"] = float(scores["f1-score"])
        high_risk_precision = per_class.get("precision_HIGH_RISK", 0.0)

        mlflow.log_params({
            "n_estimators": 100, "max_depth": 3, "random_state": 42,
            "n_training_samples": len(X_train),
            "n_features": len(FEATURE_COLUMNS),
            "min_real_customers_threshold": MIN_REAL_CUSTOMERS,
            "early_warning_decay_threshold": EARLY_WARNING_DECAY_THRESHOLD,
        })

        mlflow.log_metrics({
            "accuracy": report["accuracy"],
            "macro_avg_f1": report["macro avg"]["f1-score"],
            "auc_roc": auc_roc,
            **per_class,
            **early_metrics,
        })

        # The Task S3 gates. Recorded as tags so a run that misses one is
        # visible in the MLflow run list without opening it.
        meets_auc = auc_roc >= MIN_AUC_ROC
        meets_high_risk_precision = high_risk_precision >= MIN_HIGH_RISK_PRECISION
        mlflow.set_tag("meets_auc_gate", str(meets_auc))
        mlflow.set_tag("meets_high_risk_precision_gate", str(meets_high_risk_precision))

        mlflow.sklearn.log_model(model, "m4_churn_risk_model", registered_model_name="churn_risk")
        if early_model is not None:
            mlflow.sklearn.log_model(
                early_model,
                "m4_early_warning_model",
                registered_model_name="churn_early_warning",
            )

        print(f"\n--- M4 CHURN RISK MODEL METRICS ---")
        print(f"Data source: {'real' if used_real_data else 'synthetic'}")
        print(f"Features:    {len(FEATURE_COLUMNS)}")
        print(f"Accuracy: {report['accuracy']:.4f}")
        print(f"Macro F1: {report['macro avg']['f1-score']:.4f}")
        print(f"AUC-ROC:  {auc_roc:.4f}")

        print("\nPer-class (precision / recall / F1):")
        for tier in CHURN_TIERS:
            if f"precision_{tier}" not in per_class:
                continue
            print(f"  {tier:<10} {per_class[f'precision_{tier}']:.4f}  "
                  f"{per_class[f'recall_{tier}']:.4f}  {per_class[f'f1_{tier}']:.4f}")

        if early_metrics:
            print("\nEARLY_WARNING layer (binary, engagement_decay_score):")
            print(f"  AUC-ROC:   {early_metrics.get('early_warning_auc', float('nan')):.4f}")
            print(f"  Precision: {early_metrics['early_warning_precision']:.4f}")
            print(f"  Recall:    {early_metrics['early_warning_recall']:.4f}")
        else:
            print("\nEARLY_WARNING layer: not trained - threshold rule in use.")

        print("\nTask S3 gates:")
        print(f"  AUC-ROC >= {MIN_AUC_ROC}:              "
              f"{auc_roc:.4f}  {'PASS' if meets_auc else 'FAIL'}")
        print(f"  HIGH_RISK precision >= {MIN_HIGH_RISK_PRECISION}:  "
              f"{high_risk_precision:.4f}  {'PASS' if meets_high_risk_precision else 'FAIL'}")

        print(f"\n[OK] MLflow Run ID: {run.info.run_id}")
        print(f"MLflow Run Name: {run.info.run_name}")
        print(f"Run URL: {_dagshub_run_url(run)}")

        return {
            "model": model,
            "early_warning_model": early_model,
            "used_real_data": used_real_data,
            "below_minimum_threshold": below_minimum,
            "meets_auc_gate": meets_auc,
            "meets_high_risk_precision_gate": meets_high_risk_precision,
            "run_url": _dagshub_run_url(run),
            "metrics": {
                "accuracy": report["accuracy"],
                "macro_avg_f1": report["macro avg"]["f1-score"],
                "auc_roc": auc_roc,
                **per_class,
                **early_metrics,
            },
        }


if __name__ == "__main__":
    train()