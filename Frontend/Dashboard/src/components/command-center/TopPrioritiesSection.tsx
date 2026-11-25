import { useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Database,
  Info,
  Layers,
  MinusCircle,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Target,
  XCircle,
} from "lucide-react";
import { useInRouterContext, useNavigate } from "react-router-dom";
import { investigationRoute } from "@/lib/workspaceNavigation";
import { cn } from "@/lib/utils";
import { PriorityFindingCard } from "./PriorityFindingCard";
import { RecentSignalsPanel } from "./RecentSignalsPanel";
import { SeveritySummaryDeck, type SeverityFilterTier } from "./SeveritySummaryDeck";
import { StateBadge } from "./StateBadge";
import { cc } from "./tokens";
import type {
  CommandCenterData,
  Finding,
  SignalEvaluationCoverage,
  SignalEvaluationItem,
  SignalEvaluationState,
} from "./types";

export interface TopPrioritiesSectionProps {
  data: CommandCenterData | null;
  loading?: boolean;
  refreshing?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

type SeverityTier = SeverityFilterTier;

const TIER_LABELS: Record<Exclude<SeverityTier, "all">, string> = {
  critical_high: "Critical & High",
  medium: "Medium",
  low: "Low & Watch",
};

const dateTime = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(value),
      )
    : "Not recorded";

const relativeTime = (value: string | null) => {
  if (!value) return "Not recorded";
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "Not recorded";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
};

function matchesSeverityTier(severity: Finding["severity"], tier: SeverityTier): boolean {
  if (tier === "all") return true;
  if (tier === "critical_high") return severity === "critical" || severity === "high";
  return severity === tier;
}

function getSignalStateMeta(state: SignalEvaluationState) {
  switch (state) {
    case "verified":
      return {
        label: "Finding verified",
        badgeClass: "border-[#C9C7FA] bg-[#F0EDFF] text-[#3525B8]",
        Icon: AlertCircle,
      };
    case "not_detected":
      return {
        label: "Checked · Clear",
        badgeClass: "border-[#BBF7D0] bg-[#ECFDF3] text-[#166534]",
        Icon: CheckCircle2,
      };
    case "evaluation_failed":
      return {
        label: "Evaluation failed",
        badgeClass: "border-[#FECACA] bg-[#FEF2F2] text-[#B42318]",
        Icon: XCircle,
      };
    case "stale":
      return {
        label: "Stale data",
        badgeClass: "border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]",
        Icon: Clock,
      };
    case "not_evaluated":
    default:
      return {
        label: "Not evaluated",
        badgeClass: "border-[#DCE0EB] bg-[#F4F5FA] text-[#4B5563]",
        Icon: MinusCircle,
      };
  }
}

function useWorkspaceNavigation() {
  const inRouter = useInRouterContext();
  const navigate = useNavigate();

  return (route: string) => {
    if (!inRouter) {
      window.location.assign(route);
      return;
    }
    if (!route.startsWith("/dashboard/rev-intell")) {
      navigate(route);
      return;
    }
    const current = new URL(window.location.href);
    const finding = new URL(route, current.origin).searchParams.get("finding");
    if (finding && /^[0-9a-f-]{36}$/i.test(finding)) {
      current.searchParams.set("finding", finding);
    }
    navigate(investigationRoute(route, `${current.pathname}${current.search}${current.hash}`));
  };
}

function formatSourceLabel(source: string): string {
  return source.replaceAll("_", " ");
}

function SignalCoveragePanel({
  evaluation,
  compact = false,
}: {
  evaluation: SignalEvaluationCoverage;
  compact?: boolean;
}) {
  const { summary, signals } = evaluation;
  const nonEvaluatedCount = summary.not_evaluated_count + summary.failed_count + summary.stale_count;

  return (
    <div
      aria-label="Signal evaluation coverage"
      className={cn(
        "rounded-xl border",
        evaluation.incomplete
          ? "border-[#D6E4FF] bg-[#EDF4FF]/65"
          : "border-[#E3E1FA] bg-[#F0EDFF]/40",
        compact ? "p-3.5" : "p-4",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
              evaluation.incomplete
                ? "bg-[#DCE9FF] text-[#2B59C3]"
                : "bg-[#E6E2FF] text-[#4438E8]",
            )}
            aria-hidden="true"
          >
            <Layers className="h-3.5 w-3.5" />
          </span>
          <p className="text-xs font-semibold text-[#17191F]">
            Signal evaluation coverage
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium tabular-nums">
          <span className="rounded-full border border-[#D8D7FA] bg-white px-2.5 py-0.5 text-[#3525B8]">
            {summary.evaluated_count} of {summary.total_signals} signals evaluated
          </span>
          {summary.verified_findings_count > 0 && (
            <span className="rounded-full border border-[#C9C7FA] bg-[#F0EDFF] px-2 py-0.5 text-[#3525B8]">
              {summary.verified_findings_count} verified
            </span>
          )}
          {summary.failed_count > 0 && (
            <span className="rounded-full border border-[#FECACA] bg-[#FEF2F2] px-2 py-0.5 text-[#B42318]">
              {summary.failed_count} failed
            </span>
          )}
          {summary.not_evaluated_count > 0 && (
            <span className="rounded-full border border-[#DCE0EB] bg-white px-2 py-0.5 text-[#4B5563]">
              {summary.not_evaluated_count} not evaluated
            </span>
          )}
          {summary.stale_count > 0 && (
            <span className="rounded-full border border-[#FDE68A] bg-[#FFFBEB] px-2 py-0.5 text-[#92400E]">
              {summary.stale_count} stale
            </span>
          )}
        </div>
      </div>

      {nonEvaluatedCount > 0 && (
        <p className="mt-2 text-xs leading-5 text-[#4B5563]">
          Business signals marked not evaluated, failed, or stale cannot confirm or rule out
          store issues.
        </p>
      )}

      <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {signals.map((sig: SignalEvaluationItem) => {
          const meta = getSignalStateMeta(sig.state);
          const Icon = meta.Icon;
          return (
            <li
              key={sig.id}
              className="flex flex-col justify-between gap-1.5 rounded-lg border border-[#E6E8F0] bg-white px-3 py-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[#17191F]">{sig.label}</span>
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold leading-4",
                    meta.badgeClass,
                  )}
                >
                  <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span>{meta.label}</span>
                </span>
              </div>
              <p className="text-[11px] leading-4 text-[#5C6270]">{sig.reason}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PriorityCardSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading top priorities"
      className="space-y-4"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-2">
          <div className="h-5 w-36 animate-pulse rounded-md bg-[#E3E1FA] motion-reduce:animate-none" />
          <div className="h-3.5 w-64 animate-pulse rounded-md bg-[#EEF0F6] motion-reduce:animate-none" />
        </div>
        <div className="h-7 w-28 animate-pulse rounded-full bg-[#E3E1FA] motion-reduce:animate-none" />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, idx) => (
          <div
            key={idx}
            className="h-[88px] animate-pulse rounded-xl border border-[#E4E6F0] bg-white p-4 motion-reduce:animate-none"
          >
            <div className="h-3 w-24 rounded bg-[#EEF0F6]" />
            <div className="mt-2.5 h-6 w-10 rounded bg-[#E3E1FA]" />
            <div className="mt-2 h-2.5 w-32 rounded bg-[#F4F5FA]" />
          </div>
        ))}
      </div>

      <div className="space-y-4">
        {/* Full-width Detected issues skeleton */}
        <div className="animate-pulse overflow-hidden rounded-2xl border border-[#E6E5EE] bg-white motion-reduce:animate-none">
          <div className="flex items-center justify-between gap-3 border-b border-[#EEF0F4] px-5 py-3.5">
            <div className="h-4 w-32 rounded bg-[#E3E1FA]" />
            <div className="h-3.5 w-16 rounded bg-[#EEF0F6]" />
          </div>
          <div className="space-y-3 bg-[#F7F8FF] px-3 py-3 sm:px-4">
            {Array.from({ length: 2 }, (_, idx) => (
              <div key={idx} className="space-y-3 rounded-[18px] border border-[#E8ECF3] bg-white p-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="h-10 w-10 rounded-xl bg-[#E3E1FA]" />
                    <div className="space-y-1.5">
                      <div className="h-3.5 w-28 rounded bg-[#E3E1FA]" />
                      <div className="h-3 w-40 rounded bg-[#EEF0F6]" />
                    </div>
                  </div>
                  <div className="h-6 w-24 rounded-full bg-[#EEF0F6]" />
                </div>
                <div className="h-5 w-3/4 max-w-lg rounded bg-[#E3E1FA]" />
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="h-14 rounded-xl bg-[#F4F5FA]" />
                  <div className="h-14 rounded-xl bg-[#F4F5FA]" />
                  <div className="h-14 rounded-xl bg-[#F4F5FA]" />
                </div>
                <div className="h-16 rounded-xl bg-[#ECEBF3]" />
                <div className="flex items-center justify-between gap-3">
                  <div className="h-3.5 w-48 rounded bg-[#EEF0F6]" />
                  <div className="h-9 w-40 rounded-xl bg-[#E3E1FA]" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent signals skeleton below */}
        <div className="animate-pulse overflow-hidden rounded-2xl border border-[#E6E5EE] bg-white motion-reduce:animate-none">
          <div className="flex items-center justify-between gap-3 border-b border-[#EEF0F4] px-5 py-3.5">
            <div className="h-4 w-28 rounded bg-[#E3E1FA]" />
            <div className="h-3.5 w-20 rounded-full bg-[#EEF0F6]" />
          </div>
          <div className="grid sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, idx) => (
              <div key={idx} className="border-b border-[#F0F2F5] px-5 py-3.5">
                <div className="h-4 w-3/4 rounded bg-[#EEF0F6]" />
                <div className="mt-2 h-3 w-1/2 rounded bg-[#F4F5FA]" />
              </div>
            ))}
          </div>
        </div>
      </div>
      <span className="sr-only">Loading verified priority findings.</span>
    </div>
  );
}

export function TopPrioritiesSection({
  data,
  loading = false,
  refreshing = false,
  error = null,
  onRetry,
}: TopPrioritiesSectionProps) {
  const openRoute = useWorkspaceNavigation();
  const [activeTier, setActiveTier] = useState<SeverityTier>("all");

  const primary = data?.priority_finding ?? null;
  const secondaryFindings = useMemo(
    () => (data ? data.findings.filter((item) => item.id !== primary?.id) : []),
    [data, primary?.id],
  );
  const allEligibleFindings = useMemo(
    () => (primary ? [primary, ...secondaryFindings] : secondaryFindings),
    [primary, secondaryFindings],
  );

  const severityCounts = useMemo(() => {
    const counts = { criticalHigh: 0, medium: 0, low: 0 };
    for (const item of allEligibleFindings) {
      if (item.severity === "critical" || item.severity === "high") counts.criticalHigh += 1;
      else if (item.severity === "medium") counts.medium += 1;
      else counts.low += 1;
    }
    return counts;
  }, [allEligibleFindings]);

  const effectiveTier = allEligibleFindings.length === 0 ? "all" : activeTier;
  const visiblePrimary =
    primary && matchesSeverityTier(primary.severity, effectiveTier) ? primary : null;
  const visibleSecondary = useMemo(
    () => secondaryFindings.filter((item) => matchesSeverityTier(item.severity, effectiveTier)),
    [secondaryFindings, effectiveTier],
  );

  // Loading state (never flashes empty state)
  if (loading && !data) {
    return (
      <section
        id="priority-finding"
        aria-labelledby="priority-findings-heading"
        className="min-w-0"
      >
        <h2 id="priority-findings-heading" className="sr-only">
          Top priorities
        </h2>
        <PriorityCardSkeleton />
      </section>
    );
  }

  // Standalone error state with functional Retry
  if (error && !data) {
    return (
      <section
        id="priority-finding"
        aria-labelledby="priority-findings-heading"
        className="min-w-0 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#F0EDFF] text-[#4438E8]"
              aria-hidden="true"
            >
              <Target className="h-4 w-4" />
            </span>
            <div>
              <h2
                id="priority-findings-heading"
                className="text-[1.125rem] font-semibold leading-6 tracking-[-0.015em] text-[#17191F]"
              >
                Top priorities
              </h2>
              <p className="mt-0.5 text-[13px] leading-5 text-[#707582]">
                Verified commerce signals ranked by operational urgency and evidence quality.
              </p>
            </div>
          </div>
        </div>

        <div
          role="alert"
          className="flex flex-col gap-3 rounded-xl border border-[#FECACA] bg-white p-5 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-start gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#FEF2F2] text-[#E5484D]">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-semibold text-[#17191F]">
                Unable to load verified priorities
              </p>
              <p className="mt-0.5 text-xs leading-5 text-[#707582]">{error}</p>
            </div>
          </div>
          {onRetry && (
            <button type="button" onClick={onRetry} className={cc.secondary}>
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Retry</span>
            </button>
          )}
        </div>
      </section>
    );
  }

  if (!data) return null;

  const eligibleCount = allEligibleFindings.length;
  const activeCountLabel = `${eligibleCount} active ${eligibleCount === 1 ? "finding" : "findings"}`;
  const signalEvaluation = data.signal_evaluation ?? null;

  const resources = data.evidence?.resources ?? [];
  const monitoredSourceCount = resources.length;
  const limitedSourceCount = resources.filter((resource) =>
    ["stale", "partial", "unauthorized", "not_synchronized", "retrieval_failed"].includes(
      resource.availability,
    ),
  ).length;
  const isStale =
    data.business_state.stale ||
    data.business_state.presentation_status === "stale" ||
    allEligibleFindings.some((item) => item.evidence_freshness.state === "stale");
  const isPartialCoverage =
    Boolean(signalEvaluation?.incomplete) ||
    data.business_state.presentation_status === "partial" ||
    limitedSourceCount > 0;
  const isIncompleteAssessment =
    eligibleCount === 0 && Boolean(signalEvaluation?.incomplete);

  const lastUpdatedIso =
    signalEvaluation?.evaluated_at ||
    data.evidence?.last_successful_sync_at ||
    data.evidence?.snapshot_generated_at ||
    data.retrieved_at ||
    null;

  const revExploreRoute = data.briefing?.next_investigation?.route || "/dashboard/rev-intell";

  const toggleTier = (tier: Exclude<SeverityTier, "all">) => {
    setActiveTier((current) => (current === tier ? "all" : tier));
  };

  return (
    <section
      id="priority-finding"
      aria-labelledby="priority-findings-heading"
      className="min-w-0 space-y-4"
    >
      {/* A. Revluma Operational Intelligence Section Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#D8D7FA] bg-[#F0EDFF] text-[#4438E8]"
            aria-hidden="true"
          >
            <Target className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2
              id="priority-findings-heading"
              className="text-[1.125rem] font-semibold leading-6 tracking-[-0.015em] text-[#17191F]"
            >
              Top priorities
            </h2>
            <p className="mt-0.5 text-[13px] leading-5 text-[#707582]">
              The most important issues identified across your store.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {refreshing && <StateBadge state="updating" />}
          {isStale && <StateBadge state="stale" />}
          {!isStale && isPartialCoverage && (
            <span className="inline-flex items-center rounded-full border border-[#F5D68B] bg-[#FFFBEB] px-2.5 py-0.5 text-[11px] font-medium text-[#92400E]">
              Limited evidence
            </span>
          )}
          {signalEvaluation && (
            <span className="inline-flex items-center rounded-full border border-[#D6E4FF] bg-[#EDF4FF] px-2.5 py-1 text-[11px] font-semibold tabular-nums text-[#2B59C3]">
              {signalEvaluation.summary.evaluated_count}/{signalEvaluation.summary.total_signals} signals evaluated
            </span>
          )}
          <span className="inline-flex items-center rounded-full border border-[#D8D7FA] bg-[#F0EDFF] px-3 py-1 text-xs font-semibold tabular-nums text-[#3525B8]">
            {activeCountLabel}
          </span>
        </div>
      </div>

      {/* B. Landing-inspired severity summary deck */}
      <SeveritySummaryDeck
        counts={severityCounts}
        totalCount={eligibleCount}
        activeTier={effectiveTier}
        onToggleTier={toggleTier}
      />

      {/* Inline error notice when background refresh failed alongside cached data */}
      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-2.5 text-xs text-[#991B1B]"
        >
          <span>{error}</span>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="font-semibold text-[#B42318] underline underline-offset-2 hover:text-[#7F1D1D]"
            >
              Retry
            </button>
          )}
        </div>
      )}

      {/* Stale data notice */}
      {isStale && (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-xl border border-[#F5D68B] bg-[#FFFBEB] px-4 py-2.5 text-xs leading-5 text-[#92400E]"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            Underlying store data is stale. Findings reflect the last synchronized state rather
            than live current performance.
          </span>
        </div>
      )}

      {/* Active severity filter pill */}
      {effectiveTier !== "all" && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#D8D7FA] bg-[#F0EDFF]/50 px-4 py-2 text-xs text-[#3525B8]">
          <span>
            Showing{" "}
            <strong className="font-semibold text-[#17191F]">
              {TIER_LABELS[effectiveTier]}
            </strong>{" "}
            priorities.
          </span>
          <button
            type="button"
            onClick={() => setActiveTier("all")}
            className={cn("font-semibold text-[#4438E8] hover:text-[#3525B8]", cc.focus)}
          >
            Show all priorities
          </button>
        </div>
      )}

      {/* C. Populated State: Full-width Detected issues with Recent signals below */}
      {eligibleCount > 0 ? (
        <div className="space-y-4">
          {/* Full-width Panel: Detected issues */}
          <div
            className="min-w-0 overflow-hidden rounded-2xl border border-[#E8ECF3] bg-white"
            style={{
              boxShadow:
                "0 1px 2px rgba(12, 10, 29, 0.03), 0 12px 26px -22px rgba(12, 10, 29, 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.96)",
            }}
          >
            <div className="flex items-center justify-between gap-2 border-b border-[#EEF0F4] px-5 py-3.5">
              <span className="text-[13.5px] font-semibold tracking-[-0.01em] text-[#172033]">
                Detected issues
              </span>
              <span className="text-[12px] tabular-nums text-[#98A2B3]">
                {(visiblePrimary ? 1 : 0) + visibleSecondary.length} open
              </span>
            </div>

            {visiblePrimary || visibleSecondary.length > 0 ? (
              <div
                className="space-y-3 px-3 py-3 sm:px-4 sm:py-4"
                style={{
                  background:
                    "radial-gradient(720px 200px at 50% -80px, rgba(68, 56, 232, 0.05), transparent 70%), linear-gradient(180deg, #F7F8FF 0%, #FFFFFF 100%)",
                }}
              >
                {visiblePrimary && (
                  <PriorityFindingCard
                    finding={visiblePrimary}
                    rank={1}
                    isPrimary
                    onInvestigate={openRoute}
                  />
                )}

                {visibleSecondary.length > 0 && (
                  <div className={cn(visiblePrimary && "pt-1")}>
                    <div className="flex items-center gap-3 px-1 pb-2.5">
                      <span className="h-px flex-1 bg-gradient-to-r from-transparent via-[#E2E4EC] to-transparent" aria-hidden="true" />
                      <div className="flex items-center gap-2">
                        <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-[#98A2B3]">
                          Other eligible findings
                        </span>
                        <span className="rounded-full border border-[#E6E8F0] bg-white px-2 py-0.5 text-[10.5px] font-semibold tabular-nums text-[#667085]">
                          {visibleSecondary.length}{" "}
                          {visibleSecondary.length === 1 ? "item" : "items"}
                        </span>
                      </div>
                      <span className="h-px flex-1 bg-gradient-to-r from-transparent via-[#E2E4EC] to-transparent" aria-hidden="true" />
                    </div>

                    <ol
                      aria-label="Other eligible priority findings"
                      className="space-y-3"
                    >
                      {visibleSecondary.map((finding, idx) => (
                        <li key={finding.id} className="min-w-0">
                          <PriorityFindingCard
                            finding={finding}
                            rank={idx + 2}
                            isPrimary={false}
                            onInvestigate={openRoute}
                          />
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-6 text-center">
                <p className="text-sm font-medium text-[#172033]">
                  No findings in this severity category.
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTier("all")}
                  className={cn(
                    "mt-3 inline-flex min-h-9 items-center justify-center rounded-lg border border-[#D8D7FA] bg-[#F7F8FF] px-3.5 text-xs font-semibold text-[#1F06AC] hover:bg-[#EEEBFF]",
                    cc.focus,
                  )}
                >
                  Show all priorities
                </button>
              </div>
            )}
          </div>

          {/* Below Panel: Recent signals (full-width companion to Detected issues) */}
          {signalEvaluation && signalEvaluation.signals.length > 0 && (
            <RecentSignalsPanel evaluation={signalEvaluation} />
          )}
        </div>
      ) : isIncompleteAssessment && signalEvaluation ? (
        /* D1. Distinct Incomplete Store Assessment State (NEVER masquerades as healthy) */
        <div className="rounded-2xl border border-[#D6E4FF] bg-white px-5 py-7 sm:px-8 sm:py-8">
          <div className="mx-auto max-w-[720px] space-y-5">
            <div className="flex flex-col items-center text-center">
              <div
                className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#F5D68B] bg-[#FFFBEB] text-[#B54708]"
                aria-hidden="true"
              >
                <ShieldAlert className="h-5 w-5" />
              </div>

              <h3 className="mt-3.5 text-[17px] font-semibold leading-snug tracking-[-0.015em] text-[#17191F]">
                Your store assessment is incomplete
              </h3>

              <p className="mt-2 max-w-[560px] text-[13.5px] leading-6 text-[#5C6270]">
                {signalEvaluation.summary.evaluated_count} of{" "}
                {signalEvaluation.summary.total_signals} business signal categories were evaluated.
                Because some signals failed, are stale, or lack data access, Revluma cannot rule
                out issues in unevaluated areas.
              </p>
            </div>

            <SignalCoveragePanel evaluation={signalEvaluation} />

            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-center">
              <button
                type="button"
                onClick={() => openRoute("/dashboard/integrations")}
                className={cn(
                  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#4438E8] px-5 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-[#3525B8]",
                  cc.focus,
                )}
              >
                <Database className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>Review data coverage</span>
                <ArrowRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              </button>

              <button
                type="button"
                onClick={() => openRoute(revExploreRoute)}
                className={cn(
                  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#D8D7FA] bg-[#F0EDFF]/50 px-5 py-2.5 text-xs font-semibold text-[#3525B8] transition-colors hover:border-[#4438E8] hover:bg-[#F0EDFF]",
                  cc.focus,
                )}
              >
                <Search className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>Explore with Rev Intelligence</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* D2. Legitimate Clean Empty State: Calm, analytical, non-celebratory */
        <div className="rounded-2xl border border-[#E3E1FA] bg-white px-5 py-8 sm:px-8 sm:py-9">
          <div className="mx-auto max-w-[680px]">
            <div
              className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl border border-[#D8D7FA] bg-[#F0EDFF] text-[#4438E8]"
              aria-hidden="true"
            >
              <ShieldCheck className="h-5 w-5" />
            </div>

            <h3 className="mt-4 text-center text-[17px] font-semibold leading-snug tracking-[-0.015em] text-[#17191F]">
              No verified priorities right now
            </h3>

            <p className="mx-auto mt-2 max-w-[540px] text-center text-[13.5px] leading-6 text-[#707582]">
              No findings currently meet the evidence threshold. This doesn&apos;t mean there are
              no business problems. Further investigation may uncover issues.
            </p>

            {/* Informational callout */}
            <div className="mt-6 flex items-start gap-3 rounded-xl border border-[#D6E4FF] bg-[#EDF4FF]/65 p-4">
              <Info
                className="mt-0.5 h-4 w-4 shrink-0 text-[#4438E8]"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-[#17191F]">What this means</p>
                <p className="mt-0.5 text-xs leading-5 text-[#4B5563]">
                  {data.priority_selection.reason ||
                    "Revluma has not established a sufficiently supported priority from the available evidence."}
                </p>
              </div>
            </div>

            {/* Signal evaluation coverage (when available) or honest legacy source fallback */}
            {signalEvaluation ? (
              <div className="mt-4">
                <SignalCoveragePanel evaluation={signalEvaluation} compact />
              </div>
            ) : (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="flex items-start gap-2.5 rounded-xl border border-[#E4E6F0] bg-[#FAFBFD] px-4 py-3">
                  <Database
                    className="mt-0.5 h-4 w-4 shrink-0 text-[#4777F5]"
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium text-[#707582]">Evidence coverage</p>
                    <p className="mt-0.5 text-xs font-semibold tabular-nums text-[#17191F]">
                      {monitoredSourceCount > 0
                        ? `${monitoredSourceCount} monitored ${monitoredSourceCount === 1 ? "source" : "sources"}`
                        : "No sources connected"}
                      {limitedSourceCount > 0 && (
                        <span className="font-normal text-[#92400E]">
                          {" "}
                          · {limitedSourceCount} limited
                        </span>
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-2.5 rounded-xl border border-[#E4E6F0] bg-[#FAFBFD] px-4 py-3">
                  <Clock
                    className="mt-0.5 h-4 w-4 shrink-0 text-[#4777F5]"
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium text-[#707582]">Last updated</p>
                    <p
                      className="mt-0.5 text-xs font-semibold tabular-nums text-[#17191F]"
                      title={dateTime(lastUpdatedIso)}
                    >
                      {relativeTime(lastUpdatedIso)}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Historical / excluded findings stay non-heading records */}
            {data.priority_selection.exclusions.length > 0 && (
              <div className="mt-4 rounded-xl border border-[#E4E6F0] bg-[#FAFBFD] p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#707582]">
                  Excluded from current priorities
                </p>
                <ul className="mt-2 space-y-1.5 text-xs text-[#4B5563]">
                  {data.priority_selection.exclusions.map((item) => (
                    <li
                      key={item.finding_id}
                      className="flex flex-wrap items-baseline justify-between gap-2"
                    >
                      <span className="font-medium text-[#17191F]">{item.title}</span>
                      <span className="text-[11px] text-[#707582]">
                        not current: {item.reason.replaceAll("_", " ")}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Primary Rev Intelligence exploration CTA */}
            <div className="mt-5">
              <button
                type="button"
                onClick={() => openRoute(revExploreRoute)}
                className={cn(
                  "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[#C9C7FA] bg-[#F0EDFF]/55 px-4 py-2.5 text-xs font-semibold text-[#3525B8] transition-colors hover:border-[#4438E8] hover:bg-[#4438E8] hover:text-white",
                  cc.focus,
                )}
              >
                <Search className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>Explore with Rev Intelligence</span>
                <ArrowRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default TopPrioritiesSection;
