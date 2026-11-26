/**
 * Command Center Premium Hybrid V1 visual contract.
 *
 * Palette:
 * - Primary dark (sidebar): #111318
 * - Workspace background:   #F4F5F8
 * - Surface:                #FFFFFF
 * - Primary text:           #17191F
 * - Secondary text:         #707582
 * - Borders:                #E7E9EF
 * - Revluma blue accent:    #4438E8
 *
 * Semantic green, amber, and red are reserved strictly for meaningful
 * operational statuses and never used decoratively.
 */
export const cc = {
  page: "mx-auto w-full min-w-0 max-w-[1400px] space-y-7 overflow-x-clip pb-14 text-[#17191F]",
  surface: "min-w-0 rounded-2xl border border-[#E7E9EF] bg-white",
  surfaceSubtle: "min-w-0 rounded-xl border border-[#E7E9EF] bg-[#F8F9FB]",
  intelligence: "min-w-0 overflow-hidden rounded-2xl border border-[#D8D7FA] bg-white",
  title: "text-[1.75rem] font-semibold leading-[1.2] tracking-[-0.03em] text-[#17191F] sm:text-[2rem]",
  sectionTitle: "text-[1.0625rem] font-semibold leading-6 tracking-[-0.015em] text-[#17191F]",
  cardTitle: "text-xs font-semibold text-[#17191F]",
  body: "text-sm leading-6 text-[#343844]",
  muted: "text-[#707582]",
  metadata: "text-xs leading-5 text-[#707582]",
  primary: "inline-flex cursor-pointer min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-[#4438E8] px-4 text-xs font-semibold text-white transition-colors hover:bg-[#372CD1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4438E8] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-55",
  secondary: "inline-flex cursor-pointer min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-[#D9DCE5] bg-white px-3.5 text-xs font-semibold text-[#17191F] transition-colors hover:bg-[#F4F5F8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4438E8] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-55",
  disclosure: "cursor-pointer rounded text-xs font-semibold text-[#4438E8] transition-colors hover:text-[#372CD1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4438E8] focus-visible:ring-offset-2",
  focus: "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4438E8] focus-visible:ring-offset-2",
  divider: "border-[#E7E9EF]",
  positive: "text-[#067647]",
  negative: "text-[#B42318]",
  warning: "text-[#92400E]",
} as const;

export const shell = {
  sidebar: "bg-[#111318] text-white border-[#292d36]",
  sidebarMuted: "text-[#aeb5c2]",
  sidebarHover: "hover:bg-white/[0.07] hover:text-white",
  sidebarActive: "bg-[#1F06AC] text-white",
  workspace: "bg-[#F4F5F8] text-[#17191F]",
  focus: "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8f86ff] focus-visible:ring-offset-2 focus-visible:ring-offset-[#111318]",
} as const;

/**
 * Revluma Master palette: the single source of truth for every raw color
 * value in command-center (see design-system/revluma/MASTER.md).
 *
 * Consumption rules:
 * - Tailwind classes: use the theme utilities derived from this object
 *   (`bg-brand`, `text-ink-muted`, `border-line-soft`, …). tailwind.config.ts
 *   imports `palette`, so theme values cannot drift.
 * - Inline styles / gradients / TS logic: reference `palette.*` directly.
 * - `cc` / `shell` above keep literal class strings because Tailwind's
 *   content scanner and the test suite both require literal class names.
 *   `tokens.test.ts` asserts those strings contain their palette values.
 * - No other file in command-center may contain a raw hex literal.
 * - Alpha-composited rgba() derivatives (mesh washes, glows) stay inline at
 *   the usage site; stock Tailwind colors and the `white` / `transparent`
 *   keywords need no token.
 */
export const palette = {
  brand: {
    DEFAULT: "#4438E8",
    strong: "#372CD1",
    deep: "#3525B8",
    deeper: "#1F06AC",
    bright: "#5146E5",
    band: "#2B13CF",
    soft: "#F0EDFF",
    mist: "#EDEAFF",
    pale: "#E3E1FA",
    line: "#D8D7FA",
    lineStrong: "#C9C7FA",
  },
  ink: {
    DEFAULT: "#17191F",
    soft: "#343844",
    muted: "#707582",
    tertiary: "#667085",
    steel: "#526071",
    faint: "#98A2B3",
    ghost: "#D0D5DD",
  },
  line: {
    DEFAULT: "#E7E9EF",
    soft: "#EEF0F4",
    strong: "#D9DCE5",
  },
  success: {
    DEFAULT: "#067647",
    bright: "#12B76A",
    soft: "#ECFDF3",
    line: "#ABEFC6",
  },
  danger: {
    DEFAULT: "#B42318",
    strong: "#DC2626",
    deep: "#991B1B",
    deeper: "#7F1D1D",
    limited: "#9C2B25",
    soft: "#FEF2F2",
    line: "#FECACA",
  },
  warning: {
    DEFAULT: "#92400E",
    strong: "#D97706",
    soft: "#FFFBEB",
    line: "#FDE68A",
    lineStrong: "#F5D68B",
  },
  info: {
    DEFAULT: "#2B59C3",
    bright: "#4777F5",
    soft: "#EDF4FF",
    line: "#D6E4FF",
  },
  band: {
    bg: "#17152F",
    deep: "#241A63",
    text: "#EDEAFF",
    body: "#D9D4EC",
    faint: "#A9A3C7",
    accent: "#C9C2FF",
    spark: "#D9D4FF",
  },
  severity: {
    critical: { base: "#E5484D", deep: "#A12A22", softBg: "#FFF5F4", border: "#F3C7C3" },
    high: { base: "#F07832", deep: "#9A4A12", softBg: "#FFF6F0", border: "#F5D3B8" },
    medium: { base: "#E5A126", deep: "#925B13", softBg: "#FFFDF4", border: "#F2DDB8" },
    low: { base: "#6475E8", deep: "#39449F", softBg: "#F4F6FF", border: "#D8D7FA" },
  },
  deck: {
    ghost: "#B4B2C0",
    criticalGlyph: "#D9383E",
    mediumGlyph: "#B47409",
    glyphMuted: "#A5A3B2",
    dotEmpty: "#C9C8D4",
  },
  signal: {
    stale: "#DC6803",
    failed: "#D92D20",
  },
  surface: {
    workspace: "#F4F5F8",
    subtle: "#F8F9FB",
    wash: "#F4F6FA",
    veil: "#F5F7FF",
    skeleton: "#EEF0F6",
  },
  connected: "#5E8E3E",
  gradient: {
    cta: "linear-gradient(135deg, #5146E5 0%, #3525B8 55%, #1F06AC 100%)",
    band: "radial-gradient(360px 140px at 12% -40px, rgba(120, 110, 255, 0.5), transparent 65%), linear-gradient(118deg, #17152F 0%, #241A63 55%, #2B13CF 130%)",
    orb: "radial-gradient(circle at 30% 24%, #FFFFFF 0%, #FFFFFF 48%, #F5F4F9 84%, #ECEBF3 100%)",
  },
} as const;
