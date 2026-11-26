# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/revluma/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** Revluma
**Generated:** 2026-11-26 08:56:42 (ui-ux-pro-max `--design-system`)
**Reconciled:** 2026-11-26 — palette, typography, style, and page pattern replaced with
shipped Revluma brand truth. Spacing, shadows (extended), anti-patterns, and the
pre-delivery checklist are kept from the generator.

**Brand sources:** shipped command-center contract (`tokens.ts`), severity system
(`findingDisplay.ts`), dashboard theme (`index.css`, Tailwind v3 config).
Generator defaults that conflicted (blue/amber palette, Fira typography,
Enterprise Gateway landing pattern) were deliberately discarded — see
“Reconciliation notes” at the bottom.

**Theme behavior (v1):** command-center surfaces are light-locked and
theme-invariant — token values are identical in every theme, so this migration
is a pure refactor with zero visual change. Dark-theme adaptation of
command-center is an explicit future slice, not part of v1.

---

## Global Rules

### Color Palette

Single source of truth: `palette` in
`Frontend/Dashboard/src/components/command-center/tokens.ts`.
Tailwind theme colors (`brand-*`, `ink-*`, …) are derived from it by import —
never duplicate a value.

| Role | Hex | Token |
|------|-----|-------|
| Brand (primary violet) | `#4438E8` | `brand` / `palette.brand.DEFAULT` |
| Brand strong (hover) | `#372CD1` | `brand-strong` |
| Brand deep | `#3525B8` | `brand-deep` |
| Brand deeper | `#1F06AC` | `brand-deeper` |
| Brand bright (gradient) | `#5146E5` | `palette.brand.bright` (TS only) |
| Brand band violet | `#2B13CF` | `brand-band` |
| Brand soft wash | `#F0EDFF` | `brand-soft` |
| Brand mist | `#EDEAFF` | `brand-mist` |
| Brand pale (skeleton bars) | `#E3E1FA` | `brand-pale` |
| Brand hairline | `#D8D7FA` | `brand-line` |
| Brand hairline strong | `#C9C7FA` | `brand-lineStrong` |
| Ink (primary text) | `#17191F` | `ink` |
| Ink soft (body) | `#343844` | `ink-soft` |
| Ink muted | `#707582` | `ink-muted` |
| Ink tertiary (eyebrows) | `#667085` | `ink-tertiary` |
| Ink steel | `#526071` | `ink-steel` |
| Ink faint | `#98A2B3` | `ink-faint` |
| Ink ghost (decorative glyphs) | `#D0D5DD` | `ink-ghost` |
| Hairline | `#E7E9EF` | `line` |
| Hairline soft | `#EEF0F4` | `line-soft` |
| Hairline strong | `#D9DCE5` | `line-strong` |
| Success | `#067647` | `success` |
| Success bright (dots) | `#12B76A` | `success-bright` |
| Success wash | `#ECFDF3` | `success-soft` |
| Success hairline | `#ABEFC6` | `success-line` |
| Danger | `#B42318` | `danger` |
| Danger strong (dots) | `#DC2626` | `danger-strong` |
| Danger deep | `#991B1B` | `danger-deep` |
| Danger deeper (hover) | `#7F1D1D` | `danger-deeper` |
| Danger limited-evidence | `#9C2B25` | `danger-limited` |
| Danger wash | `#FEF2F2` | `danger-soft` |
| Danger hairline | `#FECACA` | `danger-line` |
| Warning | `#92400E` | `warning` |
| Warning strong (dots) | `#D97706` | `warning-strong` |
| Warning wash | `#FFFBEB` | `warning-soft` |
| Warning hairline | `#FDE68A` | `warning-line` |
| Warning hairline strong | `#F5D68B` | `warning-lineStrong` |
| Info | `#2B59C3` | `info` |
| Info bright (links) | `#4777F5` | `info-bright` |
| Info wash | `#EDF4FF` | `info-soft` |
| Info hairline | `#D6E4FF` | `info-line` |
| Band ink (deep violet-black) | `#17152F` | `palette.band.bg` / `scrim` overlay |
| Band text | `#EDEAFF` | `band` |
| Band body | `#D9D4EC` | `band-body` |
| Band faint | `#A9A3C7` | `band-faint` |
| Band accent | `#C9C2FF` | `band-accent` |
| Workspace surface | `#F4F5F8` | `workspace` |
| Subtle surface | `#F8F9FB` | `subtle` |
| Cool wash | `#F4F6FA` | `wash` |
| Lavender veil | `#F5F7FF` | `veil` |
| Skeleton block | `#EEF0F6` | `skeleton` |
| Connected-state green | `#5E8E3E` | `connected` |

**Severity ramp** (full `{ base, deep, softBg, border }` meta in
`palette.severity`; class utilities expose the bases only):

| Severity | Base | Deep | Soft wash | Hairline |
|----------|------|------|-----------|----------|
| Critical | `#E5484D` | `#A12A22` | `#FFF5F4` | `#F3C7C3` |
| High | `#F07832` | `#9A4A12` | `#FFF6F0` | `#F5D3B8` |
| Medium | `#E5A126` | `#925B13` | `#FFFDF4` | `#F2DDB8` |
| Low | `#6475E8` | `#39449F` | `#F4F6FF` | `#D8D7FA` |

Class utilities: `severity-critical`, `severity-high`, `severity-medium`, `severity-low`.

**Reserved one-offs** (exact values, own the semantic — do not merge):
`deck-ghost #B4B2C0`, `deck` tier glyphs `#D9383E` / `#B47409`, deck muted
glyph `#A5A3B2`, deck empty dot `#C9C8D4`, signal stale `#DC6803`, signal
failed `#D92D20`, scrim `#17152F` (aliases `band.bg`).

**Hard rules:**
- No raw hex in command-center components — `palette`, theme utilities
  (`bg-brand`, `text-ink-muted`, …), stock Tailwind colors (`text-slate-500`),
  or the `white` / `transparent` keywords only. Enforced by
  `tokens.test.ts` (fails the suite on any raw hex outside `tokens.ts`).
- Alpha-composited `rgba()` derivatives of palette colors (mesh washes,
  glows) stay inline at the usage site — they are transparent variants, not
  new colors.
- Text colors merge only when visually indistinguishable (ΔE ≲ 1) AND the
  pair never renders in the same component — see Normalization log. Text
  hierarchy is never flattened.

### Typography

- **Body/UI:** Instrument Sans (`font-sans`: `"Instrument Sans", system-ui, sans-serif`)
- **Serif accents:** Instrument Serif (`font-serif`)
- **Display:** DM Sans (`font-display`, tracking `-0.035em`)
- **Mono (IDs, timestamps, numerals):** system `font-mono` stack, `tabular-nums` for figures
- Base `html` font-size `14px`; antialiased.

```css
@import url('https://fonts.googleapis.com/css2?family=Instrument+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Instrument+Serif:ital@0;1&family=DM+Sans:wght@700;800;900&display=swap');
```

### Spacing Variables

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | `4px` / `0.25rem` | Tight gaps |
| `--space-sm` | `8px` / `0.5rem` | Icon gaps, inline spacing |
| `--space-md` | `16px` / `1rem` | Standard padding |
| `--space-lg` | `24px` / `1.5rem` | Section padding |
| `--space-xl` | `32px` / `2rem` | Large gaps |
| `--space-2xl` | `48px` / `3rem` | Section margins |
| `--space-3xl` | `64px` / `4rem` | Hero padding |

(Identical to the Tailwind default scale — use stock spacing utilities.)

### Shadow Depths

Generator depths kept, plus the shipped glass elevations:

| Level | Value | Usage |
|-------|-------|-------|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)` | Subtle lift |
| `--shadow-md` | `0 4px 6px rgba(0,0,0,0.1)` | Cards, buttons |
| `--shadow-lg` | `0 10px 15px rgba(0,0,0,0.1)` | Modals, dropdowns |
| `--shadow-xl` | `0 20px 25px rgba(0,0,0,0.15)` | Hero images, featured cards |
| `--shadow-glass` | `0 4px 24px -6px rgba(15,23,42,0.08), 0 1px 3px rgba(15,23,42,0.04), inset 0 1px 1px rgba(255,255,255,0.95)` | Frosted cards, heroes, panes |
| `--shadow-glass-sm` | `inset 0 1px 1px rgba(255,255,255,0.9), 0 2px 10px -3px rgba(15,23,42,0.06)` | Tiles, chips, bento cells |
| `--shadow-cta` | `0 6px 18px -4px rgba(31,6,172,0.5), inset 0 1px 0 rgba(255,255,255,0.25)` | Primary gradient CTA |

### Glass Effects

- Frosted fills: `bg-white/70`–`/85` + `backdrop-blur-xl` (shells), `-md` (tiles/chips)
- Frosted hairlines: `border-white/60`
- Mesh washes: violet `rgba(68,56,232,α)` + teal `rgba(20,184,166,α)` radials over white
- Inset highlight on every glass surface (see `--shadow-glass*`)
- Radii: cards `rounded-2xl`, tiles `rounded-xl`, chips `rounded-full`, CTAs `rounded-[10px]`–`rounded-xl`
- Motion: expo-out entrances (`[0.16,1,0.3,1]`, ≤0.5s, staggered ≤70ms), 200ms
  hover transitions, full `prefers-reduced-motion` support (see global CSS + `MotionConfig`)

---

## Component Specs

### Buttons

```css
/* Primary CTA — deep-violet gradient, white text */
.btn-primary {
  background: linear-gradient(135deg, #5146E5 0%, #3525B8 55%, #1F06AC 100%);
  color: white;
  box-shadow: var(--shadow-cta);
  border-radius: 10px;
  font-weight: 600;
  transition: filter 200ms ease, brightness 200ms ease;
  cursor: pointer;
}
.btn-primary:hover { filter: brightness(1.1); }

/* Secondary — frosted hairline button */
.btn-secondary {
  background: rgba(255, 255, 255, 0.8);
  color: #17191F;
  border: 1px solid #E7E9EF;
  border-radius: 10px;
  font-weight: 600;
  transition: background-color 200ms ease;
  cursor: pointer;
}
.btn-secondary:hover { background: #F4F5F8; }
```

### Cards

```css
/* Glass bento card */
.card {
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(24px);
  border: 1px solid rgba(255, 255, 255, 0.6);
  border-radius: 16px;
  box-shadow: var(--shadow-glass);
  cursor: pointer;
}
```

### Inputs

```css
.input {
  padding: 12px 16px;
  border: 1px solid #E7E9EF;
  border-radius: 8px;
  font-size: 16px;
  transition: border-color 200ms ease;
}
.input:focus {
  border-color: #4438E8;
  outline: none;
  box-shadow: 0 0 0 3px rgba(68, 56, 232, 0.2);
}
```

### Overlays / Drawers

```css
.drawer-overlay {
  background: rgba(23, 21, 47, 0.45); /* scrim #17152F at 45% */
  backdrop-filter: blur(2px);
}
.drawer {
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(32px);
  border-left: 1px solid rgba(255, 255, 255, 0.6);
  box-shadow: 0 0 60px -12px rgba(31, 6, 172, 0.25);
}
```

---

## Style Guidelines

**Style:** Glassmorphic Data-Dense Dashboard

**Keywords:** frosted bento cards, mesh gradient washes, KPI tiles, data tables,
ranked finding queues, minimal padding, grid layout, space-efficient, maximum
data visibility

**Best For:** operational commerce intelligence — verified findings ranked by
urgency, evidence provenance, merchant next steps

**Key Effects:** metric value tweens on change, staggered card entrances, hover
edge-light + lift, row highlighting on hover, smooth filter animations, glass
skeleton shimmer while loading

### Page Pattern

**Pattern Name:** Operational Dashboard

- **Hierarchy:** Welcome + workspace status → Top priorities (ranked findings) →
  Operational briefing → Supporting intelligence (signals, coverage) → Activity
- **Conversion Strategy:** every finding carries a verbatim title, recorded
  evidence, and exactly one Rev handoff (investigate route). No dead ends.
- **CTA Placement:** primary finding action (`Ask Rev about this`) + secondary
  (`Investigate with Rev` / backend label) per card; `Ask Rev about this
  finding` sticky in the details drawer.
- **Section Order:** Header (identity + status pills) > Severity filter >
  Detected issues queue > Recent signals > Coverage & provenance

---

## Anti-Patterns (Do NOT Use)

- ❌ Ornate design
- ❌ No filtering
- ❌ Raw hex / hardcoded colors in components (use `palette` + theme utilities)
- ❌ Duplicate token values (single source: `palette`)

### Additional Forbidden Patterns

- ❌ **Emojis as icons** — Use SVG icons (Heroicons, Lucide, Simple Icons)
- ❌ **Missing cursor:pointer** — All clickable elements must have cursor:pointer
- ❌ **Layout-shifting hovers** — Avoid scale transforms that shift layout
- ❌ **Low contrast text** — Maintain 4.5:1 minimum contrast ratio
- ❌ **Instant state changes** — Always use transitions (150-300ms)
- ❌ **Invisible focus states** — Focus states must be visible for a11y

---

## Pre-Delivery Checklist

Before delivering any UI code, verify:

- [ ] No emojis used as icons (use SVG instead)
- [ ] All icons from consistent icon set (Heroicons/Lucide)
- [ ] `cursor-pointer` on all clickable elements
- [ ] Hover states with smooth transitions (150-300ms)
- [ ] Light mode: text contrast 4.5:1 minimum
- [ ] Focus states visible for keyboard navigation
- [ ] `prefers-reduced-motion` respected
- [ ] Responsive: 375px, 768px, 1024px, 1440px
- [ ] No content hidden behind fixed navbars
- [ ] No horizontal scroll on mobile
- [ ] `tokens.test.ts` passes (no raw hex, palette↔class sync, severity pins)

---

## Implementation Map

```
MASTER.md (this file — human source of truth)
  └─ palette ─── Frontend/Dashboard/src/components/command-center/tokens.ts
       ├─ Tailwind theme colors (tailwind.config.ts imports palette)
       │    └─ bg-brand, text-ink-muted, border-line-soft, … (class utilities)
       ├─ cc / shell pattern entries (literal class strings — pinned by tests)
       ├─ findingDisplay.ts severity meta (reads palette.severity)
       └─ inline styles / gradients (palette.gradient.cta | .band | .orb)
```

`cc` / `shell` class strings embed literal values (Tailwind's scanner and the
test suite both require literal class names). `tokens.test.ts` asserts every
tested `cc` / `shell` string contains its palette value, so the two spellings
cannot drift.

## Normalization Log (v1 migration)

Each line: discarded value → canonical token. All merges are decorative
surfaces/hairlines or indistinguishable dupes (ΔE ≲ 2); no text hierarchy,
brand, status, severity, or focus color was flattened. Text merges additionally
required: the pair never renders in the same component.

**Surfaces → canonical:**
`#FAFBFD`/`#FCFCFD` → `subtle #F8F9FB` · `#F4F5FA` → `wash #F4F6FA` ·
`#F0F2F5`/`#F2F4F7` → `wash` · `#F4F3FE`/`#F8F8FE`/`#F7F8FF`/`#F5F7FF` → `veil #F5F7FF`
(canonical) · `#FFFAEB` → `warning-soft` · `#FEF3F2`/`#FFF8F7` → `danger-soft` ·
`#FFF9F9` → `danger-soft` · `#FFFDF7` → `warning-soft` · `#EFEEF5` → `wash`

**Hairlines → canonical:**
`#E4E6F0`/`#E8ECF3`/`#E6E8F0`(chip)/`#DCE0EB`/`#E6E5EE` → `line-soft #EEF0F4` ·
`#E6E8F0`(card)/`#E2E4EC` → `line #E7E9EF` · `#D4D3FA`/`#C7D2FE`/`#EAE8F2`/`#CFCBF4` →
`brand-line #D8D7FA` · `#F0B8B2`/`#FECDCA` → `danger-line` · `#FEDF89` → `warning-line` ·
`#BBF7D0` → `success-line`

**Lavender washes → canonical:**
`#EEF0FF`/`#EEF2FF`/`#E6E2FF`/`#E4E3FA`/`#EEEBFF` → `brand-mist #EDEAFF`

**Text (indistinguishable, never co-rendered):**
`#475467`/`#475069` → `slate-600` · `#101828` → `slate-900` (unifies card + drawer
titles) · `#172033` → `ink` · `#344054` → `ink-soft` · `#525866` → `ink-steel` ·
`#5C6270`/`#4B5563` → `gray-600` (contrast improves) · `#166534` → `success` ·
`#93470E` → `warning` · `#B54708` → `warning` (deliberate: warning icon matches
warning text) · `#6E6C7A` → `ink-muted` · `#9A98A8` → `ink-faint` ·
`#5E8E3E` kept exact as `connected` (deliberate calm-connected semantic)

**Near-stock → stock utilities (value-identical or ΔE ≲ 2):**
`#0F172A`→`slate-900` · `#1E293B`→`slate-800` · `#334155`→`slate-700` ·
`#64748B`→`slate-500` · `#94A3B8`→`slate-400` · `#F1F5F9`→`slate-100` ·
`#F8FAFC`→`slate-50` · `#E2E8F0`/`#DFE4EC`→`slate-200` · `#CFD6E2`→`slate-300` ·
`#E5E9F0`/`#E7EBF2`→`slate-200` · `#0C0A1D`→`ink` · `#D99116`→`warning-strong`
(deck medium dot) · `#F79009`→`warning-strong` · `#F04438`→`danger-strong` ·
`#DC6803` kept as `signal.stale`, `#D92D20` as `signal.failed` (legend colors)

---

## Reconciliation Notes

What the generator produced vs. what Revluma ships:

| Generator output | Verdict | Revluma truth |
|---|---|---|
| Primary `#1E40AF`, accent `#D97706` | ❌ replaced | Violet ramp `#4438E8 → #1F06AC`, teal verification |
| Fira Code headings + Fira Sans | ❌ replaced | Instrument Sans / Serif + DM Sans display |
| “Enterprise Gateway” landing pattern | ❌ replaced | Operational Dashboard pattern |
| Spacing scale 4–64px | ✅ kept | Matches Tailwind default scale |
| Shadow depths sm–xl | ✅ kept + extended | Plus `--shadow-glass*` elevations |
| Component specs (generic) | ❌ rewritten | Brand buttons, glass cards, drawer overlay |
| Anti-patterns + checklist | ✅ kept + extended | Plus token-sync checklist item |

Per the skill's own query contract, generated guidance was verified against
the product before use; repository rules and shipped brand take precedence
over dataset defaults.
