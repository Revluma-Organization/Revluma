# C2 final production readiness report

Date: 2026-11-26 UTC (~23:00Z). Intended commit: `9a133438` (#519).
Operator: Splendor. Window: 06:30–07:30 UTC (accepted).
Method: read-only everywhere — repo/CI inspection, local suites, Supabase
SELECTs, operator-supplied endpoint evidence. No freeze, repair, migration,
write, or config change performed.

## Material changes since the maintenance-readiness record

- **main advanced**: #522 "Founding Merchants /waitlist" merged 22:32Z
  (`48957cc`). C2 paths verified byte-untouched (`git diff`
  `9a133438..origin/main` empty for revSequence, revSubmission,
  revController, revConversationPaging, orchestrator, regression test,
  RC workflow). Its migration touches `waitlist_users` only.
- **Production followed**: `_prisma_migrations` now 37 rows with
  `20261127000000_founding_merchant_applications` applied — a backend
  restart/deploy occurred after 22:32Z. The operator's `9a133438` SHA
  evidence is therefore **stale**; current prod SHA is unconfirmed
  (likely `48957cc` if auto-deploy is on — do not assume).
- **C2 migration stamp bumped**: `20261127000000` is now taken in prod.
  New proposal `20261127000000_c2_conversation_message_sequence` →
  **`20261128000000_c2_conversation_message_sequence`**: verified 0 rows,
  sorts strictly last over all 37 applied migrations.
- **Live post-deploy traffic**: newest turn 22:33–22:34Z, user seq 1 + rev
  seq 2, no errors — creation, persistence, ordering, and continuation all
  healthy in production; 0 ties since #519.

## Verdicts

| # | Gate | Verdict | Evidence |
|---|---|---|---|
| 1 | Application deployment | **Blocked by missing access/evidence** | Operator 200s + `9a133438` + readies + `beta_ready` on record but predates the #522 redeploy; fresh SHA curls required. No Render API from here. |
| 2 | Authenticated functionality | **Verified** | Operator: conversations listing 200. Prod data: healthy 22:33Z turn; 0 cross-org messages; local suites green (paging 9/9, tuple 6/6, retry contract, Part A); CI green on main post-#522. Full local `npm test`: 124/134 — 10 failures all environmental (no Prisma engine download, no Shopify network), none C2-related. |
| 3 | Writer serialization | **Verified** | Identical advisory key + tx boundary in Node and Python at the deployed lineage (#522 verified C2-identical); CI two-session proof green on #519; Python 23505 retries once then raises; **0 new ties including post-deploy traffic**. |
| 4 | Recovery readiness | **Blocked by missing access/evidence** | DB + pooler `ACTIVE_HEALTHY`; plan/PITR/retention/recoverable-point/backup-timestamp have no integration path (list/get_project expose no plan or backup fields). Exact dashboard values still outstanding. `pg_dump` procedure specified. |
| 5 | Historical repair readiness | **Requires explicit operator approval** | Preflight exact: 109 groups / 57 convos / 109 excess / all pairs / 0 NULL / 0 non-positive / 0 ambiguous / 0 new; backstop absent (0 objects); §12 procedure + G1–G6 + B4/B6/B7 rulings stand. Added precondition: re-confirm prod SHA at window start; recommend deploy freeze during the window. |
| 6 | UQ migration readiness | **Requires explicit operator approval** | Ready to run only after verified zero-tie repair; stamp `20261128000000` verified absent + sorts-last; SQL byte-identical; fail-closed 23505 on dirty data (disposable-proved). |
| 7 | Resumption readiness | **Requires explicit operator approval** | Procedure ready (§14.6 order); runs after UQ + smokes. |

No gate is Failed. Nothing here authorizes the window.

## Outstanding evidence (exact)

1. Fresh SHA curls (hosts corrected: Node
   `https://revluma-backend-lqve.onrender.com/ready`, Python
   `https://revluma-python-swwk.onrender.com/health`) — record both SHAs;
   maintenance precondition is "SHA known and C2-identical", not a specific
   value, but any value other than `9a133438`/`48957cc` stops the window.
2. Dashboard values: plan, PITR on/off + retention, earliest recoverable
   point, latest backup timestamp + status.

## Single next action (Splendor)

Return the §C results template from `C2-OPERATOR-CHECKLIST.md` with **fresh**
values for A1/A2/B1–B4. On receipt I flip gates 1 and 4 and we proceed to
final authorization — no further audits.
