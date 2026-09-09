from src.models.offer_value.train import (
    _is_production_eligible as offer_value_is_production_eligible,
)
from src.models.sensitivity.train import (
    _is_production_eligible as sensitivity_is_production_eligible,
)


def test_sensitivity_registration_requires_sufficient_real_data():
    passing_metrics = {"auc_roc": 0.80, "f1": 0.70}
    assert sensitivity_is_production_eligible(True, False, passing_metrics)
    assert not sensitivity_is_production_eligible(False, False, passing_metrics)
    assert not sensitivity_is_production_eligible(True, True, passing_metrics)


def test_sensitivity_registration_requires_quality_gates():
    assert not sensitivity_is_production_eligible(
        True,
        False,
        {"auc_roc": 0.74, "f1": 0.70},
    )
    assert not sensitivity_is_production_eligible(
        True,
        False,
        {"auc_roc": 0.80, "f1": 0.64},
    )


def test_offer_value_registration_requires_sufficient_real_data():
    assert offer_value_is_production_eligible(True, False, 4.0, 0.80)
    assert not offer_value_is_production_eligible(False, False, 4.0, 0.80)
    assert not offer_value_is_production_eligible(True, True, 4.0, 0.80)


def test_offer_value_registration_requires_quality_gates():
    assert not offer_value_is_production_eligible(True, False, 5.1, 0.80)
    assert not offer_value_is_production_eligible(True, False, 4.0, 0.69)
