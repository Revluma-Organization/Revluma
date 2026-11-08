# TASK 219 diagnosis — Command Center content hierarchy and visual system

## Scope and evidence boundary

Task 219 maps original Tasks 281–285. It covers `/dashboard/overview`, its `command-center-v1` response and the shared navigation/workspace chrome. Rev investigation, integrations, authentication, tenant authorization and existing routes remain dependencies, not redesign targets. Task 218 initially appeared consolidated into Task 205, but its separate implementation merged into main during Task 219 (PRs #370/#373, main `d9150d65`). The branch was rebased and its `rev-business-health-v1` and `rev-operational-activity-v1` behavior audited and consolidated rather than discarded. No Task 220 work is included.

Before editing, the active Overview, authoritative hook/contracts/components, backend composition, priority investigation handoff, Tasks 216–217 tests, shell/theme/typography, mock analytics, responsive styles and docs were inspected. Public production `/dashboard/overview` redirects unauthenticated visitors to sign-in; the supplied Rev Intelligence screenshot is not Command Center proof. No production merchant values are reproduced in this audit.

## Code audit

- The active Overview already consumed only `/rev/command-center`; orphaned `components/dashboard/*` and `data/mockOverview.ts` still contained presentation-oriented KPI/chart/activity/onboarding concepts but had no active imports. They were removed rather than migrated.
- `command-center-v1` supplies a persisted business snapshot, per-resource freshness, canonical findings and `command-center-priority-finding-v1`. It has no browser tenant/metric override. Missing monetary currency, failed generation and unknown coverage remain unavailable rather than zero.
- Revenue is recorded money for the current UTC day with the prior UTC day as comparison. Orders expose evidence coverage/freshness; no defensible persisted `orders_today` exists, so no order count is invented. Checkouts are recorded open abandoned checkouts in the trailing 48-hour window. Availability evidence is categorical, not a stock quantity. Integration state is independent.
- Existing composition had all authoritative evidence but diluted the hierarchy: headline and priority links, six individually styled cards, activity, then readiness. Task 219 consolidates this into briefing → one priority → five health domains → activity → readiness without a parallel client insight engine.
- Verified activity came from persisted sync times and findings; only findings exposed an exact investigation route. The additive `finding_id` now preserves that route when an activity event represents a finding. System events remain explicitly system-observed, not merchant actions.
- The old sidebar mixed light/dark selectors and contained substantially more navigation/workspace logic than required here. The replacement preserves its existing stores, routes, account actions, theme action and mobile behavior while fixing a dark surface and a light Command Center workspace.
- The active Command Center has no charts. No chart was added because none was required to explain the available authoritative data. Decorative revenue charts and unsupported trends remain excluded.
- Security-sensitive implementation is unchanged: server-derived organization/store access, selected-finding revalidation, signed/authenticated integration flows, read-only recommendations and no autonomous controls.

## State acceptance map

A new merchant, healthy/current snapshot, partial evidence, stale snapshot, unsupported permission, integration failure, API failure, unknown metric/currency/coverage, verified zero, no defensible priority, no activity, finding invalidation and excluded historical findings are distinct. A blue accent does not represent status. Green/red only accompany meaningful positive/negative states and always have words/icons. An em dash means no displayable scalar, not zero.

## Responsive and accessibility acceptance

Required widths are 320, 375, 430, 768, 1024, 1280, 1440 and wider. Contracts use single-column mobile content, two/five-column health at larger breakpoints, a bounded `max-w-[1440px]` workspace, `min-w-0`, wrapping text, long-domain breaking, no data tables and no horizontal carousels. Mobile navigation is an overlay with Escape/overlay close and 44px targets. Native buttons/links/details, labelled sections, heading order, visible focus, reduced motion and text-plus-icon statuses are required.

The automated viewport tests verify layout contracts in jsdom, not browser pixel geometry. Axe checks structural accessibility of priority, health/activity and readiness. Neither substitutes for authenticated browser inspection or assistive-technology testing.

## Reference adaptation

- Shopify Polaris layout/App Home: adapted restrained containers, task-appropriate density, responsive composition and operational empty/setup guidance. Rejected copying Polaris branding/components, Shopify progress/setup cards for an intelligence workspace, and promotional metrics.
- Linear redesign articles/changelog: adapted reduced visual noise, subordinate navigation, clearer active actions, stronger contrast and cohesive chrome. Rejected Linear identity, its issue-list density and unnecessary icon chrome.
- Stripe Dashboard guidance: adapted at-a-glance operational status and direct routes into monitoring/management. Rejected Stripe branding, decorative analytics and any chart lacking an authoritative decision purpose.

## Production limitations

Both backend readiness endpoints are healthy on the verified main revision after the user confirmed deployment. This establishes service availability, not Task 219 behavior. Public Vercel access proves only authentication routing. The active store `revluma-test-store-v1.myshopify.com` could not be inspected in an authorized browser from this environment; no synthetic session, finding, activity or metric was created to bypass that boundary.
