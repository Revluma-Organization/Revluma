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


def safe_query(db: Any, sql: str, params: dict | None = None, *, statement_timeout_ms: int = 10000) -> tuple[list, str | None]:
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
        dialect = getattr(getattr(db, "bind", None), "dialect", None)
        if getattr(dialect, "name", None) == "postgresql":
            db.execute(text("SELECT set_config('statement_timeout', :timeout_ms, true)"),
                       {"timeout_ms": str(max(100, min(int(statement_timeout_ms), 10000)))})
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
        pgcode = getattr(getattr(exc, "orig", None), "pgcode", None)
        timed_out = isinstance(exc, TimeoutError) or "timeout" in type(exc).__name__.lower() or pgcode == "57014"
        logger.warning("rev_query_failed error_type=%s timed_out=%s", type(exc).__name__, timed_out)
        return [], "query_timeout" if timed_out else "query_failed"

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


def begin_read_scope(db: Any) -> Any:
    """Begin one transaction so a *group* of reads shares a single connection.

    ``safe_query`` and ``read_row`` deliberately end their own transaction when
    no outer transaction exists, which returns the connection to the pool after
    every statement. That is correct for a lone read on the investigation hot
    path, and it is wrong for a multi-stage job.

    Behind a transaction-pooling proxy each of those short transactions is pinned
    to a *different* server backend, and the backend stays ``idle in transaction``
    waiting on ``ClientRead`` until it is reset. Production evidence on
    2026-11-03 showed a single Business State build occupying twelve server
    backends at once - one per read stage, transactions opened roughly one second
    apart, each holding exactly one statement:

        SELECT id, last_synced_at FROM stores ...
        SELECT to_regclass('public.business_state_baselines') ...
        SELECT COUNT(*) FROM events ...
        ...
        UPDATE business_states SET is_current = FALSE ...

    Twelve is the Python pool ceiling (pool_size 8 + max_overflow 4), so the
    build exhausted its own pool before it could persist, and surfaced as
    ``QueuePool limit of size 8 overflow 4 reached, timeout 30.00``.

    Opening one outer transaction makes ``_in_transaction`` true for every read
    inside the scope, so the helpers take their existing savepoint path instead:
    a failing stage is still isolated, but the whole group shares one connection.

    Returns a transaction handle to pass to :func:`end_read_scope`, or ``None``
    when the caller already owns a transaction or the session cannot begin one.
    A ``None`` return is not an error - it means "nothing to manage".
    """
    if _in_transaction(db):
        return None

    begin = getattr(db, "begin", None)
    if not callable(begin):
        return None

    try:
        return begin()
    except Exception:
        # Falling back to today's per-read behaviour is always safe; failing the
        # caller's job over an optimisation is not.
        logger.warning("rev_read_scope_begin_failed")
        return None


def end_read_scope(db: Any, scope: Any) -> bool:
    """Release a scope opened by :func:`begin_read_scope`.

    Reads need no commit, so the scope is rolled back: that releases the single
    connection it pinned and guarantees no write is left behind for a later
    transaction to inherit. Always safe to call, including with ``None``.
    """
    if scope is None:
        return False

    try:
        rollback = getattr(scope, "rollback", None)
        if callable(rollback):
            rollback()
        else:
            _rollback(db)
        return True
    except Exception:
        logger.warning("rev_read_scope_release_failed")
        _rollback(db)
        return False


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
