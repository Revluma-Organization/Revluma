# TASK 204 — Reasoning epistemics and numeric integrity (implementation report)

Date: 2026-11-07. Branch: `arena/c34b1912-revluma`. Baseline: `ff0b8d71` (main,
includes Tasks 197–203 and the Task 202 follow-up, PR #345). Consolidates
original Tasks 212 (label verified facts),
213 (label calculated findings), 214 (label hypotheses), 215 (label unknowns)
and 216 (prevent fabricated numeric claims).

Numbering note: the pre-existing backlog line "TASK 204 — Verify relative date
interpretation" had already been delivered by Task 198 (merchant-calendar
reporting periods, REV-DEC-0012) but was never checked off. The user-assigned
number for this consolidation task is the same 204; the backlog now carries
both lines with an explicit cross-reference.

The governing rule: **a number in a merchant-facing answer must be a recorded
claim with an epistemic grade, and the grade must be earnable from the
evidence — never a label the model decides to print.** This task productionizes
that rule on top of the Task 197/203 evidence-and-quality contracts: it adds
the `rev-claim-v1` claim contract (Python keystone + validated Node mirror),
records every numeric statement the investigation makes, grades each
statement, exposes the rollup to both boundaries, refuses fabrication at
runtime, answers "where did that figure come from?" from the recorded
provenance, and supports merchant corrections that invalidate the memory.

## What was built

### 1. The `rev-claim-v1` claim contract

`python/src/intelligence/epistemics.py` (Python, keystone) and
`Backend/src/services/revEpistemics.js` (Node mirror; parity enforced by a
Python-generated golden fixture `revEpistemics.golden.json` regenerated via
`python/scripts/gen_epistemic_golden.py`).

Every claim is a typed statement with exactly one of four epistemic
classifications, reusing the `CLAIM_GRADES` the evidence contract already
defines — the same four words the merchant hears in plain language:

| Grade | Meaning | How it is earned |
|---|---|---|
| `verified_fact` | recorded by a source | cites only available evidence items; money/count/percent fields carry the item's own value and currency |
| `calculated_observation` | derived from recorded values | cites only available items AND lists `calculation_inputs` (subset of cited items); money values must be re-derivable from the inputs within rounding; percentage values carry their denominator |
| `hypothesis` | a candidate explanation | must carry `candidate_causes` or `alternative_explanations`; **must not carry a numeric value** (a hypothesis with a value is a defect, not a grade); no impact field |
| `unknown` | cannot be answered | no value, no impact; carries an explicit `limitation` |

Claim shape (all fields validated; unknown fields rejected — fail-closed):

```
claim_id, metric (stable snake_case token), classification,
value + value_type (money/percent/count/integer/text), currency (money only),
evidence (list of cited item ids), period {start,end,comparison_window, label},
impact {kind, amount, currency} (optional),
calculation_inputs {formula, input_values} (calculated only),
candidate_causes / alternative_explanations (hypothesis only),
limitation (unknown only), note (optional, ≤ 240 chars),
restated (bool), source_investigation {id, claimed_at} (restated only)
```

Validation (`validate_claim`) returns stable, machine-readable error codes
(e.g. `unknown_evidence_cited`, `calculated_observation_missing_inputs`,
`hypothesis_cannot_carry_value`, `false_precision_on_money`,
`asserted_impact_without_method`, `restated_claim_missing_source`) — never a
silent accept, never an exception.

Key invariants (each asserted in tests):

- **False precision is a validation error**, not a rounding courtesy: money
  values beyond 2 decimal places and percentages beyond 1 fail.
- **An asserted impact requires a method**: only `calculated_observation`
  claims may carry `impact`, and only kinds in the asserted-impact set
  (`recoverable`, `lost`, `at_risk`) without a calculation are rejected.
  `observed`/`potential` impacts ride on recorded values.
- **Restated claims are the only claims that skip re-derivation**: a
  `restated: true` claim (used by provenance and corrections) carries
  `source_investigation` and is validated for shape only — its value was
  earned by the investigation that recorded it, and re-validating it against
  *current* evidence would manufacture new "unknown evidence" failures.
- **Tenants**: a claim citing an evidence item from another organization or
  another store is rejected at the boundary (`claim_cites_foreign_evidence`
  style codes), matching the Task 197 tenant rules.

Set level (`validateClaims`): an all-or-nothing array — any invalid claim
fails the set, with every offending code reported.

Rollup (`epistemicRollup`): per-grade `counts`, `total`, and `metrics`
mapping each metric to the grades observed for it (a metric appearing under
two grades is visible, never silently merged).

### 2. Investigation records claims (the numeric-integrity engine)

`python/src/agents/investigation.py` — every place the investigation states a
number now goes through one of the claim builders in `epistemics.py`:

- Recorded evidence items → `verified_fact` claims (count, money, percent)
  with the item's own value/currency; comparison-window items become claims
  with `period.comparison_window` set (no separate comparison claim class).
- Computed deltas/changes → `calculated_observation` claims with explicit
  `calculation_inputs` (formula + input values); percentage changes carry the
  denominator basis.
- Candidate explanations → `hypothesis` claims built from the structured
  `candidate_causes` the investigation already computed — never from free
  prose, and never carrying a number.
- Every "I cannot tell you X because Y" → `unknown` claim with the explicit
  limitation (e.g. "refund ledger is only partially certified").

The result gains two additive blocks (existing `facts` / `hypotheses` /
`unknowns` surfaces are unchanged — nothing existing is broken):

```
result["claims"]    # list of rev-claim-v1 objects, ≤ 10 recorded
result["epistemics"]# {contract_version, valid, validation_errors[], rollup}
```

The `epistemics` block is computed by the **same** `validateClaim`/
`epistemicRollup` the Node boundary uses (imported from the Python module in
tests; the Node boundary re-runs it server-side), so a claim that is valid in
Python is valid in Node by construction — the golden fixture locks the
byte-level agreement.

**Fabrication refusal at runtime**: a claim that fails validation is never
emitted. The investigation validates before recording; if the evidence cannot
support a number (tool failure, incomplete coverage, missing ledger), the
number is replaced by an `unknown` claim plus a visible warning — e.g. when
the revenue tool fails, no `recorded_order_value` claim exists and the answer
says "Order records could not be read for this window" (scenario S11). The
merchant copy is cross-checked in tests: every figure in the answer text must
correspond to a recorded claim of the right grade (
`assert_claims_consistent_with_text`).

### 3. Provenance: "where did that figure come from?"

A follow-up that references a previously stated figure (e.g. "Why did you say
I made $30.31?" / "Where did that 7 come from?") is routed to a provenance
branch that answers **from the recorded claims only**:

- it looks up the metric/value in `last_claims` (bounded, ≤ 10, tenant-
  filtered — claims from another organization are never presented);
- it restates the claim as a `restated` claim (grade preserved verbatim — "It
  is recorded as a verified fact, and I do not upgrade that here");
- it reports the source (which tool, which window) with a human-readable
  retrieval time (`07 Nov 2026, 11:45 UTC` — raw ISO timestamps never appear
  in merchant text);
- it refuses to re-estimate: the answer ends with "That is the complete
  provenance I recorded; I have not re-estimated or adjusted the figure."

The branch runs **before** the chat-intent early-returns, so a provenance
follow-up can never be swallowed by the conversational router; it falls
through to normal handling when there are no recorded claims to answer from.

### 4. Corrections: the merchant says "that's wrong"

A correction follow-up ("that's wrong — I only made $20") produces:

```
result["corrections"] = {
  superseded: {claim_id, superseded: true, ...original claim...},
  correction: {corrects_claim_id, classification: "unknown",
               value: null, limitation: "Merchant states the figure is
               wrong; the recorded value is invalidated pending re-verification."}
}
```

- the original claim id is preserved on both sides (the pair is verifiable
  across the boundary — the Node validation rejects mismatched pairs);
- the correction is recorded as `unknown`, **never** re-graded to a fact from
  the merchant's assertion (a merchant statement is not a source);
- the merchant memory (`merchant_memories`) is invalidated in the same step —
  the recorded figure can no longer seed future follow-ups;
- the answer text must contain the retraction language ("retract" /
  "superseded") and the commitment "will not repeat it as established".

### 5. Persistence and the follow-up record

`persist_investigation_context` now records, alongside the existing bounded
context:

- `context_window["last_claims"]` — the recorded claims, ≤ 10, well-formed
  `rev-claim-v1` objects only (non-objects and wrong-version objects are
  filtered at write **and** read — defense in depth);
- `last_investigation["checkout_query"]` — the allowlisted checkout
  drill-down (`abandoned_only`, `include_records`, reference, latest) so a
  follow-up ("what about those?") inherits the abandoned-only scope instead
  of silently re-querying everything (scenario S12: first turn "Show me the
  abandoned checkouts from last week" → `checkout_query {abandoned_only:
  true, include_records: true}`; follow-up inherits it; `context_used.
  followup: true`).

The Node side carries both through the existing passthrough
(`revController._boundedResultForPersistence` now persists `claims` (≤ 10),
`epistemics` and `corrections` into `conversation_messages.content` — the
same path the SSE `final` payload uses, so the streamed and the stored
answers agree).

### 6. Node boundary: fail-closed validation

`Backend/src/services/mlService.js` — `validateInvestigationResponse` now
validates, after the existing evidence/unknowns/recommendations checks:

- `claims`: must be an array; every claim passes the mirror
  `validateClaim` against the investigation's own evidence items (items +
  comparison_items by id, tenant- and store-scoped); **any** error fails the
  whole response (400) — a fabricated or unearned number cannot be persisted
  or returned;
- `epistemics`: must be a plain object with `contract_version ===
  "rev-claim-v1"`, a boolean `valid`, a `validation_errors` array, and the
  invariant `valid === (validation_errors.length === 0)`; `rollup` and
  `rollup.counts` must be plain objects;
- `corrections`: must be a plain object whose `superseded.superseded ===
  true` and whose `correction.corrects_claim_id === superseded.claim_id`.

## Scenarios (all passing as tests, `python/tests/test_rev_epistemic_pipeline.py`)

| # | Scenario | Verified behaviour |
|---|---|---|
| S1 | "What is my order count this week?" | count claim `verified_fact`; epistemics valid |
| S4 | checkout investigation | `abandoned_checkout_recorded_value 220.00 USD` with `impact.kind = potential` (the only recorded value that gets an impact); 6 flat 0.0% comparison claims across NGN/USD never merged; status `partial`; hypothesis carried as `candidate_causes`, not as a number |
| S6 | refunds on incomplete ledger | refund claims `0.00` verified only where certified; unknown "refund ledger is only partially certified…"; no "leakage" wording, no fabricated refund total |
| S7 | products with a failing tool | product claims recorded; "## Data I could not read" present; failed tool becomes warnings, not numbers |
| S8 | "Where did that figure come from?" | provenance branch: restated claim, grade stated ("recorded as a verified fact, and I do not upgrade that here"), source + human retrieval time, explicit no-re-estimation; raw ISO timestamps absent from merchant text |
| S9 | "That's wrong" correction | `corrections` pair (id preserved), retraction language, memory `is_active = false` |
| S10/S11 | revenue tool failure | no `recorded_order_value` claim exists; warnings "Order records could not be read for this window", `order_pagination_or_sync_incomplete` |
| S12 | checkout drill-down follow-up | `checkout_query {abandoned_only, include_records}` persisted in `last_investigation`; follow-up inherits it; `context_used.followup: true` |
| T | foreign-tenant recorded claims | claims recorded by another organization are never presented in provenance or corrections (tenant filter asserted) |
| B | boundary shape | the `epistemics` block is stable across the Python→JSON→Node round trip (contract version, rollup, invariants) |

Plus 51 contract unit tests (`tests/test_rev_epistemics.py`): every
validation error code, rounding rules, restated-claim semantics, tenant
isolation, rollup, `can_promote` (a restated or corrected claim cannot be
promoted to a stronger grade) and `correct_claim` pair construction.

## Files

| File | Change |
|---|---|
| `python/src/intelligence/epistemics.py` | NEW — `rev-claim-v1` contract, builders, `validate_claim`/`validate_claims`, `epistemic_rollup`, `can_promote`, `correct_claim`, `claim_reference`, `build_calculation_claim` |
| `python/src/agents/investigation.py` | claim recording at every numeric statement; `result["claims"]` + `result["epistemics"]`; provenance branch (before chat early-returns); correction branch; `last_claims` + `checkout_query` persistence; tenant filters; `_when_text()` human timestamps |
| `python/tests/test_rev_epistemics.py` | NEW — 51 contract unit tests |
| `python/tests/test_rev_epistemic_pipeline.py` | NEW — 15 scenario/tenant/boundary tests (S1–S12 + T + B) |
| `python/scripts/gen_epistemic_golden.py` | NEW — deterministic golden generator (pinned ids and `computed_at`) emitting `revEpistemics.golden.json` |
| `python/tests/test_merchant_memory_persist.py` | `checkout_query` added to the bounded memory key-set (same allowlisted-drill-down class as `order_query`); 2 new tests (claims capped at 10 + well-formed-only; non-claims never persisted) |
| `Backend/src/services/revEpistemics.js` | NEW — Node mirror: `CLAIM_CONTRACT_VERSION`, `CLAIM_GRADES`, `normalizeCurrency`, `toNumber`, `validateClaim` (sorted error codes, fail-closed), `validateClaims`, `epistemicRollup`; raw-string currency/percent regexes (no `Number()` normalization — parity subtlety) |
| `Backend/src/services/__tests__/revEpistemics.golden.json` | NEW — 46 generated cases + set case + rollup cases |
| `Backend/src/services/__tests__/revEpistemics.test.js` | NEW — 53 tests: golden contract, per-case Python/Node parity, set-level, rollup parity, boundary extras |
| `Backend/src/services/__tests__/revInvestigation.contract.test.js` | +12 boundary tests (19 total): valid fact+epistemics accepted; each fabrication class rejected (unknown-evidence cite, verified hypothesis, unknown-with-value, false precision, zero denominator, asserted-impact-without-method, cross-tenant, cross-store); restated ok / missing source rejected; epistemics invariant + wrong contract version rejected; corrections mismatch rejected / consistent accepted |
| `Backend/src/services/mlService.js` | `validateInvestigationResponse` validates `claims` (per-claim against cited evidence, all-or-nothing), `epistemics` (version + `valid` invariant + rollup shape) and `corrections` (pair consistency) |
| `Backend/src/controller/revController.js` | `_boundedResultForPersistence` carries `claims` (≤ 10), `epistemics`, `corrections` (SSE `final` + persisted content) |

## Local evidence

- Focused Python (epistemics + pipeline + investigation + persist): **114 passed**.
- Full Python suite with CI-equivalent env: **1788 passed, 7 skipped**; the
  only errors are the 3 real-PostgreSQL integration tests that require the CI
  `postgres:16` service (no local server in the sandbox) — covered by CI.
- Node focused: `revEpistemics.test.js` **53/53**, `revInvestigation.contract.
  test.js` **19/19** (72 combined). Full Node suite: 75 files pass; the 8
  failing files are the pre-existing prisma-engine-download environment
  failures (network-blocked locally, run in CI) — one more passing file than
  baseline (the new parity file).
- Golden parity: `gen_epistemic_golden.py` regenerated
  `revEpistemics.golden.json` cleanly; all 46 cases agree Python ↔ Node.

## Outstanding

- CI (both workflows) + merge + Vercel/Render deployment verification.
- Authenticated end-to-end production acceptance (a real merchant provenance
  and correction conversation) — human runbook step.
