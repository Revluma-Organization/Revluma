# MVP engineering audit register

Execution-history index; code/tests/deployment evidence remain authoritative for current behavior. Date: 2026-10-29 (Africa/Lagos client context). No earlier completion is inferred from a prompt. NOT STARTED means no execution evidence recorded here, not a claim about undiscovered external work.

## Task tracking

| Task | Phase | Requirement | Status | Report | Commit/PR | Last Verified |
|---|---|---|---|---|---|---|
| 001 | Phase 1 | Confirm the deployed backend commit. | REPORT UNAVAILABLE — PRIOR EXECUTION NOT VERIFIED | Unavailable | Unknown | Unknown |
| 002 | Phase 1 | Map Shopify webhook request entrypoint. | COMPLETED — VERIFIED (historical architecture audit PASS; runtime unverified) | [TASK-002](diagnostics/TASK-002.md) | Inspected cfb41b7; recovered export | 2026-10-30 recovery; original date unavailable |
| 003 | Phase 1 | Map Shopify order creation handler. | COMPLETED — VERIFIED (historical architecture audit PASS; runtime unverified) | [TASK-003](diagnostics/TASK-003.md) | Inspected cfb41b7; recovered export | 2026-10-30 recovery; original date unavailable |
| 004 | Phase 1 | Map Shopify order update handler. | COMPLETED — VERIFIED (historical architecture audit PASS; runtime unverified) | [TASK-004](diagnostics/TASK-004.md) | Inspected cfb41b7; recovered export | 2026-10-30 recovery; original date unavailable |
| 005 | Phase 1 | Map Shopify checkout creation handler. | COMPLETED — VERIFIED (historical architecture audit PASS; runtime unverified) | [TASK-005](diagnostics/TASK-005.md) | Inspected cfb41b7; recovered export | 2026-10-30 recovery; original date unavailable |
| 006 | Phase 1 | Map Shopify checkout update handler. | COMPLETED — VERIFIED (historical architecture audit PASS; runtime unverified) | [TASK-006](diagnostics/TASK-006.md) | Inspected cfb41b7; recovered export | 2026-10-30 recovery; original date unavailable |
| 007 | Phase 1 | Map abandonment classification job. | COMPLETED — VERIFIED (historical architecture audit PASS; runtime unverified) | [TASK-007](diagnostics/TASK-007.md) | Inspected cfb41b7; recovered export | 2026-10-30 recovery; original date unavailable |
| 008 | Phase 1 | Map historical Shopify synchronization job. | PARTIALLY VERIFIED (original PARTIAL) | [TASK-008](diagnostics/TASK-008.md) | Inspected cfb41b7; imported by Task 010 | 2026-10-29 (historical report) |
| 009 | Phase 1 | Map checkout/order Prisma models. | PARTIALLY VERIFIED (original PARTIAL) | [TASK-009](diagnostics/TASK-009.md) | Inspected cfb41b7; imported by Task 010 | 2026-10-29 (historical report) |
| 010 | Phase 1 | Map existing checkout reconciliation tests. | COMPLETED — VERIFIED (test architecture audit; product coverage remains partial) | [TASK-010](diagnostics/TASK-010.md) | Inspected d410748; docs publication to main authorized 2026-10-30 | 2026-10-30 documentation follow-up |
| 011 | Phase 1 | Record Shopify API version used by backend. | COMPLETE — VERIFIED (configuration audit; open findings retained) | [TASK-011](diagnostics/TASK-011.md) | Inspected 55d78f06; production cfb41b7 Backend content identical | 2026-10-30 |
| 012 | Phase 1 | Record registered Shopify webhook topics. | COMPLETE — PASS (audit; live enumeration limits recorded) | [TASK-012](diagnostics/TASK-012.md) | main db1f6be1; production cfb41b7 Backend identical | 2026-10-30 |
| 013 | Phase 1 | Identify checkout fields actually received in test payloads. | COMPLETE — VERIFIED: 2 authentic checkout/create and 13 checkout/update field-level captures; nested line-item keys verified | [TASK-013](diagnostics/TASK-013.md) | Render field-presence logs 2026-10-30 00:19–00:20 UTC; production commit 4ac02b7; diagnostic disabled pending replacement deployment verification; DB item persistence remains a separate open issue | 2026-10-30 |
| 014 | Phase 1 | Identify order fields actually received in test payloads. | NOT STARTED | — | — | — |
| 015 | Phase 1 | Document checkout/order state definitions. | NOT STARTED | — | — | — |
| 016 | Phase 1 | Test completed checkout payload handling. | NOT STARTED | — | — | — |
| 017 | Phase 1 | Test order-to-checkout exact ID match. | NOT STARTED | — | — | — |
| 018 | Phase 1 | Test checkout token matching independently. | NOT STARTED | — | — | — |
| 019 | Phase 1 | Test cart token matching independently. | NOT STARTED | — | — | — |
| 020 | Phase 1 | Reject matches based only on customer identity. | NOT STARTED | — | — | — |
| 021 | Phase 1 | Reject matches based only on email. | NOT STARTED | — | — | — |
| 022 | Phase 1 | Reject matches based only on amount or time. | NOT STARTED | — | — | — |
| 023 | Phase 1 | Review coupon-based fallback for false matches. | NOT STARTED | — | — | — |
| 024 | Phase 1 | Persist verified order-to-checkout relationship. | PASS — VERIFIED IN ISOLATED POSTGRESQL; NOT DEPLOYED | [TASK-024](implementation/TASK-024.md) | branch fix/mvp-task-024-verified-checkout-order-persistence; source f5f8abd, 30758e4; 26/26 PASS, run 40988004734; backend tests and refresh regression SUCCESS; REV-FIND-023-01/02/05, REV-FIND-017-01/02; Tasks 025–029, 046–049 | 2026-10-30 |
| 025 | Phase 1 | Record unresolved order-to-checkout relationships. | PASS — VERIFIED IN ISOLATED POSTGRESQL; NOT DEPLOYED | [TASK-025](implementation/TASK-025.md) | Branch fix/mvp-task-025-unresolved-reconciliation-records (based on unmerged Task024); schema f2f58f2, 92d3eb3; service 188087b; migration 23a1c67; 28/28 PASS run 40988985305; SQL migration validated; backend tests 40988985348 and refresh regression 40988985472 SUCCESS; REV-FIND-025-01; Tasks 026–030, 048–049 | 2026-10-30 |
| 026 | Phase 1 | Detect conflicting checkout matches. | PASS — VERIFIED IN ISOLATED POSTGRESQL; NOT DEPLOYED | [TASK-026](implementation/TASK-026.md) | Baseline 2e185ac; implementation 1d830e2; tests 76d2c82; workflow 46f2259; 40/40 PASS run 40989659035; Task025 28/28 PASS run 40989659093; backend tests/refresh SUCCESS; REV-FIND-017-01/02, REV-FIND-026-01 | 2026-10-30 |
| 027 | Phase 1 | Prevent two orders from incorrectly claiming one checkout. | PARTIAL — CODE VERIFIED, PRODUCTION CARDINALITY/LEGACY AUDIT PENDING; NOT DEPLOYED | [TASK-027](implementation/TASK-027.md) | Baseline 9ab3f282; code eaecbae; 40/40 Task027 PASS run 40990349650; Task026 40/40 and Task025 28/28 PASS; backend/refresh PASS; REV-FIND-027-01/02/03; no production cardinality evidence | 2026-10-30 |
| 028 | Phase 1 | Preserve source identifiers for diagnostics. | PARTIAL — IMPLEMENTED, 34/44 SCENARIOS AUTHORED, CI NOT VERIFIED; NOT DEPLOYED | [TASK-028](implementation/TASK-028.md) | Typed Shopify ID/token fields, additive migration, historical order token mapping, conflict protection; 10 missing tests, provenance and legacy compatibility open; REV-FIND-028-01/02/03/04 | 2026-10-30 |
| 029 | Phase 1 | Ensure checkout completion overrides abandonment. | NOT STARTED | — | — | — |
| 030 | Phase 1 | Prevent delayed checkout event reopening completion. | NOT STARTED | — | — | — |
| 031 | Phase 1 | Test order-first event delivery. | NOT STARTED | — | — | — |
| 032 | Phase 1 | Test checkout-first event delivery. | NOT STARTED | — | — | — |
| 033 | Phase 1 | Test abandonment-then-purchase delivery. | NOT STARTED | — | — | — |
| 034 | Phase 1 | Test duplicate order event delivery. | NOT STARTED | — | — | — |
| 035 | Phase 1 | Test duplicate checkout event delivery. | NOT STARTED | — | — | — |
| 036 | Phase 1 | Test simultaneous order and checkout processing. | NOT STARTED | — | — | — |
| 037 | Phase 1 | Test anonymous checkout reconciliation. | NOT STARTED | — | — | — |
| 038 | Phase 1 | Test multiple checkouts from one customer. | NOT STARTED | — | — | — |
| 039 | Phase 1 | Test accelerated checkout evidence. | NOT STARTED | — | — | — |
| 040 | Phase 1 | Test mobile checkout evidence. | NOT STARTED | — | — | — |
| 041 | Phase 1 | Test missing checkout identifier handling. | NOT STARTED | — | — | — |
| 042 | Phase 1 | Test completed checkout with no matching order. | NOT STARTED | — | — | — |
| 043 | Phase 1 | Test order with no matching checkout. | NOT STARTED | — | — | — |
| 044 | Phase 1 | Test historical order arriving after checkout. | NOT STARTED | — | — | — |
| 045 | Phase 1 | Test checkout arriving after historical order. | NOT STARTED | — | — | — |
| 046 | Phase 1 | Verify recovery label does not imply campaign attribution. | NOT STARTED | — | — | — |
| 047 | Phase 1 | Correct completed-vs-recovered status semantics. | NOT STARTED | — | — | — |
| 048 | Phase 1 | Add checkout reconciliation structured logs. | NOT STARTED | — | — | — |
| 049 | Phase 1 | Add reconciliation regression test suite. | NOT STARTED | — | — | — |
| 050 | Phase 1 | Run reconciliation suite in CI. | NOT STARTED | — | — | — |
| 051 | Phase 1 | Verify OAuth start endpoint. | NOT STARTED | — | — | — |
| 052 | Phase 1 | Verify OAuth callback state validation. | NOT STARTED | — | — | — |
| 053 | Phase 1 | Verify OAuth callback HMAC validation. | NOT STARTED | — | — | — |
| 054 | Phase 1 | Verify Shopify token persistence security. | NOT STARTED | — | — | — |
| 055 | Phase 1 | Verify Shopify store ownership binding. | NOT STARTED | — | — | — |
| 056 | Phase 1 | Verify reconnect behavior. | NOT STARTED | — | — | — |
| 057 | Phase 1 | Verify Shopify uninstall handling. | NOT STARTED | — | — | — |
| 058 | Phase 1 | Verify expired/revoked access handling. | NOT STARTED | — | — | — |
| 059 | Phase 1 | Verify webhook registration status reporting. | NOT STARTED | — | — | — |
| 060 | Phase 1 | Verify missing webhook retry behavior. | NOT STARTED | — | — | — |
| 061 | Phase 1 | Verify duplicate webhook registration prevention. | NOT STARTED | — | — | — |
| 062 | Phase 1 | Verify webhook signature verification. | NOT STARTED | — | — | — |
| 063 | Phase 1 | Verify webhook delivery deduplication. | NOT STARTED | — | — | — |
| 064 | Phase 1 | Verify webhook retry after transient failure. | NOT STARTED | — | — | — |
| 065 | Phase 1 | Verify webhook acknowledgment latency. | NOT STARTED | — | — | — |
| 066 | Phase 1 | Verify initial order sync pagination. | NOT STARTED | — | — | — |
| 067 | Phase 1 | Verify initial checkout sync behavior. | NOT STARTED | — | — | — |
| 068 | Phase 1 | Verify initial product availability sync. | NOT STARTED | — | — | — |
| 069 | Phase 1 | Verify initial sync progress persistence. | NOT STARTED | — | — | — |
| 070 | Phase 1 | Verify initial sync failure state. | NOT STARTED | — | — | — |
| 071 | Phase 1 | Verify initial sync retry resumes safely. | NOT STARTED | — | — | — |
| 072 | Phase 1 | Verify Shopify API throttling handling. | NOT STARTED | — | — | — |
| 073 | Phase 1 | Verify stale synchronization detection. | NOT STARTED | — | — | — |
| 074 | Phase 1 | Verify repeated sync does not duplicate orders. | NOT STARTED | — | — | — |
| 075 | Phase 1 | Verify repeated sync does not duplicate checkouts. | NOT STARTED | — | — | — |
| 076 | Phase 1 | Verify sync preserves known checkout product details. | NOT STARTED | — | — | — |
| 077 | Phase 1 | Verify order cancellation updates metrics. | NOT STARTED | — | — | — |
| 078 | Phase 1 | Verify refund handling in revenue totals. | NOT STARTED | — | — | — |
| 079 | Phase 1 | Verify currency preservation. | NOT STARTED | — | — | — |
| 080 | Phase 1 | Verify missing data is marked unavailable. | NOT STARTED | — | — | — |
| 081 | Phase 1 | Verify Shopify disconnection stops ingestion. | NOT STARTED | — | — | — |
| 082 | Phase 1 | Test merchant A cannot read merchant B orders. | NOT STARTED | — | — | — |
| 083 | Phase 1 | Test merchant A cannot read merchant B checkouts. | NOT STARTED | — | — | — |
| 084 | Phase 1 | Test merchant A cannot read merchant B integration status. | NOT STARTED | — | — | — |
| 085 | Phase 1 | Test merchant A cannot trigger merchant B sync. | NOT STARTED | — | — | — |
| 086 | Phase 1 | Test organization membership authorization. | NOT STARTED | — | — | — |
| 087 | Phase 1 | Test authenticated API access. | NOT STARTED | — | — | — |
| 088 | Phase 1 | Test invalid access token handling. | NOT STARTED | — | — | — |
| 089 | Phase 1 | Verify secrets are absent from logs. | NOT STARTED | — | — | — |
| 090 | Phase 1 | Verify customer PII is redacted in logs. | NOT STARTED | — | — | — |
| 091 | Phase 1 | Verify backend API rate limits. | NOT STARTED | — | — | — |
| 092 | Phase 1 | Verify Shopify webhook request body authenticity. | NOT STARTED | — | — | — |
| 093 | Phase 1 | Verify background jobs scope queries by store. | NOT STARTED | — | — | — |
| 094 | Phase 1 | Verify database uniqueness constraints. | NOT STARTED | — | — | — |
| 095 | Phase 1 | Verify critical query indexes. | NOT STARTED | — | — | — |
| 096 | Phase 1 | Verify backend error response consistency. | NOT STARTED | — | — | — |
| 097 | Phase 1 | Verify background job retry bounds. | NOT STARTED | — | — | — |
| 098 | Phase 1 | Verify operational logging correlation IDs. | NOT STARTED | — | — | — |
| 099 | Phase 1 | Verify database migration safety. | NOT STARTED | — | — | — |
| 100 | Phase 1 | Run backend test suite. | NOT STARTED | — | — | — |
| 101 | Phase 1 | Run backend build and lint. | NOT STARTED | — | — | — |
| 102 | Phase 1 | Verify Render backend deployment health. | NOT STARTED | — | — | — |
| 103 | Phase 2 | Inventory business-state generation entrypoints. | NOT STARTED | — | — | — |
| 104 | Phase 2 | Define business-state snapshot contract. | NOT STARTED | — | — | — |
| 105 | Phase 2 | Verify snapshot is scoped to store. | NOT STARTED | — | — | — |
| 106 | Phase 2 | Verify snapshot freshness timestamp. | NOT STARTED | — | — | — |
| 107 | Phase 2 | Verify snapshot completeness indicators. | NOT STARTED | — | — | — |
| 108 | Phase 2 | Verify revenue total calculation. | NOT STARTED | — | — | — |
| 109 | Phase 2 | Verify order count calculation. | NOT STARTED | — | — | — |
| 110 | Phase 2 | Verify period boundary handling. | NOT STARTED | — | — | — |
| 111 | Phase 2 | Verify merchant timezone handling. | NOT STARTED | — | — | — |
| 112 | Phase 2 | Verify currency separation. | NOT STARTED | — | — | — |
| 113 | Phase 2 | Verify refunded revenue treatment. | NOT STARTED | — | — | — |
| 114 | Phase 2 | Verify cancelled order treatment. | NOT STARTED | — | — | — |
| 115 | Phase 2 | Verify checkout pending count. | NOT STARTED | — | — | — |
| 116 | Phase 2 | Verify abandoned checkout count. | NOT STARTED | — | — | — |
| 117 | Phase 2 | Verify completed checkout count. | NOT STARTED | — | — | — |
| 118 | Phase 2 | Verify checkout value calculation. | NOT STARTED | — | — | — |
| 119 | Phase 2 | Verify checkout/order deduplication in aggregates. | NOT STARTED | — | — | — |
| 120 | Phase 2 | Verify integration health calculation. | NOT STARTED | — | — | — |
| 121 | Phase 2 | Verify product availability data source. | NOT STARTED | — | — | — |
| 122 | Phase 2 | Represent missing product availability as unknown. | NOT STARTED | — | — | — |
| 123 | Phase 2 | Represent insufficient history explicitly. | NOT STARTED | — | — | — |
| 124 | Phase 2 | Represent partial sync explicitly. | NOT STARTED | — | — | — |
| 125 | Phase 2 | Persist evidence provenance. | NOT STARTED | — | — | — |
| 126 | Phase 2 | Persist evidence calculation window. | NOT STARTED | — | — | — |
| 127 | Phase 2 | Test zero-order store state. | NOT STARTED | — | — | — |
| 128 | Phase 2 | Test partially synced store state. | NOT STARTED | — | — | — |
| 129 | Phase 2 | Test multi-currency store state. | NOT STARTED | — | — | — |
| 130 | Phase 2 | Test data freshness degradation. | NOT STARTED | — | — | — |
| 131 | Phase 2 | Define revenue change detection threshold. | NOT STARTED | — | — | — |
| 132 | Phase 2 | Test revenue decline detection. | NOT STARTED | — | — | — |
| 133 | Phase 2 | Test revenue increase detection. | NOT STARTED | — | — | — |
| 134 | Phase 2 | Test revenue fluctuation baseline. | NOT STARTED | — | — | — |
| 135 | Phase 2 | Suppress revenue anomaly with insufficient history. | NOT STARTED | — | — | — |
| 136 | Phase 2 | Define checkout abandonment change detector. | NOT STARTED | — | — | — |
| 137 | Phase 2 | Test abandonment increase detector. | NOT STARTED | — | — | — |
| 138 | Phase 2 | Test abandonment decrease detector. | NOT STARTED | — | — | — |
| 139 | Phase 2 | Test pending checkouts excluded from abandonment. | NOT STARTED | — | — | — |
| 140 | Phase 2 | Test completed checkouts excluded from abandonment. | NOT STARTED | — | — | — |
| 141 | Phase 2 | Define integration failure detector. | NOT STARTED | — | — | — |
| 142 | Phase 2 | Test missing webhook detector. | NOT STARTED | — | — | — |
| 143 | Phase 2 | Test stale synchronization detector. | NOT STARTED | — | — | — |
| 144 | Phase 2 | Test unavailable data detector. | NOT STARTED | — | — | — |
| 145 | Phase 2 | Define order-volume change detector. | NOT STARTED | — | — | — |
| 146 | Phase 2 | Test order-volume decline detector. | NOT STARTED | — | — | — |
| 147 | Phase 2 | Test order-volume increase detector. | NOT STARTED | — | — | — |
| 148 | Phase 2 | Define product availability signal where supported. | NOT STARTED | — | — | — |
| 149 | Phase 2 | Test out-of-stock signal with verified inventory. | NOT STARTED | — | — | — |
| 150 | Phase 2 | Avoid claims about unavailable inventory. | NOT STARTED | — | — | — |
| 151 | Phase 2 | Deduplicate repeated findings. | NOT STARTED | — | — | — |
| 152 | Phase 2 | Expire findings when evidence no longer supports them. | NOT STARTED | — | — | — |
| 153 | Phase 2 | Define finding evidence contract. | NOT STARTED | — | — | — |
| 154 | Phase 2 | Attach supporting calculation to finding. | NOT STARTED | — | — | — |
| 155 | Phase 2 | Attach time window to finding. | NOT STARTED | — | — | — |
| 156 | Phase 2 | Attach evidence freshness to finding. | NOT STARTED | — | — | — |
| 157 | Phase 2 | Attach known limitations to finding. | NOT STARTED | — | — | — |
| 158 | Phase 2 | Distinguish observed correlation from cause. | NOT STARTED | — | — | — |
| 159 | Phase 2 | Prevent unsupported shipping-friction diagnosis. | NOT STARTED | — | — | — |
| 160 | Phase 2 | Prevent unsupported payment-friction diagnosis. | NOT STARTED | — | — | — |
| 161 | Phase 2 | Define potential-impact scoring inputs. | NOT STARTED | — | — | — |
| 162 | Phase 2 | Define urgency scoring inputs. | NOT STARTED | — | — | — |
| 163 | Phase 2 | Define evidence-strength scoring inputs. | NOT STARTED | — | — | — |
| 164 | Phase 2 | Define actionability scoring inputs. | NOT STARTED | — | — | — |
| 165 | Phase 2 | Define business-relevance scoring inputs. | NOT STARTED | — | — | — |
| 166 | Phase 2 | Implement deterministic priority ordering. | NOT STARTED | — | — | — |
| 167 | Phase 2 | Test urgent integration failure priority. | NOT STARTED | — | — | — |
| 168 | Phase 2 | Test uncertain high-value checkout priority. | NOT STARTED | — | — | — |
| 169 | Phase 2 | Test low-impact fluctuation priority. | NOT STARTED | — | — | — |
| 170 | Phase 2 | Ensure weak evidence lowers priority. | NOT STARTED | — | — | — |
| 171 | Phase 2 | Generate one highest-priority finding. | NOT STARTED | — | — | — |
| 172 | Phase 2 | Generate concise operational briefing. | NOT STARTED | — | — | — |
| 173 | Phase 2 | Generate recommended investigation step. | NOT STARTED | — | — | — |
| 174 | Phase 2 | Persist finding lifecycle status. | NOT STARTED | — | — | — |
| 175 | Phase 2 | Test finding resolution after data correction. | NOT STARTED | — | — | — |
| 176 | Phase 2 | Test finding changes between snapshots. | NOT STARTED | — | — | — |
| 177 | Phase 2 | Expose evidence-backed findings API. | NOT STARTED | — | — | — |
| 178 | Phase 2 | Expose business-health summary API. | NOT STARTED | — | — | — |
| 179 | Phase 2 | Expose operational activity API. | NOT STARTED | — | — | — |
| 180 | Phase 2 | Add business-state regression tests. | NOT STARTED | — | — | — |
| 181 | Phase 3 | Map existing Rev request flow. | NOT STARTED | — | — | — |
| 182 | Phase 3 | Verify Rev authentication. | NOT STARTED | — | — | — |
| 183 | Phase 3 | Verify organization and store authorization. | NOT STARTED | — | — | — |
| 184 | Phase 3 | Verify conversation creation. | NOT STARTED | — | — | — |
| 185 | Phase 3 | Verify conversation listing. | NOT STARTED | — | — | — |
| 186 | Phase 3 | Verify conversation loading. | NOT STARTED | — | — | — |
| 187 | Phase 3 | Verify conversation switching. | NOT STARTED | — | — | — |
| 188 | Phase 3 | Verify conversation history persistence. | NOT STARTED | — | — | — |
| 189 | Phase 3 | Verify follow-up question context. | NOT STARTED | — | — | — |
| 190 | Phase 3 | Verify conversation deletion or archive behavior if supported. | NOT STARTED | — | — | — |
| 191 | Phase 3 | Verify retry behavior after AI timeout. | NOT STARTED | — | — | — |
| 192 | Phase 3 | Verify request cancellation behavior. | NOT STARTED | — | — | — |
| 193 | Phase 3 | Verify loading state API contract. | NOT STARTED | — | — | — |
| 194 | Phase 3 | Verify AI error classification. | NOT STARTED | — | — | — |
| 195 | Phase 3 | Verify request rate limiting. | NOT STARTED | — | — | — |
| 196 | Phase 3 | Verify tenant-isolated conversation retrieval. | NOT STARTED | — | — | — |
| 197 | Phase 3 | Define Rev evidence retrieval contract. | NOT STARTED | — | — | — |
| 198 | Phase 3 | Verify revenue evidence retrieval. | NOT STARTED | — | — | — |
| 199 | Phase 3 | Verify order evidence retrieval. | NOT STARTED | — | — | — |
| 200 | Phase 3 | Verify checkout evidence retrieval. | NOT STARTED | — | — | — |
| 201 | Phase 3 | Verify integration evidence retrieval. | NOT STARTED | — | — | — |
| 202 | Phase 3 | Verify finding evidence retrieval. | NOT STARTED | — | — | — |
| 203 | Phase 3 | Verify product evidence retrieval where available. | NOT STARTED | — | — | — |
| 204 | Phase 3 | Verify relative date interpretation. | NOT STARTED | — | — | — |
| 205 | Phase 3 | Verify comparison period calculation. | NOT STARTED | — | — | — |
| 206 | Phase 3 | Verify merchant timezone interpretation. | NOT STARTED | — | — | — |
| 207 | Phase 3 | Verify currency-aware response calculation. | NOT STARTED | — | — | — |
| 208 | Phase 3 | Verify zero-value evidence handling. | NOT STARTED | — | — | — |
| 209 | Phase 3 | Verify incomplete evidence fallback. | NOT STARTED | — | — | — |
| 210 | Phase 3 | Verify stale evidence warning. | NOT STARTED | — | — | — |
| 211 | Phase 3 | Verify contradictory evidence handling. | NOT STARTED | — | — | — |
| 212 | Phase 3 | Label verified facts in reasoning output. | NOT STARTED | — | — | — |
| 213 | Phase 3 | Label calculated findings in reasoning output. | NOT STARTED | — | — | — |
| 214 | Phase 3 | Label hypotheses in reasoning output. | NOT STARTED | — | — | — |
| 215 | Phase 3 | Label unknowns in reasoning output. | NOT STARTED | — | — | — |
| 216 | Phase 3 | Prevent fabricated numeric claims. | NOT STARTED | — | — | — |
| 217 | Phase 3 | Prevent fabricated causal explanations. | NOT STARTED | — | — | — |
| 218 | Phase 3 | Prevent fabricated merchant actions. | NOT STARTED | — | — | — |
| 219 | Phase 3 | Prevent unsupported recoverable-revenue claims. | NOT STARTED | — | — | — |
| 220 | Phase 3 | Verify evidence citations or references. | NOT STARTED | — | — | — |
| 221 | Phase 3 | Test revenue drop investigation. | NOT STARTED | — | — | — |
| 222 | Phase 3 | Test checkout abandonment investigation. | NOT STARTED | — | — | — |
| 223 | Phase 3 | Test priority recommendation question. | NOT STARTED | — | — | — |
| 224 | Phase 3 | Test integration failure investigation. | NOT STARTED | — | — | — |
| 225 | Phase 3 | Test insufficient history question. | NOT STARTED | — | — | — |
| 226 | Phase 3 | Test unsupported question response. | NOT STARTED | — | — | — |
| 227 | Phase 3 | Map revenue intelligence specialist. | NOT STARTED | — | — | — |
| 228 | Phase 3 | Map retention intelligence specialist. | NOT STARTED | — | — | — |
| 229 | Phase 3 | Map operational intelligence specialist. | NOT STARTED | — | — | — |
| 230 | Phase 3 | Verify orchestration routes revenue question. | NOT STARTED | — | — | — |
| 231 | Phase 3 | Verify orchestration routes checkout question. | NOT STARTED | — | — | — |
| 232 | Phase 3 | Verify orchestration routes integration question. | NOT STARTED | — | — | — |
| 233 | Phase 3 | Verify mixed-domain question coordination. | NOT STARTED | — | — | — |
| 234 | Phase 3 | Ensure one coherent Rev response. | NOT STARTED | — | — | — |
| 235 | Phase 3 | Verify situation section when appropriate. | NOT STARTED | — | — | — |
| 236 | Phase 3 | Verify insight section when appropriate. | NOT STARTED | — | — | — |
| 237 | Phase 3 | Verify implication section when appropriate. | NOT STARTED | — | — | — |
| 238 | Phase 3 | Verify recommendation section when appropriate. | NOT STARTED | — | — | — |
| 239 | Phase 3 | Verify confidence explanation. | NOT STARTED | — | — | — |
| 240 | Phase 3 | Avoid forced template for simple questions. | NOT STARTED | — | — | — |
| 241 | Phase 3 | Verify recommendations are merchant-executable. | NOT STARTED | — | — | — |
| 242 | Phase 3 | Verify recommendations do not execute changes. | NOT STARTED | — | — | — |
| 243 | Phase 3 | Verify context from selected Command Center finding. | NOT STARTED | — | — | — |
| 244 | Phase 3 | Verify follow-up maintains finding context. | NOT STARTED | — | — | — |
| 245 | Phase 3 | Verify responses remain useful without sufficient data. | NOT STARTED | — | — | — |
| 246 | Phase 3 | Test AI service timeout fallback. | NOT STARTED | — | — | — |
| 247 | Phase 3 | Test AI service malformed output fallback. | NOT STARTED | — | — | — |
| 248 | Phase 3 | Test repeated question consistency. | NOT STARTED | — | — | — |
| 249 | Phase 3 | Test long conversation context limits. | NOT STARTED | — | — | — |
| 250 | Phase 3 | Test response privacy safeguards. | NOT STARTED | — | — | — |
| 251 | Phase 3 | Run Rev intelligence regression suite. | NOT STARTED | — | — | — |
| 252 | Phase 4 | Audit integration screen against MVP states. | NOT STARTED | — | — | — |
| 253 | Phase 4 | Show connected state from backend. | NOT STARTED | — | — | — |
| 254 | Phase 4 | Show synchronizing state from backend. | NOT STARTED | — | — | — |
| 255 | Phase 4 | Show limited-access state from backend. | NOT STARTED | — | — | — |
| 256 | Phase 4 | Show needs-attention state from backend. | NOT STARTED | — | — | — |
| 257 | Phase 4 | Show disconnected state from backend. | NOT STARTED | — | — | — |
| 258 | Phase 4 | Show actual webhook status. | NOT STARTED | — | — | — |
| 259 | Phase 4 | Show actual initial sync status. | NOT STARTED | — | — | — |
| 260 | Phase 4 | Show sync error reason safely. | NOT STARTED | — | — | — |
| 261 | Phase 4 | Verify reconnect action. | NOT STARTED | — | — | — |
| 262 | Phase 4 | Verify retry sync action. | NOT STARTED | — | — | — |
| 263 | Phase 4 | Verify mobile integration layout. | NOT STARTED | — | — | — |
| 264 | Phase 4 | Verify no fabricated progress percentages. | NOT STARTED | — | — | — |
| 265 | Phase 4 | Audit Command Center component hierarchy. | NOT STARTED | — | — | — |
| 266 | Phase 4 | Place operational briefing first. | NOT STARTED | — | — | — |
| 267 | Phase 4 | Bind briefing to real business-state API. | NOT STARTED | — | — | — |
| 268 | Phase 4 | Show briefing freshness. | NOT STARTED | — | — | — |
| 269 | Phase 4 | Show briefing unknown-data state. | NOT STARTED | — | — | — |
| 270 | Phase 4 | Show top priority finding. | NOT STARTED | — | — | — |
| 271 | Phase 4 | Show finding evidence. | NOT STARTED | — | — | — |
| 272 | Phase 4 | Show finding confidence. | NOT STARTED | — | — | — |
| 273 | Phase 4 | Show finding limitations. | NOT STARTED | — | — | — |
| 274 | Phase 4 | Show recommended next step. | NOT STARTED | — | — | — |
| 275 | Phase 4 | Show revenue health indicator. | NOT STARTED | — | — | — |
| 276 | Phase 4 | Show orders health indicator. | NOT STARTED | — | — | — |
| 277 | Phase 4 | Show checkout health indicator. | NOT STARTED | — | — | — |
| 278 | Phase 4 | Show product availability only when supported. | NOT STARTED | — | — | — |
| 279 | Phase 4 | Show integration health indicator. | NOT STARTED | — | — | — |
| 280 | Phase 4 | Show meaningful operational activity. | NOT STARTED | — | — | — |
| 281 | Phase 4 | Remove mock business metrics. | NOT STARTED | — | — | — |
| 282 | Phase 4 | Remove duplicate analytics-heavy components. | NOT STARTED | — | — | — |
| 283 | Phase 4 | Verify featured intelligence visual prominence. | NOT STARTED | — | — | — |
| 284 | Phase 4 | Verify dark sidebar and light workspace. | NOT STARTED | — | — | — |
| 285 | Phase 4 | Verify brand accent consistency. | NOT STARTED | — | — | — |
| 286 | Phase 4 | Verify desktop layout. | NOT STARTED | — | — | — |
| 287 | Phase 4 | Verify tablet layout. | NOT STARTED | — | — | — |
| 288 | Phase 4 | Verify mobile layout. | NOT STARTED | — | — | — |
| 289 | Phase 4 | Verify loading skeletons. | NOT STARTED | — | — | — |
| 290 | Phase 4 | Verify API error state. | NOT STARTED | — | — | — |
| 291 | Phase 4 | Verify empty store state. | NOT STARTED | — | — | — |
| 292 | Phase 4 | Verify partial sync state. | NOT STARTED | — | — | — |
| 293 | Phase 4 | Verify no findings state. | NOT STARTED | — | — | — |
| 294 | Phase 4 | Verify contextual investigate action. | NOT STARTED | — | — | — |
| 295 | Phase 4 | Verify new conversation control. | NOT STARTED | — | — | — |
| 296 | Phase 4 | Verify conversation history list. | NOT STARTED | — | — | — |
| 297 | Phase 4 | Verify conversation switching. | NOT STARTED | — | — | — |
| 298 | Phase 4 | Verify conversation title display. | NOT STARTED | — | — | — |
| 299 | Phase 4 | Verify question input behavior. | NOT STARTED | — | — | — |
| 300 | Phase 4 | Verify send and disabled states. | NOT STARTED | — | — | — |
| 301 | Phase 4 | Verify investigation loading state. | NOT STARTED | — | — | — |
| 302 | Phase 4 | Verify readable structured responses. | NOT STARTED | — | — | — |
| 303 | Phase 4 | Verify simple answer formatting. | NOT STARTED | — | — | — |
| 304 | Phase 4 | Verify evidence and uncertainty display. | NOT STARTED | — | — | — |
| 305 | Phase 4 | Verify conversation error state. | NOT STARTED | — | — | — |
| 306 | Phase 4 | Verify retry control. | NOT STARTED | — | — | — |
| 307 | Phase 4 | Verify context from Command Center. | NOT STARTED | — | — | — |
| 308 | Phase 4 | Verify mobile conversation layout. | NOT STARTED | — | — | — |
| 309 | Phase 4 | Verify desktop conversation layout. | NOT STARTED | — | — | — |
| 310 | Phase 4 | Verify accessible keyboard interaction. | NOT STARTED | — | — | — |
| 311 | Phase 4 | Verify accessible status announcements. | NOT STARTED | — | — | — |
| 312 | Phase 4 | Verify first-time onboarding route. | NOT STARTED | — | — | — |
| 313 | Phase 4 | Verify Shopify authorization return route. | NOT STARTED | — | — | — |
| 314 | Phase 4 | Verify first briefing entry route. | NOT STARTED | — | — | — |
| 315 | Phase 4 | Verify finding-to-Rev navigation. | NOT STARTED | — | — | — |
| 316 | Phase 4 | Verify conversation return to Command Center. | NOT STARTED | — | — | — |
| 317 | Phase 4 | Verify design consistency across three workspaces. | NOT STARTED | — | — | — |
| 318 | Phase 4 | Verify error copy uses plain language. | NOT STARTED | — | — | — |
| 319 | Phase 4 | Verify responsive navigation. | NOT STARTED | — | — | — |
| 320 | Phase 4 | Verify accessibility focus indicators. | NOT STARTED | — | — | — |
| 321 | Phase 4 | Verify contrast for key text. | NOT STARTED | — | — | — |
| 322 | Phase 4 | Verify production API endpoints wired. | NOT STARTED | — | — | — |
| 323 | Phase 4 | Run frontend auth regression tests. | NOT STARTED | — | — | — |
| 324 | Phase 4 | Run frontend build. | NOT STARTED | — | — | — |
| 325 | Phase 4 | Verify production deployment after quota clears. | NOT STARTED | — | — | — |
| 326 | Phase 5 | Create fresh controlled merchant test account. | NOT STARTED | — | — | — |
| 327 | Phase 5 | Verify email sign-in journey. | NOT STARTED | — | — | — |
| 328 | Phase 5 | Verify available social sign-in journey. | NOT STARTED | — | — | — |
| 329 | Phase 5 | Connect fresh Shopify test store. | NOT STARTED | — | — | — |
| 330 | Phase 5 | Verify OAuth return to Revluma. | NOT STARTED | — | — | — |
| 331 | Phase 5 | Verify initial synchronization starts. | NOT STARTED | — | — | — |
| 332 | Phase 5 | Verify synchronization completion state. | NOT STARTED | — | — | — |
| 333 | Phase 5 | Verify initial briefing displays. | NOT STARTED | — | — | — |
| 334 | Phase 5 | Verify first priority finding. | NOT STARTED | — | — | — |
| 335 | Phase 5 | Open finding in Rev. | NOT STARTED | — | — | — |
| 336 | Phase 5 | Ask revenue comparison question. | NOT STARTED | — | — | — |
| 337 | Phase 5 | Ask checkout question. | NOT STARTED | — | — | — |
| 338 | Phase 5 | Ask operational priority question. | NOT STARTED | — | — | — |
| 339 | Phase 5 | Verify follow-up conversation context. | NOT STARTED | — | — | — |
| 340 | Phase 5 | Return to Command Center. | NOT STARTED | — | — | — |
| 341 | Phase 5 | Verify updated business state after new order. | NOT STARTED | — | — | — |
| 342 | Phase 5 | Verify updated state after checkout abandonment. | NOT STARTED | — | — | — |
| 343 | Phase 5 | Verify updated state after completed purchase. | NOT STARTED | — | — | — |
| 344 | Phase 5 | Verify delayed event does not reopen purchase. | NOT STARTED | — | — | — |
| 345 | Phase 5 | Verify no invented figures in displayed intelligence. | NOT STARTED | — | — | — |
| 346 | Phase 5 | Test duplicate Shopify webhook in staging. | NOT STARTED | — | — | — |
| 347 | Phase 5 | Test delayed Shopify webhook in staging. | NOT STARTED | — | — | — |
| 348 | Phase 5 | Test out-of-order Shopify webhook in staging. | NOT STARTED | — | — | — |
| 349 | Phase 5 | Test temporary Shopify API failure. | NOT STARTED | — | — | — |
| 350 | Phase 5 | Test Shopify rate-limit response. | NOT STARTED | — | — | — |
| 351 | Phase 5 | Test interrupted initial sync. | NOT STARTED | — | — | — |
| 352 | Phase 5 | Test resumed initial sync. | NOT STARTED | — | — | — |
| 353 | Phase 5 | Test revoked Shopify authorization. | NOT STARTED | — | — | — |
| 354 | Phase 5 | Test Shopify uninstall event. | NOT STARTED | — | — | — |
| 355 | Phase 5 | Test Render backend restart. | NOT STARTED | — | — | — |
| 356 | Phase 5 | Test AI service timeout. | NOT STARTED | — | — | — |
| 357 | Phase 5 | Test database temporary error behavior. | NOT STARTED | — | — | — |
| 358 | Phase 5 | Test merchant-to-merchant API isolation. | NOT STARTED | — | — | — |
| 359 | Phase 5 | Test merchant-to-merchant Rev isolation. | NOT STARTED | — | — | — |
| 360 | Phase 5 | Test customer PII not exposed. | NOT STARTED | — | — | — |
| 361 | Phase 5 | Test no autonomous store mutation. | NOT STARTED | — | — | — |
| 362 | Phase 5 | Test no automated recovery messages. | NOT STARTED | — | — | — |
| 363 | Phase 5 | Review application secrets exposure. | NOT STARTED | — | — | — |
| 364 | Phase 5 | Review production logs for sensitive values. | NOT STARTED | — | — | — |
| 365 | Phase 5 | Verify database migration status. | NOT STARTED | — | — | — |
| 366 | Phase 5 | Verify production backend revision. | NOT STARTED | — | — | — |
| 367 | Phase 5 | Verify production frontend revision. | NOT STARTED | — | — | — |
| 368 | Phase 5 | Verify production error monitoring. | NOT STARTED | — | — | — |
| 369 | Phase 5 | Record launch-blocking defects. | NOT STARTED | — | — | — |
| 370 | Phase 5 | Resolve each launch-blocking defect. | NOT STARTED | — | — | — |
| 371 | Phase 5 | Run full regression suite. | NOT STARTED | — | — | — |
| 372 | Phase 5 | Sign off MVP acceptance checklist. | NOT STARTED | — | — | — |
| 373 | Phase 6 | Define controlled beta participant criteria. | NOT STARTED | — | — | — |
| 374 | Phase 6 | Define beta enrollment cap. | NOT STARTED | — | — | — |
| 375 | Phase 6 | Write concise MVP product description. | NOT STARTED | — | — | — |
| 376 | Phase 6 | Write beta onboarding instructions. | NOT STARTED | — | — | — |
| 377 | Phase 6 | Write Shopify permission explanation. | NOT STARTED | — | — | — |
| 378 | Phase 6 | Write known limitations notice. | NOT STARTED | — | — | — |
| 379 | Phase 6 | Write merchant support contact process. | NOT STARTED | — | — | — |
| 380 | Phase 6 | Write issue reporting form. | NOT STARTED | — | — | — |
| 381 | Phase 6 | Prepare merchant feedback questions. | NOT STARTED | — | — | — |
| 382 | Phase 6 | Prepare merchant privacy and data handling review. | NOT STARTED | — | — | — |
| 383 | Phase 6 | Verify beta access invitation process. | NOT STARTED | — | — | — |
| 384 | Phase 6 | Verify beta onboarding support process. | NOT STARTED | — | — | — |
| 385 | Phase 6 | Verify uptime and error escalation process. | NOT STARTED | — | — | — |
| 386 | Phase 6 | Verify beta launch rollback plan. | NOT STARTED | — | — | — |
| 387 | Phase 6 | Invite first Shopify merchant. | NOT STARTED | — | — | — |
| 388 | Phase 6 | Observe first merchant onboarding. | NOT STARTED | — | — | — |
| 389 | Phase 6 | Record first merchant first-briefing outcome. | NOT STARTED | — | — | — |
| 390 | Phase 6 | Record first merchant Rev investigation outcome. | NOT STARTED | — | — | — |
| 391 | Phase 6 | Ask first merchant usefulness feedback. | NOT STARTED | — | — | — |
| 392 | Phase 6 | Record first merchant confusing experience. | NOT STARTED | — | — | — |
| 393 | Phase 6 | Fix first verified launch-blocking issue. | NOT STARTED | — | — | — |
| 394 | Phase 6 | Invite second merchant. | NOT STARTED | — | — | — |
| 395 | Phase 6 | Measure successful store connection rate. | NOT STARTED | — | — | — |
| 396 | Phase 6 | Measure time to first useful briefing. | NOT STARTED | — | — | — |
| 397 | Phase 6 | Measure finding investigation engagement. | NOT STARTED | — | — | — |
| 398 | Phase 6 | Measure Rev conversation usefulness feedback. | NOT STARTED | — | — | — |
| 399 | Phase 6 | Measure returning merchant engagement. | NOT STARTED | — | — | — |
| 400 | Phase 6 | Review false-positive findings. | NOT STARTED | — | — | — |
| 401 | Phase 6 | Review unhelpful recommendations. | NOT STARTED | — | — | — |
| 402 | Phase 6 | Review unresolved data reliability incidents. | NOT STARTED | — | — | — |
| 403 | Phase 6 | Prioritize beta feedback against MVP scope. | NOT STARTED | — | — | — |
| 404 | Phase 6 | Publish beta reliability status. | NOT STARTED | — | — | — |
| 405 | Phase 6 | Review beta launch success criteria. | NOT STARTED | — | — | — |
| 406 | Phase 6 | Decide broader rollout readiness. | NOT STARTED | — | — | — |

## Prior report provenance

- TASK-008: recovered Revluma_Task_008_Execution_Report.md; native file libfile_708cc7ce20b081919af9530741f6e147; original PARTIAL.
- TASK-009: recovered Revluma_Task_009_Execution_Report.md; native file libfile_26d73cd249e48191ad721d37f4c97aca; original PARTIAL.
- Imported report bodies are byte-for-byte copies; current audit does not silently revise them. Task 009 adds connected schema evidence beyond Task 008 limitations.
- TASK-001–007: no completed reports recovered from inspected repository/targeted Library searches. No empty reports created or investigations repeated.

## Findings register

All original evidence remains at the linked report/source register. UNDER INVESTIGATION preserves historical source-supported risk without claiming a live reproduction or approving a fix. Similar findings in 008 and 009 remain separately traceable rather than silently merged. Resolution task numbers are from backlog.md. No finding is RESOLVED — VERIFIED.

| Finding ID | Discovered In | Severity | Description | Affected Component | Resolution Task | Status |
|---|---|---|---|---|---|---|
| REV-FIND-0001 | [008 F01](diagnostics/TASK-008.md#n-findings-and-risks) | High | Historical purchase may not resolve an existing abandoned checkout; order-first linkage also absent | Evidence: S1:115–147,184–223 omit checkout IDs; S5:210–255 requires them or coupon fallback | 024–028,041,044–045 | UNDER INVESTIGATION |
| REV-FIND-0002 | [008 F02](diagnostics/TASK-008.md#n-findings-and-risks) | High | Throttling or transient error aborts import; repeated full imports can fail again | Evidence: S6:20–60 single Axios call, no retry/cost handling | 072,097,349–350 | UNDER INVESTIGATION |
| REV-FIND-0003 | [008 F03](diagnostics/TASK-008.md#n-findings-and-risks) | High | Prior last_synced_at can make a failed later import appear complete; no durable failed/partial run | Evidence: S1:414–416,437–459 and storeController.js:84–97 | 069–070,124,259–260 | UNDER INVESTIGATION |
| REV-FIND-0004 | [008 F04](diagnostics/TASK-008.md#n-findings-and-risks) | High | Long run can overlap another after TTL, allowing conflicting import writes | Evidence: S1:330,460–465 fixed 900-second lock; no renewal | 071,073–075,351–352 | UNDER INVESTIGATION |
| REV-FIND-0005 | [008 F05](diagnostics/TASK-008.md#n-findings-and-risks) | High | Older fetched snapshot can overwrite live webhook changes and cancellation status | Evidence: S5:148–185 unconditional order/customer updates; S1 customer updater lacks source timestamp | 034,036,074,077,348 | UNDER INVESTIGATION |
| REV-FIND-0006 | [008 F06](diagnostics/TASK-008.md#n-findings-and-risks) | High | Stale historical checkout items can replace newer webhook items even when cart header was protected | Evidence: S1:270–290 second item transaction; S5:303–304 early stale return | 006,036,076 | UNDER INVESTIGATION |
| REV-FIND-0007 | [008 F07](diagnostics/TASK-008.md#n-findings-and-risks) | High | Existing cancelled source orders not imported locally; imported count can still include them | Evidence: S1:212–216 invokes cancelOrder; S5:265–269 returns if missing | 066,077,080,114 | UNDER INVESTIGATION |
| REV-FIND-0008 | [008 F08](diagnostics/TASK-008.md#n-findings-and-risks) | High | Item history can silently truncate while root sync reports success | Evidence: S1:199–205,257–263 `lineItems(first:250)` without nested pageInfo | 066–067,076,080 | UNDER INVESTIGATION |
| REV-FIND-0009 | [008 F09](diagnostics/TASK-008.md#n-findings-and-risks) | Medium | Failed resource discards fetched progress, restart repeats all work; memory grows with resource size | Evidence: S1:52–69 accumulate resource before write; S15 store fields lack cursor; S4 retry selectors | 069,071,351–352 | UNDER INVESTIGATION |
| REV-FIND-0010 | [008 F10](diagnostics/TASK-008.md#n-findings-and-risks) | Medium | Missing contact data can replace known values; consent time reflects import time | Evidence: S1:94–110 historical customer defaults; S5:148–154 customer updates | 080,089–090 | UNDER INVESTIGATION |
| REV-FIND-0011 | [008 F11](diagnostics/TASK-008.md#n-findings-and-risks) | High | False matching or completion presented as campaign recovery; historical rerun can change recovery_status while retaining link | Evidence: S5:225–239 discount-code fallback;245–253 recovered label | 023,046–047 | UNDER INVESTIGATION |
| REV-FIND-0012 | [008 F12](diagnostics/TASK-008.md#n-findings-and-risks) | Medium | Repeated historical noncompletion snapshots can flip abandoned to pending; unresolved purchases lack reverse repair | Evidence: S5:312 / checkoutInactivity.js:17–21; S4:719–746 | 029–033,044–045,067 | UNDER INVESTIGATION |
| REV-FIND-0013 | [008 F13](diagnostics/TASK-008.md#n-findings-and-risks) | Medium | Product availability cannot be assumed imported/persisted after connection | Evidence: S9 only export/tests; S1 main path has no products stage | 068,121–122,278 | UNDER INVESTIGATION |
| REV-FIND-0014 | [008 F14](diagnostics/TASK-008.md#n-findings-and-risks) | Medium | Two organizations holding the same Shopify domain can create webhook routing ambiguity | Evidence: S15:278 per-organization domain uniqueness; S5:26–34 first domain match | 055,082–086,093–094 | UNDER INVESTIGATION |
| REV-FIND-0015 | [008 F15](diagnostics/TASK-008.md#n-findings-and-risks) | Medium | Global cart uniqueness is not DB-enforced; lock aliases/direct writers not covered | Evidence: S15:342–372 cart nonunique index; S5:296 advisory lock only for cooperating writer | 035–036,075,094 | UNDER INVESTIGATION |
| REV-FIND-0016 | [008 F16](diagnostics/TASK-008.md#n-findings-and-risks) | Medium | Successful sync is not evidence of all capabilities, full history or finished downstream processing | Evidence: S1:415–433 completion before proof/RFM; S1:389–402 customer skip;S1:366–379 webhook optionality | 059,069–070,080,124 | UNDER INVESTIGATION |
| REV-FIND-0017 | [008 F17](diagnostics/TASK-008.md#n-findings-and-risks) | Medium | Troubleshooting overlap/resume is difficult; truncation does not guarantee PII scrubbing | Evidence: S1 logger sites have stages/counts, no persisted run/page identity; S6 error message truncation | 089–090,098,364 | UNDER INVESTIGATION |
| REV-FIND-0018 | [008 F18](diagnostics/TASK-008.md#n-findings-and-risks) | Medium | Unpaid/authorized/refunded states collapse toward completed or adjusted totals; detailed lifecycle evidence unavailable | Evidence: S5:174–185 and S1 orderPayload lack persisted financial/fulfillment source state | 015,047,077–080 | UNDER INVESTIGATION |
| REV-FIND-0019 | [009](diagnostics/TASK-009.md#n-findings-and-risks) | High | Checkout identity only partially protected — PARTIALLY IMPLEMENTED. Concurrent/direct/alias writes can yield duplicate checkout business records despite distinct UUIDs. | Evidence: S1:346,370; DB1 nonunique idx_abandoned_carts_store_external; no matching unique constraint | 035–036,075,094 | UNDER INVESTIGATION |
| REV-FIND-0020 | [009](diagnostics/TASK-009.md#n-findings-and-risks) | High | Same-store referential integrity — POTENTIAL DEFECT. Valid but wrong-store customer/cart/order references can corrupt isolation/metrics. | Evidence: S1:364,410–419,1178–1179; DB1 single-column FKs | 024,082–086,093–094 | UNDER INVESTIGATION |
| REV-FIND-0021 | [009](diagnostics/TASK-009.md#n-findings-and-risks) | High | Many orders can claim one checkout — VERIFIED limitation. Conflicting relationships cannot be rejected at DB level. | Evidence: S1:367,410,416; DB1 nullable nonunique FK | 026–027 | UNDER INVESTIGATION |
| REV-FIND-0022 | [009](diagnostics/TASK-009.md#n-findings-and-risks) | High | Checkout/order proof and unresolved state — PARTIALLY IMPLEMENTED. Null link cannot distinguish unavailable evidence from unresolved processing; coupon inference shares same link. | Evidence: S1 core models lack match method/evidence fields; S2:210–255 | 023–028,048 | UNDER INVESTIGATION |
| REV-FIND-0023 | [009](diagnostics/TASK-009.md#n-findings-and-risks) | High | Lifecycle strings and consistency checks — PARTIALLY IMPLEMENTED. Recovered with no recovery time, abandoned with order, or invalid state is structurally allowed. | Evidence: S1:351–356,407; DB1 no CHECK/trigger | 015,029–030,046–047 | UNDER INVESTIGATION |
| REV-FIND-0024 | [009](diagnostics/TASK-009.md#n-findings-and-risks) | High | Historical order identifiers omitted — POTENTIAL DEFECT. Historical purchase cannot use primary exact checkout/token match. | Evidence: S3:116–145; S2:212–220 | 028,041,044–045 | UNDER INVESTIGATION |
| REV-FIND-0025 | [009](diagnostics/TASK-009.md#n-findings-and-risks) | High | Financial/fulfillment lifecycle evidence — NOT FOUND. Paid/unpaid, refunds and fulfillment cannot be reliably reconstructed from totals/status. | Evidence: S1:396–422 | 015,077–080,113–114 | UNDER INVESTIGATION |
| REV-FIND-0026 | [009](diagnostics/TASK-009.md#n-findings-and-risks) | Medium | Activity/processing timestamps conflated — POTENTIAL DEFECT. Inactivity and historical event ordering depend on overloaded timestamps; actual abandonment time unavailable. | Evidence: S2:245,302–315; S6:719–733; S1:352–356 | 007,029–033,067,076 | UNDER INVESTIGATION |
| REV-FIND-0027 | [009](diagnostics/TASK-009.md#n-findings-and-risks) | High | Missing identifiers accepted as text — POTENTIAL DEFECT. Malformed orders can collide under literal undefined; no blank/noncanonical identity guard. | Evidence: S2:119 String conversion; S1:400 only nonnull unique | 028,041,074,094 | UNDER INVESTIGATION |
| REV-FIND-0028 | [009](diagnostics/TASK-009.md#n-findings-and-risks) | Medium | Numeric payload ID precision boundary — POTENTIAL DEFECT. Unsafe numeric literal can lose precision before text storage; occurrence unverified. | Evidence: S4:52 JSON.parse; S2:119,276 | 013–014,028 | UNDER INVESTIGATION |
| REV-FIND-0029 | [009](diagnostics/TASK-009.md#n-findings-and-risks) | Medium | Line-item context support — VERIFIED; completeness PARTIAL. Parents may have zero lines; source line duplicates/fallback collisions and truncation remain possible. | Evidence: S1:375–390,1164–1184; S2:188–207,320–334; S3 nested first:250 | 066–067,076,080 | UNDER INVESTIGATION |
| REV-FIND-0030 | [009](diagnostics/TASK-009.md#n-findings-and-risks) | High | Stale second checkout-item transaction — POTENTIAL DEFECT. Newer item snapshots can be replaced after stale header protection returned existing cart. | Evidence: S3:273–287; S2:303–304 | 036,076 | UNDER INVESTIGATION |
| REV-FIND-0031 | [009](diagnostics/TASK-009.md#n-findings-and-risks) | Medium | Monetary rounding/missing-data semantics — POTENTIAL DEFECT. Two-decimal scale/Number arithmetic/default 0/USD can misrepresent currency or unknowns. | Evidence: S1 numeric(10,2)/(12,2); S2:121–132,191–203,310–311 | 078–080,108,129 | UNDER INVESTIGATION |
| REV-FIND-0032 | [009](diagnostics/TASK-009.md#n-findings-and-risks) | Medium | Query index coverage — VERIFIED limitation. No dedicated inactivity/store-time/cart-link index; performance unmeasured. | Evidence: DB1 28 index definitions; S6 promotion; S14 store/time orders query | 095 | UNDER INVESTIGATION |
| REV-FIND-0033 | [009](diagnostics/TASK-009.md#n-findings-and-risks) | Medium | Cascade policy — VERIFIED structure. Store deletion erases history, cart deletion removes purchase link; retention suitability needs scoped review. | Evidence: DB1 FK DELETE CASCADE/SET NULL/RESTRICT; S1 relation declarations | 081,094,099 | UNDER INVESTIGATION |
| REV-FIND-0034 | [009](diagnostics/TASK-009.md#n-findings-and-risks) | High | Effective RLS enforcement — IMPLEMENTED — NOT VERIFIED. Backend tenant context/bypass and order_items policy absence could cause either denied operations or reliance on privileged access. | Evidence: DB1 enabled/forced flags/policies; DB3 session setting; S7 no setter | 082–086,093,358 | UNDER INVESTIGATION |
| REV-FIND-0035 | [009](diagnostics/TASK-009.md#n-findings-and-risks) | High | Migration baseline divergence — VERIFIED mismatch. Migration reproducibility/audit cannot be assumed from finished rows. | Evidence: DB2 checksum versus committed SHA-256 in L; UTF-16 artifact | 099,365 | UNDER INVESTIGATION |
| REV-FIND-0036 | [009](diagnostics/TASK-009.md#n-findings-and-risks) | High | Missing creation history for live objects — VERIFIED evidence gap. Clean environment may not recreate current schema/security. | Evidence: DB1 order_items/RLS; encoding-aware committed SQL search | 099,365 | UNDER INVESTIGATION |
| REV-FIND-0037 | [009](diagnostics/TASK-009.md#n-findings-and-risks) | Low | Legacy alternate schema — VERIFIED ambiguity. Tools pointed at obsolete schema could infer wrong enums/keys; no active import found. | Evidence: S8 vs S1/S7 | 009,099 | UNDER INVESTIGATION |
| REV-FIND-0038 | [010](diagnostics/TASK-010.md#p-findings-register) | Critical | No direct persisted checkout/order matching tests. Purchases can be unverified despite green helper tests. | Backend upsertOrder/upsertAbandonedCart | 017–028,049 | OPEN |
| REV-FIND-0039 | [010](diagnostics/TASK-010.md#p-findings-register) | High | No checkout-first/order-first or full completion-override lifecycle tests. Completed purchases and false abandonment lack sequence regression proof. | commerce webhook handlers | 029–033,044–045,049 | OPEN |
| REV-FIND-0040 | [010](diagnostics/TASK-010.md#p-findings-register) | High | Delivery dedup is not business-state idempotency coverage. Replays with new delivery IDs have no row-count/downstream-effect assertions. | claimDelivery versus commerce upserts | 034–035,063–064,074–075 | OPEN |
| REV-FIND-0041 | [010](diagnostics/TASK-010.md#p-findings-register) | High | No concurrency/transaction rollback database harness. Races, uniqueness and rollback correctness remain untested. | PostgreSQL cart/order persistence | 036,049,094,357 | OPEN |
| REV-FIND-0042 | [010](diagnostics/TASK-010.md#p-findings-register) | High | Tenant query-filter tests do not prove cross-store matching rejection. Wrong-store association prevention lacks behavioral proof. | order/cart/customer lookup and writes | 082–086,093–094 | OPEN |
| REV-FIND-0043 | [010](diagnostics/TASK-010.md#p-findings-register) | High | Historical import/webhook reconciliation overlap untested. Older snapshots or repeated imports lack linkage-preservation regression checks. | shopifySync shared commerce handlers | 044–045,066–067,074–076 | OPEN |
| REV-FIND-0044 | [010](diagnostics/TASK-010.md#p-findings-register) | Medium | Threshold helper tests omit promotion job and several time edge cases. Wrong job predicates/timestamp behavior could pass helper tests. | promoteInactiveCheckouts | 007,029,049 | OPEN |
| REV-FIND-0045 | [010](diagnostics/TASK-010.md#p-findings-register) | Medium | CI required checks and deploy gating not verified; runner excludes Backend/tests. Configured test runs do not establish mandatory premerge/predeploy verification. | test runner/workflows | 050,100,371 | OPEN |
| REV-FIND-0046 | [010](diagnostics/TASK-010.md#p-findings-register) | Medium | No realistic full paired commerce fixtures or schema-version replay. Token conflicts, large IDs and order/cart variants lack realistic regression inputs. | reconciliation fixture coverage | 013–014,038–040,049 | OPEN |
| REV-FIND-0047 | [010](diagnostics/TASK-010.md#p-findings-register) | Low | Originally reports 001–007 unavailable; 002–007 recovered on 2026-10-30; Task001 report remains unavailable. | MVP execution history | BACKLOG MAPPING REQUIRED | UNDER INVESTIGATION |

## Initial consolidation and follow-up

Task 010 creates the workflow, decisions and backlog index. The 2026-10-30 follow-up recovers reports 002–007 and authorizes publication to GitHub main. Original reports are imported, not retroactively certified. Future tasks must consult the README protocol and relevant diagnoses, then revalidate current source and behavior. Missing coverage is not a confirmed production defect. Record resolution evidence and append history before changing finding status.

Version control: local documentation-only branch docs/mvp-execution-task-010; commit hash is supplied by delivery/git history. Remote push/PR withheld because automatic preview-deployment suppression was not verified and Task 010 prohibits deployment. No merge or deployment authorized by this register.

## 2026-10-30 — User-supplied report recovery and main publication

The user explicitly instructed that these docs belong in the live GitHub main repository, superseding the earlier local-only publication limitation. Task010 original audit evidence is retained; its dated follow-up records the publication authorization. Reports 002–007 have now been recovered and separated. **Task001 report is still not included in the supplied export**: progress summaries reference it, but no execution report is reconstructed from those references. Earlier missing-report statements above remain historical.

REV-FIND-0047 is now UNDER INVESTIGATION: six of seven missing reports recovered; Task001 remains unavailable. The imported reports below add historical risk entries; duplicate observations retain separate provenance and are not new production incidents.

| Finding ID | Discovered In | Severity | Description | Affected Component / evidence | Resolution Task | Status |
|---|---|---|---|---|---|---|
| REV-FIND-0048 | [002](diagnostics/TASK-002.md) | High | Synchronous webhook processing | Historical report: Slow database or downstream operations may delay Shopify acknowledgments. | 065 | UNDER INVESTIGATION |
| REV-FIND-0049 | [002](diagnostics/TASK-002.md) | Medium | Delivery ID fallback uses a payload hash | Historical report: Distinct deliveries with identical payloads may be treated as duplicates when Shopify's delivery ID is missing. | 063–064 | UNDER INVESTIGATION |
| REV-FIND-0050 | [002](diagnostics/TASK-002.md) | Medium | Topic dispatch uses broad string matching | Historical report: Unexpected topic names could reach a handler if they match a recognized prefix. | 002,062 | UNDER INVESTIGATION |
| REV-FIND-0051 | [002](diagnostics/TASK-002.md) | Low | Unsupported topics receive successful acknowledgment | Historical report: Unexpected subscription or routing errors may go unnoticed without monitoring. | 012,098 | UNDER INVESTIGATION |
| REV-FIND-0052 | [002](diagnostics/TASK-002.md) | Unrated verification gap | Tests not executed | Historical report: Runtime correctness remains to be established through later validation tasks. | 010,100 | UNDER INVESTIGATION |
| REV-FIND-0053 | [003](diagnostics/TASK-003.md) | High | Purchase completion is conflated with recovery attribution | Historical report: Merchants may see misleading recovered-revenue figures | 046–047 | UNDER INVESTIGATION |
| REV-FIND-0054 | [003](diagnostics/TASK-003.md) | High | Missing order IDs become the string "undefined" | Historical report: Malformed payloads could create incorrect order identities | 014,028 | UNDER INVESTIGATION |
| REV-FIND-0055 | [003](diagnostics/TASK-003.md) | High | Payment status is not used to determine order completion | Historical report: Pending or unpaid orders may influence revenue intelligence | 015,108 | UNDER INVESTIGATION |
| REV-FIND-0056 | [003](diagnostics/TASK-003.md) | Medium | Checkout reconciliation depends on identifiers that may not align | Historical report: Completed checkouts may remain classified as abandoned | 017–019,024 | UNDER INVESTIGATION |
| REV-FIND-0057 | [003](diagnostics/TASK-003.md) | Medium | Historical sync does not include checkout identifiers in its normalized order payload | Historical report: Historical orders may not reconcile with their originating checkouts | 028,044–045 | UNDER INVESTIGATION |
| REV-FIND-0058 | [003](diagnostics/TASK-003.md) | Medium | Monetary calculations use floating-point numbers | Historical report: Precision risks exist before database decimal storage | 078–079 | UNDER INVESTIGATION |
| REV-FIND-0059 | [003](diagnostics/TASK-003.md) | Medium | Customer fallback uses an order-derived placeholder | Historical report: Anonymous orders are represented by synthetic customer identities | 037,080 | UNDER INVESTIGATION |
| REV-FIND-0060 | [003](diagnostics/TASK-003.md) | Medium | RFM synchronization executes after transaction commit | Historical report: Order persistence can succeed even if downstream processing fails | 097,098 | UNDER INVESTIGATION |
| REV-FIND-0061 | [004](diagnostics/TASK-004.md) | High | Stale events can overwrite newer order state | Historical report: commerceWebhookService.js:158–186 | 034,348 | UNDER INVESTIGATION |
| REV-FIND-0062 | [004](diagnostics/TASK-004.md) | High | Order updates can overwrite cancellation status | Historical report: commerceWebhookService.js:172–179, 261–273 | 077 | UNDER INVESTIGATION |
| REV-FIND-0063 | [004](diagnostics/TASK-004.md) | High | Checkout completion is conflated with recovery attribution | Historical report: commerceWebhookService.js:242–254 | 046–047 | UNDER INVESTIGATION |
| REV-FIND-0064 | [004](diagnostics/TASK-004.md) | High | Payment status changes are not persisted | Historical report: commerceWebhookService.js:117–186; schema.prisma:396–423 | 015,108 | UNDER INVESTIGATION |
| REV-FIND-0065 | [004](diagnostics/TASK-004.md) | Medium | Missing optional fields can overwrite known values | Historical report: commerceWebhookService.js:128–133, 174–185 | 080 | UNDER INVESTIGATION |
| REV-FIND-0066 | [004](diagnostics/TASK-004.md) | Medium | Removed line items are not explicitly deleted | Historical report: commerceWebhookService.js:188–208 | 076 | UNDER INVESTIGATION |
| REV-FIND-0067 | [004](diagnostics/TASK-004.md) | Medium | Order ID validation is insufficient | Historical report: commerceWebhookService.js:119 | 014,028 | UNDER INVESTIGATION |
| REV-FIND-0068 | [004](diagnostics/TASK-004.md) | Medium | Fulfillment changes are not persisted | Historical report: schema.prisma:396–423 | 015,080 | UNDER INVESTIGATION |
| REV-FIND-0069 | [004](diagnostics/TASK-004.md) | Medium | Order updates lack detailed diagnostic logging | Historical report: commerceWebhookController.js:50–68 | 048,098 | UNDER INVESTIGATION |
| REV-FIND-0070 | [005](diagnostics/TASK-005.md) | High | Checkout identity is not uniquely constrained in PostgreSQL | Historical report: schema.prisma:342–370; Duplicate checkout records | 035–036,075,094 | UNDER INVESTIGATION |
| REV-FIND-0071 | [005](diagnostics/TASK-005.md) | High | Alternative checkout identifiers are not preserved | Historical report: commerceWebhookService.js:275–276; Failed purchase reconciliation | 018–019,028 | UNDER INVESTIGATION |
| REV-FIND-0072 | [005](diagnostics/TASK-005.md) | High | Checkout creation does not reconcile previously received orders | Historical report: commerceWebhookService.js:275–338; Completed checkout may remain unresolved | 031,044–045 | UNDER INVESTIGATION |
| REV-FIND-0073 | [005](diagnostics/TASK-005.md) | High | Missing product details do not prevent checkout persistence | Historical report: commerceWebhookService.js:322–335; Incomplete product intelligence | 076,080 | UNDER INVESTIGATION |
| REV-FIND-0074 | [005](diagnostics/TASK-005.md) | Medium | Missing customer data can clear an existing association | Historical report: commerceWebhookService.js:305–319; Loss of customer context | 037,080 | UNDER INVESTIGATION |
| REV-FIND-0075 | [005](diagnostics/TASK-005.md) | Medium | Stale completed events can overwrite newer checkout details | Historical report: commerceWebhookService.js:302–315; Incorrect operational state | 030,036 | UNDER INVESTIGATION |
| REV-FIND-0076 | [005](diagnostics/TASK-005.md) | Medium | Missing checkout value defaults to zero | Historical report: commerceWebhookService.js:310; Misleading checkout-value metrics | 080 | UNDER INVESTIGATION |
| REV-FIND-0077 | [005](diagnostics/TASK-005.md) | Medium | Missing identifier returns success without persistence | Historical report: commerceWebhookService.js:275–277; Silent ingestion gaps | 041,080 | UNDER INVESTIGATION |
| REV-FIND-0078 | [005](diagnostics/TASK-005.md) | Medium | Historical sync uses a separate product-persistence transaction | Historical report: shopifySync.js:271–291; Partial synchronization | 071,076 | UNDER INVESTIGATION |
| REV-FIND-0079 | [005](diagnostics/TASK-005.md) | Medium | Completion and recovery attribution share the same status | Historical report: checkoutInactivity.js:17–20; Misleading recovery classification | 046–047 | UNDER INVESTIGATION |
| REV-FIND-0080 | [006](diagnostics/TASK-006.md) | High | Alternative checkout identifiers are not reconciled | Historical report: commerceWebhookService.js:275–299; Duplicate checkout records | 018–019,028 | UNDER INVESTIGATION |
| REV-FIND-0081 | [006](diagnostics/TASK-006.md) | High | Explicitly empty product lists cannot clear stored products | Historical report: commerceWebhookService.js:322–335; Incorrect product intelligence | 076 | UNDER INVESTIGATION |
| REV-FIND-0082 | [006](diagnostics/TASK-006.md) | High | Missing checkout totals overwrite existing values with zero | Historical report: commerceWebhookService.js:310; Incorrect checkout metrics | 080 | UNDER INVESTIGATION |
| REV-FIND-0083 | [006](diagnostics/TASK-006.md) | High | Checkout updates cannot reconcile existing orders | Historical report: commerceWebhookService.js:275–338; Unresolved completed purchases | 031,044–045 | UNDER INVESTIGATION |
| REV-FIND-0084 | [006](diagnostics/TASK-006.md) | Medium | Missing customer data can clear an existing association | Historical report: commerceWebhookService.js:305–319; Loss of customer context | 037,080 | UNDER INVESTIGATION |
| REV-FIND-0085 | [006](diagnostics/TASK-006.md) | Medium | Missing currency defaults to USD | Historical report: commerceWebhookService.js:311; Incorrect currency reporting | 079–080 | UNDER INVESTIGATION |
| REV-FIND-0086 | [006](diagnostics/TASK-006.md) | Medium | Stale completed events bypass the early stale-event rejection | Historical report: commerceWebhookService.js:302–315; Older data may overwrite newer values | 030,036 | UNDER INVESTIGATION |
| REV-FIND-0087 | [006](diagnostics/TASK-006.md) | Medium | Missing source timestamps can fall back to receipt time | Historical report: checkoutInactivity.js:5–9; Incorrect abandonment timing | 007,080 | UNDER INVESTIGATION |
| REV-FIND-0088 | [006](diagnostics/TASK-006.md) | Medium | Checkout and order handlers lack a shared checkout lock | Historical report: commerceWebhookService.js:114–338; Potential completion race | 036 | UNDER INVESTIGATION |
| REV-FIND-0089 | [006](diagnostics/TASK-006.md) | Medium | Customer upsert occurs outside checkout transaction | Historical report: commerceWebhookService.js:278–294; Partial persistence | 036,071 | UNDER INVESTIGATION |
| REV-FIND-0090 | [006](diagnostics/TASK-006.md) | Medium | Missing checkout identifier is treated as a no-op | Historical report: commerceWebhookService.js:275–277; Silent ingestion gaps | 041,080 | UNDER INVESTIGATION |
| REV-FIND-0091 | [007](diagnostics/TASK-007.md) | Critical | Classification does not check for an existing completed order | Historical report: schedulerService.js:720–734; Completed purchases may appear abandoned | 029,033 | UNDER INVESTIGATION |
| REV-FIND-0092 | [007](diagnostics/TASK-007.md) | High | Checkout-to-order reconciliation is not guaranteed | Historical report: commerceWebhookService.js:213–255; Incorrect checkout lifecycle | 017–028 | UNDER INVESTIGATION |
| REV-FIND-0093 | [007](diagnostics/TASK-007.md) | High | Dashboard independently classifies overdue pending checkouts | Historical report: dashboardController.js:47–66, 383–409; Metrics may differ from persisted status | 115–119 | UNDER INVESTIGATION |
| REV-FIND-0094 | [007](diagnostics/TASK-007.md) | High | abandoned_at is not actual abandonment time | Historical report: commerceWebhookService.js:313; schedulerService.js:730; Misleading historical reporting | 015,110 | UNDER INVESTIGATION |
| REV-FIND-0095 | [007](diagnostics/TASK-007.md) | High | Duplicate checkout identifiers lack a database uniqueness guarantee | Historical report: schema.prisma:370; Inflated abandonment counts | 035,075,094 | UNDER INVESTIGATION |
| REV-FIND-0096 | [007](diagnostics/TASK-007.md) | Medium | Classification cadence can delay status changes | Historical report: schedulerService.js:64–67, 837–840; Delayed operational visibility | 073,143 | UNDER INVESTIGATION |
| REV-FIND-0097 | [007](diagnostics/TASK-007.md) | Medium | Resource updates are treated as customer activity | Historical report: checkoutInactivity.js:5–9; Inaccurate inactivity interpretation | 007,015 | UNDER INVESTIGATION |
| REV-FIND-0098 | [007](diagnostics/TASK-007.md) | Medium | Historical imports can become immediately eligible | Historical report: shopifySync.js:221–271; Historical count inaccuracies | 067,044–045 | UNDER INVESTIGATION |
| REV-FIND-0099 | [007](diagnostics/TASK-007.md) | Medium | Classification has limited checkout-level diagnostics | Historical report: schedulerService.js:720–734; Difficult production debugging | 048,098 | UNDER INVESTIGATION |
| REV-FIND-0100 | [007](diagnostics/TASK-007.md) | Medium | Redis-unavailable fallback lacks distributed locking | Historical report: schedulerService.js:153–168; Multiple-instance coordination risk | 036,093 | UNDER INVESTIGATION |
| REV-FIND-0101 | [007](diagnostics/TASK-007.md) | Medium | Classification-specific integration tests were not established | Historical report: Existing test inventory; Runtime correctness unverified | 029,036,049 | UNDER INVESTIGATION |

These are imported diagnoses, not freshly reproduced defects. See each report for its source files, inspected SHA and original test-execution limitations. Stable IDs 0001–0047 were retained unchanged except the dated resolution progress for 0047; 0048–0101 index the recovered historical findings.

## Task011 — Shopify API version audit, 2026-10-30

Source resolver defaults to UTC-quarter 2026-10 today; all discovered Admin GraphQL resource consumers share it. OAuth endpoints are unversioned. Follow-up recovered three October26 production resolver logs reporting2026-10. Current deployment was reconfirmed; version/header-filtered logs after its activation returned zero matches. Authorized signed-in Render dashboard inspection now verifies the production service override SHOPIFY_API_VERSION=2026-10, no linked environment groups, and the same live commit. Primary configuration gap closed; audit COMPLETE — VERIFIED. Current process/header and webhook payload-version observation remain open finding0104; audit completion does not certify end-to-end live compatibility. Existing install/version assertion script: one entry passed, zero failed/skipped. No source/API/env/infrastructure change; decisions unchanged. See [TASK-011](diagnostics/TASK-011.md) for exact lines, operation matrix, official support/deprecation evidence and limitations. Task012 not started.

| Finding ID | Discovered In | Severity | Description | Affected Component | Resolution Task | Status |
|---|---|---|---|---|---|---|
| REV-FIND-0102 | [011](diagnostics/TASK-011.md#j-findings-register) | Medium | Calendar-quarter fallback and validator are not provider release/grace-window lookup | utils/shopify.js:3–25 | BACKLOG MAPPING REQUIRED; validation100/349 | OPEN |
| REV-FIND-0103 | [011](diagnostics/TASK-011.md#j-findings-register) | Low | Unused fixed API_VERSION export can diverge from dynamic request resolver | shopifyGraphql.js:5,21,25,54 | BACKLOG MAPPING REQUIRED | OPEN |
| REV-FIND-0104 | [011](diagnostics/TASK-011.md#j-findings-register) | Medium | Served Admin and independent webhook payload API versions not observed | shopifyGraphql.js:20–51; commerceWebhookController.js:16–22 | 012–014,098,364,366 | OPEN |
| REV-FIND-0105 | [011](diagnostics/TASK-011.md#j-findings-register) | Medium | Customer email/phone/emailMarketingConsent/smsMarketingConsent selections are deprecated but present | shopifySync.js:76–78,195,255; official Customer reference | 066–067,080; migration BACKLOG MAPPING REQUIRED | OPEN |
| REV-FIND-0106 | [011](diagnostics/TASK-011.md#j-findings-register) | Medium | No direct shared transport URL/header/version compatibility test found | shopify.install.test.js:19–22,90–95; client/test search | 100; implementation BACKLOG MAPPING REQUIRED | OPEN |

Related existing findings0017,0038,0043,0001,0059,0013 remain unchanged and unresolved; Task011 references rather than duplicates those diagnoses.


Task011 completion review: all section29 audit/documentation criteria satisfied. Prior partial/open entries are superseded by the authorized dashboard evidence in TASK-011 sectionG, not by resolving implementation findings. REV-FIND-0102–0106 remain OPEN. No configuration changes or live Shopify calls were made.


## Task012 — Webhook configuration, stored registration and delivery audit checkpoint

Source, Supabase schema/registration metadata and aggregate delivery ledger, Render deployment/configuration and selected existing tests inspected. Production BACKEND_URL matches the current host; boolean DATABASE_URL project match confirms the connected Revluma database. All9 topics configured and handled in source. Four store rows: A1 provider row, B10, C2, D9;27 synthetic state rows and8 failure rows. D has9succeeded state records and122processed deliveries across6topic types. Current Shopify subscription inventory is UNKNOWN pending developer sign-in; stored IDs do not establish live registration. Secure email-code form rejected the visible control twice; manual authentication handoff required. Task012 remains IN PROGRESS, not complete. Task013 not started. See [TASK-012](diagnostics/TASK-012.md).

Existing finding0014 receives live evidence: two store rows under two organizations share revluma-test-store.myshopify.com; source still routes by first domain match. No misrouted event proved. Existing0048 receives ledger timing evidence: all7order processed intervals exceed5seconds, max22.345; acknowledgment occurs after processing by source. Actual HTTP timeout/delivery outcome unobserved. Existing0040/0042/0049–0051/0104 remain unresolved. No finding is marked resolved by this checkpoint.

| Finding ID | Discovered In | Severity | Description | Evidence at deployed cfb41b7 | Resolution Task | Status |
|---|---|---|---|---|---|---|
| REV-FIND-0107 | [012](diagnostics/TASK-012.md#16-findings-register-and-future-tasks) | Medium | Stored active subscriptions/URLs can remain stale and mask latest setup failure | shopifyWebhookService142–168;storeController48–81;3old-host DBrows | 059–061; cleanup implementation requires scoped assignment | OPEN |
| REV-FIND-0108 | [012](diagnostics/TASK-012.md#16-findings-register-and-future-tasks) | High | Inactive/uninstalled stores remain eligible for webhook processing | commerceWebhookService26–34,360–365 | 057–058,081 | OPEN |
| REV-FIND-0109 | [012](diagnostics/TASK-012.md#16-findings-register-and-future-tasks) | High | Interrupted received delivery cannot be reclaimed; retry may get200 without processing | commerceWebhookService37–54;controller45–46; no current stranded row observed | 063–064; implementation BACKLOG MAPPING REQUIRED | OPEN |
| REV-FIND-0110 | [012](diagnostics/TASK-012.md#16-findings-register-and-future-tasks) | Medium | Customer webhook raw payload enters nested-customer mapper | commerceWebhookService57–70,340–355; conditional top-level payload analysis | 080 validation; mapper implementation BACKLOG MAPPING REQUIRED | OPEN |
| REV-FIND-0111 | [012](diagnostics/TASK-012.md#16-findings-register-and-future-tasks) | Medium | Registration list stops at250; duplicates/obsolete destinations not reconciled away | shopifyWebhookService17–27,142–168 | 061; pagination implementation BACKLOG MAPPING REQUIRED | OPEN |
| REV-FIND-0112 | [012](diagnostics/TASK-012.md#16-findings-register-and-future-tasks) | Medium | C8latest topic setup states failed,642attempts each; current provider/root cause unknown | SELECT metadata; completedOct27;shopifyWebhookService failure persistence | 059–060,097 | OPEN |

Existing selected tests:11runner entries passed,0failed/skipped/cancelled (4files; mocks/static/purehelpers). No newtests, app changes, DBwrites, Shopify changes or manualdeploy/restart/sync/retry actions. Decisions unchanged. Snapshot/report will be completed after authoritative live inventory comparison.


## Task012 completion follow-up — provider sign-in and diagnostics verified

The user completed Shopify verification. Signed-in Revluma developer app389768118273 lists3installed shop domains, agreeing with the3distinct DBdomains (4store rows). Active Revluma-v1.0 configuration explicitly sets Webhooks api_version2026-10. Provider delivery metadata confirms Dorders/updated2097267835069 and checkouts/create2097267998909 at current URLs, Shop specific/http, matching stored IDs. No app-scoped topic entries displayed in the active version. Full current all-topic subscription enumeration is unavailable through the inspected UI/connector/runtime; per-topic current existence remains UNKNOWN, as the task's acceptance criteria permit. No9/9live-registration guarantee is made.

Task012 is now **PASS — audit complete**: expected/stored/provider evidence and unknowns, all9handlers, security/tenant/reliability/compatibility/tests/findings documented. The earlier authentication checkpoint is preserved as history and superseded; no sign-in action remains. Final business correctness/full live registration validation are not certified. Task013 remains NOT STARTED.

REV-FIND-0048 severity raised Medium→High, status remains UNDER INVESTIGATION: Shopify records an orders/updated attempt No response from app6001ms followed by200OK1989ms for the same ID. Exact-ID DBrow eventuallyprocessed15:30:56.545UTC; provider acknowledgment does not prove a second handler or correct commerce state. App overview failure rate6.2%, Oct29rate11.5%; Oct29responseP905904ms. This upgrades prior latency inference to provider-recorded failure evidence; no fix is claimed.

REV-FIND-0104 gains authoritative active-app payload-version2026-10 and recorded delivery-header evidence. Current served Admin version is still unobserved; finding remains OPEN with its remaining scope. REV-FIND-0107–0112 remain OPEN. No new IDs or architectural decisions were introduced by the completion follow-up. No source/tests/Shopify/configuration/DB/infrastructure mutations or deployment actions.

## TASK 029 — Checkout completion overrides abandonment (2026-10-30)
Baseline main 8bd8245a5ffdd0ab4c421f269e281f19c11f1b28. Branch fix/mvp-task-029-completion-overrides-abandonment. Report: implementation/TASK-029.md. Order-based completion transition implemented in merchant-scoped transaction; 12 isolated scenarios authored, CI pending; remaining acceptance scenarios NOT RUN. REV-FIND-029-01 IN PROGRESS; REV-FIND-029-02 OPEN (Task031 order-first); REV-FIND-029-03 OPEN (classifier/metrics/concurrency). Status PARTIAL — NOT DEPLOYED. No production mutation.

## TASK 030 — Delayed checkout event protection (2026-10-30)
Report: implementation/TASK-030.md. Baseline main 858b0343d3faea4a34c80cd5979a84157113963c. Branch fix/mvp-task-030-delayed-checkout-event-protection. REV-FIND-030-01 HIGH differing checkout/order transaction locks: RESOLVED — CODE (verification pending); REV-FIND-030-02 MEDIUM source activity watermark regression: RESOLVED — CODE (verification pending); REV-FIND-030-03 HIGH full 50-case, classifier and metric verification: OPEN. 39 scenarios authored; none certified PASS yet. No production modification. PARTIAL — NOT DEPLOYED.
