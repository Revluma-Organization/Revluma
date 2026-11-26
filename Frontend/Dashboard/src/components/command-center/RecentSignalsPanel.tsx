import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { SignalEvaluationCoverage, SignalEvaluationItem } from "./types";
import { palette } from "./tokens";

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

const relativeTime = (value: string | null) => {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return null;
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / 1440)}d`;
};

function signalVisual(item: SignalEvaluationItem) {
  switch (item.state) {
    case "verified":
      return {
        dotColor: palette.brand.deeper,
        badgeLabel: "Verified",
        badgeClass: "bg-brand-mist text-brand-deeper",
        summary:
          item.finding_count > 1
            ? `${item.finding_count} active findings`
            : "1 active finding",
      };
    case "not_detected":
      return {
        dotColor: palette.success.bright,
        badgeLabel: "Clear",
        badgeClass: "bg-success-soft text-success",
        summary: "No anomaly detected",
      };
    case "stale":
      return {
        dotColor: palette.signal.stale,
        badgeLabel: "Stale",
        badgeClass: "bg-warning-soft text-warning",
        summary: item.reason || "Data needs fresh sync",
      };
    case "evaluation_failed":
      return {
        dotColor: palette.signal.failed,
        badgeLabel: "Failed",
        badgeClass: "bg-danger-soft text-danger",
        summary: item.reason || "Check could not complete",
      };
    case "not_evaluated":
    default:
      return {
        dotColor: palette.ink.faint,
        badgeLabel: "Pending",
        badgeClass: "bg-wash text-slate-600",
        summary: item.reason || "Awaiting source coverage",
      };
  }
}

export interface RecentSignalsPanelProps {
  evaluation: SignalEvaluationCoverage;
}

export function RecentSignalsPanel({ evaluation }: RecentSignalsPanelProps) {
  const reducedMotion = Boolean(useReducedMotion());
  const evaluatedAgo = relativeTime(evaluation.evaluated_at);

  return (
    <section
      id="recent-signals"
      aria-label="Signal evaluation coverage"
      className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-line-soft bg-white"
      style={{
        boxShadow:
          "0 1px 2px rgba(12, 10, 29, 0.03), 0 12px 26px -22px rgba(12, 10, 29, 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.96)",
      }}
    >
      {/* Header matching Landing Command Center visual */}
      <header className="flex items-center justify-between gap-2 border-b border-line-soft px-5 py-3.5">
        <h3 className="text-[13.5px] font-semibold tracking-[-0.01em] text-ink">
          Recent signals
        </h3>
        <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-success">
          <span className="relative flex h-2 w-2 shrink-0 items-center justify-center">
            {!reducedMotion && (
              <motion.span
                aria-hidden="true"
                className="absolute inline-flex h-full w-full rounded-full bg-success-bright"
                animate={{ scale: [1, 2.2], opacity: [0.5, 0] }}
                transition={{
                  duration: 2.4,
                  repeat: Infinity,
                  repeatDelay: 1.2,
                  ease: EASE_OUT_EXPO,
                }}
              />
            )}
            <span
              aria-hidden="true"
              className="relative inline-flex h-2 w-2 rounded-full bg-success-bright"
            />
          </span>
          <span>Watching</span>
        </span>
      </header>

      {/* Clean signal rows (responsive grid for the full-width below layout) */}
      <ul className="grid gap-px bg-wash sm:grid-cols-2 xl:grid-cols-3">
        {evaluation.signals.map((signal, idx) => {
          const visual = signalVisual(signal);
          return (
            <motion.li
              key={signal.category}
              initial={reducedMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: reducedMotion ? 0 : 0.44,
                delay: reducedMotion ? 0 : 0.08 + idx * 0.045,
                ease: EASE_OUT_EXPO,
              }}
              className="grid grid-cols-[10px_minmax(0,1fr)_auto] items-start gap-3 bg-white px-5 py-3.5 transition-colors hover:bg-subtle"
            >
              <span
                aria-hidden="true"
                className="mt-1.5 inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: visual.dotColor }}
              />
              <div className="min-w-0">
                <p className="text-[13px] font-semibold leading-[1.35] text-ink">
                  {signal.label}
                </p>
                <p className="mt-0.5 text-[11.5px] leading-4 text-ink-tertiary">
                  {visual.summary}
                  {evaluatedAgo ? ` · ${evaluatedAgo}` : ""}
                </p>
              </div>
              <span
                className={cn(
                  "mt-0.5 inline-flex shrink-0 items-center rounded-full px-2.5 py-[3px] text-[9.5px] font-bold uppercase leading-none tracking-[0.08em]",
                  visual.badgeClass,
                )}
              >
                {visual.badgeLabel}
              </span>
            </motion.li>
          );
        })}
      </ul>

      {/* Quiet coverage footer */}
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-line-soft bg-subtle px-5 py-2.5 text-[11px] tabular-nums text-ink-tertiary">
        <span>
          {evaluation.summary.evaluated_count} of {evaluation.summary.total_signals} signals
          evaluated
        </span>
        {evaluation.summary.not_evaluated_count +
          evaluation.summary.failed_count +
          evaluation.summary.stale_count >
          0 && (
          <span className="font-medium text-slate-600">
            {evaluation.summary.not_evaluated_count +
              evaluation.summary.failed_count +
              evaluation.summary.stale_count}{" "}
            limited
          </span>
        )}
      </div>
    </section>
  );
}

export default RecentSignalsPanel;
