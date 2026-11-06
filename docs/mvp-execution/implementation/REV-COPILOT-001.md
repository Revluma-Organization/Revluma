# REV-COPILOT-001 — Evidence-led commerce copilot

Date: 2026-11-06 (Africa/Lagos)

## Scope and evidence boundary

The public `https://www.shopify.com/sidekick` page advertises store summaries, low-stock review, product writing, pricing help, email campaigns, and social posts. Those are capability claims on a marketing page, not evidence of Shopify Admin's private runtime, prompts, models, APIs, or backend algorithms. No authentication was bypassed, no private Shopify system was accessed, and no Shopify assets or branding were copied.

REA `6.8.0` (`rea-agents`) was installed and executed using its supported Node `24.22.1` runtime:

```sh
npm exec --yes --package=node@24.22.1 --package=rea-agents@6.8.0 -- rea doctor --json
```

The doctor confirmed the Node/host requirements. Its overall status was false because optional native-binary providers and agent-skill registration were absent; those are not web-analysis prerequisites. An isolated Chromium was provisioned for `capture-browser-scenario`, but capture failed before navigation because the host lacks `libnspr4.so` and `libnss3.so`. Direct browser egress to Shopify is also outside the sandbox allowlist. Therefore there is **no successful REA rendered-page, script, or network capture**. The failed result is retained as an environment limitation, not represented as product evidence.

## Implemented increment

The existing global `CopilotPanel` was not functional: it displayed a hardcoded merchant name and abandonment percentage, and its form discarded submitted text. It now provides an original Revluma workflow using the existing authenticated Rev architecture:

- real `POST /rev/stream` requests through the existing Node gateway;
- the existing authenticated organization and tenant-scoped conversation persistence;
- streamed investigation progress, final answers, evidence, limitations, and follow-ups;
- cancellation, new conversations, and handoff to the full persisted Rev thread;
- actual Shopify connection status rather than fabricated store findings;
- six explicit read-only workflows: `/summary`, `/low-stock`, `/describe`, `/pricing`, `/campaign`, and `/social`;
- free-form questions, Enter/Shift+Enter editing, and a bounded 2,000-character input.

No backend endpoint, model provider, authorization check, RLS policy, or store mutation was added. Analysis and content are responses/drafts only. The UI explicitly states that Rev does not publish content, send campaigns, or change prices, inventory, orders, discounts, themes, or settings.

## Validation

Executed locally:

- focused workflow/drawer tests: 8 passed;
- complete dashboard suite: 504 passed across 36 files;
- `npx tsc --noEmit`: passed;
- ESLint on all changed TypeScript files: passed;
- `npm run build`: passed;
- `git diff --check`: passed.

Repository-wide `npm run lint` remains red on 30 pre-existing errors in unrelated files (30 errors and 17 warnings at execution). None point to this increment. This baseline failure is not represented as a clean repository-wide lint result.

## Acceptance boundaries

This is a production increment inspired by publicly advertised workflows, not a complete Sidekick clone or proof of feature parity. Theme design, image editing, Shopify Admin navigation, discount/collection creation, shipping changes, and autonomous store mutations are not implemented.

## Delivery and production evidence

- PR #325 merged on 2026-11-06 as `dd8503e40b8994a8e48625905056931aed75b2b6`.
- Dashboard CI run `42270681482`, Vercel preview, and preview-comments checks all passed before merge.
- Vercel production deployment `dpl_Aj9HmT5jWQR4U5Lij18oz1NRvGJV` built the exact merge SHA and reached `READY` / `PROMOTED`; its production aliases include `revluma.vercel.app`.
- Production build logs completed the Vite build successfully (2,881 modules) and reported deployment completion.
- An anonymous request to `/dashboard/overview` redirected to the production sign-in route, confirming that the protected dashboard did not become publicly accessible.

No backend deployment was required. An authenticated browser workflow and a real merchant `/rev/stream` response were not executed because no user browser session was available; deployment readiness and anonymous authentication behavior are not represented as an authenticated end-to-end test. The Vercel deployment-file endpoint returned `File tree not found`, so no claim is made about inspecting the deployed file tree or bundle contents through that API.
