"""A synthetic Gemini HTTP endpoint for authoritative-runtime tests.

Only the provider boundary is fake. Requests leave the real ``agent_gateway``
(native tool turns and Google-Search-grounded research) and the real
``model_gateway`` (understanding / composition) through ``httpx.Client`` in
Gemini's wire format, and come back in Gemini's wire format. Everything above
the transport executes for real: attempt handling, usage accounting, the agent
loop, tool execution against the database double, evidence validation,
telemetry and persistence.

Every test that uses this fake proves contracts with a scripted provider. It
does not prove live model quality or live search results.
"""
from __future__ import annotations

import json
import re
from types import SimpleNamespace
from typing import Any, Callable

import httpx

UNDERSTANDING_MARKER = "You are the understanding layer of Rev"


class FakeGemini:
    """Scripted ``generateContent`` endpoint.

    * ``understand(message) -> dict | None``: understanding JSON for a merchant
      message (``None`` returns HTTP 503, so routing falls back honestly).
    * ``agent_turns``: queue of callables ``(view) -> list[part]`` for native
      tool turns; ``view`` exposes tool names, the system prompt and the
      functionResponse payloads of the previous turn.
    * ``search(query) -> (summary, [(url, title), ...])`` for grounded search.
    * ``compose(prompt) -> str | None`` for any other plain generation
      (``None`` returns HTTP 503).
    """

    def __init__(self) -> None:
        self.understand: Callable[[str], dict | None] = lambda message: None
        self.agent_turns: list[Callable[[dict], list[dict]]] = []
        self.search: Callable[[str], tuple[str, list[tuple[str, str]]]] = lambda query: ("", [])
        self.compose: Callable[[str], str | None] = lambda prompt: None
        self.requests: list[dict] = []

    # -- helpers for scripted turns ---------------------------------------
    @staticmethod
    def call(name: str, args: dict | None = None) -> dict:
        return {"functionCall": {"name": name, "args": args or {}}}

    @staticmethod
    def text(value: str) -> dict:
        return {"text": value}

    def kinds(self) -> list[str]:
        return [request["kind"] for request in self.requests]

    # -- transport --------------------------------------------------------
    def _respond(self, url: str, payload: dict) -> tuple[int, dict]:
        model = re.search(r"/models/([^:]+):generateContent", url)
        model_name = model.group(1) if model else "unknown"
        tools = payload.get("tools") or []
        declarations = [decl for tool in tools for decl in (tool.get("functionDeclarations") or [])]
        if declarations:
            contents = payload.get("contents") or []
            results: dict[str, list[Any]] = {}
            if contents and contents[-1].get("role") == "user":
                for part in contents[-1].get("parts") or []:
                    response = part.get("functionResponse")
                    if response:
                        results.setdefault(response["name"], []).append(response.get("response"))
            view = {"tools": [decl["name"] for decl in declarations],
                    "system": ((payload.get("systemInstruction") or {}).get("parts") or [{}])[0].get("text", ""),
                    "contents": contents, "results": results, "model": model_name,
                    "first_user_text": next((part.get("text") for content in contents[:1]
                                             for part in content.get("parts") or [] if part.get("text")), "")}
            self.requests.append({"kind": "agent_turn", "model": model_name, "tools": view["tools"],
                                  "payload": payload})
            if not self.agent_turns:
                return 500, {"error": {"status": "UNSCRIPTED_AGENT_TURN"}}
            parts = self.agent_turns.pop(0)(view)
            return 200, {"candidates": [{"content": {"role": "model", "parts": parts}, "finishReason": "STOP"}],
                         "usageMetadata": {"promptTokenCount": 800, "candidatesTokenCount": 60}}
        prompt = "".join(part.get("text", "") for content in payload.get("contents") or []
                         for part in content.get("parts") or [])
        if any("google_search" in tool for tool in tools):
            query = prompt.removeprefix("Research query: ")
            self.requests.append({"kind": "web_search", "model": model_name, "query": query, "payload": payload})
            summary, sources = self.search(query)
            return 200, {"candidates": [{"content": {"parts": [{"text": summary}]}, "finishReason": "STOP",
                                         "groundingMetadata": {
                                             "webSearchQueries": [query],
                                             "groundingChunks": [{"web": {"uri": url, "title": title}}
                                                                 for url, title in sources]}}],
                         "usageMetadata": {"promptTokenCount": 300, "candidatesTokenCount": 120}}
        if prompt.startswith(UNDERSTANDING_MARKER):
            message = prompt.split("MERCHANT MESSAGE:\n", 1)[-1].split("\n\n", 1)[0]
            self.requests.append({"kind": "understanding", "model": model_name, "message": message,
                                  "payload": payload})
            reading = self.understand(message)
            if reading is None:
                return 503, {"error": {"status": "UNAVAILABLE"}}
            return 200, {"candidates": [{"content": {"parts": [{"text": json.dumps(reading)}]},
                                         "finishReason": "STOP"}],
                         "usageMetadata": {"promptTokenCount": 400, "candidatesTokenCount": 50}}
        self.requests.append({"kind": "compose", "model": model_name, "payload": payload})
        text = self.compose(prompt)
        if text is None:
            return 503, {"error": {"status": "UNAVAILABLE"}}
        return 200, {"candidates": [{"content": {"parts": [{"text": text}]}, "finishReason": "STOP"}],
                     "usageMetadata": {"promptTokenCount": 500, "candidatesTokenCount": 80}}

    def client_class(self):
        fake = self

        class _Client:
            def __init__(self, *args, **kwargs):
                pass

            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def post(self, url, headers=None, json=None):  # noqa: A002 - httpx signature
                assert (headers or {}).get("x-goog-api-key") == "test-gemini-key"
                status, body = fake._respond(url, json or {})
                return SimpleNamespace(status_code=status, json=lambda: body)

        return _Client

    def install(self, monkeypatch) -> "FakeGemini":
        """Route both gateways' HTTP through this fake and configure Gemini only."""
        from src.agents import agent_gateway, model_gateway

        transport = SimpleNamespace(Client=self.client_class(), Timeout=httpx.Timeout,
                                    TimeoutException=httpx.TimeoutException, HTTPError=httpx.HTTPError)
        monkeypatch.setattr(agent_gateway, "httpx", transport)
        monkeypatch.setattr(model_gateway, "httpx", transport)
        monkeypatch.setenv("AI_PROVIDER", "gemini")
        monkeypatch.setenv("GEMINI_API_KEY", "test-gemini-key")
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        monkeypatch.delenv("AI_FALLBACK_PROVIDERS", raising=False)
        monkeypatch.setenv("REV_NARRATIVE_LLM", "false")
        agent_gateway.clear_web_cache()
        return self


def understanding(intent: str, *, store: bool = False, web: bool = False, mode: str = "explanation",
                  domains: list[str] | None = None, confidence: float = 0.95, **entities: Any) -> dict:
    """An understanding-layer JSON reading, in the model's output schema."""
    return {"intent": intent, "goal": intent.replace("_", " "), "requires_store_data": store,
            "requires_web": web, "requires_action": False, "response_mode": mode,
            "entities": entities, "domains": domains or [], "urgency": "low", "confidence": confidence}


def parse_sse(text: str) -> list[tuple[str, dict]]:
    events = []
    for frame in text.strip().split("\n\n"):
        lines = frame.splitlines()
        if lines and lines[0].startswith("event: "):
            body = "\n".join(line[6:] for line in lines[1:] if line.startswith("data: "))
            events.append((lines[0][7:], json.loads(body or "{}")))
    return events
