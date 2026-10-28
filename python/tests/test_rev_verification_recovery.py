"""Verification accepts ordinary prose but rejects unsupported store figures."""
from src.agents.orchestrator import _validate_analysis_response


def response(insight):
    return {
        "situation": "Abandoned carts need investigation.",
        "insight": insight,
        "implication": "The cause is not yet verified.",
        "recommendation": "First, review the cart list. Then check checkout tracking.",
        "confidence": {"score": 0.5, "basis": "Recorded store signals only"},
        "actions": [],
    }


def validate(insight, evidence=(15.0, 18041.15)):
    return _validate_analysis_response(
        response(insight), evidence_values=set(evidence), known_entities=set()
    )


def test_action_numbering_is_not_a_store_metric():
    assert validate("Start with 2 priorities and review 3 opportunities.") == []


def test_verified_cart_count_and_value_pass():
    assert validate("15 carts with $18,041.15 in recorded cart value.") == []


def test_invented_cart_count_is_rejected():
    assert "invented_number" in validate("27 carts were abandoned.")


def test_invented_currency_amount_is_rejected():
    assert "invented_number" in validate("Cart value is $999.99.")


def test_invented_percentage_is_rejected():
    assert "invented_number" in validate("Cart abandonment is 42%.")


def test_pii_remains_blocked():
    assert "pii_detected" in validate("Customer email is customer@example.com.")
