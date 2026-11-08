import { useEffect, useRef, useState } from "react";
import { useCommandCenter } from "@/hooks/useCommandCenter";
import {
  BusinessOverview,
  CommandCenterHeader,
  EvidenceFreshness,
  OperationalActivity,
  OperationalBriefing,
  PriorityFindings,
} from "@/components/command-center/CommandCenterSections";
import BusinessHealthPanel from "@/components/dashboard/BusinessHealthPanel";
import OperationalActivityPanel from "@/components/dashboard/OperationalActivityPanel";
import { FAILURE_MESSAGES, RETRYABLE_KINDS } from "@/lib/commandCenterError";

/**
 * Task 220 — classified failure banner. The failure kind (from the closed
 * classifier) decides the merchant-facing text and whether a retry is offered:
 * transient kinds get a retry; 404 gets workspace guidance; 429 gets a real
 * countdown from the backend's Retry-After; session loss gets sign-in copy.
 */
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
    <div role="alert" aria-label={message.title} className="flex flex-col gap-3 rounded-xl border border-[#fecaca] bg-[#fff7f7] p-4 text-xs text-[#991b1b] dark:border-[#7f1d1d] dark:bg-[#241414] dark:text-[#fecaca] sm:flex-row sm:items-center sm:justify-between">
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
          className="min-h-10 shrink-0 rounded-lg border border-current px-3 font-semibold disabled:cursor-not-allowed disabled:opacity-50"
        >
          {retryEnabled ? "Try again" : "Waiting…"}
        </button>
      )}
    </div>
  );
}

export default function Overview() {
  const { data, loading, refreshing, failure, lastSuccessfulAt, announcement, refetch } = useCommandCenter();
  // Task 218 — store-scoped business health indicators and operational
  // history. The store context is the Command Center's primary store (the
  // same store the briefing is bound to), so both sections and the briefing
  // always describe one store. With no store context these sections render
  // nothing rather than fabricating a subject.
  const store = data?.context.store ?? null;
  const showInitialSkeleton = loading && !data;
  return (
    <main className="mx-auto w-full min-w-0 max-w-[1440px] space-y-5 overflow-x-clip pb-10 text-[#101828] dark:text-[#e7eefc]">
      {/* Task 220 — background refresh outcomes are announced once, politely. */}
      <div aria-live="polite" className="sr-only">{announcement}</div>
      <CommandCenterHeader data={data} refreshing={refreshing} lastSuccessfulAt={lastSuccessfulAt} onRefresh={() => void refetch(true)} />
      {failure && data && <BriefingFailureBanner failure={failure} onRetry={() => void refetch(true)} />}
      {showInitialSkeleton ? (
        <div aria-label="Loading operational briefing" role="status" className="space-y-5">
          <div className="h-64 animate-pulse motion-reduce:animate-none rounded-xl border border-[#e2e8f0] bg-[#f1f5f9] dark:border-[#2c2c2c] dark:bg-[#191919]" />
          <div className="h-40 animate-pulse motion-reduce:animate-none rounded-xl border border-[#e2e8f0] bg-[#f8fafc] dark:border-[#2c2c2c] dark:bg-[#151515]" />
          <span className="sr-only">Loading the authoritative business snapshot and integration evidence.</span>
        </div>
      ) : data ? (
        <>
          <OperationalBriefing data={data} />
          <BusinessOverview data={data} />
          {store && <BusinessHealthPanel storeId={store.id} storeDomain={store.name} canInvestigate={data.integration?.overall_status === "connected"} />}
          <PriorityFindings data={data} />
          <div className="grid min-w-0 gap-5 xl:grid-cols-2"><OperationalActivity data={data} /><EvidenceFreshness data={data} /></div>
          {store && <OperationalActivityPanel storeId={store.id} />}
        </>
      ) : failure ? (
        <BriefingFailureBanner failure={failure} onRetry={() => void refetch(false)} />
      ) : !loading ? (
        <section className="rounded-xl border border-[#e2e8f0] bg-white p-6 dark:border-[#2c2c2c] dark:bg-[#111111]">
          <h2 className="text-sm font-bold">No operational briefing is available</h2>
          <p className="mt-2 text-xs text-[#64748b]">No business information is asserted.</p>
        </section>
      ) : null}
    </main>
  );
}
