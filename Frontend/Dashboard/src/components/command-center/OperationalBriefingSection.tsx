import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowDown,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Database,
  Info,
  Loader2,
  PlugZap,
  RefreshCw,
} from "lucide-react";
import { useInRouterContext, useNavigate } from "react-router-dom";
import type { CommandCenterFailure } from "@/lib/commandCenterError";
import { resolveWelcomeConnectionStatus } from "@/lib/commandCenterWelcome";
import {
  resolveOperationalBriefing,
  type OperationalBriefingTone,
  type ResolvedDevelopmentEntry,
} from "@/lib/operationalBriefing";
import { cn } from "@/lib/utils";
import { investigationRoute } from "@/lib/workspaceNavigation";
import { StateBadge, type CommandCenterAppState } from "./StateBadge";
import { cc } from "./tokens";
import type { CommandCenterData } from "./types";

export interface OperationalBriefingSectionProps {
  data: CommandCenterData;
  refreshing?: boolean;
  failure?: CommandCenterFailure | null;
  nowOverride?: Date;
  onRefresh?: () => void | Promise<void>;
}

const TONE_DOT: Record<OperationalBriefingTone, string> = {
  positive: "bg-[#12B76A]",
  progress: "bg-[#4438E8]",
  attention: "bg-[#D97706]",
  negative: "bg-[#DC2626]",
  neutral: "bg-[#98A2B3]",
};

const TONE_TEXT: Record<OperationalBriefingTone, string> = {
  positive: "text-[#067647]",
  progress: "text-[#4438E8]",
  attention: "text-[#92400E]",
  negative: "text-[#B42318]",
  neutral: "text-[#707582]",
};

const LIFECYCLE_BADGE: Record<ResolvedDevelopmentEntry["lifecycle"], string> = {
  new: "border-[#D4D3FA] bg-[#EEF0FF] text-[#4438E8]",
  ongoing: "border-[#E7E9EF] bg-[#F4F5F8] text-[#525866]",
  resolved: "border-[#ABEFC6] bg-[#ECFDF3] text-[#067647]",
};

const LIFECYCLE_DOT: Record<ResolvedDevelopmentEntry["lifecycle"], string> = {
  new: "bg-[#4438E8]",
  ongoing: "bg-[#98A2B3]",
  resolved: "bg-[#12B76A]",
};

const REFRESH_FEEDBACK_MS = 4_000;

function mapDataQualityToAppState(
  quality: string,
  refreshing: boolean,
): CommandCenterAppState {
  if (refreshing) return "updating";
  switch (quality) {
    case "verified":
      return "current";
    case "syncing":
      return "updating";
    case "stale":
      return "stale";
    case "partial":
      return "partial";
    case "unavailable":
      return "unavailable";
    case "insufficient":
    default:
      return "empty";
  }
}

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
  const [expandedOverview, setExpandedOverview] = useState(false);
  const [showAllEvidenceCategories, setShowAllEvidenceCategories] = useState(false);
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
  const limitedCategories = context.categories.filter((c) => c.tone !== "positive");
  const verifiedCategories = context.categories.filter((c) => c.tone === "positive");
  const limitedCategoryCount = limitedCategories.length;
  // Always surface every limited/attention source first so gaps are never hidden;
  // collapse excess verified sources behind progressive disclosure when a store
  // reports many sources so the right rail stays balanced with the briefing.
  const orderedCategories = [...limitedCategories, ...verifiedCategories];
  const defaultVisibleEvidenceCount = Math.max(6, limitedCategories.length);
  const hasCollapsibleEvidence = orderedCategories.length > Math.max(8, limitedCategories.length);
  const visibleCategories =
    !hasCollapsibleEvidence || showAllEvidenceCategories
      ? orderedCategories
      : orderedCategories.slice(0, defaultVisibleEvidenceCount);
  const hiddenVerifiedCount = Math.max(0, orderedCategories.length - visibleCategories.length);
  const baseCoverageAppState = mapDataQualityToAppState(assessment.dataQuality, refreshing);
  const coverageAppState: CommandCenterAppState =
    baseCoverageAppState === "current" && limitedCategoryCount > 0
      ? "partial"
      : baseCoverageAppState;
  // The Evidence & data coverage card badge describes the examined source list
  // itself: when every examined source is verified (e.g. 22 of 22 verified),
  // never contradict it with "Partial coverage" due to a non-source restriction
  // (such as quiet/unverified webhooks, which belong in Operational data health).
  const allExaminedSourcesVerified =
    !refreshing &&
    context.categories.length > 0 &&
    limitedCategoryCount === 0 &&
    (baseCoverageAppState === "current" || baseCoverageAppState === "partial");
  const evidencePanelAppState: CommandCenterAppState = allExaminedSourcesVerified
    ? "current"
    : coverageAppState;
  const evidencePanelLabel = allExaminedSourcesVerified ? "All sources verified" : undefined;

  const integrationStatus = resolveWelcomeConnectionStatus(data, false, failure);
  const integrationAppState: CommandCenterAppState = refreshing
    ? "updating"
    : integrationStatus.tone === "positive"
      ? "current"
      : integrationStatus.tone === "progress"
        ? "updating"
        : integrationStatus.tone === "warning"
          ? "partial"
          : integrationStatus.tone === "negative"
            ? "unavailable"
            : "empty";

  const webhookBlock = data.integration?.webhooks;
  const webhookState = typeof webhookBlock?.state === "string" ? webhookBlock.state : null;
  const rawWebhookNote =
    typeof webhookBlock?.note === "string" && webhookBlock.note.trim().length > 0
      ? webhookBlock.note.trim()
      : null;
  const statusExplanationText =
    data.integration?.status_explanation || integrationStatus.description || "";
  const showWebhookNote = Boolean(
    rawWebhookNote &&
      webhookState &&
      ["unknown", "degraded", "failed", "not_registered"].includes(webhookState) &&
      !statusExplanationText.toLowerCase().includes(rawWebhookNote.toLowerCase()),
  );
  const webhookNoteIsWarning = Boolean(
    showWebhookNote &&
      (data.integration?.overall_status !== "connected" ||
        webhookState === "degraded" ||
        webhookState === "failed" ||
        webhookState === "not_registered"),
  );

  const hasExtendedOverview = Boolean(
    data.briefing.observation || data.briefing.implication,
  );
  const showIntegrationAction = Boolean(
    integrationStatus.needsAction ||
      limitedCategoryCount > 0 ||
      data.business_state.stale,
  );

  return (
    <section
      aria-labelledby="operational-briefing-heading"
      data-briefing-layout="hybrid"
      className="min-w-0 grid gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(310px,0.95fr)] lg:items-start"
    >
      {/* LEFT: Editorial Briefing Centrepiece (A. Business overview, B. Recent developments, C. Areas worth investigating) */}
      <div className={cn(cc.surface, "overflow-hidden")}>
        {/* Briefing Header & A. Business Overview */}
        <div className="px-5 py-6 sm:px-7 sm:py-7">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#4438E8]">
                Operational briefing
              </p>
              <p className="mt-1 text-xs text-[#707582]">
                Business overview · {context.reportingPeriodLabel}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs sm:justify-end">
              {/* Independent business assessment posture & data quality axis */}
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 font-medium",
                    TONE_TEXT[assessment.tone],
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn("h-1.5 w-1.5 shrink-0 rounded-full", TONE_DOT[assessment.tone])}
                  />
                  <span>{assessment.label}</span>
                </span>
                <span aria-hidden="true" className="text-[#D0D5DD]">
                  ·
                </span>
                <StateBadge
                  state={coverageAppState}
                  label={assessment.dataQualityLabel}
                />
              </div>

              <span aria-hidden="true" className="hidden text-[#D0D5DD] sm:inline">
                |
              </span>

              {/* Authoritative briefing generation time (distinct from sync time) */}
              <span
                title={timestamp.exactTitle ?? undefined}
                className="text-[#707582] tabular-nums"
              >
                {timestamp.label}
              </span>

              {onRefresh && (
                <div className="inline-flex items-center gap-2">
                  {refreshFeedback === "succeeded" && (
                    <span
                      role="status"
                      className="inline-flex items-center gap-1 text-xs font-medium text-[#067647]"
                    >
                      <Check className="h-3 w-3" aria-hidden="true" />
                      <span>Updated</span>
                    </span>
                  )}
                  {refreshFeedback === "failed" && (
                    <span role="status" className="text-xs font-medium text-[#B42318]">
                      Update failed
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={handleRefresh}
                    disabled={refreshing}
                    aria-busy={refreshing}
                    aria-label={
                      refreshing ? "Updating operational briefing…" : "Update operational briefing"
                    }
                    className={cn(
                      "inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-[#707582] transition-colors hover:bg-[#F4F5F8] hover:text-[#17191F] disabled:cursor-not-allowed disabled:opacity-55",
                      cc.focus,
                    )}
                  >
                    <RefreshCw
                      className={cn(
                        "h-3 w-3",
                        refreshing && "animate-spin motion-reduce:animate-none",
                      )}
                      aria-hidden="true"
                    />
                    <span>{refreshing ? "Updating…" : "Update"}</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* A. Business Overview Narrative */}
          <div className="mt-5 max-w-3xl">
            <h2
              id="operational-briefing-heading"
              className="text-[1.3rem] font-semibold leading-[1.28] tracking-[-0.025em] text-[#17191F] sm:text-[1.45rem]"
            >
              {assessment.headline}
            </h2>
            <p className="mt-2.5 text-sm leading-6 text-[#343844]">
              {assessment.summary}
            </p>
            {assessment.noFindingsNote && (
              <p className="mt-2 text-xs leading-5 text-[#707582]">
                {assessment.noFindingsNote}
              </p>
            )}

            {hasExtendedOverview && (
              <div className="mt-3">
                <button
                  type="button"
                  aria-expanded={expandedOverview}
                  onClick={() => setExpandedOverview((open) => !open)}
                  className={cn(
                    "inline-flex items-center gap-1.5 text-xs font-semibold text-[#4438E8] transition-colors hover:text-[#372CD1]",
                    cc.focus,
                  )}
                >
                  <ChevronDown
                    className={cn(
                      "h-3.5 w-3.5 transition-transform duration-150 motion-reduce:transition-none",
                      expandedOverview && "rotate-180",
                    )}
                    aria-hidden="true"
                  />
                  <span>
                    {expandedOverview ? "Hide briefing notes" : "Read full briefing notes"}
                  </span>
                </button>
                {expandedOverview && (
                  <div className={cn("mt-3 space-y-2 p-3.5 text-xs leading-5 text-[#343844]", cc.surfaceSubtle)}>
                    {data.briefing.observation && (
                      <p>
                        <span className="font-semibold text-[#17191F]">Observed evidence: </span>
                        {data.briefing.observation}
                      </p>
                    )}
                    {data.briefing.implication && (
                      <p>
                        <span className="font-semibold text-[#17191F]">Operational context: </span>
                        {data.briefing.implication}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {assessment.primaryAction && (
            <div className="mt-4">
              {assessment.primaryAction.isAnchor ? (
                <a
                  href={assessment.primaryAction.href}
                  className={cn(
                    "inline-flex min-h-9 items-center gap-1.5 rounded-md text-xs font-semibold text-[#4438E8] transition-colors hover:text-[#372CD1]",
                    cc.focus,
                  )}
                >
                  <span>{assessment.primaryAction.label}</span>
                  <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              ) : (
                <button
                  type="button"
                  onClick={() => openRoute(assessment.primaryAction!.href)}
                  className={cn(
                    "inline-flex min-h-9 items-center gap-1.5 rounded-md text-xs font-semibold text-[#4438E8] transition-colors hover:text-[#372CD1]",
                    cc.focus,
                  )}
                >
                  <span>{assessment.primaryAction.label}</span>
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* B. Recent Developments — compact editorial timeline */}
        <div
          aria-labelledby="briefing-developments-heading"
          className={cn("border-t px-5 py-6 sm:px-7", cc.divider)}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h3
                id="briefing-developments-heading"
                className="text-sm font-semibold text-[#17191F]"
              >
                Recent developments
              </h3>
              <p className="mt-0.5 text-xs text-[#707582]">
                Meaningful changes and developments across your business.
              </p>
            </div>
            {context.comparisonPeriodLabel && (
              <span className="text-[11px] text-[#707582]">
                Compared with {context.comparisonPeriodLabel.toLowerCase()}
              </span>
            )}
          </div>

          {developments.items.length > 0 ? (
            <ol className="mt-4 space-y-4 border-l border-[#E7E9EF] pl-5">
              {developments.items.map((entry) => (
                <li key={entry.id} className="relative">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute -left-[25px] top-1.5 h-2 w-2 rounded-full ring-4 ring-white",
                      LIFECYCLE_DOT[entry.lifecycle],
                    )}
                  />
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-[#17191F]">{entry.title}</p>
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
                      className="shrink-0 text-xs text-[#707582] tabular-nums"
                    >
                      {entry.timeLabel}
                    </span>
                  </div>
                  <p className="mt-1 max-w-3xl text-xs leading-5 text-[#343844]">
                    {entry.explanation}
                  </p>
                  {entry.route && entry.actionLabel && (
                    <button
                      type="button"
                      onClick={() => openRoute(entry.route!)}
                      className={cn(
                        "mt-1.5 inline-flex min-h-8 items-center gap-1 rounded-md text-xs font-medium text-[#4438E8] transition-colors hover:text-[#372CD1]",
                        cc.focus,
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
            <div className="mt-3.5 rounded-xl border border-[#E7E9EF] bg-[#FAFBFD] px-4 py-3.5">
              <p className="text-sm font-medium text-[#17191F]">
                {developments.emptyHeadline}
              </p>
              {developments.emptyExplanation && (
                <p className="mt-1 text-xs leading-5 text-[#707582]">
                  {developments.emptyExplanation}
                </p>
              )}
            </div>
          )}
        </div>

        {/* C. Areas Worth Investigating — "A closer look" (always rendered, never silently hidden) */}
        <div
          aria-labelledby="briefing-featured-heading"
          className={cn("border-t px-5 py-6 sm:px-7", cc.divider)}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h3
                id="briefing-featured-heading"
                className="text-sm font-semibold text-[#17191F]"
              >
                Areas worth investigating
              </h3>
              <p className="mt-0.5 text-xs text-[#707582]">
                A closer look · Signals and hypotheses separated from established causes.
              </p>
            </div>
          </div>

          {featured.status === "qualified" && featured.item ? (
            <article className="mt-3.5 rounded-xl border border-[#D4D3FA] border-l-[3px] border-l-[#4438E8] bg-[#F8F8FE] p-5">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
                    featured.item.verification_status === "verified"
                      ? "border-[#ABEFC6] bg-[#ECFDF3] text-[#067647]"
                      : "border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      featured.item.verification_status === "verified"
                        ? "bg-[#12B76A]"
                        : "bg-[#D97706]",
                    )}
                  />
                  {featured.item.verification_status === "verified"
                    ? "Verified finding"
                    : "Hypothesis"}
                </span>
                <span className="text-[11px] font-medium text-[#707582]">
                  {featured.item.is_new ? "New discovery" : "Ongoing discovery"}
                </span>
              </div>

              <h4 className="mt-3 text-base font-semibold leading-snug tracking-[-0.015em] text-[#17191F]">
                {featured.item.title}
              </h4>

              <p className="mt-1.5 max-w-3xl text-sm leading-6 text-[#343844]">
                {featured.item.explanation}
              </p>

              {featured.item.why_it_matters && (
                <p className="mt-2 max-w-3xl text-xs leading-5 text-[#707582]">
                  <span className="font-semibold text-[#17191F]">Why it matters: </span>
                  {featured.item.why_it_matters}
                </p>
              )}

              <div className="mt-4 flex flex-col gap-3 border-t border-[#E4E3FA] pt-3.5 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-[#707582]">
                  <span className="font-semibold text-[#17191F]">Supporting evidence: </span>
                  {featured.item.evidence_summary}
                </p>

                <button
                  type="button"
                  onClick={() => openRoute(featured.item!.action_route)}
                  className={cn(
                    "inline-flex min-h-9 shrink-0 items-center gap-1.5 self-start rounded-md text-xs font-semibold text-[#4438E8] transition-colors hover:text-[#372CD1] sm:self-auto",
                    cc.focus,
                  )}
                >
                  <span>{featured.item.action_label}</span>
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            </article>
          ) : featured.empty ? (
            <div
              data-featured-empty-state={featured.empty.state}
              className="mt-3.5 rounded-xl border border-[#E7E9EF] bg-[#FAFBFD] p-4 sm:p-5"
            >
              <div className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-[#707582] ring-1 ring-[#E7E9EF]"
                >
                  {featured.empty.state === "no_new_findings" ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-[#525866]" />
                  ) : featured.empty.state === "investigation_running" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-[#4438E8] motion-reduce:animate-none" />
                  ) : featured.empty.state === "generation_failed" ? (
                    <AlertCircle className="h-3.5 w-3.5 text-[#B42318]" />
                  ) : (
                    <Info className="h-3.5 w-3.5 text-[#525866]" />
                  )}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-[#707582]">
                    {featured.empty.statusLabel}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-[#17191F]">
                    {featured.empty.headline}
                  </p>
                  <p className="mt-1 max-w-2xl text-xs leading-5 text-[#343844]">
                    {featured.empty.explanation}
                  </p>
                  {featured.empty.clarification && (
                    <p className="mt-1.5 max-w-2xl text-xs leading-5 text-[#707582]">
                      {featured.empty.clarification}
                    </p>
                  )}

                  {featured.empty.canRetry && onRefresh && (
                    <button
                      type="button"
                      onClick={handleRefresh}
                      disabled={refreshing}
                      className={cn(
                        "mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[#D9DCE5] bg-white px-3 text-xs font-semibold text-[#17191F] transition-colors hover:bg-[#F4F5F8] disabled:opacity-55",
                        cc.focus,
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
                        "mt-2.5 inline-flex min-h-8 items-center gap-1.5 rounded-md text-xs font-semibold text-[#4438E8] transition-colors hover:text-[#372CD1]",
                        cc.focus,
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
      </div>

      {/* RIGHT: Compact Supporting Intelligence Panels (D. Evidence & data coverage, E. Operational data health) */}
      <aside aria-label="Briefing evidence and operational data health" className="min-w-0 space-y-5">
        {/* D. Evidence and Data Coverage */}
        <section
          id="evidence-heading-panel"
          aria-labelledby="evidence-heading"
          className={cn(cc.surface, "overflow-hidden")}
        >
          <div className={cn("flex items-start justify-between gap-3 border-b px-5 py-4", cc.divider)}>
            <div className="flex min-w-0 items-center gap-2">
              <Database className="h-4 w-4 shrink-0 text-[#4438E8]" aria-hidden="true" />
              <div className="min-w-0">
                <h3 id="evidence-heading" className="text-sm font-semibold text-[#17191F]">
                  Evidence &amp; data coverage
                </h3>
                <p className="mt-0.5 text-[11px] text-[#707582]">{context.summaryPreview}</p>
              </div>
            </div>
            <StateBadge state={evidencePanelAppState} label={evidencePanelLabel} />
          </div>

          <div className="space-y-4 px-5 py-4 text-xs">
            {/* Available data categories & per-source freshness */}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#707582]">
                Evidence categories examined
              </p>
              {visibleCategories.length > 0 ? (
                <>
                  <ul className="mt-2.5 divide-y divide-[#E7E9EF]">
                    {visibleCategories.map((cat) => (
                      <li key={cat.id} className="py-2.5 first:pt-0 last:pb-0">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium text-[#17191F]">{cat.name}</span>
                          <span
                            className={cn(
                              "inline-flex items-center gap-1.5 font-medium",
                              TONE_TEXT[cat.tone],
                            )}
                          >
                            <span
                              aria-hidden="true"
                              className={cn("h-1.5 w-1.5 rounded-full", TONE_DOT[cat.tone])}
                            />
                            {cat.statusLabel}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-[#707582] tabular-nums">
                          {cat.freshnessDetail}
                          {cat.coverageDetail ? ` · ${cat.coverageDetail}` : ""}
                        </p>
                        {cat.merchantNote && (
                          <p className="mt-1 text-[11px] leading-4 text-[#343844]">
                            {cat.merchantNote}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                  {hasCollapsibleEvidence && (
                    <button
                      type="button"
                      onClick={() => setShowAllEvidenceCategories((prev) => !prev)}
                      aria-expanded={showAllEvidenceCategories}
                      className={cn(
                        "mt-3 inline-flex items-center gap-1 rounded-md text-xs font-semibold text-[#4438E8] transition-colors hover:text-[#372CD1]",
                        cc.focus,
                      )}
                    >
                      <ChevronDown
                        className={cn(
                          "h-3.5 w-3.5 shrink-0 transition-transform duration-150 motion-reduce:transition-none",
                          showAllEvidenceCategories && "rotate-180",
                        )}
                        aria-hidden="true"
                      />
                      <span>
                        {showAllEvidenceCategories
                          ? "Show fewer sources"
                          : `Show all ${orderedCategories.length} sources (+${hiddenVerifiedCount} verified)`}
                      </span>
                    </button>
                  )}
                </>
              ) : (
                <p className="mt-2 text-[#707582]">
                  No verified store evidence sources are recorded for this briefing yet.
                </p>
              )}
            </div>

            {/* Limitations & Missing Evidence */}
            {context.merchantLimitations.length > 0 && (
              <div className={cn("border-t pt-3.5", cc.divider)}>
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#707582]">
                  Limitations and missing evidence
                </p>
                <ul className="mt-2 space-y-1.5 leading-5 text-[#343844]">
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

            {/* Expandable Preparation Scope & Technical References */}
            <div className={cn("border-t pt-3.5", cc.divider)}>
              <details className="group">
                <summary
                  className={cn(
                    "inline-flex cursor-pointer list-none items-center gap-1.5 rounded-md py-0.5 text-xs font-semibold text-[#4438E8] transition-colors hover:text-[#372CD1] [&::-webkit-details-marker]:hidden",
                    cc.focus,
                  )}
                >
                  <ChevronDown
                    className="h-3.5 w-3.5 shrink-0 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none"
                    aria-hidden="true"
                  />
                  How this briefing was prepared
                </summary>

                <div className="mt-3 space-y-3.5 text-xs">
                  <dl className="space-y-1.5 text-[#343844]">
                    <div className="flex flex-wrap justify-between gap-2">
                      <dt className="text-[#707582]">Reporting period</dt>
                      <dd className="font-medium text-[#17191F]">
                        {context.reportingPeriodLabel}
                      </dd>
                    </div>
                    {context.comparisonPeriodLabel && (
                      <div className="flex flex-wrap justify-between gap-2">
                        <dt className="text-[#707582]">Comparison period</dt>
                        <dd className="font-medium text-[#17191F]">
                          {context.comparisonPeriodLabel}
                        </dd>
                      </div>
                    )}
                    <div className="flex flex-wrap justify-between gap-2">
                      <dt className="text-[#707582]">Store timezone</dt>
                      <dd className="font-medium text-[#17191F]">{context.timezone}</dd>
                    </div>
                    {timestamp.exactTitle && (
                      <div className="flex flex-wrap justify-between gap-2">
                        <dt className="text-[#707582]">Briefing generated</dt>
                        <dd className="font-medium text-[#17191F] tabular-nums">
                          {timestamp.exactTitle.replace(/^Briefing generated\s+/i, "")}
                        </dd>
                      </div>
                    )}
                    {timestamp.previousLabel && (
                      <div className="flex flex-wrap justify-between gap-2">
                        <dt className="text-[#707582]">Previous briefing</dt>
                        <dd className="font-medium text-[#17191F] tabular-nums">
                          {timestamp.previousLabel}
                        </dd>
                      </div>
                    )}
                  </dl>

                  <p className="text-[11px] leading-5 text-[#707582]">
                    {context.unknownSemantics}
                  </p>

                  {context.technicalReferences.length > 0 && (
                    <details className="pt-1">
                      <summary
                        className={cn(
                          "cursor-pointer text-[11px] font-medium text-[#707582] hover:text-[#17191F]",
                          cc.focus,
                        )}
                      >
                        Technical references
                      </summary>
                      <dl className="mt-2 space-y-1 font-mono text-[11px] text-[#707582]">
                        {context.technicalReferences.map((ref) => (
                          <div key={ref.label} className="flex flex-wrap gap-x-2">
                            <dt className="text-[#343844]">{ref.label}:</dt>
                            <dd className="break-all">{ref.value}</dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                  )}
                </div>
              </details>
            </div>
          </div>
        </section>

        {/* E. Operational Data Health */}
        <section
          aria-labelledby="operational-data-health-heading"
          className={cn(cc.surface, "overflow-hidden")}
        >
          <div className={cn("flex items-start justify-between gap-3 border-b px-5 py-4", cc.divider)}>
            <div className="flex min-w-0 items-center gap-2">
              <PlugZap className="h-4 w-4 shrink-0 text-[#707582]" aria-hidden="true" />
              <div className="min-w-0">
                <h3
                  id="operational-data-health-heading"
                  className="text-sm font-semibold text-[#17191F]"
                >
                  Operational data health
                </h3>
                <p className="mt-0.5 text-[11px] text-[#707582]">
                  Synchronization and integration readiness
                </p>
              </div>
            </div>
            <StateBadge state={integrationAppState} label={integrationStatus.label} />
          </div>

          <div className="space-y-3 px-5 py-4 text-xs">
            <p className="leading-5 text-[#343844]">
              {data.integration?.status_explanation || integrationStatus.description}
            </p>

            {showWebhookNote && rawWebhookNote && (
              <p
                role={webhookNoteIsWarning ? "status" : undefined}
                className={
                  webhookNoteIsWarning
                    ? "rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2 text-xs leading-5 text-[#92400E]"
                    : "text-[11px] leading-5 text-[#707582]"
                }
              >
                {rawWebhookNote}
              </p>
            )}

            {data.business_state.stale && (
              <p
                role="status"
                className="rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2 text-xs leading-5 text-[#92400E]"
              >
                Stale snapshot. Historical evidence remains available; it is not current
                performance.
              </p>
            )}

            {data.integration?.authorization.verified && (
              <p className="inline-flex items-center gap-1.5 text-[11px] text-[#707582]">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#067647]" aria-hidden="true" />
                <span>Authorization verified by successful synchronization.</span>
              </p>
            )}

            {showIntegrationAction && (
              <div className={cn("border-t pt-3", cc.divider)}>
                <button
                  type="button"
                  onClick={() => openRoute("/dashboard/integrations")}
                  className={cn(
                    "inline-flex min-h-8 items-center gap-1.5 rounded-md text-xs font-semibold text-[#4438E8] transition-colors hover:text-[#372CD1]",
                    cc.focus,
                  )}
                >
                  <span>Review integration settings</span>
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            )}
          </div>
        </section>
      </aside>
    </section>
  );
}
