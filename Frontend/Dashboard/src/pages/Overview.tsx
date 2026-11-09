import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useCommandCenter } from "@/hooks/useCommandCenter";
import { FAILURE_MESSAGES, RETRYABLE_KINDS } from "@/lib/commandCenterError";
import {
  CommandCenterHeader,
  EvidenceFreshness,
  HealthIndicators,
  OperationalActivity,
  OperationalBriefing,
  PriorityFindings,
} from "@/components/command-center/CommandCenterSections";
import { cc } from "@/components/command-center/tokens";
import { cn } from "@/lib/utils";

function BriefingFailureBanner({ failure, onRetry }: {
  failure: NonNullable<ReturnType<typeof useCommandCenter>["failure"]>;
  onRetry: () => void;
}) {
  const message = FAILURE_MESSAGES[failure.kind];
  const [retryWaiting, setRetryWaiting] = useState<number>(() =>
    failure.kind === "rate_limited" && failure.retryAfterSeconds != null ? failure.retryAfterSeconds : 0);

  useEffect(() => {
    if (failure.kind !== "rate_limited" || failure.retryAfterSeconds == null) { setRetryWaiting(0); return; }
    setRetryWaiting(failure.retryAfterSeconds);
    const tick = window.setInterval(() => setRetryWaiting(v => (v > 0 ? v - 1 : 0)), 1000);
    return () => window.clearInterval(tick);
  }, [failure]);

  const canRetry = RETRYABLE_KINDS.has(failure.kind) || failure.kind === "rate_limited";
  const retryEnabled = canRetry && (failure.kind !== "rate_limited" || retryWaiting === 0);

  return (
    <div role="alert" aria-label={message.title} className={cn(cc.surface, "flex flex-col gap-3 border-[#f0c7c2] bg-[#fff8f7] p-4 text-xs text-[#912018] sm:flex-row sm:items-center sm:justify-between")}>
      <div className="min-w-0">
        <p className="font-bold">{message.title}</p>
        <p className="mt-1 max-w-3xl leading-5">{message.body}</p>
        {failure.kind === "rate_limited" && retryWaiting > 0 && (
          <p className="mt-1 font-semibold" role="status">Retry available in {retryWaiting}s.</p>
        )}
        {failure.kind === "not_found" && (
          <p className="mt-1 font-semibold">Switch workspace in the top bar, or open Integrations to connect a store.</p>
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
  const { data, loading, refreshing, failure, lastSuccessfulAt, announcement, refetch } = useCommandCenter();
  const [searchParams] = useSearchParams();
  const selectedFinding = searchParams.get("finding");
  useEffect(() => {
    if (!selectedFinding || !data?.findings.some(finding => finding.id === selectedFinding)) return;
    document.getElementById("priority-finding")?.scrollIntoView({ block: "start" });
  }, [selectedFinding, data]);
  return <main className={cc.page}>
    <div aria-live="polite" className="sr-only">{announcement}</div>
    <CommandCenterHeader data={data} refreshing={refreshing} lastSuccessfulAt={lastSuccessfulAt} onRefresh={() => void refetch(true)} />
    {failure && data && <BriefingFailureBanner failure={failure} onRetry={() => void refetch(true)} />}
    {loading && !data ? <div aria-label="Loading operational briefing" role="status" className="space-y-6">
      <div className={cn(cc.surface, "h-56 animate-pulse bg-[#edf0f4] motion-reduce:animate-none")} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{Array.from({ length: 5 }, (_, index) => <div key={index} className={cn(cc.surface, "h-40 animate-pulse bg-[#f0f2f5] motion-reduce:animate-none")} />)}</div>
      <span className="sr-only">Loading the authoritative business snapshot and integration evidence. No values are shown until evidence arrives.</span>
    </div> : data ? <>
      <OperationalBriefing data={data} />
      <PriorityFindings data={data} />
      <HealthIndicators data={data} />
      <div className="grid min-w-0 items-start gap-6 xl:grid-cols-2"><OperationalActivity data={data} /><EvidenceFreshness data={data} /></div>
    </> : failure ? <BriefingFailureBanner failure={failure} onRetry={() => void refetch(false)} /> : !loading ? <section className={cn(cc.surface, "p-6")}><h2 className={cc.sectionTitle}>No operational briefing is available</h2><p className={cn("mt-2", cc.metadata)}>No business information is asserted. Connect or synchronize an authorized store before relying on this workspace.</p></section> : null}
  </main>;
}
