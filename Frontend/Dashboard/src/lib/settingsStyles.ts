/**
 * Shared class contracts for rebuilt settings pages (Revluma Master roles,
 * theme-aware through the --rv-* variables, so light and dark both hold).
 *
 * Accent discipline (MASTER Stage 1): brand violet only for the primary
 * action, selected controls and keyboard focus.
 */
const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-panel";

const buttonBase =
  "inline-flex h-9 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-3.5 text-[13px] font-semibold transition-[background-color,border-color,color,filter] disabled:cursor-not-allowed disabled:opacity-50";

export const settingsUi = {
  focusRing,
  primaryButton: `${buttonBase} ${focusRing} bg-brand-strong text-white hover:brightness-110 disabled:hover:brightness-100`,
  secondaryButton: `${buttonBase} ${focusRing} border border-line-strong bg-panel text-ink hover:bg-wash`,
  ghostButton: `${buttonBase} ${focusRing} text-ink-soft hover:bg-wash hover:text-ink`,
  dangerGhostButton: `${buttonBase} ${focusRing} text-danger hover:bg-danger-soft`,
  input:
    "h-[38px] w-full min-w-0 rounded-lg border border-line-strong bg-panel px-3 text-[14px] text-ink shadow-[0_1px_1px_rgba(16,24,40,0.04)] transition-[border-color,box-shadow] placeholder:text-ink-faint hover:border-ink-ghost focus-visible:border-brand focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand/20 aria-[invalid=true]:border-danger aria-[invalid=true]:focus-visible:ring-danger/20 disabled:cursor-not-allowed disabled:opacity-60",
  fieldLabel: "text-[13px] font-medium text-ink-soft",
  fieldError: "flex items-center gap-1.5 text-[12px] font-medium text-danger",
  helper: "text-[12.5px] leading-5 text-ink-muted",
  textLink: `${focusRing} cursor-pointer rounded text-[13px] font-semibold text-brand-strong underline-offset-4 transition-colors hover:underline`,
  badgeNeutral:
    "inline-flex items-center gap-1 rounded-full border border-line-strong bg-wash px-2 py-0.5 text-[11.5px] font-semibold text-ink-soft",
  badgeSuccess:
    "inline-flex items-center gap-1 rounded-full border border-success-line bg-success-soft px-2 py-0.5 text-[11.5px] font-semibold text-success",
  badgeWarning:
    "inline-flex items-center gap-1 rounded-full border border-warning-line bg-warning-soft px-2 py-0.5 text-[11.5px] font-semibold text-warning",
  badgeBrand:
    "inline-flex items-center gap-1 rounded-full border border-brand-line bg-brand-soft px-2 py-0.5 text-[11.5px] font-semibold text-brand-deep",
  dialog:
    "w-[calc(100%-2rem)] max-w-md gap-0 rounded-2xl border border-line bg-panel p-0 text-ink shadow-[0_24px_64px_-16px_rgba(0,0,0,0.45)] sm:rounded-2xl",
} as const;
