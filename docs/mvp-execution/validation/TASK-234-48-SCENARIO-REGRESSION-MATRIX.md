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
- Full `python/tests` collection is **blocked** by optional project dependencies absent from this sandbox (`mlflow`, `fastapi`, and `pandas`); the above focused suite itself collects and passes.
- Targeted Node conversation persistence/recovery, stream contract, investigation/orchestration trace, provider failure, and metrics tests: **63 passed** in this continuation. Dashboard stream tests: **10 passed** and production Vite build succeeded earlier (with the repository's existing large-chunk warning); those frontend results were not rerun here.
- Full Backend test script was blocked before completion because Prisma Client generation tried to fetch its engine from `binaries.prisma.sh`, which is unreachable in this sandbox. `npm ci --ignore-scripts` completed, but no generated Prisma client was present for the full suite.
- Tests use local synthetic fixtures; no authenticated production traffic, live provider, deployed backend revision, or production database was exercised.
