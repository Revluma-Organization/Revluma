# TASK 210 — Adaptive answer structure & confidence communication (implementation report)

Date: 2026-11-07. Branch: `arena/33161f74-revluma`. Baseline: `b28a77a`
(main, includes Tasks 197–209 and 211 — the branch was rebased onto it while
PR #357, Task 211, merged in flight; see the integration note at the end).
Implements the
conversation-experience spec lines 1–10 (adaptive structure, no forced
template, no fabricated precision, natural-language confidence, coverage
separate from confidence, meta follow-ups from the record, one coherent
response, performance, security) and consolidates original Tasks 235–240
(situation / insight / implication / recommendation sections when appropriate,
confidence explanation, no forced template for simple questions).
Numbering note: the pre-existing backlog line "TASK 210 — Verify stale evidence
warning" is a different task that was never delivered; the user-assigned
number for this consolidated task is the same 210, and the backlog now carries
both lines with an explicit cross-reference (same pattern as the Tasks 204 and
206 collisions). Diagnosis:
`diagnostics/TASK-210-adaptive-answer-structure-confidence-diagnostics.md`.
Decision: REV-DEC-0019.

The governing rule: **the shape of the answer is earned from the question, and
the confidence in the answer is earned from the evidence — the model never
picks structure and no number is ever fabricated.** A simple "how much did I
make?" gets a direct factual answer with its evidence, not four slots; a
comparison question gets the comparison element; a follow-up like "why the
second one?" is answered from the persisted claim record without re-running
tools.

## What was built

### 1. Response adaptation keystone (`python/src/intelligence/response_adaptation.py`, new)

Pure functions, no I/O, no model calls — same family as `finding_evidence`,
`epistemics`, `specialists`, `investigation_outcomes`.

- `classify_response_profile(classification, understanding, capability, window)`
  → response intent A–H, complexity, explanation depth, the selected ordered
  composable elements, recommendation appropriateness, clarification
  requirement, confidence-communication requirement, and a machine-readable
  `reason`. Deterministic from the existing routing output; the LLM never
  picks structure (spec 2).
- `derive_claim_confidence(claim, items_by_id)` → the documented method D1
  (below) → one of `high | moderate | limited | insufficient` with
  machine-readable basis reasons, per claim.
- `response_confidence_category(claims)` → the response-level category is the
  worst category among the answer-bearing claims (the response is no weaker
  than its weakest load-bearing claim).
- `coverage_summary(items, window)` → coverage / freshness / currency
  comparability / order-coverage certification reported as values, kept
  separate from confidence (spec 5.D).
- `confidence_language(category, limitations, ...)` → natural-language
  communication per category; no percentages, no filler disclaimers (spec 6).
- `select_elements(profile, has_facts, ...)` → ordered elements from the fixed
  vocabulary (`direct_answer, situation, insight, period_comparison, evidence,
  implication, confidence, limitations, alternatives, unknowns,
  suggested_investigation, recommendation, follow_up`), omitting what the
  question does not call for (spec 3, 4) — `direct_factual` emits
  `[direct_answer, evidence, confidence]`; degraded paths emit only the
  earned elements plus `suggested_investigation`.
- `resolve_meta_followup(message, claims, ...)` + the three composers
  (`compose_ordinal_explanation`, `compose_simplification`,
  `compose_verification`) → deterministic resolution of "why the second one?",
  "make it simpler", "how do you know?" against `last_claims` (spec 7) — the
  same recorded-claims-only rule the Task 204 provenance handler uses, no
  tools, no model.

### 2. Documented confidence method (D1) — deterministic, no numbers

1. *Grade gate:* `hypothesis` → at most `limited`; `unknown` → `insufficient`
   ("cannot determine") regardless of evidence volume.
2. *Evidence sufficiency:* worst `quality.sufficiency` across the claim's
   cited items (calculation claims: both period inputs) — all `sufficient` →
   no cap; any `partial` → cap `moderate`; any `insufficient` → cap
   `limited`; any `unavailable` or missing citation → `insufficient`.
3. *Machine-reason penalties:* `conflicting_evidence` → cap `limited`;
   staleness against the claim's own window → cap `limited` and name the age;
   partial coverage → cap `moderate`; non-comparable currencies across a
   comparison input pair → `insufficient` for that comparison claim.
4. *Floor:* verified fact / calculated observation with fully sufficient,
   in-window, comparable evidence → `high`.
5. No step emits a number; categories only. Coverage never feeds the category.

### 3. Contract extension (spec 8)

`response` gains `sections` (ordered, non-empty elements from the closed
vocabulary), restructured `confidence`
`{category, claims: {claim_id: {category, basis, limitations}}, coverage,
communication}`, and a top-level `response_profile`
`{response_intent, complexity, explanation_depth, elements,
recommendation_appropriate, clarification_required,
confidence_communication, reason}`. The four legacy keys stay populated
exactly as today for existing consumers; the fabricated numeric `score` is
removed from new investigation responses (the legacy `{score, basis}` shape is
retained only for persisted legacy turns, adapted by the frontend). Claim
objects gain an additive `confidence` field.

Integration (`python/src/agents/investigation.py`): `_apply_response_adaptation`
runs after the investigation completes — it classifies the profile, derives
per-claim confidence from the recorded claims + evidence items, selects the
elements, composes the section texts from the already-generated narrative
(materials, not an LLM call), emits `sections` + `response_profile`, and
rewrites `response.confidence` to the new shape. The section label for the
`evidence` element is "Evidence" (renamed from "How I checked", which collided
with the frontend's evidence-disclosure summary). Meta follow-ups are resolved
from the bounded context before tools run.

### 4. Node boundary (spec 11) — `Backend/src/services/revResponseAdaptation.js` (new)

`validateResponseAdaptation(data)`, wired into
`validateInvestigationResponse` (mlService.js): when a `response` object is
present it REQUIRES `confidence` + `sections` (new investigation responses
cannot silently regress to the old shape); rejects a numeric `score`;
re-derives every per-claim category with the mirrored D1 (Python is the
source of truth, the mirror is byte-for-byte the same method on the same
payload data); requires the response category to equal the worst
answer-bearing claim category; enforces the closed section vocabulary, no
duplicate ids, non-empty label + text, and `communication` non-empty without
any `%`. Fail-closed, same pattern as claims/outcomes/specialists. Golden
parity set: `python/scripts/gen_response_adaptation_golden.py` →
`Backend/src/services/__tests__/revResponseAdaptation.golden.json`
(15 direct / 7 comparative / 13 overview / 23 degraded / 11 legacy payloads),
regenerated by Python, consumed by the Node tests.

### 5. Frontend (spec 8, badge discipline)

- `src/lib/revStream.ts` — contract types: `RevConfidenceCategory`,
  `RevClaimConfidence`, `RevCoverageSummary`, `RevAnswerConfidence` (coverage
  optional — a malformed coverage hides only the disclosure, the communication
  sentence still renders), `RevResponseSection`, `RevResponseProfile`;
  `response.confidence` is a union of the legacy `{score, basis}` and the new
  shape; `response.sections?` and top-level `response_profile?`.
- `src/lib/revPresentation.ts` — `normaliseRevAnswer` now carries `sections`;
  new helpers: `answerSections` (order-preserving; drops empty id/label/text;
  duplicate ids resolve first-wins), `answerConfidence` (fail-hidden:
  non-vocabulary category → nothing; `%` in `communication` → nothing;
  malformed coverage → `coverage: undefined` only), `coverageDisclosure`
  (the "Coverage: … · Freshness: … · Currencies comparable: … · Order coverage
  certified: …" summary + the limitation list).
- `src/components/rev/RevAnswerView.tsx` — adaptive renderer: when
  `response.sections` is non-empty it is authoritative (rendered in backend
  order, legacy 4-key derivation is NOT run); otherwise the legacy four
  headings render exactly as before. The confidence standing renders ONLY as
  the backend's natural-language `communication` — normally the ordered
  `confidence` section, otherwise a single de-duplicated paragraph — and never
  as a badge/pill/uppercase label. The coverage disclosure renders under
  "How I checked" as "Coverage and data state", separate from confidence.
  Legacy payloads (no `sections`, `{score, basis}` confidence) render exactly
  as before — the pre-existing 116 rev tests prove the regression lock.

## Defects found and fixed while wiring

1. **Task 206 null-priority regression (pre-existing, shipped in `c7f8f6c`)** —
   the main flow emits `priority: null` etc. (key present, null unless
   INTENT_FINDINGS); the Node guard `data.priority !== undefined` was true for
   `null`, so `validatePriorityBlock(null)` rejected every non-findings
   investigation at the boundary in production. Fixed with nullish `!= null`
   guards on the four optional-block guards in mlService.js. Regression test:
   the E2E harness (7 real payloads) passes only with the nullish guards.
2. **E2E harness store scope** — passing the payload's own
   `investigation_outcome.tenant.store_ids` (empty for meta/correction turns)
   as the validator store scope failed `cross_store_claim` on every claim
   citing real stores (correct fail-closed, wrong input). The harness now uses
   the production `authorizedContextStoreIds` semantics (merchant-context
   store union).
3. **Frontend `{...null}` spread** — an adaptive section skipped as
   de-duplicated (its text already in the narrative) produced
   `{...null, id}` = a section object with undefined label/text, crashing
   `RevMarkdown`. The adaptive branch now `flatMap`s the append helper and
   drops nulls (the legacy branch always did this correctly).
4. **Evidence section label collision** — the `evidence` element's label was
   "How I checked", the same string the frontend uses for the evidence-
   disclosure summary; renamed to "Evidence" so the heading and the
   disclosure cannot be confused in the rendered answer.

## Verification summary

Full evidence is in `validation/TASK-210-ADAPTIVE-ANSWER-STRUCTURE-CONFIDENCE.md`:

- Python unit `test_rev_response_adaptation.py` 61 passed; integration
  `test_rev_adaptive_response.py` 19 passed (through the real
  `run_investigation` pipeline with FakeDB).
- Node: all 20 rev* test files green, incl. `revResponseAdaptation` 18 passed
  (D1 mirror + golden parity + boundary rejections).
- E2E: 7 real Python-generated payloads (direct/comparative/overview/
  persisted turn/meta/correction/degraded) pass BOTH
  `validateResponseAdaptation === []` and the full
  `_validateInvestigationResponse` with production store scope.
- Frontend: full suite 516 passed (36 files), incl. 10 new Task 210 tests
  (backend order + no legacy re-derivation; empty-section drop; natural
  language never badge; no duplication; sentence fallback; coverage
  disclosure; legacy `{score,basis}` never rendered; `%` communication
  refused; malformed confidence hidden; legacy 4-key fallback kept).
- `tsc --noEmit` clean; full Python suite 2148 passed / 11 skipped / 4 failed
  (the 4 are the pre-existing `DATABASE_URL`/PostgreSQL sandbox failures,
  byte-identical on clean main).

## Integration onto the advanced main (Task 211 merged in flight)

PR #357 (Task 211, recommendations/finding continuity) merged to main as
`b28a77a` while this task was in flight. The branch was rebased onto it.
Task 211 touches the same two integration points this task does
(`investigation.py` conversation context + Node boundary), so the rebase was
a real three-way merge, not a clean apply. Both tasks keep each other's
contracts intact:

- `investigation.py`: Task 211 adds the `recommendations`/`selected_finding`
  import, the `last_selected_finding`/`last_recommendations` context keys and
  their read/persist handling, the selected-finding domain scoping, and the
  `enrich_recommendations`/`validate_recommendation_contract` calls. Task 210
  adds the `response_adaptation` import, `_SECTION_LABELS`/`_COMPARISON_ASK_RE`,
  `_apply_response_adaptation`, and the meta-followup resolution. The only
  overlap was the import block, where Task 209's earlier removal of the direct
  `execute_specialists` import (superseded by
  `execute_orchestrated_specialists`) was preserved — the stale import this
  task's pre-rebase tree still carried was dropped, not kept. No task's
  behaviour is altered by the other.
- `mlService.js`: Task 211 adds the `validateRecommendationBoundary` import
  and call; Task 210 adds the `validateResponseAdaptation` import and call
  plus the Task 206 nullish-guard fix. Both boundary checks now run in the
  same `validateInvestigationResponse`, each fail-closed on its own contract.

Final evidence post-integration (on `b28a77a`, Tasks 209 + 211 in) is the
authoritative record in the validation file: Python full suite 2148 passed /
4 pre-existing env failures; focused Task 210 + Task 211 + investigation
168 passed; Node rev* 212 passed across 20 files (plus churn/
findingChatResolution/revPersistence) with the single Prisma-load
`task211FindingPersistence` file limited by the pre-existing sandbox
engine-download restriction; 7 real payloads pass both validators; frontend
516 passed with `tsc` clean.

Production: merged to main as `9bf9a9b` (PR #358, CI green on all checks).
Post-merge revision verification done: Vercel production live and serving;
Render `/ready` reports `python_build` + `node_build` = `9bf9a9b` with
database/python/redis ready and a clean business-state scheduler run on the
new build. Remaining: live-store end-to-end acceptance on
`revluma-test-store-v1.myshopify.com` (human runbook, spec §11).
