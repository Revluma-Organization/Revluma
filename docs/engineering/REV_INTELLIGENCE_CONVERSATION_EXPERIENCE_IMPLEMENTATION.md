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
| I1/I3/I4 | arena/3cfa18ed-revluma | #272 | b8d5088 | dpl_Gnvbxq47yqYi81bV14V9jUfaNX9W (READY/PROMOTED, revluma.vercel.app) | CI 6/6 green; Python 879; Dashboard 446; deploy verified 2026-11-04. Modes assign in production only after the Python Render service redeploys (user-only action); frontend fallback degrades gracefully until then. |
| I2 | arena/67999bda-revluma | #273 | 03bcbcd | dpl_SrRX6P2giHoAGykqeABqXe1sMccp (READY/PROMOTED, revluma.vercel.app) | CI green (dashboard 2m2s + Vercel; python/backend path-filtered out — frontend-only change); Dashboard 451/30 files; vite build clean; rev tsc 0, total 17 pre-existing baseline; deploy verified 2026-11-04. Unified renderer: legacy ResponseCard/RichText removed, legacy turns adapt via legacyResponseToPayload into RevAnswerView; VerifiedComparison absorbed into shared renderer; semantic heading scale, italic, table header semantics; parity tests (5). |
| I5 | arena/67999bda-revluma | #275 | 4df88f6 | dpl_6vZCYRtghWjWiE5jjst4LDj2M1Hm (READY/PROMOTED, revluma.vercel.app) | CI 6/6 green (python-regressions pass confirms the 4 local DB-config failures are environment-only); Dashboard 462/31 files (11 new tests); vite build clean; tsc zero Rev-path errors; deploy verified 2026-11-04. Note: the follow-up gating ships to production behaviour only when the Python Render service redeploys (user-only action); the frontend already renders exactly what the payload carries. Evidence disclosure, citations, comparisons, follow-ups: 'How I checked' disclosure (honest step statuses, period/currency, per-source detail, missing fields labelled Unavailable); inline numbered citation chips at fact claims resolving only to retrieved records; comparison facts in their own section; compact monetary provenance kept in quiet modes; backend follow-ups evidence-gated — generic filler chips removed from _follow_ups and conversational turns. |
| I6 | arena/82290441-revluma | #277 | 0d2bf2d | dpl_G5JyPsHeuRqPVhBVPg23BAeeBi5f (READY/PROMOTED, revluma.vercel.app) | CI 5/5 green (dashboard job path-filtered out — python/docs only); python 1389 passed/3 skipped + golden set 511/511 (507 cases, 107 prompts, all criteria 100%); Dashboard 462/31; deploy verified 2026-11-04. PARTIAL certification issued — outstanding: acceptance transcripts A–E (user-only), production mode assignment (Render redeploy, user-only), visual-regression snapshots, manual screen-reader walkthrough. |
| Hotfix TRANS-001 | arena/08f253b4-revluma | #279 | d19f5b6 | dpl_FLmGghoPPfiLPwNAxYRrUbF2Q2Fr (READY/PROMOTED, revluma.vercel.app) | CI 6/6 green; python 1399 passed (+10 transcript tests; 4 environment-only DB failures); golden 511/511 with leaked terms added to prohibited claims; Dashboard 467/31; vite build clean; deploy verified 2026-11-04. Merchant live-test defect: the connection question was answered as a coverage report with machine count facts, a self-contradicting recommendation and internal notation ("half-open", "[start, end)", microsecond ISO, "Coverage status:") — violating transcript A/P6/§8. The payload also proved production Python predated #272 (no response_mode field); the Render redeploy remains user-only before transcript A can pass. |
| Hotfix GREET-001 + MODE-PERSIST-001 | arena/86fb7554-revluma | #281 | b6c9e01 | dpl_GnNoJcsnKPJqfbPTV1wj1FM1Mxz8 (READY/PROMOTED, revluma.vercel.app); Render Node+Python redeploy user-only | Greeting/rapport contract (spec v1.1.0 §13): addressee/emoji-tolerant greeting rule with no tool run; greeting answers greet back as the boss, check in, then offer capabilities in their own paragraph; Node persists+streams response_mode/mode_reason (previously dropped, which also made production mode assignment unverifiable and mis-modeled quiet turns as investigations); UI hides empty disclosure sections and treats an empty evidence shell as no evidence. Gates: python 1406 (+7), Backend contract test, Dashboard 470/31, tsc baseline 17, build clean; CI authoritative for the Backend suite (prisma generate needs binaries.prisma.sh, unreachable from the sandbox). |
| Hotfix CONV-001 | arena/4397bb23-revluma | #283 | 60050c0 | Vercel dpl_8iLWtCKmvLbcwEtgeQYoxySS5cFz PROMOTED (frontend unchanged by this fix); Render Python redeploy user-only | Mutual conversation (spec v1.2.0 G13.5/G13.6): social route for wellbeing/thanks/farewell with store-noun guard; conversational offer for unsignalled chatter; overview pattern no longer swallows 'how are you doing'; identical fact sentences cite together instead of repeating. Gates: python 1415 (+10 social tests, golden overview prompts pinned to still investigate); CI authoritative. |
| Conversational engine upgrade increment 1 (ARCH-001) | arena/f3ba3a46-revluma | #285 | 049b0c3 (Vercel dpl_5vQsPQETYvRhqn4JyQRKVyybBeTQ PROMOTED) | Python + Node contract field; both Render services redeploy user-only | Unified understanding-driven lifecycle on the production path: L0 guard, L1 deterministic safeguards, L2 model understanding (understanding.py), single investigation gate (tools/conversational/clarify), dynamic composition via responder composers with deterministic degradation, conversation_state continuity with TTL + topic-change reset, understanding/mode metadata through Node persistence (contract §16). Design + evaluation record: docs/engineering/REV_CONVERSATIONAL_INTELLIGENCE_PRODUCTION_UPGRADE.md. Gates: python 1451 (+36 routing cases), Backend contract test, CI authoritative. |
| Conversational engine upgrade increment 2 (ARCH-002) | arena/9b8ada25-revluma | #287 | 2f627f3 (Vercel dpl_Ewu7dt5S1vg9r6SzhvHoPVmeFLLw PROMOTED) | Render Node + Python redeploy user-only; verify via /ready node_build + python_version 0.5.0 | Frontend contract consumption (understanding.gate authoritative for quiet presentation; zero report scaffolding on conversational/knowledge/clarification turns even with legacy fields; dead revAnswerState path removed; legacy-sections fallback preserved); expanded evaluation (+50 cases: misspellings, fragments, emotion, sarcasm, corrections, ambiguity, topic change, 14-turn conversation, outage, junk output, dynamic-generation guarantees); ACK safeguard extended to multi-token acknowledgements; backend lifecycle contract test (Python SSE -> Node -> persistence -> browser frame); deploy-version markers on /ready. Python 1501, Backend rev tests green, Dashboard green. |

## Unresolved / user-only

- Production visual confirmation of conversation changes (authenticated page).
- Retention decision for `business_states` history (unrelated project; tracked in
  `docs/engineering/PRODUCTION_REMEDIATION_MASTER.md`).
