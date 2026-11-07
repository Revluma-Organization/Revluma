"""
Rev Intelligence — Business State Builder
Queries real commerce data for an organization and computes a structured
BusinessState that every specialist agent reads from. No agent queries the
database directly during a conversation — they all reason from this object.

Rebuilt every 15 minutes by the scheduler. On-demand rebuild triggered by
the Orchestrator when the state is stale.

Pipeline:
    build_business_state(org_id, db)
        → query orders, customers, carts, sequences
        → compute metrics, signals, opportunities, risks
        → write to business_states table (set old is_current=FALSE, insert new)
        → return BusinessState
"""

from __future__ import annotations

import json
import logging
import os
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import bindparam, create_engine, text
from sqlalchemy.pool import NullPool

from src.config.settings import settings
from src.intelligence.query import (
    _in_transaction,
    begin_read_scope,
    end_read_scope,
    read_row,
)

logger = logging.getLogger("rev.business_state")

# Persistence transport.
#
# This environment's connection pooler (Supavisor in transaction mode) does not
# pin one server backend to one client transaction: instrumented production
# evidence (2026-11-06, pid_before=1545467 vs pid_after_insert=1539098) showed a
# client-side transaction leaving the transaction between statements, so
# statements landed on arbitrary backends and no client transaction was ever
# reliable. The only dependable unit of atomicity here is a single statement,
# which auto-commits on whatever backend executes it.
#
# Every persistence statement - and the diagnostic reads - therefore goes
# through a dedicated NullPool engine in autocommit mode. Each statement is its
# own implicit transaction, identical in effect locally and behind the pooler.
# The caller's session is still accepted so local tests and development keep
# working without a configured database URL.
_PERSIST_ENGINE = None
_PERSIST_ENGINE_READY = False


def _persistence_engine():
    global _PERSIST_ENGINE, _PERSIST_ENGINE_READY
    if _PERSIST_ENGINE_READY:
        return _PERSIST_ENGINE
    _PERSIST_ENGINE_READY = True
    url = (
        os.environ.get("REVLUMA_PERSISTENCE_DATABASE_URL")
        or getattr(settings, "DATABASE_URL", "")
        or ""
    )
    if not url.strip() or "placeholder" in url:
        logger.warning("business_state_persistence_engine_unavailable")
        _PERSIST_ENGINE = None
        return None
    try:
        _PERSIST_ENGINE = create_engine(
            url,
            poolclass=NullPool,
            isolation_level="autocommit",
            pool_pre_ping=True,
        )
    except Exception:  # pragma: no cover - defensive
        logger.exception("business_state_persistence_engine_create_failed")
        _PERSIST_ENGINE = None
    return _PERSIST_ENGINE


def _persist_execute(db, sql: str, params: dict | None = None, *, scalar: bool = False):
    """Execute one persistence statement as its own implicit transaction.

    Falls back to the caller's session (committing explicitly) when no
    persistence URL is configured, keeping local unit tests hermetic.
    """
    engine = _persistence_engine()
    if engine is not None:
        try:
            with engine.connect() as conn:
                result = conn.execute(text(sql), params or {})
                return result.scalar() if scalar else result.rowcount
        except Exception:
            logger.warning("business_state_persistence_step_failed")
            raise
    result = db.execute(text(sql), params or {})
    if scalar:
        return result.scalar()
    db.commit()
    return int(getattr(result, "rowcount", 0) or 0)


# Daily revenue drives anomaly detection and the morning briefing, so it must use
# the same semantics as every other revenue surface: `orders.total` is net of
# refunds and cancelled orders never contribute. Extracted so the filter is
# directly testable.
DAILY_REVENUE_SQL = """
    SELECT
        DATE(ordered_at AT TIME ZONE 'UTC') as order_date,
        COALESCE(NULLIF(currency, ''), 'UNKNOWN') as order_currency,
        SUM(total) as daily_revenue,
        COUNT(*) as order_count,
        AVG(total) as avg_order_value
    FROM orders
    WHERE store_id IN :store_ids
      AND ordered_at >= :cutoff
      AND (recovery_status IS NULL OR recovery_status NOT IN
           ('cancelled', 'canceled', 'voided', 'deleted'))
    GROUP BY DATE(ordered_at AT TIME ZONE 'UTC'),
             COALESCE(NULLIF(currency, ''), 'UNKNOWN')
    ORDER BY order_date DESC
"""

def daily_revenue_scalars(rows, *, today, yesterday, seven_days_ago,
                          fourteen_days_ago) -> dict:
    """Reduce ``DAILY_REVENUE_SQL`` rows to scalar revenue metrics.

    Currency-safe by construction (Task 198): rows are grouped by currency
    and a scalar is only produced when exactly one currency is present.
    Multiple currencies are never summed into one number — the scalars come
    back ``None`` with ``multi_currency`` set, and the caller degrades to a
    partial snapshot with an explicit warning.

    Row shape: (order_date, order_currency, daily_revenue, order_count,
    avg_order_value).
    """
    by_currency: dict[str, dict[str, dict]] = {}
    for row in rows:
        currency = str(row[1]).upper() if row[1] else "UNKNOWN"
        by_currency.setdefault(currency, {})[str(row[0])] = {
            "revenue": Decimal(str(row[2])),
            "orders": row[3],
            "aov": Decimal(str(row[4])),
        }
    currencies = sorted(by_currency)
    result = {
        "currency": currencies[0] if len(currencies) == 1 else None,
        "currencies": currencies,
        "multi_currency": len(currencies) > 1,
        "daily": by_currency.get(currencies[0], {}) if len(currencies) == 1 else {},
        "revenue_today": None,
        "revenue_yesterday": None,
        "revenue_delta_pct": None,
        "revenue_trend_7d": None,
    }
    if len(currencies) > 1:
        return result

    # Single currency (or no orders): the scalar is safe. An empty order set
    # records zero, matching the previous behaviour.
    daily = result["daily"]
    revenue_today = daily.get(str(today), {}).get("revenue", Decimal("0"))
    revenue_yesterday = daily.get(str(yesterday), {}).get("revenue", Decimal("0"))
    revenue_delta_pct = None
    revenue_trend_7d = None
    if revenue_yesterday and revenue_yesterday > 0:
        revenue_delta_pct = float((revenue_today - revenue_yesterday) / revenue_yesterday * 100)
    # 7d trend: compare last 7 days vs prior 7 days
    recent_7d = sum(v["revenue"] for k, v in daily.items() if str(seven_days_ago) <= k <= str(today))
    prior_7d = sum(v["revenue"] for k, v in daily.items() if str(fourteen_days_ago) <= k < str(seven_days_ago))
    if prior_7d and prior_7d > 0:
        revenue_trend_7d = float((recent_7d - prior_7d) / prior_7d * 100)
    result.update({
        "revenue_today": revenue_today,
        "revenue_yesterday": revenue_yesterday,
        "revenue_delta_pct": revenue_delta_pct,
        "revenue_trend_7d": revenue_trend_7d,
    })
    return result


SCHEMA_VERSION = "1.1"
DEFAULT_STALENESS_MINS = 30

def _int_setting(name: str, default: int, *, minimum: int = 0) -> int:
    """Read an integer setting, falling back on garbage instead of crashing.

    These are evaluated at import time, so a malformed value must never stop
    the service from booting.
    """
    raw = (os.environ.get(name) or "").strip()
    try:
        value = int(raw) if raw else default
    except ValueError:
        return default
    return value if value >= minimum else default


# Snapshot retention. Superseded snapshots are near-write-only history: the
# observed-change reader caps at 48 rows per organization, so a generous window
# preserves every query that exists today while bounding the table. Without
# retention the production table reached 33,717 rows / 33 MB in five days, of
# which only 5 were still current.
#
# The observed-change reader caps at 48 snapshots, so never retain fewer.
SNAPSHOT_HISTORY_RETENTION = _int_setting(
    "REV_BUSINESS_STATE_HISTORY_RETENTION", 200, minimum=48
)
SNAPSHOT_PRUNE_BATCH = _int_setting("REV_BUSINESS_STATE_PRUNE_BATCH", 500, minimum=1)
VIP_INACTIVE_DAYS = 45
LTV_THRESHOLDS = (100.0, 500.0, 1000.0, 2500.0)
LTV_APPROACH_BAND = 0.15
CUSTOMER_CONTEXT_LIMIT = 500


def _store_query(statement: str):
    """Build a statement with a safely expanding store ID parameter."""
    return text(statement).bindparams(bindparam("store_ids", expanding=True))


class BusinessStateBuildInProgress(RuntimeError):
    """Raised when another worker is already building this organization's state."""


class BusinessStateLockUnavailable(RuntimeError):
    """Raised when the shared lock service is unavailable; rebuilds fail closed."""


class BusinessStatePersistenceError(RuntimeError):
    """Raised when a new business-state snapshot could not be persisted."""


#: A new snapshot was computed and persisted by this call.
OUTCOME_REBUILT = "rebuilt"

#: Another build held the lock, so the previous snapshot was returned instead.
#: Callers must not record this as a successful rebuild.
OUTCOME_DUPLICATE_SKIPPED = "duplicate_skipped"


#: The per-organization build lease lives in Postgres, in the same table the
#: Node scheduler already uses for its own distributed lock. One coordination
#: primitive, one dependency, and the TTL is enforced by SQL rather than by a
#: second datastore that can disagree with the database.
BUILD_LOCK_TABLE = "automation_job_state"

#: Lease length for a build. Long enough to cover a slow build, short enough
#: that a process killed mid-build stops blocking its organization promptly.
DEFAULT_BUILD_LOCK_TTL_SECONDS = 600




def _build_lock_ttl_seconds() -> int:
    """Read the lease TTL, falling back on garbage rather than failing closed."""
    raw = (os.environ.get("BUSINESS_STATE_LOCK_TTL_SECONDS") or "").strip()
    if not raw:
        return DEFAULT_BUILD_LOCK_TTL_SECONDS
    try:
        value = int(raw)
    except ValueError:
        return DEFAULT_BUILD_LOCK_TTL_SECONDS
    # A lease shorter than the build itself would let two builds overlap.
    return value if value >= 30 else DEFAULT_BUILD_LOCK_TTL_SECONDS


def _build_lock_job_name(organization_id: str) -> str:
    """Namespace the lease so it can never collide with a scheduler job row."""
    return f"business-state-build:{organization_id}"


def _acquire_business_state_lock(organization_id: str, db):
    """Claim an organization-scoped build lease in Postgres.

    Returns ``(job_name, token)`` when the lease was claimed, or ``None`` when
    another build already holds it. Raises :class:`BusinessStateLockUnavailable`
    when the claim itself could not be made, so rebuilds fail closed rather than
    running uncoordinated.

    The claim is a single atomic statement: the row is inserted, or updated only
    when the current holder's lease has expired. That makes a lease left behind
    by a killed process self-healing after its TTL, which a lease that can only
    be released by its owner is not.

    This replaces a Redis ``SET NX EX`` lease. Two properties of that lease
    failed in production: release required a Lua ``EVAL``, which the managed
    Redis in use does not support, so a lease was never released by its owner;
    and once stuck it blocked that organization's rebuilds indefinitely, which
    is why ``business_states.generated_at`` stayed frozen while every pass
    reported a duplicate-build skip.
    """
    job_name = _build_lock_job_name(organization_id)
    token = uuid.uuid4().hex
    ttl = _build_lock_ttl_seconds()

    try:
        row = db.execute(
            text(f"""
                INSERT INTO {BUILD_LOCK_TABLE}
                    (job_name, status, last_started_at, last_result, updated_at)
                VALUES
                    (:job_name, 'running', now(),
                     jsonb_build_object('lock_token', :token), now())
                ON CONFLICT (job_name) DO UPDATE
                    SET status = 'running',
                        last_started_at = now(),
                        last_result = jsonb_build_object('lock_token', :token),
                        updated_at = now()
                    WHERE {BUILD_LOCK_TABLE}.status IS DISTINCT FROM 'running'
                       OR {BUILD_LOCK_TABLE}.last_started_at IS NULL
                       OR {BUILD_LOCK_TABLE}.last_started_at
                          < now() - make_interval(secs => :ttl)
                RETURNING last_result ->> 'lock_token' AS lock_token
            """),
            {"job_name": job_name, "token": token, "ttl": ttl},
        ).fetchone()
        # Commit so other instances see the claim immediately. Holding it in an
        # uncommitted transaction would let a second builder claim it too.
        db.commit()
    except Exception:
        try:
            db.rollback()
        except Exception:  # pragma: no cover - defensive
            logger.exception("business_state_lock_rollback_failed")
        logger.exception(
            "business_state_lock_unavailable",
            extra={"reason": "db_lock_claim_failed", "org_id": organization_id},
        )
        raise BusinessStateLockUnavailable(
            "The shared build lock could not be claimed."
        )

    if row is None:
        return None

    claimed = str(row[0] or "")
    if claimed != token:  # pragma: no cover - another writer won the race
        return None

    return job_name, token


def _release_business_state_lock(
    lock,
    db,
    *,
    outcome: str | None = None,
    state_id: str | None = None,
    computation_status: str | None = None,
    duration_ms: int | None = None,
    error: str | None = None,
) -> None:
    """Release only the lease this worker owns.

    Token-matched, so a worker whose lease already expired and was re-claimed
    by another builder can never release the new holder's lease. A failure here
    is logged and swallowed: the lease expires on its own TTL, and turning
    cleanup into a build failure would be worse than waiting it out.
    """
    if lock is None:
        return

    try:
        job_name, token = lock
    except (TypeError, ValueError):  # pragma: no cover - defensive
        logger.error("business_state_lock_release_invalid_handle")
        return

    try:
        # The release doubles as the build's own report card. The orchestrator
        # path wraps this build in `except Exception: logger.error(...)`, so a
        # persistence failure there is swallowed and leaves no trace anywhere an
        # operator - or an engineer without access to the application logs - can
        # see. Production showed exactly that: a lease held for 134 seconds and
        # released cleanly with an empty error, while no snapshot was written.
        # Recording the outcome, the state id and the exception here makes the
        # failure readable straight from SQL.
        db.execute(
            text(f"""
                UPDATE {BUILD_LOCK_TABLE}
                   SET status = 'idle',
                       last_result = (COALESCE(last_result, '{{}}'::jsonb) - 'lock_token')
                                     || jsonb_strip_nulls(jsonb_build_object(
                                            'outcome', :outcome,
                                            'state_id', :state_id,
                                            'computation_status', :computation_status,
                                            'duration_ms', :duration_ms
                                        )),
                       last_error = :error,
                       last_completed_at = now(),
                       updated_at = now()
                 WHERE job_name = :job_name
                   AND last_result ->> 'lock_token' = :token
            """),
            {
                "job_name": job_name,
                "token": token,
                "outcome": outcome,
                "state_id": state_id,
                "computation_status": computation_status,
                "duration_ms": duration_ms,
                "error": error,
            },
        )
        db.commit()
        logger.info(
            "business_state_lock_released",
            extra={
                "lock_key": job_name,
                "outcome": outcome,
                "duration_ms": duration_ms,
                "error": error,
            },
        )
    except Exception:
        try:
            db.rollback()
        except Exception:  # pragma: no cover - defensive
            pass
        logger.exception("business_state_lock_release_failed")


def _table_exists(db, table_name: str) -> bool:
    """Allow Python to deploy before the matching backend migration is applied."""
    return bool(
        db.execute(
            text("SELECT to_regclass(:table_name) IS NOT NULL"),
            {"table_name": f"public.{table_name}"},
        ).scalar()
    )


def _rollback_quietly(db) -> None:
    try:
        db.rollback()
    except Exception:
        logger.exception("business_state_rollback_failed")


def _compensate_failed_build(db, organization_id: str, state_id: str) -> None:
    """Best-effort cleanup for a persistence attempt that failed.

    The persistence path is a sequence of single statements (no enclosing
    transaction behind the production pooler), so an attempt that fails can
    leave this attempt's rows behind. Every statement here is single and
    self-contained; each is executed in a nested try so a cleanup failure
    never masks the original error. Deleting this attempt's alerts and its
    inactive snapshot restores the same externally visible state as if the
    attempt never ran: the previous current snapshot (if any) is untouched,
    no dependent rows survive, and no orphaned snapshot lingers.
    """
    try:
        _persist_execute(
            db,
            "DELETE FROM alert_queue WHERE business_state_id = :state_id",
            {"state_id": state_id},
        )
    except Exception:
        logger.exception(
            "business_state_cleanup_alerts_failed", extra={"org_id": organization_id}
        )
    try:
        _persist_execute(
            db,
            "DELETE FROM business_states WHERE id = :state_id AND NOT is_current",
            {"state_id": state_id},
        )
    except Exception:
        logger.exception(
            "business_state_cleanup_snapshot_failed", extra={"org_id": organization_id}
        )


def prune_superseded_snapshots(
    db,
    organization_id: str,
    *,
    keep: int = SNAPSHOT_HISTORY_RETENTION,
    batch: int = SNAPSHOT_PRUNE_BATCH,
) -> int:
    """Delete superseded snapshots beyond the retained history window.

    Only ``is_current = FALSE`` rows for this organization are eligible, so the
    live snapshot can never be removed. The delete is batched so a large
    backlog drains gradually across rebuilds instead of one long-running
    statement that holds locks and blows the request budget.

    Retention is housekeeping: a failure here is logged and swallowed so it can
    never turn a successful Business State build into a reported failure.
    Returns the number of rows deleted.
    """
    keep = max(48, int(keep))
    batch = max(1, int(batch))
    try:
        result = db.execute(
            text("""
                DELETE FROM business_states
                WHERE id IN (
                    SELECT id
                    FROM business_states
                    WHERE organization_id = :org_id
                      AND is_current = FALSE
                      AND id NOT IN (
                          SELECT retained.id
                          FROM business_states retained
                          WHERE retained.organization_id = :org_id
                            AND retained.is_current = FALSE
                          ORDER BY retained.generated_at DESC, retained.id DESC
                          LIMIT :keep
                      )
                    LIMIT :batch
                )
            """),
            {"org_id": organization_id, "keep": keep, "batch": batch},
        )
        deleted = int(getattr(result, "rowcount", 0) or 0)
        db.commit()
        if deleted:
            logger.info(
                "business_state_snapshots_pruned",
                extra={
                    "org_id": organization_id,
                    "deleted": deleted,
                    "retained": keep,
                    "batch": batch,
                },
            )
        return deleted
    except Exception as exc:
        _rollback_quietly(db)
        logger.warning(
            "business_state_prune_failed",
            extra={"org_id": organization_id, "error_type": type(exc).__name__},
        )
        return 0


def _json_value(value: Any, default: Any) -> Any:
    if value is None:
        return default
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (TypeError, ValueError):
            return default
    return value


def _load_customer_ml_signals(db, store_params: dict[str, Any]) -> dict[str, Any]:
    """Build the bounded, PII-free customer context used by specialist agents."""
    threshold_rows = ", ".join(
        f"(:ltv_{index})" for index in range(len(LTV_THRESHOLDS))
    )
    statement = _store_query(f"""
        WITH customer_activity AS (
            SELECT
                c.id AS customer_id,
                c.rfm_segment,
                COALESCE(c.orders_count, 0) AS past_orders_total,
                -- A stored LTV is money only when a single currency is
                -- verified for it. Mixed or unlabelled values stay NULL so
                -- threshold comparisons cannot treat them as one currency.
                CASE
                    WHEN c.ltv_mixed_currency = TRUE THEN NULL
                    WHEN c.ltv_currency IS NULL THEN NULL
                    ELSE COALESCE(c.ltv, 0)
                END AS ltv,
                CASE
                    WHEN c.ltv_mixed_currency = TRUE THEN NULL
                    WHEN c.ltv_currency IS NULL THEN NULL
                    ELSE GREATEST(
                        COALESCE(c.ltv, 0) - COALESCE(latest.total, 0),
                        0
                    )
                END AS previous_ltv,
                CASE
                    WHEN c.ltv_mixed_currency = TRUE THEN NULL
                    ELSE c.ltv_currency
                END AS ltv_currency,
                CASE
                    WHEN latest.ordered_at IS NULL THEN NULL
                    ELSE FLOOR(
                        EXTRACT(EPOCH FROM (NOW() - latest.ordered_at)) / 86400
                    )::integer
                END AS days_inactive
            FROM customers c
            LEFT JOIN LATERAL (
                SELECT o.total, o.ordered_at
                FROM orders o
                WHERE o.customer_id = c.id
                  AND o.store_id = c.store_id
                ORDER BY o.ordered_at DESC, o.id DESC
                LIMIT 1
            ) latest ON TRUE
            WHERE c.store_id IN :store_ids
              AND c.status = 'active'
        )
        SELECT
            customer_id,
            rfm_segment,
            past_orders_total,
            ltv,
            previous_ltv,
            ltv_currency,
            days_inactive
        FROM customer_activity activity
        WHERE (
            activity.rfm_segment = 'champion'
            AND activity.days_inactive >= :vip_days
        )
        OR activity.past_orders_total = 1
        OR EXISTS (
            SELECT 1
            FROM (VALUES {threshold_rows}) AS thresholds(value)
            WHERE (
                activity.ltv >= thresholds.value * :approach_floor
                AND activity.ltv < thresholds.value
            )
            OR (
                activity.previous_ltv < thresholds.value
                AND activity.ltv >= thresholds.value
            )
        )
        ORDER BY
            CASE
                WHEN activity.rfm_segment = 'champion'
                     AND activity.days_inactive >= :vip_days THEN 0
                WHEN activity.past_orders_total = 1 THEN 1
                ELSE 2
            END,
            activity.ltv DESC,
            activity.customer_id
        LIMIT :context_limit
    """)
    params = {
        **store_params,
        "vip_days": VIP_INACTIVE_DAYS,
        "approach_floor": 1 - LTV_APPROACH_BAND,
        "context_limit": CUSTOMER_CONTEXT_LIMIT,
        **{
            f"ltv_{index}": threshold
            for index, threshold in enumerate(LTV_THRESHOLDS)
        },
    }
    rows = db.execute(statement, params).mappings().all()
    customers = [
        {
            "customer_id": str(row["customer_id"]),
            "rfm_segment": row["rfm_segment"],
            "past_orders_total": int(row["past_orders_total"] or 0),
            # None means "not verified in one currency", not zero.
            "ltv": float(row["ltv"]) if row["ltv"] is not None else None,
            "previous_ltv": (
                float(row["previous_ltv"]) if row["previous_ltv"] is not None else None
            ),
            "ltv_currency": row.get("ltv_currency") if hasattr(row, "get") else None,
            "days_inactive": (
                int(row["days_inactive"])
                if row["days_inactive"] is not None
                else None
            ),
        }
        for row in rows
    ]
    return {
        "customers": customers,
        "limit": CUSTOMER_CONTEXT_LIMIT,
        "truncated": len(customers) == CUSTOMER_CONTEXT_LIMIT,
    }


def load_business_change_history(organization_id: str, db, *, limit: int = 24) -> dict:
    """Read bounded historical snapshots for the authenticated merchant only.

    This is observed change history, not a causal explanation. We compare
    snapshot values, not aggregate repeated snapshots into fictitious revenue.
    """
    safe_limit = max(1, min(int(limit), 48))
    rows = db.execute(text("""
        SELECT id, generated_at, revenue_today, abandoned_cart_count,
               churn_risk_count, computation_status
        FROM business_states
        WHERE organization_id = :org_id
          AND computation_status IN ('complete', 'partial')
        ORDER BY generated_at DESC, id DESC
        LIMIT :history_limit
    """), {"org_id": organization_id, "history_limit": safe_limit}).mappings().all()
    snapshots = [
        {
            "snapshot_id": str(row["id"]),
            "generated_at": row["generated_at"].isoformat(),
            "revenue_today": float(row["revenue_today"]) if row["revenue_today"] is not None else None,
            "abandoned_cart_count": row["abandoned_cart_count"],
            "churn_risk_count": row["churn_risk_count"],
            "computation_status": row["computation_status"],
        }
        for row in rows
    ]
    changes = []
    for recent, earlier in zip(snapshots, snapshots[1:]):
        for metric in ("revenue_today", "abandoned_cart_count", "churn_risk_count"):
            current, previous = recent[metric], earlier[metric]
            if current is None or previous is None or current == previous:
                continue
            changes.append({
                "metric": metric,
                "from": previous,
                "to": current,
                "delta": round(current - previous, 2),
                "observed_at": recent["generated_at"],
                "comparison_snapshot_at": earlier["generated_at"],
                "causality": "unverified",
            })
    return {
        "organization_id": organization_id,
        "snapshots": snapshots,
        "observed_changes": changes[:48],
        "history_limit": safe_limit,
        "truncated": len(snapshots) == safe_limit,
        "interpretation": "Snapshot-to-snapshot observations; not independent daily totals or verified causes.",
    }


# ── BusinessState dataclass 

@dataclass
class BusinessState:
    # Identity
    id: str
    organization_id: str
    schema_version: str
    generated_at: datetime
    data_freshness_at: datetime | None
    staleness_threshold_mins: int
    computation_status: str          # complete | partial | failed
    warnings: list[str]

    # Structured metric columns (fast queries)
    revenue_today: Decimal | None
    revenue_yesterday: Decimal | None
    revenue_delta_pct: float | None
    revenue_trend_7d: float | None
    revenue_anomaly: bool
    abandoned_cart_count: int | None
    abandoned_cart_value: Decimal | None
    cart_anomaly: bool
    churn_risk_count: int | None
    vip_inactive_count: int | None
    returning_customer_rate: float | None
    returning_customer_rate_delta: float | None

    # JSONB intelligence payloads
    opportunities: list[dict]
    risks: list[dict]
    anomalies: list[dict]
    trends: list[dict]
    ml_signals: dict
    inventory_signals: dict
    anomaly_severity: str
    root_causes: list[str]
    current_event_rate: float
    baseline_event_rate: float
    next_rebuild_at: datetime
    cart_delta_pct_vs_avg: float | None = None
    observed_drivers: list[dict] = field(default_factory=list)
    # The currency of the scalar revenue metrics. None means either "no
    # orders recorded" or "multiple currencies — scalar suppressed" (see
    # warnings). Never assume USD.
    revenue_currency: str | None = None

    def is_stale(self) -> bool:
        age_secs = (datetime.now(timezone.utc) - self.generated_at).total_seconds()
        return age_secs > self.staleness_threshold_mins * 60

    def age_minutes(self) -> float:
        return (datetime.now(timezone.utc) - self.generated_at).total_seconds() / 60

    def reliability(self) -> dict:
        """Explain how much of the merchant snapshot can be trusted.

        Confidence is a completeness/freshness indicator, not a probability
        that any individual recommendation is correct.
        """
        now = datetime.now(timezone.utc)
        generated = self.generated_at
        if generated.tzinfo is None:
            generated = generated.replace(tzinfo=timezone.utc)
        age_minutes = max(0.0, (now - generated).total_seconds() / 60)
        source_at = self.data_freshness_at
        if source_at is not None and source_at.tzinfo is None:
            source_at = source_at.replace(tzinfo=timezone.utc)
        source_age_minutes = (
            max(0.0, (now - source_at).total_seconds() / 60)
            if source_at is not None else None
        )
        stale = age_minutes > self.staleness_threshold_mins
        if self.computation_status == "failed":
            level = "unavailable"
        elif self.computation_status != "complete" or self.warnings or stale:
            level = "limited"
        elif source_age_minutes is None:
            level = "unknown"
        elif source_age_minutes > self.staleness_threshold_mins:
            level = "limited"
        else:
            level = "high"
        return {
            "level": level,
            "meaning": "Data completeness and freshness; not prediction accuracy.",
            "snapshot_age_minutes": round(age_minutes, 1),
            "source_age_minutes": round(source_age_minutes, 1) if source_age_minutes is not None else None,
            "snapshot_stale": stale,
            "source_freshness_known": source_age_minutes is not None,
            "computation_status": self.computation_status,
            "warnings": list(self.warnings),
        }

    def to_dict(self) -> dict:
        revenue_today = float(self.revenue_today) if self.revenue_today is not None else None
        revenue_yesterday = (
            float(self.revenue_yesterday) if self.revenue_yesterday is not None else None
        )
        abandoned_cart_value = (
            float(self.abandoned_cart_value)
            if self.abandoned_cart_value is not None
            else None
        )
        revenue_severity = "low"
        if self.revenue_anomaly:
            revenue_severity = (
                "high" if abs(self.revenue_delta_pct or 0.0) >= 30 else "med"
            )

        state = {
            "id": self.id,
            "organization_id": self.organization_id,
            "schema_version": self.schema_version,
            "generated_at": self.generated_at.isoformat(),
            "data_freshness_at": self.data_freshness_at.isoformat() if self.data_freshness_at else None,
            "staleness_threshold_mins": self.staleness_threshold_mins,
            "computation_status": self.computation_status,
            "warnings": self.warnings,
            "reliability": self.reliability(),
            "next_rebuild_at": self.next_rebuild_at.isoformat(),
            "sales_health": {
                "revenue_today": revenue_today,
                "revenue_yesterday": revenue_yesterday,
                "revenue_delta_pct": self.revenue_delta_pct,
                "revenue_trend_7d": self.revenue_trend_7d,
                "revenue_anomaly": self.revenue_anomaly,
                "abandoned_cart_count": self.abandoned_cart_count,
                "abandoned_cart_value": abandoned_cart_value,
                "cart_anomaly": self.cart_anomaly,
            },
            "customer_health": {
                "churn_risk_count": self.churn_risk_count,
                "vip_inactive_count": self.vip_inactive_count,
                "returning_customer_rate": self.returning_customer_rate,
                "returning_customer_rate_delta": self.returning_customer_rate_delta,
            },
            "inventory_health": self.inventory_signals,
            "anomaly_summary": {
                "severity": self.anomaly_severity,
                "items": self.anomalies,
                "root_causes": self.root_causes,
                "observed_drivers": self.observed_drivers,
                "root_cause_verification": "not_established",
            },
            "traffic": {
                "current_event_rate_5m": self.current_event_rate,
                "baseline_event_rate_5m_30d": self.baseline_event_rate,
            },
            "opportunities": self.opportunities,
            "risks": self.risks,
            "trends": self.trends,
            "ml_signals": self.ml_signals,
            # Stable business-state contract. Existing keys below remain for
            # consumers that adopted the richer 1.1 representation.
            "snapshot_at": self.generated_at.isoformat(),
            "merchant_id": self.organization_id,
            "revenue": {
                "today": revenue_today,
                "yesterday": revenue_yesterday,
                "delta_pct": self.revenue_delta_pct,
                "trend_7d": self.revenue_trend_7d,
                "anomaly": self.revenue_anomaly,
                "severity": revenue_severity,
            },
            "abandoned_carts": {
                "count": self.abandoned_cart_count,
                "value": abandoned_cart_value,
                "delta_pct_vs_avg": self.cart_delta_pct_vs_avg,
                "anomaly": self.cart_anomaly,
            },
            "customers": {
                "at_churn_risk": self.churn_risk_count,
                "vip_inactive_45d": self.vip_inactive_count,
                "returning_rate_delta": self.returning_customer_rate_delta,
            },
            "inventory": self.inventory_signals,
            "ml_outputs": self.ml_signals,
            "top_opportunities": self.opportunities,
            "active_concerns": self.risks,
        }

        # Boundary compatibility for consumers that still read the 1.0 flat keys.
        state.update({
            "revenue_today": revenue_today,
            "revenue_yesterday": revenue_yesterday,
            "revenue_delta_pct": self.revenue_delta_pct,
            "revenue_trend_7d": self.revenue_trend_7d,
            "revenue_anomaly": self.revenue_anomaly,
            "abandoned_cart_count": self.abandoned_cart_count,
            "abandoned_cart_value": abandoned_cart_value,
            "cart_anomaly": self.cart_anomaly,
            "churn_risk_count": self.churn_risk_count,
            "vip_inactive_count": self.vip_inactive_count,
            "returning_customer_rate": self.returning_customer_rate,
            "anomalies": self.anomalies,
        })
        return state


# ── Main builder 

def _build_business_state_unlocked(organization_id: str, db) -> BusinessState:
    """
    Builds a complete BusinessState for an organization from real database data.

    Resilient to partial failures: if one data source fails, the state is
    marked partial and the failed section is None with a warning. The old
    current state is never overwritten until the new one is fully computed.

    Args:
        organization_id: The organization's UUID string.
        db: SQLAlchemy connection or session.

    Returns:
        BusinessState. This internal worker assumes the shared Redis lock is
        already held by the public build_business_state wrapper.
    """
    state_id = str(uuid.uuid4())
    generated_at = datetime.now(timezone.utc)
    warnings: list[str] = []
    computation_status = "complete"

    # One transaction for the whole read phase, so the twelve source queries
    # share a single pooled connection instead of each pinning its own. Behind
    # Supavisor's transaction pooler a per-read transaction is assigned a
    # distinct server backend that stays idle-in-transaction until reset, and a
    # full build therefore consumed the entire 12-connection pool before it
    # reached persistence. See begin_read_scope for the production evidence.
    #
    # This is closed again before persistence so the persistence transaction,
    # The read scope holds no persistence lock; writes coordinate through the
    # application lease and serialize on the unique partial index.
    read_scope = begin_read_scope(db)

    # Read the current snapshot before the expensive source queries. No
    # persistence lock is open during the read phase.
    previous_state = load_current_business_state(organization_id, db)

    logger.info("business_state_build_start", extra={
        "org_id": organization_id,
        "state_id": state_id,
    })

    # ── 1. Get stores for this organization
    try:
        stores_result = db.execute(
            text("""
                SELECT id, last_synced_at
                FROM stores
                WHERE organization_id = :org_id
                  AND (status IN ('active', 'syncing', 'error') OR status = 'connected')
                ORDER BY last_synced_at DESC NULLS LAST
            """),
            {"org_id": organization_id},
        ).fetchall()
        store_ids = [str(r[0]) for r in stores_result]
        last_synced_at = stores_result[0][1] if stores_result else None
    except Exception as exc:
        logger.exception(
            "business_state_stores_failed",
            extra={"org_id": organization_id, "error_type": type(exc).__name__},
        )
        _rollback_quietly(db)
        store_ids = []
        last_synced_at = None
        warnings.append("Could not load store data.")

    if not store_ids:
        warnings.append("No connected stores found. Business metrics unavailable.")
        if previous_state:
            previous_state.warnings.extend(warnings)
            previous_state.computation_status = "partial"
            return previous_state
        return _empty_state(state_id, organization_id, generated_at, warnings)

    store_params = {"store_ids": tuple(store_ids)}

    baseline: dict[str, Any] = {}
    baseline_table_available = False
    try:
        baseline_table_available = _table_exists(db, "business_state_baselines")
        if baseline_table_available:
            baseline_row = db.execute(
                text("""
                    SELECT event_rate_5m_30d, revenue_avg_30d,
                           cart_abandonment_rate_30d,
                           returning_customer_rate_30d,
                           day_of_week_baseline, seasonal_baseline
                    FROM business_state_baselines
                    WHERE organization_id = :org_id
                    LIMIT 1
                """),
                {"org_id": organization_id},
            ).mappings().first()
            baseline = dict(baseline_row) if baseline_row else {}
    except Exception as exc:
        logger.exception(
            "business_state_baseline_load_failed",
            extra={"org_id": organization_id, "error_type": type(exc).__name__},
        )
        _rollback_quietly(db)
        baseline_table_available = False
        warnings.append("Historical anomaly baseline is temporarily unavailable.")
        computation_status = "partial"

    current_event_rate = 0.0
    try:
        event_count = db.execute(
            _store_query("""
                SELECT COUNT(*)
                FROM events
                WHERE store_id IN :store_ids
                  AND created_at >= NOW() - INTERVAL '5 minutes'
            """),
            store_params,
        ).scalar()
        current_event_rate = float(event_count or 0)
    except Exception as exc:
        logger.exception(
            "business_state_event_rate_failed",
            extra={"org_id": organization_id, "error_type": type(exc).__name__},
        )
        _rollback_quietly(db)
        warnings.append("Current event rate could not be computed.")
        computation_status = "partial"

    baseline_event_rate = float(baseline.get("event_rate_5m_30d") or 0)
    next_interval = _get_next_rebuild_interval(current_event_rate, baseline_event_rate)
    next_rebuild_at = generated_at + next_interval
    staleness_threshold_mins = max(1, int(next_interval.total_seconds() / 60))

    # ── 2. Revenue metrics
    revenue_today = None
    revenue_yesterday = None
    revenue_delta_pct = None
    revenue_trend_7d = None
    revenue_anomaly = False
    revenue_currency: str | None = None

    try:
        today = generated_at.date()
        yesterday = today - timedelta(days=1)
        seven_days_ago = today - timedelta(days=7)
        fourteen_days_ago = today - timedelta(days=14)

        rev_result = db.execute(
            _store_query(DAILY_REVENUE_SQL),
            {**store_params, "cutoff": fourteen_days_ago},
        ).fetchall()

        # Currency-safe scalars (Task 198): incompatible currencies are never
        # summed. A single-currency organization keeps the scalar revenue
        # metrics; a multi-currency one gets no scalar at all (explicit
        # warning) rather than a fabricated cross-currency total.
        scalars = daily_revenue_scalars(
            rev_result,
            today=today,
            yesterday=yesterday,
            seven_days_ago=seven_days_ago,
            fourteen_days_ago=fourteen_days_ago,
        )
        revenue_currency = scalars["currency"]
        if scalars["multi_currency"]:
            warnings.append(
                f"Orders in multiple currencies ({', '.join(scalars['currencies'])}) "
                "cannot be summed into one scalar; single-currency revenue metrics "
                "are suppressed. Use the currency-separated revenue evidence.")
            computation_status = "partial"
        revenue_today = scalars["revenue_today"]
        revenue_yesterday = scalars["revenue_yesterday"]
        revenue_delta_pct = scalars["revenue_delta_pct"]
        revenue_trend_7d = scalars["revenue_trend_7d"]
        daily = scalars["daily"]

        weekday_baselines = _json_value(baseline.get("day_of_week_baseline"), {})
        weekday_baseline = weekday_baselines.get(str(today.weekday()), {})
        expected_revenue = float(weekday_baseline.get("average_revenue") or 0)
        revenue_stddev = float(weekday_baseline.get("stddev_revenue") or 0)
        if revenue_today is None:
            # Multi-currency organizations carry no scalar; anomaly detection
            # on a scalar that does not exist is a fabrication.
            revenue_anomaly = False
        elif expected_revenue > 0:
            baseline_delta = abs(float(revenue_today) - expected_revenue)
            revenue_anomaly = (
                baseline_delta > 2 * revenue_stddev
                if revenue_stddev > 0
                else baseline_delta / expected_revenue > 0.30
            )
        elif revenue_delta_pct is not None:
            revenue_anomaly = revenue_delta_pct < -20 or revenue_delta_pct > 50

    except Exception as exc:
        logger.exception(
            "business_state_revenue_failed",
            extra={"org_id": organization_id, "error_type": type(exc).__name__},
        )
        _rollback_quietly(db)
        warnings.append("Revenue metrics could not be computed.")
        computation_status = "partial"

    # ── 3. Cart abandonment metrics 
    abandoned_cart_count = None
    abandoned_cart_value = None
    cart_anomaly = False
    cart_delta_pct_vs_avg = None

    try:
        cart_result = db.execute(
            _store_query("""
                WITH ranked AS (
                    SELECT store_id, cart_value,
                           ROW_NUMBER() OVER (
                               PARTITION BY store_id,
                                 COALESCE(NULLIF(external_cart_id, ''), id::text)
                               ORDER BY updated_at DESC NULLS LAST,
                                        created_at DESC NULLS LAST, id DESC
                           ) AS rn
                    FROM abandoned_carts
                    WHERE store_id IN :store_ids
                      AND status = 'abandoned' AND recovered_at IS NULL
                      AND abandoned_at >= NOW() - INTERVAL '48 hours'
                )
                SELECT COUNT(*) as abandoned_count,
                       COALESCE(SUM(cart_value), 0) as total_value
                FROM ranked WHERE rn = 1
            """),
            store_params,
        ).fetchone()

        abandoned_cart_count = int(cart_result[0])
        abandoned_cart_value = Decimal(str(cart_result[1]))

        average_abandonment_rate = baseline.get("cart_abandonment_rate_30d")
        if average_abandonment_rate is None:
            cart_rate_result = db.execute(
                _store_query("""
                    SELECT
                        COUNT(CASE WHEN status = 'abandoned' THEN 1 END) as abandoned,
                        COUNT(*) as total
                    FROM abandoned_carts
                    WHERE store_id IN :store_ids
                      AND abandoned_at >= NOW() - INTERVAL '30 days'
                """),
                store_params,
            ).fetchone()
            if cart_rate_result and cart_rate_result[1] > 0:
                average_abandonment_rate = cart_rate_result[0] / cart_rate_result[1]

        if average_abandonment_rate is not None:
            today_cart_result = db.execute(
                _store_query("""
                    SELECT
                        COUNT(CASE WHEN status = 'abandoned' THEN 1 END) as abandoned,
                        COUNT(*) as total
                    FROM abandoned_carts
                    WHERE store_id IN :store_ids
                      AND abandoned_at >= NOW() - INTERVAL '24 hours'
                """),
                store_params,
            ).fetchone()
            if today_cart_result and today_cart_result[1] > 0:
                today_rate = today_cart_result[0] / today_cart_result[1]
                baseline_rate = float(average_abandonment_rate)
                cart_anomaly = (today_rate - baseline_rate) > 0.10
                if baseline_rate > 0:
                    cart_delta_pct_vs_avg = round(
                        (today_rate - baseline_rate) / baseline_rate * 100,
                        2,
                    )

    except Exception as exc:
        logger.exception(
            "business_state_carts_failed",
            extra={"org_id": organization_id, "error_type": type(exc).__name__},
        )
        _rollback_quietly(db)
        warnings.append("Cart abandonment metrics could not be computed.")
        computation_status = "partial"

    # ── 4. Customer health metrics 
    churn_risk_count = None
    vip_inactive_count = None
    returning_customer_rate = None
    returning_customer_rate_delta = None
    customer_ml_signals = {
        "customers": [],
        "limit": CUSTOMER_CONTEXT_LIMIT,
        "truncated": False,
    }

    try:
        customer_result = db.execute(
            _store_query("""
                SELECT
                    COUNT(CASE WHEN c.rfm_segment IN ('at_risk', 'hibernating') THEN 1 END) as churn_risk,
                    COUNT(CASE WHEN c.rfm_segment = 'champion'
                                    AND latest.ordered_at < NOW() - (:vip_days * INTERVAL '1 day')
                               THEN 1 END) as vip_inactive,
                    COUNT(CASE WHEN c.orders_count > 1 THEN 1 END)::float /
                        NULLIF(COUNT(*), 0) as returning_rate
                FROM customers c
                LEFT JOIN LATERAL (
                    SELECT o.ordered_at
                    FROM orders o
                    WHERE o.customer_id = c.id
                      AND o.store_id = c.store_id
                    ORDER BY o.ordered_at DESC, o.id DESC
                    LIMIT 1
                ) latest ON TRUE
                WHERE c.store_id IN :store_ids
                  AND c.status = 'active'
            """),
            {**store_params, "vip_days": VIP_INACTIVE_DAYS},
        ).fetchone()

        if customer_result:
            churn_risk_count = int(customer_result[0])
            vip_inactive_count = int(customer_result[1])
            returning_customer_rate = float(customer_result[2]) if customer_result[2] else None
            baseline_returning_rate = baseline.get("returning_customer_rate_30d")
            if returning_customer_rate is not None and baseline_returning_rate is not None:
                returning_customer_rate_delta = round(
                    (returning_customer_rate - float(baseline_returning_rate)) * 100,
                    2,
                )

    except Exception as exc:
        logger.exception(
            "business_state_customers_failed",
            extra={"org_id": organization_id, "error_type": type(exc).__name__},
        )
        _rollback_quietly(db)
        warnings.append("Customer health metrics could not be computed.")
        computation_status = "partial"

    try:
        customer_ml_signals = _load_customer_ml_signals(db, store_params)
    except Exception as exc:
        logger.exception(
            "business_state_customer_context_failed",
            extra={"org_id": organization_id, "error_type": type(exc).__name__},
        )
        _rollback_quietly(db)
        warnings.append("Customer-level agent context could not be computed.")
        computation_status = "partial"

    # ── 5. Build opportunities list 
    opportunities: list[dict] = []

    try:
        # High-value unrecovered carts
        top_carts = db.execute(
            _store_query("""
                WITH ranked AS (
                    SELECT id, cart_value, abandoned_at,
                           ROW_NUMBER() OVER (
                               PARTITION BY store_id,
                                 COALESCE(NULLIF(external_cart_id, ''), id::text)
                               ORDER BY updated_at DESC NULLS LAST,
                                        created_at DESC NULLS LAST, id DESC
                           ) AS rn
                    FROM abandoned_carts
                    WHERE store_id IN :store_ids
                      AND status = 'abandoned' AND recovered_at IS NULL
                      AND abandoned_at >= NOW() - INTERVAL '24 hours'
                )
                SELECT id, cart_value, abandoned_at FROM ranked
                WHERE rn = 1 ORDER BY cart_value DESC LIMIT 5
            """),
            store_params,
        ).fetchall()

        for cart in top_carts:
            opportunities.append({
                "category": "cart_recovery",
                "description": f"Unrecovered cart worth ${float(cart[1]):.2f} abandoned {_time_ago(cart[2])}",
                "estimated_value": float(cart[1]),
                "urgency": "high" if float(cart[1]) > 100 else "medium",
                "action": "Trigger recovery sequence",
            })

        # Churn risk opportunity
        if churn_risk_count and churn_risk_count > 0:
            opportunities.append({
                "category": "churn_prevention",
                "description": f"{churn_risk_count} customers showing early churn signals",
                "estimated_value": None,
                "urgency": "high" if churn_risk_count > 10 else "medium",
                "action": "Launch win-back sequence",
            })

        # VIP re-engagement
        if vip_inactive_count and vip_inactive_count > 0:
            opportunities.append({
                "category": "retention",
                "description": f"{vip_inactive_count} VIP customers inactive for 45+ days",
                "estimated_value": None,
                "urgency": "medium",
                "action": "Send personalized re-engagement",
            })

    except Exception as exc:
        logger.exception(
            "business_state_opportunities_failed",
            extra={"org_id": organization_id, "error_type": type(exc).__name__},
        )
        _rollback_quietly(db)
        warnings.append("Business opportunities could not be computed.")
        computation_status = "partial"

    # ── 6. Build risks list 
    risks: list[dict] = []

    if revenue_anomaly and revenue_delta_pct is not None and revenue_delta_pct < -20:
        risks.append({
            "category": "revenue",
            "severity": "high",
            "description": f"Revenue dropped {abs(revenue_delta_pct):.1f}% vs yesterday",
            "metric": "revenue_delta_pct",
            "value": revenue_delta_pct,
        })

    if cart_anomaly:
        risks.append({
            "category": "cart_abandonment",
            "severity": "medium",
            "description": "Cart abandonment rate is significantly above 30-day average",
            "metric": "abandonment_rate",
        })

    # ── 7. Build anomalies and trends 
    anomalies: list[dict] = []
    trends: list[dict] = []
    # Anomalies are observations, not proven causes. Preserve evidence separately.
    root_causes: list[str] = []
    observed_drivers: list[dict] = []
    inventory_signals = {
        "status": "unavailable",
        "reason": "No inventory snapshot source is configured.",
    }

    if revenue_anomaly:
        anomalies.append({
            "metric": "revenue",
            "direction": "down" if (revenue_delta_pct or 0) < 0 else "up",
            "deviation": revenue_delta_pct,
            "period": "current day vs 30-day weekday baseline",
            "severity": "high" if abs(revenue_delta_pct or 0) >= 30 else "medium",
            "message": "Revenue is outside its expected weekday range.",
            "action_url": "/dashboard/rev-intell",
        })
        observed_drivers.append({"metric": "revenue_delta_pct", "observed_change_pct": revenue_delta_pct, "comparison": "current day vs 30-day weekday baseline", "causality": "unverified"})

    if cart_anomaly:
        anomalies.append({
            "metric": "cart_abandonment",
            "direction": "up",
            "deviation": None,
            "period": "24-hour vs 30-day baseline",
            "severity": "high",
            "message": "Cart abandonment is more than 10 percentage points above baseline.",
            "action_url": "/dashboard/cart-recovery",
        })
        observed_drivers.append({"metric": "cart_abandonment", "comparison": "24-hour vs 30-day baseline", "causality": "unverified"})

    if churn_risk_count is not None and churn_risk_count >= 10:
        anomalies.append({
            "metric": "churn_risk",
            "direction": "up",
            "deviation": churn_risk_count,
            "period": "current RFM population",
            "severity": "medium",
            "message": f"{churn_risk_count} customers are showing churn-risk signals.",
            "action_url": "/dashboard/customers",
        })
        observed_drivers.append({"metric": "churn_risk_count", "observed_count": churn_risk_count, "comparison": "current RFM population", "causality": "unverified"})

    if revenue_trend_7d is not None:
        trends.append({
            "metric": "revenue_7d",
            "direction": "up" if revenue_trend_7d > 0 else "down",
            "change_pct": revenue_trend_7d,
            "period": "7-day vs prior 7-day",
        })

    # ── 8. Write to database 
    severity_rank = {"normal": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}
    anomaly_severity = max(
        (item.get("severity", "low") for item in anomalies),
        key=lambda value: severity_rank.get(value, 0),
        default="normal",
    )
    source_data = {
        "current_event_rate_5m": current_event_rate,
        "baseline_event_rate_5m_30d": baseline_event_rate,
        "returning_customer_rate_delta": returning_customer_rate_delta,
        "cart_delta_pct_vs_avg": cart_delta_pct_vs_avg,
        "inventory_signals": inventory_signals,
    }
    state_metadata = {
        "warnings": warnings,
        "revenue_currency": revenue_currency,
        "anomaly_severity": anomaly_severity,
        "root_causes": root_causes,
        "observed_drivers": observed_drivers,
        "root_cause_verification": "not_established",
    }

    alert_table_available = False
    try:
        alert_table_available = _table_exists(db, "alert_queue")
    except Exception as exc:
        logger.exception(
            "business_state_alert_queue_check_failed",
            extra={"org_id": organization_id, "error_type": type(exc).__name__},
        )
        _rollback_quietly(db)
        warnings.append("Alert queue availability could not be checked.")
        computation_status = "partial"

    # Capture warnings raised during availability checks as well as metric collection.
    state_metadata["warnings"] = list(warnings)

    # Every source read is done. Release the read phase's connection so
    # persistence stands alone. A read-scope release failure previously left
    # one session transaction open across the persistence block, coupling
    # reads and writes behind a single rollback - harmless when it works,
    # catastrophic when a pooler scatters statements and the statements can
    # no longer see each other's uncommitted rows. Close it deterministically
    # here, whatever the read phase did, so the decomposed single statements
    # below behave identically in every environment.
    end_read_scope(db, read_scope)
    _rollback_quietly(db)

    persistence_failed = False
    # The underlying driver error, kept because the exception raised below is a
    # deliberate wrapper: the serving layer maps it to a retryable 503 and must
    # not leak a raw database message to a caller. Discarding the cause meant the
    # only record of *why* persistence failed was a single log line, which is
    # invisible to anyone without access to the application logs.
    persistence_cause: str | None = None
    persistence_exc: BaseException | None = None

    # Persistence no longer holds a client transaction across statements.
    # Production (2026-11-06) measured pg_backend_pid() changing mid-block
    # even inside an explicit client transaction - the pooler scatters
    # statements, so transaction-scoped safeguards never engage. The
    # decomposed single-statement design below needs no enclosing transaction.
    diag_scope_opened = False
    diag_in_tx_before = _in_transaction(db)

    # Persistence behind the production pooler is STATEMENT-SCATTERED: the
    # client's explicit transaction does not pin a server backend. Production,
    # 2026-11-06, after PR #302: the single batched statement returned without
    # error, yet its writes were not visible to the very next statement
    # (pid_before=1545467, pid_after_insert=1539098) and the snapshot was
    # never persisted. No design that relies on multi-statement transaction
    # semantics can be correct in that environment - including set_config +
    # client-maintained advisory locks at all.
    #
    # Every write below is therefore a SINGLE statement. Each one is its own
    # implicit server transaction, atomic in every pooler mode, with no
    # cross-statement semantics to defeat:
    #
    #   1. INSERT the snapshot INACTIVE. Dependent FKs are satisfiable as
    #      soon as this row exists; idx_bstate_org_current is not consulted
    #      because is_current = FALSE for any number of rows.
    #   2. Dependent writes (baselines UPDATE, alert INSERTs).
    #   3. Flip the previous current snapshot out.
    #   4. Flip the new snapshot in. Between steps 3 and 4 no row is current
    #      for the organization: a brief, loud, self-healing window (the next
    #      successful build restores service), never a torn or hidden write.
    #
    # Any failure compensates: this attempt's alerts and the inactive snapshot
    # are deleted. The pre-existing current snapshot is left untouched unless
    # the failure happens between steps 3 and 4 - then the org has no current
    # row until the next successful build, which is loud and retry-safe. There
    # is no way to torn-commit, no way to leak a dependent row, and no silent
    # path to reporting success for a write that did not land. The unique
    # partial index remains the last-line integrity guard; a concurrent build
    # that loses the is_current race surfaces as a 23505 (mapped to
    # BuildInProgress below) instead of a hand-rolled lock.

    # state_id is bound again below for the flip-in step and every
    # compensation statement.
    # DIAGNOSTIC: pids are still recorded in the reported cause. In a
    # statement-scattered environment they legitimately differ per statement;
    # they exist to prove which regime a deployment is in, never to gate
    # success. Bounded and merchant-free.
    diag_pid_before = None
    diag_pid_after_insert = None

    try:
        diag_pid_before = _persist_execute(db, "SELECT pg_backend_pid()", scalar=True)

        baseline_sql = ""
        if baseline_table_available:
            baseline_sql = """
                UPDATE business_state_baselines
                SET next_rebuild_at = :next_rebuild_at,
                    updated_at = NOW()
                WHERE organization_id = :org_id
            """

        alert_sql_fragments: list[str] = []
        alert_params: dict[str, Any] = {}
        if alert_table_available:
            for index, anomaly in enumerate(anomalies):
                alert_sql_fragments.append("""
                    INSERT INTO alert_queue (
                        id, organization_id, business_state_id, alert_type,
                        severity, message, action_url, payload, status,
                        dedupe_key, available_at, created_at, updated_at
                    ) VALUES (
                        :alert_id_{i}, :org_id, :state_id, :alert_type_{i},
                        :alert_severity_{i}, :alert_message_{i},
                        :alert_action_url_{i},
                        CAST(:alert_payload_{i} AS JSONB), 'pending',
                        :alert_dedupe_key_{i},
                        NOW(), NOW(), NOW()
                    )
                    ON CONFLICT (organization_id, dedupe_key) DO NOTHING
                """.format(i=index))
                alert_params[f"alert_id_{index}"] = str(uuid.uuid4())
                alert_params[f"alert_type_{index}"] = anomaly["metric"]
                alert_params[f"alert_severity_{index}"] = anomaly["severity"]
                alert_params[f"alert_message_{index}"] = anomaly["message"]
                alert_params[f"alert_action_url_{index}"] = anomaly.get("action_url")
                alert_params[f"alert_payload_{index}"] = json.dumps(anomaly)
                alert_params[f"alert_dedupe_key_{index}"] = f"{state_id}:{anomaly['metric']}"

        persistence_params = {
                "id": state_id,
                "org_id": organization_id,
                "state_id": state_id,
                "schema_version": SCHEMA_VERSION,
                "generated_at": generated_at,
                "data_freshness_at": last_synced_at,
                "valid_until": next_rebuild_at,
                "staleness_mins": staleness_threshold_mins,
                "computation_status": computation_status,
                "revenue_today": revenue_today,
                "revenue_yesterday": revenue_yesterday,
                "revenue_delta_pct": revenue_delta_pct,
                "revenue_trend_7d": revenue_trend_7d,
                "revenue_anomaly": revenue_anomaly,
                "cart_count": abandoned_cart_count,
                "cart_value": abandoned_cart_value,
                "cart_anomaly": cart_anomaly,
                "churn_risk_count": churn_risk_count,
                "vip_inactive_count": vip_inactive_count,
                "returning_rate": returning_customer_rate,
                "opportunities": json.dumps(opportunities),
                "risks": json.dumps(risks),
                "anomalies": json.dumps(anomalies),
                "trends": json.dumps(trends),
                "ml_signals": json.dumps({"customer": customer_ml_signals}),
                "source_data": json.dumps(source_data),
                "metadata": json.dumps(state_metadata),
        }
        if baseline_table_available:
            persistence_params["next_rebuild_at"] = next_rebuild_at
        persistence_params.update(alert_params)

        # Step 1 - insert the snapshot INACTIVE.
        _persist_execute(db, """
            INSERT INTO business_states (
                id, organization_id, is_current, schema_version,
                generated_at, data_freshness_at, valid_until,
                staleness_threshold_mins,
                computation_status,
                revenue_today, revenue_yesterday, revenue_delta_pct,
                revenue_trend_7d, revenue_anomaly,
                abandoned_cart_count, abandoned_cart_value, cart_anomaly,
                churn_risk_count, vip_inactive_count, returning_customer_rate,
                opportunities, risks, anomalies, trends, ml_signals,
                source_data, metadata
            ) VALUES (
                :id, :org_id, FALSE, :schema_version,
                :generated_at, :data_freshness_at, :valid_until,
                :staleness_mins,
                :computation_status,
                :revenue_today, :revenue_yesterday, :revenue_delta_pct,
                :revenue_trend_7d, :revenue_anomaly,
                :cart_count, :cart_value, :cart_anomaly,
                :churn_risk_count, :vip_inactive_count, :returning_rate,
                CAST(:opportunities AS JSONB), CAST(:risks AS JSONB),
                CAST(:anomalies AS JSONB), CAST(:trends AS JSONB),
                CAST(:ml_signals AS JSONB), CAST(:source_data AS JSONB),
                CAST(:metadata AS JSONB)
            )
        """, persistence_params)

        # Steps 2-4 - dependent writes, each its own implicit transaction.
        if baseline_sql:
            _persist_execute(db, baseline_sql, persistence_params)
        for alert_sql in alert_sql_fragments:
            _persist_execute(db, alert_sql, persistence_params)

        # Step 4a - flip the previous current snapshot out.
        _persist_execute(
            db,
            "UPDATE business_states SET is_current = FALSE"
            " WHERE organization_id = :org_id AND is_current = TRUE",
            {"org_id": organization_id},
        )

        # Step 4b - flip the new snapshot in.
        _persist_execute(
            db,
            "UPDATE business_states SET is_current = TRUE"
            " WHERE organization_id = :org_id AND id = :state_id",
            {"org_id": organization_id, "state_id": state_id},
        )

        diag_pid_after_insert = _persist_execute(db, "SELECT pg_backend_pid()", scalar=True)

        # Post-condition gate: the snapshot must exist and be current before
        # the build reports success. A persistence path that cannot show the
        # row has not happened, whatever the driver reported.
        snapshot_visible = _persist_execute(
            db,
            "SELECT is_current FROM business_states WHERE id = :id",
            {"id": state_id},
            scalar=True,
        )
        if not snapshot_visible:
            raise BusinessStatePersistenceError(
                "Business-state snapshot was not verifiable after persistence."
            )

        logger.info("business_state_written", extra={
            "org_id": organization_id,
            "state_id": state_id,
            "status": computation_status,
            "warnings": len(warnings),
        })

        # Bound the table now that the snapshot is safely committed. Running
        # this outside the write path keeps a retention failure from
        # invalidating a successful build.
        prune_superseded_snapshots(db, organization_id)

    except BusinessStateBuildInProgress:
        _rollback_quietly(db)
        _compensate_failed_build(db, organization_id, state_id)
        raise
    except Exception as exc:
        # Contention, not corruption. The serialization backstop for this
        # write path is the unique partial index idx_bstate_org_current;
        # losing that race yields a 23505.
        # Either way, this attempt's dependents are removed before the caller
        # sees a 409.
        sqlstate = getattr(getattr(exc, "orig", None), "pgcode", None) or getattr(exc, "pgcode", None)
        if sqlstate in ("55P03", "23505") or "lock_not_available" in str(exc):
            _rollback_quietly(db)
            _compensate_failed_build(db, organization_id, state_id)
            warnings.append("Another business-state build holds the persistence slot.")
            raise BusinessStateBuildInProgress(
                "A business-state rebuild is already running for this organization."
            ) from exc
        # Bounded, type first: this string ends up in a database column read by
        # operators, so it must never carry a traceback or an unbounded message.
        # Diagnostics go FIRST. The caller bounds this string to 280 characters
        # before it reaches automation_job_state.last_error, and putting the
        # measurements at the end meant production truncated them away: the first
        # run of this diagnostic recorded length 311 ending mid-word at
        # "in_tx_befo", so scope_opened survived and the two backend pids - the
        # only decisive values - were cut off.
        persistence_cause = (
            f"diag scope_opened={diag_scope_opened} "
            f"in_tx_before={diag_in_tx_before} pid_before={diag_pid_before} "
            f"pid_after_insert={diag_pid_after_insert} | "
            f"{type(exc).__name__}: {str(exc)[:200]}"
        )
        persistence_exc = exc
        logger.exception(
            "business_state_write_failed",
            extra={
                "org_id": organization_id,
                "error_type": type(exc).__name__,
                "cause": persistence_cause,
            },
        )
        _rollback_quietly(db)
        _compensate_failed_build(db, organization_id, state_id)
        warnings.append("Failed to persist business state to database.")
        computation_status = "partial"
        persistence_failed = True

    if persistence_failed:
        # Never report the old snapshot as if this rebuild succeeded. The
        # serving layer must return a retryable failure so scheduler telemetry
        # and operators see the persistence failure accurately.
        #
        # The cause travels with the wrapper so the build's own report - written
        # to automation_job_state when the lease is released - names the real
        # failure rather than only the fact that there was one. `from` preserves
        # the chain for anyone who does have the traceback.
        raise BusinessStatePersistenceError(
            "Business-state snapshot persistence failed"
            + (f" ({persistence_cause})" if persistence_cause else ".")
        ) from persistence_exc

    return BusinessState(
        id=state_id,
        organization_id=organization_id,
        schema_version=SCHEMA_VERSION,
        generated_at=generated_at,
        data_freshness_at=last_synced_at,
        staleness_threshold_mins=staleness_threshold_mins,
        computation_status=computation_status,
        warnings=warnings,
        revenue_today=revenue_today,
        revenue_yesterday=revenue_yesterday,
        revenue_delta_pct=revenue_delta_pct,
        revenue_trend_7d=revenue_trend_7d,
        revenue_anomaly=revenue_anomaly,
        abandoned_cart_count=abandoned_cart_count,
        abandoned_cart_value=abandoned_cart_value,
        cart_anomaly=cart_anomaly,
        churn_risk_count=churn_risk_count,
        vip_inactive_count=vip_inactive_count,
        returning_customer_rate=returning_customer_rate,
        returning_customer_rate_delta=returning_customer_rate_delta,
        opportunities=opportunities,
        risks=risks,
        anomalies=anomalies,
        trends=trends,
        ml_signals={"customer": customer_ml_signals},
        inventory_signals=inventory_signals,
        anomaly_severity=anomaly_severity,
        root_causes=root_causes,
        current_event_rate=current_event_rate,
        baseline_event_rate=baseline_event_rate,
        next_rebuild_at=next_rebuild_at,
        cart_delta_pct_vs_avg=cart_delta_pct_vs_avg,
        observed_drivers=observed_drivers,
        revenue_currency=revenue_currency,
    )


def build_business_state_with_status(
    organization_id: str, db
) -> tuple["BusinessState", str]:
    """Build one organization's state and report whether a snapshot was written.

    Returns ``(state, outcome)`` where outcome is ``"rebuilt"`` when this call
    computed and persisted a new snapshot, or ``"duplicate_skipped"`` when
    another build already held the lock and the previous snapshot was returned
    instead.

    The distinction matters because both cases previously looked identical to
    the caller: an HTTP 200 carrying a valid state. The Node scheduler counted
    the skip as a success, so a lock stuck for ten minutes produced a heartbeat
    reporting healthy rebuilds while no snapshot was being written at all.

    The lock is deliberately independent of the SQLAlchemy transaction because
    optional source-query failures may roll that transaction back while the
    overall build continues.
    """
    lock = _acquire_business_state_lock(organization_id, db)
    if lock is None:
        previous_state = load_current_business_state(organization_id, db)
        if previous_state is not None:
            logger.info(
                "business_state_duplicate_build_skipped",
                extra={"org_id": organization_id, "state_id": previous_state.id},
            )
            return previous_state, OUTCOME_DUPLICATE_SKIPPED
        raise BusinessStateBuildInProgress(
            "A business-state rebuild is already running for this organization."
        )

    logger.info(
        "business_state_lock_acquired",
        extra={"org_id": organization_id},
    )

    started = time.monotonic()
    outcome: str | None = None
    state_id: str | None = None
    computation_status: str | None = None
    error_text: str | None = None

    try:
        state = _build_business_state_unlocked(organization_id, db)
        outcome = OUTCOME_REBUILT
        state_id = getattr(state, "id", None)
        computation_status = getattr(state, "computation_status", None)
        return state, outcome
    except Exception as exc:
        # Bounded, and the exception type first: this string is stored in a
        # database column and read by operators, so it must never carry a
        # traceback, a token, or an unbounded driver message.
        error_text = f"{type(exc).__name__}: {str(exc)[:280]}"
        raise
    finally:
        _release_business_state_lock(
            lock,
            db,
            outcome=outcome,
            state_id=state_id,
            computation_status=computation_status,
            duration_ms=int((time.monotonic() - started) * 1000),
            error=error_text,
        )


def build_business_state(organization_id: str, db) -> BusinessState:
    """Build one organization's state under a shared, rollback-safe lock.

    Retained for callers that only need the state. Prefer
    :func:`build_business_state_with_status` where a skipped build must not be
    mistaken for a completed one.
    """
    state, _outcome = build_business_state_with_status(organization_id, db)
    return state


def load_current_business_state(organization_id: str, db) -> BusinessState | None:
    """
    Loads the current business state from the database.
    Returns None if no state exists yet.
    """
    try:
        # read_row, not db.execute: this sits on the investigation hot path via
        # _run_specialists, and a bare execute left the session idle in a
        # transaction -- holding a pooled connection across the model call.
        row = read_row(db, """
                SELECT
                    id, organization_id, schema_version, generated_at,
                    data_freshness_at, staleness_threshold_mins, computation_status,
                    revenue_today, revenue_yesterday, revenue_delta_pct,
                    revenue_trend_7d, revenue_anomaly,
                    abandoned_cart_count, abandoned_cart_value, cart_anomaly,
                    churn_risk_count, vip_inactive_count, returning_customer_rate,
                    opportunities, risks, anomalies, trends, ml_signals,
                    source_data, metadata, valid_until
                FROM business_states
                WHERE organization_id = :org_id
                  AND is_current = TRUE
                LIMIT 1
        """, {"org_id": organization_id})

        if not row:
            return None

        source_data = _json_value(row[23], {})
        metadata = _json_value(row[24], {})
        generated_at = (
            row[3].replace(tzinfo=timezone.utc)
            if row[3] and row[3].tzinfo is None
            else row[3] or datetime.now(timezone.utc)
        )
        staleness_mins = row[5] or DEFAULT_STALENESS_MINS
        next_rebuild_at = row[25] or generated_at + timedelta(minutes=staleness_mins)

        return BusinessState(
            id=str(row[0]),
            organization_id=str(row[1]),
            schema_version=row[2] or SCHEMA_VERSION,
            generated_at=generated_at,
            data_freshness_at=row[4],
            staleness_threshold_mins=staleness_mins,
            computation_status=row[6] or "complete",
            warnings=metadata.get("warnings", []) if isinstance(metadata.get("warnings", []), list) else [],
            revenue_today=Decimal(str(row[7])) if row[7] is not None else None,
            revenue_yesterday=Decimal(str(row[8])) if row[8] is not None else None,
            revenue_delta_pct=float(row[9]) if row[9] is not None else None,
            revenue_trend_7d=float(row[10]) if row[10] is not None else None,
            revenue_anomaly=bool(row[11]),
            abandoned_cart_count=int(row[12]) if row[12] is not None else None,
            abandoned_cart_value=Decimal(str(row[13])) if row[13] is not None else None,
            cart_anomaly=bool(row[14]),
            churn_risk_count=int(row[15]) if row[15] is not None else None,
            vip_inactive_count=int(row[16]) if row[16] is not None else None,
            returning_customer_rate=float(row[17]) if row[17] is not None else None,
            returning_customer_rate_delta=source_data.get("returning_customer_rate_delta"),
            opportunities=_json_value(row[18], []),
            risks=_json_value(row[19], []),
            anomalies=_json_value(row[20], []),
            trends=_json_value(row[21], []),
            ml_signals=_json_value(row[22], {}),
            inventory_signals=source_data.get("inventory_signals", {
                "status": "unavailable",
                "reason": "No inventory snapshot source is configured.",
            }),
            anomaly_severity=metadata.get("anomaly_severity", "normal"),
            root_causes=metadata.get("root_causes", []),
            current_event_rate=float(source_data.get("current_event_rate_5m") or 0),
            baseline_event_rate=float(source_data.get("baseline_event_rate_5m_30d") or 0),
            next_rebuild_at=next_rebuild_at,
            cart_delta_pct_vs_avg=source_data.get("cart_delta_pct_vs_avg"),
            observed_drivers=metadata.get("observed_drivers", []) if isinstance(metadata.get("observed_drivers", []), list) else [],
            revenue_currency=metadata.get("revenue_currency") if isinstance(metadata.get("revenue_currency"), str) else None,
        )
    except Exception as exc:
        logger.exception(
            "business_state_load_failed",
            extra={"org_id": organization_id, "error_type": type(exc).__name__},
        )
        _rollback_quietly(db)
        return None


# ── Helpers 

def _empty_state(state_id: str, org_id: str, generated_at: datetime, warnings: list[str]) -> BusinessState:
    return BusinessState(
        id=state_id,
        organization_id=org_id,
        schema_version=SCHEMA_VERSION,
        generated_at=generated_at,
        data_freshness_at=None,
        staleness_threshold_mins=DEFAULT_STALENESS_MINS,
        computation_status="failed",
        warnings=warnings,
        revenue_today=None, revenue_yesterday=None,
        revenue_delta_pct=None, revenue_trend_7d=None,
        revenue_anomaly=False,
        abandoned_cart_count=None, abandoned_cart_value=None,
        cart_anomaly=False,
        churn_risk_count=None, vip_inactive_count=None,
        returning_customer_rate=None,
        returning_customer_rate_delta=None,
        opportunities=[], risks=[], anomalies=[], trends=[], ml_signals={},
        inventory_signals={
            "status": "unavailable",
            "reason": "No inventory snapshot source is configured.",
        },
        anomaly_severity="normal",
        root_causes=[],
        current_event_rate=0.0,
        baseline_event_rate=0.0,
        next_rebuild_at=generated_at + TRAFFIC_THRESHOLDS["normal"],
        cart_delta_pct_vs_avg=None,
    )


def _time_ago(dt: datetime) -> str:
    if dt is None:
        return "recently"
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    mins = int((datetime.now(timezone.utc) - dt).total_seconds() / 60)
    if mins < 60:
        return f"{mins} minutes ago"
    hours = mins // 60
    return f"{hours} hour{'s' if hours != 1 else ''} ago"


# Dynamic rebuild interval

# Maps traffic load level to the delay before the next rebuild is triggered.
# Under a spike (>5x baseline), we rebuild every minute to keep the state fresh.
TRAFFIC_THRESHOLDS = {
    "normal":   timedelta(minutes=15),
    "elevated": timedelta(minutes=5),   # > 2x baseline event rate
    "spike":    timedelta(minutes=1),   # > 5x baseline event rate
}


def _get_next_rebuild_interval(current_event_rate: float, baseline_rate: float) -> timedelta:
    """
    Returns the correct rebuild interval based on current vs baseline event rate.
    Called at the end of every successful build_business_state() run.

    Guards against division by zero when a new merchant has no baseline yet —
    we default to normal (15 minutes) in that case.

    Args:
        current_event_rate: Number of store events in the last 5 minutes.
        baseline_rate:      30-day rolling average of events per 5-minute window.

    Returns:
        timedelta — the delay before the next rebuild should be triggered.
    """
    # A new merchant has no trustworthy comparison; keep the normal cadence.
    if baseline_rate <= 0:
        return TRAFFIC_THRESHOLDS["normal"]

    ratio = current_event_rate / baseline_rate

    if ratio >= 5.0:
        return TRAFFIC_THRESHOLDS["spike"]
    elif ratio >= 2.0:
        return TRAFFIC_THRESHOLDS["elevated"]
    return TRAFFIC_THRESHOLDS["normal"]
