import asyncio


def test_request_concurrency_gate_queues_before_handler_execution(monkeypatch):
    from src.serving import api

    async def scenario():
        gate = asyncio.Semaphore(1)
        monkeypatch.setattr(api, "_request_semaphore", gate)
        active = 0
        peak_active = 0

        async def call_next(_request):
            nonlocal active, peak_active
            active += 1
            peak_active = max(peak_active, active)
            await asyncio.sleep(0.01)
            active -= 1
            return "ok"

        results = await asyncio.gather(
            *(api.limit_request_concurrency(None, call_next) for _ in range(5))
        )

        assert results == ["ok"] * 5
        assert peak_active == 1

    asyncio.run(scenario())
