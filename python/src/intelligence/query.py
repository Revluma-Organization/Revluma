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


def _in_transaction(db: Any) -> bool:
    """True when the session already owns an outer transaction.

    Doubles that do not model transaction state are treated as "no outer
    transaction", which is the conservative default: it keeps the read
    self-contained instead of assuming a caller transaction to protect.
    """
    probe = getattr(db, "in_transaction", None)
    if not callable(probe):
        return False
    try:
        return bool(probe())
    except Exception:  # pragma: no cover - defensive
        return False


def _rollback(db: Any) -> None:
    rollback = getattr(db, "rollback", None)
    if not callable(rollback):
        return
    try:
        rollback()
    except Exception:  # pragma: no cover - defensive
        logger.warning("rev_query_rollback_failed")


def safe_query(db: Any, sql: str, params: dict | None = None) -> tuple[list, str | None]:
    """Execute a read-only statement, isolating failures.

    Returns ``(rows, error_code)``.  ``error_code`` is ``None`` on success.

    Connection lifecycle matters here. A savepoint is only meaningful when an
    *outer* transaction has to survive a failed statement. ``begin_nested()``
    on a session with no transaction silently BEGINs one, and releasing the
    savepoint does **not** end that outer transaction — so the session keeps a
    pooled connection checked out and "idle in transaction" until something
    commits, rolls back or closes it. Rev's investigation pipeline then carried
    that connection across an up-to-25s model call, which is what exhausted the
    production pool. Standalone reads therefore end their own transaction and
    hand the connection straight back.
    """
    params = params or {}
    outer_transaction = _in_transaction(db)
    savepoint = None
    if outer_transaction:
        nested = getattr(db, "begin_nested", None)
        if callable(nested):
            try:
                savepoint = nested()
                savepoint.__enter__()
            except Exception:  # pragma: no cover - driver without savepoints
                savepoint = None
    try:
        result = db.execute(text(sql), params)
        rows = _as_rows(result)
    except Exception as exc:
        if savepoint is not None:
            try:
                savepoint.__exit__(type(exc), exc, exc.__traceback__)
            except Exception:  # pragma: no cover - defensive
                pass
        else:
            _rollback(db)
        logger.warning("rev_query_failed error_type=%s", type(exc).__name__)
        return [], "query_failed"

    if savepoint is not None:
        # Release each successful savepoint immediately. Returning from inside
        # the try block used to bypass the old try/except/else cleanup entirely.
        try:
            savepoint.__exit__(None, None, None)
        except Exception:  # pragma: no cover - defensive
            logger.warning("rev_query_savepoint_release_failed")
    elif not outer_transaction:
        # Return the connection to the pool between reads instead of holding it
        # idle-in-transaction for the rest of the investigation.
        _rollback(db)
    return rows, None


def read_row(db: Any, sql: str, params: dict | None = None) -> Any:
    """Fetch a single row, preserving positional access, and release the read.

    ``safe_query`` returns mappings, which do not support integer indexing, so
    callers that read a wide row by position need this instead. It applies the
    same connection discipline: a standalone read hands its connection straight
    back rather than idling in a transaction, while a caller-owned transaction
    is left intact.
    """
    outer_transaction = _in_transaction(db)
    try:
        return db.execute(text(sql), params or {}).fetchone()
    except Exception as exc:
        logger.warning("rev_read_row_failed error_type=%s", type(exc).__name__)
        return None
    finally:
        if not outer_transaction:
            _rollback(db)


def release_read_transaction(db: Any) -> bool:
    """End any open read transaction so the connection returns to the pool.

    Called immediately before long blocking work (model generation, stream
    delivery) to enforce the invariant that no database transaction is open
    while Rev waits on a provider. Returns True when a transaction was open and
    had to be released — that is a leak worth logging, because it means some
    caller held a connection across work it should not have.
    """
    if not _in_transaction(db):
        return False
    _rollback(db)
    return True


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
