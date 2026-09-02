"""
Revluma RFM Sync Job
======================
Scheduled batch job that runs after Shopify sync (2.BE1.5). Computes RFM
scores for all customers in a store, segments them into behavioural
groups, and persists results back into PostgreSQL.

Usage:
    python rfm_sync.py <store_id>

NON-NEGOTIABLE RULES:
    - Single DB commit after the full loop (not per-customer)
    - Continue processing on per-customer failure - never abort the batch
    - Parameterized queries only - never string interpolation
    - Must fail fast if store_id argument is missing
"""

from __future__ import annotations

import os
import sys
import logging

logger = logging.getLogger(__name__)

sys.path.append(os.path.join(os.path.dirname(__file__), "..", ".."))

from src.features.pipeline import calculate_rfm_scores

# ---------------------------------------------------------------------------
# 1. RFM Segmentation Logic
# ---------------------------------------------------------------------------


def get_rfm_segment(r: int, f: int, m: int) -> str:
    """
    Determines a customer's behavioural segment from their RFM scores.

    Rules are evaluated in priority order - first match wins. No overlapping
    ambiguity. Always returns a valid segment string, never raises.

    Priority order:
        1. champion     - r >= 4 AND f >= 4 AND m >= 4
        2. loyal        - f >= 3 AND r >= 3
        3. at_risk      - r <= 2 AND f >= 3
        4. hibernating  - r <= 2 AND f <= 2 AND m >= 2
        5. lost         - fallback, everything else

    Args:
        r: Recency score (1-5)
        f: Frequency score (1-5)
        m: Monetary score (1-5)

    Returns:
        str: 'champion' | 'loyal' | 'at_risk' | 'hibernating' | 'lost'
    """
    if r >= 4 and f >= 4 and m >= 4:
        return "champion"

    if f >= 3 and r >= 3:
        return "loyal"

    if r <= 2 and f >= 3:
        return "at_risk"

    if r <= 2 and f <= 2 and m >= 2:
        return "hibernating"

    return "lost"


def _column_exists(db, table_name: str, column_name: str) -> bool:
    """Checks an optional schema capability without interpolating identifiers."""
    cursor = db.cursor()
    try:
        cursor.execute(
            """
            SELECT EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = %s
                  AND column_name = %s
            )
            """,
            (table_name, column_name),
        )
        row = cursor.fetchone()
        return bool(row and row[0])
    finally:
        cursor.close()


# ---------------------------------------------------------------------------
# 2. Batch Processing Function
# ---------------------------------------------------------------------------


def calculate_rfm_for_all_customers(store_id: str, db) -> dict:
    """
    Computes RFM scores and segments for every customer belonging to a
    store, then persists results back to the customers table.

    Commits once after the full loop completes (not per-customer) for
    performance. Continues processing on per-customer failure - a single
    bad row never aborts the full batch.

    Args:
        store_id: UUID of the store/merchant
        db: Active database connection

    Returns:
        dict: {
            "processed_count": int,
            "failed_customer_ids": list,
            "segment_distribution": dict  # e.g. {"champion": 120, "loyal": 340, ...}
        }
    """
    segment_distribution = {
        "champion": 0,
        "loyal": 0,
        "at_risk": 0,
        "hibernating": 0,
        "lost": 0,
    }
    failed_customer_ids = []
    processed_count = 0

    cursor = None
    try:
        cursor = db.cursor()
        cursor.execute("SELECT id FROM customers WHERE store_id = %s", (store_id,))
        rows = cursor.fetchall()
    except Exception as exc:
        try:
            db.rollback()
        except Exception:
            logger.error("rfm_customer_fetch_rollback_failed")
        logger.error(
            "rfm_customer_fetch_failed",
            extra={"store_id": store_id, "error_type": type(exc).__name__},
        )
        return {
            "success": False,
            "processed_count": 0,
            "failed_customer_ids": [],
            "failed_count": 0,
            "segment_distribution": segment_distribution,
            "error": "customer_fetch_failed",
        }
    finally:
        if cursor is not None:
            try:
                cursor.close()
            except Exception:
                logger.warning("rfm_customer_fetch_cursor_close_failed")

    customer_ids = [row[0] for row in rows] if rows else []

    try:
        include_rfm_updated_at = _column_exists(
            db,
            "customers",
            "rfm_updated_at",
        )
    except Exception as exc:
        try:
            db.rollback()
        except Exception:
            logger.error("rfm_schema_check_rollback_failed")
        logger.error(
            "rfm_schema_capability_check_failed",
            extra={"store_id": store_id, "error_type": type(exc).__name__},
        )
        return {
            "success": False,
            "processed_count": 0,
            "failed_customer_ids": [],
            "failed_count": 0,
            "segment_distribution": segment_distribution,
            "error": "schema_capability_check_failed",
        }

    for customer_id in customer_ids:
        segment, ok = _process_single_customer(
            customer_id,
            db,
            include_rfm_updated_at=include_rfm_updated_at,
        )
        if ok:
            segment_distribution[segment] += 1
            processed_count += 1
        else:
            failed_customer_ids.append(customer_id)

    # Single commit after the full loop - performance requirement
    error = "customer_processing_failed" if failed_customer_ids else None
    try:
        db.commit()
    except Exception as exc:
        # The commit is the only point at which anything is persisted, so a
        # failure here loses the whole batch. Reporting the per-customer
        # counters would tell the Node caller the sync succeeded.
        try:
            db.rollback()
        except Exception:
            logger.error("rfm_commit_rollback_failed")
        logger.error(
            "rfm_batch_commit_failed",
            extra={"store_id": store_id, "error_type": type(exc).__name__},
        )
        processed_count = 0
        failed_customer_ids = list(customer_ids)
        segment_distribution = {segment: 0 for segment in segment_distribution}
        error = "commit_failed"

    failed_count = len(failed_customer_ids)
    success = error is None
    logger.info(
        "rfm_batch_completed",
        extra={
            "store_id": store_id,
            "processed_count": processed_count,
            "failed_count": failed_count,
            "segment_distribution": segment_distribution,
            "success": success,
        },
    )
    if failed_customer_ids:
        logger.warning(
            "rfm_batch_has_customer_failures",
            extra={"store_id": store_id, "failed_count": failed_count},
        )

    return {
        "success": success,
        "processed_count": processed_count,
        "failed_customer_ids": failed_customer_ids,
        "failed_count": failed_count,
        "segment_distribution": segment_distribution,
        "error": error,
    }


def _process_single_customer(
    customer_id: str,
    db,
    include_rfm_updated_at: bool = False,
) -> tuple:
    """Computes and persists RFM scores for a single customer.

    Extracted from calculate_rfm_for_all_customers to keep it under 80 lines.
    Wraps all DB operations in a try/except with a PostgreSQL SAVEPOINT so a
    single bad customer never aborts the full batch — the caller accumulates
    failures separately without poisoning the transaction.

    Args:
        customer_id (str): UUID of the customer to process.
        db: Active database connection with cursor() support.

    Returns:
        tuple: (segment: str, success: bool).
               segment is the RFM segment label on success, or '' on failure.
    """
    cursor = None
    try:
        cursor = db.cursor()
        cursor.execute("SAVEPOINT sp_customer")
        
        rfm = calculate_rfm_scores(customer_id, db)
        r = rfm["rfm_recency_score"]
        f = rfm["rfm_frequency_score"]
        m = rfm["rfm_monetary_score"]
        segment = get_rfm_segment(r, f, m)
        
        if include_rfm_updated_at:
            cursor.execute(
                """
                UPDATE customers
                SET
                  rfm_recency = %s,
                  rfm_frequency = %s,
                  rfm_monetary = %s,
                  rfm_segment = %s,
                  rfm_updated_at = NOW(),
                  updated_at = NOW()
                WHERE id = %s
                """,
                (r, f, m, segment, customer_id),
            )
        else:
            cursor.execute(
                """
                UPDATE customers
                SET
                  rfm_recency = %s,
                  rfm_frequency = %s,
                  rfm_monetary = %s,
                  rfm_segment = %s,
                  updated_at = NOW()
                WHERE id = %s
                """,
                (r, f, m, segment, customer_id),
            )
        cursor.execute("RELEASE SAVEPOINT sp_customer")
        return segment, True
    except Exception as exc:
        if cursor is not None:
            try:
                cursor.execute("ROLLBACK TO SAVEPOINT sp_customer")
                cursor.execute("RELEASE SAVEPOINT sp_customer")
            except Exception:
                logger.error("rfm_customer_savepoint_recovery_failed")
        logger.error(
            "rfm_customer_processing_failed",
            extra={"error_type": type(exc).__name__},
        )
        return "", False
    finally:
        if cursor is not None:
            try:
                cursor.close()
            except Exception:
                logger.warning("rfm_customer_cursor_close_failed")


# ---------------------------------------------------------------------------
# 3. Job Runner
# ---------------------------------------------------------------------------


def run(store_id: str) -> dict:
    """
    Top-level job runner. Connects to the database, executes the RFM
    batch job, and ensures the connection is closed cleanly regardless
    of success or failure.

    Args:
        store_id: UUID of the store/merchant to process

    Returns:
        dict: Result summary from calculate_rfm_for_all_customers, or a
              safe default if the DB connection itself failed.
    """
    import psycopg2

    db = None
    result = {
        "success": False,
        "processed_count": 0,
        "failed_customer_ids": [],
        "failed_count": 0,
        "segment_distribution": {
            "champion": 0,
            "loyal": 0,
            "at_risk": 0,
            "hibernating": 0,
            "lost": 0,
        },
        "error": None,
    }

    try:
        database_url = os.getenv("DATABASE_URL")
        if not database_url:
            logger.error("DATABASE_URL environment variable is not set.")
            result["error"] = "database_url_missing"
            return result

        db = psycopg2.connect(database_url)
        result = calculate_rfm_for_all_customers(store_id, db)

    except Exception as exc:
        result["error"] = "connection_or_job_failed"
        logger.error(
            "rfm_sync_job_failed",
            extra={"store_id": store_id, "error_type": type(exc).__name__},
        )

    finally:
        if db is not None:
            try:
                db.close()
            except Exception as exc:
                logger.error(
                    "rfm_connection_close_failed",
                    extra={"error_type": type(exc).__name__},
                )

    return result


# ---------------------------------------------------------------------------
# 4. CLI Entrypoint
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    # Only the CLI owns the root logger. api.py imports this module, and
    # basicConfig at import time would reconfigure logging for the whole
    # FastAPI service.
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
    )

    if len(sys.argv) < 2:
        logger.error("Usage: python rfm_sync.py <store_id>")
        sys.exit(1)

    store_id_arg = sys.argv[1]
    run(store_id_arg)
