def test_revenue_question_retrieves_only_authenticated_organization_evidence(monkeypatch):
    from src.agents import orchestrator as module
    from src.intelligence import seven_day_evidence

    seen = {}
    monkeypatch.setattr(module, "_get_or_create_conversation", lambda *args: ("conversation-198", False))
    monkeypatch.setattr(module, "_persist_messages", lambda *args, **kwargs: None)
    monkeypatch.setattr(module, "understand", lambda *args, **kwargs: (_ for _ in ()).throw(
        AssertionError("Verified revenue retrieval must not depend on the reasoning model")
    ))

    def retrieve(organization_id, db, *, start, end):
        seen.update({"organization_id": organization_id, "start": start, "end": end})
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
