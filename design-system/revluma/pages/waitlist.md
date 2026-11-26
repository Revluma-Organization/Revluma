# Page Override: /waitlist (Founding Merchants application)

> Overrides `design-system/revluma/MASTER.md` for the application page at
> `/waitlist` (`Frontend/waitlist.html` + `Frontend/Landing/src/waitlist/`).
> Anything not listed here follows Master.

**Decided:** 2026-11-18, round 6 (waitlist rebuilt into a saved, multi-step
Founding Merchants application; user asked for Revluma's look, not a generic form builder).

## How this was derived (ui-ux-pro-max)

| Query | Verified result | Used |
|---|---|---|
| `"multi-step form progress wizard" --domain ux` | Progress Indicators: "Step 2 of 4 indicator"; Submit Feedback: loading then success/error | ✅ "Step n of 4" in the card (wide screens) and above it (small screens), a progress bar, a vertical step rail |
| `"form validation error inline" --domain ux` | Focusable Error Summary (role=alert, tabindex=-1, links to fields, keep inline errors, don't move focus on blur); Inline Validation on blur | ✅ summary focused only after a failed Continue; fields validate on blur; errors via `aria-describedby` + `aria-live` |
| `"loading button disabled double submit" --domain ux` | Loading Buttons: disable and show loading; no multiple clicks | ✅ Continue/Submit disable with a spinner while saving; a ref guard drops repeat clicks |
| `"touch target size spacing" --domain ux` | 44pt minimum targets, 8px gaps | ✅ inputs and buttons 48px, choices 44 to 64px, 8px gaps |
| `"reduced motion animation" --domain ux` | Respect prefers-reduced-motion; animate 1 to 2 key elements per view | ✅ only the step panel and the completion tick animate; everything is cut for reduced motion |
| `"success confirmation animation" --domain ux` | Show success visually; brief message | ✅ drawn check + "Application received" page |
| `"SaaS onboarding application form premium" --design-system` | Accessible & Ethical style (16px+ text, visible focus, keyboard) | ✅ style rules. ❌ its navy/green palette and marketplace pattern: Master brand wins |

## Rules

- **Brand tokens, no new palette.** Canvas `#FBFAF8`, ink `#0C0A1D`, hairline
  `#E8E6E1`, muted `#5E5C6B`, one accent `#2B13CF` (deep `#1F06AC`, wash
  `#EEEBFF`). Same values as the landing Tailwind config and `auth-theme.css`.
- **Type:** Instrument Sans Variable for UI; the landing headline face
  (Arial Black / Archivo Black) only for the page H1 and the pass label.
- **Layout:** wide screens = intro, live Founding Merchant pass and step rail on
  the left, one white card on the right. Small screens = eyebrow, H1, progress
  bar, card, then the saved note. Mobile first; no horizontal scroll at 360px.
- **The pass** reuses the homepage programme card (indigo gradient, fine grid)
  and fills in the applicant's store, step and status. Decorative (`aria-hidden`).
- **Choices are labels around native inputs** (radio/checkbox) covering the
  whole card, so keyboard, screen readers and taps work without custom ARIA.
  Selected = accent border + wash + inset ring. Multi-select with a limit shows
  "n of 3 selected" and disables the rest at the limit.
- **Price question:** tiles in a 5 x 2 grid (2 columns on phones), nothing
  preselected, "per month" under each amount, "No charge" under Free.
- **Save bar:** sticky footer in the card: Back (ghost), save status, primary
  button (ink, hover deep indigo). Status words are exactly "Saving…", "Saved",
  "Unable to save. Retry."; the button turns into "Retry" after a failure.
- **Honest completion:** "Application received", "being considered for
  Founding Merchant access", contact by email. The real queue number is shown
  with "a place is not a guarantee of access". No countdowns, no invented stats.
- **Motion:** step panel slides 18px from the direction of travel (0.42s,
  ease-out quint), progress fill animates with `transform: scaleX`, choice
  marks scale in, completion ring and tick draw once. Nothing loops except the
  saving spinner and the loading skeleton; all of it is off for reduced motion.
- **Copy:** sentence case, no em-dashes, no "read-only" wording (house style,
  enforced by `src/test/waitlist.test.tsx`).
