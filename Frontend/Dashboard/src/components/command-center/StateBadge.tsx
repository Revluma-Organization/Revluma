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
    pill: "border-success-line bg-success-soft text-success",
    dot: "bg-success-bright",
    defaultLabel: "Current",
  },
  updating: {
    pill: "border-brand-line bg-brand-mist text-brand",
    dot: "bg-brand",
    defaultLabel: "Updating",
    pulse: true,
  },
  stale: {
    pill: "border-warning-line bg-warning-soft text-warning",
    dot: "bg-warning-strong",
    defaultLabel: "Stale",
  },
  unavailable: {
    pill: "border-danger-line bg-danger-soft text-danger",
    dot: "bg-danger-strong",
    defaultLabel: "Unavailable",
  },
  empty: {
    pill: "border-line bg-workspace text-ink-steel",
    dot: "bg-ink-faint",
    defaultLabel: "Empty",
  },
  partial: {
    pill: "border-warning-line bg-warning-soft text-warning",
    dot: "bg-warning-strong",
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
