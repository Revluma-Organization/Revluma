# Task 030 — Controlled production delayed-event replay runbook

## Scope
One test checkout only. Store `revluma-test-store-v1.myshopify.com`; cart `2d713193-4327-4058-8c57-411f318efd3b`; order `5b0ec8a8-4398-4315-9926-86f16e7f59c6`. The original purchase was USD 749.95 on 2026-10-30. Never use other merchants' checkouts.

## Security
`Backend/src/scripts/task030ControlledReplay.js` is an operator-only script, **not an HTTP endpoint**. It does not impersonate Shopify or bypass webhook HMAC verification. It calls the same checkout ingestion service using an explicitly **synthetic older source event**; this proves the service's stale-event guard on the real production checkout but is not proof of a genuine Shopify delivery arriving late. Run only once, with approval, in a controlled backend runtime where the production database is already configured. Do not print secrets or tokens.

## Prerequisites
1. Confirm the production backend deploy is commit `81a217c45041e7132333ed9e5fcb717027a32455` or a later approved release containing the Task030 fix.
2. Run this script from the backend directory after the harness itself has been reviewed, merged, and deployed to the authorized runtime. Do not copy a production DATABASE_URL into chat, GitHub, CI logs, or a local shell.
3. Explicitly set `NODE_ENV=production` and `TASK030_REPLAY_APPROVED=I_APPROVE_ONE_TEST_CHECKOUT` for this one invocation only.
4. Run `node src/scripts/task030ControlledReplay.js` once; remove the approval environment variable immediately afterward.

## Assertions
Preflight requires exact store domain, store/order/cart IDs, amount, completed checkout, matching Shopify checkout token, one linked order, no duplicate checkout, and older synthetic timestamp. The script replays the stale checkout through `upsertAbandonedCart` and checks that status, recovery time, source activity timestamp, checkout identity, order association, uniqueness, and abandonment exclusion remain unchanged.

## Evidence and closure
Capture timestamp, release SHA, exit code, sanitized JSON PASS/FAIL line, and independent read-only post-run DB verification. Any preflight failure means **NOT RUN**, not PASS. If the replay fails, stop and investigate; do not rerun against another merchant. No production verification is claimed until the script actually runs and the independent DB read passes.

## Current status
**PASS — CLOSED (2026-10-30).** Harness merged via PR #226 (merge `51777ed730fcb8d5b88d2879071a6d86f40750a1`). Manual workflow PR #227 (merge `70d0dc0ade993f72b8c794240cf05bb71fa44650`). First dispatch failed before checkout due to working-directory ordering; fixed in `d9b9e8da4e6876a1cb6bf85da98144c699c3dd9f`. Second dispatch, workflow **Task 030 one-time production checkout replay #2**, reported **Success** (34 seconds) on `d9b9e8d`, as shown by GitHub Actions UI screenshot. The guarded replay script is the final job step; workflow success requires it to exit 0. Independent read-only Supabase query after the successful run confirmed cart `2d713193-4327-4058-8c57-411f318efd3b` remains `recovered`, `recovered_at` and `updated_at` both `2026-10-30 08:00:34+00`, order `5b0ec8a8-4398-4315-9926-86f16e7f59c6` remains linked at USD 749.95, linked orders=1, checkout count=1, active abandonment=0. Scope: synthetic stale source event through real production ingestion service; **not** an actual delayed authenticated Shopify webhook delivery. Remove one-time workflow and repository secret after closure.
