# Rev Intelligence — Conversation & Response Experience Specification

Version: 1.2.0 · Date: 2026-11-04 · Status: Approved-for-implementation baseline
(v1.1.0 adds §13 greeting, rapport and merchant-address contract after GREET-001;
v1.2.0 adds G13.5 mutual conversation and G13.6 fact dedupe after CONV-001)
Source plan: `Revluma_Rev_Intelligence_Conversation_Experience_Production_Implementation_Plan.pdf` (15 pp, 2026-11-04)
Task document: `docs/engineering/REV_INTELLIGENCE_CONVERSATION_EXPERIENCE_IMPLEMENTATION.md`

This specification converts the conversation-experience plan into versioned product
requirements for the existing Revluma codebase. It changes how Rev understands,
communicates and presents intelligence. It does **not** authorize any write action:
Rev remains a read-only operational advisor in this MVP.

Implementation principle (P0): **the complexity of the internal investigation must not
dictate the complexity of the user-facing answer.** Perform the necessary work behind
the scenes; expose only the progress and detail that help the merchant understand what
is happening and what the result means.

---

## 1. Principles

- **P1 Answer the actual question.** The first visible sentence after completion resolves
  the question whenever evidence permits. No title/timestamp/status-taxonomy preamble.
- **P2 Adaptive presentation.** Choose the smallest structure that communicates the answer
  accurately. Plain text is the default; headings, bullets, tables, charts, cards and
  evidence panels appear only when they improve comprehension.
- **P3 Progressive disclosure.** Conclusion and essential reasoning inline; detailed
  provenance, raw evidence, definitions, coverage and secondary checks behind an
  expandable "How I checked" control when not essential.
- **P4 Honest progress.** Progress text corresponds 1:1 to real stream events or backend
  task state. Never invent steps, never animate fake investigation, never show
  "completed" while work runs. Fake progress target: zero.
- **P5 Evidence before confidence theatre.** No arbitrary confidence percentages.
  Prefer explicit language: confirmed / suggests / not enough data to determine /
  not verified. A confidence label may appear only once calibrated, defined and tested.
- **P6 Separate distinct concepts.** Connection, auth validity, sync completion,
  freshness, coverage, order availability and revenue certification are different
  states. A connected store never implies complete coverage.
- **P7 No invented causality.** Measured movement is not proof of cause. Unverified
  explanations are labelled hypotheses, with the evidence that would test them.
- **P8 Read-only boundary.** Inspect and recommend only. The UI never implies a
  recommendation was applied.
- **P9 Stable visual language.** Neutral black/white/grey foundation; green = verified
  healthy; red = confirmed problem or negative movement; amber = partial/stale/warning;
  restrained Revluma blue = identity and interaction. Colour never substitutes for words.
- **P10 Conversation continuity.** Follow-ups inherit store, metric, period and
  definitions while valid; Rev states when scope changes or context cannot be reused.
- **P11 Accessible by default.** Keyboard, focus visibility, screen-reader semantics,
  contrast, reduced motion, responsive layouts and chart text alternatives are release
  requirements, not polish.
- **P12 Performance is product quality.** Streaming, cancellation, reconnect and error
  recovery are part of the product contract.

## 2. Response modes and selection policy

Seven presentation modes. A mode is a **presentation decision, not an agent**.

| Mode | Trigger (backend signals) | Presentation |
|---|---|---|
| Conversational | intent ∈ {greeting, identity, capability, general}; read-only-boundary explanations | Plain text. No evidence panel unless factual store data is used. |
| Quick verification | tool set ⊆ {store_health, data_coverage}; questions about connection, sync, webhooks, last sync, data availability | Direct answer + one supporting detail. Problems say what is wrong and the next step. Connection ≠ coverage, always. |
| Insight | single supported finding / overview intent with one material observation | One headline, measured evidence, why it matters, one measurable next step. No findings → say so plainly. |
| Investigation | multi-tool diagnostic intents | Progressive status; concise executive answer; findings grouped by strength; limitations; evidence disclosure. |
| Comparison | compare intent or comparison facts present | Compact table or chart **only** when it makes the comparison faster to read; period, timezone, currency and metric definition always visible. Two numbers that fit a sentence stay a sentence. |
| Recommendation | action-oriented request | Prioritized recommendations with rationale, measurable signal, review period. No claim Rev performed anything. |
| Insufficient evidence | evidence gate failure, missing/stale/contradictory source | Lead with the limitation, then exactly what is missing, why it matters, smallest useful next step. Never speculative conclusion. |

**Selection architecture.** The backend assigns `response_mode` in the final payload,
computed from deterministic guards first (disconnected store, failed lookup, stale data,
missing currency, incompatible periods, evidence-gate suppression) and intent
classification second. The frontend validates the mode and **falls back to plain text**
on any mismatch or missing field. The classifier never overrides an evidence constraint.
Selected mode and reason are logged for evaluation.

**Transitions.** A turn may begin in Quick verification and end in Insufficient evidence
if the lookup fails. The rendered mode is the terminal one; progress copy reflects the
real path taken.

## 3. Progress communication contract

Lifecycle states: `received → planning → investigating → composing → completed |
interrupted | failed | cancelled`. Mapped from existing stream events
(`plan`, `step`, `evidence`, `final`) — no new transport.

- Acknowledgement renders immediately on request acceptance (target p95 ≤ 500 ms;
  proposed, to be validated against current infrastructure before adoption as an SLO).
- A step line renders **only** when the server emits the corresponding step event.
  Labels come from the backend step metadata (`TOOL_STEP_LABELS`), never from a timer
  and never from frontend imagination.
- Copy is short, human, specific: "Checking your Shopify connection…", "Comparing it
  with the previous day…", "Reviewing orders and refunds…". Forbidden: "Calling
  endpoint", "Executing SQL", "Running tool 3", "Retrieving context payload", and
  generic repeated "Thinking…".
- The current step updates in place; micro-events do not accumulate into a wall.
- On final answer, the progress area collapses or quiets. A completed timeline never
  sits above a simple answer.
- Long waits show a calm elapsed state or a useful explanation, not an infinite loop.
- Failed/interrupted turns are never shown as completed; the tri-state
  `connected / disconnected / unverifiable` applies to every store lookup, and
  401/403/404/timeout/malformed payload renders as **unverifiable with retry
  guidance**, never as "not connected".

## 4. Typography, Markdown and rendering pipeline

- **One renderer.** The legacy `ResponseCard`/`RichText` path and the structured
  `RevAnswerView` path converge through adapters into a single shared renderer; the
  legacy path is deleted only after parity tests pass. Two typography systems must not
  coexist.
- **Semantic heading scale.** Fix the current unconventional mapping (`#`→h2,
  `##`→h3, `###`→h4). In-chat: `#` = section heading (h2 semantics), `##` = subsection
  (h3), `###` = minor grouping (h4); a true h1 is reserved for standalone report
  artifacts, never for chat replies. Lead answers use a distinct lead style, not a
  heading.
- **Markdown support:** paragraphs, headings, bold, italic, ordered/unordered lists,
  links, blockquotes, code and inline code, tables. Safe parser only; no arbitrary HTML,
  scripts or event handlers from model output; URLs validated to safe schemes. Store
  content (product titles, customer notes) is untrusted input, never instructions.
- **Body default:** one normal prose style for most replies; readable max text width;
  metadata/caption styles for periods, freshness and counts; tables and charts may
  expand within a controlled region; narrow screens stack with no horizontal overflow.
- **Tables:** repeated comparable fields only; accessible headers; consistent numeric
  alignment; mobile stacks rows or scrolls with clear affordance.
- **Charts:** must answer a question; title, period, units, currency, legend and an
  accessible text summary; never for one value or a trivial two-value comparison; no
  decorative gradients; positive/negative never by colour alone. Charts are introduced
  with Comparison mode, not before a proven use case exists.

## 5. Colour, badges, cards, motion, emoji

- Semantic colour per P9. Theme (light/dark) never changes semantic meaning; every
  component, status, chart, tooltip, evidence disclosure, code block, focus ring and
  loading state is tested in both themes.
- **Badges only where operationally meaningful.** "Read-only", "Confidence NN%",
  "Partial evidence" and timestamps are not attached to every message. Read-only
  capability lives in product-level education or a relevant recommendation.
- **Cards** are reserved for distinct actionable objects (priority finding, product
  comparison, linked report). Paragraphs are not wrapped in cards.
- **Motion** is restrained, short, reduced-motion aware. No cinematic intro, no
  bouncing avatar, no attention-grabbing progress animation. Completion is an
  unmistakable settle: motion stops, actions appear.
- **Emoji:** at most one per answer, only on a verified positive confirmation
  (e.g. a successful connection). Never on financial warnings, failures or
  serious findings. Never repeated decoration.

## 6. Evidence disclosure and citations

- Every material store-derived claim traces to an evidence object; the UI distinguishes
  source objects from model-authored interpretation.
- **Monetary claims keep compact inline provenance even in simple modes**: one quiet
  line carrying period, timezone, currency and freshness. Concise never means
  unprovenanced.
- Secondary provenance (definitions, coverage, caveats, per-source detail) lives behind
  the "How I checked" disclosure, which must not invent missing values or hide material
  caveats. Missing fields are labelled unavailable, not guessed.
- Inline citation chips sit **at the claim** they support (Perplexity pattern), with the
  full evidence list expandable; a source control resolves only to evidence owned by the
  current tenant and conversation.

## 7. Conversation surface behaviours

- Message lifecycle per §3; a received message is acknowledged promptly; no
  investigation timeline for a plain conversational response.
- Streaming renders without layout jumps and without half-parsed tables; partial text is
  visibly in-progress and never presents unsupported conclusions as final.
- Cancellation stops client rendering and requests server cancellation; stale results
  never overwrite a newer turn. Retry creates a traceable attempt without duplicate
  messages or writes.
- History retains order, timestamps, store context and final content; reconnect does not
  duplicate assistant messages; refresh recovers the last stable message and shows a
  clear interrupted state.
- Composer: multiline, correct disabled/sending states, no accidental double submit,
  unsent text preserved after recoverable errors, shortcuts that respect accessibility
  and browser conventions.
- Follow-up suggestions render only when the evidence engine produced them
  (`investigation.follow_ups`); never a generic auto-list after every answer.
- Edit-and-resend on the user's last message reuses the existing turn pipeline; no
  conversation branching (single persisted thread).
- Scroll: auto-follow only while pinned to bottom; otherwise a "latest" affordance.
  Streaming never hijacks a merchant reading older messages.

## 8. Copy and style policy

- Voice: clear, calm, commercially literate, direct. Friendly without forced
  enthusiasm; never over-apologetic, theatrical or robotic.
- Answer-first: direct answer → one or two supporting details → implication/next step
  only if useful. Complex diagnostics: conclusion → key evidence → interpretation and
  uncertainty → recommended next step → optional detailed evidence.
- Verbosity: concise by default; expand only for depth, complexity, material risk or an
  explicit request. Longer is not smarter.
- Language: merchant vocabulary; internal terms forbidden in user-facing copy
  (context payload, endpoint, queue, SQL, worker, model status, event stream).
- Numbers: never compute from rounded display values; consistent rounding; currency and
  period stated; non-equivalent periods warned; gross/net/revenue/orders/refunds/capture
  distinguished.
- Hypotheses: explicit labelling when material ("…may have contributed, but the
  available data does not establish that it caused…"); no speculative lists of ads,
  pricing, dissatisfaction or seasonality without support.
- Recommendations: what to inspect/do, why, how to measure, review period. No promised
  uplift, no invented benchmarks.
- Punctuation and casing: sentence case for prose and buttons; title case only for
  product nouns and section headings where the design system calls for it; no
  mid-sentence line breaks that orphan half a line; paragraphs short and coherent.

## 9. Acceptance examples (binding)

- **A Connected store.** "Hey Rev, is my store connected?" → progress "Checking your
  Shopify connection…" (→ "Checking the latest sync…" only if that check actually runs)
  → "Yes — your Shopify store is connected. The latest sync completed successfully."
  Optional extra line only if it changes understanding. No confidence %, no provenance
  table, no 7-day window, no evidence count, no follow-up block by default.
- **B Lookup unavailable.** "I can't verify the connection right now because the store
  status check failed. That doesn't necessarily mean your store is disconnected. Try
  again shortly, or check the Integrations page."
- **C Revenue change.** Progress stages only for checks actually running → "Revenue was
  down X% yesterday compared with [baseline]. The clearest observed change was
  [supported fact]. These observations do not yet prove the cause. I'd check [next step]
  and measure [metric] over [period]." Every placeholder populated from valid evidence
  or omitted.
- **D Insufficient coverage.** Lead with the limitation, name the missing source and the
  next step; no invented number, no generic advice.
- **E Priority finding.** One verified finding, why it matters, one measurable
  recommendation; if nothing clears the evidence threshold, say so plainly.

## 10. Evaluation and quality gates

- Golden set ≥ 100 prompts with evidence fixtures, expected mode, required facts,
  prohibited claims and acceptable wording; expanding toward 250–500.
- Scored: answer directness (first-two-sentence answer rate ≥ 95% on the golden set
  where evidence allows), evidence support, correct calculation, uncertainty handling,
  verbosity by mode, recommendation measurability, read-only compliance.
- Progress truthfulness: percentage of displayed steps backed by real events = 100%;
  stale/fake progress = 0.
- Visual regression across light/dark × desktop/mobile for: simple answer, complex
  answer, progress, evidence open/closed, table, chart, failure, empty state.
- Accessibility: automated + manual keyboard/screen-reader review; headings, live
  regions, status announcements, table semantics, chart alternatives, contrast, focus,
  zoom, reduced motion.
- Security: tenant isolation on every evidence lookup; adversarial prompt injection via
  Shopify fields; cross-tenant requests; hidden-prompt extraction; read-only tool
  allowlist assertions.
- CI green is a merge precondition; snapshot updates require review; every safety-rule
  change ships with a negative test.

## 11. Implementation increments (merge-sized)

1. **I1 Contracts & adapters (no visual change).** Versioned event envelope and
   normalized answer types; `response_mode` emitted by backend with deterministic
   guards; schema validation at boundaries; adapter map for every legacy
   `response_type`; contract tests.
2. **I2 Unified renderer & typography.** Shared renderer; semantic heading scale;
   safe Markdown incl. tables; legacy parity tests, then legacy removal.
3. **I3 Truthful progress.** Event-backed status lines from `TOOL_STEP_LABELS`;
   in-place update; collapse on final; interrupted/failed states; telemetry.
4. **I4 Adaptive modes & badge discipline.** Simple/verification/insight behaviours;
   per-message badge removal; answer-first layout; scroll discipline.
5. **I5 Evidence disclosure, comparisons, follow-ups.** "How I checked" panel;
   comparison table/card; evidence-gated follow-up chips; inline citation chips.
6. **I6 Polish, evaluation, certification.** Accessibility + themes + mobile; golden-set
   gates; preview acceptance with the active test store; merge, deploy, production
   smoke tests and certification report.

Each increment: focused branch → tests → CI → merge → deployment verification →
recorded SHA/deployment IDs in the task document.

## 12. Research appendix (studied 2026-11-04)

- OpenAI, *Intelligent UI in ChatGPT* (primary): layout follows the question; plain
  text remains a valid answer; components stream progressively; users can request a
  simpler style. https://help.openai.com/en/articles/20001598-intelligent-ui-in-chatgpt
- Shopify, *Sidekick* (primary): plans multi-step tasks, works in background, presents
  changes for review before applying, remembers skills/preferences, surfaces Pulse
  recommendations. Clarity and context borrowed; execution model not (Rev is read-only).
  https://help.shopify.com/en/manual/ai-powered-tools/sidekick
- Agent loading-state design: name the work in status strings; staged states for 10–60 s
  waits; generic "thinking…" teaches users to ignore indicators.
  https://tianpan.co/blog/2026-04-16/agent-loading-state-45-second-ux-abyss
- AI-native feedback states: immediate acknowledgement, staged status, streamed reveal,
  explicit settle, provisional styling for low confidence, step lists ticking real
  events; fake progress destroys trust. https://digcy.com/blog/motion-design-for-ai
- Progressive loading measurements: staged progress and streaming materially reduce
  perceived wait and abandonment versus whole-response delivery.
  https://www.thrivewithai.live/blog/ai-ux-design-patterns-that-work
- Citation patterns: inline numbered citations at the claim, source cards, claim-level
  attribution, missing-source disclosure. https://www.925studios.co/blog/perplexity-design-breakdown ,
  https://www.aydesign.ai/blog/ai-citation-source-ui-patterns-2026
- Visual references collected in `image-search/` (workspace, not committed): chart as a
  self-contained artifact with prose interpreting it and an inline citation; calm
  centred empty state with quiet starter chips.

**Reference rule:** references are interaction patterns, not specifications. Every
adopted pattern is validated against merchant tasks, Revluma's evidence requirements,
the brand design system and the read-only constraint.

---

## 13. Greetings, rapport and merchant address (v1.1.0)

A merchant opening a conversation is not asking for an investigation. GREET-001
(2026-11-04) showed the cost of treating a greeting as one: "Hello chat" ran the
evidence pipeline, answered with a capability wall, and wore the full report
chrome ("Evidence unavailable", provenance line, empty "How I checked" and
"Evidence and limitations" sections).

**G13.1 — Greeting detection.** A message that is only an opener, optionally
with one addressee and any punctuation or emoji ("Hello", "Hello chat",
"hey there", "good morning rev", "Hey! 👋"), classifies as a greeting and runs
no evidence tool. Any business content in the message ("hello why did my
revenue drop") removes it from this rule.

**G13.2 — Greeting answer shape.** Paragraph 1 greets back, addresses the
merchant (§13.3) and checks in on them with a question about their day or what
they are working on. Paragraph 2 (separated by a blank line) is a single open
invitation to share what they are working on — **no capability list, no
starting-point menu** (GREET-002, merchant directive 2026-11-05: a capability
wall on "hello" reads as a sales pitch; what Rev can help with is answered when
asked, via the capability intent). The whole greeting stays at most three
sentences across two short paragraphs, in the degraded static fallback exactly
as in the dynamic composer. Nothing else: no badge, no provenance line, no
disclosure, no evidence section, no chips (spec §6/§7 quiet rules apply to the
whole turn).

**G13.3 — Merchant address.** Rev treats the merchant as the boss. The default
honorific pool is the product owner's chosen list (Chief, Don, Big Chief, King,
Chairman, Mogul, Top G, Emperor, The General, Sovereign); a feminine
self-reference switches to the feminine pool (Queen, Chairwoman, Lady Boss,
Business Queen, The Matriarch, The Powerhouse, The Visionary, The Deal Maker,
Empress, Your Majesty); a stated preference ("call me X") overrides both. The
selection is deterministic per user so the nickname never flickers between
turns. Address is style, never a data claim (§8).

**G13.4 — Mode fidelity.** `response_mode` and `mode_reason` travel with every
streamed and persisted Rev payload (Node persistence mapper). The UI must not
infer a mode from an empty evidence shell: an evidence object with no usable
items and no limitations is not evidence (MODE-PERSIST-001).

**G13.5 — Mutual conversation (v1.2.0).** A message addressed to Rev itself —
a wellbeing check ("How are you doing?", "how's your day?"), thanks, or a
farewell — is conversation, not analysis: it runs no evidence tool and is
answered in kind (a reply plus a returned question, or a warm close). A
store-domain noun anywhere in the message ("how are you doing on my sales?")
keeps the business reading, so real questions still investigate. A message
with neither a business noun nor a social form gets a conversational offer
("I'm all ears, Chief…"), never a capability wall and never an investigation.

**G13.6 — One sentence, one fact (v1.2.0).** When two tools verify the same
sentence (order value from revenue and order observations), the sentence
appears once and cites both records; identical fact sentences never repeat
inside one answer.
## 14. Landing continuity (v1.3.0, REV-RESUME-001)

A bare `/dashboard/rev-intell` route (no conversation id, no finding param) is
**not** an amnesiac blank slate: once the history list — already fetched on
mount, server-sorted by `last_activity_at DESC` — resolves, the page resumes
the most recent conversation with a `replace` navigation, so the browser Back
button still points wherever the merchant came from (Command Center, another
tab, a reopened session). Rationale: Rev threads are evidence-bound business
investigations, and Rev's history lives in a modal drawer rather than a
persistent sidebar, so a blank-slate landing reads as lost work.

Opt-outs, all explicit and honest:
- **New conversation** sets a new-chat intent for the mount, cleared on the
  next conversation adoption or selection; until then the bare route stays a
  blank slate even if the list refreshes.
- **Finding deep links** (`?finding=`) keep their own handoff flow.
- **Empty history** shows the welcome experience; a **failed history load
  never resumes** (the drawer reports the failure honestly).
- At most one continuity redirect per mount; nothing is pre-filled or invented.

Deleting the conversation currently in view lands on New chat (the drawer
closes by design); reopening the drawer shows the refreshed list.
