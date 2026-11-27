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
  page: "mx-auto w-full min-w-0 max-w-[1440px] space-y-7 overflow-x-clip pb-14 text-[#17191F]",
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
    panel: "#FFFFFF",
  },
  connected: "#5E8E3E",
  gradient: {
    cta: "linear-gradient(135deg, #5146E5 0%, #3525B8 55%, #1F06AC 100%)",
    band: "radial-gradient(360px 140px at 12% -40px, rgba(120, 110, 255, 0.5), transparent 65%), linear-gradient(118deg, #17152F 0%, #241A63 55%, #2B13CF 130%)",
    orb: "radial-gradient(circle at 30% 24%, #FFFFFF 0%, #FFFFFF 48%, #F5F4F9 84%, #ECEBF3 100%)",
  },
} as const;

/**
 * The colour roles that switch with the workspace theme. Tailwind's palette
 * utilities (`text-ink`, `bg-brand-soft`, `border-line`, …) read these as CSS
 * variables, so one class works in light and dark and every variant (hover,
 * opacity modifiers) follows the theme with no per-component `dark:` classes.
 */
type ThemeRoles = {
  brand: Record<keyof typeof palette.brand, string>;
  ink: Record<keyof typeof palette.ink, string>;
  line: Record<keyof typeof palette.line, string>;
  success: Record<keyof typeof palette.success, string>;
  danger: Record<keyof typeof palette.danger, string>;
  warning: Record<keyof typeof palette.warning, string>;
  info: Record<keyof typeof palette.info, string>;
  band: { text: string; body: string; faint: string; accent: string; bg: string };
  severity: Record<keyof typeof palette.severity, string>;
  severitySoft: Record<keyof typeof palette.severity, string>;
  severityBorder: Record<keyof typeof palette.severity, string>;
  deck: Record<keyof typeof palette.deck, string>;
  surface: Record<keyof typeof palette.surface, string>;
  connected: string;
};

const lightRoles: ThemeRoles = {
  brand: palette.brand,
  ink: palette.ink,
  line: palette.line,
  success: palette.success,
  danger: palette.danger,
  warning: palette.warning,
  info: palette.info,
  band: palette.band,
  severity: {
    critical: palette.severity.critical.base,
    high: palette.severity.high.base,
    medium: palette.severity.medium.base,
    low: palette.severity.low.base,
  },
  severitySoft: {
    critical: palette.severity.critical.softBg,
    high: palette.severity.high.softBg,
    medium: palette.severity.medium.softBg,
    low: palette.severity.low.softBg,
  },
  severityBorder: {
    critical: palette.severity.critical.border,
    high: palette.severity.high.border,
    medium: palette.severity.medium.border,
    low: palette.severity.low.border,
  },
  deck: palette.deck,
  surface: palette.surface,
  connected: palette.connected,
};

/**
 * Dark workspace: neutral pure black, never navy. Canvas #000, panels #0D0D0D,
 * hairlines #262626. Brand and status hues are lifted so text keeps WCAG AA
 * contrast on black; their washes are deep, low-chroma tints.
 */
export const paletteDark: ThemeRoles = {
  brand: {
    DEFAULT: "#6F66FF",
    strong: "#5A51F2",
    deep: "#A9A3FF",
    deeper: "#B9B3FF",
    bright: "#7D75FF",
    band: "#8E87FF",
    soft: "#16142B",
    mist: "#18162F",
    pale: "#201D3D",
    line: "#2D2A52",
    lineStrong: "#3A3666",
  },
  ink: {
    DEFAULT: "#F5F5F5",
    soft: "#D4D4D4",
    muted: "#A3A3A3",
    tertiary: "#A1A1A1",
    steel: "#ABABAB",
    faint: "#7A7A7A",
    ghost: "#404040",
  },
  line: {
    DEFAULT: "#262626",
    soft: "#1F1F1F",
    strong: "#333333",
  },
  success: {
    DEFAULT: "#4ADE80",
    bright: "#22C55E",
    soft: "#0A1D12",
    line: "#14532D",
  },
  danger: {
    DEFAULT: "#F87171",
    strong: "#EF4444",
    deep: "#FCA5A5",
    deeper: "#FECACA",
    limited: "#F87171",
    soft: "#240C0C",
    line: "#5F1D1D",
  },
  warning: {
    DEFAULT: "#FBBF24",
    strong: "#F59E0B",
    soft: "#1F1806",
    line: "#5A420F",
    lineStrong: "#6B4F12",
  },
  info: {
    DEFAULT: "#8AAEFF",
    bright: "#7DA2FF",
    soft: "#0C1424",
    line: "#1E3766",
  },
  // The dark gradient band keeps its colours; only the overlay scrim
  // (band.bg) turns neutral black so dialogs never dim to navy.
  band: { ...palette.band, bg: "#000000" },
  severity: lightRoles.severity,
  severitySoft: { critical: "#1F0B0B", high: "#1F1108", medium: "#1D1607", low: "#11132A" },
  severityBorder: { critical: "#5C2220", high: "#5A3416", medium: "#574116", low: "#2D2A52" },
  deck: {
    ghost: "#525252",
    criticalGlyph: "#F26B6F",
    mediumGlyph: "#E5A126",
    glyphMuted: "#5C5C5C",
    dotEmpty: "#3A3A3A",
  },
  surface: {
    workspace: "#000000",
    subtle: "#0A0A0A",
    wash: "#0D0D0D",
    veil: "#0F0F12",
    skeleton: "#1A1A1A",
    panel: "#0D0D0D",
  },
  connected: "#86C063",
};

/** "#RRGGBB" to the "r g b" channel triple Tailwind's <alpha-value> expects. */
export function hexChannels(hex: string): string {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)).join(" ");
}

/** CSS custom property name for a palette role, e.g. ("ink","muted") -> "--rv-ink-muted". */
export function roleVar(group: string, key = "DEFAULT"): string {
  return key === "DEFAULT" ? `--rv-${group}` : `--rv-${group}-${key}`;
}

/** Every theme role as a CSS custom property declaration map. */
export function paletteVars(roles: ThemeRoles = lightRoles): Record<string, string> {
  const vars: Record<string, string> = {};
  const groups = ["brand", "ink", "line", "success", "danger", "warning", "info", "band", "severity", "severitySoft", "severityBorder", "deck", "surface"] as const;
  for (const group of groups) {
    for (const [key, hex] of Object.entries(roles[group])) vars[roleVar(group, key)] = hexChannels(hex);
  }
  vars[roleVar("connected")] = hexChannels(roles.connected);
  return vars;
}

/** Gradients that switch with the theme, exposed as --rv-gradient-* variables. */
export const gradientVars = {
  light: { "--rv-gradient-orb": palette.gradient.orb },
  dark: { "--rv-gradient-orb": "radial-gradient(circle at 30% 24%, #2A2A2A 0%, #1A1A1A 52%, #111111 100%)" },
} as const;

/** Theme-following colour for inline styles: rgb(var(--rv-…)). */
export function roleColor(group: string, key = "DEFAULT", alpha?: number): string {
  return alpha === undefined ? `rgb(var(${roleVar(group, key)}))` : `rgb(var(${roleVar(group, key)}) / ${alpha})`;
}
