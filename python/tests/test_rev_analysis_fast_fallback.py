"""The deep model may time out; verified evidence must still reach fast-model reasoning."""
from types import SimpleNamespace
from unittest.mock import patch

from src.agents import responder


def test_analysis_falls_back_to_fast_model_with_identical_evidence():
    calls = []
    payload = '{"situation":"15 recorded abandoned carts","insight":"Cause not verified","implication":"Potential value is not guaranteed revenue","recommendation":"Inspect recovery eligibility","confidence":{"score":0.5,"basis":"Recorded carts only"},"actions":[]}'
    def fake_call(model, prompt, max_tokens, timeout):
        calls.append((model, prompt, timeout))
        if len(calls) == 1:
            raise TimeoutError("deep model stalled")
        return payload

    with patch.object(responder, "_call", side_effect=fake_call):
        result = responder.compose_analysis(
            "Why are customers abandoning carts?",
            SimpleNamespace(goal="understand cart recovery"),
            '{"abandoned_carts":15}', '{"signal":"cart activity"}',
            '{"rule":"do not infer reasons"}', "previous discussion",
        )

    assert result["situation"] == "15 recorded abandoned carts"
    assert len(calls) == 2
    assert calls[0][0] == responder.DEEP_MODEL
    assert calls[1][0] == responder.FAST_MODEL
    assert calls[0][1] == calls[1][1]
    assert "do not infer reasons" in calls[1][1]


def test_analysis_fails_closed_if_both_models_unavailable():
    with patch.object(responder, "_call", side_effect=TimeoutError):
        result = responder.compose_analysis(
            "Why are customers abandoning carts?",
            SimpleNamespace(goal="understand cart recovery"),
            "{}", "{}", "{}", "",
        )
    assert result["confidence"]["score"] == 0
    assert "could not complete" in result["situation"]
