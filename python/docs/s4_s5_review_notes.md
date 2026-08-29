# S4 / S5 — Review Notes and Open Decisions

**Date**: 29 August 2026
**Scope**: `src/jobs/rfm_sync.py` (S4), `src/agents/customer_agent.py` and
`src/agents/retention_agent.py` (S5)
**Baseline**: `7624ebd2`

---

## 1. Summary

Three defects were found and fixed in this pass. Four further items are
recorded below without code changes because they change either a published
contract or a documented rule, and are listed here so the decision is made
deliberately rather than by default.

---

## 2. Fixes Applied

### 2.1 A failed commit was reported to the caller as a success

`calculate_rfm_for_all_customers` runs a single commit after the loop, so the
commit is the only point at which anything is persisted. The commit failure
path logged the error and then returned the per-customer counters unchanged —
so a batch that persisted nothing returned, for example,
`{"processed_count": 1250, "failed_customer_ids": []}`.

`POST /internal/rfm-sync` passes that straight through as `200 OK`, and the
Node integration guide instructs the caller to treat the response as
observability only. Total data loss was therefore indistinguishable from a
clean run, on both sides of the call.

The failure path now reports what actually happened: `processed_count` 0,
every customer id in `failed_customer_ids`, and a zeroed
`segment_distribution`. The response schema is unchanged, so no caller-side
change is required.

Covered by `test_commit_failure_is_not_reported_as_success`.

### 2.2 `logging.basicConfig()` ran at import time

`src/serving/api.py` imports this job module, so a batch job was configuring
the root logger for the whole FastAPI service as a side effect of import.
The call has moved into the `__main__` block, which is the only context that
owns the root logger. CLI output format is unchanged.

### 2.3 Duplicated call in `customer_agent.py`

`second_purchase = _approaching_second_purchase(ml["customers"])` appeared
twice in succession in two methods (previously lines 162-163 and 259-260).
Same result, twice the work. Reduced to one call in each.

---

## 3. Verification

| Suite | Result |
|---|---|
| `tests/test_rfm_sync_job.py` | 11 passed (10 existing + 1 new) |
| `tests/test_rfm_sync.py` | 14 passed |
| `tests/test_event_processor.py` | 45 passed |

The new test was written first and confirmed failing (`AssertionError: 2 != 0`)
before the fix in 2.1 was applied.

`tests/test_pipeline.py` and `tests/test_rfm_sync_endpoint.py` were not run:
the first requires `pytest` and the second imports `api.py`, which needs
`pandas`, `mlflow` and `sqlalchemy`. Neither is installed in the local
environment. This is unrelated to the changes above.

---

## 4. Open Items — Decision Required

### 4.1 A dead database is indistinguishable from an empty store

If the customer fetch fails, the job returns a zeroed summary, and the
endpoint returns `200 OK` with `processed_count: 0` — byte-identical to the
response for a store with no customers. The Node caller has no way to know it
should retry.

Fixing this means either an added field on the response or a `503`, both of
which change the contract the Node layer codes against. Needs agreement with
the backend before implementing.

### 4.2 One savepoint per customer inside one transaction

The per-customer `SAVEPOINT`/`RELEASE`/`ROLLBACK TO` cycle correctly stops one
bad row from poisoning the transaction, but every savepoint opens a
subtransaction. PostgreSQL caches 64 subtransaction ids per backend; past that
threshold other backends begin resolving subtransaction visibility through the
SLRU cache on every snapshot, which degrades the whole instance, not just this
job. `ROLLBACK TO SAVEPOINT` also does not release the savepoint, so failures
accumulate additional subtransactions.

A store with thousands of customers will exceed 64 by a wide margin.

Committing in batches of N would remove the hazard. Note that the task
specification for S4 requires only "UPDATE customers table, commit" — the
"single DB commit after the full loop" wording is local to this module's
docstring, not the spec, so batching is available without a spec change.

### 4.3 No guard against concurrent runs for one store

The integration guide has the Node layer triggering this on initial store
sync, on manual resync, and optionally on a nightly cron. Two overlapping runs
for the same `store_id` would duplicate the work and contend for row locks on
`customers`. A `pg_advisory_lock` keyed on the store would serialise them.

### 4.4 Request duration is unbounded

The endpoint offloads the job to the thread pool and then awaits it, so the
HTTP request stays open for the full batch. Work per customer is a separate
`calculate_rfm_scores` round trip, so duration scales linearly with store
size and will exceed typical proxy timeouts for large stores.

The offload also uses the default executor, shared with every model inference
call in `api.py`, so concurrent syncs occupy worker slots that inference needs.

---

## 5. Spec Conflict — S5 Discount Eligibility

`retention_agent.py:31` currently reads:

```python
DISCOUNT_ELIGIBLE_TIERS = ("AT_RISK", "HIGH_RISK", "CRITICAL")
```

and line 71 applies it as a flat tier membership test. The task specification
for the AT_RISK tier reads:

> personalised win-back with product recs. If `email_open_rate_30d` < 0.05
> switch to SMS. **Soft incentive if `coupon_dependency_score` > 0.4.**

AT_RISK discounting is conditional in the spec. It is currently unconditional
in the code, and `coupon_dependency_score` is not referenced anywhere in the
module. Left unchanged here because it alters live discounting behaviour.
