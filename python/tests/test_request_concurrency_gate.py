import asyncio

from src.serving.api import RequestConcurrencyGate


def test_request_gate_holds_permit_until_streaming_body_finishes():
    async def scenario():
        first_stream_body_sent = asyncio.Event()
        finish_first_stream = asyncio.Event()
        second_started = asyncio.Event()
        calls = []

        async def app(scope, receive, send):
            route = scope["path"]
            calls.append(route)
            if route == "/first":
                await send({"type": "http.response.start", "status": 200, "headers": []})
                await send({"type": "http.response.body", "body": b"part", "more_body": True})
                first_stream_body_sent.set()
                await finish_first_stream.wait()
                await send({"type": "http.response.body", "body": b"done", "more_body": False})
            else:
                second_started.set()
                await send({"type": "http.response.start", "status": 200, "headers": []})
                await send({"type": "http.response.body", "body": b"done", "more_body": False})

        middleware = RequestConcurrencyGate(app, limit=1)

        async def invoke(path):
            async def receive():
                return {"type": "http.request", "body": b"", "more_body": False}

            async def send(_message):
                return None

            await middleware({"type": "http", "path": path}, receive, send)

        first = asyncio.create_task(invoke("/first"))
        await first_stream_body_sent.wait()
        second = asyncio.create_task(invoke("/second"))
        await asyncio.sleep(0.02)
        assert not second_started.is_set()
        finish_first_stream.set()
        await asyncio.gather(first, second)
        assert second_started.is_set()
        assert calls == ["/first", "/second"]

    asyncio.run(scenario())


def test_request_gate_releases_permit_when_app_raises():
    async def scenario():
        async def failing_app(scope, receive, send):
            raise RuntimeError("synthetic failure")

        middleware = RequestConcurrencyGate(failing_app, limit=1)

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(_message):
            return None

        try:
            await middleware({"type": "http", "path": "/"}, receive, send)
        except RuntimeError:
            pass
        else:
            raise AssertionError("Expected synthetic failure")

        assert middleware.semaphore._value == 1

    asyncio.run(scenario())


def test_request_gate_counts_a_stream_as_active_until_its_body_finishes():
    """A stream holds its slot for the whole body, and must be counted as one."""
    async def scenario():
        first_chunk_sent = asyncio.Event()
        finish_stream = asyncio.Event()
        observed = {}

        async def app(scope, receive, send):
            await send({
                "type": "http.response.start",
                "status": 200,
                "headers": [(b"content-type", b"text/event-stream")],
            })
            await send({"type": "http.response.body", "body": b"part", "more_body": True})
            first_chunk_sent.set()
            await finish_stream.wait()
            observed["during"] = middleware.snapshot()
            await send({"type": "http.response.body", "body": b"done", "more_body": False})

        middleware = RequestConcurrencyGate(app, limit=2)

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(_message):
            return None

        task = asyncio.create_task(
            middleware({"type": "http", "path": "/rev/stream"}, receive, send)
        )
        await first_chunk_sent.wait()
        await asyncio.sleep(0.01)

        mid = middleware.snapshot()
        assert mid["active_streams"] == 1
        assert mid["active_requests"] == 1

        finish_stream.set()
        await task

        after = middleware.snapshot()
        assert after["active_streams"] == 0
        assert after["active_requests"] == 0
        assert observed["during"]["active_streams"] == 1
        # The permit went back to the semaphore, so the slot is reusable.
        assert middleware.semaphore._value == 2

    asyncio.run(scenario())


def test_request_gate_does_not_count_a_json_response_as_a_stream():
    async def scenario():
        async def app(scope, receive, send):
            await send({
                "type": "http.response.start",
                "status": 200,
                "headers": [(b"content-type", b"application/json")],
            })
            await send({"type": "http.response.body", "body": b"{}", "more_body": False})

        middleware = RequestConcurrencyGate(app, limit=2)

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(_message):
            return None

        await middleware({"type": "http", "path": "/health"}, receive, send)

        snapshot = middleware.snapshot()
        assert snapshot["active_streams"] == 0
        assert snapshot["total_requests"] == 1

    asyncio.run(scenario())


def test_request_gate_records_queuing_when_the_limit_is_reached():
    """Queue wait is evidence for whether the concurrency limit is too tight."""
    async def scenario():
        release = asyncio.Event()
        first_in = asyncio.Event()

        async def app(scope, receive, send):
            if scope["path"] == "/slow":
                first_in.set()
                await release.wait()
            await send({"type": "http.response.start", "status": 200, "headers": []})
            await send({"type": "http.response.body", "body": b"", "more_body": False})

        middleware = RequestConcurrencyGate(app, limit=1)

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(_message):
            return None

        slow = asyncio.create_task(
            middleware({"type": "http", "path": "/slow"}, receive, send)
        )
        await first_in.wait()
        queued = asyncio.create_task(
            middleware({"type": "http", "path": "/fast"}, receive, send)
        )
        await asyncio.sleep(0.05)

        release.set()
        await asyncio.gather(slow, queued)

        snapshot = middleware.snapshot()
        assert snapshot["total_requests"] == 2
        assert snapshot["queued_requests"] == 1
        assert snapshot["max_wait_ms"] > 0
        assert snapshot["saturated_events"] >= 1

    asyncio.run(scenario())
