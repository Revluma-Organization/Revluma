import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowDown,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Info,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useInRouterContext, useNavigate } from "react-router-dom";
import type { CommandCenterFailure } from "@/lib/commandCenterError";
import {
  resolveOperationalBriefing,
  type OperationalBriefingTone,
  type ResolvedDevelopmentEntry,
} from "@/lib/operationalBriefing";
import { cn } from "@/lib/utils";
import { investigationRoute } from "@/lib/workspaceNavigation";
import type { CommandCenterData } from "./types";

export interface OperationalBriefingSectionProps {
  data: CommandCenterData;
  refreshing?: boolean;
  failure?: CommandCenterFailure | null;
  nowOverride?: Date;
  onRefresh?: () => void | Promise<void>;
}

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F06AC] focus-visible:ring-offset-2";

const TONE_DOT: Record<OperationalBriefingTone, string> = {
  positive: "bg-[#12B76A]",
  progress: "bg-[#1F06AC]",
  attention: "bg-[#D97706]",
  negative: "bg-[#D92D20]",
  neutral: "bg-[#98A2B3]",
};

const TONE_TEXT: Record<OperationalBriefingTone, string> = {
  positive: "text-[#067647]",
  progress: "text-[#1F06AC]",
  attention: "text-[#93470E]",
  negative: "text-[#B42318]",
  neutral: "text-[#475467]",
};

const LIFECYCLE_BADGE: Record<ResolvedDevelopmentEntry["lifecycle"], string> = {
  new: "border-[#D8E0F7] bg-[#F5F7FF] text-[#1F06AC]",
  ongoing: "border-[#E4E7EC] bg-[#F9FAFB] text-[#475467]",
  resolved: "border-[#ABEFC6] bg-[#ECFDF3] text-[#067647]",
};

const LIFECYCLE_DOT: Record<ResolvedDevelopmentEntry["lifecycle"], string> = {
  new: "bg-[#1F06AC]",
  ongoing: "bg-[#98A2B3]",
  resolved: "bg-[#12B76A]",
};

const REFRESH_FEEDBACK_MS = 4_000;

function useBriefingNavigation() {
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

export function OperationalBriefingSection({
  data,
  refreshing = false,
  failure = null,
  nowOverride,
  onRefresh,
}: OperationalBriefingSectionProps) {
  const openRoute = useBriefingNavigation();

  // Track manual briefing refresh completion honestly (only after backend settles).
  const [refreshFeedback, setRefreshFeedback] = useState<"succeeded" | "failed" | null>(null);
  const refreshRequestedRef = useRef(false);
  const prevRefreshingRef = useRef(refreshing);

  useEffect(() => {
    const wasRefreshing = prevRefreshingRef.current;
    prevRefreshingRef.current = refreshing;
    if (wasRefreshing && !refreshing && refreshRequestedRef.current) {
      refreshRequestedRef.current = false;
      setRefreshFeedback(failure ? "failed" : "succeeded");
    }
  }, [refreshing, failure]);

  useEffect(() => {
    if (!refreshFeedback) return;
    const timer = window.setTimeout(() => setRefreshFeedback(null), REFRESH_FEEDBACK_MS);
    return () => window.clearTimeout(timer);
  }, [refreshFeedback]);

  const handleRefresh = () => {
    if (!onRefresh || refreshing) return;
    refreshRequestedRef.current = true;
    setRefreshFeedback(null);
    void onRefresh();
  };

  const briefing = resolveOperationalBriefing(data, {
    failure,
    now: nowOverride,
  });

  const { timestamp, assessment, featured, developments, context } = briefing;

  return (
    <section
      aria-labelledby="operational-briefing-heading"
      className="min-w-0 overflow-hidden rounded-[28px] border border-[#E3E8F2] bg-[#F7F8FC] shadow-[0_18px_55px_rgba(20,31,65,0.09)]"
    >
      {/* 1. Briefing Header and Business Assessment */}
      <div className="p-4 sm:p-6 lg:p-7">
        <div className="rounded-2xl border border-[#E8EBF4] bg-white px-5 py-4 shadow-[0_3px_12px_rgba(16,24,40,0.035)] sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#4338CA]">
                Operational briefing
              </p>
              <p className="mt-1 text-xs text-[#667085]">
                Your latest business intelligence briefing
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span title={timestamp.exactTitle ?? undefined} className="text-xs text-[#667085] tabular-nums">
                {timestamp.label}
              </span>
              {onRefresh && (
                <div className="inline-flex items-center gap-2">
                  {refreshFeedback === "succeeded" && (
                    <span role="status" className="inline-flex items-center gap-1 text-xs font-medium text-[#067647]">
                      <Check className="h-3 w-3" aria-hidden="true" />
                      <span>Updated</span>
                    </span>
                  )}
                  {refreshFeedback === "failed" && (
                    <span role="status" className="text-xs font-medium text-[#B42318]">Update failed</span>
                  )}
                  <button
                    type="button"
                    onClick={handleRefresh}
                    disabled={refreshing}
                    aria-busy={refreshing}
                    aria-label={refreshing ? "Updating operational briefing…" : "Update operational briefing"}
                    className={cn(
                      "inline-flex min-h-9 items-center gap-2 rounded-lg border border-[#DDE3F0] bg-white px-3 text-xs font-semibold text-[#344054] shadow-sm transition-all hover:border-[#B9C4DD] hover:bg-[#F8F9FF] disabled:cursor-not-allowed disabled:opacity-55",
                      FOCUS_RING,
                    )}
                  >
                    <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
                    <span>{refreshing ? "Updating…" : "Update briefing"}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(245px,0.75fr)]">
          <div className="relative isolate overflow-hidden rounded-2xl bg-[linear-gradient(125deg,#111A39_0%,#1D2A5B_58%,#303F82_100%)] px-6 py-7 text-white shadow-[0_12px_28px_rgba(26,39,91,0.18)] sm:px-8 sm:py-9">
            <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-24 -z-10 h-64 w-64 rounded-full border-[36px] border-white/[0.045]" />
            <div aria-hidden="true" className="pointer-events-none absolute -bottom-28 right-24 -z-10 h-56 w-56 rounded-full bg-[#7C8DFF]/10 blur-2xl" />
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.09] px-3 py-1.5 text-[11px] font-semibold tracking-wide text-white/90">
              <span aria-hidden="true" className={cn("h-2 w-2 rounded-full", TONE_DOT[assessment.tone])} />
              Business assessment
            </div>
            <h2
              id="operational-briefing-heading"
              className="mt-5 max-w-[46rem] text-[1.8rem] font-semibold leading-[1.13] tracking-[-0.04em] text-white sm:text-[2.45rem]"
            >
              {assessment.headline}
            </h2>
            <p className="mt-4 max-w-[46rem] text-sm leading-7 text-[#E0E6FA] sm:text-[0.95rem]">
              {assessment.summary}
            </p>
            {assessment.noFindingsNote && (
              <p className="mt-3 max-w-[44rem] border-l-2 border-white/25 pl-3 text-xs leading-5 text-[#C4CDE8]">
                {assessment.noFindingsNote}
              </p>
            )}
            {assessment.primaryAction && (
              <div className="mt-6">
                {assessment.primaryAction.isAnchor ? (
                  <a
                    href={assessment.primaryAction.href}
                    className={cn("inline-flex min-h-10 items-center gap-2 rounded-lg bg-white px-4 text-xs font-bold text-[#1B2860] shadow-sm transition-colors hover:bg-[#EEF1FF]", FOCUS_RING)}
                  >
                    <span>{assessment.primaryAction.label}</span>
                    <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() => openRoute(assessment.primaryAction!.href)}
                    className={cn("inline-flex min-h-10 items-center gap-2 rounded-lg bg-white px-4 text-xs font-bold text-[#1B2860] shadow-sm transition-colors hover:bg-[#EEF1FF]", FOCUS_RING)}
                  >
                    <span>{assessment.primaryAction.label}</span>
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <article className="flex min-h-[132px] flex-col justify-between rounded-2xl border border-[#F0D9B6] bg-[linear-gradient(145deg,#FFFCF5_0%,#FFF7E8_100%)] p-5 shadow-[0_4px_14px_rgba(146,91,20,0.045)]">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#9A5B13]">Business posture</span>
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/80 text-[#A15C0A] ring-1 ring-[#F2E2C9]">
                  <AlertCircle className="h-4 w-4" aria-hidden="true" />
                </span>
              </div>
              <div>
                <p className="text-xl font-semibold tracking-[-0.03em] text-[#653D12]">{assessment.label}</p>
                <p className="mt-1 text-xs leading-5 text-[#8B663B]">What the verified business evidence currently indicates.</p>
              </div>
            </article>

            <article className="flex min-h-[132px] flex-col justify-between rounded-2xl border border-[#D9E1F5] bg-[linear-gradient(145deg,#F8FAFF_0%,#EEF2FF_100%)] p-5 shadow-[0_4px_14px_rgba(43,64,140,0.045)]">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#4655A4]">Evidence freshness</span>
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/85 text-[#4655A4] ring-1 ring-[#E0E6FA]">
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                </span>
              </div>
              <div>
                <p className="text-xl font-semibold tracking-[-0.03em] text-[#24336D]">{assessment.dataQualityLabel}</p>
                <p className="mt-1 text-xs leading-5 text-[#6876AD]">Data coverage and freshness are assessed separately from store connection.</p>
              </div>
            </article>
          </div>
        </div>
      </div>

      {/* 2. Featured Intelligence — "A closer look" (always rendered, never silently hidden) */}
      <div
        aria-labelledby="briefing-featured-heading"
        className="border-t border-[#E7EAF2] bg-white px-4 py-6 sm:px-7 sm:py-7"
      >
        <h3
          id="briefing-featured-heading"
          className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#4655A4]"
        >
          A closer look
        </h3>

        {featured.status === "qualified" && featured.item ? (
          <article className="mt-4 overflow-hidden rounded-2xl border border-[#E2E7F5] bg-[#F8F9FF] p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                  featured.item.verification_status === "verified"
                    ? "border-[#ABEFC6] bg-[#ECFDF3] text-[#067647]"
                    : "border-[#FEDF89] bg-[#FFFAEB] text-[#93470E]",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    featured.item.verification_status === "verified"
                      ? "bg-[#12B76A]"
                      : "bg-[#F79009]",
                  )}
                />
                {featured.item.verification_status === "verified"
                  ? "Verified finding"
                  : "Hypothesis"}
              </span>
              <span className="text-[11px] font-medium text-[#667085]">
                {featured.item.is_new ? "New discovery" : "Ongoing discovery"}
              </span>
            </div>

            <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_250px] lg:gap-7">
              <div className="min-w-0">
                <h4 className="text-xl font-semibold leading-tight tracking-[-0.03em] text-[#101828] sm:text-[1.4rem]">
                  {featured.item.title}
                </h4>

                <p className="mt-2.5 max-w-3xl text-sm leading-7 text-[#344054]">
                  {featured.item.explanation}
                </p>

                {featured.item.why_it_matters && (
                  <p className="mt-3 max-w-3xl text-sm leading-6 text-[#475467]">
                    <span className="font-semibold text-[#344054]">Why it matters </span>
                    {featured.item.why_it_matters}
                  </p>
                )}
              </div>

              <aside className="flex min-w-0 flex-col justify-between gap-4 rounded-xl border border-[#E6EAF4] bg-white/85 p-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#667085]">
                    Supporting evidence
                  </p>
                  <p className="mt-2 text-xs leading-5 text-[#344054]">
                    {featured.item.evidence_summary}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => openRoute(featured.item!.action_route)}
                  className={cn(
                    "inline-flex min-h-10 items-center justify-between gap-2 rounded-lg bg-[#2413A5] px-3.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-[#1B0D86]",
                    FOCUS_RING,
                  )}
                >
                  <span>{featured.item.action_label}</span>
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </aside>
            </div>
          </article>
        ) : featured.empty ? (
          <div
            data-featured-empty-state={featured.empty.state}
            className="mt-4 overflow-hidden rounded-2xl border border-[#DCE4F7] bg-[linear-gradient(115deg,#F4F7FF_0%,#F8FAFF_58%,#EEF3FF_100%)] p-5 sm:p-6"
          >
            <div className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-[#4655A4] shadow-sm ring-1 ring-[#E1E7F5]"
              >
                {featured.empty.state === "no_new_findings" ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-[#475467]" />
                ) : featured.empty.state === "investigation_running" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-[#1F06AC] motion-reduce:animate-none" />
                ) : featured.empty.state === "generation_failed" ? (
                  <AlertCircle className="h-3.5 w-3.5 text-[#B42318]" />
                ) : (
                  <Info className="h-3.5 w-3.5 text-[#475467]" />
                )}
              </span>

              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase tracking-[0.13em] text-[#5969AA]">
                  {featured.empty.statusLabel}
                </p>
                <p className="mt-1.5 text-base font-semibold tracking-[-0.02em] text-[#1B2859]">
                  {featured.empty.headline}
                </p>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-[#46516F]">
                  {featured.empty.explanation}
                </p>
                {featured.empty.clarification && (
                  <p className="mt-2 max-w-2xl text-xs leading-5 text-[#68749B]">
                    {featured.empty.clarification}
                  </p>
                )}

                {featured.empty.canRetry && onRefresh && (
                  <button
                    type="button"
                    onClick={handleRefresh}
                    disabled={refreshing}
                    className={cn(
                      "mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[#D0D5DD] bg-white px-3 text-xs font-medium text-[#344054] transition-colors hover:bg-[#F9FAFB] disabled:opacity-55",
                      FOCUS_RING,
                    )}
                  >
                    <RefreshCw
                      className={cn(
                        "h-3.5 w-3.5",
                        refreshing && "animate-spin motion-reduce:animate-none",
                      )}
                      aria-hidden="true"
                    />
                    <span>Try again</span>
                  </button>
                )}

                {featured.empty.actionHref && featured.empty.actionLabel && (
                  <button
                    type="button"
                    onClick={() => openRoute(featured.empty!.actionHref!)}
                    className={cn(
                      "mt-2.5 inline-flex min-h-8 items-center gap-1.5 rounded-md text-xs font-semibold text-[#1F06AC] transition-colors hover:text-[#18058C]",
                      FOCUS_RING,
                    )}
                  >
                    <span>{featured.empty.actionLabel}</span>
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* 3. Recent Developments — compact editorial timeline */}
      <div
        aria-labelledby="briefing-developments-heading"
        className="border-t border-[#E7EAF2] bg-[#FBFCFF] px-4 py-6 sm:px-7 sm:py-7"
      >
        <div>
          <h3
            id="briefing-developments-heading"
            className="text-[11px] font-semibold uppercase tracking-[0.11em] text-[#667085]"
          >
            Recent developments
          </h3>
          <p className="mt-1 text-xs text-[#667085]">
            Meaningful changes and developments across your business.
          </p>
        </div>

        {developments.items.length > 0 ? (
          <ol className="mt-5 space-y-3">
            {developments.items.map((entry) => (
              <li key={entry.id} className="relative rounded-xl border border-[#E8ECF4] bg-white p-4 shadow-[0_2px_8px_rgba(16,24,40,0.025)]">
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute right-4 top-4 h-2.5 w-2.5 rounded-full ring-4 ring-[#F8FAFF]",
                    LIFECYCLE_DOT[entry.lifecycle],
                  )}
                />
                <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-[#0F172A]">{entry.title}</p>
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full border px-2 py-px text-[11px] font-medium",
                        LIFECYCLE_BADGE[entry.lifecycle],
                      )}
                    >
                      {entry.lifecycleLabel}
                    </span>
                  </div>
                  <span
                    title={entry.exactTimeTitle ?? undefined}
                    className="shrink-0 text-xs text-[#667085] tabular-nums"
                  >
                    {entry.timeLabel}
                  </span>
                </div>
                <p className="mt-1 max-w-3xl text-xs leading-5 text-[#475467]">
                  {entry.explanation}
                </p>
                {entry.route && entry.actionLabel && (
                  <button
                    type="button"
                    onClick={() => openRoute(entry.route!)}
                    className={cn(
                      "mt-1.5 inline-flex min-h-8 items-center gap-1 rounded-md text-xs font-medium text-[#1F06AC] transition-colors hover:text-[#18058C]",
                      FOCUS_RING,
                    )}
                  >
                    <span>{entry.actionLabel}</span>
                    <ArrowRight className="h-3 w-3" aria-hidden="true" />
                  </button>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <div className="mt-4 rounded-2xl border border-dashed border-[#D9E0EC] bg-white px-5 py-6">
            <p className="text-sm font-medium text-[#344054]">
              {developments.emptyHeadline}
            </p>
            {developments.emptyExplanation && (
              <p className="mt-1 text-xs leading-5 text-[#667085]">
                {developments.emptyExplanation}
              </p>
            )}
          </div>
        )}
      </div>

      {/* 4. Expandable Briefing Evidence and Context */}
      <div className="border-t border-[#E7EAF2] bg-[#F2F4F9] px-4 py-4 sm:px-7">
        <details className="group">
          <summary
            className={cn(
              "flex cursor-pointer list-none flex-col items-start gap-1 rounded-md py-1 text-xs font-medium text-[#344054] transition-colors hover:text-[#0F172A] sm:flex-row sm:items-center sm:justify-between sm:gap-3 [&::-webkit-details-marker]:hidden",
              FOCUS_RING,
            )}
          >
            <span className="inline-flex shrink-0 items-center gap-2">
              <ChevronDown
                className="h-3.5 w-3.5 shrink-0 text-[#667085] transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none"
                aria-hidden="true"
              />
              <span>How this briefing was prepared</span>
            </span>
            <span className="pl-5 text-xs font-normal text-[#667085] sm:truncate sm:pl-0">
              {context.summaryPreview}
            </span>
          </summary>

          <div className="mt-4 space-y-5 border-t border-[#EAECF0] pt-4 text-xs">
            <div className="grid gap-6 sm:grid-cols-2">
              {/* Left: Scope, timing & limitations */}
              <div className="space-y-4">
                <div>
                  <p className="font-semibold text-[#344054]">Briefing scope and timing</p>
                  <dl className="mt-2 space-y-1.5 text-[#475467]">
                    <div className="flex flex-wrap justify-between gap-2">
                      <dt className="text-[#667085]">Reporting period</dt>
                      <dd className="font-medium text-[#101828]">
                        {context.reportingPeriodLabel}
                      </dd>
                    </div>
                    {context.comparisonPeriodLabel && (
                      <div className="flex flex-wrap justify-between gap-2">
                        <dt className="text-[#667085]">Comparison period</dt>
                        <dd className="font-medium text-[#101828]">
                          {context.comparisonPeriodLabel}
                        </dd>
                      </div>
                    )}
                    <div className="flex flex-wrap justify-between gap-2">
                      <dt className="text-[#667085]">Store timezone</dt>
                      <dd className="font-medium text-[#101828]">{context.timezone}</dd>
                    </div>
                    {timestamp.exactTitle && (
                      <div className="flex flex-wrap justify-between gap-2">
                        <dt className="text-[#667085]">Briefing generated</dt>
                        <dd className="font-medium text-[#101828]">
                          {timestamp.exactTitle.replace(/^Briefing generated\s+/i, "")}
                        </dd>
                      </div>
                    )}
                    {timestamp.previousLabel && (
                      <div className="flex flex-wrap justify-between gap-2">
                        <dt className="text-[#667085]">Previous briefing</dt>
                        <dd className="font-medium text-[#101828]">{timestamp.previousLabel}</dd>
                      </div>
                    )}
                  </dl>
                </div>

                {context.merchantLimitations.length > 0 && (
                  <div>
                    <p className="font-semibold text-[#344054]">
                      Limitations and missing evidence
                    </p>
                    <ul className="mt-2 space-y-1.5 leading-5 text-[#475467]">
                      {context.merchantLimitations.map((note) => (
                        <li key={note} className="flex gap-2">
                          <span aria-hidden="true" className="text-[#98A2B3]">
                            •
                          </span>
                          <span>{note}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Right: Evidence categories examined */}
              <div>
                <p className="font-semibold text-[#344054]">Evidence categories examined</p>
                {context.categories.length > 0 ? (
                  <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                    {context.categories.map((cat) => (
                      <li key={cat.id} className="rounded-xl border border-[#E8ECF3] bg-white p-3 shadow-[0_2px_7px_rgba(16,24,40,0.025)]">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium text-[#101828]">{cat.name}</span>
                          <span
                            className={cn(
                              "inline-flex items-center gap-1.5 font-medium",
                              TONE_TEXT[cat.tone],
                            )}
                          >
                            <span
                              aria-hidden="true"
                              className={cn(
                                "h-1.5 w-1.5 rounded-full",
                                TONE_DOT[cat.tone],
                              )}
                            />
                            {cat.statusLabel}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-[#667085]">
                          {cat.freshnessDetail}
                          {cat.coverageDetail ? ` · ${cat.coverageDetail}` : ""}
                        </p>
                        {cat.merchantNote && (
                          <p className="mt-1 text-[11px] leading-4 text-[#475467]">
                            {cat.merchantNote}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-[#667085]">
                    No verified store evidence sources are recorded for this briefing yet.
                  </p>
                )}
              </div>
            </div>

            <p className="border-t border-[#EAECF0] pt-3 text-[11px] leading-5 text-[#667085]">
              {context.unknownSemantics}
            </p>

            {/* Advanced technical details — strictly secondary and collapsed by default */}
            {context.technicalReferences.length > 0 && (
              <details className="pt-1">
                <summary
                  className={cn(
                    "cursor-pointer text-[11px] font-medium text-[#667085] hover:text-[#344054]",
                    FOCUS_RING,
                  )}
                >
                  Technical references
                </summary>
                <dl className="mt-2 space-y-1 font-mono text-[11px] text-[#667085]">
                  {context.technicalReferences.map((ref) => (
                    <div key={ref.label} className="flex flex-wrap gap-x-2">
                      <dt className="text-[#475467]">{ref.label}:</dt>
                      <dd className="break-all">{ref.value}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            )}
          </div>
        </details>
      </div>
    </section>
  );
}
