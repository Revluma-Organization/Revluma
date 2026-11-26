# Page Override: Landing "What Revluma does" demo cards

> Overrides `design-system/revluma/MASTER.md` for the four product visuals in
> `Frontend/Landing/src/components/features/` (Detect, Investigate, Prioritize,
> Advise & Monitor). Anything not listed here follows Master.

**Decided:** 2026-11-26, redesign round 4 (user asked for enterprise-grade, non-generic demo UI).

## How this was derived (ui-ux-pro-max)

| Query | Verified result | Used |
|---|---|---|
| `"B2B SaaS analytics enterprise dashboard" --design-system --variance 3 --motion 3 --density 7` | Style **Minimalism & Swiss** (enterprise/SaaS); single accent; sharp shadows if any; subtle motion | ✅ style + motion tier. ❌ generic blue/orange palette and Plus Jakarta Sans: Master brand wins (skill's own reconcile rule) |
| `"enterprise data dense dashboard" --domain style` | Data-Dense Dashboard: KPI cards, tables, 12px type, compact padding | ✅ KPI strip, table column headers, 11 to 12.5px UI type |
| `"infinite looping decorative animation" --domain ux` | Continuous Animation: infinite motion only for loaders | ✅ every reveal plays once; no pulses, rings or floats |
| `"color not only indicator status" --domain ux` | Don't convey information by colour alone | ✅ every severity/state marker carries a word |
| `"badge chip overuse hierarchy" --domain ux` | Compact labels stay on one line | ✅ `white-space: nowrap` on marks/chips |
| `"scroll reveal subtle" --domain gsap` | 8 to 16px offset, 300 to 400ms | ✅ 6px rows / 16px stage, 0.4 to 0.6s |

## Rules (deviations from Master)

- **Glass is off inside demo windows.** Windows are opaque white with hairlines
  (`line #E7E9EF`), radius 12px, one neutral layered shadow. No mesh washes,
  no purple glow, no inset highlights. The stage behind a window is neutral
  (`#F5F5F8 → #EEEFF3`) with one faint brand corner wash (α 0.07).
- **Real product chrome, not macOS dots.** Bar = Revluma icon › sample
  workspace (`Linen & Loom`) › page name, plus a `Sample data` tag (radius 6px).
- **Severity = 7px square + word** (`fx-sev`), Master severity bases/deeps.
  No uppercase pill badges.
- **Sentence-case labels** at 10.5 to 11px muted. Uppercase tracked eyebrows are not used
  inside windows.
- **Data colours are neutral.** Level meters use `#526071` on `#E4E6EC`;
  brand violet is reserved for selection (top-ranked row rule), citations,
  progress and the recommendation label.
- **Tables over cards-in-cards.** Column headers once, never per-row labels
  (narrow containers re-show inline labels via container queries).
- **Monitoring = status-page sync cells** (one cell per sync), with an
  `aria-label` that reads the sequence.
- **Contrast:** muted text on tinted surfaces uses `ink-tertiary #667085`
  (`#707582` drops below 4.5:1 on `#F8F9FB`). Audited with a DOM walker at
  360px and 1440px: 0 failures.
- **Motion:** once only, `prefers-reduced-motion` shows the final state.
  `sx-tilt` (scroll-linked 3D tilt) and the `data-spot` pointer glow are not
  applied to these stages.
- **No `<dl>`** on the landing (hero test guards against a facts row); KPI
  strip is a labelled `<ul>`.

Guarded by `Frontend/Landing/src/test/features.test.tsx`.
