# TASK 208 — Diagnosis: intelligence specialist productionization

**Date:** 2026-11-07
**Consolidates:** original Tasks 227–229
**Baseline:** `8b5477c94e5b4249a56a7f8cbb0426bdcb7d6f6f`

## Revalidation

- The working branch and `origin/main` began at the Task 207 merge `8b5477c`.
- Production `/ready` reported Node `8b5477c94e5b` and Python `8b5477c94e5b4249a56a7f8cbb0426bdcb7d6f6f`, with database, Python and Redis ready.
- Inspected Tasks 197–207 implementation records and actual revenue/order/product/integration/evidence-quality/epistemic/outcome code, Python orchestration, Node JSON/SSE validation and persistence, Prisma/RLS conventions, conversation context and existing specialist agents.

## Actual gaps found

1. The canonical investigation retrieved real evidence, but `_run_specialists` returned only secondary BusinessState summaries. Those summaries were not the analysis or evidence authority.
2. The older orchestrator mapped `inventory` to `_NoDataSpecialist`, an explicit placeholder. Revenue/retention legacy agents also contained recommendation language unsuitable for the canonical read-only investigation boundary.
3. Customer evidence returned ordering and inferred first-time counts but no repeat-within-window rate, returning-customer definition, cohort maturity, repeat interval or certified-lifetime gate.
4. Order evidence had lifecycle counts but no disclosed delayed-fulfillment threshold or distinct split-fulfillment measure.
5. There was no shared versioned execution result with all 14 lifecycle stages, independent evidence-reference validation, cross-specialist contradiction handling or specialist follow-up references.
6. Retention trend phrasing could fall back to generic conversation because deterministic business-domain recognition omitted retention vocabulary.

## Existing authorities retained

- Task 198 revenue/currency/coverage calculations; order-line values remain historical line values, not net revenue.
- Task 200/202 order, checkout, product, variant, location and finding evidence.
- Task 201 integration capability and synchronization ledgers.
- Tasks 203–205 evidence quality, epistemics, causation, action and citation controls.
- Task 207 investigation outcomes, integration failures and bounded continuity.
- Existing conversation/message persistence and RLS. No parallel specialist platform, registry, evidence database or action service was introduced.
