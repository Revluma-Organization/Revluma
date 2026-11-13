from types import SimpleNamespace

from src.agents import investigation, model_gateway, orchestrator, responder
from src.agents.rev_system_prompt import REV_SYSTEM_PROMPT


def test_shared_prompt_encodes_evidence_integrity_and_read_only_boundary():
    for phrase in (
        "Missing or failed data is unknown, not zero",
        "correlation is not causation",
        "Never change prices, inventory",
        "Never claim an action was executed",
        "Do not imply continuous monitoring",
    ):
        assert phrase.lower() in REV_SYSTEM_PROMPT.lower()


def test_general_commerce_answer_uses_shared_contract_without_forced_followup(monkeypatch):
    prompts = []
    monkeypatch.setattr(
        responder, "_call",
        lambda model, prompt, max_tokens, timeout: prompts.append(prompt) or "AOV is sales divided by orders.",
    )
    result = responder.compose_knowledge(
        "What is AOV?",
        SimpleNamespace(response_mode="direct_answer", intent="knowledge", goal="define AOV"),
        "", [], False,
    )
    assert result.startswith("AOV is")
    assert "Missing or failed data is unknown, not zero" in prompts[0]
    assert "Do not force an executive-report template" in prompts[0]
    assert "do not force" in prompts[0].lower()
    assert "most knowledgeable ecommerce experts on the planet" not in prompts[0]


def test_narrative_generation_uses_shared_contract_and_untrusted_evidence(monkeypatch):
    prompts = []
    monkeypatch.setattr(investigation, "_narrative_enabled", lambda: True)
    monkeypatch.setattr(investigation, "_validate_narrative", lambda *_args: (True, "ok"))
    monkeypatch.setattr(
        model_gateway, "generate",
        lambda prompt, **kwargs: prompts.append(prompt) or "The supplied records show a change.",
    )
    text, used_model = investigation._compose_narrative(
        message="What changed?", intent="revenue_investigation", window={}, facts=[],
        comparison_facts=[], hypotheses=[], unknowns=[], recommendations=[], items=[],
        deterministic="Verified records are available.",
    )
    assert used_model is True
    assert text == "The supplied records show a change."
    assert "Missing or failed data is unknown, not zero" in prompts[0]
    assert investigation.UNTRUSTED_DATA_PREAMBLE in prompts[0]
    assert "do not force a report template" in prompts[0].lower()


def test_analysis_actions_are_limited_to_read_only_views(monkeypatch):
    prompts = []
    response = (
        '{"situation":"Verified records were retrieved.","insight":"","implication":"","recommendation":"Review the records.",'
        '"confidence":{"score":0.8,"basis":"complete data"},'
        '"actions":[{"label":"View analytics","tool":"view_analytics","params":{}}]}'
    )
    monkeypatch.setattr(
        responder, "_call",
        lambda model, prompt, max_tokens, timeout: prompts.append(prompt) or response,
    )
    result = responder.compose_analysis(
        "Review store data", SimpleNamespace(goal="review"), "{}", "{}", "{}", "",
    )
    assert result["actions"][0]["tool"] == "view_analytics"
    assert "create_campaign" not in prompts[0]
    assert "Never create or execute a merchant-side action" in prompts[0]
    assert "create_campaign" not in orchestrator.ALLOWED_ACTION_TOOLS


def test_mutating_action_is_rejected_by_response_parser():
    raw = (
        '{"situation":"Verified records were retrieved.","insight":"","implication":"","recommendation":"Review the records.",'
        '"confidence":{"score":0.8,"basis":"complete data"},'
        '"actions":[{"label":"Launch campaign","tool":"create_campaign","params":{}}]}'
    )
    assert responder._parse_analysis(raw) is None
