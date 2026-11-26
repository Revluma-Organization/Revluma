# Phase 5F — Initial Audit Report (audit only, no code changed)

**Date:** 2026-11-26. **Branch:** `arena/40e7bfb5-revluma` (branched from `main@60cec512`).
**Baseline deployed:** prod `dpl_83RPQeXEjAPRreBtAwAaxDBSiNcG` (Phase 5E) READY/PROMOTED.
**Target store:** `revluma-test-store-v1.myshopify.com`
(store `3ed79446-cb6d-4a1c-b174-9ec1ab91fe15` / org `1dc6aa19-9737-4770-a340-ff812a8b139a`).
**Rule honored:** zero code changes, zero record modifications. All DB access was read-only `SELECT`.

## 1. Scores (0–100, rigor over passing)

| Dimension | Score | One-line basis |
|---|---|---|
| Investigation quality | **85** | 13 A–L scenarios + 11 routing scenarios + golden/epistemic suites pass through the real pipeline; captured payloads are disciplined; live-store runs impossible from sandbox (limitation L2) |
| Evidence integrity | **58** | Pipeline discipline exemplary; **live cart data is corrupted** (C1) and the $38k figure is invalid (H1) |
| Commerce intelligence (incl. recommendations) | **78** | Recommendations non-executed, measurable, caveated; rank/challenge/invalidate verified; wording assumes dedup the data violates (H1) |
| Workspace UX | **62** | Contrast 14/14 pass, focus system sound, honest empty states; ~50 sub-10px declarations incl. evidence body text (H4); no visual verification possible (L1) |
| Reliability | **66** | All 5B–5E contracts verified in code; 13% historical rev error rate in bursts; 33% of convos carry duplicate sequence numbers (C2) |

Unweighted mean: **69.8**. The product's *reasoning discipline* is strong; the *stored data* and *conversation persistence* carry the critical defects.

## 2. Data inventory (completed, sequential queries — Q4 ✓)

Store-scoped, each from a single sequential `execute_query` (request IDs in §9):

| Table | Count | Notes |
|---|---|---|
| orders | 5 | 10/27–10/30, all USD; totals 0 / 749.95 / 1025 / 1571.90 / 0; one $100 refund |
| order_items | **5** | resolved (was ambiguous) |
| products | 17 | 15 active snowboards + draft + archived + gift card |
| customers | **21** | resolved (was ambiguous) |
| inventory_levels | **28** | resolved (was ambiguous); quantities in JSON, no `available` column |
| abandoned_carts | 35 rows / **30 distinct checkouts** | see §3 — NOT "35 open carts" |
| refunds | 2 | |
| transactions | 10 | |
| findings | 4 open | no_recent_orders H, abandoned_checkouts_open H, inventory_stockouts H, storefront_domain_unconfigured M |
| conversations / messages | 116 / 540 (271 user / 269 rev) | see §4 |
| sync domains | 32 ok / 4 failed | failing: shop.policies, content.redirects, online-store.menus, analytics.reports |

## 3. Financial evidence — the 35 carts (Q1 ✓)

**Canonical definition** (`python/src/intelligence/checkout_evidence.py:22-23`):
completed = `completed_at OR recovered_at OR linked order`;
abandoned = `source_resource='abandonedCheckouts' AND source_state='available' AND NOT completed`.
The module docstring: never present the population "as all checkout starts, lost sales or revenue".

**Measured canonical classification of all 35 rows:**

| Class | Rows | Distinct checkouts | Recorded value |
|---|---|---|---|
| completed (recovered_at set, all 4 linked to orders) | 4 | 4 | $3,946.85 |
| source_unavailable (historical evidence only, retained not deleted) | 8 | 8 | $9,156.55 |
| unknown_lifecycle (uncompleted, no explicit abandonedCheckouts evidence) | 23 | **18** | $25,152.80 |
| **abandoned (canonical)** | **0** | **0** | **$0.00** |

Facts established:
- **Zero carts can legitimately be classified as abandoned.** The 8 Shopify-sourced rows fail `source_state='available'`; the 23 others have `source_resource NULL` (definition: "Pending webhooks and legacy age-based records remain unknown").
- No cart has status `open` — the column holds `abandoned` (31) / `recovered` (4). Prior "35 open carts" phrasing is withdrawn.
- The $38,256.20 figure = completed value + historical-unavailable value + unknown-lifecycle value **including double-counted rows**. It must never be described as lost, at-risk, or abandoned revenue. Unique-checkout recorded value is $30,980.50–$32,766.45 (range: one dup pair carries conflicting values), and even that is *recorded cart value*, not recoverable revenue — exactly the distinction Rev's own recommendation text draws ("Recorded cart value is merchant data, not recoverable revenue", scenario E payload).
- Age: all abandoned 10/27–10/30 → **27–30 days old** on 11-26. Only the 8 Shopify-sourced rows carry `source_created_at`.
- Duplication: 5 external IDs × 2 rows; 4 identical-value pairs, 1 conflicting pair ($2,245.85 vs $1,459.90 — undeterminable which is true). Dup rows were created **3ms and 82ms apart** — a same-batch double-insert, not re-sync drift. Schema has only `@@index` on `(store_id, external_cart_id)` — **no unique constraint, no upsert key** (`Backend/prisma/schema.prisma`, `abandoned_carts`).
- Correction: the earlier "0 completed" inventory note was wrong — it missed `recovered_at`/order linkage. 4 carts are completed.

## 4. Conversation contamination (Q2 ✓)

Three distinct phenomena, separated by evidence:

**(a) Scripted eval/load traffic (test contamination).** Identical questions burst within seconds:
`What are the best Shopify apps for cart recovery in 2026?` ×8 in 46s (convo `7937a215`, 9/15);
ROAS-decline ×4 in 12s (`d481efbd`); cart-recovery-emails ×4 in 23s. The ×8 burst alternates
success / `INTELLIGENCE_INVALID_RESPONSE` errors — a load/retry script, not organic use.
Top repeats org-wide: "Hello" ×26/21 convos, "Hello chat" ×20/18, intro ×15/8, cart-apps ×14/4.

**(b) Client double-submit (product gap, H3).** Sub-second identical pairs ("Hello" 0.8s apart)
with **distinct** correlation_ids. Server idempotency held — 271/271 user correlation_ids unique,
0 reused — but it cannot catch two distinct UUIDs from a double-click/script. Distinct from (a) by timing.

**(c) REAL reliability bug (C2).** Duplicate `sequence_number`s from the `MAX()+1` allocation race
(`revSubmission.js` `acceptSubmission`): **78 tied sequence numbers (78 extra rows) across 38/116
conversations (33%)**. Observed: two user rows at seq 1, rev+user sharing seq 24/27/30 (`7937a215`).
Consequence: ordering ties everywhere and a cursor-page boundary hazard for `?before=` paging
(M3 — `LIMIT` can split a tie group; Postgres tie order is not guaranteed).

Minutes-apart repeats (e.g. ×4 over 32 min on 10/28) are consistent with genuine human re-asks.
No records were modified; cleanup is proposed, not performed.

**Rev error history (reliability evidence):** 35/269 rev turns failed (13.0%):
`INTELLIGENCE_INVALID_RESPONSE` 17, `INTELLIGENCE_UNAVAILABLE` 11, `INTELLIGENCE_AUTH_FAILED` 3,
`INTELLIGENCE_TIMEOUT` 2, `PROVIDER_FAILURE` 2. Clustered: 8/20 (11/13), 9/15 eval-burst day (10/68),
10/27–28 (9/92). **November: 2 errors in 38 turns (5%)** — the bulk is historical/scripted traffic.

## 5. Actual investigation quality (Q5 ✓ — executed, not inspected)

Ran 8 behavioral suites in a fresh venv (CI recipe: `pip install -r requirements.txt pytest`):
`test_rev_investigation_scenarios` (A–L, real `run_investigation` + FakeDB), `test_rev_eleven_scenarios`
(routing/refusal/isolation), `test_golden_set`, `test_rev_epistemics`, `test_rev_epistemic_pipeline`,
`test_rev_checkout_evidence`, `test_conversational_evaluation` (+phase7) → **682 passed, 0 failed**.
Repro: `/home/user/Revluma/.venv-5f/bin/python -m pytest -q <files>` from `python/`
(venv is git-ignored scratch; exclusion list covers `.venv*` only by name `.venv` — the 5F venv
must be deleted or left untracked before any commit).

**Captured real payloads** (script in Appendix A; fixture-driven, labelled synthetic):

- **A — "Why did my revenue drop this month?"** Currency-separated (USD 30.31/3 orders, NGN 1,000/1 order);
  −50% arithmetic with exact prior values; volume/value decomposition reconciles exactly
  (−30.31 = −30.31 + 0.00); "an arithmetic description of the change, not an explanation of its cause";
  recommendations carry `action_state=recommended, executed=false` + "Nothing has been changed or sent";
  limits + provenance sections present. Claims typed `observed`.
- **D — "Why are shoppers abandoning checkout?"** "Possible reasons… none verified";
  "The reason a shopper abandoned checkout is not recorded in the available data."
  Claims typed `verified_fact` / `hypothesis` / `unknown` — the rev-claim-v1 separation holds end to end.
- **E — "How much money am I losing from abandoned checkouts?"** (E08-analog) Refuses the premise:
  no losing/lost figure asserted; redirects to "Recorded cart value is merchant data, not recoverable
  revenue. Measure: Deduplicated unrecovered cart count and value per currency."
- **Provider-down behavior:** capture ran with `model_provider_unavailable (anthropic)` /
  `understanding_failed` logged — the deterministic pipeline still completed all three investigations.
  Fail-operational fallback verified by execution, not just code reading.
- **Production sample (real, 11-24, `gemini-3.6-flash`):** revenue investigation reporting 0 orders,
  degraded integration, `unsupported`/`partial` statuses, separated hypotheses. Payload shape confirmed:
  `text/facts/claims/evidence{items,coverage,freshness,by_currency,limitations,generated_at,schema_version:
  rev-evidence-v2}/unknowns/warnings/read_only/epistemics/hypotheses/mode_reason/investigation`.

**8-scenario mapping:** revenue ✓ (A+B payloads), product ✓ (C), multi-turn continuity ✓ (B/K/09/10),
finding-context ✓ (G/H/J/L + finding chips), insufficient-evidence ✓ (I + D/E + prod sample),
store ✓ partial (D payload + conversational suites), conversion ~ partial (asked in prod, answered;
no dedicated fixture scenario found), inventory ~ partial (real `inventory_stockouts` H finding;
no dedicated fixture scenario executed). Live-store runs: impossible from sandbox (L2).

**Epistemic discipline (observed vs lost vs estimated vs undeterminable):** observed figures always
recorded + currency-explicit; "lost" language blocked by `narrative_guardrail_errors` and refused live
in E; estimated/recoverable figures require methodology/version/inputs/coverage/assumptions/limitations +
`eligible` + attribution-verified (`financial_evidence_errors`, `claim_guardrails.py:155-185`) and no
live estimated figure was observed; undeterminable states are explicit (`unknown` claims, "not recorded",
"not established"). Canonical `financial_impact ∈ {lost,…}` is rejected outright
(`canonical_financial_impact_not_eligible`).

## 6. Technical contracts (Q7 ✓ — file audit)

| Contract | Verdict | Evidence |
|---|---|---|
| AuthN/AuthZ + tenant isolation | ✅ VERIFIED | All `/rev/*` behind `authenticateToken` + `chatLimiter` (`revRoute.js:85-128`); org exclusively from JWT+membership (`getAuthenticatedOrg`); cross-org → 403 + `rev_cross_tenant_attempt` warn (`revController.js:48-70`); Python `/rev/investigate`, `/rev/stream`, `/orchestrate` behind `verify_internal_caller` (constant-time key compare) + internal-network check (`api.py:319-360,838,1468,1547`); cross-tenant contract tests exist (`revInvestigation.contract.test.js:300`, `task215SyncRetry.test.js:117`) |
| Read-only | ✅ VERIFIED | `execute:true` → 403 READ_ONLY (`revSubmission.js`); `read_only:true` in prod payloads; action states forced `recommended`/`executed:false` (`claim_guardrails.py:207-240`); scenario 11 refusal test passes |
| SSE streaming | ✅ VERIFIED | Parser 2MB buffer cap + frame validation (`revStream.js`); frontend 130s overall + 45s inactivity timeouts, final-envelope authority, terminal-error irreversibility (`revStream.ts:385-501`) |
| True retry | ✅ VERIFIED | Eligibility gate (`RETRY_IMAGE_REQUIRED` / `RETRY_NOT_ELIGIBLE` / `RETRY_ALREADY_COMPLETED`), failed-attempt deletion before re-entry, `reuse_user_message` (`revController.js:2044-2131`); frontend rehydrates from server truth on ALREADY_COMPLETED (`RevIntell.tsx:1828-1840`) |
| Cursor paging | ⚠️ VERIFIED with hazard | `?before=<seq>`, `sequence_number < before`, newest-first, limit ≤100, `offset` ignored (`revController.js:682-716`); frontend consumer passes cursor (`RevIntell.tsx:1229`) — but C2 ties create a boundary hazard (M3) |
| Restore | ✅ VERIFIED | Ownership check + correlation/execution headers + `rev_conversation_restoration_failures_total` metric (`revController.js:659-757`); no-blank-conversation transaction (`revSubmission.js`) |
| No duplicate persistence | ⚠️ VERIFIED except C2/H3 | Idempotency key `(organization_id, conversation_id, role, correlation_id)` + deterministic v5 conversation IDs + 409 on reuse (`revSubmission.js`) — defeated only by distinct-UUID double-submits (H3) and the seq race (C2) |
| Input validation | ✅ VERIFIED | 2000-char cap rejected (not truncated), UUID request_id, NUL-strip (`validateSubmission`) |

## 7. Workspace review + typography + skill application (Q3/Q6/Q8 ✓)

**Screenshot limitation (L1, explicit):** no browser binaries, no Playwright, zero system browser
libraries (`ldconfig` count 0), no Xvfb; browser CDNs are outside the sandbox allowlist, so no
headless Chromium can be installed. **No screenshots were captured or inspected — none are claimed.**
Safe alternative: an authenticated Playwright matrix (1440/1280/1024/768/390) executed by the user or
CI against the deployed preview with a test-merchant session; proposed spec in Appendix B. Static
substitute performed instead: breakpoint/class audit below — labelled static, not visual.

**Static responsive audit:** exactly ONE JS breakpoint (`wide = min-width:1024px`: history rail
permanent ≥1024, drawer + menu button below; `RevIntell.tsx:918,1081,2168-2213`) and ~4 responsive
utility classes (`lg:pt-6` ×2, `sm:max-w-[72%]`, `sm:grid-cols-3` on follow-up chips). Between 390–1024
the layout is essentially one unchanging flow; dialogs are `max-w-sm`/`max-w-[460px]` (safe at 390
if padded — unverified visually). Narrow tuning for 768/1280/1440 is absent (M1).

**Typography correction and map (Q3):** the "16" was the 0.62–0.66rem subset. Full sub-10px audit
(14px root) finds **~50 declarations at 0.60–0.70rem (8.4–9.8px)** — all below MASTER's own
10.5px eyebrow floor (Stage 1 addendum type scale). Map (important vs secondary):

- IMPORTANT at 8.7–9.2px (0.62–0.66rem): state pills ×2 (RIV:333, RAV:196), class badges
  Calculated/Comparison/Hypothesis/Unknown (RIV:65), evidence status badges (EP:78), citation
  markers (CC:76), severity/category chips ×3 (RI:847/853/860), mode chip "Finding context/General"
  (RI:814), disclosure headings ×2 (RIV:28, RAV:30), read-only capability limitation (RI:769).
- IMPORTANT at 9.5–9.8px (0.68–0.70rem): evidence definitions/limitations/provenance (EP:90-331,
  ~9 lines), limitation/unknown lines (RIV:120-164, ~8 lines), section headings (RIV:79,
  RAV:397), "Sources:" label (RIV/RAV:518/272), period/currency line (RIV/RAV:509/263),
  message action-dock buttons ×4 (RI:502-547), char-capacity live region (RI:605),
  citation popover body/trigger (CC:39/83), follow-up card subtitles (RI:2537).
- SECONDARY: rail subtitle (RI:696), convo date meta (RI:745), evidence count (EP:169),
  footer trust line (RI:2603), timeline step detail (IT:92/100), copilot labels (CP:240-269).
- SMALLEST: copilot footer hint at **0.60rem = 8.4px** (CP:316).

**Skill + MASTER application (verified defects vs preferences):**

| # | Verdict | Standard | Finding |
|---|---|---|---|
| H4 | ✅ DEFECT | MASTER eyebrow floor 10.5px | ~50 sub-10px declarations; evidence/limitation/state text below floor |
| M4→Low | ✅ DEFECT | MASTER "Missing cursor:pointer" forbidden | 39 `<button>`s, zero `cursor-pointer` (Tailwind v3 default arrow); only `cursor-wait` ×2. Only inline-compliant control: citation marker. Fix: one global CSS rule |
| — | ✅ PASS | Skill: focus visible + no removal w/o replacement | Global `:focus-visible` 2px outline rule (RI:2158); composer removes its own outline but parent has `focus-within:ring-2` (RI:598) |
| — | ✅ PASS | Skill: error summary + keyboard + streaming | SSE streams tokens (no 10s spinner); retry announces via live region; error states keep evidence (5D) |
| — | ✅ PASS | MASTER: no emoji icons; contrast ≥4.5 | Zero emoji in Rev surfaces; 14/14 contrast pairs pass (4.48–17.06, computed) |
| — | ✅ PASS | Skill: empty states need message + action | No-store + no-data states carry explanation + next step (RI:2305-2311) |
| — | ⚠️ NOTE (preference, not defect) | Skill: compact-label nowrap | All chips/badges already nowrap/uppercase — compliant; raising size per H4 must preserve this |
| — | ⚠️ NOTE | MASTER `prefers-reduced-motion` | Respected globally (RI:2159) — pass, visually unverified |

## 8. Findings register + proposed fixes (no implementation performed)

**Critical**
- **C1 — Cart double-insert; conflicting values.** 5 dup rows (1 conflicting $2,245.85/$1,459.90),
  same-batch 3–82ms apart; no unique key. *Fix:* unique constraint `(store_id, external_cart_id)` +
  upsert-on-conflict in the abandoned-checkout ingest path; reconciliation job flagging value conflicts
  for re-fetch instead of second insert; backfill dedup (read-only decision needed — proposed, not run).
  Files: `Backend/prisma/schema.prisma` (`abandoned_carts`), checkout sync service, migration.
- **C2 — Duplicate sequence_numbers (78 pairs, 38 convos).** `MAX()+1` race in `acceptSubmission`.
  *Fix:* `pg_advisory_xact_lock(hashtext(conversation_id))` inside the acceptance transaction (or a
  per-conversation sequence); add `ORDER BY sequence_number, created_at, id` to paging queries (M3);
  cleanup plan for existing ties (proposed, not run). Files: `Backend/src/services/revSubmission.js`,
  `Backend/src/controller/revController.js` (`getConversation`).

**High**
- **H1 — Invalid cart metrics.** Any "abandoned cart value/count" from raw sums is wrong (0 canonical).
  *Fix:* all surfaces use canonical `_ABANDONED`/`_COMPLETED` aggregates; add a `quality_eligible=false`
  gate on unknown-lifecycle value sums; correct the `abandoned_checkouts_open` H finding's basis if it
  cites raw counts. Files: `python/src/intelligence/checkout_evidence.py` (already correct — enforce its
  use), finding engine, dashboard surfaces.
- **H2 — Eval traffic in merchant history.** *Fix:* scripted runs use dedicated sandbox orgs; document
  history-hygiene policy; annotate (not delete) the 9/15 + 8/20 bursts. Process fix.
- **H3 — Client double-submit.** *Fix:* hold a stable `request_id` per composer draft across the send
  attempt; disable send synchronously on submit (before await); ignore duplicate Enter within 1s.
  Files: `Frontend/Dashboard/src/pages/RevIntell.tsx` (send path), `revStream.ts`.
- **H4 — Sub-10px type incl. evidence text.** *Fix:* chips/pills/badges/state labels → ≥0.75rem (10.5px);
  evidence definitions/limitations/provenance → ≥0.78rem; disclosure eyebrows → 0.75rem; keep nowrap +
  atomic live regions; footer/meta → 0.75rem. Files: `rev/*.tsx`, `RevIntell.tsx`, `CopilotPanel.tsx`.

**Medium**
- **M1** Responsive tuning for 768/1280/1440 + authenticated Playwright matrix (Appendix B).
- **M3** Paging tie-break ordering (ships with C2).
- **M5** 4 failing sync domains + `bys-user-store` 351 failures (`SHOPIFY_READ_ORDERS_NOT_GRANTED`) —
  re-auth/permission flow review. Backend/sync.
- **M8** Recommendation copy assumes "deduplicated" counts (ships with H1/C1 verification).

**Low**
- **L-fix1 (M4)** Global `button { cursor: pointer }` (Tailwind v3 gap). One rule in `index.css`.
- **L-fix2** Telemetry: backfill `latency_ms`/model provenance discipline; mixed NULL/`claude-sonnet-4-6`/
  `gemini-3.6-flash` provenance unexplained.
- **L-fix3** Response polish: "across 1 orders" pluralization; "periods.. Nothing" double period
  (recommendation `Measure:` join).

**Risks (unverified, not scored as defects):** live 8-scenario runs on the real store; visual
breakpoints; provider latency/cost; PII handling in scripted prompts.

## 9. Reproducible evidence index

- venv build: `python3 -m venv .venv-5f && .venv-5f/bin/pip install -r python/requirements.txt pytest`
  (exit 0; PyPI allowlisted).
- Behavioral: `.venv-5f/bin/python -m pytest -q tests/test_rev_investigation_scenarios.py
  tests/test_rev_eleven_scenarios.py tests/test_golden_set.py tests/test_rev_epistemics.py
  tests/test_rev_epistemic_pipeline.py tests/test_rev_checkout_evidence.py
  tests/test_conversational_evaluation.py tests/test_conversational_evaluation_phase7.py`
  → **682 passed in 2.62s**.
- Payload capture: Appendix A script → A/D/E transcripts in §5 (stderr showed
  `model_provider_unavailable provider=anthropic` + `understanding_failed`, investigations completed).
- Supabase `execute_query` request IDs (project `jblpgqmbgdlzitprudgt`): inventory `217c9565/5e58f833/
  1bace22b/59a556d9`; carts `c9d8002c/660f46d8/c6f17407/018e51a4/38f17407/9931e7a3/70905222`;
  contamination `7ce50176/cea8e351/fb657f33/8c297ebf/3e03a2a0/7df0e3c0/d450d19a`; prod payload `63adb05e`.
- Contrast: computed WCAG ratios 4.48–17.06 (script in session log; pairs in §7).
- Skill: `.agents/skills/ui-ux-pro-max/scripts/search.py` ×14 queries; MASTER.md read in full (514 lines).

## 10. Explicit limitations

- **L0 (connector outage, recovered):** `execute_query` rejected all calls for a mid-audit window
  (`invalid_type, expected record`; `list_projects` unaffected). Retried only after 45s+ pauses; all
  affected counts were re-established with sequential single queries afterward. No result was fabricated;
  the one guessed UUID suffix returned zero rows and was replaced with the schema-verified ID.
- **L1 (no visual verification):** §7. No screenshots exist; static audit only.
- **L2 (no live pipeline runs):** sandbox outbound is allowlisted (no Shopify/Supabase-provider/prod API
  access); the connector is read-only SQL. Behavioral evidence = real code execution on fixtures +
  real persisted prod payloads — never live prompt→response runs against the test store.
- **L3 (auth boundary):** no merchant credentials sought or used; authenticated-surface review is
  static + persisted-data only.

## Appendix A — payload capture script (fixture-driven, labelled)

Saved during audit at `/tmp/capture_5f.py` (scratch, not committed); reproduces §5 payloads:

```python
import json, sys
sys.path.insert(0, "/home/user/Revluma/python")
import src.agents.investigation as investigation
from tests.test_rev_investigation import CONV, NOW, ORG, USER, workspace_db
from tests.test_rev_investigation_scenarios import comparison_revenue_db

def slim(result):
    ev = result.get("evidence") or {}
    items = ev.get("items") if isinstance(ev, dict) else ev
    claims = []
    for key in ("facts", "comparison_facts", "hypotheses", "claims"):
        for c in result.get(key) or []:
            claims.append({k: c.get(k) for k in
                ("classification", "status", "causal_status", "financial_impact")})
    return {"intent": (result.get("investigation") or {}).get("intent"),
            "text": result.get("text"), "claims": claims,
            "evidence": [{k: it.get(k) for k in
                ("id", "metric", "status", "quality_eligible")} for it in (items or [])],
            "recommendations": [{k: r.get(k) for k in ("action_state", "executed")}
                for r in (result.get("recommendations") or [])]}

for name, db, q in [
    ("A", comparison_revenue_db(), "Why did my revenue drop this month?"),
    ("D", workspace_db(), "Why are shoppers abandoning checkout?"),
    ("E", workspace_db(), "How much money am I losing from abandoned checkouts?")]:
    print("=====", name, slim(investigation.run_investigation(
        ORG, USER, q, db=db, now=NOW, persist=True, conversation_id=CONV))["intent"])
    print(json.dumps(slim(investigation.run_investigation(
        ORG, USER, q, db=db, now=NOW, persist=True, conversation_id=CONV)),
        default=str)[:4000])
```

## Appendix B — proposed visual-matrix spec (safe alternative to L1)

Authenticated Playwright run (user or CI, test-merchant session, preview deployment):
widths 1440/1280/1024/768/390 × states (empty history, streaming, failed+retry, evidence open,
finding-context, history drawer) = 30 captures; assertions: no horizontal overflow
(`document.scrollingElement.scrollWidth <= innerWidth`), focus ring visible on composer + first
button (screenshot diff or computed outline), state pills/severity chips ≥10.5px computed,
`?finding=` deep-link anchor visible. Secrets: test-merchant token via CI secret only, never in repo.

---
*End of initial audit. STOPPED before implementation per instruction. No code or records changed.*
