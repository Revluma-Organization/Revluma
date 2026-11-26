import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useCommandCenter } from "@/hooks/useCommandCenter";
import { FAILURE_MESSAGES, RETRYABLE_KINDS } from "@/lib/commandCenterError";
import {
  CommandCenterHeader,
  EvidenceFreshness,
  HealthIndicators,
  OperationalBriefing,
  PriorityFindings,
} from "@/components/command-center/CommandCenterSections";
import { KpiStrip } from "@/components/command-center/KpiStrip";
import { RecentSignalsPanel } from "@/components/command-center/RecentSignalsPanel";
import { SignalsActivitySection } from "@/components/command-center/SignalsActivitySection";
import { cc } from "@/components/command-center/tokens";
import { cn } from "@/lib/utils";

function BriefingFailureBanner({
  failure,
  onRetry,
}: {
  failure: NonNullable<ReturnType<typeof useCommandCenter>["failure"]>;
  onRetry: () => void;
}) {
  const message = FAILURE_MESSAGES[failure.kind];
  const [retryWaiting, setRetryWaiting] = useState<number>(() =>
    failure.kind === "rate_limited" && failure.retryAfterSeconds != null
      ? failure.retryAfterSeconds
      : 0,
  );

  useEffect(() => {
    if (failure.kind !== "rate_limited" || failure.retryAfterSeconds == null) {
      setRetryWaiting(0);
      return;
    }
    setRetryWaiting(failure.retryAfterSeconds);
    const tick = window.setInterval(() => setRetryWaiting((v) => (v > 0 ? v - 1 : 0)), 1000);
    return () => window.clearInterval(tick);
  }, [failure]);

  const canRetry = RETRYABLE_KINDS.has(failure.kind) || failure.kind === "rate_limited";
  const retryEnabled = canRetry && (failure.kind !== "rate_limited" || retryWaiting === 0);

  return (
    <div
      role="alert"
      aria-label={message.title}
      className={cn(
        cc.surface,
        "flex flex-col gap-3 border-[#FECACA] bg-[#FEF2F2] p-4 text-xs text-[#991B1B] sm:flex-row sm:items-center sm:justify-between sm:px-5",
      )}
    >
      <div className="min-w-0">
        <p className="font-semibold text-[#B42318]">{message.title}</p>
        <p className="mt-1 max-w-3xl leading-5 text-[#7F1D1D]">{message.body}</p>
        {failure.kind === "rate_limited" && retryWaiting > 0 && (
          <p className="mt-1 font-semibold tabular-nums" role="status">
            Retry available in {retryWaiting}s.
          </p>
        )}
        {failure.kind === "not_found" && (
          <p className="mt-1 font-semibold">
            Switch workspace in the top bar, or open Integrations to connect a store.
          </p>
        )}
      </div>
      {canRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={!retryEnabled}
          className={cc.secondary}
        >
          {retryEnabled ? "Try again" : "Waiting…"}
        </button>
      )}
    </div>
  );
}

export default function Overview() {
  const {
    data,
    loading,
    refreshing,
    failure,
    lastSuccessfulAt,
    announcement,
    selectStore,
    refetch,
  } = useCommandCenter();
  const [searchParams] = useSearchParams();
  const selectedFinding = searchParams.get("finding");
  const selectedSection = searchParams.get("section");

  useEffect(() => {
    if (!data) return;
    if (selectedFinding && data.findings.some((finding) => finding.id === selectedFinding)) {
      document.getElementById("priority-finding")?.scrollIntoView({ block: "start" });
      return;
    }
    const sections: Record<string, string> = {
      priority: "priority-finding",
      signals: "signals-activity",
      briefing: "operational-briefing-heading",
      activity: "operational-activity-heading",
      evidence: "evidence-heading",
      health: "business-health-heading",
    };
    const target = selectedSection && sections[selectedSection];
    if (target) {
      // The Signals & Activity section renders whenever data exists, so the
      // signals deep link never dead-ends (no evaluated-signals fallback).
      document.getElementById(target)?.scrollIntoView({ block: "start" });
    }
  }, [selectedFinding, selectedSection, data]);

  return (
    <div data-command-center className={cc.page}>
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>

      {/* SECTION ONE: WELCOME EXPERIENCE */}
      <CommandCenterHeader
        data={data}
        loading={loading}
        refreshing={refreshing}
        failure={failure}
        lastSuccessfulAt={lastSuccessfulAt}
        onRefresh={() => void refetch(true)}
        onSelectStore={selectStore}
      />

      {failure && data && (
        <BriefingFailureBanner failure={failure} onRetry={() => void refetch(true)} />
      )}

      {loading && !data ? (
        <div
          aria-label="Loading operational briefing"
          role="status"
          className="space-y-6"
        >
          <div
            className={cn(
              cc.surface,
              "h-32 animate-pulse bg-[#EAECEF] motion-reduce:animate-none",
            )}
          />
          <div className="grid gap-4 sm:grid-cols-3">
            {Array.from({ length: 3 }, (_, index) => (
              <div
                key={index}
                className={cn(
                  cc.surface,
                  "h-28 animate-pulse bg-[#EEF0F4] motion-reduce:animate-none",
                )}
              />
            ))}
          </div>
          <div className="grid gap-6 lg:grid-cols-12">
            <div
              className={cn(
                cc.surface,
                "h-64 animate-pulse bg-[#EAECEF] motion-reduce:animate-none lg:col-span-8",
              )}
            />
            <div className="space-y-6 lg:col-span-4">
              <div
                className={cn(
                  cc.surface,
                  "h-48 animate-pulse bg-[#EEF0F4] motion-reduce:animate-none",
                )}
              />
              <div
                className={cn(
                  cc.surface,
                  "h-36 animate-pulse bg-[#EEF0F4] motion-reduce:animate-none",
                )}
              />
            </div>
          </div>
          <span className="sr-only">
            Loading the authoritative business snapshot and integration evidence. No values are
            shown until evidence arrives.
          </span>
        </div>
      ) : data ? (
        <>
          {/* KPI STRIP: verified counts only — no trends, sparklines, or invented scores */}
          <KpiStrip data={data} />

          {/* WORKSPACE GRID: 8-col priorities + 4-col rail, stacked below lg */}
          <div className="grid gap-6 lg:grid-cols-12">
            <div className="min-w-0 lg:col-span-8">
              <PriorityFindings data={data} refreshing={refreshing} hideSignalsPanel />
            </div>
            <aside aria-label="Secondary intelligence" className="min-w-0 lg:col-span-4">
              {/* Sticky on desktop only; no overflow/max-height, so no nested scroll traps. */}
              <div className="space-y-6 lg:sticky lg:top-[calc(var(--topbar-h)+20px)]">
                <HealthIndicators data={data} layout="stacked" />
                {data.signal_evaluation && data.signal_evaluation.signals.length > 0 && (
                  <RecentSignalsPanel evaluation={data.signal_evaluation} layout="list" />
                )}
                <EvidenceFreshness data={data} />
              </div>
            </aside>
          </div>

          {/* OPERATIONAL BRIEFING (HYBRID LAYOUT) */}
          <OperationalBriefing
            data={data}
            refreshing={refreshing}
            failure={failure}
            onRefresh={() => void refetch(true)}
          />

          {/* SIGNALS & ACTIVITY (STAGE 4) */}
          <SignalsActivitySection data={data} />
        </>
      ) : failure ? (
        <BriefingFailureBanner failure={failure} onRetry={() => void refetch(false)} />
      ) : !loading ? (
        <section className={cn(cc.surface, "p-6")}>
          <h2 className={cc.sectionTitle}>No operational briefing is available</h2>
          <p className={cn("mt-2", cc.metadata)}>
            No business information is asserted. Connect or synchronize an authorized store
            before relying on this workspace.
          </p>
        </section>
      ) : null}
    </div>
  );
}
