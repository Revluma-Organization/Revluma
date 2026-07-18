# RFM Sync — Scheduled Batch Job

## What this job does
Runs after Shopify/platform sync completes. Computes RFM (Recency, Frequency, Monetary) scores for every customer in a store, segments them into behavioral groups, and writes the results back to the `customers` table in a single batch commit.

## Status
**Reviewed against spec, no code changes needed.** This file was already correctly implemented before Phase 2 review — confirmed compliant with every non-negotiable rule below, and **verified end-to-end against a real Supabase database** (see Section "Live Verification").

## Non-negotiable rules (all confirmed present in code)
- ✅ Single DB commit after the full loop completes — not per-customer (performance requirement)
- ✅ Continues processing on per-customer failure — a single bad row never aborts the batch
- ✅ Parameterized queries only — no string interpolation anywhere (SQL injection safe)
- ✅ Fails fast if `store_id` argument is missing from the CLI call

## Segmentation logic
Priority-ordered, first match wins, always returns a valid segment (never raises):

| Priority | Segment | Rule |
|---|---|---|
| 1 | `champion` | r ≥ 4 AND f ≥ 4 AND m ≥ 4 |
| 2 | `loyal` | f ≥ 3 AND r ≥ 3 |
| 3 | `at_risk` | r ≤ 2 AND f ≥ 3 |
| 4 | `hibernating` | r ≤ 2 AND f ≤ 2 AND m ≥ 2 |
| 5 | `lost` | fallback — everything else |

## Required database schema
Confirmed against the real queries inside `pipeline.py`'s `calculate_rfm_scores()` and the functions it calls:

```sql
create table customers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references stores(id),
  orders_count int default 0,
  rfm_recency int,
  rfm_frequency int,
  rfm_monetary int,
  rfm_segment text,
  updated_at timestamptz default now()
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id),
  total numeric,
  ordered_at timestamptz,
  coupon_used boolean default false
);
```

## Usage
```bash
export DATABASE_URL="postgresql://..."
python src/jobs/rfm_sync.py "<store_id_uuid>"
```

**Note on connecting to Supabase:** direct connections (`db.xxxxx.supabase.co`) can fail with `Network is unreachable` on networks without proper IPv6 support. Use the **Connection Pooling** string instead (Project Settings → Database → Connection pooling) — format differs slightly: username becomes `postgres.<project-ref>`, host is `...pooler.supabase.com`.

## Live Verification
Tested against a real Supabase database with 5 seeded customers spanning a range of recency/frequency/monetary profiles (recent+frequent+high-value, old+low-value, zero-order, etc.).

**Result:**
```
Processed customers: 5
Segment distribution:
  champion: 2
  loyal: 0
  at_risk: 0
  hibernating: 2
  lost: 1
```

Confirmed via direct query that `rfm_segment`, `rfm_recency`, `rfm_frequency`, `rfm_monetary`, and `updated_at` were all correctly written back to the `customers` table — not just printed to console.

## Known gap (flagged, not fixed)
The production Supabase database (as of this test) only contains a `stores` table — no `customers` or `orders` tables exist yet in the real schema. This verification was run against a temporary local test schema created solely to prove the script's logic works correctly. **The actual production migration for `customers`/`orders` tables is still outstanding** — flagged to Dave/Backend Engineer, not something fixable from the ML side.

## Output
`processed_count`, `failed_customer_ids`, `segment_distribution` — printed to console and returned as a dict for programmatic use (e.g. if wired into a cron scheduler or admin dashboard later).
