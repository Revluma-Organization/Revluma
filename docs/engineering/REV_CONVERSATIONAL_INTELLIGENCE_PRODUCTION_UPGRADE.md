# Rev Conversational Intelligence — Production Upgrade

Status: IN PROGRESS · Started: 2026-11-04 · Branch: `arena/f3ba3a46-revluma`
Directive: master engineering directive "Rebuild and upgrade Rev Intelligence's
conversational engine to production grade" (2026-11-04).
Companion specs: `docs/rev-intelligence/REV-CONVERSATION-EXPERIENCE-SPEC.md` (v1.2.0),
`docs/rev-intelligence/REV-CONVERSATION-EXPERIENCE-CERTIFICATION.md`.

---

## 1. Problem statement

Rev Intelligence answers merchant messages through two co-existing engines that
never meet:

- `python/src/agents/investigation.py` — a deterministic, regex-routed evidence
  pipeline. This is what the production chat endpoints (`/rev/investigate`,
  `/rev/stream`, called by Node `revController.chatStream`) actually execute.
- `python/src/agents/orchestrator.py` + `understanding.py` + `responder.py` — an
  LLM-driven conversation engine (structured understanding, knowledge answers,
  clarifications, natural conversational language, memories). It is wired only
  to `/orchestrate`, which the merchant chat UI does not use.

Consequence: every merchant message — including "hey", "thanks" and "how are
you doing?" — entered a keyword router whose default behaviour was to run
store tools and compose a report. Hotfixes #279/#281/#283 patched individual
leaks (connection answers, greetings, social openers) but the architecture
still defaulted to business intelligence whenever a message was not explicitly
anticipated. Responses for conversational turns were static templates.

## 2. Exact reproduced failure

Production payload 2026-11-04 09:26 UTC, message "Hello chat": capability wall
in full report chrome (fixed in #281). Same day, message "How are you doing?":
full store report — PARTIAL EVIDENCE badge, ten facts (one duplicated),
comparison, limitations, recommendations, provenance, 11 sources, 14 evidence
records (fixed superficially in #283 by pattern). Directive §2 lists eleven
candidate explanations; inspection confirmed the architectural one: the
production path has no meaning-level understanding layer at all.

## 3. Root-cause analysis

1. **Pathway split** (primary): production chat bypasses the LLM conversation
   engine entirely (`api.py` rev endpoints import `investigation` only).
2. **Keyword-only routing** in the production path: `GREETING_PATTERN`,
   `INTENT_PATTERNS`, `FOLLOWUP_PATTERN`; unmatched social or ambiguous
   messages fell to whatever pattern caught them (e.g. the overview pattern
   matched "how are **you** doing").
3. **No investigation gate**: tool execution followed intent routing, never a
   justified decision; uncertainty defaulted to investigation.
4. **Static conversational language**: greeting/social replies were templates
   written during hotfixes; no generation layer on the production path.
5. **Thin conversation state**: `context_window` carried `last_investigation`
   and `unresolved` only; no subject/metric/period/entity continuity, no
   topic-change handling, no open-clarification tracking.
6. **Contract gap**: payload carried no understanding/gate metadata, so the
   frontend could only infer presentation from content shape.

## 4. Existing architecture (as found)

Node `revController.chatStream` → `mlService.streamInvestigation` →
Python `/rev/stream` → `investigation.stream_investigation`:
`load_conversation_context` (Node-supplied context + DB turns) →
`classify_investigation` (regex) → tool execution (read-only, tenant-scoped) →
evidence items → `_facts_from_items` → `_compose_text`/`_verification_answer` →
optional model narrative → `select_response_mode` → SSE `final` →
Node `_boundedResultForPersistence` → DB + browser → `RevAnswerView`.

Orchestrator path (`/orchestrate`, unused by chat): context + memories →
`understand()` (structured JSON, fast model, never raises) → route
(conversational / knowledge / clarification / capability / web / store-data) →
agent selection → `compose_analysis`.

## 5. New architecture (unified understanding-driven lifecycle)

One lifecycle on the production path, layered so that trivial messages stay
fast and unforeseen messages get real understanding:

- **L0 trusted guard** (deterministic): prohibited-action detection and
  read-only enforcement run first and cannot be overridden by any model
  output. Tenant scoping remains server-side only.
- **L1 deterministic fast path** (zero model latency, safeguards only):
  greetings/social openers, acknowledgements, capability/identity phrasings,
  store-verification phrasings (connection/sync/webhook → quick verification),
  elliptical follow-ups with an inherited subject, and strong business
  keyword matches. These are supports, not the intelligence layer.
- **L2 model understanding**: everything else goes to `understand()` with
  bounded conversation history → structured `Understanding` (intent, goal,
  `requires_store_data`, `response_mode`, entities, domains, confidence).
  It never raises; provider failure yields a conservative conversational
  reading, never an investigation.
- **L3 investigation gate** (`gate_investigation`): a single decision —
  `tools | conversational | clarify`. Store data is retrieved only when
  justified: `requires_store_data` true with a business intent, a resolved
  follow-up of a business subject, or an L1 business safeguard. Ambiguity
  (confidence below threshold or `clarification_needed`) produces a natural
  clarifying question and runs nothing.
- **L4 execution**: the existing read-only evidence pipeline, unchanged, only
  when the gate opens. Tool selection still derives from the resolved subject.
- **L5 composition**: no-tool turns are generated by the responder composers
  (`compose_conversational`, `compose_knowledge`, `compose_clarification`,
  `compose_capability`) with history, memories and an address hint — dynamic
  language with deterministic static fallbacks on provider failure. Tool
  turns keep evidence-grounded composition plus the model narrative; mixed
  messages instruct the narrative to acknowledge the social clause first.
- **L6 conversation state**: `conversations.context_window` gains a
  `conversation_state` block (subject, intent, metric, period, entities,
  open clarification, topic version) written each turn and consumed by
  follow-up resolution and topic-change detection.
- **L7 contract & observability**: payloads carry `understanding`
  (intent, gate, source, confidence); structured log event `rev_routing`
  records source/intent/gate/tools without conversation content.

Latency/cost posture: greetings, acknowledgements and clear business messages
never pay an understanding call; conversational turns pay one fast-model
composition call (as the orchestrator already did); only unforeseen or
ambiguous messages pay understanding + composition. Provider failures degrade
to static conversational fallbacks, never to fabricated business answers.

## 6. Intent-resolution design

Taxonomy (directive §4.1) mapped onto routing outcomes:
A social/conversational → L1/L2 → conversational, no tools.
B acknowledgements → L1 pattern (bounded whole-message forms) or L2 casual →
  conversational, no tools.
C capability discovery → L1/L2 → capability explanation.
D general ecommerce advice → L2 knowledge/strategy → knowledge answer, no
  store data; offer to investigate when store-specific evidence would help.
E store verification → L1 → quick verification (transcript A contract).
F business-data questions → L1 strong keywords or L2 metrics → tools,
  direct-answer presentation.
G investigations → L2 diagnosis → tools, analysis presentation.
H recommendations → L2 recommendation → tools over verified findings.
I contextual follow-ups → L1 ellipse with inherited subject, else L2 followup
  resolved against `conversation_state`.
J clarification/correction → L2 clarification_needed or correction patterns →
  clarification or re-resolution; corrections invalidate stored state.
K topic changes → L2/L1 topic-change cues reset `conversation_state` subject.
L mixed intent → L2 `requires_store_data` true plus an L1 social opener match
  → tools run and the composition acknowledges the social clause.

Generalisation: L2 sees messages never anticipated; L1 exists only for
latency-critical, high-precision safeguards and security.

## 7. Investigation-gating design

`gate_investigation(routing, context)`:
1. L0 prohibited → read-only refusal (no tools).
2. L1 social/greeting/ack/capability/identity → conversational.
3. L1 verification → quick verification tools only (store_health/data_coverage).
4. L1 follow-up with inherited business subject → tools for that subject.
5. L1 strong business keyword match → tools.
6. L2 `requires_store_data` false → conversational or knowledge.
7. L2 `clarification_needed` or confidence < 0.55 → clarify (no tools), unless
   deterministic keywords evidence a business subject (then tools, source
   recorded as fallback_deterministic).
8. L2 business intents → tools with subject from domains/entities.
Every decision records `source` (guard|fast_path|model|fallback_deterministic)
so evaluations can measure how often each layer decides.

## 8. Context-management design

- Node supplies bounded `conversation_context`; Python additionally reads the
  last turns of the conversation (existing `load_conversation_context`).
- `understand()` and composers receive a formatted window of ≤6 turns
  (existing `_format_history`), not the full transcript.
- `conversation_state` (L6) carries the durable subject across turns;
  explicit topic changes and new conversations reset it; long gaps expire it
  via `updated_at` age check (30 min) before follow-up inheritance.
- Memories (`merchant_memories`) feed composers as before; merchant-provided
  record content remains untrusted data, never instructions.

## 9. Dynamic response-generation design

Conversational language is generated per message with persona principles
(approachable, direct, no corporate filler, no forced questions), history
awareness ("use conversation history to avoid repeated introductions"),
adaptive length instructions and an address hint (boss-name pool per
conversation-experience spec §13, stated preference overrides). Static
strings remain only for: provider-failure fallbacks, read-only refusals,
capability catalogue and controlled UI labels.

## 10. Frontend/backend contract

Payload additions: `understanding: {intent, gate, source, confidence}`.
Presentation rules unchanged in spirit and enforced by mode:
conversational/knowledge/clarification turns carry
`response_mode: "conversational"` → plain chat rendering (no badges,
provenance, disclosure, chips — GREET-001 contract). Verified turns keep
quick_verification / investigation / comparison modes with their evidence
chrome. The frontend never infers investigation from metadata presence
(MODE-PERSIST-001 rule: empty evidence shells are not evidence).

## 11. Security considerations

Unchanged boundaries: Node authentication and tenant ownership checks;
server-side org scoping of every query; read-only tool set; prohibited-action
guard before any routing; model outputs treated as untrusted metadata (routing
only — tenant ids, tool authorisation and persistence never derive from them);
merchant records and conversation content labelled untrusted where injected
into prompts; no new write capabilities; logs carry no message content.

## 12. Testing strategy

- Routing/gate unit matrix over directive §14.1–14.6 categories with the model
  gateway patched: assert gate decisions (tools/conversational/clarify),
  sources and tool lists.
- Provider-failure tests: understanding failure → conservative conversational
  reading; composer failure → static fallback; neither fabricates evidence.
- Follow-up multi-turn scenarios against `conversation_state`.
- Existing suites as regression: python regressions, golden set (business
  acceptance), Backend contract tests, Dashboard suites, tenant/read-only
  security tests.
- Evaluation harness extension: unnecessary-tool rate on a social set
  (target 0), follow-up resolution set (target ≥95%), intent accuracy on a
  labelled prompt set, measured baseline vs post-change.

## 13. Evaluation results

Increment 1 (unified routing + gate + dynamic composition), measured
2026-11-04 with the model gateway patched (deterministic reruns):

| Set | Messages | Baseline (deterministic router) | Post-change |
|---|---|---|---|
| Complaint reproduction ("Hello chat", "How are you doing?") | 2 | 2 unnecessary tool runs | 0 |
| Directive §14.1/§14.2 social + acknowledgement set | 22 | 0 unnecessary tools (post-hotfix #283 patterns) | 0 unnecessary tools, 0 understanding calls (fast path) |
| Unforeseen phrasings (5 social, 5 business; no pattern matches) | 10 | 4 misrouted | 0 misrouted (7 resolved by the model, 3 correctly caught by safeguards) |
| Gate matrix (routing tests: A–L categories, follow-ups, topic change, mixed, ambiguity, provider failure, guard) | 36 cases | n/a | 36/36 |
| Follow-up continuity (contextual follow-up suite + routing follow-up tests) | 8 scenarios | passed pre-change for keyword ellipses only | passed incl. state-resolved subjects |

Python suite: 1451 passed (4 environment-only DB failures, CI authoritative).
Backend persistence contract test: passed (mode + understanding fields).
Dashboard suites: unchanged by this increment (CI verifies).

## 14. Performance measurements

LLM calls per message class (increment 1): greetings/social/acknowledgements/
clear business messages = 0 understanding calls (fast path); conversational
turns = 1 fast-model composition call (understanding skipped); unforeseen or
ambiguous messages = 1 understanding + 1 composition call; investigations
unchanged (tools + narrative as before). Provider failure adds no calls and
degrades to deterministic templates.

## 15. Deployment details

_To be filled per increment: PR numbers, merge SHAs, Vercel deployment ids,
Render service redeploy requirements (Node/Python), verification queries._

## 16. Rollback procedure

Each increment merges independently; rollback = revert the merge commit and
redeploy the affected Render service. The routing layer degrades safely: with
the model unavailable the fast path + deterministic fallback reproduce the
pre-upgrade behaviour for business messages while keeping social messages
conversational.

## 17. Known limitations

- Understanding quality bounds to the fast model's JSON discipline; the gate
  compensates with deterministic safeguards and clarification.
- Preference memory writes (orchestrator `_save_preference`) are not yet on
  the production path.
- Web-research composition remains orchestrator-only this increment.

## 18. Future improvements

- Move preference persistence and web research onto the unified path.
- Retrieval-augmented merchant memory for cross-conversation continuity.
- Chart/table presentation selection for trends and comparisons (§10.3).
- Continuous evaluation from anonymised production routing events.
