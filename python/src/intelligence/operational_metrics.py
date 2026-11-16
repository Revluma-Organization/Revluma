"""Low-cardinality, privacy-safe in-process Rev operational metrics.

Deployments can scrape the internal JSON endpoint and combine per-process
snapshots. Only bounded operational labels are accepted; identifiers and
merchant content must never be metric labels.
"""
from __future__ import annotations

import re
import threading
from collections import defaultdict, deque
from typing import Mapping

_LOCK = threading.Lock()
_COUNTERS: dict[tuple[str, tuple[tuple[str, str], ...]], int] = defaultdict(int)
_LATENCIES: dict[str, deque[int]] = defaultdict(lambda: deque(maxlen=2048))
_NAME = re.compile(r"[a-z][a-z0-9_]{0,63}\Z")
_VALUE = re.compile(r"[a-zA-Z0-9_.:-]{1,48}\Z")
_MAX_LABELS = 4
_MAX_SERIES = 512
_ALLOWED_LABELS = frozenset({
    "provider", "model", "category", "outcome", "stage", "kind",
    "from_provider", "to_provider", "from_model", "to_model",
})


def _labels(labels: Mapping[str, object] | None) -> tuple[tuple[str, str], ...]:
    safe = []
    for key, value in sorted((labels or {}).items()):
        key = str(key).lower()
        text = str(value)
        if key not in _ALLOWED_LABELS or not _VALUE.fullmatch(text):
            continue
        safe.append((key, text))
        if len(safe) >= _MAX_LABELS:
            break
    return tuple(safe)


def record_counter(name: str, value: int = 1, *, labels: Mapping[str, object] | None = None) -> None:
    if not _NAME.fullmatch(name):
        return
    amount = max(0, min(int(value), 1_000_000))
    with _LOCK:
        series = (name, _labels(labels))
        if series not in _COUNTERS and len(_COUNTERS) >= _MAX_SERIES:
            return
        _COUNTERS[series] += amount


def observe_latency(name: str, milliseconds: int | float) -> None:
    if not _NAME.fullmatch(name):
        return
    duration = max(0, min(int(milliseconds), 3_600_000))
    with _LOCK:
        _LATENCIES[name].append(duration)


def _percentile(values: list[int], fraction: float) -> int:
    if not values:
        return 0
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, max(0, int((len(ordered) - 1) * fraction + 0.999999)))]


def snapshot() -> dict:
    with _LOCK:
        counters = [
            {"name": name, "labels": dict(labels), "value": value}
            for (name, labels), value in sorted(_COUNTERS.items())
        ]
        latency = {}
        for name, values in _LATENCIES.items():
            samples = list(values)
            latency[name] = {
                "count": len(samples),
                "average_ms": round(sum(samples) / len(samples), 2) if samples else 0,
                "p50_ms": _percentile(samples, .50),
                "p90_ms": _percentile(samples, .90),
                "p95_ms": _percentile(samples, .95),
                "p99_ms": _percentile(samples, .99),
                "max_ms": max(samples, default=0),
            }
    return {"contract_version": "rev-metrics-v1", "counters": counters, "latency_ms": latency}


def reset_for_tests() -> None:
    with _LOCK:
        _COUNTERS.clear()
        _LATENCIES.clear()
