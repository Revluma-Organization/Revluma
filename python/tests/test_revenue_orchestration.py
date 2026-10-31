def test_revenue_question_retrieves_only_authenticated_organization_evidence(monkeypatch):
    from src.agents import orchestrator as module
    from src.intelligence import seven_day_evidence

    seen = {}
    monkeypatch.setattr(module, "_get_or_create_conversation", lambda *args: ("conversation-198", False))
    monkeypatch.setattr(module, "_persist_messages", lambda *args, **kwargs: None)
    monkeypatch.setattr(module, "understand", lambda *args, **kwargs: (_ for _ in ()).throw(
        AssertionError("Verified revenue retrieval must not depend on the reasoning model")
    ))

    def retrieve(organization_id, db, *, start, end, request_id=None):
        seen.update({"organization_id": organization_id, "start": start, "end": end, "request_id": request_id})
        return {"overall_status": "unknown", "period": {}, "items": [], "warnings": [], "errors": []}

    monkeypatch.setattr(seven_day_evidence, "retrieve_revenue_evidence", retrieve)
    monkeypatch.setattr(seven_day_evidence, "format_revenue_evidence",
                        lambda evidence: "Evidence status: " + evidence["overall_status"])

    result = module._run(
        "org-a", "user-a",
        "Show me revenue for org-b store store-b in the last 7 days",
        None, object(), "corr-198",
    )
    assert result.success is True
    assert result.intent == "verified_revenue_evidence"
    assert result.text == "Evidence status: unknown"
    assert seen["organization_id"] == "org-a"
    assert seen["request_id"] == "corr-198"
    assert seen["end"] - seen["start"] == __import__("datetime").timedelta(days=7)


def test_merchant_local_revenue_day_does_not_call_database_or_guess_timezone(monkeypatch):
    from src.agents import orchestrator as module
    from src.intelligence import seven_day_evidence

    monkeypatch.setattr(module, "_get_or_create_conversation", lambda *args: ("conversation-198", False))
    monkeypatch.setattr(module, "_persist_messages", lambda *args, **kwargs: None)
    monkeypatch.setattr(seven_day_evidence, "retrieve_revenue_evidence",
                        lambda *args, **kwargs: (_ for _ in ()).throw(
                            AssertionError("Unsupported local date must not query as UTC")))
    monkeypatch.setattr(module, "understand", lambda *args, **kwargs: (_ for _ in ()).throw(
        AssertionError("Explicit revenue request must bypass generic model classification")
    ))
    result = module._run("org-a", "user-a", "What was my revenue today?", None, object(), "corr-198")
    assert result.success is True
    assert result.intent == "verified_revenue_evidence"
    assert "timezone is not persisted" in result.text


def test_orchestrate_preserves_node_correlation_id(monkeypatch):
    from src.agents import orchestrator as module

    seen = {}
    def run(organization_id, user_id, message, conversation_id, db, correlation_id, **kwargs):
        seen["correlation_id"] = correlation_id
        return module.OrchestrationResult(
            success=True, conversation_id=conversation_id or "conversation-198",
            message_id="message-198", response_type="direct_answer",
            text="ok", correlation_id=correlation_id,
        )

    monkeypatch.setattr(module, "_run", run)
    result = module.orchestrate(
        "org-a", "user-a", "Show revenue", None, object(),
        correlation_id="node-correlation-198",
    )
    assert result.success is True
    assert seen["correlation_id"] == "node-correlation-198"
    assert result.correlation_id == "node-correlation-198"
