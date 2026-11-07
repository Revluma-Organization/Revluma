# TASK-210 — Diagnostic: Adaptive Answer Structure & Confidence Communication

**Date:** 2026-11-07 · **Scope:** consolidated spec items 235–240
**Base:** origin/main `c7f8f6c` (includes Tasks 197–209, all merged)
**Method:** read-only inspection of the live investigation pipeline (Python), the
Node boundary (mlService), the frontend answer renderer, and the existing
conversation/experience contracts. Every finding below is anchored to file +
line at the time of inspection.

---

## 1. What already exists (extended, not replaced)

The pipeline at `python/src/agents/investigation.py` already implements the
substantial machinery Task 210 must build on:

| Existing capability | Location | Relevance to 210 |
|---|---|---|
| 7 deterministic presentation modes + `select_response_mode` (guards first, intent second) | `investigation.py` L3718–3744; `docs/rev-intelligence/REV-CONVERSATION-EXPERIENCE-SPEC.md` §2 | Task 210 adds the *content* layer (which elements a response carries) beneath the existing *presentation* layer (how the UI renders it). The two compose; no new mode selector. |
| Intent classification: L1 deterministic safeguards + L2 model understanding + evidence gate | `route_message` L1248–1380; `understanding.py` | The A–H response-intent/complexity classifier derives from this output deterministically — no new LLM call. |
| 6-dimension evidence quality + `sufficiency` verdict (`sufficient\|partial\|insufficient\|unavailable`) + machine reasons | `python/src/intelligence/evidence_quality.py` L255–335, rollup L756–776 | The documented method from which claim confidence is derived (spec 5.C). |
| Epistemic claim contract `rev-claim-v1`: grades `verified_fact` / `calculated_observation` / `hypothesis` / `unknown`, re-derivable `calculation` blocks, corrections | `python/src/intelligence/epistemics.py`; Task 204 | The claim set over which confidence becomes *claim-specific*. |
| Guardrails: causal/action/recoverable/citation + narrative | `python/src/intelligence/claim_guardrails.py`; Task 205 | Still the outermost validator; unchanged. |
| Investigation outcome contract (fail-closed failures) | `investigation_outcomes.py`; Task 207 | Insufficient-evidence path stays fail-closed. |
| Specialists (3) with per-specialist outcome | `specialists.py`; Task 208 | Specialist follow-ups already resolve from `last_specialists`. |
| Multi-period evidence + certified comparability | `multi_period_evidence.py`; Task 209 | Period-comparison claims get their comparability from here. |
| Conversational pre-investigation routing (greeting/ack/farewell/wellbeing/identity/capability/knowledge/clarify) with model-assist + static fallbacks | `_dynamic_conversational` L438; `INTENT_GREETING` L171 | Casual (A) and clarification (H) are already routed pre-investigation. |
| Provenance follow-ups ("where did that number come from?") answered from **recorded claims only** | `PROVENANCE_PATTERN` L665; `_provenance_result` L3511 | Template for the new meta follow-ups (no re-investigation). |
| Challenge/correction: explicit retraction of the specific claim, never defended, never silently dropped | `CORRECTION_PATTERN` L660; `correct_claim` (epistemics) | "Are you sure?" is a verification request — related but distinct: it asks Rev to re-state its own standing, not to retract. |
| Conversation context window: `last_claims` (≤10, contract-checked), `last_specialists`, `last_priority`, `last_investigation` | `persist_investigation_context` L3099–3160 | The recorded evidence a meta follow-up may use without new retrieval. |
| Frontend: conditional section rendering (empty sections never render), legacy↔new normalisation, `evidenceState` (verified/partial/unverified/unavailable), badge discipline that hides uncalibrated numeric scores | `Frontend/Dashboard/src/lib/revPresentation.ts`, `components/rev/RevAnswerView.tsx` | The renderer already refuses to fabricate; it has no *positive* channel for evidence-derived confidence yet. |
| Node fail-closed boundary `validateInvestigationResponse` re-validating outcome/evidence/claims/epistemics/specialists/priority blocks | `Backend/src/services/mlService.js` L1375–1473 | Task 210 extends this boundary with the new adaptation + confidence checks (independent authority, same fail-closed pattern). |

## 2. The gaps (what 210 implements)

### G1 — The answer body is a fixed 4-slot template (235–238)

`run_investigation` builds `response` with **fixed keys** `situation`,
`insight`, `implication`, `recommendation` (investigation.py L4434–4447). A key
gets an empty string when inapplicable; the renderer hides empties, but the
*selection* is not made by the backend: every store investigation, from
"how many orders did I get yesterday?" to a multi-domain decline diagnosis,
emits the same four-slot envelope. `implication` is filled with the canned
line *"Causes are not established by this evidence."* whenever hypotheses
exist — even for a question that never asked about causes. There is no
`direct answer`, `period comparison`, `alternatives`, `unknowns`,
`suggested investigation` or `follow-up` element in the `response` contract at
all; those ideas exist only as free text inside `text`.

**Consequence:** simple questions get report-shaped envelopes (240) and
detailed answers cannot be composed from named, reorderable elements (235).

### G2 — Confidence is a hardcoded decorative global score (239)

```python
def _confidence(overall: str, items: list[dict]) -> float:
    if overall == "complete" and any(...verified...): return 0.82
    if overall == "partial":                          return 0.60
    if overall in ("insufficient_data", "failed"):    return 0.25
    return 0.40
```
(investigation.py L4584) — four constants keyed to the *overall* status,
exposed as `response.confidence.{score, basis}` (L4454–4457). No evidence
evaluation enters the number; every claim in the response shares it; the
`basis` string is a fixed label. This is exactly the pattern the consolidated
spec forbids ("must not fabricate numeric confidence", "claim-specific",
"coverage is not confidence"). The frontend already hides these numbers
(badge discipline), so today the merchant is shown **nothing** about
confidence while the payload carries a false-precise number.

The same disease in two more places: hypotheses carry a hardcoded
`confidence: 0.2` (L2489), and `SpecialistsSummary.confidence?: number` is a
loose numeric field with no derivation contract (revStream.ts L46).

### G3 — No response-intent / complexity classification (2)

`select_response_mode` chooses a *presentation mode* from intent + guards.
Nothing classifies the **response** in terms of: explanation depth, which
composable elements belong, whether a recommendation is appropriate, whether
clarification is required, and what confidence communication the answer
needs. The A–H taxonomy of the consolidated spec has no implementation.

### G4 — No natural-language confidence communication (239)

The only confidence text in a response is the canned `basis` label. There is
no sentence that says what is verified, what is partial, what is missing,
and why — derived from the evidence actually collected.

### G5 — Coverage and confidence are not separated in the answer contract (5.D)

Coverage/freshness/certification live in the `evidence` payload
(`evidence.coverage`, `evidence.freshness`, Task 209 `comparability`), but the
`response` object conflates them: a response with complete but stale data and
one with fresh but 60%-covered data both get the same `_confidence` score and
the same `basis`. The contract has no distinct coverage representation next
to confidence.

### G6 — Meta follow-ups lose the previous answer's meaning and evidence (7)

Recorded-claim follow-ups exist for **provenance** ("where did that number
come from?") and **challenge** ("that's wrong"), and specialist/priority
follow-ups exist from Tasks 206/208. But the three canonical conversational
moves of the spec have no handler:

- *"Explain the second point"* — no ordinal/positional reference resolution
  against `last_claims` (only value-based `claim_reference` via
  `_numbers_in`).
- *"Make it simpler"* — routes to L2 understanding → conversational/clarify;
  the previous conclusion and its evidence are dropped.
- *"Are you sure?"* — not in `PROVENANCE_PATTERN` ("are you sure" ≠
  "show me the evidence" wording; nearest match is "how do you know"), so it
  routes to L2 → conversational; Rev neither re-states its claim with its
  standing nor re-derives anything.

All three must answer **from the recorded claims** (value, grade, evidence
refs, confidence) without a new investigation (spec 7, 10: "continue without
unnecessary restarting").

### G7 — The Node boundary does not validate adaptation or confidence

`validateInvestigationResponse` (mlService.js L1375) re-validates
outcome/evidence/claims/epistemics/specialists/priority — but `response`
(confidence included) is passed through untouched. A corrupted or
LLM-influenced confidence/structure block would reach the merchant unchallenged.
There is no golden parity set for adaptation either (every other keystone has
one: findings, priorities, outcomes, specialists).

### G8 — The frontend contract has no positive confidence channel

`revStream.ts` types `confidence?: { score: number; basis: string }` (legacy)
and `RevHypothesis.confidence: number`. Nothing renders a derived category, a
per-claim standing, or the coverage/confidence split. The renderer's existing
"hide uncalibrated numbers" discipline means that until the contract carries
evidence-derived confidence, merchants never see any.

## 3. Design decisions (how 210 extends the stack)

1. **New keystone** `python/src/intelligence/response_adaptation.py` (same
   naming family as `finding_evidence`, `epistemics`, `specialists`,
   `investigation_outcomes`). Pure functions, no I/O, no model calls.
   - `classify_response_profile(...)` → the A–H response intent + complexity
     + explanation depth + selected composable elements + recommendation
     appropriateness + clarification requirement + confidence-communication
     requirement. Deterministic from the existing routing output
     (classification + understanding + capability + window). The LLM never
     picks structure (spec 2).
   - `derive_claim_confidence(claim, items_by_id)` → one of
     `high | moderate | limited | insufficient` with machine-readable basis
     reasons, from the **documented method** (D1 below). Claim-specific by
     construction.
   - `coverage_summary(items, window)` → separate coverage/freshness/
     certification representation (spec 5.D).
   - `confidence_language(category, reasons)` → natural-language sentences per
     category; no percentages, no filler disclaimers.
   - `select_elements(profile, ...)` → ordered composable elements from the
     fixed vocabulary (direct_answer, situation, insight, period_comparison,
     evidence, implication, confidence, limitations, alternatives, unknowns,
     suggested_investigation, recommendation, follow_up), omitting what the
     question doesn't call for (spec 3, 4).
   - `resolve_meta_followup(message, conversation_context)` → deterministic
     resolution of ordinal-reference / simplification / verification requests
     against `last_claims` (spec 7), the same recorded-claims-only rule the
     provenance handler uses.

2. **Documented confidence method (D1)** — deterministic, no numbers:
   1. *Grade gate:* `hypothesis` → at most `limited`; `unknown` →
      `insufficient` ("cannot determine") regardless of evidence volume.
   2. *Evidence sufficiency:* worst `quality.sufficiency` across the claim's
      cited items (calculation claims: both period inputs): all `sufficient`
      → no cap; any `partial` → cap `moderate`; any `insufficient` → cap
      `limited`; any `unavailable` (or citation missing) → `insufficient`.
   3. *Machine-reason penalties:* `conflicting_evidence` → cap `limited`;
      staleness against the claim's own window (`*_for_current_claim`) → cap
      `limited` and name the age; partial coverage → cap `moderate`;
      non-comparable currencies across a comparison input pair →
      `insufficient` for that comparison claim.
   4. *Floor:* verified fact / calculated observation with fully sufficient,
      in-window, comparable evidence → `high`.
   5. No step ever emits a number; categories only. Coverage (how much was
   seen) is reported by `coverage_summary` and never feeds the category.

3. **Contract (8):** `response` gains `sections` (ordered, non-empty
   elements), restructured `confidence`
   `{category, claims: {claim_id: {category, basis, limitations}}, coverage,
   communication}`, and a top-level `response_profile`
   `{response_intent, complexity, explanation_depth, elements,
   recommendation_appropriate, clarification_required,
   confidence_communication, reason}`. The four legacy keys stay populated
   exactly as today for existing consumers (backward-compatible where
   required, spec 45); the fabricated numeric `score` is removed from new
   investigation responses (the legacy `{score, basis}` shape is retained
   *only* for persisted legacy turns via the frontend adapter). Claim
   objects gain an additive `confidence` field (contract `rev-claim-v1`
   already allows additional keys; the Node re-validator accepts it).

4. **Node boundary (11):** `validateInvestigationResponse` re-derives every
   per-claim confidence category from the payload's own claims + evidence
   items (mirroring D1 in `Backend/src/services/revResponseAdaptation.js`)
   and rejects: unknown enum values, numeric `score` in new responses,
   claim-confidences that disagree with the re-derivation, coverage/confidence
   conflation, percentage strings in `communication`. Fail-closed, same
   pattern as claims/outcome/specialists. A golden parity set
   (`gen_response_adaptation_golden.py` → `response_adaptation.golden.json`)
   pins Python↔Node identity, matching the Task 203/204/207/208 pattern.

5. **Frontend (8):** types extended; `RevAnswerView` renders `sections` in
   the given order (still skipping empties — no section may render empty),
   renders the confidence category as natural language inline (not a badge,
   per REV-CONVERSATION-EXPERIENCE-SPEC §5 badge discipline), and renders
   coverage/freshness/certification in the "How I checked" disclosure
   separately from confidence.

6. **Performance (10):** everything above is deterministic; zero additional
   LLM calls on any path (meta follow-ups answer from the persisted context
   window with no tools — same cost class as provenance follow-ups).

7. **Security (11):** confidence and claims are derived server-side (Python);
   Node independently re-derives at the boundary; the frontend renders only.
   All lookups stay inside the authenticated org/store; the context window is
   per-conversation and org-scoped (existing `last_claims` filter on
   `organization_id`); nothing writes.

## 4. Verification plan (maps to spec §11)

- `python/tests/test_rev_response_adaptation.py` — unit: A–H classification,
  D1 derivation across the confidence matrix (13–22), element selection
  (1–12), meta-followup resolution (29–36).
- `python/tests/test_rev_adaptive_response.py` — integration through
  `run_investigation` with FakeDB: adaptive structure end-to-end,
  recommendations (23–28), API/contract shape (37–45), backward compatibility
  of the legacy response keys, guardrail regression (46–50: full existing
  suites re-run — 197 findings, 203 quality, 204 epistemics, 205 guardrails,
  206 priority, 207 outcomes, 208 specialists, 209 multi-period, conversation
  experience, golden set).
- `Backend/src/tests/revResponseAdaptation.test.js` — Node re-derivation +
  golden parity + boundary rejection cases.
- Frontend: `RevPresentation.test.tsx` / `RevQuietPresentation.test.tsx`
  / `RevLegacyParity.test.tsx` extended for the new contract, legacy
  adaptation, and no-fabrication discipline.
- Production: live investigation on `revluma-test-store-v1.myshopify.com`
  only (retired store never touched), deployed revisions probed
  (Vercel alias + Render `/ready` SHA), SSE stream checked.

## 5. Status (2026-11-07)

Implemented and locally validated — decision REV-DEC-0019, report
`implementation/TASK-210-ADAPTIVE-ANSWER-STRUCTURE-CONFIDENCE.md`, validation
record `validation/TASK-210-ADAPTIVE-ANSWER-STRUCTURE-CONFIDENCE.md`, audit
entry in `audit-register.md`. The branch was rebased onto main `b28a77a`
(Task 211 merged in flight) with a three-way merge on `investigation.py` and
`mlService.js` keeping both tasks' contracts intact. Local evidence
(post-rebase): Python 80 new tests green + full suite 2148 passed (4
pre-existing env failures); Node rev* suite 212 passed across 20 files incl.
the 18 adaptation/mirror/golden/boundary tests; 7 real Python-generated
payloads pass both the new adaptation validator and the full investigation
validator with production store scope; frontend full suite 516 passed (10 new
Task 210 tests) with `tsc --noEmit` clean. Remaining: CI on merge,
post-deploy revision verification (Render `/ready` SHA probe + Vercel
revision), live-store end-to-end acceptance (spec §11, human runbook).
