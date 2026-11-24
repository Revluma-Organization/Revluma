import { cn } from "@/lib/utils";

/**
 * Six canonical Command Center application states (V1 specification).
 * Visually distinct so data freshness, sync progress, partial coverage,
 * unavailability, and empty results are never collapsed into one indicator.
 */
export type CommandCenterAppState =
  | "current"
  | "updating"
  | "stale"
  | "unavailable"
  | "empty"
  | "partial";

const STATE_STYLES: Record<
  CommandCenterAppState,
  { pill: string; dot: string; defaultLabel: string; pulse?: boolean }
> = {
  current: {
    pill: "border-[#ABEFC6] bg-[#ECFDF3] text-[#067647]",
    dot: "bg-[#12B76A]",
    defaultLabel: "Current",
  },
  updating: {
    pill: "border-[#D4D3FA] bg-[#EEF0FF] text-[#4438E8]",
    dot: "bg-[#4438E8]",
    defaultLabel: "Updating",
    pulse: true,
  },
  stale: {
    pill: "border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]",
    dot: "bg-[#D97706]",
    defaultLabel: "Stale",
  },
  unavailable: {
    pill: "border-[#FECACA] bg-[#FEF2F2] text-[#B42318]",
    dot: "bg-[#DC2626]",
    defaultLabel: "Unavailable",
  },
  empty: {
    pill: "border-[#E7E9EF] bg-[#F4F5F8] text-[#525866]",
    dot: "bg-[#98A2B3]",
    defaultLabel: "Empty",
  },
  partial: {
    pill: "border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]",
    dot: "bg-[#D97706]",
    defaultLabel: "Partial coverage",
  },
};

export interface StateBadgeProps {
  state: CommandCenterAppState;
  label?: string;
  title?: string;
  className?: string;
}

export function StateBadge({ state, label, title, className }: StateBadgeProps) {
  const style = STATE_STYLES[state];
  return (
    <span
      data-app-state={state}
      title={title}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium leading-4",
        style.pill,
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          style.dot,
          style.pulse && "animate-pulse motion-reduce:animate-none",
        )}
      />
      <span>{label ?? style.defaultLabel}</span>
    </span>
  );
}
