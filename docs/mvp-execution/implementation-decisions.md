# Implementation decisions

These decisions were made during authorized Task 010 documentation work; they are not invented historical product decisions. Consult and revalidate before proposing conflicting changes.

## REV-DEC-0001 — Preserve evidence before implementation

- Date: 2026-10-29 (client Africa/Lagos date).
- Task: 010.
- Problem: Diagnoses can disappear between builder sessions.
- Options: Conversation-only history; repository execution records.
- Selected: docs/mvp-execution with per-task reports, central register, stable findings and decisions.
- Justification: Task 010 explicitly authorizes and requires this system.
- Impact: Subsequent tasks reuse diagnosed evidence and avoid redundant rewrites.
- Constraints: Only this directory changes during Task 010; no application fixes or production actions.
- Affected: README.md, audit-register.md, diagnostics/TASK-010.md and imported reports.
- Verification: Documentation-only diff, valid relative links, source-backed reports, actual test results.
- Status: IMPLEMENTED — documentation; no product behavior changed.

## REV-DEC-0002 — Preserve partial and unavailable prior evidence

- Date: 2026-10-29; task 010.
- Problem: Prior task prompts are available, but not every execution report is retrievable.
- Options: Reconstruct prior reports; mark missing evidence and preserve recovered reports.
- Selected: Import Tasks 008/009 unchanged, keep original PARTIAL status, mark 001–007 REPORT UNAVAILABLE — PRIOR EXECUTION NOT VERIFIED.
- Justification: Explicit task restriction against fabricated reports and repeated investigations.
- Impact: Audit status remains honest without erasing earlier claimed work.
- Constraints: A recovered report is historical evidence, not fresh runtime certification.
- Affected: diagnostics/TASK-008.md, TASK-009.md, audit-register.md.
- Verification: Imported file hashes equal source artifacts; unavailable report paths are not fabricated.
- Status: IMPLEMENTED.

## REV-DEC-0003 — Separate helper tests from persisted reconciliation

- Date: 2026-10-29; task 010.
- Problem: Inactivity helpers and webhook-subscription reconciliation can be mistaken for purchase-matching proof.
- Options: Treat names as coverage; inspect assertions and map exact production functions.
- Selected: Record pure/mock/static tests separately; mark persisted matching, event sequence and real database invariants uncovered.
- Justification: Selected tests do not call upsertOrder/upsertAbandonedCart or the promotion job to verify business rows.
- Impact: Future Tasks 016–050 can address specific gaps without overstating existing verification.
- Constraints: No new tests/fixes/config changes in this audit; mocks cannot prove unique/FK/transaction behavior.
- Affected: diagnostics/TASK-010.md and REV-FIND entries.
- Verification: 44 selected Node runner entries pass; two Python source-check functions pass; explicit coverage matrix and execution limitations.
- Status: IMPLEMENTED — audit classification only.

## REV-DEC-0004 — Publish documentation on GitHub main and import recovered reports

- Date: 2026-10-30; related task: Task010 follow-up.
- Problem: Local-only history is unavailable to the team and future GitHub-based builders.
- Options: Keep local-only commit; publish authorized docs to main.
- Selected: Publish docs/mvp-execution/ to the live GitHub main branch, explicitly requested by the user; this supersedes the previous publication hold.
- Justification: User instruction: save inside the main live repo in GitHub and separate the supplied earlier reports.
- Impact: Repository-visible execution history with separate recovered Task002–007 records and original Task008–010 reports.
- Constraints: Task001 report is absent from the supplied export; do not fabricate it. Only docs/mvp-execution/ may change. No manual deployment or application modification.
- Affected: diagnostics/TASK-002.md through TASK-007.md, README, audit register, Task010 dated follow-up.
- Verification: Source/export boundaries, local link/secret/diff review, documentation-only GitHub commit and read-back from main.
- Status: ACCEPTED — main publication explicitly authorized; commit history records completion.


## REV-DEC-0005 — Use existing FK with conditional persistence for Task 024

- Date: 2026-10-30; task 024.
- Problem: Current coupon fallback and arbitrary findFirst can persist unsupported or reassigned checkout relationships.
- Alternatives: new relationship table; unique checkout FK migration; unconditional FK update; existing FK plus atomic conditional update.
- Selected: reuse orders.abandoned_cart_id with same-store unambiguous identifier lookup and atomic compare-and-set, rejecting reassignment.
- Rationale: smallest safe persistence change; preserves schema and existing data, prevents weak coupon-only relationship writes and concurrent FK overwrite.
- Consequences: no migration; conflicting and missing identifiers remain unresolved (Tasks 025–028); no automatic historical repair; lifecycle and campaign attribution not changed by persistence (Tasks 029, 046–047).
- Related findings: REV-FIND-023-01, REV-FIND-023-02, REV-FIND-023-05, REV-FIND-017-01/02.
- Code commits: f5f8abd643c664747529f9ae59f468bf871bfbd2, 30758e40b26e393c66bf9a25a7296c9eec8d3e36.
- Verification: 26/26 isolated PostgreSQL integration tests PASS (run 40988004734, job 123843440071); backend tests and refresh regression SUCCESS; no production claim.


## REV-DEC-0006 — Task 025 durable unresolved order reconciliation
- Date: 2026-10-30; task 025.
- Problem: Orders with no verified checkout had nullable FK but no durable reason/history.
- Options: logs-only, generic events JSON, new dedicated ledger.
- Selected: one dedicated order_checkout_reconciliation_cases row per (store_id,order_id), reason/status and bounded source identifier, additive migration.
- Rationale: concurrency-safe unique key, explicit state semantics, source traceability, merchant isolation via composite order FK.
- Resolution: only after same transaction persists verified orders.abandoned_cart_id; stale no-ID replay never reopens.
- Consequences: checkout-first reconciliation not invented; historical orders use existing upsertOrder; database migration must precede app release; no production deployment authorized.
- Related: REV-FIND-025-01, Tasks 024–028, 048–049.
- Implementation commits: f2f58f2, 188087b, 7ced05a, 92d3eb3, 23a1c67.
- Verification: 28/28 PASS on isolated PostgreSQL (run 40988985305, job 123846549587); SQL migration executed; backend tests and refresh regression SUCCESS; no production deployment.


## REV-DEC-0007 — Task 026 authoritative contradiction detection
- Date: 2026-10-30; Task 026.
- Context: Task025 IN query treated two independently matched strong identifiers as ambiguous and threw on existing-FK conflict before durable recording.
- Decision: Independently evaluate checkout_id and checkout_token (strong) and cart_token (weak); never allow cart token to override a unique strong identity. Two distinct strong checkout matches or proposed change to verified FK are CONFLICTING_IDENTIFIERS. Duplicate identities and shared weak cart tokens remain AMBIGUOUS_CANDIDATES.
- Alternatives: first-match-wins, treat all signals equal, throw on all discrepancies, new conflict table. Rejected for integrity/diagnostic reasons.
- Implementation: reuse Task024 CAS and Task025 ledger with preserveConflict, scoped by merchant and bounded lookups. No schema migration.
- Consequences: historical replays cannot silently reassign; conflicts with existing FK remain durably observable. Task028 required for full token provenance, Task027 for checkout claim exclusivity.
- Related findings: REV-FIND-017-01/02, REV-FIND-026-01.
- Source commit: 1d830e2fa383b603ad2b24b1cb9a53b30d1bc032.
- Verification: Task026 40/40 PASS run 40989659035 job 123848709961; inherited Task025 28/28 PASS run 40989659093 job 123848710278; backend tests and refresh regression SUCCESS. No production deployment.


## REV-DEC-0008 — Task 027 checkout ownership concurrency policy
- Date: 2026-10-30; Task 027; source commit eaecbae2358b54d533a38619e6ab90229232cdb0.
- Decision: one accepted physical order FK claim per checkout through upsertOrder; same authoritative store/order identity remains idempotent. Acquire PostgreSQL transaction-scoped advisory lock on checkout UUID before merchant-scoped owner lookup and FK compare-and-set. Reject competing physical claims with Task026 CONFLICTING_IDENTIFIERS and Task025 durable ledger; preserve both orders.
- Context: existing orders.abandoned_cart_id is nullable nonunique FK; competing workers can each see no owner. Real Shopify cardinality exceptions and historical data are not sufficiently verified for blanket database unique constraint.
- Alternatives: global unique FK index (deferred: unsupported assumptions and potential historical conflicts), read-before-write only (race), new claims table (scope expansion), destructive duplicate cleanup (prohibited).
- Consequences: participating writers serialize and reject incompatible claims; other writers bypassing advisory protocol are not protected; follow-up source/legacy cardinality evidence required before production readiness.
- Related: REV-FIND-027-01/02/03; Task024/025/026 and Task028/049.
- Verification: Task027 40/40 PASS run 40990349650; Task026 40/40 PASS run 40990349624; Task025 28/28 PASS run 40990349608; backend/refresh PASS. Production cardinality and legacy claim audit remain unverified; no DB uniqueness migration.


## REV-DEC-0009 — Task028 typed Shopify source identity preservation
- Date: 2026-10-30. Decision: add nullable typed checkout ID, checkout token and cart token fields on orders and abandoned_carts; do not infer or backfill ambiguous legacy external_cart_id. Matching must query merchant-scoped typed fields only.
- Context: Task027 live Shopify audit found 0 matching order checkout tokens in legacy checkout identity column and 5 duplicated external checkout identity groups. Existing generic field conflated source types.
- Update safety: reject incompatible non-null source identity updates transactionally, preserve sparse existing evidence; never coerce unsafe JS numeric values or malformed objects. Preserve raw strings for exact matching within restricted database; avoid token logs and customer PII.
- Historical: Shopify GraphQL order checkoutToken/cartToken and checkout GID passed to common ingestion. No full payload archive or unsupported source-event provenance fabrication.
- Alternatives: reuse generic external_cart_id (unsafe type conflation); blanket backfill (unverifiable); full source-event archive (outside MVP scope).
- Consequences: existing legacy rows with only external_cart_id cannot match via new typed lookup until authoritative source reprocessing. Event provenance and conflict snapshots need additional work; CI and full Task028 tests pending.
- Related: REV-FIND-018-01, REV-FIND-019-01, REV-FIND-027-01, REV-FIND-028-01/02/03/04; Tasks027,028,048,049. Implementation commits 0a1cc837, 7973218a, 914dd518.

## REV-DEC-0010 — Task029 verified completion precedence
2026-10-30. A verified merchant-scoped persisted order-to-checkout FK is authoritative completion evidence; set checkout status recovered and timestamp in the same transaction, only if not already recovered. Preserve attribution and historical abandoned_at. Checkout completed_at remains an independent authoritative source. Alternative nontransactional updates rejected for inconsistency risk. Task029; REV-FIND-029-01/02/03. Commit cc37eca819b2a695106ae696bbb1cc5792f30aaf. Validation pending.

## REV-DEC-0011 — Task030 checkout/order lock coordination
2026-10-30. Share existing Task027 checkout UUID advisory transaction lock across checkout upsert and order reconciliation. Checkout path retains its store/external lock and re-reads after obtaining checkout UUID lock. Preserve monotonic Shopify activity watermark and verified completion over receipt ordering. Alternatives rejected: read-then-write without common lock, new queue, schema migration, last-write-wins. Consequence: checkout transaction may wait on order transaction; verify concurrency and deadlock behavior in isolated PostgreSQL. Related: REV-FIND-030-01/02/03, Task030. Implementation 31856d7bbc30037177812be046ef147f54cb74fe; verification pending.

## 2026-11-06 — PR #321 inventory/fulfillment production completion

Inventory snapshots are acquired completely before bounded independent upserts begin. This intentionally trades a small amount of transient read/write separation for avoidance of Prisma interactive-transaction expiry; any persistence failure leaves the domain failed and a later complete retry heals partial writes. Stale deletion is permitted only after explicit outer and nested connection termination. Fulfillment and other order-enrichment ledgers represent the whole order batch, not the last order. No fulfillment line-item allocation is claimed without fulfillment-order acquisition. No database migration is needed. Location snapshots use Shopify 2026-10 `includeInactive:true, includeLegacy:true` because inventory levels may legitimately reference locations omitted by the default active-only query.

## REV-DEC-0012 — Task 198 merchant-calendar reporting periods and currency-honest revenue
2026-11-07. Reporting periods resolve on the merchant's IANA calendar (store settings > `store_profiles.iana_timezone` > UTC; conflicting stores → UTC + explicit warning), with DST-safe half-open `[start, end)` windows. "this week"/"last week" are ISO calendar weeks (Monday-start) in the merchant timezone; "last month"/"this month" are calendar months; explicit date ranges are local-midnight half-open windows. Comparison windows are the previous calendar unit for full calendar windows and the equal-length immediately-preceding period for rolling/partial windows. Revenue is retrieved and displayed per verified ISO currency; incompatible currencies are never summed (the refusal is explicit in Python revenue evidence, business state, and the Node revenue resource), and no display layer assumes USD. Consequences: (1) "this week" semantics change from a rolling 7×24h window to the local calendar week to now — comparison of the partial week uses the equal-length immediately-preceding period, and the prior full week remains available as "last week"; (2) multi-currency organizations lose scalar business-state revenue (replaced by per-currency evidence) — an intentional fail-closed trade; (3) a revenue zero is asserted as `"0.00"` in the verified currency only with complete certified coverage, otherwise the item is demoted, never a count zero. Alternatives rejected: fixed 7×24h/30×24h windows (DST drift, wrong merchant calendar), summing across currencies (fabricated totals), assuming a default currency (mislabelled money). Related: TASK 198; rev-evidence-v2 contract; REV-DEC-0009 (typed identity, same fail-closed philosophy).

## REV-DEC-0013 — Task 201 integration evidence: one canonical pipeline, state as values, merchant context unchanged
2026-11-07. Integration evidence is current-state evidence from five local tables (stores, store_sync_domain_states, webhook_registrations/deliveries, intelligence_order_coverage); no Shopify API call at retrieval. Decisions: (1) A resource capability is `operational` only with scope granted AND a successful fully-paginated sync within the domain freshness policy; `unsupported` (no dedicated ledger domain in this build) is a named limitation and is excluded from failure lists — never conflated with `failed`; (2) webhook health separates registration from observed flow — registered-but-silent is `unknown` ("a registered webhook does not prove events are flowing"), delivered-not-processed is `degraded`; (3) state items are always emitted as `available` facts with the state carried in the value (a bad state is a value, not a missing item) so status-filtered readers can never hide a failed/stale/unknown state; freshness is carried on capability items so a `running`/`synchronizing` domain is visible to readers; (4) token values are never selected (raw `access_token IS NOT NULL` probe), `error_details` and webhook secrets never appear, failures are counted not quoted; (5) overall health is a deterministic score (100 − 25·real critical − 5·never-synced critical − 10·stale − 5·optional − 15 webhook failed (10 silent) − 5 incomplete coverage; floor 70, cap 59 under real criticals) with `overall_status` authoritative and multi-store rollup to the worst store; (6) a store record with NO granted-scope list is a data gap, never an authorization gap: capability then rests entirely on observed synchronization behaviour (fresh successful sync -> operational/`effective_verified`; no sync evidence -> `unverified_unrecorded` with a visible health warning), because the live production store carries `granted_scopes = NULL` and treating that as every scope missing would falsely report a healthy, actively-syncing store as `unauthorized` — a recorded-but-incomplete scope list remains a real `missing_scope` gap; (7) the merchant context schema is NOT extended (`rev-merchant-context-v3` unchanged) — the Python `integration_health` tool is the single source of integration evidence in Rev's context, and the Node surface (`GET /evidence?resource_id=integration`) mirrors the same state machine, so two implementations but one contract; a second independently computed context surface was rejected as a drift hazard. Alternatives rejected: status=PARTIAL/UNAVAILABLE to encode store health (hid bad states from status-filtered readers); API call at retrieval (latency, token usage, failure coupling); `supported` alias for `unsupported` (two names for one limitation). Related: TASK 201; rev-evidence-v2 contract; REV-DEC-0012 (fail-closed philosophy).

## REV-DEC-0015 — Task 205 generation is not causal, action, recovery, or citation authority
2026-11-07. Extend the canonical evidence/quality contracts with deterministic causal, financial-impact, action-state, and claim-to-evidence relevance checks in both Python and Node. Generated recommendations always start `recommended`, unconfirmed, independently unverified, and `not_requested`; merchant reports never become execution or verification. Observed and comparison values cannot become recoverable or recovered revenue without an eligible versioned independent attribution methodology. Verified causation requires an allowlisted experimental/quasi-experimental design and independently verified methodology, never sequence or plausibility. Validate before Python persistence/emission and again at Node JSON/SSE egress; suppress unsafe historical prose. Alternatives rejected: prompt-only controls, citation-ID-existence-only checks, a parallel evidence system, autonomous execution, and treating merchant confirmation as verification. See `implementation/TASK-205-CAUSAL-ACTION-RECOVERY-CITATION-GUARDRAILS.md`.

## REV-DEC-0014 — Task 202 canonical finding/product retrieval and non-overlapping elapsed comparisons
2026-11-07. Reuse the existing evidence constructors, Rev tools and store-timezone resolver rather than adding parallel evidence or date services. Finding rows retain lifecycle and source evidence; current validity is separately evaluated, and bounded orders are related only through authorized finding/store measurement windows. Products, variants and location inventory remain separate identities; historical order lines and finding references cannot prove current availability or causation. Current partial calendar periods compare with the same elapsed local-calendar portion of the preceding unit, strictly before the current period; full calendar units compare with the prior unit and rolling windows with the prior equal-length window. Missing/invalid/conflicting merchant timezones use disclosed, unverified UTC. No schema migration is required. Alternatives rejected: count-only findings, name-only product aggregation, overlapping previous-period comparisons, silent UTC and inferred stock/causes.
## REV-DEC-0015 — Task 204 reasoning epistemics: one claim contract, four earned grades, fail-closed at the boundary
2026-11-07. A number in a merchant-facing answer must be a *recorded claim* with an epistemic grade that is *earned from the evidence* — never a label the model decides to print. Decisions: (1) **One contract, four grades** — `rev-claim-v1` reuses the evidence contract's existing `CLAIM_GRADES` (`verified_fact` / `calculated_observation` / `hypothesis` / `unknown`) so the machine word and the merchant word are the same word; no new taxonomy. (2) **Grades are earned, not assigned** — `verified_fact` cites only available evidence and carries the item's own value/currency; `calculated_observation` must list `calculation_inputs` (a subset of cited items) from which its money value is re-derivable within rounding; a `hypothesis` must carry `candidate_causes` and **may not carry a numeric value** (a hypothesis with a number is a defect, not a grade); an `unknown` may carry no value and states its `limitation`. (3) **Fabrication is a validation error, not a rounding courtesy** — false precision (money >2dp, percent >1dp), an asserted impact without a calculation method, an unknown carrying a value, a claim citing unknown/foreign (cross-tenant or cross-store) evidence, and a restated claim without `source_investigation` all produce stable machine-readable error codes and fail the whole response at the Node boundary (400); the Python pipeline validates before recording, so an unearned number is replaced by an `unknown` claim plus a visible warning rather than emitted. (4) **Restated claims are the only claims that skip re-derivation** — provenance and corrections restatement must not re-validate a previously earned value against *current* evidence (that would manufacture spurious "unknown evidence" failures); a restated claim preserves grade, value and `claim_id` verbatim and is shape-validated with `source_investigation`; `can_promote` forbids upgrading a restated or corrected claim. (5) **The merchant's assertion is not a source** — a correction records the original claim as `superseded` (id preserved, pair verifiable across the boundary) and the correction itself as `unknown` ("invalidated pending re-verification"), never re-graded to a fact from the merchant's word; the merchant memory is invalidated in the same step so the figure cannot seed future follow-ups. (6) **Provenance answers from the record, before the chat router** — "where did that figure come from?" is routed from `last_claims` (≤10, well-formed-only, tenant-filtered) *before* conversational early-returns, restates the claim with its grade, gives the source and a human-readable retrieval time (raw ISO timestamps never appear in merchant text), and refuses to re-estimate. (7) **The follow-up record survives both boundaries** — `last_claims` + the allowlisted `checkout_query` drill-down are persisted in the bounded context (write- and read-time filtering, defense in depth) and carried through the Node controller into both the SSE `final` payload and persisted content, so a follow-up inherits scope ("what about those?" stays abandoned-only) and streamed and stored answers agree. (8) **One contract enforced twice, one golden** — Python keystone (`intelligence/epistemics.py`) + Node mirror (`services/revEpistemics.js`, raw-string currency/percent regexes, no `Number()` normalization) with parity locked by a Python-generated golden fixture (`gen_epistemic_golden.py` → `revEpistemics.golden.json`), the Task 203 pattern. Alternatives rejected: a fifth "correction" grade (a correction is a supersession pair, not a new epistemic state); re-deriving restated claims against current evidence (spurious failures); trusting the model's in-answer grade labels (the defect this task removes); a separate comparison-claim class (comparison data rides on `period.comparison_window` of the same claim). Related: TASK 204 (consolidates 212–216); rev-evidence-v2 contract (CLAIM_GRADES); REV-DEC-0012/0013 (fail-closed philosophy); Task 203 (quality model, golden-parity pattern).

## REV-DEC-0016 — Task 207 outcomes compose existing authorities; retries never imply recovery
2026-11-07. A single `rev-investigation-outcome-v1` envelope composes the existing integration, evidence-quality and reporting-period contracts rather than creating new integration or capability registries. Certified observation windows—not integration age or an earliest returned row—determine history. Current observations can survive an ineligible comparison, and independent evidence can survive another domain's failure. Permanent permission/unsupported failures do not retry; transient failures preserve the original question/period but re-read authoritative state and never start/duplicate sync. Raw questions and diagnostics stay in bounded conversation context, not long-term memory. Node validates the envelope independently for JSON/SSE/history. Alternatives rejected: generic no-data responses, row-count-based disconnection, model-selected unsupported capabilities, automatic recovery claims, and unconditional retry.

## REV-DEC-0017 — Task 208 specialists share canonical evidence and retention populations are explicit
2026-11-07. Revenue, retention and operational specialists execute inside the canonical investigation over deduplicated authorized tool evidence; they do not query independently, call an LLM or create a second metric platform. `rev-specialist-execution-v1` carries all 14 lifecycle stages and is validated in Python and Node. Retention separates within-window repeat, lifetime returning, first-time and newly observed populations, requires certified lifetime history for acquisition/cohort claims, excludes anonymous activity and PII, and makes rates undefined at zero denominator. Cohort entry is first lifetime order in the merchant-calendar month; only mature customers enter a 90-day rate denominator. Operational delay is a disclosed 72-hour age threshold, not an SLA; split fulfillment requires complete relationship sync. Existing conversation/message persistence is sufficient, so no specialist table or migration was added. Alternatives rejected: BusinessState-only summaries, mapping-only inventory, inferred first-time/churn/loyalty, current-snapshot historical stock, duplicate cross-domain retrieval and forced agreement.
