# Task 205 — causal, action, recoverable-revenue and source-reference guardrails

Status: **implemented locally; CI, deployment and authenticated production conversation verification are separate gates.** Consolidates original Tasks **217–220**. This is not Task 206 and does not add execution capability.

## Authority model

Rev is a read-only advisor. Generated prose, a model confidence score, a citation, a recommendation, and a merchant statement are not execution or attribution authority.

### Causal states

Material structured claims use `causal_status`:

- `observed`: a directly recorded value with eligible evidence;
- `observed_difference`: a calculation over identified current and previous evidence;
- `deterministic_relationship`: an arithmetic relationship, not an operational cause;
- `statistical_association`: an association only;
- `hypothesis`: a possible contributor, explicitly unverified;
- `verified_causal`: permitted only with an eligible, independently verified causal methodology;
- `unknown`: no supported cause.

`verified_causal` requires an allowlisted design (`randomized_controlled_trial`, `difference_in_differences`, `instrumental_variable`, or `regression_discontinuity`), methodology version, inputs, coverage, assumptions, limitations, `eligible=true`, and `independently_verified=true`. Before/after comparisons, sequence, plausibility, and citations do not qualify. No current Rev producer emits verified-causal claims.

### Action states

The lifecycle vocabulary is `recommended`, `presented_to_merchant`, `merchant_confirmed`, `independently_verified`, `execution_requested`, `executing`, `executed`, `execution_failed`, `dismissed`, and `superseded`. Generated recommendations are always initialized as:

- `action_state=recommended`, `executed=false`, `execution_status=not_requested`;
- no execution actor, timestamp, or outcome;
- `merchant_confirmation=not_confirmed`;
- `independent_verification=unverified`, with no verifier or verification timestamp.

Later lifecycle names describe the contract, not permission for a generated response to enter those states. Python and Node reject generated responses claiming any later state. Merchant confirmation is not independent verification and neither is execution. Findings use the same non-execution defaults. Existing read-only request rejection remains unchanged; `execute:true` is still unauthorized.

### Financial impact

Recorded revenue, refunds, discounts, checkout values, and observed differences remain observations. `estimated_opportunity`, `recoverable`, and `verified_recovered` require a typed `financial_impact` record with methodology ID/version, inputs, coverage, assumptions, limitations, eligibility, and independent attribution verification. Existing recorded observations do not have this authority and cannot be relabeled as lost, saved, preventable, guaranteed, or recovered revenue. Currency, period, provenance, and measurement semantics remain mandatory under Tasks 197/198/203. Mixed-currency aggregation remains rejected by the existing currency controls.

## Enforcement boundaries

- `python/src/intelligence/claim_guardrails.py` is the deterministic Python policy. It checks causal/action/financial prose, structured causal states, evidence availability and quality eligibility, claim/evidence metric relevance, period and currency matching, action states, financial-impact records, and numeric source citations.
- `python/src/agents/investigation.py` initializes action states and validates before persistence or evidence/final emission. Model narratives are checked before use; deterministic output is checked again at the response boundary. Direct action/recovery follow-ups explicitly distinguish merchant reports from independent verification.
- `Backend/src/services/revClaimGuardrails.js` independently mirrors enforcement. Python output is not trusted merely because Python accepted it.
- `Backend/src/services/mlService.js` applies the guard to both JSON and streamed final responses after tenant/store and evidence-contract validation.
- `Backend/src/services/intelligenceFindingsEngine.js` rejects unsafe finding language and emits non-executed action metadata.
- `Backend/src/controller/revController.js` suppresses unsafe previously persisted Rev prose on history reads. New unsafe responses are rejected before normal persistence.
- Existing frontend citation rendering still drops unresolved citations; server-side validation now also rejects numeric references that do not resolve to a returned source reference.

Partial evidence can support only a claim itself marked partial. It cannot support an available/verified claim. Hypotheses may cite eligible background evidence but remain hypotheses. Current/previous comparison claims can cite their explicitly identified current item even though its period differs from the comparison's previous-period label.

A pre-existing attribution defect was fixed: identical current and previous facts are no longer deduplicated together. Fact deduplication now includes period start/end and currency.

## Adversarial coverage

`python/tests/test_task_205_guardrails.py` and `Backend/src/services/__tests__/revClaimGuardrails.test.js` cover the 12 requested scenario classes:

1. observation without causal inference;
2. comparison without causal inference;
3. association versus verified cause;
4. low-inventory/revenue causal assertion;
5. temporal sequence presented as cause;
6. causal assertion carrying a citation;
7. unsupported lost/preventable/stockout revenue;
8. recoverable/guaranteed/saved/recovered revenue;
9. generated execution, actor, timestamp, or outcome;
10. merchant-reported action versus independent verification;
11. missing, forged, irrelevant, stale/ineligible, wrong-period, or wrong-currency evidence;
12. follow-up, persistence/history, source-reference, and read-only behavior.

Existing Task 197/203 contract tests continue to cover tenant/store isolation, mixed currencies, malformed evidence, and citation ownership. Existing upstream stream tests prove invalid and executed-action final payloads are rejected. No production finding fixtures or merchant data were created.

## Verification ledger

Local, isolated tests on 2026-11-07:

- Python full suite after rebasing onto Task 204: **1,827 passed, 11 skipped** with the repository dependencies and a non-connecting test DSN.
- Backend runner after rebasing onto Task 204: **85 test files passed** using the ignored mock-only Prisma stand-in.
- Task 204's canonical `claims` are covered in addition to legacy facts/hypotheses. Unknown and restatement semantics are preserved; asserted canonical financial impact fails without Task 205 attribution authority.
- Focused real conversation-path tests use the existing isolated workspace fixture; they are not production evidence.

Required subsequent gates, to be filled only from observed results:

- GitHub CI, including real Prisma/PostgreSQL checks: pending at time of writing.
- Merge commit: pending.
- Node and Python production revision identity: pending.
- Authenticated production JSON/SSE conversations on `revluma-test-store-v1.myshopify.com`: pending; no merchant session is available in this environment.

Health checks, test fixtures, SQL, a merge, or a deployment trigger must not be reported as authenticated production Rev acceptance.
