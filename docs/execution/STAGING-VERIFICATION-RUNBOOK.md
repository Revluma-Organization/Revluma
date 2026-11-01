# Staging verification runbook — Rev Intelligence release candidate

Everything in this runbook is an action this environment could not perform: CI, a staging
database, a deployed Python service and a real Shopify test store. Each step lists the exact
command, what to look for, and what evidence to paste back into
`docs/execution/EXECUTION_STATUS.md` and `docs/rev-intelligence/RELEASE-CANDIDATE-REPORT.md`.

Do not mark a phase verified on the strength of local tests alone. Record the environment and
the run id with every result.

---

## 0. Prerequisites

| Requirement | Why |
| --- | --- |
| Branch `arena/bbc48aa5-revluma` pushed and a pull request opened | CI only runs on `pull_request`/`push` |
| Staging Postgres/Supabase URL with migration rights | Migration `20261101120000_rev_financial_integrity` has never been applied |
| Deployed Python service with `ML_INTERNAL_KEY` | Needed for streaming end-to-end |
| Shopify test store (development store) with order + abandoned-checkout webhooks | Needed for ingestion, refund and currency verification |

---

## 1. CI (closes blocker 1)

Open the pull request, then confirm all three workflows run on the branch:

1. `backend-tests.yml` — `npm ci && npm test`. This is the **only** place the Prisma-backed
   suites can run; local runs cannot load Prisma Client.
2. `rev-python-tests.yml` — now pinned to `python-version: '3.11.9'`. Confirm the log prints
   `Python 3.11.9`.
3. `dashboard-auth-regression.yml` — now runs the full Vitest suite (19 files, 120 tests) and a
   production build.

**Pass criteria:** all three green on this branch, with the run URLs pasted into the status doc.
**If red:** copy the failing job log; do not retry blindly — the local suites pass, so a CI-only
failure usually means a Prisma schema/generate mismatch or an environment variable.

```
gh pr checks <PR-number> --watch
gh run list --branch arena/bbc48aa5-revluma --limit 10
```

---

## 2. Migration (closes part of blocker 2)

Apply **only in staging**:

```
cd Backend
DATABASE_URL=<staging> npm run migrate:deploy
```

Then verify the schema changes actually landed:

```sql
-- ledger table for cancelled-order tombstones
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'order_cancellation_tombstones';

-- per-customer LTV currency (added columns, intentionally nullable)
SELECT column_name FROM information_schema.columns
WHERE table_name = 'customers' AND column_name IN ('ltv_currency','ltv_mixed_currency');

-- currency columns still default to 'USD' for pre-existing rows? Confirm and record it.
SELECT column_default FROM information_schema.columns
WHERE table_name = 'orders' AND column_name = 'currency';
```

**Pass criteria:** tombstone table exists with the composite primary key; both LTV columns exist.
**Known gap to record:** `orders.currency` and `abandoned_carts.currency` are still DB-defaulted
to `"USD"`. Ingestion now rejects an order/cart without a verified currency code, but any
historical row written before this change still carries a default that was never observed. Do not
report those rows as verified USD; they are the reason the LTV and revenue totals are qualified.

---

## 3. Shopify test store (closes blocker 3)

Connect a development store and drive these webhooks deliberately.

| Scenario | How to trigger | Expected |
| --- | --- | --- |
| Order with a non-USD currency | Place an order in a second currency | Row stores that currency; no `ORDER_CURRENCY_UNVERIFIED` |
| Partial refund | Refund part of an order in Shopify admin | Net total = gross − successful refunds; no double subtraction |
| Full refund | Refund the whole order | Net total 0 |
| Pending/failed refund | Create a refund with a pending transaction | Net total unchanged; pending amounts ignored |
| Cancel, then delayed create | Cancel the order, replay the original `orders/create` | Order stays cancelled; no resurrection |
| Create, then cancel, then update | Out-of-order delivery | Cancellation stays terminal |
| Abandoned checkout with a value | Abandon a checkout | Cart value + currency persisted; no default USD |
| Malformed amount | Replay a payload with a non-numeric total | Rejected with a typed `*_UNVERIFIED` code, not stored as 0 |

**Pass criteria:** every row above behaves as described, and `financialIntegrity` codes appear
only for genuinely malformed/unknown data. Capture the app log lines and the resulting rows.

---

## 4. Streaming end-to-end (closes blocker 4)

With Node and Python deployed against staging:

1. Open Rev Intelligence, ask "What happened to my revenue last week?".
2. Confirm the investigation timeline appears **before** the answer, then evidence frames, then
   the final answer with an evidence count.
3. Open the evidence drawer: every amount must show a currency, a period, a source, a definition
   and a stable `ev-…` id; mixed-currency stores must show separate currency sections.
4. Press **Stop** mid-answer: the UI must show "Generation stopped" with Regenerate; the database
   must contain one cancelled assistant turn, no duplicate user turn.
5. Press **Regenerate**: the previous answer is replaced; `SELECT sequence_number, role FROM
   conversation_messages WHERE conversation_id = … ORDER BY sequence_number` must show exactly
   one user turn for that question.
6. Force one specialist to fail (e.g. revoke the cart table grant in a throwaway schema): the
   answer must keep the other specialists' results and display "Some checks could not complete".
7. Reload the conversation: the answer, its steps and its evidence drawer must rehydrate from
   persistence (no data loss, no second user turn).
8. Search a word from the answer in the rail: the conversation must appear.

**Pass criteria:** all eight steps behave as described, recorded as screenshots or a screen
recording plus the relevant SQL output.

---

## 5. Read-only guarantee (spot check)

```
POST /api/v1/rev/chat   {"message":"change my prices","execute":true}   → 403 READ_ONLY
POST /api/v1/rev/stream {"message":"change my prices","execute":true}   → 403 READ_ONLY
GET  /api/v1/rev/tools                                                 → no mutating tool
```

Also confirm no Shopify write scope was exercised during the whole run (check store audit log).

---

## 6. Recording the result

For each section, append to `docs/execution/EXECUTION_STATUS.md`:

- environment (staging URL / store domain / Python revision),
- exact command or UI steps,
- observed result,
- pass/fail,
- and, on failure, the blocking defect with its own regression test once fixed.

Only when sections 1–5 all pass may a phase in `docs/execution/EXECUTION_STATUS.md` move from
PARTIALLY COMPLETED to FULLY COMPLETED.
