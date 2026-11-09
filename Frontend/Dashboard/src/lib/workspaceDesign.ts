/** Authoritative light-workspace and shared-shell design contract (WCAG 2.2 AA palette). */
export const workspaceDesign = {
  color: {
    brand: "#1F06AC", brandHover: "#18058C", sidebar: "#111318", workspace: "#F5F6F8",
    surface: "#FFFFFF", text: "#172033", body: "#344054", muted: "#667085", border: "#8490A3",
    focus: "#6C5CE7", positive: "#067647", negative: "#B42318", warning: "#93470E",
  },
  typography: { page: "text-[1.75rem] font-semibold leading-9 tracking-[-0.03em]", section: "text-sm font-semibold leading-5", body: "text-sm leading-6", metadata: "text-xs leading-5" },
  spacing: { page: "space-y-6", section: "p-4 sm:p-5", controlGap: "gap-2", pagePadding: "px-3 py-5 sm:px-6 sm:py-6 lg:px-8" },
  shape: { card: "rounded-xl border bg-white", radius: "12px", shadow: "0 1px 2px rgb(16 24 40 / 0.05)" },
  control: {
    primary: "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#1F06AC] px-4 text-sm font-semibold text-white hover:bg-[#18058C] disabled:cursor-not-allowed disabled:opacity-60",
    secondary: "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[#8490A3] bg-white px-3.5 text-sm font-semibold text-[#344054] hover:bg-[#F5F7FA] disabled:cursor-not-allowed disabled:opacity-60",
    input: "min-h-11 rounded-lg border border-[#8490A3] bg-white px-3 text-sm text-[#172033] placeholder:text-[#667085] disabled:cursor-not-allowed disabled:opacity-60",
  },
  focus: "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C5CE7] focus-visible:ring-offset-2",
  breakpoints: { mobileMax: 767, tabletMin: 768, desktopMin: 1024, contentMax: 1320 },
} as const;

export const REQUIRED_VIEWPORTS = [320, 360, 375, 390, 430, 600, 768, 820, 1024, 1280, 1440, 1920] as const;

export function navigationMode(width: number): "drawer" | "sidebar" {
  return Number.isFinite(width) && width >= workspaceDesign.breakpoints.tabletMin ? "sidebar" : "drawer";
}

export function relativeLuminance(hex: string): number {
  if (!/^#[0-9A-F]{6}$/i.test(hex)) throw new Error("A six-digit color is required");
  const values = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}

export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground); const b = relativeLuminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
