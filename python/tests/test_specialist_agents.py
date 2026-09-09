from types import SimpleNamespace

from src.agents.finance_agent import FinanceAgent
from src.agents.intelligence_agent import IntelligenceAgent
from src.agents.orchestrator import _AGENTS


def _state(**overrides):
    values = {
        "warnings": [], "revenue_today": 1200.0, "revenue_delta_pct": -18.0,
        "abandoned_cart_value": 240.0, "ml_signals": {}, "anomalies": [],
        "trends": [], "cart_anomaly": True,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_finance_agent_uses_business_state_without_direct_database_access():
    result = FinanceAgent().analyze(_state(), [], "How is profitability?")
    assert result.agent == "finance"
    assert result.status == "success"
    assert result.recommendations[0]["action"] == "review_profitability"


def test_intelligence_agent_detects_revenue_and_cart_correlation():
    result = IntelligenceAgent().analyze(_state(), [], "What changed?")
    assert result.agent == "intelligence"
    assert result.diagnosis
    assert result.recommendations[0]["action"] == "investigate_cross_domain_anomaly"


def test_orchestrator_uses_implemented_specialists():
    assert isinstance(_AGENTS["finance"], FinanceAgent)
    assert isinstance(_AGENTS["intelligence"], IntelligenceAgent)
