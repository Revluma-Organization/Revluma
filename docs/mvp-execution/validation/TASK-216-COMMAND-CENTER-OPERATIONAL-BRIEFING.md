# TASK 216 validation — Command Center

## Fixture-verified scenarios

| Scenario | Backend | Frontend | Integrity assertion |
|---|---:|---:|---|
| A — healthy sufficient evidence | PASS | PASS | Calm snapshot summary; no artificial issue |
| B — verified revenue deterioration | PASS | PASS | Verified finding leads; cause remains unestablished |
| C — inventory unavailable | PASS | PASS | Local limited access; no zero-stock conclusion |
| D — stale evidence | PASS | PASS | Historical values labelled stale and dated |
| E — new merchant/insufficient history | PASS | PASS | No fabricated comparison/history |
| F — no verified findings | PASS | PASS | Bounded by checks and observable evidence |
| G — contradictory/unknown financial evidence | PASS | PASS | Currency/value withheld, unrelated evidence retained |
| Partial initial sync | PASS | PASS | Explicit preparation state |
| Disconnected integration | PASS | — | Not misreported as business decline |
| Failed business-state generation | PASS | — | No successful snapshot claim or indicators |

Additional backend scenarios: current/stale/partial/failed/unavailable/unknown, metric UTC/currency/provenance, verified zero, weak hypothesis/invalid evidence suppression, severity priority, duplicate suppression, finding ID preservation, per-resource freshness, unauthorized/unsupported/retrieval failure, tenant isolation, no unsupported causal/recovery claim. **25/25 PASS**.

Additional frontend scenarios: section order, no promotional cards, reporting period/store identity, metric definitions, finding navigation, activity labels, error recovery, refresh, keyboard-native disclosure and overflow-safe mobile structure. **16/16 PASS**.

Task 213/214-adjacent and finding-context regressions: **56/56 PASS**. Integration contract assertions: **PASS**. Dashboard production build: **PASS**.

## Live verification ledger

- Active store: `revluma-test-store-v1.myshopify.com`.
- Production current snapshot exists and is complete; production snapshot fields were read directly and recorded in the implementation report.
- PR #368 merged as `6ac522449c91bb59bdd6a1b53fe81342b83db1be`; post-merge backend checks and Vercel commit deployment status passed.
- Actual authenticated `GET /rev/command-center`, store identity, UI figures/findings, evidence timestamps and Rev deep-link acceptance: blocked because the Render API host reported **“This service has been suspended by its owner.”** No infrastructure change was attempted.
- Desktop/mobile deployed screenshots: blocked by unavailable authenticated browser session/browser runtime. No screenshot claim is made.
- A successful HTTP response alone will not be treated as evidence that briefing claims are correct; response values must be compared with the recorded snapshot and integration ledgers.

Full local verification: **25/25 Command Center backend**, **56/56 integration/finding regressions**, **16/16 Command Center frontend**, **598/598 full Dashboard across 41 files**, integration contract, TypeScript and production build passing. The locally Prisma-blocked optional suite passed in CI. Task 216 is implementation/CI/deployment verified but **not fully production accepted** until the backend is available and the authenticated API/browser checks above are completed.
