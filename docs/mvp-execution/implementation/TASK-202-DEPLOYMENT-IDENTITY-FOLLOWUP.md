# Task 202 follow-up — finding-chat identity and Python deployment revision

Date: 2026-11-07. Branch: `arena/d1233e6c-revluma`. This is a scoped correction to Task 202, not the start of another backlog task.

## Defects and corrections

1. Both JSON and streaming Rev controllers queried certified finding context without selecting `intelligence_findings.id`. The context therefore could not pass a stable identifier to the Python finding tool. Both paths now call `resolveFindingChatContext`, which validates the UUID, scopes finding and store queries to the authenticated organization, explicitly selects `id`, and fails closed for invalid, missing, cross-store or uncertified references. `buildFindingContext` rejects a missing/invalid ID instead of silently allowing a latest-finding fallback.
2. Python `/health` exposed only package version `0.6.0`, which cannot identify deployed source. It now additionally returns `build`: a validated hexadecimal revision from `REVLUMA_BUILD_COMMIT`, `RENDER_GIT_COMMIT_SHA`, `RENDER_GIT_COMMIT`, `SOURCE_COMMIT`, or repository metadata, with honest `unknown` fallback. Backend health transport and `/ready` expose this as `python_build`. Package version and readiness behavior are unchanged.

No schema, authentication, merchant-data or read-only boundary changes were introduced.

## Regression evidence

- Authorized resolver tests assert exact UUID selection and context propagation, organization/store scoping, invalid/cross-store/uncertified failure, and use by both JSON and SSE controllers.
- Context tests require a stable UUID and reject its absence.
- Python tests verify validated/normalized source metadata, `unknown` on invalid metadata without Git, and `/health.build` propagation without treating version as source identity.
- Node health-contract tests verify Python build transport.
- Full local Python suite: **1729 passed, 11 skipped**.
- Full Backend runner: **83 test files passed** with the local uncommitted Prisma import shim; real Prisma generation remains a CI responsibility.

Production verification must read `python_build` from the deployed Backend `/ready` after both Render services deploy. Finding-chat production behavior remains subject to an authenticated request and an actual authorized finding row; no finding or merchant fixture is created for a demonstration.
