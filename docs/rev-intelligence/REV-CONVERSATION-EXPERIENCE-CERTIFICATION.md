# Rev Conversation Experience — Certification Report

Spec: `REV-CONVERSATION-EXPERIENCE-SPEC.md` v1.0.0 · Report date: 2026-11-04 ·
Increments certified here: I1–I6 (deterministic layer).

**Verdict: PARTIAL CERTIFICATION.** The deterministic conversation layer is
certified against every offline-evaluable criterion in spec §10, with the
golden-set gates encoded as a CI merge precondition. Full certification is
withheld because four criteria require actions only the merchant/operator can
perform (authenticated acceptance, the Python Render redeploy) or tooling that
does not yet exist (visual-regression snapshots). They are listed honestly
below — none is marked passed.

## 1. Golden-set evaluation (spec §10, gate: merge precondition)

Harness: `python/tests/test_golden_set.py` — runs in CI on every change.

- **507 scored cases** from **107 unique prompts** × 6 evidence states
  (single verified finding, multi-tool investigation, period comparison,
  connection-only check, no verified evidence, degraded status), plus
  conversational, read-only-boundary and clarification transcripts.
- Scorecard at certification time (all gates in the harness; directness gate
  ≥95%, every other gate 100%):

| Criterion | Rate | Gate |
|---|---|---|
| Intent classification | 100.0% | 100% |
| Response-mode selection (guard-first) | 100.0% | 100% |
| Required facts present | 100.0% | 100% |
| Answer directness (lead fact/limitation in first two lines) | 100.0% | ≥95% |
| Prohibited claims (§8 internal terms, promised uplift, execution claims) | 0 violations | 0 |
| Uncertainty handling (hypotheses labelled "not established") | 100.0% | 100% |
| Recommendation measurability (measure + "nothing changed or sent") | 100.0% | 100% |
| Follow-up gating (no generic filler; chips only evidence-backed) | 100.0% | 100% |
| Read-only compliance | 100.0% | 100% |
| Verbosity (deterministic result texts within ceilings) | 100.0% | 100% |

- Golden-set finding fixed during certification: the traffic pattern missed the
  plural "landing pages" despite the classifier's plural-tolerance contract —
  repaired (`\blanding pages?\b`) and pinned by six golden cases.
- Scope honesty: the harness certifies the **deterministic** layer (routing,
  mode guards, composed answers, gating, claim discipline). Optional LLM
  narrative rewrites are validated at runtime by `_validate_narrative`
  (evidence-number checks, execution-claim rejection, injection rejection) and
  are not scored offline.

## 2. Progress truthfulness (spec §10: 100% real-event backing)

- Every displayed step name comes from backend `investigation.steps` labels
  (`TOOL_STEP_LABELS`); the frontend invents no steps, percentages or ETAs.
  Pinned by `RevAnswerMode.test.tsx` (live named progress, removal on settle)
  and `InvestigationTimeline` tests (compact one-line status, `done/total`
  from real step records).
- Interrupted/failed states render honestly: step statuses map failed →
  "failed", pending → "did not run" in the disclosure; a degraded investigation
  downgrades the state pill to "Partial evidence" (`deriveState`).

## 3. Accessibility and themes (spec §10)

Verified in code and tests:
- Live regions: streaming status (`role="status"`), errors (`role="alert"`),
  drawer loading/empty states, copy/rename toasts — 20+ regions in
  `RevIntell.tsx`.
- Keyboard/focus: global `:focus-visible` ring for `.rev-workspace` and modal
  layers; native `<details>/<summary>` disclosure; chips are real `<button>`
  elements with descriptive `aria-label`s; touch targets ≥44px (`min-h-11`).
- Semantics: table headers carry `scope="col"`; heading scale is semantic
  (h2/h3/h4); citation chips announce as "Citation N: label — open evidence".
- Reduced motion: global `prefers-reduced-motion` kill-switch for animations,
  transitions and smooth scrolling across the Rev workspace and modals.
- Themes: all Rev surfaces take `dark` and use theme tokens; light/dark pinned
  by `EvidencePanel` and parity tests.

## 4. Security (spec §10)

- Prompt injection: `python/tests/test_rev_prompt_injection.py` — narratives
  that obeyed injected instructions are rejected.
- Read-only: every result carries `read_only: true`; requested actions are
  listed and `executed_actions` stays empty (golden-set criterion 9); tool
  allowlists remain read-only in the backend (PR #251 capability preserved).
- Tenant scoping of citations: evidence controls resolve only against records
  attached to the current payload (per-turn `evidenceById`); unresolvable ids
  never render (`RevEvidenceDisclosure.test.tsx`).

## 5. Regression gates at certification time

- Dashboard: 462 tests / 31 files passing; `vite build` clean; typecheck at the
  17-pre-existing-error baseline, zero in Rev paths.
- Python: 1389 passed / 3 skipped locally; the only local failures
  (2 × `test_api`, 2 × `test_db_diagnostics`) reproduce identically with all
  changes stashed and pass in CI (`python-regressions` green on #275) — they
  are sandbox DB-configuration artifacts.
- CI history for this initiative: #272 (6/6), #273, #274, #275 (6/6) green
  before merge; production deployments verified READY/PROMOTED
  (`dpl_Gnvbxq…`, `dpl_SrRX6P…`, `dpl_6vZCYR…`).

## 6. NOT certified — outstanding criteria (honest list)

| # | Criterion | Blocker | Owner |
|---|---|---|---|
| 1 | Acceptance transcripts A–E against the live test store (`revluma-test-store-v1.myshopify.com`) | Requires an authenticated browser session | Merchant (user-only) |
| 2 | `response_mode` assignment in production responses | Python service on Render must redeploy to pick up #272/#275 | Operator (user-only) |
| 3 | Visual-regression snapshots light/dark × desktop/mobile | No snapshot tooling in repo; manual review pending | Engineering + merchant |
| 4 | Manual screen-reader walkthrough | Automated semantics verified (§3); manual pass not yet performed | Merchant/engineering |

Full certification is granted only when rows 1–2 are verified in production
behaviour (not deploy status) and rows 3–4 are completed or explicitly waived.

## 7. Issues log and resolved defects

| ID | Reported | Symptom (production evidence) | Root cause | Fix | Verification |
|---|---|---|---|---|---|
| TRANS-001 | 2026-11-04, merchant live test | "Hey Rev, is my store connected?" answered with a coverage-certification report: count facts ("1 connected store(s)"), duplicated coverage claim, "Complete the initial sync" recommendation contradicting "1 store has completed a sync", robotic filler, internal notation in merchant copy ("half-open", "[start, end)", microsecond ISO, "Coverage status: partial", doubled "(UTC)"), compare chip — violating transcript A (§4.1), P6 and §8 | Coverage answers composed by template sections over machine-count facts; period/semantics strings leaked; renderer appended its own timezone note; payload also proved the production Python predated #272 (no `response_mode`), so the renderer fell back to full report scaffolding | PR #279 `d19f5b6`: `_verification_answer()` direct-prose composer (skips narrative rewrite), humanised fact builders, human provenance + status sentences, empty-string fillers, no coverage compare chip, `formatPeriod` human UTC windows, transcript A chrome gating | Python 1399 (10 new transcript tests), golden set 511/511 with leaked terms added to prohibited claims, Dashboard 467/31, CI green, Vercel `dpl_FLmGghoPPfiLPwNAxYRrUbF2Q2Fr` PROMOTED; backend half awaits the Render redeploy (row 2 above) |
