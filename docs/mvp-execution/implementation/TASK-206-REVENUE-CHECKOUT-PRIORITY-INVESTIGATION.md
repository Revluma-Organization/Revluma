# TASK 206 — Revenue, checkout and priority investigation (implementation report)

Date: 2026-11-07. Branch: `arena/765f4bee-revluma`. Baseline: `215f7d48` (main,
includes Tasks 197–204: evidence contracts, revenue/checkout/order/product/
finding/integration evidence, reporting periods, evidence quality, reasoning
epistemics). Consolidates original Tasks 221 (revenue drop investigation),
222 (checkout abandonment investigation) and 223 (priority recommendation
question). Diagnosis: `diagnostics/TASK-206-REVENUE-CHECKOUT-PRIORITY-INVESTIGATION.md`.
Decision: REV-DEC-0018 (renumbered from 0016 -> 0017 -> 0018 as PRs #349-#351 merged in flight took 0016 and 0017).

The governing rule: **Rev answers these three question families from recorded
evidence only — comparisons, contributions and rankings are computed from the
recorded windows; causes, losses and priorities are never invented.** A
decline is stated as a change between two recorded windows; a product's role is
a contribution, not a cause; "what should I fix first" is a defensible ranking
of the recorded findings with every exclusion and freshness limit explicit.

## What was built

### 1. Finding prioritisation (`finding_prioritization.py`, new)

`rank_findings(items, now)` is a pure, deterministic, fail-closed prioritiser
(method version `finding-priority-v1`). Input: finding evidence items (Task 202
shape: lifecycle, recorded severity, current validity, supporting evidence,
dedupe key, measured order sample). Output: `ranked` (≤5: rank, finding_id,
title, type, severity + `severity_recorded`, freshness, lifecycle_status,
current_validity, measured_order_sample, duplicates, reasons), `excluded`
(each with a machine-readable reason), and `no_valid_findings` +
`no_valid_findings_reason` when nothing survives.

Ranking order: (1) open/acknowledged and currently valid
(`current_evidence_verified`); (2) recorded severity high > medium > low
(unrecorded severity sorts last among valid); (3) freshness
(fresh < aging < stale); (4) stable finding_id for determinism. Exclusions are
named, never silent: `historical` (lifecycle), `evidence_unverified`
(verified=false), `evidence_unavailable`, `stale_findings_require_reverification`
(open/acknowledged whose recorded current window ended >48h before now),
`no_currently_verified_findings`, `verified_no_open_findings`. Ties are surfaced
as an explicit `tie` note, never broken silently. There is no path that
invents a severity or a freshness state: both are read from the recorded item,
and the `severity_recorded` flag distinguishes recorded from absent.

Tests: `tests/test_rev_finding_prioritization.py` — **16 passed**.

### 2. Product contribution with comparison (`product_evidence.py`)

`retrieve_product_evidence` now accepts `compare` +
`comparison_start`/`comparison_end` (the resolved comparison window — the
single source of truth from `resolve_reporting_period`; retrieval never invents
its own period). With compare, it runs the same line-item retrieval over the
previous window and emits:

- `comparison.items`: per-product-line items extended with the previous-window
  recorded values (same evidence-item contract, previous period).
- `comparison.changes`: one entry per product line present in either window —
  `metric: product_recorded_value_change`, product name, currency, current,
  previous, delta, percent (1dp; `None` when previous == 0), direction, units,
  status, reason, definition, plus the current/previous evidence ids —
  sorted by |delta| descending, top 10.
- `comparison.overall_status` + scope/currency notes; explicit
  `comparison_start`/`comparison_end` must satisfy
  `end ≤ cs < ce < start` (ValueError otherwise) — overlapping or future
  comparison windows are refused.

`_line_items_for` fail-closes zero/NULL line values (a monetary-zero
`evidence_item` is a schema violation; the item is excluded with a warning, the
raw row still feeds comparison math). Zero previous count is a named state,
never a division error.

Tests: `tests/test_rev_product_comparison.py` — **11 passed** (window split,
top-10 ordering, percent/zero-previous, overlap refusal, dedupe-key
extension, fail-closed line values, regression of the 129 pre-existing
product/intelligence tests).

### 3. Value decomposition: volume vs order value (`revenue_evidence.py`)

`decompose_value_change(result)` (method `value-decomposition-v1`) takes a
completed revenue comparison and decomposes the recorded order-value change
into the two recorded drivers:

```
aov_prev        = prev_value / prev_count            (refused unless prev_count > 0)
count_effect    = (curr_count − prev_count) × aov_prev
value_effect    = value_change − count_effect         (residual, exact by construction)
driver          = no_change | mixed-offsetting | volume-driven | value-driven | equally-split
```

Each driver is a name earned from the recorded effects (thresholds on
|count_effect| vs |value_effect|; sign agreement), never a model judgement.
Per product line the same decomposition is emitted as two
`calculated_observation` claims (`order_count_effect_on_recorded_order_value`,
`order_value_effect_on_recorded_order_value`) whose effects sum exactly to the
recorded change, with the count inputs currency-less (counts carry no currency)
and the money effects carrying the line's currency. Unsupported states are
named: `order_count_change_missing`, `inputs_not_recorded`,
`previous_order_count_not_positive`.

Tests: `tests/test_rev_value_decomposition.py` — **10 passed**.

### 4. Routing: priority questions reach the findings, nothing else moves

- The FINDINGS intent pattern (first position) now recognises the **actionable**
  priority phrasings: explicit finding references (`finding`, `finding id`),
  fix-first questions (`fix first`, `what should I fix/do/investigate/tackle/
  address first|next`), `most important` **paired with a first/action word**
  (`"the most important issue I should look at first?"`), `matters most`,
  `which finding/issue/problem is most important/urgent/critical`, and the
  challenge phrasings (`more important than`, `more urgent/critical/pressing
  than`, `why is that … important/bigger/worse`, `rather than the`, `instead of
  the`, `what about the refund/checkout/… issues`).
- The general orientation phrasings remain OVERVIEW, exactly as the golden set
  requires: `where should I focus today?`, `where should I start with all this
  data?`, `what are my priorities this week?`, `what's the biggest problem in
  my shop?`, `what should I look at first?`, `what is the most important issue
  in my business right now?`. The one shared token set ("most important" /
  "look at first") is split by collocation: FINDINGS requires the first/action
  partner in the same question; bare `most important` stays OVERVIEW.
- `route_message` settles actionable priority questions deterministically
  (fast path + degraded-model fallback) even without the understanding model,
  because they explicitly request the store's recorded findings. Change nouns
  (`decline`, `drop`, `fell`, `falling`, `abandonment`, `worse`, `better`) were
  added to the business-noun pattern so "what caused most of the decline?"
  reaches the revenue tools without a model.
- `_products` (tools.py) forwards `compare`/`comparison_start`/`comparison_end`
  and exposes the comparison on the ToolResult, mirroring the revenue tool.
- Fix found while wiring scenario F: the checkout drill-down reference pattern
  `\bcheckout\s+(?:id\s+)?[#0-9a-f]` matched "checkout **a**bandonment" (a
  single hex-looking letter), silently switching aggregate abandonment
  questions into per-record drill-down mode. It now requires a real reference:
  `#name` or an 8+ character hex/numeric id.

Tests: `tests/test_rev_intent_routing.py` — **46 passed** (incl. the live
acceptance question "What is the most important issue I should look at first?"
→ findings; all golden-set overview phrasings → overview).

### 5. Investigation pipeline wiring (`investigation.py`)

- **Priority block** (`_priority_blocks`): for FINDINGS investigations the
  finding items are ranked with `rank_findings`; the result carries
  `priority` (method_version, no_valid_findings + reason, computed_at,
  ranked ≤5, excluded ≤5) and `priority_comparison` (matched: the referenced
  finding vs the current top, with `ranking_changed`; unmatched: the reference
  could not be resolved to a recorded finding). The merchant text gains
  "## What I would work on first" — the top finding with why-it-matters,
  evidence, why-it-ranks-ahead, not-established and next-step (read-only) —
  ranked 2–4, the tie note, "Not ranked: … (excluded as …)", and a fail-closed
  sentence per `no_valid_findings` reason (including
  `evidence_unavailable`). The challenge question gets
  "## Why that, versus the one you asked about" comparing the two actual
  findings on the documented ranking slots.
- **Priority change** (scenario L): the bounded context persists
  `last_priority` (ranked ≤5, excluded ≤5, top_finding_id/top_title, method
  version, computed_at). On the next findings investigation, whenever the
  current top differs from the recorded top, `priority_change` is emitted
  (finding_id, title, reason ∈ {excluded_reason, re-ranked_lower,
  no_longer_in_recorded_set}, statement) and rendered as "## How this differs
  from what I told you before" — so an invalidated or re-ranked top is never
  silently presented as if nothing had changed.
- **Contribution + decomposition blocks**: for revenue/product/checkout
  investigations with a resolved comparison window, `contributor_analysis`
  carries the top product-line changes plus the volume/value decomposition
  entries, and the text gains "## Which recorded products moved the most" +
  "## Volume versus order value" (other intents) or the contribution framing
  (findings intent).
- **Claims**: new `build_contribution_claim` (epistemics.py) grades the
  contribution entries as `calculated_observation` with complete, re-computable
  calculation blocks; currency integrity (≤1 recorded currency across the
  inputs); limitations from the cited evidence. The priority recommendation is
  a `verified_fact` anchored to the finding's supporting-evidence value
  (skipped when absent — never asserted without a number).
- **Persistence**: `last_priority` joins `last_claims`/`order_query`/
  `checkout_query` in the bounded context (write- and read-time filtering via
  `_bounded_priority_record` / `_priority_from_window`).
- **Latent defects fixed on the Task 206 path** (found while wiring the
  scenarios): the checkout reference regex (above) and the finding-evidence
  window fallback — a recorded period with `previousStart ≥ currentEnd` built
  a zero-length `period(detected, detected)` and raised ValueError, taking the
  whole findings tool down on the priority path; it now degrades to a minimal
  one-second window ending at the detection time plus the already-declared
  `finding_measurement_period_invalid` warning (regression test in
  `test_task_202_evidence.py`).

### 6. Node boundary + persistence (`mlService.js`, `revController.js`)

Four new fail-closed validators in `validateInvestigationResponse` (all
evidence ids — `evidence.items` + `evidence.comparison_items` — must resolve):

- `validatePriorityBlock`: method_version `finding-priority-v1`;
  `no_valid_findings` bool; reason in the closed set when set; ranked
  rank == index+1 with the documented fields; `tie` = {finding_ids, statement}
  or null; excluded entries carry a reason; `computed_at` string.
- `validatePriorityComparisonBlock`: matched bool; statement non-empty; when
  matched the referenced object + `ranking_changed` bool are required.
- `validatePriorityChangeBlock`: finding_id string, title string|null, reason
  non-empty, statement non-empty.
- `validateContributorAnalysis`: array (≤8 after persistence) of
  {method_version `value-decomposition-v1`, status available|unsupported —
  unsupported needs a reason; available needs the eight recorded fields
  (prev/curr count+value, value_change, aov_prev, order_count_effect,
  order_value_effect) + driver in the closed set}; every cited evidence id
  must exist in the response evidence set.

`_boundedResultForPersistence` now carries `priority`, `priority_comparison`,
`priority_change` (objects → null when absent) and `contributor_analysis`
(slice 0..8) into both the SSE `final` payload and the persisted content, so
streamed and stored answers agree.

## Integration with Tasks 205/207 (merged to main after this task's baseline)

While this task was in flight, PR #349 (Task 205 — claim guardrails), PR
#350 (Task 207 — investigation outcomes) and PR #351 (Task 208 — intelligence
specialists) merged to `main`, and this branch was rebased onto `8b5477c` and
then `55b25cf`. The Task 208 rebase re-applied with only the expected
`last_specialists`/`last_priority` context-window unions (both persistence
blocks coexist in the bounded conversation record). Two contract interactions
with Tasks 205/207 had to be resolved (recorded in REV-DEC-0018):

1. **Claim guardrails vs derived claims (Task 205 × Task 206).**
   `validate_response_guardrails` requires each cited evidence item to match
   the claim's metric and window. Task 206's contribution/decomposition
   claims are the first claims whose *derived* metric name
   (`order_count_effect_on_recorded_order_value`, …) and comparison period
   legitimately differ from their inputs' metric/window — so every such
   response was rejected as `material_claim_irrelevant_or_ineligible_evidence`
   (44 test failures across 9 suites on the first integration run). Fix:
   `claim_guardrails.py::_references_allowed`/`_relevant` (and the Node
   mirror `revClaimGuardrails.js::relevant`) now treat an item as a
   legitimate reference when it is a **declared calculation input** of a
   `calculated_observation` claim carrying a non-empty `calculation.method`.
   This is the same reference channel as Task 205's own `current`-role
   escape, extended to previous windows and non-value inputs. Fail-closed is
   preserved on both sides: `quality_eligible`/status/currency checks are
   unchanged, and the epistemic contract (enforced earlier in
   `_build_claims`) already requires the claim's value to be re-derivable
   from the declared inputs within rounding — a calculation cannot cite
   arbitrary evidence.
2. **Capability gate vs supported priority/orientation intents (Task 207 ×
   Task 206).** `capability_decision`'s general-knowledge heuristic
   ("starts with what/who/where/when, no commerce noun, no conversation
   context") preempted "What should I fix first?" — the live-acceptance
   priority question, routed to `finding_investigation`, contains no commerce
   noun — and three scenario tests (G, J ×2) regressed to
   `unsupported_question`. Fix: `capability_decision(message, *,
   has_conversation_context, intent=None)` receives the classifier's routing
   decision from `run_investigation` and suppresses **only that heuristic
   branch** when the intent is one of the supported evidence-backed intents
   (`_SUPPORTED_INVESTIGATION_INTENTS`: the nine `*_investigation` /
   `store_overview` / `data_coverage` intents). Explicit out-of-domain
   phrases (`_OUT_OF_DOMAIN`), capability rules (forecast/causation/
   guarantee/purchase-intent/external integrations) and the ambiguity check
   still apply to every intent, and Task 207's own gate tests (whose prompts
   classify as `general`) still reject.
3. **Pre-existing collection break (fixed along the way).**
   `tests/test_task_205_guardrails.py` imported
   `from python.tests.test_rev_investigation import …`, which is
   unresolvable under the CI invocation (`working-directory: python`) — the
   whole Task 205 guardrail suite silently failed to collect. Changed to
   `from tests.test_rev_investigation import …`; the suite (now part of the
   1917-passed total) passes unchanged.

The priority claim also takes the cited finding item's own metric
(`target.get("metric")`, default `finding_evidence`) instead of a bespoke
`priority_recommendation` token, matching the verified-fact contract that a
fact claim carries its cited item's metric/value/currency.

## Out of scope (explicit)

- **Live-store end-to-end acceptance** (a real merchant conversation against
  the production store) remains the human runbook step, as in Tasks 201/203/204.
- **Finding generation** (detection of new findings from raw evidence) is not
  this task — the finding rows arrive from the Task 202 retrieval contract;
  this task ranks and presents them.
