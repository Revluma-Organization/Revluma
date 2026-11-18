"""Capability registry and argument-validation tests for Rev's agent runtime.

Loop behaviour (tool selection, feedback, budgets, cancellation, failure
recovery) is covered against the authoritative runtime in
``test_rev_agent_runtime.py``; web research in ``test_rev_web_research_agent.py``.
"""

import pytest

from src.agents import objective_agent


def test_server_tool_schemas_do_not_expose_tenant_dates_or_mutations():
    from src.agents.tools import catalog
    specs = {item["name"]: item for item in catalog()}
    schema = objective_agent._tool_schema("order_observations", specs)
    properties = schema["input_schema"]["properties"]
    assert "organization_id" not in properties
    assert "store_id" not in properties
    assert "start" not in properties and "end" not in properties
    assert "query" not in properties and "sql" not in properties
    assert "include_records" not in properties
    assert "write" not in properties and "mutation" not in properties
    assert schema["input_schema"]["additionalProperties"] is False


def test_untyped_or_out_of_scope_model_arguments_are_rejected():
    with pytest.raises(PermissionError):
        objective_agent._validate_arguments("order_observations", {"organization_id": "other-org"})
    with pytest.raises(PermissionError):
        objective_agent._validate_arguments("order_observations", {"latest": "yes"})
    with pytest.raises(PermissionError):
        objective_agent._validate_arguments("order_observations", {"financial_status": "HACKED"})
    with pytest.raises(PermissionError):
        objective_agent._validate_arguments("order_observations", {"order_reference": "x" * 129})
