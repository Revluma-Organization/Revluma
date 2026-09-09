import warnings

import numpy as np
import pandas as pd
from pandas.testing import assert_frame_equal
from sklearn.exceptions import ConvergenceWarning

from src.models.abandonment.train import (
    FEATURE_COLUMNS as ABANDONMENT_FEATURES,
    build_model as build_abandonment_model,
    generate_synthetic_data as generate_abandonment_data,
)
from src.models.churn.train import (
    CHURN_TIERS,
    FEATURE_COLUMNS as CHURN_FEATURES,
    _generate_synthetic_data as generate_churn_data,
)
from src.models.offer_value.train import (
    MAX_DISCOUNT_PCT,
    FEATURE_COLUMNS as OFFER_VALUE_FEATURES,
    load_training_data as generate_offer_data,
)
from src.models.sensitivity.train import (
    FEATURES as SENSITIVITY_FEATURES,
    _generate_synthetic_sensitivity_data as generate_sensitivity_data,
)
from src.models.timing.train import (
    FEATURE_COLUMNS as TIMING_FEATURES,
    _generate_synthetic_data as generate_timing_data,
)


def test_abandonment_data_is_reproducible_and_directionally_valid():
    first = generate_abandonment_data(2_000)
    second = generate_abandonment_data(2_000)

    assert_frame_equal(first, second)
    assert list(first.columns) == ABANDONMENT_FEATURES + ["abandoned"]
    assert 0.60 <= first["abandoned"].mean() <= 0.75
    failed = first.groupby("failed_payment_attempt")["abandoned"].mean()
    assert failed[1] > failed[0]
    early = first.loc[first["checkout_step_reached"] <= 1, "abandoned"].mean()
    late = first.loc[first["checkout_step_reached"] >= 4, "abandoned"].mean()
    assert early > late


def test_abandonment_model_converges_on_the_synthetic_contract():
    data = generate_abandonment_data(2_000)
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        build_abandonment_model().fit(
            data[ABANDONMENT_FEATURES], data["abandoned"]
        )
    assert not any(issubclass(item.category, ConvergenceWarning) for item in caught)


def test_sensitivity_data_has_both_labels_and_expected_signal_directions():
    data = generate_sensitivity_data(3_000)

    assert list(data.columns) == SENSITIVITY_FEATURES + ["PSS_label", "CSS_label", "TSS_label"]
    assert set(data["PSS_label"]) == {0, 1}
    assert set(data["CSS_label"]) == {0, 1}
    assert set(data["TSS_label"]) == {0, 1}
    pss_by_coupon_visit = data.groupby("visited_coupon_page")["PSS_label"].mean()
    css_by_shipping_reveal = data.groupby("abandoned_at_shipping_reveal")[
        "CSS_label"
    ].mean()
    assert pss_by_coupon_visit[1] > pss_by_coupon_visit[0]
    assert css_by_shipping_reveal[1] > css_by_shipping_reveal[0]
    tss_by_repeat_payment_failure = data.groupby(data["failed_payment_count"] > 1)["TSS_label"].mean()
    assert tss_by_repeat_payment_failure[True] > tss_by_repeat_payment_failure[False]


def test_timing_data_covers_contract_and_rewards_peak_windows():
    x_train, x_test, y_train, y_test = generate_timing_data(4_000)
    features = pd.concat([x_train, x_test], ignore_index=True)
    labels = pd.Series(np.concatenate([y_train, y_test]), name="converted")

    assert list(features.columns) == TIMING_FEATURES
    assert set(labels) == {0, 1}
    peak = features["send_hour"].between(9, 11) | features["send_hour"].between(
        18, 20
    )
    assert labels[peak].mean() > labels[~peak].mean()


def test_churn_data_covers_all_21_features_and_tiers():
    data = generate_churn_data(4_000)

    assert len(CHURN_FEATURES) == 21
    assert set(CHURN_FEATURES).issubset(data.columns)
    assert set(data["churn_tier"]) == set(CHURN_TIERS)
    assert (data["churn_tier"].value_counts(normalize=True) > 0.03).all()
    assert data["days_since_last_purchase"].corr(data["rfm_recency_score"]) < -0.7


def test_offer_data_is_reproducible_and_respects_the_ungated_training_contract():
    first = generate_offer_data(3_000)
    second = generate_offer_data(3_000)
    x_train, x_test, y_train, y_test = first
    x = pd.concat([x_train, x_test], ignore_index=True)
    y = np.concatenate([y_train, y_test])

    for first_part, second_part in zip(first, second):
        if isinstance(first_part, pd.DataFrame):
            assert_frame_equal(first_part, second_part)
        else:
            np.testing.assert_array_equal(first_part, second_part)
    assert np.isfinite(x.to_numpy()).all()
    assert list(x.columns) == OFFER_VALUE_FEATURES
    assert np.all((y >= 0) & (y <= MAX_DISCOUNT_PCT))
    assert (x["pss_score"] >= 0).all()
