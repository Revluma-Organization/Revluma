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
  primary: "inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-[#4438E8] px-4 text-xs font-semibold text-white transition-colors hover:bg-[#372CD1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4438E8] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-55",
  secondary: "inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-[#D9DCE5] bg-white px-3.5 text-xs font-semibold text-[#17191F] transition-colors hover:bg-[#F4F5F8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4438E8] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-55",
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
