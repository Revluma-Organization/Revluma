# Task 234 — 48-scenario regression matrix

**Acceptance source:** the task owner confirmed this repository matrix as the authoritative 48-scenario acceptance list for Task 234. The 48 IDs below define the scenario scope; the additional inventory and adversarial regression assertions are supplemental.

Automated implementation: `python/tests/test_rev_task234_end_to_end_matrix.py`. The parameterized cases assert response content/metadata plus tool dispatch, evidence, provider calls, persistence, or orchestration side effects. Provider tests use fakes and do not make external model calls.

| IDs | Category | Scenario coverage |
|---|---|---|
| G01–G08 | General knowledge | What is Shopify; define average order value; explain customer lifetime value; meaning of conversion rate; gross margin; abandoned checkout; inventory turnover; refund rate. Checks deterministic definition routing, answer payload, no store tools/evidence/specialists, and correlation/execution IDs. |
| A01–A08 | Advisory | Improve checkout completion; reduce cart abandonment; grow repeat purchases; increase average order value; avoid refund spikes; improve inventory turnover; improve product conversion; reduce churn. Checks advisory answer and no store evidence work even with a prior revenue investigation. |
| I01–I08 | Investigations | Yesterday's revenue; last week's order count; current-month checkout abandonment; repeat customers; out-of-stock products; last month's refunds; first store priority; Shopify synchronization health. Checks read-only tool dispatch, exact intent, empty unavailable evidence, and non-success evidence outcome. |
| C01–C08 | Continuity/topic changes | “Why?”; “Continue”; “What about last week?”; correction (“That's wrong”); “Anyway, what is Shopify?”; thanks; “What about checkout?”; “Change of subject: define AOV”. Checks inheritance/correction/social/knowledge routing, topic reset, and correlation metadata. |
| P01–P08 | Provider policy/failure | Missing key; permanent auth failure; permanent unknown model; same-provider transient recovery; explicitly configured cross-provider recovery; no implicit cross-provider transfer; grounded-search compatibility; bounded exhaustion. Checks number of attempts, destination, timeout, error category, truthful exhaustion and prompt/key privacy. |
| O01–O08 | Orchestration | Revenue-only, checkout-only, integration-only, operational-only, retention-only, revenue+checkout, three domains, bounded specialist retry. Checks tenant scoping, requested domains/tools, de-duplication, deadlines, and retry side effects. |

The same test module has one additional inventory assertion that the six groups total exactly 48 unique scenario IDs; it is not one of the 48 behavior cases.

## Local verification record

- Focused Python matrix: **51 passed** (48 parameterized behavior cases, the unique-ID/inventory assertion, and two adversarial regressions for exhausted provider and permanent specialist failure).
- Consolidated Task 234 Python run (matrix, model gateway/fast fallback, provider policy, metrics, orchestration traces, investigation, architecture, failure routing, and question orchestration): **174 passed**.
- Latest full local Python run: **2,412 passed, 11 skipped** across `python/tests`. Optional conversational/knowledge composers are replaced with deterministic test doubles in the contract suites; provider-gateway tests remain separate and exercise provider behavior through fakes. A local placeholder PostgreSQL URL was configured for pool/diagnostics tests; it pointed to an unreachable loopback port and no database transaction succeeded.
- Follow-up after the previous CI provider failures: the four conversational contract modules and scheduler-trigger API test passed locally (**45 passed** across epistemic/adaptive/contextual/greeting; scheduler assertion **1 passed**). Additional provider-dependent regression modules passed **95/95** with the shared offline composer fixture.
- Latest verified frontend results remain: **58 dashboard test files / 1,393 tests passed** locally, with targeted API frontend tests **9 passed**. The full dashboard suite and build also passed in the prior CI run. Node conversation persistence/recovery and metrics subset previously passed **63 tests**; these Node subsets were not rerun during this continuation.
- GitHub CI on code head `4983814e29e89847a76b97b295e118da6eb6029c` passed all reported checks: Python regressions, the Python suite in release-candidate verification, backend and dashboard suites/build, Prisma bootstrap/schema-drift/migration/financial/security regressions, and Vercel. This clears the earlier Anthropic `provider_unavailable` failures after adding provider-independent composer fixtures. The PR remains open/draft; CI success is not production acceptance.
- Tests use local or disposable synthetic fixtures; no authenticated production traffic, live provider request, deployed candidate backend revision, or production database transaction was exercised.
