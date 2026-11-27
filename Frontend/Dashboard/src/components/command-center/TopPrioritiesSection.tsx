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
import { selectQueueFindings } from "./findingDisplay";
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
  /** Hide the embedded signals panel when the workspace rail renders it instead. */
  hideSignalsPanel?: boolean;
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
        badgeClass: "border-brand-lineStrong bg-brand-soft text-brand-deep",
        Icon: AlertCircle,
      };
    case "not_detected":
      return {
        label: "Checked · Clear",
        badgeClass: "border-success-line bg-success-soft text-success",
        Icon: CheckCircle2,
      };
    case "evaluation_failed":
      return {
        label: "Evaluation failed",
        badgeClass: "border-danger-line bg-danger-soft text-danger",
        Icon: XCircle,
      };
    case "stale":
      return {
        label: "Stale data",
        badgeClass: "border-warning-line bg-warning-soft text-warning",
        Icon: Clock,
      };
    case "not_evaluated":
    default:
      return {
        label: "Not evaluated",
        badgeClass: "border-line-soft bg-wash text-gray-600",
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
          ? "border-info-line bg-info-soft/65"
          : "border-brand-pale bg-brand-soft/40",
        compact ? "p-3.5" : "p-4",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
              evaluation.incomplete
                ? "bg-info-soft text-info"
                : "bg-brand-mist text-brand",
            )}
            aria-hidden="true"
          >
            <Layers className="h-3.5 w-3.5" />
          </span>
          <p className="text-xs font-semibold text-ink">
            Signal evaluation coverage
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium tabular-nums">
          <span className="rounded-full border border-brand-line bg-white px-2.5 py-0.5 text-brand-deep">
            {summary.evaluated_count} of {summary.total_signals} signals evaluated
          </span>
          {summary.verified_findings_count > 0 && (
            <span className="rounded-full border border-brand-lineStrong bg-brand-soft px-2 py-0.5 text-brand-deep">
              {summary.verified_findings_count} verified
            </span>
          )}
          {summary.failed_count > 0 && (
            <span className="rounded-full border border-danger-line bg-danger-soft px-2 py-0.5 text-danger">
              {summary.failed_count} failed
            </span>
          )}
          {summary.not_evaluated_count > 0 && (
            <span className="rounded-full border border-line-soft bg-white px-2 py-0.5 text-gray-600">
              {summary.not_evaluated_count} not evaluated
            </span>
          )}
          {summary.stale_count > 0 && (
            <span className="rounded-full border border-warning-line bg-warning-soft px-2 py-0.5 text-warning">
              {summary.stale_count} stale
            </span>
          )}
        </div>
      </div>

      {nonEvaluatedCount > 0 && (
        <p className="mt-2 text-xs leading-5 text-gray-600">
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
              className="flex flex-col justify-between gap-1.5 rounded-lg border border-line bg-white px-3 py-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-ink">{sig.label}</span>
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
              <p className="text-[11px] leading-4 text-gray-600">{sig.reason}</p>
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
          <div className="h-5 w-36 animate-pulse rounded-md bg-brand-pale motion-reduce:animate-none" />
          <div className="h-3.5 w-64 animate-pulse rounded-md bg-skeleton motion-reduce:animate-none" />
        </div>
        <div className="h-7 w-28 animate-pulse rounded-full bg-brand-pale motion-reduce:animate-none" />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, idx) => (
          <div
            key={idx}
            className="h-[88px] animate-pulse rounded-xl border border-line-soft bg-white p-4 motion-reduce:animate-none"
          >
            <div className="h-3 w-24 rounded bg-skeleton" />
            <div className="mt-2.5 h-6 w-10 rounded bg-brand-pale" />
            <div className="mt-2 h-2.5 w-32 rounded bg-wash" />
          </div>
        ))}
      </div>

      <div className="space-y-4">
        {/* Full-width Detected issues skeleton */}
        <div className="animate-pulse overflow-hidden rounded-2xl border border-line-soft bg-white motion-reduce:animate-none">
          <div className="flex items-center justify-between gap-3 border-b border-line-soft px-5 py-3.5">
            <div className="h-4 w-32 rounded bg-brand-pale" />
            <div className="h-3.5 w-16 rounded bg-skeleton" />
          </div>
          <div className="space-y-3 bg-veil px-3 py-3 sm:px-4">
            {Array.from({ length: 2 }, (_, idx) => (
              <div key={idx} className="space-y-3 rounded-[18px] border border-line-soft bg-white p-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="h-10 w-10 rounded-xl bg-brand-pale" />
                    <div className="space-y-1.5">
                      <div className="h-3.5 w-28 rounded bg-brand-pale" />
                      <div className="h-3 w-40 rounded bg-skeleton" />
                    </div>
                  </div>
                  <div className="h-6 w-24 rounded-full bg-skeleton" />
                </div>
                <div className="h-5 w-3/4 max-w-lg rounded bg-brand-pale" />
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="h-14 rounded-xl bg-wash" />
                  <div className="h-14 rounded-xl bg-wash" />
                  <div className="h-14 rounded-xl bg-wash" />
                </div>
                <div className="h-16 rounded-xl bg-skeleton" />
                <div className="flex items-center justify-between gap-3">
                  <div className="h-3.5 w-48 rounded bg-skeleton" />
                  <div className="h-9 w-40 rounded-xl bg-brand-pale" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent signals skeleton below */}
        <div className="animate-pulse overflow-hidden rounded-2xl border border-line-soft bg-white motion-reduce:animate-none">
          <div className="flex items-center justify-between gap-3 border-b border-line-soft px-5 py-3.5">
            <div className="h-4 w-28 rounded bg-brand-pale" />
            <div className="h-3.5 w-20 rounded-full bg-skeleton" />
          </div>
          <div className="grid sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, idx) => (
              <div key={idx} className="border-b border-wash px-5 py-3.5">
                <div className="h-4 w-3/4 rounded bg-skeleton" />
                <div className="mt-2 h-3 w-1/2 rounded bg-wash" />
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
  hideSignalsPanel = false,
}: TopPrioritiesSectionProps) {
  const openRoute = useWorkspaceNavigation();
  const [activeTier, setActiveTier] = useState<SeverityTier>("all");

  const allEligibleFindings = useMemo(() => selectQueueFindings(data), [data]);
  const primary = data?.priority_finding ?? null;
  const secondaryFindings = useMemo(
    () => allEligibleFindings.filter((item) => item.id !== primary?.id),
    [allEligibleFindings, primary?.id],
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
          Today's Priorities
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
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand"
              aria-hidden="true"
            >
              <Target className="h-4 w-4" />
            </span>
            <div>
              <h2
                id="priority-findings-heading"
                className="text-[1.125rem] font-semibold leading-6 tracking-[-0.015em] text-ink"
              >
                Today's Priorities
              </h2>
              <p className="mt-0.5 text-[13px] leading-5 text-ink-muted">
                Verified commerce signals ranked by operational urgency and evidence quality.
              </p>
            </div>
          </div>
        </div>

        <div
          role="alert"
          className="flex flex-col gap-3 rounded-xl border border-danger-line bg-white p-5 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-start gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-danger-soft text-severity-critical">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-semibold text-ink">
                Unable to load verified priorities
              </p>
              <p className="mt-0.5 text-xs leading-5 text-ink-muted">{error}</p>
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
      {/* A. Glass hero: section identity + live status pills */}
      <div
        className="relative flex min-w-0 flex-wrap items-start justify-between gap-3 overflow-hidden rounded-2xl border border-white/60 bg-white/70 px-5 py-5 backdrop-blur-xl sm:px-6"
        style={{
          background:
            "radial-gradient(560px 200px at 12% -40px, rgba(68, 56, 232, 0.10), transparent 65%), radial-gradient(480px 180px at 88% -30px, rgba(20, 184, 166, 0.10), transparent 60%), linear-gradient(180deg, rgb(var(--rv-surface-panel) / 0.85) 0%, rgb(var(--rv-surface-veil) / 0.75) 100%)",
          boxShadow:
            "0 4px 24px -6px rgba(15, 23, 42, 0.08), inset 0 1px 1px rgb(var(--rv-surface-panel) / 0.95)",
        }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -left-16 -top-24 h-56 w-56 rounded-full bg-brand/10 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-12 -top-20 h-48 w-48 rounded-full bg-teal-400/10 blur-3xl"
        />
        <div className="relative flex min-w-0 items-start gap-3">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-brand-line bg-brand-soft text-brand"
            aria-hidden="true"
          >
            <Target className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2
              id="priority-findings-heading"
              className="text-[1.125rem] font-semibold leading-6 tracking-[-0.015em] text-ink"
            >
              Today's Priorities
            </h2>
            <p className="mt-0.5 text-[13px] leading-5 text-ink-muted">
              The most important issues identified across your store.
            </p>
          </div>
        </div>

        <div className="relative flex flex-wrap items-center gap-2">
          {refreshing && <StateBadge state="updating" />}
          {isStale && <StateBadge state="stale" />}
          {!isStale && isPartialCoverage && (
            <span className="inline-flex items-center rounded-full border border-warning-lineStrong bg-warning-soft px-2.5 py-0.5 text-[11px] font-medium text-warning">
              Limited evidence
            </span>
          )}
          {signalEvaluation && (
            <span className="inline-flex items-center rounded-full border border-info-line bg-info-soft px-2.5 py-1 text-[11px] font-semibold tabular-nums text-info">
              {signalEvaluation.summary.evaluated_count}/{signalEvaluation.summary.total_signals} signals evaluated
            </span>
          )}
          <span className="inline-flex items-center rounded-full border border-brand-line bg-brand-soft px-3 py-1 text-xs font-semibold tabular-nums text-brand-deep">
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
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger-line bg-danger-soft px-4 py-2.5 text-xs text-danger-deep"
        >
          <span>{error}</span>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="cursor-pointer font-semibold text-danger underline underline-offset-2 transition-colors hover:text-danger-deeper"
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
          className="flex items-start gap-2.5 rounded-xl border border-warning-lineStrong bg-warning-soft px-4 py-2.5 text-xs leading-5 text-warning"
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
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand-line bg-brand-soft/50 px-4 py-2 text-xs text-brand-deep">
          <span>
            Showing{" "}
            <strong className="font-semibold text-ink">
              {TIER_LABELS[effectiveTier]}
            </strong>{" "}
            priorities.
          </span>
          <button
            type="button"
            onClick={() => setActiveTier("all")}
            className={cn("cursor-pointer font-semibold text-brand transition-colors hover:text-brand-deep", cc.focus)}
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
            className="min-w-0 overflow-hidden rounded-2xl border border-white/60 bg-white/70 backdrop-blur-xl"
            style={{
              background:
                "radial-gradient(720px 220px at 50% -90px, rgba(68, 56, 232, 0.07), transparent 70%), linear-gradient(180deg, rgb(var(--rv-surface-panel) / 0.9) 0%, rgb(var(--rv-surface-veil) / 0.8) 100%)",
              boxShadow:
                "0 4px 24px -6px rgba(15, 23, 42, 0.08), inset 0 1px 1px rgb(var(--rv-surface-panel) / 0.95)",
            }}
          >
            <div className="flex items-center justify-between gap-2 border-b border-white/60 bg-white/60 px-5 py-3.5 backdrop-blur-md">
              <span className="text-[13.5px] font-semibold tracking-[-0.01em] text-ink">
                Detected issues
              </span>
              <span className="rounded-full border border-line bg-white/80 px-2.5 py-0.5 text-[12px] font-semibold tabular-nums text-slate-600">
                {(visiblePrimary ? 1 : 0) + visibleSecondary.length} open
              </span>
            </div>

            {visiblePrimary || visibleSecondary.length > 0 ? (
              <div className="space-y-3 px-3 py-3 sm:px-4 sm:py-4">
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
                      <span className="h-px flex-1 bg-gradient-to-r from-transparent via-line to-transparent" aria-hidden="true" />
                      <div className="flex items-center gap-2">
                        <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
                          Other eligible findings
                        </span>
                        <span className="rounded-full border border-line bg-white px-2 py-0.5 text-[10.5px] font-semibold tabular-nums text-ink-tertiary">
                          {visibleSecondary.length}{" "}
                          {visibleSecondary.length === 1 ? "item" : "items"}
                        </span>
                      </div>
                      <span className="h-px flex-1 bg-gradient-to-r from-transparent via-line to-transparent" aria-hidden="true" />
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
              <div className="m-3 rounded-xl border border-white/60 bg-white/60 p-6 text-center backdrop-blur-md sm:m-4">
                <p className="text-sm font-medium text-ink">
                  No findings in this severity category.
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTier("all")}
                  className={cn(
                    "mt-3 inline-flex cursor-pointer min-h-9 items-center justify-center rounded-lg border border-brand-line bg-veil px-3.5 text-xs font-semibold text-brand-deeper transition-colors hover:bg-brand-mist",
                    cc.focus,
                  )}
                >
                  Show all priorities
                </button>
              </div>
            )}
          </div>

          {/* Below Panel: Recent signals (full-width companion to Detected issues) */}
          {signalEvaluation && signalEvaluation.signals.length > 0 && !hideSignalsPanel && (
            <RecentSignalsPanel evaluation={signalEvaluation} />
          )}
        </div>
      ) : isIncompleteAssessment && signalEvaluation ? (
        /* D1. Distinct Incomplete Store Assessment State (NEVER masquerades as healthy) */
        <div className="rounded-2xl border border-info-line bg-white px-5 py-7 sm:px-8 sm:py-8">
          <div className="mx-auto max-w-[720px] space-y-5">
            <div className="flex flex-col items-center text-center">
              <div
                className="flex h-11 w-11 items-center justify-center rounded-xl border border-warning-lineStrong bg-warning-soft text-warning"
                aria-hidden="true"
              >
                <ShieldAlert className="h-5 w-5" />
              </div>

              <h3 className="mt-3.5 text-[17px] font-semibold leading-snug tracking-[-0.015em] text-ink">
                Your store assessment is incomplete
              </h3>

              <p className="mt-2 max-w-[560px] text-[13.5px] leading-6 text-gray-600">
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
                  "inline-flex cursor-pointer min-h-11 items-center justify-center gap-2 rounded-xl bg-brand px-5 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-brand-deep",
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
                  "inline-flex cursor-pointer min-h-11 items-center justify-center gap-2 rounded-xl border border-brand-line bg-brand-soft/50 px-5 py-2.5 text-xs font-semibold text-brand-deep transition-colors hover:border-brand hover:bg-brand-soft",
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
        <div className="rounded-2xl border border-brand-pale bg-white px-5 py-8 sm:px-8 sm:py-9">
          <div className="mx-auto max-w-[680px]">
            <div
              className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl border border-brand-line bg-brand-soft text-brand"
              aria-hidden="true"
            >
              <ShieldCheck className="h-5 w-5" />
            </div>

            <h3 className="mt-4 text-center text-[17px] font-semibold leading-snug tracking-[-0.015em] text-ink">
              No verified priorities right now
            </h3>

            <p className="mx-auto mt-2 max-w-[540px] text-center text-[13.5px] leading-6 text-ink-muted">
              No findings currently meet the evidence threshold. This doesn&apos;t mean there are
              no business problems. Further investigation may uncover issues.
            </p>

            {/* Informational callout */}
            <div className="mt-6 flex items-start gap-3 rounded-xl border border-info-line bg-info-soft/65 p-4">
              <Info
                className="mt-0.5 h-4 w-4 shrink-0 text-brand"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-ink">What this means</p>
                <p className="mt-0.5 text-xs leading-5 text-gray-600">
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
                <div className="flex items-start gap-2.5 rounded-xl border border-line-soft bg-subtle px-4 py-3">
                  <Database
                    className="mt-0.5 h-4 w-4 shrink-0 text-info-bright"
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium text-ink-muted">Evidence coverage</p>
                    <p className="mt-0.5 text-xs font-semibold tabular-nums text-ink">
                      {monitoredSourceCount > 0
                        ? `${monitoredSourceCount} monitored ${monitoredSourceCount === 1 ? "source" : "sources"}`
                        : "No sources connected"}
                      {limitedSourceCount > 0 && (
                        <span className="font-normal text-warning">
                          {" "}
                          · {limitedSourceCount} limited
                        </span>
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-2.5 rounded-xl border border-line-soft bg-subtle px-4 py-3">
                  <Clock
                    className="mt-0.5 h-4 w-4 shrink-0 text-info-bright"
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium text-ink-muted">Last updated</p>
                    <p
                      className="mt-0.5 text-xs font-semibold tabular-nums text-ink"
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
              <div className="mt-4 rounded-xl border border-line-soft bg-subtle p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-ink-muted">
                  Excluded from current priorities
                </p>
                <ul className="mt-2 space-y-1.5 text-xs text-gray-600">
                  {data.priority_selection.exclusions.map((item) => (
                    <li
                      key={item.finding_id}
                      className="flex flex-wrap items-baseline justify-between gap-2"
                    >
                      <span className="font-medium text-ink">{item.title}</span>
                      <span className="text-[11px] text-ink-muted">
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
                  "inline-flex cursor-pointer min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-brand-lineStrong bg-brand-soft/55 px-4 py-2.5 text-xs font-semibold text-brand-deep transition-colors hover:border-brand hover:bg-brand hover:text-white",
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
