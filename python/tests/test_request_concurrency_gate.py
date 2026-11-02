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
