# Task 234 — Rev Intelligence architecture and execution reliability report

**Engineering status: code fixes and local checks are complete for this work checkpoint. Production acceptance: NOT COMPLETE / NOT VERIFIED.** No claim is made that production chat or the sync status is fixed. The original chat incident has no browser request trace or matching backend log evidence, and no authenticated production smoke was run.

**Current branch:** `arena/542c36f7-revluma`, branched from `b1e2cc4dd882113da105dc4ce0a586c5ea733ded` (merge commit for PR #404). Changes in this checkpoint are still local and uncommitted.

## Executive result

The earlier Task 234 source changes are present in the repository and were merged to `main` in PR #404. This checkpoint additionally fixes two confirmed source-level issues:

1. Rev's browser stream sends `X-Correlation-ID`, but the Node CORS allowlist did not allow that custom header. A cross-origin browser preflight can therefore stop the stream request before the authenticated route runs. The backend allowlist and a cross-component contract assertion are updated.
2. Rev's welcome screen interpreted `monitoring_mode: awaiting_verified_sync` as proof of a live initial sync, even when the explicit `sync_status` was `failed`. The backend uses that monitoring mode for any connected-but-not-complete store, not only an active sync. Its `GET /stores` adapter also converted unrecognized/not-started sync states into `pending` or `complete` based only on whether `last_synced_at` existed. The API now maps only recorded queued/starting/running states to `in_progress`, preserves `not_started`/`unknown`/`partial`/`failed`, and the frontend bases its banners on that explicit status. Failed, not-started, and unknown states now have distinct guidance; generic setup failure is no longer mislabeled as a webhook gap.

These explain plausible code paths for the user-visible symptoms, but **neither is confirmed as the exact production chat incident**. The CORS defect only explains a chat request if the live backend runs the affected code and the browser's preflight is for an allowed origin. Production request evidence is still needed to confirm that.

## Confirmed defects, causes, and remediations

| Defect | Root cause in source | Remediation / present status |
|---|---|---|
| Context-free general questions could enter store investigation. | `route_message` had no deterministic knowledge path for clear definitions; the model classifier could incorrectly request merchant data. | Narrow deterministic definition routing precedes model classification only when there is no store reference/intent. Store-specific metrics still use investigation. Runtime tests assert no data tool, evidence, specialist, or unintended persistence for general definitions. |
| Model role constants implied model IDs that did not necessarily run. | `UNDERSTANDING_MODEL` described a Sonnet model although understanding called the shared gateway's `fast` role; responder constants likewise blurred role and provider model selection. | Explicit `FAST_ROLE` / `DEEP_ROLE`; concrete model resolution centralized in `model_gateway.py`. Source defaults are Anthropic fast `claude-haiku-4-5-20251001`, deep `claude-sonnet-4-6`; Gemini fast `gemini-2.5-flash-lite`, deep `gemini-2.5-flash`. Runtime environment overrides apply. These are code defaults, **not evidence of production provider/model configuration**. |
| Provider failures and fallback were misleading or unsafe. | Some provider errors were not normalized/correlated; exhausted failures could become fallback prose; permanent auth/invalid-model failures could proceed to another candidate; attempts counted candidates rather than actual calls; fallback could cross provider boundaries without a clear opt-in; retries could consume an unbounded share of latency budget. | Gateway emits bounded typed failures, retries only retryable classes, records actual calls, caps at two attempts under one monotonic deadline, uses same-provider model fallback unless `AI_FALLBACK_PROVIDERS` explicitly authorizes cross-provider processing, and keeps grounded web-search work Gemini-only. Logs/metrics exclude prompts, keys, raw provider errors, and merchant payloads. |
| High-cardinality operational metrics could retain identifiers. | Arbitrary labels, including correlation/execution IDs, could create unlimited series. | Python and Node label dimensions are allowlisted and bounded, with a 512-series per-process ceiling. These metrics remain in-process snapshots, not durable cross-instance aggregation. |
| Trace identity broke on image/orchestration and gateway failures. | The Node image path did not consistently pass correlation/execution IDs to Python; early unconfigured-gateway SSE failures could mint/omit IDs and failure metrics. | IDs now pass through the retained image path and typed failures; bounded failure counters/trace metadata are recorded. |
| New-conversation acceptance could leave an empty history row. | Conversation and first user-message inserts were separate writes; history trusted a denormalized count and exposed message-less rows. | Creation is transactional; history suppresses rows without messages and derives counts from persisted messages. Existing production rows were not deleted or mutated. |
| Conversation restoration/follow-up continuity had gaps. | Restoration metrics were outside a helper that swallowed DB errors; follow-up period hydration read top-level dates but persisted context used `last_investigation.period`. | Failure instrumentation now runs inside the catch boundary while bounded fallback context remains; period hydration accepts nested and legacy direct-window shapes. |
| Stream retry could authorize the wrong conversation. | Reuse path passed `conversationId` instead of `requestedConversationId`. | Reuse now authorizes the requested ID through the tenant ownership gate and keeps retry idempotent. |
| Python contract tests unnecessarily called live providers. | Deterministic routing/evidence tests were coupled to an external provider's availability. | Shared deterministic composer doubles isolate contract tests; provider retry/exhaustion policies remain tested separately with fakes. This does not verify live generated prose. |
| CORS could block every cross-origin Rev stream before the route. | Frontend sends both `X-Request-ID` and `X-Correlation-ID`; `Backend/src/app.js` allowed the first custom ID but not the second. | Added `X-Correlation-ID` to CORS `allowedHeaders` and an integration contract that checks the backend allowlist against the stream client. **Local code fix only; no deployed backend verification.** |
| Failed, not-started, or unknown sync evidence could be displayed as “Initial sync in progress.” | Frontend treated `monitoring_mode: awaiting_verified_sync` as active progress; Backend emits it for any connected store whose sync is not complete. `GET /stores` also converted unmatched sync states to `pending` or `complete` based only on `last_synced_at`. Generic `setup_status: failed` was treated as a webhook failure. | Backend now maps recorded running/queued/starting to `in_progress`, completed states to `complete`, preserves `partial`/`failed`, and distinguishes `not_started`/`unknown` rather than inferring progress/completion from timestamps. Frontend labels only explicit `in_progress` as running, with distinct failed, not-started and unknown guidance. Webhook warnings require a webhook-specific pending status or registered-count gap. Regression coverage added. |

The confirmed code defects above are not proof that any particular historical production conversation failed for that reason. The original chat failure still needs request-level attribution.

## Models, routing, orchestration, specialists, and restoration

### Original versus remediated model selection

- **Prior behavior/configuration:** role and model identifiers were conflated. For example, understanding's constant described a deep/Sonnet model while the call used the shared fast role. Consequently, the constants did not establish which provider/model actually ran. The previous production provider/model cannot be reconstructed from these code constants.
- **Current source behavior:** `model_gateway.generate` is the single provider/model resolution boundary. Roles are `fast` and `deep`; `AI_PROVIDER` chooses provider (source default `anthropic`), model-specific environment settings override source defaults, and cross-provider fallback requires explicit `AI_FALLBACK_PROVIDERS`. The gateway preserves grounded-search requirements and uses bounded retries/timeouts. **No production environment or live provider request was inspected, so no actual production model is claimed.**

### Routing and orchestrator use

- Browser requests enter the authenticated Node gateway. Ordinary JSON chat uses Node `POST /api/v1/rev/chat` and Python `POST /rev/investigate`; streaming chat uses Node `POST /api/v1/rev/stream` and Python `POST /rev/stream`.
- Node selects the legacy Python `POST /orchestrate` path for image-capable chat. It is instrumented but retained: source shows an active image compatibility use, and parity/unused status has not been proven. It was not deleted.
- Python `route_message` handles deterministic guards/intent before retrieval. General knowledge/advisory and social/continuity paths can avoid store evidence tools. Store-specific questions use allowlisted read-only evidence retrieval.
- `question_orchestration.py` plans a bounded, deduplicated set of tenant-scoped domain tasks. Relevant specialists calculate from validated evidence; independent specialist work is bounded/concurrent, permanent failures do not retry or promote hypotheses to facts, and reconciliation preserves evidence status.

### Specialist and restoration status

Task 208 specialists and Task 209 question orchestration remain implemented in source and covered by synthetic/local tests. Node owns transcript persistence, tenant checks and conversation history; Python owns derived conversation context/memory. Tests cover first-turn transaction/recovery, tenant-scoped history, nested period restoration, retry reuse, restoration failure metrics and trace identity. **Authenticated production restoration, tenant rejection and specialist behavior have not been smoke-tested.**

No dead/conflicting route was removed. The legacy image `/orchestrate` endpoint and distinct Node synchronous/stream handlers remain because their contracts and recovery/persistence paths differ or are still in use.

## Why Rev Intelligence showed “Initial sync in progress”

The banner was driven by a frontend inference, not by evidence that a sync worker was actively running:

1. The store response could say `sync_status: failed` while also saying `monitoring_mode: awaiting_verified_sync`.
2. Backend response construction assigns `awaiting_verified_sync` whenever the connected store has not reached the completed-sync monitoring mode. That includes failed, stalled, and unverified states; it is not an active-job signal. Its old `GET /stores` adapter also collapsed unrecognized/not-started sync states into `pending` or `complete` based only on `last_synced_at`.
3. `isSyncIncomplete()` treated `awaiting_verified_sync` alone as active progress, so the UI hid the distinction between a running sync and a failed sync. The fix normalizes recorded sync states without inferring progress or completion from timestamps, and the UI now distinguishes active, failed, not-started, and unknown.

A **historical, read-only** snapshot of the supplied test store recorded `initial_sync_status: failed`, `recovery_status: required`, 30/35 sync domains complete, five failed domains (one persistence `P2000`, four Shopify GraphQL retrieval failures), and 544 store-level attempts. That snapshot is not a current recheck and was not retried. It is consistent with the false-progress banner; it does not establish the store's current state. The code fix now uses explicit `sync_status` for progress and directs explicit failures to Integrations.

## Verification results

| Evidence | Result | Scope / limitation |
|---|---|---|
| Current Dashboard focused tests | **223 passed / 3 files**: `RevIntell.test.tsx` (192), `revStoreContext.test.ts` (21), `revStream.test.ts` (10). | Local tests, not production behavior. Existing React Router / `act(...)` warnings appeared. |
| Current Dashboard production build | **Passed** (2,251 modules). | Existing Vite large-chunk warning remains; build does not establish deployment. |
| Current touched-file lint | `npx eslint` on the four modified Dashboard TS/TSX files: **0 errors**, exit 0; three existing missing-`announce` hook-dependency warnings in `RevIntell.tsx` remain. | Warnings are outside this change's lines; no type-check claim. |
| Current Backend syntax + integration contract | `node --check src/controller/storeController.js`, `node --check src/app.js`, and `node src/controller/__tests__/integration.contract.test.js`: **passed**. | Targeted local checks only; no full Backend suite rerun in this checkpoint. |
| Current GET `/stores` API regression | `node src/tests/revIntegrationStateApi.test.js`: **11 passed**. Includes a new case proving not-started and failed sync statuses remain distinct and do not become invented progress. | Local controller test with mocked persistence; not a production request or Supabase evidence. |
| Current diff hygiene | `git diff --check`: **passed** at last check. | Local only. |
| Previously recorded Task 234 scenario matrix | **51 passed** (48 authoritative behavior cases plus inventory assertion and two adversarial tests). | Synthetic stores/provider fakes; no live provider or production DB behavior. |
| Previously recorded full Python suite | **2,412 passed, 11 skipped** with deliberately unreachable local-only `DATABASE_URL=postgresql://test:test@127.0.0.1:1/test`; no DB connection/transaction. | Local result from the earlier Task 234 continuation; not rerun for this UI/CORS checkpoint. Without the dummy local URL that earlier run had four configuration/diagnostics failures. No Supabase URL was used. |
| Historical Task 234 CI/merge | PR #404 merged to `main` at `b1e2cc4dd882113da105dc4ce0a586c5ea733ded`; Dashboard and Vercel checks reported passed. Earlier PR #394 CI reported Backend/Python/Dashboard/release-candidate success for its tested head. | CI/merge evidence only; not live provider, authenticated chat, or current production backend evidence. |

## Deployment evidence and blockers

- **Vercel is the frontend project, not the Node/Python backend.** The PR #404 frontend deployment `dpl_HYFyCofddLXDPRxtaFpyVuyHrzwd` was READY/PROMOTED at merge commit `b1e2cc4...`. At the latest follow-up, production deployment `dpl_3wENwh82sdeNJaeYRmpQYse3u6Qn` was READY/PROMOTED at frontend commit `1f7ae263dc9c7e8cc66931a300647ce257b1ecd9`; it superseded the earlier `cd3be54...` production deployment. These Vercel records do not identify a backend revision or prove chat/sync behavior. The current CORS and sync-status code changes are uncommitted and are not in those deployment records.
- Previous read-only Vercel environment inspection confirmed production `VITE_API_URL=https://revluma-backend-vrsd.onrender.com/api/v1`. This establishes frontend API-base configuration only.
- No Render/Node/Python deployment SHA, `/ready` response, backend logs, provider/model environment, failed browser OPTIONS trace, authenticated merchant session, or approved isolated non-Supabase staging smoke path has been obtained. Exact production chat root cause and backend deployment remain unknown.
- Historical Supabase/store observations in this document and defect register are not current rechecks. **No Supabase writes, retries, or new sync attempts were performed.** No attempt should be made against the supplied test store without separate authorization and a safe approved path.

## Completion decision and remaining gate

Highest-impact confirmed source defects addressed in this checkpoint are the Rev stream CORS preflight mismatch and false “initial sync in progress” classification. Task 234's deterministic routing, explicit provider roles/failure handling, trace/metrics, conversation persistence and restoration remediations remain present and locally/CI tested as documented. No implementation route was removed because none has been proven dead.

Production acceptance remains **NOT COMPLETE / NOT VERIFIED** until the current Node and Python revisions are identified and an approved authenticated, isolated, read-only smoke path verifies general knowledge, store investigation, stream final/persistence, restoration/tenant rejection, provider failure semantics, and actual sync state. For the chat report, capture the failed browser request's method/status/timing/`X-Request-ID` (especially OPTIONS preflight headers) and correlate it to sanitized backend logs before attributing the production incident. A merge, Vercel deployment, CI result, or local test is not a substitute for that evidence.
