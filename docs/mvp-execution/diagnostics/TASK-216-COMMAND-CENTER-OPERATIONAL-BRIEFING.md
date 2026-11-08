# TASK 216 — Command Center structure and operational briefing

Status: implemented; production verification pending. Consolidates original Tasks 265–269. Date: 2026-11-08.

## Existing application study

The deployed public application and pitch site were inspected at `https://revluma.vercel.app` and `https://revluma-pitch-deck.vercel.app/`. The public dashboard is authentication-gated; no authorized browser session or browser screenshot runtime was available, so no claim is made about an authenticated live screenshot. Repository UI and deployed revision were compared instead.

The pre-change `Overview.tsx` had a working store/connection header, canonical Task 213 health summary, integration navigation and verified-findings panel. Its stronger reporting, chart, checkout table and old briefing were disabled. The main visible hierarchy was greeting → integration health → two equally prominent operational/Rev promotional panels → findings. Weaknesses: no merchant-facing business-state read API; no business indicators in the active view; no per-resource freshness; the primary area did not lead with a business briefing; repeated feature promotion displaced operational content. Retained: dark shell/light workspace, blue accent, typography, canonical integration state, findings and existing `?finding=<id>` Rev deep link. Redesigned: Overview and the primary content hierarchy. Removed: redundant Rev promotion, operational-health tile grid, greeting-first emphasis and hidden legacy reporting from this page. No disconnected interaction is retained: refresh reads the API, limitation actions open Integrations, finding actions preserve the finding ID.

## Required design-reference record

| Reference | URL | Patterns studied | Adapted for Revluma | Explicitly not copied | Influence on final structure |
|---|---|---|---|---|---|
| Shopify Polaris layout | https://shopify.dev/docs/apps/design/layout | Responsive single-column scanning, grouped sections, 4px rhythm, appropriate density, containers | Briefing-first single column; metric grid only on wider screens; compact grouped evidence | Admin visual identity, web components, brand styling | Main content scans top-to-bottom; two-column only for secondary activity/readiness |
| Shopify App Home patterns | https://shopify.dev/docs/api/app-home/latest/patterns and https://shopify.dev/docs/apps/build/app-home | Homepage compositions, metrics, setup guidance, resource summaries, clear primary action | Real business indicators, bounded setup/unknown explanations, one useful next action | Callout-card feature promotion, Shopify clone, unsupported setup widgets | One operational briefing action; evidence details are progressive disclosure |
| Linear design refresh | https://linear.app/now/behind-the-latest-design-refresh | Quiet chrome, reduced icons/borders, primary content receives attention | Restrained icons, thin neutral borders, compact store/period metadata | Linear navigation, dark palette, exact tabs | Briefing has the only strong left accent; supporting metadata recedes |
| Linear UI redesign | https://linear.app/now/how-we-redesigned-the-linear-ui and https://linear.app/changelog/2024-03-20-new-linear-ui | Alignment, predictable headers, information density, separation of work and metadata | Reused Revluma shell and aligned section headers rather than replacing product chrome | Brand colors and exact workspace layout | Consistent compact section titles and responsive supporting grids |
| Stripe Dashboard | https://support.stripe.com/questions/using-the-stripe-dashboard | At-a-glance account activity, issue-to-record investigation | Summary linked to verified finding investigation; important limits remain visible | Stripe branding, payments data/capabilities, fake alerts | Findings show observation, severity, evidence age and a direct investigation |

Pitch-deck context reinforced the problem being solved—turning fragmented commerce records into an operational decision—not the deck's promotional numbers. None of its illustrative commercial metrics enter the application.

## Actual contracts and diagnosis

`python/src/intelligence/business_state.py` persists `business_states` snapshots every scheduled rebuild. The available authoritative metrics are UTC-day net sales (orders net of refunds; cancelled orders excluded), previous-day net sales and comparison, 48-hour open abandoned checkouts, generation/freshness, computation status and currency-safe warnings. There is no complete monthly P&L, verified order-count/AOV series or reliable inventory snapshot in this contract. Those metrics are deliberately not manufactured.

`rev-integration-state-v1` supplies authorization, per-resource operational state/freshness and coverage. `store_sync_domain_states` supplies each resource's actual last-attempt/success timestamps. `intelligence_findings` supplies verified findings; Rev already resolves `?finding=<id>` server-side and preserves its authoritative context.

## Final hierarchy

1. Command Center title, concise purpose, primary store, current/previous UTC-day context, snapshot age and refresh.
2. One primary operational briefing: situation, priority finding where present, evidence limits and next investigation.
3. Supported business indicators only: today/yesterday net sales, defensible day-over-day percentage, open abandoned checkouts.
4. Verified findings ordered critical/high/medium/low then recency, deduplicated.
5. Operational activity, explicitly split into `system` and `business`.
6. Evidence/data readiness summary and keyboard-native per-resource disclosure.

Mobile remains single-column and contains no wide data table. Desktop uses four metric columns and a two-column secondary activity/readiness grid. No new brand label, animation, illustration, gradient or promotional card was introduced.

## Truth and security decisions

`GET /api/v1/rev/command-center` is authenticated and membership-resolved; the browser cannot supply organization, store, metric or evidence values. Prisma queries use the authenticated organization. `Cache-Control: private, no-store` prevents shared response caching. Frontend requests abort obsolete reads, use one in-flight request per mounted page, refresh every 60 seconds/on focus, and preserve the last explicitly labelled snapshot on refresh failure. No scheduler rebuild is triggered by rendering.

`current`, `stale`, `partial`, `failed`, `unavailable`, and `unknown` snapshot presentation states remain distinct. Resource states include available, stale, partial, unknown, not-yet-synchronized, unauthorized, unsupported and retrieval-failed. Null never becomes zero. Monetary scalars require one verified currency. A zero is called verified only with available source evidence; otherwise it is withheld. Stale values retain their timestamp and are explicitly not current performance.

Briefing composition is deterministic backend code, not AI generation and not a second metric engine. Verified findings outrank calm summaries. No causal attribution, recovery estimate, merchant action, detector coverage or autonomous execution is invented. No-findings copy is bounded by configured checks and observable evidence. The existing UTC snapshot limitation is stated rather than silently relabelled as merchant-local time.
