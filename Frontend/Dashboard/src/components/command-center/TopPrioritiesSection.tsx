import { type MouseEvent, useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  ChevronRight,
  Clock,
  Database,
  Eye,
  Info,
  RefreshCw,
  Search,
  ShieldCheck,
  Target,
} from "lucide-react";
import { useInRouterContext, useNavigate } from "react-router-dom";
import { investigationRoute } from "@/lib/workspaceNavigation";
import { cn } from "@/lib/utils";
import { StateBadge, type CommandCenterAppState } from "./StateBadge";
import { cc } from "./tokens";
import type { CommandCenterData, Finding } from "./types";

export interface TopPrioritiesSectionProps {
  data: CommandCenterData | null;
  loading?: boolean;
  refreshing?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

type SeverityTier = "all" | "critical_high" | "medium" | "low";

const money = (value: number, currency: string) => {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
  } catch {
    return `${value} ${currency}`;
  }
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

function observationText(item: Finding["evidence"]["observations"][number]): string {
  if (item.value === null || item.availability !== "available") return "Unavailable";
  if (item.unit === "money" && typeof item.value === "number" && item.currency) {
    return money(item.value, item.currency);
  }
  if (item.unit === "count" || item.unit === "status") {
    return `${item.value}`;
  }
  if (item.unit === "percent" && typeof item.value === "number") {
    return `${item.value}%`;
  }
  return `${item.value} ${item.unit}`;
}

function isVerifiedFinding(finding: Finding): boolean {
  return (
    finding.evidence?.classification === "verified_observation" &&
    ["high", "moderate"].includes(finding.confidence?.classification)
  );
}

function findingEvidenceAppState(finding: Finding): CommandCenterAppState {
  if (finding.evidence_freshness.state === "stale") return "stale";
  if (finding.coverage.state === "partial" || finding.coverage.state === "incomplete") {
    return "partial";
  }
  if (finding.evidence_freshness.state === "fresh" && finding.coverage.complete) {
    return "current";
  }
  return "unavailable";
}

function matchesSeverityTier(severity: Finding["severity"], tier: SeverityTier): boolean {
  if (tier === "all") return true;
  if (tier === "critical_high") return severity === "critical" || severity === "high";
  return severity === tier;
}

function getSeverityBadge(severity: Finding["severity"]) {
  if (severity === "critical") {
    return {
      label: "Critical",
      pillClass: "bg-[#DC2626] text-white",
      accentBorderClass: "border-l-2 border-l-[#B42318]",
    };
  }
  if (severity === "high") {
    return {
      label: "High",
      pillClass: "border border-[#FECACA] bg-[#FEF2F2] text-[#B42318]",
      accentBorderClass: "border-l-2 border-l-[#B42318]",
    };
  }
  if (severity === "medium") {
    return {
      label: "Medium",
      pillClass: "border border-[#FDE68A] bg-[#FEF3C7] text-[#92400E]",
      accentBorderClass: "border-l-2 border-l-[#D97706]",
    };
  }
  return {
    label: "Low",
    pillClass: "border border-[#C7D2FE] bg-[#EEF2FF] text-[#4438E8]",
    accentBorderClass: "border-l-2 border-l-[#4438E8]",
  };
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

function PriorityCardSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading top priorities"
      className="space-y-4"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-2">
          <div className="h-5 w-36 animate-pulse rounded-md bg-[#E7E9EF] motion-reduce:animate-none" />
          <div className="h-3.5 w-64 animate-pulse rounded-md bg-[#EEF0F4] motion-reduce:animate-none" />
        </div>
        <div className="h-7 w-28 animate-pulse rounded-full bg-[#E7E9EF] motion-reduce:animate-none" />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, idx) => (
          <div
            key={idx}
            className="h-[88px] animate-pulse rounded-xl border border-[#E7E9EF] bg-white p-4 motion-reduce:animate-none"
          >
            <div className="h-3 w-24 rounded bg-[#EEF0F4]" />
            <div className="mt-2.5 h-6 w-10 rounded bg-[#E7E9EF]" />
            <div className="mt-2 h-2.5 w-32 rounded bg-[#F1F3F7]" />
          </div>
        ))}
      </div>

      <div className="space-y-3">
        {Array.from({ length: 2 }, (_, idx) => (
          <div
            key={idx}
            className="grid animate-pulse rounded-xl border border-[#E7E9EF] bg-white motion-reduce:animate-none lg:grid-cols-[120px_minmax(0,1fr)_248px]"
          >
            <div className="p-5">
              <div className="h-5 w-16 rounded-md bg-[#E7E9EF]" />
            </div>
            <div className="space-y-2.5 px-5 pb-5 lg:py-5">
              <div className="h-4 w-56 rounded bg-[#E7E9EF]" />
              <div className="h-3.5 w-full max-w-md rounded bg-[#EEF0F4]" />
              <div className="h-3 w-48 rounded bg-[#F1F3F7]" />
            </div>
            <div className="border-t border-[#E7E9EF] p-5 lg:border-l lg:border-t-0">
              <div className="h-3 w-16 rounded bg-[#EEF0F4]" />
              <div className="mt-2.5 h-3.5 w-40 rounded bg-[#E7E9EF]" />
              <div className="mt-4 h-4 w-28 rounded bg-[#E5E4FA]" />
            </div>
          </div>
        ))}
      </div>
      <span className="sr-only">Loading verified priority findings.</span>
    </div>
  );
}

interface PriorityCardProps {
  finding: Finding;
  rank: number;
  isPrimary: boolean;
  onInvestigate: (route: string) => void;
}

function PriorityItemCard({ finding, rank, isPrimary, onInvestigate }: PriorityCardProps) {
  const severity = getSeverityBadge(finding.severity);
  const verified = isVerifiedFinding(finding);
  const evidenceState = findingEvidenceAppState(finding);
  const availableObservations = finding.evidence.observations.filter(
    (obs) => obs.value !== null && obs.availability === "available",
  );
  const refCount = finding.evidence.references.length;
  const confidenceText = `${finding.confidence.classification.replaceAll("_", " ")} confidence`;
  const updatedIso = finding.last_verified_at || finding.detected_at;
  const periodLabel = `${finding.reporting_period.kind.replaceAll("_", " ")} · ${finding.reporting_period.timezone}`;

  const handleCardClick = (event: MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("button, a, summary, details, input")) return;
    onInvestigate(finding.investigation.route);
  };

  return (
    <article
      onClick={handleCardClick}
      className={cn(
        "group min-w-0 cursor-pointer overflow-hidden rounded-xl border border-[#E7E9EF] bg-white transition-colors hover:border-[#D4D8E4]",
        severity.accentBorderClass,
      )}
    >
      <div className="grid min-w-0 lg:grid-cols-[124px_minmax(0,1fr)_256px]">
        {/* Column 1: Compact Severity & Rank */}
        <div className="flex flex-wrap items-center gap-2 px-5 pt-4 lg:flex-col lg:items-start lg:gap-2 lg:py-5 lg:pl-5 lg:pr-3">
          <span
            className={cn(
              "inline-flex items-center rounded-md px-2.5 py-0.5 text-[11px] font-semibold leading-4 tracking-[0.01em]",
              severity.pillClass,
            )}
          >
            {severity.label}
          </span>
          <span className="text-[11px] font-semibold tabular-nums text-[#707582]">
            #{rank}
          </span>
          {isPrimary && (
            <span className="inline-flex items-center rounded-md border border-[#E7E9EF] bg-[#F8F9FB] px-2 py-0.5 text-[11px] font-medium text-[#343844]">
              {verified ? "Verified finding" : "Evidence-limited"}
            </span>
          )}
        </div>

        {/* Column 2: Title, Verified Observations, Explanation, Evidence & Provenance */}
        <div className="min-w-0 px-5 pb-4 pt-2.5 lg:px-4 lg:py-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            {isPrimary ? (
              <h3 className="text-[15px] font-semibold leading-snug tracking-[-0.01em] text-[#17191F]">
                {finding.title}
              </h3>
            ) : (
              <h4 className="text-[14.5px] font-semibold leading-snug tracking-[-0.01em] text-[#17191F]">
                {finding.title}
              </h4>
            )}
            {(evidenceState === "stale" || evidenceState === "partial") && (
              <StateBadge state={evidenceState} />
            )}
          </div>

          {/* Verified observed figures (never invented revenue impact) */}
          {availableObservations.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-[13px] leading-5">
              {availableObservations.map((obs, idx) => (
                <span key={`${obs.label}-${idx}`} className="inline-flex items-baseline gap-1">
                  <span className="text-[#707582]">{obs.label}:</span>
                  <span className="font-semibold tabular-nums text-[#17191F]">
                    {observationText(obs)}
                  </span>
                  {idx < availableObservations.length - 1 && (
                    <span className="ml-1.5 text-[#D1D5DB]" aria-hidden="true">
                      ·
                    </span>
                  )}
                </span>
              ))}
              <span className="text-[12px] text-[#707582]">({periodLabel})</span>
            </div>
          )}

          {/* Concise factual description (rendered once) */}
          <p className="mt-2 text-[13.5px] leading-6 text-[#4B5563]">
            {finding.description}
          </p>

          {/* Deterministic tie statement, when present */}
          {finding.priority.tie?.statement && (
            <p className="mt-2 rounded-lg border border-[#E7E9EF] bg-[#F8F9FB] px-3 py-2 text-xs leading-5 text-[#4B5563]">
              {finding.priority.tie.statement}
            </p>
          )}

          {/* Compact evidence & context chips (Linear / Reference A style) */}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-[#E7E9EF] bg-[#F8F9FB] px-2.5 py-1 text-[#4B5563]">
              <span className="font-medium text-[#17191F]">Evidence:</span>
              <span className="tabular-nums">
                {refCount > 0
                  ? `${refCount} ${refCount === 1 ? "source" : "sources"}`
                  : formatSourceLabel(finding.evidence.source)}
              </span>
            </span>

            <span className="inline-flex items-center gap-1.5 rounded-md border border-[#E7E9EF] bg-[#F8F9FB] px-2.5 py-1 text-[#4B5563]">
              <span>{confidenceText}</span>
            </span>

            {updatedIso && (
              <span
                className="inline-flex items-center gap-1 text-[12px] text-[#707582]"
                title={dateTime(updatedIso)}
              >
                <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span>Updated {relativeTime(updatedIso)}</span>
              </span>
            )}
          </div>

          {/* Primary finding epistemic separation: Priority vs. Confidence vs. Limitations */}
          {isPrimary && (
            <div className="mt-4 grid gap-3 rounded-xl border border-[#E7E9EF] bg-[#F8F9FB] p-3.5 sm:grid-cols-3">
              <div className="min-w-0">
                <h4 className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#17191F]">
                  Why this is the priority
                </h4>
                <ul className="mt-1.5 space-y-1 text-xs leading-5 text-[#4B5563]">
                  {(finding.priority.rationale.length > 0
                    ? finding.priority.rationale
                    : ["Ranked by verified severity, freshness, and coverage."]
                  ).map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>

              <div className="min-w-0">
                <h4 className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#17191F]">
                  Confidence
                </h4>
                <ul className="mt-1.5 space-y-1 text-xs leading-5 text-[#4B5563]">
                  {(finding.confidence.rationale.length > 0
                    ? finding.confidence.rationale
                    : [confidenceText]
                  ).map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>

              <div className="min-w-0">
                <h4 className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#17191F]">
                  Limits of this conclusion
                </h4>
                <ul className="mt-1.5 space-y-1 text-xs leading-5 text-[#4B5563]">
                  {(finding.limitations.length > 0
                    ? finding.limitations
                    : ["No additional evidence limitations recorded."]
                  ).map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Keyboard-native progressive disclosure for provenance, lifecycle & unknowns */}
          <details className="mt-3">
            <summary className={cn(cc.disclosure, "inline-flex items-center gap-1 select-none")}>
              Inspect evidence, provenance and uncertainty
            </summary>
            <div className="mt-2.5 space-y-2.5 rounded-xl border border-[#E7E9EF] bg-[#FAFBFD] p-3.5 text-xs leading-5 text-[#4B5563]">
              <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
                <div>
                  <dt className="font-medium text-[#707582]">Finding ID</dt>
                  <dd className="mt-0.5 font-mono text-[11px] text-[#17191F] break-all">
                    {finding.id}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-[#707582]">Ranking method</dt>
                  <dd className="mt-0.5 font-mono text-[11px] text-[#17191F]">
                    {finding.priority.method_version}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-[#707582]">Coverage run</dt>
                  <dd className="mt-0.5 text-[#17191F]">
                    {finding.coverage.run_id || "Not recorded"}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-[#707582]">Lifecycle validity</dt>
                  <dd className="mt-0.5 text-[#17191F]">
                    {finding.lifecycle.current_validity.replaceAll("_", " ")}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-[#707582]">Detected</dt>
                  <dd className="mt-0.5 tabular-nums text-[#17191F]">
                    {dateTime(finding.detected_at)}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-[#707582]">Last verified</dt>
                  <dd className="mt-0.5 tabular-nums text-[#17191F]">
                    {dateTime(finding.last_verified_at)}
                  </dd>
                </div>
              </dl>

              {!isPrimary && finding.limitations.length > 0 && (
                <div>
                  <p className="font-medium text-[#17191F]">Limitations</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {finding.limitations.map((item, idx) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}

              {finding.unknowns.length > 0 && (
                <div>
                  <p className="font-medium text-[#17191F]">Unknowns</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {finding.unknowns.map((item, idx) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}

              {finding.evidence.references.length > 0 && (
                <div>
                  <p className="font-medium text-[#17191F]">Evidence references</p>
                  <ul className="mt-1 space-y-0.5">
                    {finding.evidence.references.map((ref) => (
                      <li key={ref.id} className="font-mono text-[11px] text-[#4B5563]">
                        {ref.source_type}: {ref.source_record_id}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {finding.evidence.duplicate_finding_ids.length > 0 && (
                <p className="text-[11px] text-[#707582]">
                  Deduplicated records retained: {finding.evidence.duplicate_finding_ids.join(", ")}
                </p>
              )}
            </div>
          </details>
        </div>

        {/* Column 3: Next Step & Functional Rev Intelligence Action */}
        <div className="flex flex-col justify-between gap-4 border-t border-[#E7E9EF] bg-[#FAFBFD] px-5 py-4 lg:border-l lg:border-t-0 lg:px-5 lg:py-5">
          <div className="min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-[#707582]">Next step</span>
              <ChevronRight
                className="h-3.5 w-3.5 shrink-0 text-[#9CA3AF] transition-transform group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </div>

            {finding.recommendation.available && finding.recommendation.step ? (
              <div className="mt-2 space-y-1.5">
                <p className="text-[13px] font-medium leading-5 text-[#17191F]">
                  {finding.recommendation.step}
                </p>
                {finding.recommendation.expected_result && (
                  <p className="text-xs leading-5 text-[#4B5563]">
                    {finding.recommendation.expected_result}
                  </p>
                )}
                <p className="pt-0.5 text-[11px] leading-4 text-[#707582]">
                  Read-only merchant action, not executed by Revluma.
                </p>
              </div>
            ) : finding.recommendation.prerequisites.length > 0 ? (
              <ul className="mt-2 space-y-1.5 text-xs leading-5 text-[#4B5563]">
                {finding.recommendation.prerequisites.map((prereq, idx) => (
                  <li key={idx}>{prereq}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs leading-5 text-[#707582]">
                Review this signal in Rev Intelligence with its underlying records.
              </p>
            )}
          </div>

          <div className="pt-1">
            <button
              type="button"
              onClick={() => onInvestigate(finding.investigation.route)}
              className={cn(
                "inline-flex min-h-10 items-center gap-1.5 rounded-lg text-xs font-semibold text-[#4438E8] transition-colors hover:text-[#372CD1]",
                cc.focus,
              )}
            >
              <span>
                {isPrimary
                  ? "Investigate in Rev Intelligence"
                  : finding.next_step?.label &&
                      finding.next_step.label !== "Investigate with Rev"
                    ? finding.next_step.label
                    : "View investigation"}
              </span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </article>
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
            <Target className="mt-0.5 h-5 w-5 shrink-0 text-[#4438E8]" aria-hidden="true" />
            <div>
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
        </div>

        <div
          role="alert"
          className="flex flex-col gap-3 rounded-xl border border-[#FECACA] bg-white p-5 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-start gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#FEF2F2] text-[#B42318]">
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
    data.business_state.presentation_status === "partial" || limitedSourceCount > 0;

  const lastUpdatedIso =
    data.evidence?.last_successful_sync_at ||
    data.evidence?.snapshot_generated_at ||
    data.retrieved_at ||
    null;

  const revExploreRoute = data.briefing?.next_investigation?.route || "/dashboard/rev-intell";

  const summaryTiers = [
    {
      id: "critical_high" as const,
      label: "Critical & High",
      count: severityCounts.criticalHigh,
      note: "requires immediate attention",
      cardClass: "border-[#F3DCE0] bg-[#FFFBFB]",
      activeRingClass: "ring-2 ring-[#B42318]/25 border-[#DC2626]",
      barClass: "bg-[#DC2626]",
      iconWrapClass: "bg-[#FEE2E2]/80 text-[#B42318]",
      Icon: AlertCircle,
    },
    {
      id: "medium" as const,
      label: "Medium",
      count: severityCounts.medium,
      note: "should be reviewed soon",
      cardClass: "border-[#F3E5C2] bg-[#FFFDF7]",
      activeRingClass: "ring-2 ring-[#D97706]/25 border-[#D97706]",
      barClass: "bg-[#D97706]",
      iconWrapClass: "bg-[#FEF3C7]/90 text-[#92400E]",
      Icon: AlertTriangle,
    },
    {
      id: "low" as const,
      label: "Low & Watch",
      count: severityCounts.low,
      note: "early signal to monitor",
      cardClass: "border-[#E2E4F8] bg-[#FAF9FF]",
      activeRingClass: "ring-2 ring-[#4438E8]/20 border-[#4438E8]",
      barClass: "bg-[#4438E8]",
      iconWrapClass: "bg-[#EEF2FF] text-[#4438E8]",
      Icon: Eye,
    },
  ];

  const toggleTier = (tier: Exclude<SeverityTier, "all">) => {
    setActiveTier((current) => (current === tier ? "all" : tier));
  };

  return (
    <section
      id="priority-finding"
      aria-labelledby="priority-findings-heading"
      className="min-w-0 space-y-4"
    >
      {/* A. Clean, compact section header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <Target className="mt-0.5 h-5 w-5 shrink-0 text-[#4438E8]" aria-hidden="true" />
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
            <span className="inline-flex items-center rounded-full border border-[#FDE68A] bg-[#FFFBEB] px-2.5 py-0.5 text-[11px] font-medium text-[#92400E]">
              Limited evidence
            </span>
          )}
          <span className="inline-flex items-center rounded-full border border-[#E7E9EF] bg-white px-3 py-1 text-xs font-medium tabular-nums text-[#17191F]">
            {activeCountLabel}
          </span>
        </div>
      </div>

      {/* B. Compact severity summary row (preserves existing classifications) */}
      <div className="grid gap-3 sm:grid-cols-3" role="group" aria-label="Priority counts by severity">
        {summaryTiers.map((tier) => {
          const Icon = tier.Icon;
          const isSelected = effectiveTier === tier.id;
          const canFilter = eligibleCount > 0;
          const cardContent = (
            <div className="flex min-w-0 items-stretch gap-3">
              <span
                className={cn("w-1 shrink-0 rounded-full", tier.barClass)}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-[#4B5563]">{tier.label}</span>
                  <span
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                      tier.iconWrapClass,
                    )}
                    aria-hidden="true"
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                </div>
                <p className="mt-1 text-[1.375rem] font-semibold leading-7 tracking-[-0.02em] tabular-nums text-[#17191F]">
                  {tier.count}
                </p>
                <p className="mt-0.5 text-[11px] leading-4 text-[#707582]">{tier.note}</p>
              </div>
            </div>
          );

          if (canFilter) {
            return (
              <button
                key={tier.id}
                type="button"
                aria-pressed={isSelected}
                onClick={() => toggleTier(tier.id)}
                className={cn(
                  "min-w-0 rounded-xl border px-3.5 py-3 text-left transition-colors hover:border-[#D4D8E4]",
                  tier.cardClass,
                  isSelected && tier.activeRingClass,
                  cc.focus,
                )}
              >
                {cardContent}
              </button>
            );
          }

          return (
            <div
              key={tier.id}
              className={cn("min-w-0 rounded-xl border px-3.5 py-3", tier.cardClass)}
            >
              {cardContent}
            </div>
          );
        })}
      </div>

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

      {/* Stale data notice — never present outdated findings as freshly verified */}
      {isStale && (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] px-4 py-2.5 text-xs leading-5 text-[#92400E]"
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
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#E7E9EF] bg-white px-4 py-2 text-xs text-[#4B5563]">
          <span>
            Showing{" "}
            <strong className="font-semibold text-[#17191F]">
              {summaryTiers.find((t) => t.id === effectiveTier)?.label}
            </strong>{" "}
            priorities.
          </span>
          <button
            type="button"
            onClick={() => setActiveTier("all")}
            className={cn("font-semibold text-[#4438E8] hover:text-[#372CD1]", cc.focus)}
          >
            Show all priorities
          </button>
        </div>
      )}

      {/* C. Populated State — Ranked verified priorities */}
      {eligibleCount > 0 ? (
        <div className="space-y-4">
          {visiblePrimary && (
            <PriorityItemCard
              finding={visiblePrimary}
              rank={1}
              isPrimary
              onInvestigate={openRoute}
            />
          )}

          {visibleSecondary.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 pt-1">
                <h3 className="text-xs font-semibold uppercase tracking-[0.05em] text-[#707582]">
                  Other eligible findings
                </h3>
                <span className="text-xs tabular-nums text-[#707582]">
                  {visibleSecondary.length}{" "}
                  {visibleSecondary.length === 1 ? "item" : "items"}
                </span>
              </div>

              <ol
                aria-label="Other eligible priority findings"
                className="space-y-3"
              >
                {visibleSecondary.map((finding, idx) => (
                  <li key={finding.id} className="min-w-0">
                    <PriorityItemCard
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

          {!visiblePrimary && visibleSecondary.length === 0 && (
            <div className="rounded-xl border border-[#E7E9EF] bg-white p-6 text-center">
              <p className="text-sm font-medium text-[#17191F]">
                No findings in this severity category.
              </p>
              <button
                type="button"
                onClick={() => setActiveTier("all")}
                className={cn(
                  "mt-3 inline-flex min-h-10 items-center justify-center rounded-lg border border-[#D9DCE5] bg-white px-3.5 text-xs font-semibold text-[#17191F] hover:bg-[#F4F5F8]",
                  cc.focus,
                )}
              >
                Show all priorities
              </button>
            </div>
          )}
        </div>
      ) : (
        /* D. Empty State — Clean, intentional, non-celebratory */
        <div className="rounded-2xl border border-[#E7E9EF] bg-white px-5 py-8 sm:px-10 sm:py-10">
          <div className="mx-auto max-w-[560px]">
            <div
              className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-[#ECFDF3] text-[#15803D]"
              aria-hidden="true"
            >
              <ShieldCheck className="h-5 w-5" />
            </div>

            <h3 className="mt-4 text-center text-[17px] font-semibold leading-snug tracking-[-0.015em] text-[#17191F]">
              No verified priorities right now
            </h3>

            <p className="mt-2 text-center text-[13.5px] leading-6 text-[#707582]">
              No findings currently meet the evidence threshold. This doesn&apos;t mean there are
              no business problems. Further investigation may uncover issues.
            </p>

            {/* Informational callout */}
            <div className="mt-6 flex items-start gap-3 rounded-xl border border-[#E7E9EF] bg-[#F8F9FC] p-4">
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

            {/* Compact factual evidence & freshness row — real values only */}
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="flex items-start gap-2.5 rounded-xl border border-[#E7E9EF] bg-white px-4 py-3">
                <Database
                  className="mt-0.5 h-4 w-4 shrink-0 text-[#707582]"
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

              <div className="flex items-start gap-2.5 rounded-xl border border-[#E7E9EF] bg-white px-4 py-3">
                <Clock
                  className="mt-0.5 h-4 w-4 shrink-0 text-[#707582]"
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

            {/* Historical / excluded findings stay non-heading records */}
            {data.priority_selection.exclusions.length > 0 && (
              <div className="mt-4 rounded-xl border border-[#E7E9EF] bg-[#FAFBFD] p-4">
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
                  "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[#D8D7FA] bg-white px-4 py-2.5 text-xs font-semibold text-[#4438E8] transition-colors hover:border-[#4438E8] hover:bg-[#F5F4FF]",
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
