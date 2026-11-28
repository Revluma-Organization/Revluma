/**
 * Sidebar design tokens: the landing and auth system (auth-theme.css) on the
 * dashboard shell. Light is the warm #FBFAF8 canvas with ink #0C0A1D type and
 * #E8E6E1 hairlines; dark is neutral pure black (#000 canvas, #0D0D0D cards,
 * #262626 hairlines), never navy. The current page is a Revluma blue pill
 * (#2B13CF, the auth accent) in both themes. Literal class strings so
 * Tailwind's scanner and the tests can read them.
 */
export const side = {
  surface: "bg-[#FBFAF8] text-[#0C0A1D] border-[#E8E6E1] dark:bg-black dark:text-[#F5F5F5] dark:border-[#1F1F1F]",
  text: "text-[#0C0A1D] dark:text-[#F5F5F5]",
  muted: "text-[#5E5C6B] dark:text-[#A3A3A3]",
  faint: "text-[#6B6977] dark:text-[#8A8A8A]",
  icon: "text-[#6B6977] group-hover:text-[#0C0A1D] dark:text-[#8A8A8A] dark:group-hover:text-white",
  item: "text-[#3F3D4E] hover:bg-[#F1EFEA] hover:text-[#0C0A1D] dark:text-[#D4D4D4] dark:hover:bg-[#141414] dark:hover:text-white",
  active: "bg-[#2B13CF] text-white shadow-[0_10px_22px_-12px_rgba(43,19,207,0.7)] hover:bg-[#1F06AC] dark:shadow-[0_10px_24px_-12px_rgba(43,19,207,0.9)]",
  badge: "bg-[#EEEBFF] text-[#2B13CF] dark:bg-[#16142B] dark:text-[#B9B3FF]",
  badgeActive: "bg-white/20 text-white",
  iconButton: "shrink-0 items-center justify-center rounded-full border border-[#E8E6E1] bg-white text-[#3F3D4E] transition-colors duration-200 hover:border-[#0C0A1D] hover:text-[#0C0A1D] dark:border-[#262626] dark:bg-[#0D0D0D] dark:text-[#D4D4D4] dark:hover:border-[#525252] dark:hover:text-white flex",
  card: "border-[#E8E6E1] bg-white shadow-[0_1px_2px_rgba(12,10,29,0.04),0_18px_36px_-26px_rgba(12,10,29,0.28)] dark:border-[#262626] dark:bg-[#0D0D0D] dark:shadow-none",
  pop: "border-[#E8E6E1] bg-white shadow-[0_18px_36px_-14px_rgba(12,10,29,0.28),0_4px_10px_-4px_rgba(12,10,29,0.1)] dark:border-[#262626] dark:bg-[#0D0D0D] dark:shadow-[0_18px_36px_-14px_rgba(0,0,0,0.9)]",
  rowHover: "hover:bg-[#F4F2EE] dark:hover:bg-[#161616]",
  divider: "border-[#E8E6E1] dark:border-[#262626]",
  focus: "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2B13CF] focus-visible:ring-offset-2 focus-visible:ring-offset-[#FBFAF8] dark:focus-visible:ring-[#8E87FF] dark:focus-visible:ring-offset-black",
  // Settings mode: destructive entry and the in-rail search field.
  danger: "text-[#B42318] hover:bg-[#FEF3F2] hover:text-[#912018] dark:text-[#F97066] dark:hover:bg-[#1F0E0C] dark:hover:text-[#FDA29B]",
  dangerActive: "bg-[#B42318] text-white hover:bg-[#912018] dark:bg-[#D92D20] dark:hover:bg-[#B42318]",
  input: "h-9 w-full rounded-full border border-[#E8E6E1] bg-white pl-9 pr-9 text-[13px] text-[#0C0A1D] placeholder:text-[#8A8797] transition-colors focus:border-[#2B13CF] focus:outline-none focus:ring-2 focus:ring-[#2B13CF]/20 dark:border-[#262626] dark:bg-[#0D0D0D] dark:text-[#F5F5F5] dark:placeholder:text-[#6B6B6B] dark:focus:border-[#8E87FF] dark:focus:ring-[#8E87FF]/25 [&::-webkit-search-cancel-button]:hidden",
} as const;
