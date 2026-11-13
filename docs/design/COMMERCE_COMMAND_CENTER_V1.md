# Revluma — Commerce Command Center
## Product experience audit & redesign specification (v0.1, 27 October 2026)

**Status:** Design proposal; not an approved feature contract or deployed implementation.  
**Positioning:** AI Operational Intelligence for Commerce.  
**Product promise:** Know what matters. Understand why. Take action.

### 1. Repository-grounded audit

| Existing route | Observed implementation | Experience issue | Proposed role |
| --- | --- | --- | --- |
| `/dashboard/overview` | Many independent widgets: KPI, revenue chart, activity, sequences, products, AI insights, attribution, health, analytics strips, quick actions | Metrics compete for attention; no dominant merchant decision | Command Center |
| `/dashboard/cart-recovery` | Live `/dashboard/cart-recovery` endpoint; three stat tiles, checkout table, 15-second refresh | Repeats abandoned checkout reporting; no investigative action; data reconciliation outstanding | Recovery Opportunities |
| `/dashboard/rev-intell` | Real conversation routes, structured AI response types, prompt starters | Separate chat destination instead of contextual assistance attached to business evidence | Rev Intell + contextual investigation drawer |
| `/dashboard/customers` | Customer segmentation, customer table and totals; audit has not established complete production data provenance | Segments are displayed without immediately explaining what merchants should do | Customer Opportunities |
| `/dashboard/campaigns` | Placeholder route | Navigation implies functionality not delivered | Keep labeled Coming soon until actionable |
| `/dashboard/analytics` | Placeholder route | Competes with Shopify reporting while not implemented | Performance & Outcomes (later) |
| `/dashboard/integrations` | Real Shopify setup/retry/status UI, WooCommerce component | Setup is a technical workflow; should be surfaced as operational health | Connections under Settings + attention banner |
| `/dashboard/beta` | Placeholder route | Adds noise | Move to settings/labs |
| `/dashboard/settings/*` | Mix of real account/workspace/billing screens and placeholders | High navigation complexity | Consolidate secondary configuration |

**Confirmed design debt:** `src/data/nav.ts` uses feature-first groups (Core, Recover, Grow, Analyze, Settings); `src/lib/DesignConstants.ts` defines limited shared tokens while pages also use independent HSL utility colors and glass styles. Sidebar uses perpetual decorative motion, potentially distracting from operational work.

### 2. Merchant jobs to be done
1. In under 10 seconds, understand the single most consequential change since last visit.
2. Know what is verified, what is inferred, and what is unknown.
3. Open supporting evidence for any claimed opportunity.
4. Approve, configure, or dismiss a *real supported action*.
5. See whether an action was executed and what outcome was observed.
6. Find integration and data-health problems without reading infrastructure logs.

### 3. Proposed information architecture
**Primary navigation:** Command Center / Opportunities / Rev Intell / Automations / Performance.  
**Secondary:** Customers / Connections / Settings.  
**Migration:** Preserve existing routes as redirects or aliases until new pages ship. Do not turn placeholder destinations into false promises.

### 4. Command Center: layout contract
**Top:** store selector, data freshness, connection health, global search, contextual Rev Intell.
**Primary region:** `Needs attention` list (max 3-5 prioritized cards) with title, verified evidence, impact *when measurable*, status, and a single next action.
**Secondary region:** `Revluma at work` operational timeline: pending, running, succeeded, failed, requires approval; statuses must come from backend records.
**Tertiary region:** `Outcomes` with recovered revenue only when attributable; otherwise explain attribution unavailable.
**Lower priority:** expandable charts and full metrics, never the hero by default.
**Empty state:** connected but no opportunities => explain monitoring coverage and next expected signals; disconnected => single Connect Store action; failed sync => repair path.

### 5. Opportunity investigation workspace
**Layout:** list / evidence timeline / decision panel, collapsing to tabs on mobile.
**Evidence timeline:** checkout observed, last checkout update, abandonment eligibility threshold, order completion, available contact, recovery action and delivery outcome; only show events actually stored.
**Decision panel:** classification (Observed / Inferred / Unknown), reason, confidence *only if backed by calibrated model evidence*, proposed action, eligibility/consent, impact range only if computed, approve/dismiss controls only when backend supports them.
**Statuses:** Observed → Eligible → In review → Action queued → In progress → Completed / Failed / Dismissed. These are **proposed UX labels**; backend mapping and persistence require a separate contract.
**Critical guard:** A 15-minute inactivity threshold is a product heuristic, not proof of Shopify-defined abandonment or customer departure.

### 6. Design system v0.1
- Background: #F7F9FC; surface: #FFFFFF; primary text: #0B1220; muted: #586579; borders: #E3E9F1.
- Navigation: #080D18; primary blue: #087CFA; hover blue: #0069DC; pale blue: #EAF3FF.
- Success: #15803D; error: #C62828. Amber #B45309 reserved for caution, not decorative branding.
- Typography: clean sans serif; 32/40 hero, 24/32 page heading, 16/24 body, 13/20 metadata; minimum readable 12px.
- 8px spacing system; 12px radius for cards, 8px for controls; one shadow level; no stacked translucent glass surfaces.
- 44px minimum touch targets; keyboard navigation, visible focus ring, contrast checks, reduced-motion support.
- Motion: 120-200ms functional transitions, no looping sidebar orbs, no intro waits.
- Icons are secondary to labels; color never communicates state by itself.

### 7. Copy & trust rules
- **Observed:** 'Checkout last updated 18 minutes ago.'
- **Inferred:** 'This checkout may be eligible for recovery.'
- **Unknown:** 'We cannot determine why the shopper stopped.'
- **Action:** 'Review recovery eligibility' rather than 'Recover now' when automation is unavailable.
- Never fabricate confidence, causality, revenue attribution, customer consent, successful automation, or missing data.

### 8. Delivery plan & acceptance gates
**Gate A — Audit:** Confirm route inventory, backend data contracts, current gaps, and merchant workflows (this document is initial code-based audit; merchant interviews remain outstanding).
**Gate B — Prototype:** Build Command Center and one evidence-based recovery investigation in a separate feature branch using representative clearly labeled demo data.
**Gate C — Usability:** 5 merchant tests; find most important issue within 10s; identify supporting evidence within 30s; complete supported action within 60s; record failures and iterate.
**Gate D — Integration:** Replace prototype fixtures with real tenant-scoped APIs, verify loading/error/empty states and authorization.
**Gate E — Rollout:** Accessibility, mobile, visual regression, backend contract tests, feature flag, gradual release.

### 9. Not in scope / outstanding questions
- Do not claim Shopify checkout totals match Revluma until checkout reconciliation is complete.
- No live auto-recovery enablement as part of the redesign.
- Need real merchant interviews to validate opportunity ranking and workflow priority.
- Need a backend contract for opportunity evidence, eligibility, audit trail, approval and outcome before production action buttons.
- Current visual recommendations are hypotheses to test, not validated conversion improvements.

### 10. First prototype implementation tickets
1. Establish shared semantic color, type, spacing, and interaction tokens.
2. Build Command Center shell with 3 operational sections and clear fixture labeling.
3. Build Opportunity card and evidence timeline with observed/inferred/unknown states.
4. Build approval controls as disabled/preview-only until API support exists.
5. Build responsive mobile investigation tabs and accessible keyboard interactions.
6. Conduct merchant walkthroughs before replacing the production Overview.
