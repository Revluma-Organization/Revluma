# Data synchronization jobs

This package contains the RFM refresh and initial historical-ingestion jobs.
Both jobs use parameterized database operations, return structured summaries,
and leave backend-owned scheduling and schema migrations outside Python.

## RFM refresh

`rfm_sync.py` recalculates recency, frequency, and monetary scores for every
customer in one store. It then assigns the first matching segment:

| Priority | Segment | Rule |
| --- | --- | --- |
| 1 | `champion` | R, F, and M are all at least 4 |
| 2 | `loyal` | F and R are at least 3 |
| 3 | `at_risk` | R is at most 2 and F is at least 3 |
| 4 | `hibernating` | R and F are at most 2 and M is at least 2 |
| 5 | `lost` | Fallback |

The job reads `customers` and `orders`, updates the RFM columns on `customers`,
and commits once after processing the batch. A per-customer failure is recorded
without stopping the remaining customers. A fetch, schema-check, or commit
failure returns `success=false` and a stable error code.

Run from `python/` with the project environment active:

```powershell
python -m src.jobs.rfm_sync <store_id>
```

`DATABASE_URL` must be set. The returned summary contains `success`,
`processed_count`, `failed_count`, `failed_customer_ids`,
`segment_distribution`, and `error`.

## Historical ingestion

`historical_ingestion.py` is an idempotent, programmatic cold-start workflow for
a newly connected store. It runs the RFM refresh, establishes business-state
baselines, seeds strategic memories from historical performance, and stores the
current segment distribution.

The optional `lookback_months` value accepts 1–60 and defaults to 12. Each
database step commits independently and rolls back before continuing after a
failure, so the result may be `complete`, `partial`, or `failed`.

The workflow requires backend-owned `business_state_baselines` and
`strategic_memories` tables in addition to customer, order, and event data.
Missing optional tables are reported as warnings. Exact migration, trigger,
index, and idempotency requirements are documented in
[`docs/BACKEND_IMPLEMENTATION_GUIDE.md`](../../../docs/BACKEND_IMPLEMENTATION_GUIDE.md).

Relevant tests are in `python/tests/test_rfm_sync_job.py`,
`python/tests/test_rfm_sync_endpoint.py`, and
`python/tests/test_historical_ingestion.py`.
