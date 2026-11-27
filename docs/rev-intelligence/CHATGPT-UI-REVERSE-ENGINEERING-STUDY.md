# ChatGPT UI Reverse-Engineering Study

**Date:** 2026-11-05 · **Status:** research record (companion: `CHATGPT-UI-ADOPTION-IN-REV.md`)

Deep-dive study of how ChatGPT displays messages of every category to users, how its
interface is engineered, and why users are attracted to it — compiled from a hands-on
teardown of chatgpt.com's bundles and network traffic, a reverse engineering of its
October 2026 generative-UI system, design-system analyses, community DOM inspections,
and AI-chat UX pattern catalogs. Sources are listed at the end; bracketed numbers refer
to them.

---

## 1. Governing philosophy: radical subtraction

The interface is engineered to **lose the competition for attention on purpose**:

- Interface chrome is held under ~15% of the viewport; >85% of active screen space is
  message history + composer [3].
- Surfaces separate through **tonal shifts** (dark: `#212121` canvas vs `#2F2F2F`
  surfaces), not borders; hierarchy comes from **typographic scale**, not containers [3].
- One accent color (historically emerald `#10A37F`) is reserved strictly for state
  confirmation and primary actions — never decoration [3].
- Motion is capped at functional **120–200ms** transitions; no hover scaling, no
  particle effects [3].

OpenAI's Feb 2025 rebrand (bespoke **OpenAI Sans** with ABC Dinamo, "blossom" logo)
states the values explicitly: *simplify, space, imperfection, vivid* — and
"**typography is the anchor point of ChatGPT**" [5]. A designer's summary of the product
philosophy: it is a "do not make me *think*" design (vs Google/Notion's "make me
choose"), where the **rhythm of words is the interface** — uniform spacing, human-tempo
animation, markdown-formatted code and tables [17].

## 2. The actual stack (bundle/network reverse engineering) [1]

| Layer | Technology | Notable detail |
|---|---|---|
| Runtime | React 19, TypeScript | Streamed server rendering |
| Router | React Router 7 framework mode | Next.js Pages → Remix (Aug 2024) → RR7; 354 routes in one app, only ~13 are the chat — marketing ships inside the product |
| Data | TanStack Query | Server hands the client a prefetch plan (`shouldPrefetchModels`, `shouldPrefetchHistory`, …) |
| Styling | Tailwind CSS v4 | Over a **semantic design-token layer** — `token-*` utilities backed by CSS variables |
| Primitives | Radix UI | `data-radix` attributes: menus, popovers, selects, toasts, scroll areas |
| Composer | ProseMirror | The input is a rich-text editor |
| Code blocks | CodeMirror 6 | Every answer code block is a full editor instance (`.cm-editor` in the DOM) — same engine as Canvas |
| Math | KaTeX | Fonts loaded on demand |
| Maps | Mapbox GL | Maps render inside answers |
| Animation | Motion + silk-hq | silk-hq = native-feeling mobile sheets |
| Fonts | System font stack for UI text | No webfont cost; brand face reserved for marketing |
| Delivery | Vite + Cloudflare | 84 KB logged-out document, TTFB 50–65 ms, 548 DOM nodes after hydration |
| Streaming | SSE over fetch | Not EventSource (POST needed); LiveKit/WebRTC for voice; WASM for audio + syntax grammars |
| Experimentation | Statsig + Datadog RUM | Inline scripts timestamp HTML-start and first frame for *every* user |

Architectural decisions that shape how the UI feels [1]:

1. **No auth wall** — logged-out visitors get a parallel anonymous backend
   (`/backend-anon/*`) and a real user ID; the composer is usable in seconds.
2. **Theme before paint** — an inline `<head>` script applies the saved theme class to
   `<html>` before first paint; custom themes swap CSS *variables*, never re-render.
3. **Server-driven client** — SSR streams the shell; the server dictates what to warm
   up. "The client is a thin wrapper driven by the server" — the first baby-step
   toward generative UI.

Community DOM inspection confirms the token vocabulary in the wild:
`.bg-token-message-surface`, `div.group/conversation-turn`, `.rounded-3xl` user bubbles,
CSS vars like `--main-surface-secondary/tertiary`; Settings → Appearance now exposes
custom themes and motion-reduction settings [15][16].

## 3. The rendering pipeline: token → screen

ChatGPT's answer display is a **streaming-aware markdown compiler**, not "react-markdown
on a growing string" [6][7]:

```
SSE tokens (message_start → deltas w/ sequence numbers → message_end) [14]
  ↓ fetch-based reader (EventSource cannot POST); seq numbers enable resume
  ↓ buffer + batch re-parse (~50ms), not per token
  ↓ REPAIR incomplete markdown: close unclosed ``` fences FIRST (context changes
    everything), then unclosed **bold**, `code`, links — a half-streamed message
    must never render as raw syntax
  ↓ SPLIT into top-level blocks; per-block React.memo keyed by content identity
  ↓ startTransition() → interruptible renders; only the TAIL block re-parses per tick
  ↓ DEFER syntax highlighting until a code fence closes; KaTeX on complete math only
  ↓ DISABLE interactive affordances (copy buttons, toggles) during streaming
```

ChatGPT-specific elevations: completed code blocks become CodeMirror 6 editors (real
selection, WASM grammars, copy button, language label) [1]; the streaming caret is a
**pulsing dot**, not a text cursor [4]; the wire carries structured events (tool
activity, reasoning summaries, citations, DIL programs) that render as distinct
components, not markdown [14][2].

## 4. Visual grammar of a message

| Element | Treatment | Why |
|---|---|---|
| User message | Right-aligned rounded bubble (`rounded-3xl`, tonal gray surface) — visually lightweight | Your words are context, not content [3][15] |
| Assistant message | **Full-width, unboxed**, rendered on the root canvas; no bubble | Reading comfort; "tool" framing — round colorful bubbles signal casual texting and undermine seriousness [4] |
| Column | Center column capped ~**720–768px** | Optimal reading measure (~65–75 chars) [4] |
| Structure | Headings/lists/tables/code carry hierarchy via typography + spacing | Tone separation over hard lines [3] |
| Action dock | Copy / regenerate / thumbs / read-aloud below the last paragraph, **opacity 0→1 on hover**, low contrast | Affordances without competing with content [3] |
| Shell | Left rail (collapses <1200px) · center stream · right panel that slides in **only when there is an artifact** | Two-pane + on-demand third pane is the converged industry standard [4] |

## 5. Component catalog by content category

| Category | ChatGPT rendering | Details worth stealing |
|---|---|---|
| Prose/lists/headings | Streaming markdown, typographic scale | Blocks stabilize as they complete — no reflow jitter [6] |
| Tables | GFM tables in horizontal-scroll containers; wide tables scroll on mobile | Data-analysis mode: **interactive tables** — expand full-screen, click a region to ask a follow-up about it, download [10]. Ecosystem standard adds **Copy as CSV / Copy as Markdown** with 44px touch targets |
| Code | CodeMirror 6 per block: language tab, copy, h-scroll, WASM grammars | Highlight only after the fence closes [1][7] |
| Math | KaTeX inline/block, on-demand fonts | Never blocks first paint [1] |
| Images | Inline, click-to-expand; progressive generation state | Grids for multi-image |
| Maps | Mapbox GL inside the answer | Answers can contain live surfaces [1] |
| Citations | Three-tier trust system: (1) inline **claim chips** with publisher favicon+domain and `+N` multi-source; (2) hover **preview popover with 1/N paging**; (3) **Sources panel** below the answer + globe icon marking grounded replies [8][19] | Typically 3–6 sources; the chips are the "positions 1–10" of an answer [20] |
| Reasoning | **"Thinking…" with an opacity pulse** (no shimmer — accessible), collapsing to **"Thought for Ns"** when the answer starts; stays collapsed on reopen; screen readers get one announcement per phase, never per token [13] | Progressive disclosure of effort = perceived intelligence without noise |
| Tool activity | Collapsible activity lines ("Searching the web…", "Reading N sources") folding into summaries | Same disclosure grammar as reasoning |
| Follow-ups | **2–4 suggested chips** under substantive replies; each names a concrete next task tied to what was just said; tap → becomes the next user turn (editable); refreshed after every answer; never block the composer [9] | The engagement loop: every answer seeds the next question |
| Long artifacts | **Canvas**: side-panel workspace; highlight → targeted in-place edit → version history with rollback/branching; "a chat thread is a terrible place for a document" [11][12] | Chat stays conversation; work products get a real surface |
| Composer | ProseMirror pill: autosize, attach, dictation, model picker, stop-button swap mid-stream [1] | The one object the page is built around |
| Empty state | Centered greeting + example prompt cards, SSR'd so it paints instantly [1] | Onboarding = the product's first sentence |

## 6. The state machine users feel [4][13]

1. **Queued (200ms–2s):** placeholder with a pulsing dot or shimmer line. **Never a
   percentage progress bar** — "there is no progress to report, and a fake one breaks
   trust the moment the user notices."
2. **Thinking / tool use:** honest activity labels that collapse into summaries.
3. **Streaming:** text reveals at human reading tempo (bursty chunks smoothed to steady
   grapheme pacing); pulsing caret = "alive" signal; auto-scroll pins to bottom **unless
   the user scrolls up**, then a "scroll to bottom" pill appears; Stop replaces Send.
4. **Complete:** action dock materializes; follow-up chips appear; copy/branch/edit arm.
5. **Editable past:** user-message edits **branch** the conversation with `< 2/3 >`
   version navigation; regenerate creates a sibling. The past is never frozen.
6. **Degraded:** errors are gentle, retry-able, and never fabricate a result.

## 7. Intelligent UI (DIL) — the model draws with the design system

Launched with GPT-6 (Oct 2026): answers can be **interactive native interfaces** —
sliders, forms, tables, charts, maps, product cards — responding to input without
another model call. Reverse-engineered end to end by Thesys [2]:

- **The model writes DIL**: Markdown + JSX-like tags from a fixed component catalog +
  JS for state (`{@body const [seats,setSeats] = DIL.useState(8)}`, `{#if}`, `{#each}`,
  `GenUI` actions like `issueNewTurn`/`copy`).
- **The server compiles every partial stream** into a JS program + JSON constants table
  (stored as `model_dil_v2`): repairs half-written markup, auto-closes tags, validates
  properties against the catalog schema (invalid props stripped + logged as
  diagnostics), wraps expressions in `__dilSafe` so one throw removes one element
  instead of the render, and gives state stable keys so values survive recompilation.
- **The client executes sandboxed** (iframe + Web Worker): a React-style reconciler
  diffs the tree and emits a **binary operation stream** (strings in a separate table;
  handlers cross the wire only as IDs like `fn#1`). The page applies ops to **its own
  ~70 native components** styled with **design tokens** (`padding={3}`), animating as
  they arrive. Unknown component types are rejected — *model output can never introduce
  arbitrary markup or styles*.
- **`fallbackMarkdown`** accompanies every compiled program so older clients still
  render prose + inline images/citations/maps.

Why it matters: generated interfaces look like the rest of ChatGPT on every platform
because the model **chooses from a whitelisted catalog** instead of drawing freely.
Safety, consistency and native feel fall out of the same constraint.

## 8. Why users are attracted to it — the perceptual engineering

1. **Instant response illusion** — SSR shell in ~50–65ms TTFB, no auth wall, streaming
   from the first token; latency is masked, never faked away [1].
2. **Honest states** — pulsing dot, real activity labels, no fake progress bars [4].
3. **Control everywhere** — stop, edit, branch, regenerate, canvas rollback.
4. **Progressive disclosure** — "Thought for Ns", collapsed tool traces, sources panel,
   canvas: depth available, never imposed [13][11].
5. **Typographic comfort** — 720–768px measure, quality type, rhythm-preserving
   spacing [5][17].
6. **Structure = perceived intelligence** — headings, tables and code surfaces make
   answers scannable; hierarchy by type, not chrome [3].
7. **Evidence as affordance** — claim-adjacent citation chips turn verification into a
   hover [8].
8. **One accent, one job** — zero visual fatigue across long sessions [3].
9. **Motion discipline** — 120–200ms functional transitions; reduced-motion settings [3][16].
10. **The engagement loop** — follow-up chips seed the next turn from what was just
    said [9].
11. **Everything is measured** — Statsig flags + per-user TTI timestamps + RUM: the UI
    you see is the variant that won [1][21].
12. **Familiar metaphor, one novelty** — chat (zero learning cost) + exactly one new
    behavior at a time, each flag-gated [1].

## 9. Anti-patterns ChatGPT avoids [4]

- SMS-style colorful bubbles for assistant output (undermines tool framing).
- Fake progress bars / percentage spinners during model latency.
- Dropping the streaming caret (a paused stream then looks identical to a finished one).
- Per-token accessibility announcements (one polite status per phase instead).
- Shimmer/gradient "AI glow" on thinking indicators where an opacity pulse suffices.
- Hover-scaled cards, particle effects, animations longer than a reader's patience.

---

## 10. REA pass (2026-11-18): reverse engineering a ChatGPT-class client

**Why a proxy.** chatgpt.com serves only a login shell to unauthenticated
requests, so its chat bundles cannot be fetched from this environment. The
reverse-engineer-anything (REA) skill was therefore run against **Open WebUI
0.13.5** (the most widely deployed open-source ChatGPT-style client, SvelteKit,
from its PyPI wheel), and the public performance.dev teardown of chatgpt.com
(Dennis Brotzky, 2026-07-02, source 1) supplied the ChatGPT-specific stack facts.

**Evidence trail (rea-agents 6.10.1, Node 24).**

| Step | Command | Result | Evidence |
|---|---|---|---|
| 1 | `analyze-javascript-application` on the 4 largest chat chunks | 869,236 AST nodes, 5,233 findings, 0 parse failures, coverage complete within view | `ev_559395398dab42bd9d97dd58d652477ce35c19a9db02b7fc7b2501b8f43be4b3` |
| 2 | `trace-application-feature` seeds "Thought for", "Follow up", "Regenerate" | `no-match` (minified Svelte keeps UI strings in i18n chunks, not in the graph); first attempt needed `NODE_OPTIONS=--max-old-space-size` to authenticate the 129 MB bundle | `ev_45870bb6dadbea3d7f0096a6e26210b63d7d5917a0c49f620d16ca249ebf4c24` |
| 3 | `analyze-javascript-application` on the two message chunks that own "Follow up" / "Regenerate" | 62,858 AST nodes, 489 findings | `ev_0028924e0dcf3a49e994e66d14b44ab0bdb601621a9c39010f7c01e905c5fd17` |
| 4 | Semantic discovery on step 3 | call-site trace seeds returned; graph status `partial` (REA states this is not evidence of absence) | (same parent) |

REA's endpoint and storage inventory confirmed the chat data model: one
`/chats/{id}/messages/{id}` resource per turn, analytics and memories as
separate surfaces, and only UI preferences in local storage (`locale`,
dismissed banners); conversation state is never cached client-side. Because the
minified graph could not resolve component-level structure, the component
reading below comes from the matching open-source Svelte files
(`ResponseMessage.svelte`, `UserMessage.svelte`, `FollowUps.svelte`,
`StatusHistory.svelte`), which the shipped chunks were compiled from.

**Findings that changed the Rev build.**

1. **User turn** is `rounded-3xl`, `max-w-[90%]`, `px-4 py-1.5`, a neutral
   tonal fill (`bg-base-50` / dark `bg-base-850`), right-aligned. No gradient,
   no tail corner. *Rev:* the saturated brand gradient bubble became a tonal
   `#ECE9FB` / `rgba(255,255,255,0.08)` pill so the answer stays the focus.
2. **Assistant turn** is full width and unboxed, `pl-1`. No card, no label.
   *Rev:* the visible "SUMMARY" heading above every investigation answer was
   removed (kept as an `sr-only` heading for assistive tech).
3. **Action dock** is a row of `size-7` icon buttons (`rounded-lg`,
   `hover:bg-black/5`) with tooltips, visible on the **last** message and
   `hover-reveal` on older ones. *Rev:* icon-only dock with accessible names,
   36px on fine pointers and 44px on coarse pointers; latest answer always
   visible; older answers reveal on hover **or keyboard focus**, and only under
   `(hover: hover) and (pointer: fine)`, so touch users never lose it (this
   narrows, rather than reverses, adoption decision R2).
4. **Status history** collapses to the latest status line with a vertical
   dot-and-rule timeline on expand. *Rev already matches* (InvestigationTimeline
   compact line during streaming, "How I checked" after).
5. **Follow-ups** render as plain text rows separated by hairlines, not pills.
   *Rev keeps* its chip row (2 - 4 chips, 44px targets) because merchants tap
   on mobile; text-row styling is noted as an option.
6. **Composer** is a large-radius surface that grows with content. *Rev:* pill
   composer (`rounded-[26px]`), one line at rest, auto-grows to about 8 lines,
   round arrow-up send and round stop, soft elevation, fades over the thread
   instead of a hard top border.
7. **Thinking duration.** ChatGPT shows "Thought for Ns". *Rev:* "Worked for
   Ns · N checks", measured on the device from send to the `final` event, only
   for live turns that ran checks. Rehydrated turns show nothing rather than an
   invented duration (honest-progress rule P4).

**Commerce component catalog (adoption R5, now built).** ChatGPT's intelligent
UI lets the model emit whitelisted components rendered with client tokens. Rev
keeps the catalog-plus-tokens idea but binds every visual to data the turn
already holds, so no new backend contract was needed:

- **KPI cards** (`RevMetricCards`, `lib/revVisuals.deriveMetricCards`) are
  built only from `evidence.items` / `comparison_items`. A card shows the
  ledger value, the measured change against a matching previous-period record
  (same metric, unit and currency), and paired Now / Before bars. Shown only
  for 3+ usable numbers or any measured comparison; never while streaming;
  never in quiet modes. Direction uses arrows and words, never good/bad colour.
  Trust labels are never upgraded (partial stays "Partial data").
- **Table charts** (`RevTableChart`, `tableChartSpec`) are a Table / Chart
  switch on tables Rev already printed: 2 - 15 rows, a unique text label
  column, fully numeric value columns. Periods become an area chart in source
  order; categories become a horizontal bar chart sorted descending with direct
  value labels. A one-sentence text alternative is always visible. recharts is
  lazy-loaded only when a chart is opened.

ui-ux-pro-max guidance applied: `chart` domain (bar for ranked categories at
15 or fewer, sorted descending, direct labels, table fallback; line/area for
time), `ux` domain (loading feedback with accessible busy status, confirmation
on copy), `style` domain AI-native UI (minimal chrome, single accent, context
cards), `react` stack (memo only where measured, stable keys). Its generated
palette and fonts were rejected in favour of the Revluma tokens.

## Sources

1. performance.dev — *Reverse Engineering ChatGPT Web: How OpenAI Built for a Billion
   Users* (July 2026) — https://performance.dev/chatgpt
2. Thesys/OpenUI — *How ChatGPT's Intelligent UI works and how to build it* (Oct 2026) —
   https://www.openui.com/blog/how-chatgpt-intelligent-ui-works (+ thread:
   https://x.com/rabi_guha/status/2108238432355123572)
3. *The ChatGPT Design System Architecture* —
   https://thebestblogever.co/artificial-intelligence/chatgpt-design-system-architecture
4. setproduct — *AI chat interface UI design and the states users never see* —
   https://www.setproduct.com/blog/ai-chat-interface-ui-design
5. Wallpaper* — *OpenAI's first-ever rebrand* (Feb 2025) —
   https://www.wallpaper.com/tech/openai-has-undergone-its-first-ever-rebrand-giving-fresh-life-to-chatgpt-interactions
6. tigerabrodi.blog — *How To Build a Performant AI Markdown Renderer* —
   https://tigerabrodi.blog/how-to-build-a-performant-ai-markdown-renderer
7. meritshot — *Shadcn/ui Components Break When You Stream LLM Markdown Into Them* —
   https://www.meritshot.com/blog/bde-shadcn-streaming-llm-markdown
8. aiuxplayground — *Citations · Trust AI UX Pattern* —
   https://aiuxplayground.com/pattern/citations
9. aiuxplayground — *Follow-up Chips · Inputs AI UX Pattern* —
   https://aiuxplayground.com/pattern/follow-up-chips
10. ZDNET — *ChatGPT interactive tables and charts with GPT-4o* (May 2024) —
    https://www.zdnet.com/article/chatgpt-will-put-your-data-into-interactive-tables-and-charts-with-gpt-4o/
11. pagelive — *What Is Canvas in ChatGPT?* — https://pagelive.io/guides/chatgpt-canvas
12. LearningGPT — *Canvas: the editing surface that changes how you write* —
    https://learninggpt.ai/lessons/chatgpt/canvas-mastery
13. gntik-ui issue #113 — *ReasoningBlock behavioral spec* ("Thinking…" pulse →
    "Thought for Ns"; announce once) — https://github.com/gntik-ai/gntik-ui/issues/113
14. copilotinterview — *Design ChatGPT: System Design Interview Walkthrough* (SSE wire
    mechanics) — https://copilotinterview.com/blog/design-chatgpt
15. OpenAI community — DOM/token inspection (`.bg-token-message-surface`,
    `group/conversation-turn`) — https://community.openai.com/t/serious-ui-bug-in-dark-mode/1206042
16. r/ChatGPT — custom themes + motion-reduction in Settings → Appearance —
    https://www.reddit.com/r/ChatGPT/comments/1t0w3or/chatgpt_dark_theme_changed_from_gray_to_black/
17. note.com — *ChatGPT's UI policy* (rhythm-of-words analysis) —
    https://note.com/ohara_designer/n/n52b7a98730b2?hl=en
18. ai-markdown — streaming-aware markdown engine (repair, smooth pacing, block
    memoization) — https://github.com/ai-markdown/ai-markdown
19. itechguides — *Find and verify sources in ChatGPT search answers* —
    https://www.itechguides.com/how-to-find-and-verify-sources-in-chatgpt-search-answers/
20. ranki.io — *Anatomy of a citation* (3–6 source chips, inline vs end-block) —
    https://ranki.io/blog/chatgpt-citations-how-to-get-mentioned
21. r/ChatGPT — design A/B churn observed by users —
    https://www.reddit.com/r/ChatGPT/comments/1cv7z5u/why_does_chatgpt_keep_changing_its_design/
22. Open WebUI 0.13.5 (PyPI wheel; source github.com/open-webui/open-webui) -
    REA proxy artifact for section 10
