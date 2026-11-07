// src/components/SyncProgress.tsx
// Task 215 — mobile-first sync-progress + retry card.
//
// Truthfulness: a numeric percentage renders ONLY when the backend reports a
// stable, same-unit denominator (measurable). Otherwise an honest indeterminate
// bar + the real stage label is shown — never a fabricated percentage or a
// premature 100%. Stalled/failed/queued states are distinct and labelled from
// the authoritative contract. The card is a pure consumer: it polls the
// backend and renders only what it returns.
//
// Mobile: no horizontal overflow (w-full + min-w-0 + break-words), stacked
// metadata, touch targets >= 44px, visible focus rings, aria labels, and a
// skeleton (never a blank page) while the first response is in flight.

import { useState } from "react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useSyncProgress } from "@/hooks/useSyncProgress";
import {
  progressLine,
  SYNC_JOB_STATUS_LABELS,
  TERMINAL_JOB_STATUSES,
  type SyncProgress as SyncProgressModel,
} from "@/lib/integrationProgress";

interface SyncProgressCardProps {
  storeId: string;
  enabled?: boolean;
  /** Provided when a permanent failure requires the existing reconnect flow. */
  onReconnect?: () => void;
  className?: string;
}

const DOMAIN_LABELS: Record<string, string> = {
  products: "Products",
  orders: "Orders",
  abandoned_checkouts: "Abandoned checkouts",
  customers: "Customers",
  variants: "Variants",
  inventory: "Inventory",
  locations: "Locations",
  fulfillments: "Fulfillments",
  refunds: "Refunds",
};

function domainLabel(domain: string): string {
  return DOMAIN_LABELS[domain] || domain.replace(/_/g, " ");
}

function statusTone(status: string): { dot: string; text: string } {
  switch (status) {
    case "ok": return { dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-400" };
    case "running": return { dot: "bg-sky-500 animate-pulse", text: "text-sky-700 dark:text-sky-400" };
    case "failed": return { dot: "bg-red-500", text: "text-red-700 dark:text-red-400" };
    case "degraded": return { dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-400" };
    default: return { dot: "bg-slate-400", text: "text-slate-500 dark:text-slate-400" };
  }
}

function jobTone(status: SyncProgressModel["job"]["status"]): string {
  switch (status) {
    case "completed": return "text-emerald-700 dark:text-emerald-400";
    case "running": return "text-sky-700 dark:text-sky-400";
    case "stalled": return "text-amber-700 dark:text-amber-400";
    case "failed": return "text-red-700 dark:text-red-400";
    case "partial": return "text-amber-700 dark:text-amber-400";
    default: return "text-slate-600 dark:text-slate-300";
  }
}

function Skeleton() {
  return (
    <div className="w-full space-y-3" role="status" aria-label="Loading synchronization progress">
      <div className="h-3 w-24 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
      <div className="h-2 w-full animate-pulse rounded-full bg-slate-200 dark:bg-slate-800" />
      <div className="space-y-2">
        <div className="h-3 w-3/4 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
      </div>
      <span className="sr-only">Loading synchronization progress</span>
    </div>
  );
}

function Unavailable({ message }: { message: string }) {
  return (
    <div className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300">
      {message}
    </div>
  );
}

export function SyncProgressCard({
  storeId,
  enabled = true,
  onReconnect,
  className,
}: SyncProgressCardProps) {
  const { progress, loading, error, refetch } = useSyncProgress(storeId, { enabled });
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const handleRetry = async () => {
    setSubmitting(true);
    setNotice(null);
    try {
      const res = await api.post<{ success: boolean; error?: string; data?: { status?: string } }>(
        `/stores/${storeId}/sync-retry`,
        { scope: "all", request_key: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `retry-${Date.now()}` },
      );
      if (res.data?.success) {
        // The backend is authoritative: immediately override any stale view.
        await refetch();
      } else {
        setNotice(res.data?.error || "The retry was not accepted. Check the details below.");
      }
    } catch {
      setNotice("Could not start the retry. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && !progress) return <div className={cn("w-full", className)}><Skeleton /></div>;
  if (!progress) {
    return (
      <div className={cn("w-full", className)}>
        <Unavailable message={error ? "Progress is temporarily unavailable. The connection state above is still authoritative." : "No synchronization progress is available for this store yet."} />
      </div>
    );
  }

  const { job, overall, retry, domains } = progress;
  const jobStatus = job.status;
  const isTerminal = TERMINAL_JOB_STATUSES.has(jobStatus);
  const inFlight = jobStatus === "running" || jobStatus === "queued";
  const line = progressLine(overall, jobStatus);
  const showPercent = overall.percent !== null && overall.measurable;

  const showRetry =
    (jobStatus === "stalled" || jobStatus === "failed" || jobStatus === "partial") &&
    Boolean(retry.manual_retry_eligible);
  const showReconnect = Boolean(retry.merchant_action_required) && !retry.manual_retry_eligible && !inFlight;

  const requiredDomains = domains.filter((d) => d.required);
  const optionalDomains = domains.filter((d) => !d.required && d.status !== "never_run");

  const retryLabel = submitting
    ? "Requesting retry…"
    : inFlight
      ? "Synchronizing…"
      : jobStatus === "stalled"
        ? "Retry (worker stalled)"
        : "Retry sync";

  return (
    <div className={cn("w-full min-w-0", className)}>
      {/* Status line + honest progress bar */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className={cn("text-sm font-semibold", jobTone(jobStatus))}>
            {SYNC_JOB_STATUS_LABELS[jobStatus]}
          </span>
          <span className="truncate text-xs text-slate-500 dark:text-slate-400" title={line}>
            {line}
          </span>
        </div>
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={showPercent ? overall.percent : undefined}
          aria-label={`Synchronization progress: ${line}`}
          aria-busy={inFlight || undefined}
        >
          {showPercent ? (
            <div className="h-full rounded-full bg-emerald-500 transition-[width] duration-500" style={{ width: `${overall.percent}%` }} />
          ) : (
            // Honest indeterminate: no fabricated fill, just a real "in progress" cue.
            <div className={cn("h-full w-full rounded-full bg-slate-300 dark:bg-slate-700", (inFlight || jobStatus === "stalled") && "animate-pulse")} />
          )}
        </div>
      </div>

      {/* Per-domain list (stacked, no overflow) */}
      <ul className="mt-3 space-y-1.5" aria-label="Synchronization by resource">
        {[...requiredDomains, ...optionalDomains].map((d) => {
          const tone = statusTone(d.status);
          const failed = d.failure;
          return (
            <li key={d.domain} className="min-w-0">
              <div className="flex items-center gap-2">
                <span aria-hidden="true" className={cn("h-2 w-2 shrink-0 rounded-full", tone.dot)} />
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-700 dark:text-slate-200">
                  {domainLabel(d.domain)}
                  {d.required && <span className="ml-1 text-[0.6rem] uppercase tracking-wide text-slate-400">required</span>}
                </span>
                <span className={cn("shrink-0 text-[0.7rem] font-semibold", tone.text)}>
                  {d.percent !== null ? `${d.percent}%` : d.status === "running" ? "…" : d.status.replace("_", " ")}
                </span>
              </div>
              {failed && (
                <p className="mt-0.5 pl-4 text-[0.7rem] break-words text-red-600 dark:text-red-400">
                  {failed.merchant_action_required
                    ? "Action needed: reconnect to continue."
                    : failed.category === "transient_throttle"
                      ? "Shopify is rate-limiting; we will retry automatically."
                      : failed.category === "unsupported"
                        ? "Not supported for this store."
                        : "A temporary problem occurred; you can retry."}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      {/* Retry / reconnect action (touch target >= 44px) */}
      {(showRetry || showReconnect) && (
        <div className="mt-3">
          {notice && (
            <p role="alert" className="mb-2 text-[0.7rem] break-words text-red-600 dark:text-red-400">{notice}</p>
          )}
          {showRetry && (
            <button
              type="button"
              onClick={handleRetry}
              disabled={submitting || inFlight}
              className={cn(
                "min-h-[44px] w-full rounded-xl px-4 text-sm font-semibold transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950",
                submitting || inFlight
                  ? "cursor-not-allowed bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                  : "bg-sky-600 text-white hover:bg-sky-700 active:bg-sky-800",
              )}
              aria-busy={submitting || undefined}
            >
              {retryLabel}
            </button>
          )}
          {showReconnect && (
            <button
              type="button"
              onClick={onReconnect}
              className={cn(
                "min-h-[44px] w-full rounded-xl bg-amber-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-amber-700",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950",
              )}
            >
              Reconnect required
            </button>
          )}
        </div>
      )}

      {/* Expandable diagnostics (accessible disclosure, no overflow) */}
      <details className="group mt-3 w-full">
        <summary className="flex min-h-[40px] cursor-pointer list-none items-center gap-1.5 rounded-lg px-1 text-xs font-semibold text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:text-slate-300 [&::-webkit-details-marker]:hidden">
          <span aria-hidden="true" className="transition-transform group-open:rotate-90">›</span>
          Diagnostics
        </summary>
        <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-[0.7rem] text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300 sm:grid-cols-2">
          <div className="flex justify-between gap-2"><dt className="text-slate-400">Stage</dt><dd className="truncate font-medium">{overall.stage || "—"}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-slate-400">Attempt</dt><dd className="font-medium">{retry.attempt ?? job.id ? `#${retry.attempt ?? "?"}` : "—"}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-slate-400">Records retrieved</dt><dd className="font-medium">{overall.records.retrieved}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-slate-400">Records persisted</dt><dd className="font-medium">{overall.records.persisted}</dd></div>
          <div className="flex justify-between gap-2 sm:col-span-2"><dt className="text-slate-400">Last worker heartbeat</dt><dd className="break-words font-medium">{job.heartbeat_at ? new Date(job.heartbeat_at).toLocaleString() : "none recorded"}</dd></div>
          {job.stalled && (
            <div className="flex justify-between gap-2 sm:col-span-2"><dt className="text-amber-600 dark:text-amber-400">State</dt><dd className="font-medium">Stalled — no progress for over {Math.round(job.stall_threshold_seconds / 60)} minutes</dd></div>
          )}
        </dl>
      </details>
    </div>
  );
}

export default SyncProgressCard;
