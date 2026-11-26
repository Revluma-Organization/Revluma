# Page override: Landing "Meet Rev" chat demo

Scope: `Frontend/Landing/src/components/meet-rev/` (MeetRevSection.tsx, meet-rev.css) and `MEET_REV` in `src/content.ts`.
Everything not listed here follows `design-system/revluma/MASTER.md`.

## Problem

The demo answered "Why did my sales drop last week?" with one sentence, a disclosure and a chip. Visitors read that as a
thin, unconvincing assistant. The goal is a reply that looks like a strong AI analyst's answer (ChatGPT-style structure)
while keeping Rev's evidence rules: facts are cited, guesses are labelled, limits are stated, and Rev never changes the store.

## UI UX Pro Max queries and what was used

| Query (domain) | Top result | Used |
| --- | --- | --- |
| `AI chatbot assistant conversational analytics` (product) | AI/Chatbot Platform: AI-Native UI + Minimalism & Swiss, neutral + one AI accent, Interactive Product Demo | Neutral surfaces, one indigo accent (`#1F06AC`), no glass or gradients in the window |
| `AI-Native UI` (style) | Minimal chrome, streaming text, typing indicator, context cards with border-left accent, AI responses distinct, input always visible | Streamed block reveal, 3-dot typing indicator while working, "Bottom line" callout with a left rule, composer always in view |
| `chat interface streaming message AI response` (ux) | Streaming (don't spin for long), Disclaimer (label AI content), Feedback loop (thumbs, regenerate) | Answer unfolds top to bottom; "Rev" name row with an "AI" tag; Copy / Read aloud / thumbs / Ask again kept |
| `content density readability long text` (ux) | Body text contrast, number formatting | Body text `#1D2433` on `#F7F8FC`; tabular numerals; separators (1,042) |
| `data table inline comparison chart small` (chart) | Bar chart for categories; never colour alone; direct labels; text fallback | Daily bar chart with direct value labels, a dashed reference line and a text summary in `aria-label`; split bar with a written legend |

The generator's default palette and font were not adopted: the brand system wins.

## Rules

1. **Answer first, then evidence.** Every reply opens with a one-line lede (`.mr-lead`), then headed sections.
2. **One visual per idea.** Ask: KPI strip + daily chart + bottom line. Verify: cited facts + order split + "Ruled out" + source cards.
   Interpret: evidence ladder (Verified / Not verified / Not visible) + hypotheses with "How to check" + unknowns.
   Recommend: numbered plan ("Start here" / "Next" / "When you can"), a success measure, the no-changes note and a monitoring line.
3. **Status is never colour alone.** Every coloured square has a word next to it.
4. **The way forward is always visible.** The follow-up chip lives on the composer, outside the scrolling log.
5. **Real chat scrolling.** The log is a fixed-height scroller (33rem wide, 30rem narrow). History is kept; each new question
   scrolls to the top of the pane (the current turn has a min-height so it can), and only the pane scrolls, never the page.
   A "jump to latest" button appears when content is below the fold. "Start over" clears the history.
6. **Motion plays once.** Blocks stream in with a 0.13s stagger and a top-down mask that is removed when it ends (`backwards`
   fill, so focus rings are never clipped). Only the working indicators loop, and only while Rev is working.
   Reduced motion shows the final answer immediately.
7. **Numbers stay consistent and money-free.** The daily mobile rates average 38.2%; the order split is 37 + 8 = 45;
   sources cover 517 orders and 1,042 checkouts. All are covered by `meet-rev.test.tsx`.
8. **Contrast.** All text in the window is at least 4.5:1 (checked at 360px and 1440px); the only exception is the
   decorative breadcrumb "/" separator.
