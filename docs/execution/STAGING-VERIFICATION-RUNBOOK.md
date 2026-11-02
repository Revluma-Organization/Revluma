# Staging verification runbook — Rev Intelligence release candidate

A zero-cost, isolated, destroyable staging environment you can build on any machine with
Docker or a native PostgreSQL 16 install. Nothing here touches production, the shared
Supabase project, or a paid service.

This runbook replaces the earlier "wait for someone to provide staging" version. Sections
1–5 were executed on 2026-11-02 in this workspace against PostgreSQL 16.2 + pgvector 0.8.0;
results are recorded in `docs/execution/EXECUTION_STATUS.md`. Sections 6–8 still need
external systems and say exactly what to do.

---

## 1. Create the database (pick one path)

### Path A — Docker (recommended, matches CI)

```bash
docker run -d --name revluma-staging \
  -e POSTGRES_USER=revluma_staging \
  -e POSTGRES_PASSWORD="$(openssl rand -hex 24)" \
  -e POSTGRES_DB=revluma_staging \
  -p 55432:5432 pgvector/pgvector:pg16

# read the generated password when you need it; never commit it
docker exec revluma-staging env POSTGRES_PASSWORD
```

The `pgvector/pgvector:pg16` image already contains the `vector` extension, which
`202609220002_add_zero_touch_automation` requires.

### Path B — native PostgreSQL 16 (no Docker, what this workspace used)

```bash
python -m venv /tmp/stagingvenv
/tmp/stagingvenv/bin/pip install pgserver
PG=/tmp/stagingvenv/lib/python3.11/site-packages/pgserver/pginstall/bin
mkdir -p /tmp/revstaging
"$PG/initdb" -D /tmp/revstaging/pgdata -U revluma_staging --auth=trust
"$PG/pg_ctl" -D /tmp/revstaging/pgdata \
  -o "-c listen_addresses=127.0.0.1 -p 55432" -l /tmp/revstaging/postgres.log start

# pgvector is not bundled; build it against these headers (about 10 seconds)
git clone --depth 1 --branch v0.8.0 https://github.com/pgvector/pgvector /tmp/pgvector
make -C /tmp/pgvector install PG_CONFIG="$PG/pg_config"

"$PG/createdb" -h 127.0.0.1 -p 55432 -U revluma_staging revluma_staging
"$PG/psql" -h 127.0.0.1 -p 55432 -U revluma_staging -d revluma_staging \
  -c "CREATE EXTENSION IF NOT EXISTS vector;"   # must be run by a superuser
```

`trust` auth on `127.0.0.1` only, on a non-default port, is deliberate: no password on
disk, no exposure beyond the loopback interface.

Connection string used by every command below:

```bash
export STAGING_DATABASE_URL="postgresql://revluma_staging:<password>@127.0.0.1:55432/revluma_staging?schema=public"
```

### Supabase-style roles

Two migrations assume Supabase's Data API roles exist. Create them in staging (they have no
login and no privileges):

```sql
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
```

---

## 2. Build the schema the way this repository builds it

**Important:** the migration history in `Backend/prisma/migrations` does **not** reproduce
`schema.prisma`. Replaying `0_baseline` and every later migration on an empty database
produces 27 tables, while the Prisma schema defines 64 models. The repository's own CI
workflows (`.github/workflows/task030-delayed-events.yml` and siblings) therefore bootstrap
with `prisma db push` and then apply the *targeted* migration under test.

```bash
cd Backend
npm ci                                   # postinstall runs prisma generate
npx prisma db push --skip-generate --accept-data-loss
npx prisma generate
npx prisma validate
```

Then apply the candidate migration and any migration that has not been recorded yet:

```bash
DATABASE_URL="$STAGING_DATABASE_URL" npx prisma migrate deploy
# or, for a single migration, exactly as CI does it:
PGPASSWORD=<password> psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 55432 \
  -U revluma_staging -d revluma_staging \
  -f prisma/migrations/20261101120000_rev_financial_integrity/migration.sql
```

`prisma db push` and `prisma migrate deploy` need to download the Prisma engines from
`binaries.prisma.sh`. If that host is unreachable (as in the sandbox where this runbook was
first executed), there is no offline substitute: run this section on a machine with the
engines cached or reachable. The sandbox fallback was a manual replay of the migration
directories that do not depend on `db push`-created tables; it verified the candidate
migration but not the full application schema. Do not mistake that for a bootstrapped app.

Only the two SQL files that were UTF-16LE in the repository (`0_baseline/migration.sql`,
`manual_changes.sql`) needed re-encoding before `psql` would accept them; that fix is part
of this branch.

---

## 3. Verify the candidate migration

```bash
psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f Backend/scripts/staging/verify-financial-integrity.sql
```

The script runs inside a transaction that is rolled back and asserts behaviour, not just
presence:

| Check | Expected |
| --- | --- |
| `orders.refunded_total` exists, `numeric(_,2)`, nullable | passes |
| `customers.ltv_currency`, `ltv_mixed_currency` exist | passes |
| `order_cancellation_tombstones` has one primary key + observation index | passes |
| `#1004` ($1,025 gross → $0 net) contributes nothing to net revenue | passes |
| `#1001` ($100 gross → $0 net) contributes nothing to net revenue | passes |
| Partially refunded order contributes its net (70 of 100) | passes |
| Cancelled order (999) excluded from net and gross | passes |
| Gross reconstructed as `total + refunded_total` (1,275 USD) | passes |
| Currency-less row never folded into another currency | passes |
| Cancellation tombstone survives independently of any order row | passes |

Registry: the script must run as a role that bypasses row level security (the database
owner or a superuser). `intelligence_order_coverage` and `intelligence_findings` are
`FORCE ROW LEVEL SECURITY` with no policies, so *any* non-bypassing role is denied — which
is the intended deny-all posture for Data API roles, and the reason the backend must
connect as a bypassing role (Supabase's `postgres`).

```bash
psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f Backend/scripts/staging/verify-data-api-isolation.sql
```

Fails if a migration grants `anon` or `authenticated` any table privilege, or if the
intelligence tables lose RLS/FORCE RLS.

---

## 4. Verify revenue evidence against real PostgreSQL

```bash
cd python
DATABASE_URL="$STAGING_DATABASE_URL" PYTHONPATH=. \
  /tmp/stagingvenv/bin/python scripts/staging_revenue_acceptance.py
```

Seeds synthetic orders (full refunds, partial refund, cancellation, two currencies) in one
transaction, calls the production evidence service, asserts the reported values, then
rolls back. Expected output:

```
overall_status=available
recorded_order_value={'EUR': '25.00', 'USD': '120.00'}
recorded_order_count={'EUR': 1, 'USD': 4}
PASS: refunds netted once, cancellations excluded, currencies separated, coverage verified, refund limitation stated
```

The gated pytest module runs the same kind of check in its own throwaway schema:

```bash
TASK198_DATABASE_URL="postgresql+psycopg2://revluma_staging:<password>@127.0.0.1:55432/revluma_staging" \
  python -m pytest tests/test_revenue_evidence_postgres.py -q     # 2 passed
```

---

## 5. Test suites

| Suite | Command | Local expectation in this sandbox |
| --- | --- | --- |
| Python | `DATABASE_URL=postgresql+psycopg2://placeholder:placeholder@localhost:5432/placeholder python -m pytest tests -q` | 612 passed, 3 skipped |
| Backend | `cd Backend && npm test` | 26 files pass, 8 blocked on `Cannot find module '.prisma/client/default'` (Prisma engines unreachable); 0 real failures; CI runs all 34 |
| Dashboard | `cd Frontend/Dashboard && npx vitest run && npm run build` | 19 files / 120 tests passed; build succeeds |

---

## 6. Shopify test store (external; still required)

Connect a **development** store — never a live merchant — and drive these deliberately.

| Scenario | How to trigger | Expected |
| --- | --- | --- |
| Non-USD order | Place an order in a second currency | Stored currency matches; no `ORDER_CURRENCY_UNVERIFIED` |
| Partial refund | Refund part of an order | `orders.total` = net; `refunded_total` = refunded amount |
| Full refund (#1004-class) | Refund the whole order | `total` 0, `refunded_total` = gross |
| Pending/failed refund | Create a refund with a pending transaction | Net unchanged; pending ignored |
| Cancel, then replay `orders/create` | Cancel, replay the original create | Order stays cancelled (tombstone wins) |
| Create, cancel, then update | Out-of-order delivery | Cancellation stays terminal |
| Abandoned checkout with value | Abandon a checkout | Cart value + currency persisted, no default USD |
| Malformed amount | Replay a non-numeric total | Rejected with a typed `*_UNVERIFIED` code, not stored as 0 |

Unit and SQL evidence for all of these exists (see `EXECUTION_STATUS.md`); only real
webhook delivery is missing.

---

## 7. Streaming end-to-end (external; still required)

Needs the Node backend and Python service deployed against staging, with `ML_INTERNAL_KEY`
and a provider key:

1. Ask "What happened to my revenue last week?" — investigation steps, then evidence
   frames, then the answer with an evidence count.
2. Evidence drawer: every amount has a currency, period, source, definition, `ev-…` id.
3. **Stop** mid-answer → "Generation stopped" + Regenerate; one cancelled assistant turn,
   no duplicate user turn.
4. **Regenerate** → previous answer replaced; exactly one user turn per question.
5. Force a specialist failure → other results survive, "Some checks could not complete".
6. Reload → steps and evidence rehydrate from persistence.
7. Search a word from the answer → conversation found.

Contract-level coverage for 1, 3, 4 and 5 exists in `python/tests/test_rev_investigation.py`
(`test_streaming_emits_plan_steps_evidence_then_final`,
`test_partial_results_survive_one_failing_tool`, follow-up/context tests). Browser-level and
live-provider runs remain outstanding.

---

## 8. Security review

Follow `docs/security/supabase-advisor-triage.md`. It contains the three read-only SQL
queries that close the advisor findings. Do not change production policies before those
queries are run.

---

## 9. Reset and teardown

```bash
# Path A
docker rm -f revluma-staging

# Path B
"$PG/pg_ctl" -D /tmp/revstaging/pgdata stop -m fast
rm -rf /tmp/revstaging /tmp/pgvector /tmp/stagingvenv
```

Recreate by repeating sections 1–2. Nothing outside `/tmp` or the container is written.

---

## 10. Recording evidence

For each section append to `docs/execution/EXECUTION_STATUS.md`: environment, exact
command, observed output, pass/fail, and on failure the defect plus the regression test
that now covers it. Never mark a phase verified from local unit tests alone, and never
claim a live-database run when only a placeholder connection string was used.
