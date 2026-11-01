"""Safe, organization-scoped read helpers for the intelligence runtime.

A failed or unavailable table must never abort a whole investigation, and it
must never be reported as a verified zero.  Every helper therefore isolates the
query in a savepoint where the driver supports it, rolls back only that
savepoint, and returns the failure so the caller can mark evidence unavailable.
"""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import text

logger = logging.getLogger("rev.query")


def _as_rows(result: Any) -> list:
    if result is None:
        return []
    mappings = getattr(result, "mappings", None)
    if callable(mappings):
        return list(mappings().all())
    try:
        return list(result)
    except TypeError:
        return []


def safe_query(db: Any, sql: str, params: dict | None = None) -> tuple[list, str | None]:
    """Execute a read-only statement, isolating failures.

    Returns ``(rows, error_code)``.  ``error_code`` is ``None`` on success.
    """
    params = params or {}
    nested = getattr(db, "begin_nested", None)
    savepoint = None
    if callable(nested):
        try:
            savepoint = db.begin_nested()
            savepoint.__enter__()
        except Exception:  # pragma: no cover - driver without savepoints
            savepoint = None
    try:
        result = db.execute(text(sql), params)
        return _as_rows(result), None
    except Exception as exc:
        if savepoint is not None:
            try:
                savepoint.__exit__(type(exc), exc, exc.__traceback__)
            except Exception:  # pragma: no cover - defensive
                pass
        else:
            rollback = getattr(db, "rollback", None)
            if callable(rollback):
                try:
                    rollback()
                except Exception:  # pragma: no cover - defensive
                    pass
        logger.warning("rev_query_failed error_type=%s", type(exc).__name__)
        return [], "query_failed"
    else:
        if savepoint is not None:
            try:
                savepoint.__exit__(None, None, None)
            except Exception:  # pragma: no cover - defensive
                pass
        return _as_rows(result), None


def table_exists(db: Any, table_name: str) -> bool:
    if not isinstance(table_name, str) or not table_name.replace("_", "").isalnum():
        return False
    rows, error = safe_query(db, f"SELECT to_regclass(:table) AS present",
                             {"table": f"public.{table_name}"})
    if error or not rows:
        return False
    row = rows[0]
    try:
        return bool(row["present"])
    except (KeyError, IndexError, TypeError):
        return False
