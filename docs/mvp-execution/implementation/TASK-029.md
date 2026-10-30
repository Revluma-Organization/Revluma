# TASK 029 — Ensure checkout completion overrides abandonment
Date: 2026-10-30. Phase 1, workstream 1B. Baseline: main 8bd8245a5ffdd0ab4c421f269e281f19c11f1b28. Branch: fix/mvp-task-029-completion-overrides-abandonment. Production alignment: NOT DEPLOYED.
## Prior evidence and scope
Reviewed Task028 source-identity report, Task025–027 reconciliation implementation and checkoutInactivity.js. Approved Shopify-only read-only MVP; no recovery campaigns or Shopify writes.
## Initial state / lifecycle
abandoned_carts.status is pending, abandoned or recovered; recovered_at is completion evidence timestamp, abandoned_at preserves historical activity. Orders use abandoned_cart_id for verified relationship; orders.recovery_status='completed' is NOT campaign attribution. Checkout webhooks use completed_at through nextCheckoutStatus(), which preserves recovered status; 15-minute threshold in checkoutInactivity.js is unchanged. Order upsert previously persisted FK without completing linked checkout.
## Evidence and precedence design
A Shopify checkout completed_at marks its own checkout recovered. An order only completes a checkout when the existing merchant-scoped reconciliation persists orders.abandoned_cart_id. In the same PostgreSQL transaction, updateMany changes abandoned_carts.status to recovered and recovered_at to orders.ordered_at if not already recovered. No customer/email/amount/coupon fallback; ambiguous and rejected ownership claims never gain FK. Repeated events retain first completion timestamp. Existing checkout webhook completion timestamp is authoritative where available. A verified order timestamp is used when no checkout timestamp exists; it is not claimed to be Shopify checkout completed_at.
## Modified code / safety
Backend/src/services/commerceWebhookService.js upsertOrder: transactionally update only verified merchant-owned checkout and preserve attribution_channel and order total. No schema change. Existing checkout upsert maintains recovered state. Source identifiers remain unchanged. Cross-merchant FK not accepted. Atomic update prevents intermediate status contradiction; existing checkout row is updated inside order transaction.
## Known limitations
Order-first arrival before checkout creation is NOT reconciled automatically by this patch; separate Task031. Delayed checkout event precedence broader scenarios Task030. Some historical legacy records cannot match typed identifiers without source evidence (Task028). Checkout status string 'recovered' is legacy nomenclature for completed; Tasks046–047 address semantics. Classifier, active metric queries, and concurrency still require comprehensive inspection. Live Shopify lifecycle not executed. No production changes authorized.
## Validation
Isolated PostgreSQL test runner Backend/src/tests/task029Completion.integration.js, workflow .github/workflows/task029-completion.yml. TC029-01,02,03,08,09,16,17,26,35,38,39,45 authored. Tests awaiting GitHub Actions; **NOT RUN** at documentation time. Remaining TC029-04–45 not covered by these 12 tests remain NOT RUN (except those explicitly listed). No acceptance claim for 45/45.
## Findings / decisions
REV-FIND-029-01: HIGH order-based completion previously missing; code fix pending CI, status IN PROGRESS.
REV-FIND-029-02: HIGH order-first checkout arrival requires subsequent reconciliation; OPEN, Task031.
REV-FIND-029-03: HIGH metric/classifier/concurrency verification incomplete; OPEN, Task029.
REV-DEC-0010: Verified order FK, not weak resemblance, authorizes completion. Conditional merchant-scoped update inside order transaction; no campaign attribution. Alternative: independent nontransactional status update (rejected).
## Release
Branch only; no merge, production migration or deployment. **PARTIAL — IMPLEMENTED, NOT DEPLOYED; 45-case acceptance pending.**

## Verification follow-up (2026-10-30)
Initial CI on c12ac576: Task029 12/12 PASS; backend tests PASS; backend refresh PASS; Task025 PASS; Task026 PASS; Task027 39/40 (TC027-32 obsolete pending assertion); Task028 43/44 (TC028-43 obsolete null completion assertion). Both legacy assertions corrected to assert the new verified-completion semantics, retaining rejected-claim protections. Expanded Task029 suite to 45 individually named cases at commit 341b925c; **45-case CI results pending**, not yet certified. Some added tests overlap and do not independently prove concurrency, historical sync or all acceptance semantics. Production verification remains outstanding. No merge/deploy.

## Verified release-gate evidence (2026-10-30)
Commit d9b50de9495d183b3916b5a6c6d3f0971170f4cb: Task029 workflow 40996339128 PASS (45/45); Task028 40996339201 PASS; Task027 40996339181 PASS; Task026 40996339118 PASS; Task025 40996339086 PASS; Backend tests 40996339146 PASS; Backend refresh 40996339085 PASS. TC029-06 asserts weak cart-token-only match does not force completion; TC029-40 corrected Prisma relation name to orders. All seven workflows green. Live Shopify end-to-end and broader event concurrency/metrics acceptance remain unverified; green tests alone do not certify these. Release subject to deployment verification.
