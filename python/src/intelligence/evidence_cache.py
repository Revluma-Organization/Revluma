"""Request-scoped reuse of validated merchant evidence.

``RequestToolMemo`` lives for exactly one investigation. When the agent loop
and the deterministic plan (or two agent turns) ask for the *same* read-only
tool with the *same* server-resolved parameters, the already-validated
``ToolResult`` from this request is reused instead of querying the database
again. Within one request that is, by construction, the same snapshot, so
reuse never presents older data as newer.

Deliberately absent: a cross-request merchant-evidence cache. Shopify webhooks
write orders, refunds and checkouts continuously without advancing any
reliable data-version watermark (``stores.last_synced_at`` only moves on full
syncs). Any time-based reuse across requests could therefore show stale
evidence as current, which the evidence contract forbids. Public web research
has its own bounded, age-disclosing cache in ``agents.agent_gateway``.

Only usable results (``available``/``partial``) are memoised; failed or
unavailable evidence is re-queried on the next identical request.
"""
from __future__ import annotations

import json
import time
from typing import Any, Callable

MEMO_NAME = "request_tool_memo"
USABLE = frozenset({"available", "partial"})


def canonical_params(params: dict | None) -> str:
    return json.dumps(params or {}, sort_keys=True, default=str, separators=(",", ":"))


class RequestToolMemo:
    """Per-investigation memo around the authorised tool executor."""

    def __init__(self, *, run: Callable[[str, dict], Any]) -> None:
        self._run = run
        self._memo: dict[str, Any] = {}
        self.stats = {"executed": 0, "reused": 0}

    def __call__(self, tool: str, params: dict) -> Any:
        from .execution_telemetry import record_cache, record_tool

        memo_key = tool + ":" + canonical_params(params)
        if memo_key in self._memo:
            self.stats["reused"] += 1
            record_cache(MEMO_NAME, "hit")
            record_tool(tool, "reused", 0, reused=True, cache="request_memo")
            return self._memo[memo_key]
        started = time.monotonic()
        result = self._run(tool, params)
        self.stats["executed"] += 1
        status = str(getattr(result, "status", "unknown"))
        record_tool(tool, status, (time.monotonic() - started) * 1000)
        if status in USABLE:
            self._memo[memo_key] = result
            record_cache(MEMO_NAME, "store")
        else:
            record_cache(MEMO_NAME, "miss")
        return result
