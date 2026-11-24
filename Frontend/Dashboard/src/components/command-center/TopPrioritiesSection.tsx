import { type MouseEvent, useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
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
import { SeveritySummaryDeck, type SeverityFilterTier } from "./SeveritySummaryDeck";
import { StateBadge, type CommandCenterAppState } from "./StateBadge";
import { cc } from "./tokens";
import type {
  CommandCenterData,
  Finding,
  SignalCategoryId,
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

const SIGNAL_CATEGORY_LABELS: Record<SignalCategoryId, string> = {
  storefront_readiness: "Storefront readiness",
  traffic_acquisition: "Traffic & acquisition",
  sales_revenue: "Sales & revenue",
  conversion_purchasing: "Conversion & purchasing",
  product_inventory: "Product & inventory",
  customer_fulfillment: "Customer & fulfillment",
};

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
      pillClass: "bg-[#E5484D] text-white",
      accentBorderClass: "border-l-[3px] border-l-[#E5484D]",
    };
  }
  if (severity === "high") {
    return {
      label: "High",
      pillClass: "border border-[#FBC4A3] bg-[#FFF4EC] text-[#B54708]",
      accentBorderClass: "border-l-[3px] border-l-[#F07832]",
    };
  }
  if (severity === "medium") {
    return {
      label: "Medium",
      pillClass: "border border-[#F5D68B] bg-[#FFFBEB] text-[#92400E]",
      accentBorderClass: "border-l-[3px] border-l-[#E5A126]",
    };
  }
  return {
    label: "Low",
    pillClass: "border border-[#C9C7FA] bg-[#F0EDFF] text-[#3525B8]",
    accentBorderClass: "border-l-[3px] border-l-[#6475E8]",
  };
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

      <div className="space-y-3">
        {Array.from({ length: 2 }, (_, idx) => (
          <div
            key={idx}
            className="grid animate-pulse rounded-xl border border-[#E4E6F0] bg-white motion-reduce:animate-none lg:grid-cols-[128px_minmax(0,1fr)_256px]"
          >
            <div className="p-5">
              <div className="h-5 w-16 rounded-md bg-[#E3E1FA]" />
            </div>
            <div className="space-y-2.5 px-5 pb-5 lg:py-5">
              <div className="h-4 w-56 rounded bg-[#E3E1FA]" />
              <div className="h-3.5 w-full max-w-md rounded bg-[#EEF0F6]" />
              <div className="h-3 w-48 rounded bg-[#F4F5FA]" />
            </div>
            <div className="border-t border-[#E4E6F0] p-5 lg:border-l lg:border-t-0">
              <div className="h-3 w-16 rounded bg-[#EEF0F6]" />
              <div className="mt-2.5 h-3.5 w-40 rounded bg-[#E3E1FA]" />
              <div className="mt-4 h-4 w-28 rounded bg-[#E3E1FA]" />
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
  const categoryLabel = finding.signal_category
    ? SIGNAL_CATEGORY_LABELS[finding.signal_category]
    : null;

  const handleCardClick = (event: MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("button, a, summary, details, input")) return;
    onInvestigate(finding.investigation.route);
  };

  return (
    <article
      onClick={handleCardClick}
      className={cn(
        "group min-w-0 cursor-pointer overflow-hidden rounded-xl border bg-white transition-all",
        isPrimary
          ? "border-[#D8D7FA] shadow-[0_1px_2px_rgba(53,37,184,0.05)] hover:border-[#B8B4F8]"
          : "border-[#E4E6F0] hover:border-[#C9C7FA]",
        severity.accentBorderClass,
      )}
    >
      <div className="grid min-w-0 lg:grid-cols-[132px_minmax(0,1fr)_264px]">
        {/* Column 1: Compact Severity, Rank & Verification Pill */}
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
            <span className="inline-flex items-center rounded-md border border-[#D8D7FA] bg-[#F0EDFF] px-2 py-0.5 text-[11px] font-medium text-[#3525B8]">
              {verified ? "Verified finding" : "Evidence-limited"}
            </span>
          )}
        </div>

        {/* Column 2: Title, Verified Observations, Explanation, Evidence & Provenance */}
        <div className="min-w-0 px-5 pb-4 pt-2.5 lg:px-4 lg:py-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 space-y-1">
              {categoryLabel && (
                <span className="inline-flex items-center rounded-full bg-[#EDF4FF] px-2.5 py-0.5 text-[10.5px] font-semibold text-[#2B59C3]">
                  {categoryLabel}
                </span>
              )}
              {isPrimary ? (
                <h3 className="text-[15px] font-semibold leading-snug tracking-[-0.01em] text-[#17191F]">
                  {finding.title}
                </h3>
              ) : (
                <h4 className="text-[14.5px] font-semibold leading-snug tracking-[-0.01em] text-[#17191F]">
                  {finding.title}
                </h4>
              )}
            </div>
            {(evidenceState === "stale" || evidenceState === "partial") && (
              <StateBadge state={evidenceState} />
            )}
          </div>

          {/* Verified observed figures (never invented revenue impact) */}
          {availableObservations.length > 0 && (
            <div className="mt-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-[13px] leading-5">
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

          {/* Concise factual description */}
          <p className="mt-2 text-[13.5px] leading-6 text-[#4B5563]">
            {finding.description}
          </p>

          {/* Deterministic tie statement, when present */}
          {finding.priority.tie?.statement && (
            <p className="mt-2 rounded-lg border border-[#D8D7FA] bg-[#F0EDFF]/45 px-3 py-2 text-xs leading-5 text-[#3525B8]">
              {finding.priority.tie.statement}
            </p>
          )}

          {/* Compact evidence & context chips */}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-[#E3E1FA] bg-[#F0EDFF]/55 px-2.5 py-1 text-[#3525B8]">
              <span className="font-medium">Evidence:</span>
              <span className="tabular-nums">
                {refCount > 0
                  ? `${refCount} ${refCount === 1 ? "source" : "sources"}`
                  : formatSourceLabel(finding.evidence.source)}
              </span>
            </span>

            <span className="inline-flex items-center gap-1.5 rounded-md border border-[#DCE6FA] bg-[#EDF4FF]/70 px-2.5 py-1 text-[#2B59C3]">
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
            <div className="mt-4 grid gap-3 rounded-xl border border-[#E4E6F0] bg-[#F4F5FA]/75 p-3.5 sm:grid-cols-3">
              <div className="min-w-0">
                <h4 className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#3525B8]">
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
                <h4 className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#2B59C3]">
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
            <summary className={cn(cc.disclosure, "inline-flex items-center gap-1 select-none text-[#3525B8] hover:text-[#4438E8]")}>
              Inspect evidence, provenance and uncertainty
            </summary>
            <div className="mt-2.5 space-y-2.5 rounded-xl border border-[#E4E6F0] bg-[#FAFBFD] p-3.5 text-xs leading-5 text-[#4B5563]">
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
        <div className="flex flex-col justify-between gap-4 border-t border-[#E4E6F0] bg-gradient-to-b from-[#F8F8FE] to-[#F4F5FA]/70 px-5 py-4 lg:border-l lg:border-t-0 lg:px-5 lg:py-5">
          <div className="min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[#3525B8]">Next step</span>
              <ChevronRight
                className="h-3.5 w-3.5 shrink-0 text-[#6475E8] transition-transform group-hover:translate-x-0.5"
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
                isPrimary
                  ? "inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-[#4438E8] px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-[#3525B8]"
                  : "inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-[#D8D7FA] bg-white px-3 py-1.5 text-xs font-semibold text-[#4438E8] transition-colors hover:border-[#4438E8] hover:bg-[#F0EDFF]",
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

      {/* C. Populated State: Ranked verified priorities (+ partial coverage transparency) */}
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
            <div className="rounded-xl border border-[#E4E6F0] bg-white p-6 text-center">
              <p className="text-sm font-medium text-[#17191F]">
                No findings in this severity category.
              </p>
              <button
                type="button"
                onClick={() => setActiveTier("all")}
                className={cn(
                  "mt-3 inline-flex min-h-10 items-center justify-center rounded-lg border border-[#D8D7FA] bg-[#F0EDFF]/60 px-3.5 text-xs font-semibold text-[#3525B8] hover:bg-[#F0EDFF]",
                  cc.focus,
                )}
              >
                Show all priorities
              </button>
            </div>
          )}

          {/* Scenario 7: Always disclose partial signal coverage alongside verified findings */}
          {signalEvaluation && signalEvaluation.incomplete && (
            <SignalCoveragePanel evaluation={signalEvaluation} compact />
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
