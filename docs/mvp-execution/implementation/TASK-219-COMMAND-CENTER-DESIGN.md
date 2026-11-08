# TASK 219 implementation — Command Center content hierarchy and visual system

## Delivered hierarchy

`Overview.tsx` now has one operational sequence:

1. Store/UTC/snapshot context and manual refresh.
2. Operational briefing with one route to the selected investigation.
3. One top-priority finding with categorical priority/confidence, evidence, UTC comparison, limitations, read-only merchant next step, progressive provenance and Rev investigation.
4. Five health domains: Revenue, Orders, Checkouts, Product availability, Integration.
5. Verified operational activity and exact finding investigation where applicable.
6. Data readiness, limitations, source freshness and unknown semantics.

There is no second client analytics model, overall health score, promotional/setup card, chart, fabricated trend, placeholder event or autonomous action. Lower eligible findings stay subordinate; stale/invalidated findings stay excluded from current priority.

## Visual system

`components/command-center/tokens.ts` centralizes surfaces, typography, borders, controls, statuses, focus and content width. Revluma blue `#1F06AC` is used for primary action/selection and a selective briefing/priority accent. Sidebar `#111318`; light Command Center workspace `#f5f6f8`; white cards with restrained borders and no decorative gradients. Semantic green/red are paired with words/icons.

`Sidebar.tsx` is consistently dark in both workspace themes. Existing navigation destinations, mobile/collapse stores, account actions, theme switching and route behavior remain. The shell has 44px navigation targets, Escape/overlay close, reduced-motion handling, visible focus and long-store-name wrapping. `DashboardLayout.tsx`/`Topbar.tsx` apply the light workspace only to Command Center; unrelated workspace redesign is out of scope.

## Evidence and API behavior

Initial page load continues to use tenant-scoped `/rev/command-center` and `command-center-v1`; request abort/refresh and tenant-scoped clearing are unchanged. During the concurrent Task 218 rebase, its canonical `rev-business-health-v1` and `rev-operational-activity-v1` projections were composed into that response instead of retaining separate initial panel fetches. The Command Center reuses the already evaluated integration state for health coverage. Activity pagination alone calls the existing store-scoped `/stores/:storeId/business-activity` endpoint. Persisted finding activity carries `finding_id` for exact `/rev/findings/:id` revalidation; integration/webhook/sync activity routes only to Integrations.

The canonical health presentation uses rolling seven-day current/comparison windows and preserves revenue currency, actual order counts, abandoned checkouts, product availability, canonical integration state, categorical business severity and independent data quality. The legacy day-snapshot metrics remain in `command-center-v1` for briefing compatibility and fallback coverage, not a duplicate production view. Missing values/currency are em dash/unavailable, never zero; verified zero remains zero. Empty activity says that no activity could be confirmed and allows either no matching records or unavailable source evidence; it never claims that nothing happened. No schema migration is needed.

## Removed duplication

Orphaned legacy `components/dashboard/*` presentation components and `data/mockOverview.ts` were removed after an import audit. Task 218’s then-new duplicate standalone panels were also superseded by the consolidated sections while preserving their unique data, pagination, failure and routing behavior. Test fixtures live only under `src/test/`; production modules do not import them. `BusinessOverview` remains only an alias of `HealthIndicators` for compatibility, not a second view.

## State and responsive behavior

Loading/refresh, empty activity, no priority, new synchronization, partial/stale/unsupported/unknown states, integration/API failures and invalidated findings have explicit bounded copy. The health grid is single-column at base, two-column from `sm`, five-column from `xl`; the workspace is bounded and clips only accidental horizontal overflow, not content. Native disclosures retain detailed evidence without mobile tables.

## Regression preservation

Tasks 216–217 Overview suites remain and pass, alongside three revised Task 218 consolidation scenarios. The full Dashboard suite includes Rev evidence, selected-finding revalidation, integrations, auth/theme and stream behavior. Backend priority/composition tests remain green. Authentication, tenant scoping, integration authorization and read-only contracts were not relaxed.

## Remaining acceptance boundary

This is an implementation record, not proof of authenticated production acceptance. Route-level E2E uses the real Overview and Rev components with deterministic mocked APIs; axe/jsdom viewport checks are not real-browser screenshots or assistive-technology certification. Actual active-store states and all required physical viewport widths still require an authorized browser session. See the validation report for exact gates and deployment evidence.
