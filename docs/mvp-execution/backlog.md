# Revluma — Atomic MVP Execution Backlog

**Total: 406 individually scoped tasks across six MVP phases.**
> Source of truth: user-approved MVP Product Vision, Features, User Experience & Development Scope.
> Status: planning backlog; none of the items below are claimed completed merely by appearing here.
> Workflow: user directs one task → inspect existing implementation → implement only that task → test/verify → report → identify next task.
> A task may close as **Already implemented and verified** after inspection, rather than requiring a redundant code change.
> No autonomous campaign execution, advanced attribution, CRM expansion, or additional commerce platforms.

## Phase 1 — Reliable Data Foundation

### 1A. Baseline and architecture

- [ ] **TASK 001** — Confirm the deployed backend commit.
- [ ] **TASK 002** — Map Shopify webhook request entrypoint.
- [ ] **TASK 003** — Map Shopify order creation handler.
- [ ] **TASK 004** — Map Shopify order update handler.
- [ ] **TASK 005** — Map Shopify checkout creation handler.
- [ ] **TASK 006** — Map Shopify checkout update handler.
- [ ] **TASK 007** — Map abandonment classification job.
- [ ] **TASK 008** — Map historical Shopify synchronization job.
- [ ] **TASK 009** — Map checkout/order Prisma models.
- [ ] **TASK 010** — Map existing checkout reconciliation tests.
- [ ] **TASK 011** — Record Shopify API version used by backend.
- [ ] **TASK 012** — Record registered Shopify webhook topics.
- [ ] **TASK 013** — Identify checkout fields actually received in test payloads.
- [ ] **TASK 014** — Identify order fields actually received in test payloads.
- [ ] **TASK 015** — Document checkout/order state definitions.

### 1B. Checkout/order integrity

- [ ] **TASK 016** — Test completed checkout payload handling.
- [ ] **TASK 017** — Test order-to-checkout exact ID match.
- [ ] **TASK 018** — Test checkout token matching independently.
- [ ] **TASK 019** — Test cart token matching independently.
- [ ] **TASK 020** — Reject matches based only on customer identity.
- [ ] **TASK 021** — Reject matches based only on email.
- [ ] **TASK 022** — Reject matches based only on amount or time.
- [ ] **TASK 023** — Review coupon-based fallback for false matches.
- [ ] **TASK 024** — Persist verified order-to-checkout relationship.
- [ ] **TASK 025** — Record unresolved order-to-checkout relationships.
- [ ] **TASK 026** — Detect conflicting checkout matches.
- [ ] **TASK 027** — Prevent two orders from incorrectly claiming one checkout.
- [ ] **TASK 028** — Preserve source identifiers for diagnostics.
- [ ] **TASK 029** — Ensure checkout completion overrides abandonment.
- [ ] **TASK 030** — Prevent delayed checkout event reopening completion.
- [ ] **TASK 031** — Test order-first event delivery.
- [ ] **TASK 032** — Test checkout-first event delivery.
- [ ] **TASK 033** — Test abandonment-then-purchase delivery.
- [ ] **TASK 034** — Test duplicate order event delivery.
- [ ] **TASK 035** — Test duplicate checkout event delivery.
- [ ] **TASK 036** — Test simultaneous order and checkout processing.
- [ ] **TASK 037** — Test anonymous checkout reconciliation.
- [ ] **TASK 038** — Test multiple checkouts from one customer.
- [ ] **TASK 039** — Test accelerated checkout evidence.
- [ ] **TASK 040** — Test mobile checkout evidence.
- [ ] **TASK 041** — Test missing checkout identifier handling.
- [ ] **TASK 042** — Test completed checkout with no matching order.
- [ ] **TASK 043** — Test order with no matching checkout.
- [ ] **TASK 044** — Test historical order arriving after checkout.
- [ ] **TASK 045** — Test checkout arriving after historical order.
- [ ] **TASK 046** — Verify recovery label does not imply campaign attribution.
- [ ] **TASK 047** — Correct completed-vs-recovered status semantics.
- [ ] **TASK 048** — Add checkout reconciliation structured logs.
- [ ] **TASK 049** — Add reconciliation regression test suite.
- [ ] **TASK 050** — Run reconciliation suite in CI.

### 1C. Shopify connection and synchronization

- [ ] **TASK 051** — Verify OAuth start endpoint.
- [ ] **TASK 052** — Verify OAuth callback state validation.
- [ ] **TASK 053** — Verify OAuth callback HMAC validation.
- [ ] **TASK 054** — Verify Shopify token persistence security.
- [ ] **TASK 055** — Verify Shopify store ownership binding.
- [ ] **TASK 056** — Verify reconnect behavior.
- [ ] **TASK 057** — Verify Shopify uninstall handling.
- [ ] **TASK 058** — Verify expired/revoked access handling.
- [ ] **TASK 059** — Verify webhook registration status reporting.
- [ ] **TASK 060** — Verify missing webhook retry behavior.
- [ ] **TASK 061** — Verify duplicate webhook registration prevention.
- [ ] **TASK 062** — Verify webhook signature verification.
- [ ] **TASK 063** — Verify webhook delivery deduplication.
- [ ] **TASK 064** — Verify webhook retry after transient failure.
- [ ] **TASK 065** — Verify webhook acknowledgment latency.
- [ ] **TASK 066** — Verify initial order sync pagination.
- [ ] **TASK 067** — Verify initial checkout sync behavior.
- [ ] **TASK 068** — Verify initial product availability sync.
- [ ] **TASK 069** — Verify initial sync progress persistence.
- [ ] **TASK 070** — Verify initial sync failure state.
- [ ] **TASK 071** — Verify initial sync retry resumes safely.
- [ ] **TASK 072** — Verify Shopify API throttling handling.
- [ ] **TASK 073** — Verify stale synchronization detection.
- [ ] **TASK 074** — Verify repeated sync does not duplicate orders.
- [ ] **TASK 075** — Verify repeated sync does not duplicate checkouts.
- [ ] **TASK 076** — Verify sync preserves known checkout product details.
- [ ] **TASK 077** — Verify order cancellation updates metrics.
- [ ] **TASK 078** — Verify refund handling in revenue totals.
- [ ] **TASK 079** — Verify currency preservation.
- [ ] **TASK 080** — Verify missing data is marked unavailable.
- [ ] **TASK 081** — Verify Shopify disconnection stops ingestion.

### 1D. Security and foundation

- [ ] **TASK 082** — Test merchant A cannot read merchant B orders.
- [ ] **TASK 083** — Test merchant A cannot read merchant B checkouts.
- [ ] **TASK 084** — Test merchant A cannot read merchant B integration status.
- [ ] **TASK 085** — Test merchant A cannot trigger merchant B sync.
- [ ] **TASK 086** — Test organization membership authorization.
- [ ] **TASK 087** — Test authenticated API access.
- [ ] **TASK 088** — Test invalid access token handling.
- [ ] **TASK 089** — Verify secrets are absent from logs.
- [ ] **TASK 090** — Verify customer PII is redacted in logs.
- [ ] **TASK 091** — Verify backend API rate limits.
- [ ] **TASK 092** — Verify Shopify webhook request body authenticity.
- [ ] **TASK 093** — Verify background jobs scope queries by store.
- [ ] **TASK 094** — Verify database uniqueness constraints.
- [ ] **TASK 095** — Verify critical query indexes.
- [ ] **TASK 096** — Verify backend error response consistency.
- [ ] **TASK 097** — Verify background job retry bounds.
- [ ] **TASK 098** — Verify operational logging correlation IDs.
- [ ] **TASK 099** — Verify database migration safety.
- [ ] **TASK 100** — Run backend test suite.
- [ ] **TASK 101** — Run backend build and lint.
- [ ] **TASK 102** — Verify Render backend deployment health.

## Phase 2 — Operational Intelligence

### 2A. Evidence and business state

- [ ] **TASK 103** — Inventory business-state generation entrypoints.
- [ ] **TASK 104** — Define business-state snapshot contract.
- [ ] **TASK 105** — Verify snapshot is scoped to store.
- [ ] **TASK 106** — Verify snapshot freshness timestamp.
- [ ] **TASK 107** — Verify snapshot completeness indicators.
- [ ] **TASK 108** — Verify revenue total calculation.
- [ ] **TASK 109** — Verify order count calculation.
- [ ] **TASK 110** — Verify period boundary handling.
- [ ] **TASK 111** — Verify merchant timezone handling.
- [ ] **TASK 112** — Verify currency separation.
- [ ] **TASK 113** — Verify refunded revenue treatment.
- [ ] **TASK 114** — Verify cancelled order treatment.
- [ ] **TASK 115** — Verify checkout pending count.
- [ ] **TASK 116** — Verify abandoned checkout count.
- [ ] **TASK 117** — Verify completed checkout count.
- [ ] **TASK 118** — Verify checkout value calculation.
- [ ] **TASK 119** — Verify checkout/order deduplication in aggregates.
- [ ] **TASK 120** — Verify integration health calculation.
- [ ] **TASK 121** — Verify product availability data source.
- [ ] **TASK 122** — Represent missing product availability as unknown.
- [ ] **TASK 123** — Represent insufficient history explicitly.
- [ ] **TASK 124** — Represent partial sync explicitly.
- [ ] **TASK 125** — Persist evidence provenance.
- [ ] **TASK 126** — Persist evidence calculation window.
- [ ] **TASK 127** — Test zero-order store state.
- [ ] **TASK 128** — Test partially synced store state.
- [ ] **TASK 129** — Test multi-currency store state.
- [ ] **TASK 130** — Test data freshness degradation.

### 2B. Detection

- [ ] **TASK 131** — Define revenue change detection threshold.
- [ ] **TASK 132** — Test revenue decline detection.
- [ ] **TASK 133** — Test revenue increase detection.
- [ ] **TASK 134** — Test revenue fluctuation baseline.
- [ ] **TASK 135** — Suppress revenue anomaly with insufficient history.
- [ ] **TASK 136** — Define checkout abandonment change detector.
- [ ] **TASK 137** — Test abandonment increase detector.
- [ ] **TASK 138** — Test abandonment decrease detector.
- [ ] **TASK 139** — Test pending checkouts excluded from abandonment.
- [ ] **TASK 140** — Test completed checkouts excluded from abandonment.
- [ ] **TASK 141** — Define integration failure detector.
- [ ] **TASK 142** — Test missing webhook detector.
- [ ] **TASK 143** — Test stale synchronization detector.
- [ ] **TASK 144** — Test unavailable data detector.
- [ ] **TASK 145** — Define order-volume change detector.
- [ ] **TASK 146** — Test order-volume decline detector.
- [ ] **TASK 147** — Test order-volume increase detector.
- [ ] **TASK 148** — Define product availability signal where supported.
- [ ] **TASK 149** — Test out-of-stock signal with verified inventory.
- [ ] **TASK 150** — Avoid claims about unavailable inventory.
- [ ] **TASK 151** — Deduplicate repeated findings.
- [ ] **TASK 152** — Expire findings when evidence no longer supports them.

### 2C. Investigation and priority

- [ ] **TASK 153** — Define finding evidence contract.
- [ ] **TASK 154** — Attach supporting calculation to finding.
- [ ] **TASK 155** — Attach time window to finding.
- [ ] **TASK 156** — Attach evidence freshness to finding.
- [ ] **TASK 157** — Attach known limitations to finding.
- [ ] **TASK 158** — Distinguish observed correlation from cause.
- [ ] **TASK 159** — Prevent unsupported shipping-friction diagnosis.
- [ ] **TASK 160** — Prevent unsupported payment-friction diagnosis.
- [ ] **TASK 161** — Define potential-impact scoring inputs.
- [ ] **TASK 162** — Define urgency scoring inputs.
- [ ] **TASK 163** — Define evidence-strength scoring inputs.
- [ ] **TASK 164** — Define actionability scoring inputs.
- [ ] **TASK 165** — Define business-relevance scoring inputs.
- [ ] **TASK 166** — Implement deterministic priority ordering.
- [ ] **TASK 167** — Test urgent integration failure priority.
- [ ] **TASK 168** — Test uncertain high-value checkout priority.
- [ ] **TASK 169** — Test low-impact fluctuation priority.
- [ ] **TASK 170** — Ensure weak evidence lowers priority.
- [ ] **TASK 171** — Generate one highest-priority finding.
- [ ] **TASK 172** — Generate concise operational briefing.
- [ ] **TASK 173** — Generate recommended investigation step.
- [ ] **TASK 174** — Persist finding lifecycle status.
- [ ] **TASK 175** — Test finding resolution after data correction.
- [ ] **TASK 176** — Test finding changes between snapshots.
- [ ] **TASK 177** — Expose evidence-backed findings API.
- [ ] **TASK 178** — Expose business-health summary API.
- [ ] **TASK 179** — Expose operational activity API.
- [ ] **TASK 180** — Add business-state regression tests.

## Phase 3 — Rev Intelligence

### 3A. Conversation foundations

- [ ] **TASK 181** — Map existing Rev request flow.
- [ ] **TASK 182** — Verify Rev authentication.
- [ ] **TASK 183** — Verify organization and store authorization.
- [ ] **TASK 184** — Verify conversation creation.
- [ ] **TASK 185** — Verify conversation listing.
- [ ] **TASK 186** — Verify conversation loading.
- [ ] **TASK 187** — Verify conversation switching.
- [ ] **TASK 188** — Verify conversation history persistence.
- [ ] **TASK 189** — Verify follow-up question context.
- [ ] **TASK 190** — Verify conversation deletion or archive behavior if supported.
- [ ] **TASK 191** — Verify retry behavior after AI timeout.
- [ ] **TASK 192** — Verify request cancellation behavior.
- [ ] **TASK 193** — Verify loading state API contract.
- [ ] **TASK 194** — Verify AI error classification.
- [ ] **TASK 195** — Verify request rate limiting.
- [ ] **TASK 196** — Verify tenant-isolated conversation retrieval.

### 3B. Evidence retrieval and reasoning

- [ ] **TASK 197** — Define Rev evidence retrieval contract.
- [x] **TASK 198** — Verify revenue evidence retrieval. *(code complete; see `implementation/TASK-198-REV-REVENUE-EVIDENCE.md` — currency-safe, merchant-timezone, currency-honest revenue retrieval; CI + live acceptance outstanding)*
- [ ] **TASK 199** — Verify order evidence retrieval. *(implementation candidate; see `implementation/TASK-199-ORDER-EVIDENCE.md` and `validation/TASK-199-ORDER-EVIDENCE.md`; CI, migration, deployment and authenticated production verification pending)*
- [ ] **TASK 200** — Verify checkout evidence retrieval.
- [x] **TASK 201** — Verify integration evidence retrieval. *(code complete; see `implementation/TASK-201-REV-INTEGRATION-EVIDENCE.md` — fail-closed current-state integration evidence, tenant- and secret-safe, Python tool + Node endpoint parity; CI + live acceptance outstanding)*
- [ ] **TASK 202** — Verify finding evidence retrieval.
- [ ] **TASK 203** — Verify product evidence retrieval where available.
- [x] **TASK 204** — Verify relative date interpretation. *(subject delivered by TASK 198 merchant-calendar reporting periods, REV-DEC-0012 — calendar-week/month relative periods in the merchant timezone; the number was reused for the consolidated reasoning-epistemics task, see the TASK 204 line below)*
- [x] **TASK 204** — Productionize reasoning epistemics and numeric integrity (consolidates original TASK 212–216). *(see `implementation/TASK-204-REASONING-EPISTEMICS.md` and `validation/TASK-204-REASONING-EPISTEMICS.md`; numbering collision with the line above documented there)*
- [ ] **TASK 205** — Verify comparison period calculation.
- [ ] **TASK 206** — Verify merchant timezone interpretation. *(subject delivered by TASK 198/202 merchant-timezone period resolution, REV-DEC-0012/0014 — local-calendar, DST-safe windows with disclosed unverified UTC; the number was reused for the consolidated investigation task, see the TASK 206 line below)*
- [x] **TASK 206** — Revenue drop, checkout abandonment and priority recommendation investigations (consolidates original TASK 221–223). *(see `implementation/TASK-206-REVENUE-CHECKOUT-PRIORITY-INVESTIGATION.md` and `validation/TASK-206-REVENUE-CHECKOUT-PRIORITY-INVESTIGATION.md`; decision REV-DEC-0018; numbering collision with the line above documented there)*
- [ ] **TASK 207** — Verify currency-aware response calculation.
- [ ] **TASK 208** — Verify zero-value evidence handling.
- [ ] **TASK 209** — Verify incomplete evidence fallback.
- [ ] **TASK 210** — Verify stale evidence warning. *(the number was reused for the adaptive answer structure task — see the TASK 210 line below; the stale-evidence mechanics themselves — `stale` freshness status, stale-only-blocks-current-claims, stale confidence penalty — live in the TASK 203/208 evidence-quality and outcome contracts)*
- [x] **TASK 210** — Adaptive answer structure & confidence communication (spec lines 1–10; consolidates original TASK 235–240). *(see `implementation/TASK-210-ADAPTIVE-ANSWER-STRUCTURE-CONFIDENCE.md` and `validation/TASK-210-ADAPTIVE-ANSWER-STRUCTURE-CONFIDENCE.md`; decision REV-DEC-0019; numbering collision with the line above documented there)*
- [ ] **TASK 211** — Verify contradictory evidence handling.
- [x] **TASK 212** — Label verified facts in reasoning output. *(consolidated into TASK 204 — reasoning epistemics; see `implementation/TASK-204-REASONING-EPISTEMICS.md`)*
- [x] **TASK 213** — Label calculated findings in reasoning output. *(consolidated into TASK 204 — reasoning epistemics; the number was reused for the consolidated integration-state task — see the TASK 213 line below)*
- [x] **TASK 214** — Label hypotheses in reasoning output. *(consolidated into TASK 204 — reasoning epistemics)*
- [x] **TASK 215** — Label unknowns in reasoning output. *(consolidated into TASK 204 — reasoning epistemics)*
- [x] **TASK 216** — Prevent fabricated numeric claims. *(consolidated into TASK 204 — reasoning epistemics)*
- [x] **TASK 213** — Integration state model and backend-truthful UI (consolidates original TASK 252–256; canonical `rev-integration-state-v1` contract, server-evaluated, shared by Rev and the product surfaces; sessionStorage status cache removed). *(see `diagnostics/TASK-213-INTEGRATION-STATE-MODEL-BACKEND-TRUTHFUL-UI.md`; decision REV-DEC-0021; numbering collision with the line above documented there)*
- [ ] **TASK 205 (consolidated 217–220)** — Causal, action, recoverable-revenue and source-reference guardrails. **Implementation CI green; final commit/merge/deployment/authenticated production pending.** See `implementation/TASK-205-CAUSAL-ACTION-RECOVERY-CITATION-GUARDRAILS.md`.
- [ ] **TASK 217** — Consolidated into Task 205.
- [ ] **TASK 218** — Consolidated into Task 205.
- [ ] **TASK 219** — Consolidated into Task 205.
- [ ] **TASK 220** — Consolidated into Task 205.
- [x] **TASK 221** — Test revenue drop investigation. *(consolidated into TASK 206 — revenue/checkout/priority investigation; scenarios A/B/I, `tests/test_rev_investigation_scenarios.py`)*
- [x] **TASK 222** — Test checkout abandonment investigation. *(consolidated into TASK 206 — scenarios D/E/F; comparable-period deterioration verified)*
- [x] **TASK 223** — Test priority recommendation question. *(consolidated into TASK 206 — scenarios G/H/J/K/L; findings prioritisation + challenge + invalidation)*
- [ ] **TASK 224** — Test integration failure investigation.
- [ ] **TASK 225** — Test insufficient history question.
- [ ] **TASK 226** — Test unsupported question response.

### 3C. Intelligence coordination and response

- [ ] **TASK 227** — Map revenue intelligence specialist.
- [ ] **TASK 228** — Map retention intelligence specialist.
- [ ] **TASK 229** — Map operational intelligence specialist.
- [ ] **TASK 230** — Verify orchestration routes revenue question.
- [ ] **TASK 231** — Verify orchestration routes checkout question.
- [ ] **TASK 232** — Verify orchestration routes integration question.
- [ ] **TASK 233** — Verify mixed-domain question coordination.
- [ ] **TASK 234** — Ensure one coherent Rev response.
- [x] **TASK 235** — Verify situation section when appropriate. *(consolidated into TASK 210 — adaptive sections: each of the four headings appears only when its profile selects it; see `implementation/TASK-210-ADAPTIVE-ANSWER-STRUCTURE-CONFIDENCE.md`)*
- [x] **TASK 236** — Verify insight section when appropriate. *(consolidated into TASK 210 — adaptive sections)*
- [x] **TASK 237** — Verify implication section when appropriate. *(consolidated into TASK 210 — adaptive sections)*
- [x] **TASK 238** — Verify recommendation section when appropriate. *(consolidated into TASK 210 — adaptive sections)*
- [x] **TASK 239** — Verify confidence explanation. *(consolidated into TASK 210 — per-claim earned confidence communicated as a natural-language section, never a score/badge)*
- [x] **TASK 240** — Avoid forced template for simple questions. *(consolidated into TASK 210 — `direct_factual`/degraded profiles emit only the earned sections; no forced 4-slot template)*
- [ ] **TASK 241** — Verify recommendations are merchant-executable.
- [ ] **TASK 242** — Verify recommendations do not execute changes.
- [ ] **TASK 243** — Verify context from selected Command Center finding.
- [ ] **TASK 244** — Verify follow-up maintains finding context.
- [ ] **TASK 245** — Verify responses remain useful without sufficient data.
- [ ] **TASK 246** — Test AI service timeout fallback.
- [ ] **TASK 247** — Test AI service malformed output fallback.
- [ ] **TASK 248** — Test repeated question consistency.
- [ ] **TASK 249** — Test long conversation context limits.
- [ ] **TASK 250** — Test response privacy safeguards.
- [ ] **TASK 251** — Run Rev intelligence regression suite.

## Phase 4 — Command Center & Integration Experience

### 4A. Integration UI

- [x] **TASK 252** — Audit integration screen against MVP states. *(consolidated into TASK 213 — the diagnosis/design doc is that audit; see `diagnostics/TASK-213-INTEGRATION-STATE-MODEL-BACKEND-TRUTHFUL-UI.md`)*
- [x] **TASK 253** — Show connected state from backend. *(consolidated into TASK 213 — canonical `connected` badge, server-evaluated; green reserved for this state)*
- [x] **TASK 254** — Show synchronizing state from backend. *(consolidated into TASK 213 — canonical `synchronizing` badge with pulse, 15s polling)*
- [x] **TASK 255** — Show limited-access state from backend. *(consolidated into TASK 213 — canonical `limited_access` badge, never rendered as connected)*
- [x] **TASK 256** — Show needs-attention state from backend. *(consolidated into TASK 213 — canonical `needs_attention` badge + merchant next step)*
- [ ] **TASK 257** — Show disconnected state from backend.
- [ ] **TASK 258** — Show actual webhook status.
- [ ] **TASK 259** — Show actual initial sync status.
- [ ] **TASK 260** — Show sync error reason safely.
- [ ] **TASK 261** — Verify reconnect action.
- [ ] **TASK 262** — Verify retry sync action.
- [ ] **TASK 263** — Verify mobile integration layout.
- [ ] **TASK 264** — Verify no fabricated progress percentages.

### 4B. Command Center UI

- [ ] **TASK 265** — Audit Command Center component hierarchy.
- [ ] **TASK 266** — Place operational briefing first.
- [ ] **TASK 267** — Bind briefing to real business-state API.
- [ ] **TASK 268** — Show briefing freshness.
- [ ] **TASK 269** — Show briefing unknown-data state.
- [ ] **TASK 270** — Show top priority finding.
- [ ] **TASK 271** — Show finding evidence.
- [ ] **TASK 272** — Show finding confidence.
- [ ] **TASK 273** — Show finding limitations.
- [ ] **TASK 274** — Show recommended next step.
- [ ] **TASK 275** — Show revenue health indicator.
- [ ] **TASK 276** — Show orders health indicator.
- [ ] **TASK 277** — Show checkout health indicator.
- [ ] **TASK 278** — Show product availability only when supported.
- [ ] **TASK 279** — Show integration health indicator.
- [ ] **TASK 280** — Show meaningful operational activity.
- [ ] **TASK 281** — Remove mock business metrics.
- [ ] **TASK 282** — Remove duplicate analytics-heavy components.
- [ ] **TASK 283** — Verify featured intelligence visual prominence.
- [ ] **TASK 284** — Verify dark sidebar and light workspace.
- [ ] **TASK 285** — Verify brand accent consistency.
- [ ] **TASK 286** — Verify desktop layout.
- [ ] **TASK 287** — Verify tablet layout.
- [ ] **TASK 288** — Verify mobile layout.
- [ ] **TASK 289** — Verify loading skeletons.
- [ ] **TASK 290** — Verify API error state.
- [ ] **TASK 291** — Verify empty store state.
- [ ] **TASK 292** — Verify partial sync state.
- [ ] **TASK 293** — Verify no findings state.
- [ ] **TASK 294** — Verify contextual investigate action.

### 4C. Rev workspace UI

- [ ] **TASK 295** — Verify new conversation control.
- [ ] **TASK 296** — Verify conversation history list.
- [ ] **TASK 297** — Verify conversation switching.
- [ ] **TASK 298** — Verify conversation title display.
- [ ] **TASK 299** — Verify question input behavior.
- [ ] **TASK 300** — Verify send and disabled states.
- [ ] **TASK 301** — Verify investigation loading state.
- [ ] **TASK 302** — Verify readable structured responses.
- [ ] **TASK 303** — Verify simple answer formatting.
- [ ] **TASK 304** — Verify evidence and uncertainty display.
- [ ] **TASK 305** — Verify conversation error state.
- [ ] **TASK 306** — Verify retry control.
- [ ] **TASK 307** — Verify context from Command Center.
- [ ] **TASK 308** — Verify mobile conversation layout.
- [ ] **TASK 309** — Verify desktop conversation layout.
- [ ] **TASK 310** — Verify accessible keyboard interaction.
- [ ] **TASK 311** — Verify accessible status announcements.

### 4D. UX and integration acceptance

- [ ] **TASK 312** — Verify first-time onboarding route.
- [ ] **TASK 313** — Verify Shopify authorization return route.
- [ ] **TASK 314** — Verify first briefing entry route.
- [ ] **TASK 315** — Verify finding-to-Rev navigation.
- [ ] **TASK 316** — Verify conversation return to Command Center.
- [ ] **TASK 317** — Verify design consistency across three workspaces.
- [ ] **TASK 318** — Verify error copy uses plain language.
- [ ] **TASK 319** — Verify responsive navigation.
- [ ] **TASK 320** — Verify accessibility focus indicators.
- [ ] **TASK 321** — Verify contrast for key text.
- [ ] **TASK 322** — Verify production API endpoints wired.
- [ ] **TASK 323** — Run frontend auth regression tests.
- [ ] **TASK 324** — Run frontend build.
- [ ] **TASK 325** — Verify production deployment after quota clears.

## Phase 5 — Production Validation

### 5A. Merchant journey

- [ ] **TASK 326** — Create fresh controlled merchant test account.
- [ ] **TASK 327** — Verify email sign-in journey.
- [ ] **TASK 328** — Verify available social sign-in journey.
- [ ] **TASK 329** — Connect fresh Shopify test store.
- [ ] **TASK 330** — Verify OAuth return to Revluma.
- [ ] **TASK 331** — Verify initial synchronization starts.
- [ ] **TASK 332** — Verify synchronization completion state.
- [ ] **TASK 333** — Verify initial briefing displays.
- [ ] **TASK 334** — Verify first priority finding.
- [ ] **TASK 335** — Open finding in Rev.
- [ ] **TASK 336** — Ask revenue comparison question.
- [ ] **TASK 337** — Ask checkout question.
- [ ] **TASK 338** — Ask operational priority question.
- [ ] **TASK 339** — Verify follow-up conversation context.
- [ ] **TASK 340** — Return to Command Center.
- [ ] **TASK 341** — Verify updated business state after new order.
- [ ] **TASK 342** — Verify updated state after checkout abandonment.
- [ ] **TASK 343** — Verify updated state after completed purchase.
- [ ] **TASK 344** — Verify delayed event does not reopen purchase.
- [ ] **TASK 345** — Verify no invented figures in displayed intelligence.

### 5B. Resilience and security

- [ ] **TASK 346** — Test duplicate Shopify webhook in staging.
- [ ] **TASK 347** — Test delayed Shopify webhook in staging.
- [ ] **TASK 348** — Test out-of-order Shopify webhook in staging.
- [ ] **TASK 349** — Test temporary Shopify API failure.
- [ ] **TASK 350** — Test Shopify rate-limit response.
- [ ] **TASK 351** — Test interrupted initial sync.
- [ ] **TASK 352** — Test resumed initial sync.
- [ ] **TASK 353** — Test revoked Shopify authorization.
- [ ] **TASK 354** — Test Shopify uninstall event.
- [ ] **TASK 355** — Test Render backend restart.
- [ ] **TASK 356** — Test AI service timeout.
- [ ] **TASK 357** — Test database temporary error behavior.
- [ ] **TASK 358** — Test merchant-to-merchant API isolation.
- [ ] **TASK 359** — Test merchant-to-merchant Rev isolation.
- [ ] **TASK 360** — Test customer PII not exposed.
- [ ] **TASK 361** — Test no autonomous store mutation.
- [ ] **TASK 362** — Test no automated recovery messages.
- [ ] **TASK 363** — Review application secrets exposure.
- [ ] **TASK 364** — Review production logs for sensitive values.
- [ ] **TASK 365** — Verify database migration status.
- [ ] **TASK 366** — Verify production backend revision.
- [ ] **TASK 367** — Verify production frontend revision.
- [ ] **TASK 368** — Verify production error monitoring.
- [ ] **TASK 369** — Record launch-blocking defects.
- [ ] **TASK 370** — Resolve each launch-blocking defect.
- [ ] **TASK 371** — Run full regression suite.
- [ ] **TASK 372** — Sign off MVP acceptance checklist.

## Phase 6 — Controlled Beta Launch

### 6A. Launch preparation

- [ ] **TASK 373** — Define controlled beta participant criteria.
- [ ] **TASK 374** — Define beta enrollment cap.
- [ ] **TASK 375** — Write concise MVP product description.
- [ ] **TASK 376** — Write beta onboarding instructions.
- [ ] **TASK 377** — Write Shopify permission explanation.
- [ ] **TASK 378** — Write known limitations notice.
- [ ] **TASK 379** — Write merchant support contact process.
- [ ] **TASK 380** — Write issue reporting form.
- [ ] **TASK 381** — Prepare merchant feedback questions.
- [ ] **TASK 382** — Prepare merchant privacy and data handling review.
- [ ] **TASK 383** — Verify beta access invitation process.
- [ ] **TASK 384** — Verify beta onboarding support process.
- [ ] **TASK 385** — Verify uptime and error escalation process.
- [ ] **TASK 386** — Verify beta launch rollback plan.

### 6B. Beta operation

- [ ] **TASK 387** — Invite first Shopify merchant.
- [ ] **TASK 388** — Observe first merchant onboarding.
- [ ] **TASK 389** — Record first merchant first-briefing outcome.
- [ ] **TASK 390** — Record first merchant Rev investigation outcome.
- [ ] **TASK 391** — Ask first merchant usefulness feedback.
- [ ] **TASK 392** — Record first merchant confusing experience.
- [ ] **TASK 393** — Fix first verified launch-blocking issue.
- [ ] **TASK 394** — Invite second merchant.
- [ ] **TASK 395** — Measure successful store connection rate.
- [ ] **TASK 396** — Measure time to first useful briefing.
- [ ] **TASK 397** — Measure finding investigation engagement.
- [ ] **TASK 398** — Measure Rev conversation usefulness feedback.
- [ ] **TASK 399** — Measure returning merchant engagement.
- [ ] **TASK 400** — Review false-positive findings.
- [ ] **TASK 401** — Review unhelpful recommendations.
- [ ] **TASK 402** — Review unresolved data reliability incidents.
- [ ] **TASK 403** — Prioritize beta feedback against MVP scope.
- [ ] **TASK 404** — Publish beta reliability status.
- [ ] **TASK 405** — Review beta launch success criteria.
- [ ] **TASK 406** — Decide broader rollout readiness.

## Per-task completion report

- Task ID and requirement served
- What existed before
- Exact change or verification performed
- Files / commit / PR if applicable
- Tests executed and observed results
- Deployment status (when applicable)
- Remaining limitations
- **Next in line: TASK NNN — ...**
