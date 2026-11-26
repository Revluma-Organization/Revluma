# Phase 5F — Audit Addendum (read-only; no code, data, or deployment changes)

**Date:** 2026-11-26. **Branch:** `arena/40e7bfb5-revluma`.
Supersedes the identified report statements below; all else in
`PHASE-5F-AUDIT-REPORT.md` stands.

## A1. Contrast reconciliation — the report's pass claim was wrong

**Withdrawn:** "14/14 contrast pairs pass (4.48–17.06)". **Corrected: 13/14 pass.**
The minimum pair **fails**: t2 `#64748b` on bg `#f7f8fc` (both values verified at
`RevIntell.tsx:2127-2132`) computes to **4.4841 unrounded (4.48 at 2 decimals)**,
below the WCAG AA 4.5:1 threshold for normal text. Only 1-decimal rounding reaches
4.5, which is not a valid pass claim — the report's "≥4.5:1" phrasing is retracted.

Exact ratios (recomputed, light theme):

| Pair | Ratio | Verdict |
|---|---|---|
| t2 `#64748b` on bg `#f7f8fc` | **4.4841** | **FAIL** (normal text, needs 4.5) |
| t2 `#64748b` on card `#ffffff` | 4.7588 | pass |
| muted `#667085` on bg `#f7f8fc` | 4.6875 | pass |
| strong `#101828` / t1 `#1a1a2e` on bg | 16.7219 / 16.0726 | pass |

Affected text (verified t2-on-page-bg renderings, normal size → criterion 1.4.3):
message action-dock labels — Copy, Read aloud, Helpful/Not helpful, Retry
(`RevIntell.tsx:502-547`, uncarded container on page bg); footer trust line
(`RevIntell.tsx:2603`, inside the bg footer zone `:2586`).
Not affected: rail (always-dark surface), follow-up chips and composer (card bg —
the char counter at `:605` sits inside the carded composer, 4.76 pass).
The 1.4.11 component-contrast reading (3:1) does not rescue button *labels*, which
are text. Fix direction: darken light-mode t2 to the nearest shade computing
≥4.55 unrounded on **both** bg and card (verified-passing family exists, e.g.
`#5d6779` → 5.37/5.70); the exact hex is pinned by a computed-contrast regression
test at implementation, not chosen here. Dimension impact: Workspace UX 62 stands
(the failure was already priced in via H4's evidence-text findings; this adds one
exact defect to H4's fix list).

## A2. Scenario-count reconciliation

**Withdrawn:** "13 A–L scenarios". **Corrected: 13 test functions covering the 12
named scenarios A–L.** Label J is split across two tests —
`test_j_no_valid_findings_is_not_a_fake_priority` (`:408`) and
`test_j_stale_findings_require_reverification` (`:423`) — matching the module
docstring's own "12 named acceptance scenarios (A-L)". The 682-test total and all
pass/fail statements are unchanged.

## A3. Sequence-collision distribution (exact)

Org-wide query (`40fdd008`, `e3a692d9`): **all 78 tied groups are exactly pairs**
(group_size = 2, 78 groups; zero triples or larger). Definitions, distinguished:
*pair/tie-group count* = 78 (number of over-occupied sequence slots);
*affected rows* = 156 of 540 org messages (28.9%); *excess rows* = affected −
groups = **78** (14.4%). The two 78s coincide only because every group is a pair.
Affected conversations: **38 of 116 (32.8%)**. Role composition of the 78 pairs:
user+user 32, rev+rev 32, cross-role rev+user 14 (worst case: ordering across roles
is undefined within the tie). Mechanism (file-verified): three independent
`MAX(sequence_number)+1` allocations race — user insert in
`revSubmission.js:113`, chat rev insert `revController.js:295→:341/:455`, stream
rev insert `:1792→_insertRevMessage` — with no lock and no unique backstop
(`@@index`, not `@@unique`, on `(conversation_id, sequence_number)`).

## A4. Cursor pagination — why tie-breaks alone fail, and the correct fix

Current predicate (`revController.js:682-716`): `sequence_number < before ORDER BY
sequence_number DESC LIMIT N`. With tied seqs straddling the LIMIT boundary,
Postgres returns an arbitrary subset of the tie group; the next page's `< before`
cursor then either re-skips (rows lost — the client cannot self-heal a skip) or
re-emits rows. An `ORDER BY` tie-breaker only stabilizes *within-page* order; it
cannot fix the boundary because a sequence-only cursor cannot name *which member*
of a tie group the page ended on. (Client merge dedupes by id — `RevIntell.tsx`
`new Map(...item.id...)` — so duplicates self-heal; skips do not.)

Correct fix: a **tuple cursor over a total order**. `id` (uuid, unique) makes
`(sequence_number, id)` a total order with no `created_at` needed:
`WHERE (sequence_number, id) < (before_seq, before_id) ORDER BY sequence_number
DESC, id DESC LIMIT N`. Every row is addressable, so no boundary can split an
unnamed group. Compatibility: keep `?before=<int>` with legacy semantics (old
predicate + deterministic tie-break ordering — exact once C2 repair + the unique
backstop make ties impossible); add optional `before_id` (uuid, 400 on malformed,
ignored unless `before` present) selecting the tuple predicate; response
`pagination` gains `next_before_id`; the frontend sends both when available. Keep
the tuple cursor permanently even after repair — it is cheap and robust to any
future tie source.

## A5. Cart identity — proof and limits of (store_id, external_cart_id)

**Holds as the unique identity, with two qualifications (spelling, NULLs):**

1. *Single production writer, both sources.* Sync and webhooks funnel into one
   function — `upsertAbandonedCart` (`shopifySync.js:5` import; webhook +
   `syncAbandonedCheckouts:441` call sites) — whose lookup key is exactly
   `(store_id, external_cart_id)` and which already takes
   `pg_advisory_xact_lock(hashtext(store), hashtext(external))`. The repo's own
   audit register agrees with C1's residual gap: REV-FIND-0015 —
   "advisory lock only for cooperating writer", UNDER INVESTIGATION.
2. *Observed spellings are consistent per source, unmerged across sources.* The 8
   sync rows store the full gid (`gid://shopify/AbandonedCheckout/<id>` —
   `checkout_id` preferred over numeric `id` at `commerceWebhookService.js:712`);
   token-path rows store the `hWNI…` token; one row carries both token external
   and hex checkout token. No cross-spelling collision exists in today's 35 rows
   (`9b7675c3`), but nothing prevents the same checkout arriving once per
   spelling — the unique index fixes same-spelling races only. Required alongside:
   a canonical-spelling rule (registry already declares "Numeric checkout id is
   canonical; tokens are opaque", `resourceRegistry.js:60` — the code currently
   stores gids, i.e. drifted from the registry), multi-spelling lookup fallback,
   and legacy spelling reconciliation.
3. *NULLs: absent today, possible by schema.* 0 NULL `external_cart_id` org-wide
   (`f7058243`); the writer skips empty ids (`:712-713`, never persists NULL);
   but `lume_seed.py:302` omits the column (would write NULL) and the column is
   nullable. Since Postgres unique indexes treat NULLs as distinct, the plan
   (C1) uses a full UNIQUE + NOT NULL (safe: 0 NULLs to backfill) and fixes the
   seed in the same change.
4. *Legacy rows* (22 NULL-source, no tokens, `retrieved_at` NULL): external-only
   identity, unverifiable against Shopify, already excluded from canonical
   abandoned counts by construction (`unknown_lifecycle`) and newest-wins in the
   one deduped aggregate (`business_state.py:1141-1152`).

Dating note: all 10 dup rows were written 10/27 07:12–08:19 without `retrieved_at`,
which current code always sets — the double-insert predates the present hardening
(lock + `retrieved_at` + stale-event guard). The durable fix does not depend on
which revision introduced them.

## A6. Remediation plan (proposed; nothing implemented)

### C1 — cart double-insert (closes REV-FIND-0015)

- *Existing dup reconciliation:* 4 identical pairs → mark one row superseded
  (new nullable self-ref `superseded_by`, excluded from every aggregate; no
  deletion). Conflicting pair ($2,245.85/$1,459.90) → quarantine both rows behind
  a `quarantine_reason` + reconciliation case row, excluded from aggregates until
  re-fetched from Shopify; newest-wins is forbidden for conflicting values.
- *Migration:* (1) assert 0 NULL `external_cart_id`; (2) reconciliation update;
  (3) `ALTER TABLE … ADD CONSTRAINT uq_carts_store_external UNIQUE
  (store_id, external_cart_id)` + `SET NOT NULL` (small table; plain DDL is safe,
  no CONCURRENTLY needed); (4) Prisma `@@unique([store_id, external_cart_id])`.
  *Rollback:* `ALTER TABLE … DROP CONSTRAINT` (+ keep columns; data already clean).
- *Idempotent ingestion:* replace findFirst+create with Prisma `upsert` on the new
  key in `upsertAbandonedCart` (keep the advisory lock as defense in depth);
  canonical-spelling rule + multi-spelling lookup; fix `lume_seed.py` to emit
  stable `external_cart_id`s. Files: `commerceWebhookService.js`, `shopifySync.js`
  (spelling), `schema.prisma` + migration, `lume_seed.py`.
- *Regression tests (disposable Postgres, per `backend-tests.yml` pattern):*
  concurrent `upsertAbandonedCart` ×8 same checkout → exactly 1 row; conflicting
  value → quarantine case, still 1 live row; empty external id → skip;
  cross-spelling (gid then token) → 1 row via lookup fallback; seed determinism.
- *Contract protection:* no API/payload shape changes; canonical
  `checkout_evidence` untouched (it was already correct); finding/aggregate
  outputs change only by excluding dup/quarantined rows (before/after counts in
  the PR).

### C2 — duplicate sequence numbers (+ M3 paging)

- *Atomic allocation, every write path:* wrap the three allocation sites
  (`revSubmission.js` accept, `revController.js:295` chat, `:1792` stream) in
  `pg_advisory_xact_lock(hashtext(conversation_id))` — same precedent as the cart
  path; `_insertRevMessage` callers and retry-then-`chat` inherit coverage.
  Python writes no `conversation_messages` rows (verified: all 4 INSERTs are
  Backend). Add `UNIQUE(conversation_id, sequence_number)` as a loud backstop.
- *Tie repair (38 convos, approval-gated, offline):* per conversation, in one
  transaction under the same advisory lock: dense-renumber by
  `(sequence_number, created_at, id)`; verify 0 ties + message_count reconciliation
  report (counts only, no silent drops). *Rollback:* pre-migration snapshot restore
  for data; code rollback independent (additive cursor params).
- *Deterministic ordering + cursor compat:* `ORDER BY sequence_number DESC, id
  DESC` in `getConversation`; tuple cursor per A4 (`before` legacy + optional
  `before_id`, additive `pagination.next_before_id`); frontend sends both.
  Files: `revSubmission.js`, `revController.js`, `schema.prisma` + migration,
  `RevIntell.tsx` (cursor send only).
- *Regression tests:* parallel accepts ×10 → 10 unique contiguous seqs; parallel
  chat+stream → no ties; fabricated-tie paging → tuple cursor yields every row
  exactly once across pages; legacy `before` unchanged without `before_id`;
  unique-violation test proves the backstop fires (not silent ties).
- *Contract protection:* SSE/retry/restore/idempotency untouched; paging wire
  format stays ascending; `offset` still ignored; 5D retry re-enters the same
  locked allocation.

### H1 — invalid cart metrics (consumes C1)

- *Every affected consumer (verified):* `dashboardController.js:43-69`
  (`totalAbandoned` count, `atRiskCarts` SUM → "$X at risk" KPI — unprotected);
  `intelligenceFindingsAggregator.js:699-735` (`openAbandonedCount/Value`, raw 30d —
  live finding today 11/$9,992.50 verified equal to raw rows, `f3d641c8/b82e78ca`,
  dups outside the window *today* but the pipeline has no guard);
  `business_state.py:1139-1164` (deduped ✓, status-based 48h — add quarantine
  exclusion); surfaces `CartRecovery.tsx` (dup rows listed separately + KPI),
  `RevVerifiedComparison.tsx:36`/`revComparison.ts:29` (backend-text parse),
  `priorityFindingService.js:344-345`; recommendation wording
  `investigation.py:2688-2690` ("Deduplicated…" — honored post-fix).
  `checkout_evidence.py` canonical path: correct, becomes the single accessor.
- *Fix:* one canonical checkout-metrics accessor (canonical classes + newest-wins
  dedup + quarantine/superseded exclusion); rewire aggregator + dashboardController
  to it; finding basis switches to canonical abandoned count. **Intended behavior
  change, stated plainly:** this store's `abandoned_checkouts_open` evidence goes
  11 → 0 with before/after proof in the PR; the finding text already disclaims
  conversion/recovery inference and stays.
- *Migration/rollback:* code + constraint only (C1's); no data rewrite. Rollback =
  revert to status-based queries (one commit).
- *Regression tests:* fixture with dup + quarantined + unavailable + unknown rows →
  aggregates count only live canonical rows; finding null when canonical count is 0;
  KPI "at risk" excludes quarantined; golden on this store's expected 11→0 flip.
- *Contract protection:* evidence schema `rev-evidence-v2` unchanged (values only);
  5E payload-limits map untouched; no new claim classifications.

### H3 — double-submit (rescoped by evidence)

Current `RevIntell.send` is already hardened (draft-stable `request_id` via
`draftSubmissionRef` + synchronous `turnPendingRef` guard, `:1524-1555`); the DB
pairs predate it or came from other clients. Remaining work: (a) `CopilotPanel`
passes no `requestId` (`:118` → fresh UUID per send; `pendingRef` covers
double-click only) — add draft-stable id for parity; (b) Enter auto-repeat guard
(`e.repeat` / 1s window) in both composers; (c) scripted/API clients are unfixable
client-side — covered by H2 process controls, not code. Files: `CopilotPanel.tsx`,
`RevIntell.tsx` (guard only), no backend change (409 `REQUEST_ID_REUSED` semantics
already correct). *Tests:* double-Enter → one submission, one `request_id`;
retry-before-acceptance reuses id; post-acceptance new turn mints new id; server
409 on cross-message id reuse (extend existing). *Rollback:* trivial (guard-only).
*Contract protection:* idempotency key and 5D retry/rehydrate flows untouched.

### H2 — eval traffic in merchant history (process-first, no code)

Immediate, no deployment: scripted runs move to dedicated sandbox orgs; harness
tags conversations (user-agent + `metadata.source`, no schema change); history-hygiene
policy doc. Approval-gated annotation (not deletion) of the 9/15 + 8/20 bursts via
`conversations.metadata` JSON update, with a SELECT-first candidate list and
rollback by restoring prior JSON. *Tests:* harness-config test asserting sandbox
org id in non-prod runs; policy checklist in the eval README. No contract impact.

### H4 — sub-10px type + the A1 contrast failure

Tiers (all ≥ MASTER 10.5px eyebrow floor unless noted): state pills, class badges,
evidence status badges, citation markers, severity/category/mode chips, disclosure
eyebrows → `0.75rem`; evidence definitions/limitations/provenance and limitation
lines → `0.78rem`; rail meta/footer/count/timeline/copilot labels → `0.75rem`
(8.4px copilot hint included); preserve nowrap + atomic live regions (skill rule).
Contrast: darken light t2 per A1 (criterion ≥4.55 unrounded on bg and card).
Files: `rev/*.tsx` (RIV/RAV/EP/CC/IT), `RevIntell.tsx`, `CopilotPanel.tsx`,
`index.css` (t2 value if centralized, else call sites). *Tests:* allowed-size
allowlist test (no font-size < 0.75rem in Rev surfaces except documented); computed
WCAG test over the theme pairs (t2/bg must pass); Appendix-B visual matrix remains
the real gate (user/CI-run). *Rollback:* single styling commit revert.
*Contract protection:* zero payload/logic change; 5E presentation helpers and the
payload-limits doc untouched; snapshot churn reviewed line-by-line, not bulk-updated.

## A7. Final implementation sequence (proposed)

1. **H2** — process controls + sandbox orgs (unblocks honest future measurement; no code).
2. **C2** — allocation locks → tie repair (gated) → unique backstop → tuple cursor
   (highest reliability leverage; makes paging exact).
3. **C1** — reconciliation (gated) → UNIQUE+NOT NULL → upsert + spelling rule + seed fix.
4. **H1** — rewire consumers to the canonical accessor; 11→0 finding flip with proof.
5. **H3** — CopilotPanel parity + Enter guards + tests.
6. **H4** — type tiers + t2 contrast fix + computed-contrast tests.
7. **M/L sweep** — M1/M5/M8, L-fix1–3, then Appendix-B matrix (user/CI) as the
   visual gate before any release claim.

Per-fix gates (standing rule): targeted regression tests incl. concurrency where
marked, full suites green, CI pass, prod deploy READY/PROMOTED with before/after
evidence. STOPPED for approval — nothing above has been implemented.
