import { Link } from "react-router-dom";
import { Activity, Database, ListOrdered } from "lucide-react";
import { cn } from "@/lib/utils";
import { cc } from "./tokens";
import { selectQueueFindings } from "./findingDisplay";
import type { CommandCenterData } from "./types";

export interface KpiValues {
  /** Findings in the visible priority queue (primary + secondary, deduplicated). */
  openIssues: number;
  /**
   * Signals in the `verified` state. Null when no evaluation exists — callers
   * must render an honest unknown state, never 0.
   */
  actionableSignals: number | null;
  evaluatedSignals: number;
  totalSignals: number;
  signalWindowDays: number | null;
  availableSources: number;
  totalSources: number;
}

/**
 * KPI values derived from verified backend data only: finding counts, the
 * signal evaluation summary, and resource availability. No trend percentages,
 * sparklines, historical comparisons, or coverage scores exist in this model,
 * so none are computed here.
 */
export function resolveKpiValues(data: CommandCenterData): KpiValues {
  const evaluation = data.signal_evaluation ?? null;
  return {
    openIssues: selectQueueFindings(data).length,
    actionableSignals: evaluation
      ? evaluation.signals.filter((signal) => signal.state === "verified").length
      : null,
    evaluatedSignals: evaluation?.summary.evaluated_count ?? 0,
    totalSignals: evaluation?.summary.total_signals ?? 0,
    signalWindowDays: evaluation?.period_days ?? null,
    availableSources: data.evidence.resources.filter(
      (resource) => resource.availability === "available",
    ).length,
    totalSources: data.evidence.resources.length,
  };
}

interface KpiCard {
  id: string;
  label: string;
  value: string;
  context: string;
  to: string;
  linkLabel: string;
  Icon: typeof Activity;
}

function resolveKpiCards(values: KpiValues): KpiCard[] {
  const signalsValue = values.actionableSignals === null ? "—" : String(values.actionableSignals);
  const signalsContext =
    values.actionableSignals === null
      ? "Signal evaluation unavailable"
      : `${values.evaluatedSignals} of ${values.totalSignals} evaluated · ${values.signalWindowDays ?? "—"}d window`;
  const coverageValue =
    values.totalSources === 0 ? "—" : `${values.availableSources} of ${values.totalSources}`;
  return [
    {
      id: "open-issues",
      label: "Open issues",
      value: String(values.openIssues),
      context: values.openIssues === 1 ? "Finding in the priority queue" : "Findings in the priority queue",
      to: "/dashboard/overview?section=priority",
      linkLabel: `Open issues: ${values.openIssues}. View priority queue`,
      Icon: ListOrdered,
    },
    {
      id: "actionable-signals",
      label: "Actionable signals",
      value: signalsValue,
      context: signalsContext,
      to: "/dashboard/overview?section=signals",
      linkLabel:
        values.actionableSignals === null
          ? "Actionable signals: not evaluated. View signals"
          : `Actionable signals: ${values.actionableSignals}. View signals`,
      Icon: Activity,
    },
    {
      id: "evidence-coverage",
      label: "Evidence coverage",
      value: coverageValue,
      context: values.totalSources === 0 ? "No sources reported" : "sources available",
      to: "/dashboard/overview?section=evidence",
      linkLabel:
        values.totalSources === 0
          ? "Evidence coverage: no sources reported. View data readiness"
          : `Evidence coverage: ${coverageValue} sources available. View data readiness`,
      Icon: Database,
    },
  ];
}

export function KpiStrip({ data }: { data: CommandCenterData }) {
  const cards = resolveKpiCards(resolveKpiValues(data));
  return (
    <section aria-label="Key store indicators">
      <ul className="grid gap-4 sm:grid-cols-3">
        {cards.map((card) => (
          <li key={card.id} className="min-w-0">
            <Link
              to={card.to}
              aria-label={card.linkLabel}
              className={cn(
                "flex h-full cursor-pointer flex-col rounded-xl border border-line-soft bg-white p-4 transition-colors hover:border-line-strong sm:p-5",
                cc.focus,
              )}
            >
              <span className="flex items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-wash text-ink-steel"
                >
                  <card.Icon className="h-4 w-4" />
                </span>
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
                  {card.label}
                </span>
              </span>
              <span className="mt-3 text-[1.75rem] font-semibold leading-none tracking-[-0.02em] text-ink tabular-nums">
                {card.value}
              </span>
              <span className="mt-1.5 text-xs leading-5 text-ink-muted">{card.context}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default KpiStrip;
