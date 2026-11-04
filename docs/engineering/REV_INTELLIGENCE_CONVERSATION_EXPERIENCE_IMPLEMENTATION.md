# Rev Intelligence — Conversation Experience Implementation (persistent task record)

Owner: Arena session branch `arena/3cfa18ed-revluma` · Started: 2026-11-04
Spec: `docs/rev-intelligence/REV-CONVERSATION-EXPERIENCE-SPEC.md` (v1.0.0)
Source plan: `Revluma_Rev_Intelligence_Conversation_Experience_Production_Implementation_Plan.pdf`
Scope discipline: no unrelated remediation, Shopify lifecycle, RLS or reasoning work in
this project unless a direct dependency blocks it; related defects recorded separately.

## Baseline (Phase 0 record, captured 2026-11-04)

- `origin/main` at task start: `55d0d3a` ("Fix Rev Intelligence false no-store warning",
  PR #271, user-authored), on top of `d50c9d4` and `9d270aa` (PR #269 drawer/theme work).
- Dashboard suite at baseline: 436/436 (28 files). Python: 873 passed / 3 skipped.
  Backend: 33 passed / 9 pre-existing local-env failures (pass in CI).
- Production: Vercel project `prj_4f3MJwxdXHDQguveNw5dZaVr7fQj`; deployment for `55d0d3a`
  observed Building at user screenshot time — re-verify before I1 merge.
- Active test store: `revluma-test-store-v1.myshopify.com` (store `3ed79446`,
  org `1dc6aa19`), status `active`, token present, synced; scopes granted.
  Retired store `bys-user-store-923319-1ifggjsw.myshopify.com` never used.

### Code map (verified, with line anchors at baseline)

- `Frontend/Dashboard/src/pages/RevIntell.tsx` — conversation state, stream handlers,
  legacy `RichText` (L310) and `ResponseCard` use (L709): the second rendering path.
- `components/rev/RevAnswerView.tsx` — structured renderer; per-message badges
  "Partial evidence" (L27), "Confidence NN%" (L131), "Read-only" (L136),
  "Some checks could not complete" (L198).
- `components/rev/RevMarkdown.tsx` — hand-rolled parser; unconventional heading map
  `#`→h2 (L109-111), `##`→h3 (L89-92), `###`→h4 (L82-84); no table support.
- `components/rev/InvestigationTimeline.tsx` — progress renderer, step-status oriented.
- `components/rev/EvidencePanel.tsx` — evidence disclosure (already expandable).
- `lib/revStream.ts` / `lib/revPresentation.ts` — stream parsing and presentation
  helpers; `payload.facts`, `comparison_facts`, evidence items.
- `python/src/agents/investigation.py` — `TOOL_STEP_LABELS` (L570) human-readable step
  labels already exist; intent classes (L126-136+); `investigation.follow_ups`
  evidence-gated follow-ups already computed; stream emits plan/step/evidence/final.

### Defects this project must fix (evidence-backed)

1. Every answer renders full report scaffolding (badges, confidence, provenance,
   recommendations, follow-ups) regardless of question complexity — the "is my store
   connected?" transcript captured 2026-11-04.
2. Heading semantics inverted/unconventional in `RevMarkdown.tsx`.
3. Two overlapping rendering paths risk inconsistent typography and evidence handling.
4. Progress presentation is step-status oriented, not merchant-language communication;
   scroll is hijacked during streaming (auto-scroll on every message change).
5. Follow-up suggestions computed backend-side are not surfaced; welcome starters are
   the only chips.

## Phase checklist (plan phases 0-12 → increments I1-I6)

- [x] Phase 0 baseline: SHA, tests, code map, payload paths, defects (this document).
- [x] Phase 1 specification: `REV-CONVERSATION-EXPERIENCE-SPEC.md` v1.0.0.
- [~] I1 (plan Phases 2-3): `response_mode` + `mode_reason` emitted by Python
      (`select_response_mode`, guard-first) with `python/tests/test_response_mode.py`;
      frontend `RevResponseMode` type + `responseModeOf` validation with fallback
      (legacy payloads keep full rigour). Event-envelope versioning still open.
- [ ] I2 (Phase 4): unified renderer, semantic typography, safe Markdown + tables,
      legacy parity tests then legacy removal.
- [ ] I3 (Phase 5): truthful progress copy from real events, collapse on final,
      interrupted/failed states, timing telemetry.
- [ ] I4 (Phases 6-7): mode behaviours, badge discipline, answer-first layouts,
      scroll discipline, commerce answer quality set.
- [ ] I5 (Phase 6/8): evidence disclosure, comparison layouts, follow-up chips,
      inline citation chips, accessibility + theme + mobile polish.
- [ ] I6 (Phases 9-12): evaluation gates, preview acceptance, merge, deploy,
      production smoke tests, monitoring window, certification report.

## Decision log

- D1 (2026-11-04): Mode selection is backend-assigned with deterministic guards first;
  frontend validates and falls back to plain text. Rejects frontend-only guessing.
- D2 (2026-11-04): Store lookups are tri-state `connected / disconnected / unverifiable`;
  probe failures never render as "not connected" (codifies the PR #271 lesson).
- D3 (2026-11-04): Charts deferred to Comparison mode with a proven use case; no chart
  infrastructure before then (overengineering risk, plan §15).
- D4 (2026-11-04): Monetary answers keep one compact inline provenance line (period,
  timezone, currency, freshness) even in simple modes — truthfulness outranks minimalism.
- D5 (2026-11-04): Emoji limited to ≤1 per answer on verified positive confirmations;
  never on financial warnings or failures.
- D6 (2026-11-04): Legacy renderer removed only after parity tests; no blind rewrite.
- D7 (2026-11-04): Performance figures in spec §3/§10 are proposed targets, not SLOs,
  until measured against current infrastructure.

## Test commands

- Dashboard: `cd Frontend/Dashboard && npx vitest run` · build `npx vite build` ·
  types `npx tsc -b --noEmit` (17 pre-existing errors outside Rev paths at baseline).
- Python: `cd python && DATABASE_URL='postgresql+psycopg2://placeholder:placeholder@localhost:5432/placeholder' /home/user/.venv-rev/bin/python -m pytest -q tests --no-header -p no:cacheprovider --continue-on-collection-errors`
- Backend: `cd Backend && npm test` (9 known local-env failures; CI is authoritative).

## PR / deployment / verification log

| Increment | Branch | PR | Merge SHA | Deployment | Verified |
|---|---|---|---|---|---|
| (baseline) | arena/3cfa18ed-revluma | — | — | — | docs only |

## Unresolved / user-only

- Production visual confirmation of conversation changes (authenticated page).
- Retention decision for `business_states` history (unrelated project; tracked in
  `docs/engineering/PRODUCTION_REMEDIATION_MASTER.md`).
