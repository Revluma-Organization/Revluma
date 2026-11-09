import { workspaceDesign } from "@/lib/workspaceDesign";

/**
 * Command Center visual contract. These classes are shared by every state so
 * loading, partial and verified views do not develop separate visual languages.
 * Brand blue is used for actions/intelligence, never as a business-health score.
 */
export const cc = {
  page: "mx-auto w-full min-w-0 max-w-[1320px] space-y-6 overflow-x-clip pb-12 text-[#172033]",
  surface: "min-w-0 rounded-xl border border-[#dfe4ec] bg-white",
  surfaceSubtle: "min-w-0 rounded-lg border border-[#e5e9f0] bg-[#f8f9fb]",
  intelligence: "min-w-0 overflow-hidden rounded-xl border border-[#cbd5f3] bg-white shadow-[0_8px_28px_rgba(31,6,172,0.07)]",
  title: `${workspaceDesign.typography.page} text-[#111827]`,
  sectionTitle: `${workspaceDesign.typography.section} tracking-[-0.01em] text-[#172033]`,
  cardTitle: "text-xs font-semibold text-[#344054]",
  body: `${workspaceDesign.typography.body} text-[#344054]`,
  muted: "text-[#667085]",
  metadata: `${workspaceDesign.typography.metadata} text-[#667085]`,
  primary: "inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-[#1F06AC] px-4 text-xs font-semibold text-white transition-colors hover:bg-[#18058c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F06AC] focus-visible:ring-offset-2 disabled:opacity-60",
  secondary: "inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-[#cfd6e2] bg-white px-3.5 text-xs font-semibold text-[#344054] transition-colors hover:bg-[#f5f7fa] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F06AC] focus-visible:ring-offset-2 disabled:opacity-60",
  disclosure: "cursor-pointer rounded text-xs font-semibold text-[#1F06AC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F06AC] focus-visible:ring-offset-4",
  divider: "border-[#e7eaf0]",
  positive: "text-[#067647]",
  negative: "text-[#b42318]",
  warning: "text-[#93470e]",
} as const;

export const shell = {
  sidebar: "bg-[#111318] text-white border-[#292d36]",
  sidebarMuted: "text-[#aeb5c2]",
  sidebarHover: "hover:bg-white/[0.07] hover:text-white",
  sidebarActive: "bg-[#1F06AC] text-white",
  workspace: "bg-[#f5f6f8] text-[#172033]",
  focus: "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8f86ff] focus-visible:ring-offset-2 focus-visible:ring-offset-[#111318]",
} as const;
