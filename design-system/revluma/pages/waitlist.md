# Page Override: /waitlist (Founding Merchants application)

> Overrides `design-system/revluma/MASTER.md` for the application page at
> `/waitlist` (`Frontend/waitlist.html` + `Frontend/Landing/src/waitlist/`).
> Anything not listed here follows Master.

**Decided:** 2026-11-26, round 6 (waitlist rebuilt into a saved, multi-step
Founding Merchants application; user asked for Revluma's look, not a generic form builder).

**Revised:** 2026-11-27, round 7. The user asked for the form to be as clean as
the auth pages and to "not feel like another form": motion and 3D the applicant
plays with. Also: ranges written "A - B" (never "A to B"), US phone examples,
no em dashes anywhere.

## How this was derived (ui-ux-pro-max)

| Query | Verified result | Used |
|---|---|---|
| `"multi-step form progress wizard" --domain ux` | Progress Indicators: "Step 2 of 4 indicator"; Submit Feedback: loading then success/error | ✅ "Step n of 4" in the card (wide screens) and above it (small screens), a progress bar, a vertical step rail |
| `"form validation error inline" --domain ux` | Focusable Error Summary (role=alert, tabindex=-1, links to fields, keep inline errors, don't move focus on blur); Inline Validation on blur | ✅ summary focused only after a failed Continue; fields validate on blur; errors via `aria-describedby` + `aria-live` |
| `"loading button disabled double submit" --domain ux` | Loading Buttons: disable and show loading; no multiple clicks | ✅ Continue/Submit disable with a spinner while saving; a ref guard drops repeat clicks |
| `"touch target size spacing" --domain ux` | 44pt minimum targets, 8px gaps | ✅ inputs and buttons 48px, choices 44 to 64px, 8px gaps |
| `"reduced motion animation" --domain ux` | Respect prefers-reduced-motion; animate 1 to 2 key elements per view | ✅ only the step panel and the completion tick animate; everything is cut for reduced motion |
| `"success confirmation animation" --domain ux` | Show success visually; brief message | ✅ drawn check + "Application received" page |
| `"SaaS merchant onboarding application interactive premium" --design-system --motion 8 --variance 6` (round 7) | Motion 8/10 "Complex"; avoid "cheap visuals + fast animations"; pre-delivery checklist (Lucide icons, hover 150 to 300ms, focus, reduced motion, 375 to 1440px) | ✅ motion dial and checklist. ❌ its Liquid Glass style, black/gold palette and Cormorant font: Master brand and auth tokens win |
| `"3d tilt card perspective" --domain style` | Dimensional Layering: translateZ depth, elevation shadows; accessibility risk high, requires reduced motion | ✅ pass layers lift with `translateZ`, keycap shadows on tiles; all 3D off for reduced motion |
| `"card flip 3d" --domain gsap` | Magnetic/pointer hover: stable named handler with cleanup, clamp strength, `will-change: transform`, at most 1 or 2 focal elements | ✅ `useTilt`: one focal element (the pass), clamped angle, listeners removed on unmount, CSS vars only |
| `"segmented control selection" --domain ux` | Cancellable state transitions: set the final semantic state directly, never depend on `animationend` | ✅ selection is the native input's checked state; animations are decoration on top |
| `"badge chip label wraps" --domain ux` | Compact labels stay on one line | ✅ range tiles are `nowrap`; long store names ellipsize on the pass |
| `"3d transform performance" --domain ux` | Animate transform and opacity only | ✅ every animation is transform/opacity; the confetti is one canvas |
| `"SaaS onboarding application form premium" --design-system` | Accessible & Ethical style (16px+ text, visible focus, keyboard) | ✅ style rules. ❌ its navy/green palette and marketplace pattern: Master brand wins |

## Rules

- **Auth tokens, no new palette.** Canvas `#FBFAF8`, ink `#0C0A1D`, hairline
  `#E8E6E1`, muted `#5E5C6B`, one accent `#2B13CF` (deep `#1F06AC`, wash
  `#EEEBFF`), plus the auth dark theme (`html.dark`, set by
  `/assets/js/theme.js`). Same values as `auth-theme.css`.
- **Auth shell:** the dark pill navbar (560px, 52px tall, white logo disc,
  white "Back to site" pill), 24px card radius, 48px inputs with the 4px focus
  ring, and the ink pill primary button with the shimmer and round arrow chip.
- **Type:** Instrument Sans Variable for UI; the landing headline face
  (Arial Black / Archivo Black) for the page H1, step titles and the pass label.
- **Layout:** wide screens = intro, live Founding Merchant pass and step rail on
  the left, one card on the right. Small screens = eyebrow, H1, a compact pass,
  the card (progress bar inside its top edge), then the saved note. Mobile
  first; no horizontal scroll at 360px. Card layouts use container queries.
- **The pass** reuses the homepage programme card (indigo gradient, fine grid)
  and fills in live: store, monthly orders, status and a completion meter (the
  share of the 11 required answers). It tilts toward the pointer on a damped
  spring with a glare that follows the cursor (mouse and trackpad only; touch
  gets a slow idle float), sweeps light when a new answer lands, and flips to
  its back (queue number, "Application received") on submit. Decorative
  (`aria-hidden`): everything on it is also in the form.
- **Choices are labels around native inputs** (radio/checkbox) covering the
  whole tile, so keyboard, screen readers and taps work without custom ARIA.
  Tiles are keycaps: a raised bottom edge that lifts on hover and presses down
  when chosen; selected = accent border + wash + ring. Questions with several
  answers use Lucide icon tiles (`src/waitlist/icons.ts`); ordered ranges
  (store age, monthly orders) are "scale" tiles with rising bars and the number
  large, the unit small. Multi-select with a limit shows dots plus "n of 3
  selected" and disables the rest at the limit.
- **Ranges:** always "A - B" ("0 - 20", "3 - 6 months"), never "A to B". The
  option keys the backend validates (`0_20`, `3_6m`, ...) never change.
- **Examples:** phone placeholders are US numbers ("+1 (555) 123-4567").
- **Price question:** tiles in a 5 x 2 grid (2 columns on phones), nothing
  preselected, "per month" under each amount, "No charge" under Free.
- **Save bar:** sticky footer in the card: Back (ghost), save status, primary
  button (ink, hover deep indigo). Status words are exactly "Saving…", "Saved",
  "Unable to save. Retry."; the button turns into "Retry" after a failure.
- **Honest completion:** "Application received", "being considered for
  Founding Merchant access", contact by email. The real queue number is shown
  with "a place is not a guarantee of access". No countdowns, no invented stats.
- **Motion:** spring easing (`cubic-bezier(.34,1.56,.64,1)`) for presses and
  pops, ease-out quint for entrances. The step panel swings in from the
  direction of travel (28px plus a 7 degree turn), then its parts rise in a
  short stagger. The progress bar has one segment per step; the current one
  fills live as its required answers come in. Completion: the ring and tick
  draw, a ripple, a 1.8 second canvas confetti burst and the pass flip. With
  reduced motion, all of it resolves instantly, the pass stays flat and the
  confetti never renders.
- **Copy:** sentence case, no em dashes, no "read-only" wording (house style,
  enforced by `src/test/waitlist.test.tsx`, which also checks the "A - B"
  ranges, the US phone placeholder and the reduced-motion rules).
