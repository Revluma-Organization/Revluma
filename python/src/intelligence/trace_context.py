"""Request-local, privacy-safe Rev correlation and execution identity."""
from __future__ import annotations

import re
import uuid
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Iterator

_UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\Z", re.I)
correlation_id_var: ContextVar[str | None] = ContextVar("rev_correlation_id", default=None)
execution_id_var: ContextVar[str | None] = ContextVar("rev_execution_id", default=None)


def ensure_uuid(value: object) -> str | None:
    if isinstance(value, str) and _UUID.fullmatch(value):
        return value.lower()
    return None


def new_trace(correlation_id: object = None, execution_id: object = None) -> tuple[str, str]:
    return ensure_uuid(correlation_id) or str(uuid.uuid4()), ensure_uuid(execution_id) or str(uuid.uuid4())


@contextmanager
def trace_context(correlation_id: str, execution_id: str) -> Iterator[None]:
    corr_token = correlation_id_var.set(correlation_id)
    exec_token = execution_id_var.set(execution_id)
    try:
        yield
    finally:
        correlation_id_var.reset(corr_token)
        execution_id_var.reset(exec_token)
