import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { SignalEvaluationCoverage, SignalEvaluationItem } from "./types";

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
        dotColor: "#1F06AC",
        badgeLabel: "Verified",
        badgeClass: "bg-[#EEEBFF] text-[#1F06AC]",
        summary:
          item.finding_count > 1
            ? `${item.finding_count} active findings`
            : "1 active finding",
      };
    case "not_detected":
      return {
        dotColor: "#12B76A",
        badgeLabel: "Clear",
        badgeClass: "bg-[#ECFDF3] text-[#067647]",
        summary: "No anomaly detected",
      };
    case "stale":
      return {
        dotColor: "#DC6803",
        badgeLabel: "Stale",
        badgeClass: "bg-[#FFFAEB] text-[#93470E]",
        summary: item.reason || "Data needs fresh sync",
      };
    case "evaluation_failed":
      return {
        dotColor: "#D92D20",
        badgeLabel: "Failed",
        badgeClass: "bg-[#FEF2F2] text-[#B42318]",
        summary: item.reason || "Check could not complete",
      };
    case "not_evaluated":
    default:
      return {
        dotColor: "#98A2B3",
        badgeLabel: "Pending",
        badgeClass: "bg-[#F2F4F7] text-[#475467]",
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
      aria-label="Signal evaluation coverage"
      className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-[#E8ECF3] bg-white"
      style={{
        boxShadow:
          "0 1px 2px rgba(12, 10, 29, 0.03), 0 12px 26px -22px rgba(12, 10, 29, 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.96)",
      }}
    >
      {/* Header matching Landing Command Center visual */}
      <header className="flex items-center justify-between gap-2 border-b border-[#EEF0F4] px-5 py-3.5">
        <h3 className="text-[13.5px] font-semibold tracking-[-0.01em] text-[#172033]">
          Recent signals
        </h3>
        <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-[#067647]">
          <span className="relative flex h-2 w-2 shrink-0 items-center justify-center">
            {!reducedMotion && (
              <motion.span
                aria-hidden="true"
                className="absolute inline-flex h-full w-full rounded-full bg-[#12B76A]"
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
              className="relative inline-flex h-2 w-2 rounded-full bg-[#12B76A]"
            />
          </span>
          <span>Watching</span>
        </span>
      </header>

      {/* Clean signal rows */}
      <ul className="divide-y divide-[#F0F2F5]">
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
              className="grid grid-cols-[10px_minmax(0,1fr)_auto] items-start gap-3 px-5 py-3.5 transition-colors hover:bg-[#FAFBFD]"
            >
              <span
                aria-hidden="true"
                className="mt-1.5 inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: visual.dotColor }}
              />
              <div className="min-w-0">
                <p className="text-[13px] font-semibold leading-[1.35] text-[#172033]">
                  {signal.label}
                </p>
                <p className="mt-0.5 text-[11.5px] leading-4 text-[#667085]">
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
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-[#EEF0F4] bg-[#FCFCFD] px-5 py-2.5 text-[11px] tabular-nums text-[#667085]">
        <span>
          {evaluation.summary.evaluated_count} of {evaluation.summary.total_signals} signals
          evaluated
        </span>
        {evaluation.summary.not_evaluated_count +
          evaluation.summary.failed_count +
          evaluation.summary.stale_count >
          0 && (
          <span className="font-medium text-[#475467]">
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
