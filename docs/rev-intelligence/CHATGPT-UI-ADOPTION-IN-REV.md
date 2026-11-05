# ChatGPT UI Adoption in Rev — Pattern → Implementation → Test

**Date:** 2026-11-05 · **Companion study:** `CHATGPT-UI-REVERSE-ENGINEERING-STUDY.md`
(section references below point at the study)

This document records how the ChatGPT UI reverse-engineering study was applied to the
Rev merchant chat in `Frontend/Dashboard`, what was adopted, what was already present,
and — equally important — what was **rejected with reasons**. Rev's hard constraints
remain untouched: read-only MVP, gate-authoritative presentation (no report chrome on
conversational turns), evidence-bound claims only, no fabricated engagement.

---

## 1. Adopted in this change

| # | ChatGPT pattern (study §) | Rev implementation | Tests |
|---|---|---|---|
| A1 | Fenced code renders as a code surface with language label + copy, never raw backticks (§5) | `RevMarkdown.tsx` v2: fence-aware `splitRevBlocks()` treats code as atomic (blank lines inside fences no longer shatter blocks); unclosed fences (truncated answers) still render as code; language label or `code` fallback; dependency-free — content stays plain-text nodes, so the no-HTML-injection guarantee extends into code fences | `RevMarkdown.test.tsx` — 8 new cases incl. `<script>` inside a fence stays text |
| A2 | Copy reports only platform-confirmed success (§6 "never fake") | `copyTextToClipboard()` resolves true only on a confirmed write; button cycles `Copy …` → `Copied` / `Copy failed` (2s reset) | `revTableExport.test.ts` (3 clipboard cases), `RevMarkdown.test.tsx` (success + rejected-write) |
| A3 | Tables: Copy as CSV (rendered values, RFC 4180 escaping) / Copy as Markdown (verbatim source) (§5) | Table toolbar above every table block; CSV strips emphasis markers so exports carry rendered values; existing horizontal-scroll container kept; 44px touch targets (`min-h-11`, matching the repo's a11y convention) | `RevMarkdown.test.tsx` (toolbar), `revTableExport.test.ts` (escaping: commas, quotes, newlines) |
| A4 | Interactions disabled while streaming (§3, §6) | `streaming` prop flows `RevAnswerView → RevMarkdown`; code copy + table toolbars are not rendered until the turn completes; content stays fully readable meanwhile | `RevMarkdown.test.tsx` (streaming suppression), `RevAnswerView.test.tsx` (view-level passthrough) |
| A5 | Claim-adjacent citation chip → hover **preview popover** → sources panel (§5 "Citations": the three-tier trust system) | New `CitationChip.tsx` (variants `marker` + `source`) used by `RevAnswerView` for fact citations and the Sources row. Preview renders **only fields present on the retrieved `EvidenceItem`** (label, formatted value, source, period, definition, up to 2 limitations); absent fields read "Not supplied" — never invented. Opens on hover *and* keyboard focus, closes on leave/blur/Escape, `role="tooltip"` + `aria-describedby`. Click still opens the evidence panel focused on the record — the preview is additive, never a replacement for the source of truth | `CitationChip.test.tsx` (7 cases) + pinned contracts unchanged: `RevEvidenceDisclosure.test.tsx` (`Citation N: … — open evidence`, `Open evidence: …`, ordering) and `RevAnswerView.test.tsx` pass unmodified |
| A6 | "Scroll to bottom" pill: auto-follow pins unless the merchant scrolls up; rejoining is one click (§6) | `JumpToLatest.tsx` + `RevIntell.tsx` wiring: hysteresis (appears past 160px from bottom, auto-follow re-arms under 80px) so small overscrolls never flicker it; always mounted so show/hide animate (150ms, inside the app-wide reduced-motion kill switch); `aria-hidden` + `tabIndex=-1` + `pointer-events:none` when hidden | `JumpToLatest.test.tsx` (3 cases), `RevIntell.test.tsx` — page-level: reveal on scroll-away, click rejoins (`scrollIntoView`), hidden at bottom, hysteresis band |
| A7 | Semantic design-token layer instead of scattered literals (§2 `token-*`, §8.8) | `revTokens.ts`: one palette per tone (strong/body/muted/border/surface/overlay/accent/accentSoft/codeBg/tableHeadBg/shadow…) with values mirroring the shipped palette — a refactor with no visual change. TS module (not CSS vars) because Rev components receive `tone`/`dark` as props inside hosts that may not carry the dashboard theme class | Implicit via all component tests; token values = previous literals |
| A8 | Per-block memoization — unchanged blocks skip re-render (§3) | `RevMarkdown` blocks are `React.memo` components keyed by content; host re-renders only re-render changed blocks | Behavioral parity pinned by existing `RevMarkdown` tests |

## 2. Already present in Rev (verified during the study, left untouched)

- **Queued state without fake progress** (§6.1): the `LoadingBar` shimmer placeholder
  with `role="status" aria-label="Rev is preparing a response"` is the study's
  "pulsing dot or shimmering line" pattern; no percentage bar anywhere.
- **Stop button swap + honest cancellation** (§6): AbortController, Stop replaces Send,
  "Generation stopped." + Regenerate.
- **Auto-scroll pinning** (§6.3): pinned-to-bottom follow discipline existed; A6 adds
  only the return affordance.
- **Reduced-motion** (§8.9): `MotionConfig reducedMotion="user"` + a CSS kill switch for
  all animations under `.rev-workspace`.
- **Action dock** (§4): Copy/Retry row under completed answers with hover color shift,
  44px targets — kept always-visible (see R2).
- **Follow-up chip grammar** (§5): 2–4 chips, per-answer (refreshed automatically with
  each payload), disabled without a handler, never blocking the composer.
- **Progressive disclosure of effort** (§5 "Reasoning"): `InvestigationTimeline`
  collapsible card + compact live line naming the check actually running, with labels
  from backend step metadata — *never from a timer* (stronger than ChatGPT's elapsed
  counter, which would be fabrication for Rev's event-based turns).
- **Gate-authoritative quiet presentation** (§4 "assistant unboxed"): conversational /
  clarify / refuse turns render no report scaffolding — Rev's equivalent of ChatGPT's
  full-width unboxed assistant voice, and a standing directive.
- **Radix primitives + Tailwind** (§2): same component philosophy as ChatGPT's stack.

## 3. Rejected / deferred, with reasons

| # | Pattern | Decision | Reason |
|---|---|---|---|
| R1 | Token-by-token streaming text with pulsing caret and typewriter pacing (§3, §6.3) | **Not applicable — architectural difference, documented** | Rev's SSE protocol delivers structured events (`plan`, `step`, `evidence`, `final`); the answer text arrives complete at `final`. Adding a fake typewriter over already-complete text would violate the never-fake rule (§6.1) that Rev enforces everywhere else. The honest queued state (LoadingBar) covers the wait. If the backend later streams text deltas, `RevMarkdown` v2 is already prepared: `streaming` suppression, fence repair semantics and per-block memoization are the exact pipeline the study prescribes. |
| R2 | Hover-hidden action dock (opacity 0→1) (§4) | **Rejected** | Touch devices and keyboard users lose discoverability; Rev's dock is already low-contrast and unobtrusive. ChatGPT's own dock predates touch-first usage patterns; Rev's merchants are heavily mobile (Shopify admin habit). |
| R3 | CodeMirror 6 per code block (§2, §5) | **Deferred** | Rev's answers are commerce prose; code fences are rare and short. A dependency-free `<pre>` + copy keeps the bundle lean and preserves the no-injection guarantee. Revisit only if Rev starts emitting substantial code (it should not — read-only MVP). |
| R4 | Interactive tables (click-a-cell follow-ups, full-screen expand) (§5, [10]) | **Deferred (P2)** | Requires backend follow-up context binding (cell → subject/period). Copy CSV/Markdown (A3) ships the merchant-value core now. A future increment can bind cell clicks to the existing follow-up chip machinery. |
| R5 | DIL-style model-written interfaces (§7) | **Deferred (P2), principle adopted** | Rev must never render model-chosen structure without an evidence binding — but DIL's *safety principle* (whitelisted component catalog + design tokens, never arbitrary markup) is exactly Rev's existing posture: `RevMarkdown` constructs nodes from plain text only, and presentation modes are backend-gate-selected. A future commerce component catalog (KPI card, period-compare, order table) should follow the same catalog+tokens discipline. |
| R6 | Canvas side panel for long artifacts (§5) | **Deferred (P2)** | Rev already routes report-grade content through findings/briefings surfaces instead of chat walls (gate-authoritative). A canvas-style panel is a natural home for "show me the full report" asks; needs its own UX pass. |
| R7 | Webfont brand typeface (§2, §5) | **Rejected** | ChatGPT itself ships a system font stack in-app for performance [1]; Rev keeps the dashboard's existing font loading untouched. |
| R8 | Percentage progress / estimated-time indicators | **Rejected** | Study §6.1 anti-pattern; also a Rev honesty-rule violation. |

## 4. Verification

- **Dashboard suite:** 480/480 passing (was 449 before this change; +31 new tests across
  `RevMarkdown`, `revTableExport`, `CitationChip`, `JumpToLatest`, `RevAnswerView`,
  `RevIntell`). Production build green (`vite build`).
- **Pinned contracts:** every pre-existing Rev presentation/disclosure/parity test passes
  unmodified — including the citation aria-label contracts, quiet-presentation gates and
  legacy parity.
- **Lint:** no new findings (the 9 pre-existing `no-explicit-any` errors in
  `RevIntell.tsx` are present at HEAD and untouched; lint is not a CI gate).
- **No backend/DB/schema changes** — frontend-only increment; read-only MVP,
  tenant isolation and evidence contracts untouched.

## 5. Files touched

```
Frontend/Dashboard/src/lib/revTokens.ts               (new — semantic token layer)
Frontend/Dashboard/src/lib/revTableExport.ts          (new — CSV/Markdown export + honest clipboard)
Frontend/Dashboard/src/lib/revTableExport.test.ts     (new)
Frontend/Dashboard/src/components/rev/RevMarkdown.tsx (v2 — fences, code surface, toolbars, streaming, memo)
Frontend/Dashboard/src/components/rev/RevMarkdown.test.tsx (extended)
Frontend/Dashboard/src/components/rev/CitationChip.tsx      (new — hover-preview citation)
Frontend/Dashboard/src/components/rev/CitationChip.test.tsx (new)
Frontend/Dashboard/src/components/rev/JumpToLatest.tsx      (new — back-to-latest pill)
Frontend/Dashboard/src/components/rev/JumpToLatest.test.tsx (new)
Frontend/Dashboard/src/components/rev/RevAnswerView.tsx     (chips + streaming passthrough)
Frontend/Dashboard/src/components/rev/RevAnswerView.test.tsx (extended)
Frontend/Dashboard/src/pages/RevIntell.tsx                  (pill wiring + hysteresis + wrapper)
Frontend/Dashboard/src/pages/RevIntell.test.tsx             (extended — scroll discipline)
```
