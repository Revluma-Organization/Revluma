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

    try:
        cursor = db.cursor()
        cursor.execute("SELECT id FROM customers WHERE store_id = %s", (store_id,))
        rows = cursor.fetchall()
    except Exception as e:
        print(f"Failed to fetch customers for store {store_id}: {e}")
        return {
            "processed_count": 0,
            "failed_customer_ids": [],
            "segment_distribution": segment_distribution,
        }

    customer_ids = [row[0] for row in rows] if rows else []

    for customer_id in customer_ids:
        segment, ok = _process_single_customer(customer_id, db)
        if ok:
            segment_distribution[segment] += 1
            processed_count += 1
        else:
            failed_customer_ids.append(customer_id)

    # Single commit after the full loop - performance requirement
    try:
        db.commit()
    except Exception as e:
        print(f"Failed to commit RFM batch for store {store_id}: {e}")

    print(f"Processed customers: {processed_count}")
    print("Segment distribution:")
    for segment, count in segment_distribution.items():
        print(f"  {segment}: {count}")
    if failed_customer_ids:
        print(
            f"Failed customer IDs ({len(failed_customer_ids)}): {failed_customer_ids}"
        )

    return {
        "processed_count": processed_count,
        "failed_customer_ids": failed_customer_ids,
        "segment_distribution": segment_distribution,
    }


def _process_single_customer(customer_id: str, db) -> tuple:
    """Computes and persists RFM scores for a single customer.

    Extracted from calculate_rfm_for_all_customers to keep it under 80 lines.
    Wraps all DB operations in a try/except so a single bad customer never
    aborts the full batch — the caller accumulates failures separately.

    Args:
        customer_id (str): UUID of the customer to process.
        db: Active database connection with cursor() support.

    Returns:
        tuple: (segment: str, success: bool).
               segment is the RFM segment label on success, or '' on failure.
    """
    try:
        rfm = calculate_rfm_scores(customer_id, db)
        r = rfm["rfm_recency_score"]
        f = rfm["rfm_frequency_score"]
        m = rfm["rfm_monetary_score"]
        segment = get_rfm_segment(r, f, m)
        cursor = db.cursor()
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
        return segment, True
    except Exception as e:
        print(f"Failed to process customer {customer_id}: {e}")
        return "", False


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
        "processed_count": 0,
        "failed_customer_ids": [],
        "segment_distribution": {
            "champion": 0,
            "loyal": 0,
            "at_risk": 0,
            "hibernating": 0,
            "lost": 0,
        },
    }

    try:
        database_url = os.getenv("DATABASE_URL")
        if not database_url:
            print("DATABASE_URL environment variable is not set.")
            return result

        db = psycopg2.connect(database_url)
        result = calculate_rfm_for_all_customers(store_id, db)

    except Exception as e:
        print(f"RFM sync job failed for store {store_id}: {e}")

    finally:
        if db is not None:
            try:
                db.close()
            except Exception:
                pass

    return result


# ---------------------------------------------------------------------------
# 4. CLI Entrypoint
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python rfm_sync.py <store_id>")
        sys.exit(1)

    store_id_arg = sys.argv[1]
    run(store_id_arg)
