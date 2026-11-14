"""Metrics stay bounded and carry no user-supplied high-cardinality dimensions."""
from src.intelligence import operational_metrics as metrics


def test_metrics_snapshot_includes_success_failure_and_percentiles_without_identifiers():
    metrics.reset_for_tests()
    metrics.record_counter("rev_requests_total", labels={"kind": "general", "outcome": "success"})
    metrics.record_counter("rev_provider_fallbacks_total", labels={"from_provider": "anthropic", "to_provider": "gemini"})
    metrics.record_counter("rev_requests_total", labels={"kind": "investigation", "outcome": "failure"})
    for duration in (10, 20, 30, 40, 100):
        metrics.observe_latency("rev_execution", duration)
    snapshot = metrics.snapshot()
    assert snapshot["contract_version"] == "rev-metrics-v1"
    assert snapshot["latency_ms"]["rev_execution"] == {
        "count": 5, "average_ms": 40.0, "p50_ms": 30,
        "p90_ms": 100, "p95_ms": 100, "p99_ms": 100, "max_ms": 100,
    }
    assert any(counter["name"] == "rev_requests_total" and counter["labels"].get("outcome") == "success"
               for counter in snapshot["counters"])
    assert any(counter["name"] == "rev_provider_fallbacks_total" for counter in snapshot["counters"])
    assert "correlation_id" not in str(snapshot)
    assert "conversation_id" not in str(snapshot)


def test_metric_labels_reject_raw_prompts_and_bound_sample_retention():
    metrics.reset_for_tests()
    metrics.record_counter("rev_requests_total", labels={
        "kind": "general", "prompt": "private customer email@example.com", "correlation_id": "123"})
    for duration in range(2500):
        metrics.observe_latency("rev_execution", duration)
    report = metrics.snapshot()
    assert report["latency_ms"]["rev_execution"]["count"] == 2048
    serialized = str(report)
    assert "private customer" not in serialized
    assert "email@example.com" not in serialized
    assert "correlation_id" not in serialized


def test_metric_series_cardinality_is_capped_and_conversation_state_failures_are_counted():
    from src.agents.investigation import _persist_conversation_state

    metrics.reset_for_tests()
    for value in range(700):
        metrics.record_counter("rev_requests_total", labels={"category": f"scenario-{value}"})
    class BrokenDB:
        def execute(self, *args, **kwargs):
            raise RuntimeError("sensitive database detail")
    assert len(metrics.snapshot()["counters"]) == 512
    metrics.reset_for_tests()
    _persist_conversation_state(
        "11111111-1111-1111-1111-111111111111",
        "22222222-2222-2222-2222-222222222222",
        BrokenDB(), {"subject": "revenue"},
    )
    report = metrics.snapshot()
    assert any(counter["name"] == "rev_persistence_failures_total"
               and counter["labels"].get("stage") == "conversation_state"
               for counter in report["counters"])
