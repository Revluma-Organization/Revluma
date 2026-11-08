import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import {
  type ActivityItem,
  ACTIVITY_SEVERITY_DOT,
  ACTIVITY_SEVERITY_LABEL,
  ACTIVITY_TYPE_LABEL,
  isValidOperationalActivity,
} from "@/lib/businessHealth";
import {
  COMMAND_CENTER_TIMEOUT_MS,
  classifyCommandCenterFailure,
  createTimedAbortController,
  type CommandCenterFailure,
} from "@/lib/commandCenterError";
import { Activity, CircleHelp, ExternalLink } from "lucide-react";

const PAGE_SIZE = 15;

// The backend `link` is a destination hint; only routes that actually exist in
// the app are rendered as active navigation (unavailable actions are not shown
// active).
const LINK_TARGET: Record<string, string> = {
  "/findings": "/dashboard/overview", // priority findings panel lives in the Command Center
  "/integrations": "/dashboard/integrations",
};

// Task 220 — closed, section-scoped phrases for the failure box. No backend
// text is interpolated; the kind comes from the shared classifier.
const KIND_PHRASE: Record<CommandCenterFailure["kind"], string> = {
  network: "A connection problem stopped the request. This is temporary in most cases.",
  timeout: "The request was cancelled after 30 seconds. Nothing is shown rather than an incomplete answer.",
  bad_request: "The server rejected the request.",
  unauthorized: "Sign in again to view this section.",
  forbidden: "Your role cannot view this section.",
  not_found: "This store has no operational history.",
  conflict: "Another operation is in progress. Try again in a moment.",
  rate_limited: "The server asked us to slow down. Retry shortly.",
  server_error: "A server error interrupted the request. This is temporary in most cases.",
  service_unavailable: "A supporting service is not answering right now.",
  invalid_contract: "The response did not match the expected contract, so nothing is displayed rather than a wrong answer.",
};

function relativeTime(isoValue: string): string {
  const t = new Date(isoValue).getTime();
  if (!Number.isFinite(t)) return "";
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(isoValue).toLocaleDateString();
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const navigate = useNavigate();
  const target = item.link ? LINK_TARGET[item.link] : undefined;
  const processingGap = new Date(item.received_at).getTime() - new Date(item.occurred_at).getTime();
  return (
    <div className="flex items-start gap-3 py-3">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${ACTIVITY_SEVERITY_DOT[item.severity] || "bg-[#9aa7b8]"}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-xs font-bold text-[#19243a] dark:text-[#f3f7ff]">{item.title}</span>
          <span className="rounded-md bg-[#eef4ff] px-1.5 py-0.5 text-[10px] font-semibold text-[#0868ed] dark:bg-[#12233b] dark:text-[#86b5ff]">
            {ACTIVITY_TYPE_LABEL[item.type] || item.type}
          </span>
          <span className="text-[10px] font-semibold text-[#8190a4] dark:text-[#8a97ab]">{ACTIVITY_SEVERITY_LABEL[item.severity] || item.severity}</span>
        </div>
        {item.detail && <p className="mt-0.5 truncate text-[11px] text-[#69758b] dark:text-[#a5b7d1]" title={item.detail}>{item.detail}</p>}
        <p className="mt-0.5 text-[10px] text-[#8995a7] dark:text-[#8a97ab]" title={new Date(item.occurred_at).toLocaleString()}>
          Occurred {relativeTime(item.occurred_at)}
          {processingGap > 5 * 60000 && (
            <span> · recorded {relativeTime(item.received_at)}</span>
          )}
        </p>
      </div>
      {target ? (
        <button
          type="button"
          onClick={() => navigate(target)}
          className="inline-flex min-h-9 shrink-0 items-center gap-1 text-[11px] font-bold text-[#0868ed] dark:text-[#86b5ff]"
        >
          View <ExternalLink className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

export default function OperationalActivityPanel({ storeId }: { storeId: string }) {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failure, setFailure] = useState<CommandCenterFailure | null>(null);
  const [windowDays, setWindowDays] = useState<number | null>(null);
  // Generation guard: a slow response for a previous store can never overwrite
  // a newer one. (Task 220: the AbortSignal is the first line of defense; this
  // guard remains as the second.)
  const genRef = useRef(0);
  // The in-flight request, so the effect cleanup can cancel it on unmount or
  // store change (matching BusinessHealthPanel). A stale store's response must
  // neither be fetched to completion nor land on the wrong store's UI.
  const activeRef = useRef<{ clear: () => void; controller: AbortController } | null>(null);

  const load = useCallback(async (reset: boolean, nextCursor?: string | null) => {
    if (!storeId) return;
    const gen = ++genRef.current;
    // Task 220 — hard timeout + cancellation for every page load.
    const { controller, clear, timedOut } = createTimedAbortController(COMMAND_CENTER_TIMEOUT_MS);
    activeRef.current = { clear, controller };
    if (reset) {
      setLoading(true); setFailure(null);
      setItems([]); setTotal(0); setCursor(null); setHasMore(false);
    } else {
      setLoadingMore(true);
    }
    try {
      const params: Record<string, unknown> = { limit: PAGE_SIZE };
      if (nextCursor) params.cursor = nextCursor;
      const res = await api.get<{ success?: boolean; data?: unknown }>(`/stores/${storeId}/business-activity`, params, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (gen !== genRef.current) return;
      // Fail-closed: only a response matching the closed contract is shown;
      // anything else is an honest "unavailable" state.
      // api.get resolves to ApiResponse<T> = { data: T, status, ok }; the
      // contract body is one level down.
      const body: unknown = (res as { data?: unknown } | null)?.data;
      const ok = body && typeof body === "object" && (body as { success?: boolean }).success === true;
      const d = ok ? (body as { data?: unknown }).data : null;
      if (isValidOperationalActivity(d)) {
        setItems(prev => (reset ? d.items : [...prev, ...d.items]));
        setTotal(d.total);
        setCursor(d.next_cursor);
        setHasMore(d.has_more);
        setWindowDays(d.window_days);
        setFailure(null);
      } else {
        setFailure({ kind: "invalid_contract", retryAfterSeconds: null, backendMessage: null });
      }
    } catch (reason) {
      if (controller.signal.aborted && !timedOut()) return; // superseded/unmount
      if (gen !== genRef.current) return;
      const classified = timedOut()
        ? { kind: "timeout" as const, retryAfterSeconds: null, backendMessage: null }
        : classifyCommandCenterFailure(reason);
      setFailure(classified);
    } finally {
      clear();
      if (gen === genRef.current && (!controller.signal.aborted || timedOut())) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [storeId]);

  useEffect(() => {
    void load(true);
    return () => {
      genRef.current += 1;
      // Cancel the in-flight request on unmount/store change (the AbortSignal
      // is the first line of defense; the generation guard above is second).
      activeRef.current?.clear();
      activeRef.current?.controller.abort();
      activeRef.current = null;
    };
  }, [load]);

  if (!storeId) return null;

  return (
    <section aria-label="Operational history" className="rounded-2xl border border-[#e7ebf2] bg-white p-4 shadow-[0_3px_18px_rgba(15,23,42,0.035)] dark:border-[#292929] dark:bg-[#111111] dark:shadow-none sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-extrabold">Operational history</h2>
            {windowDays && <span className="rounded-full bg-[#eef1f6] px-2 py-0.5 text-[10px] font-semibold text-[#5b6a80] dark:bg-[#1f1f1f] dark:text-[#a5b7d1]">last {windowDays} days</span>}
          </div>
          <p className="mt-1 text-xs text-[#8190a4] dark:text-[#a5b7d1]">Recorded events — findings, synchronization, integration and webhook changes · ordered by when they occurred</p>
        </div>
        {total > 0 && <span className="text-[11px] font-semibold text-[#8190a4] dark:text-[#8a97ab]">{total} recorded</span>}
      </div>

      {loading && (
        <div aria-label="Loading operational history" role="status" className="mt-4 space-y-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-[#f1f4f8] dark:bg-[#1b1b1b]" />)}</div>
      )}

      {!loading && failure && (
        <div className="mt-4 flex flex-col gap-3 rounded-xl border border-[#e7ebf2] bg-[#f8faff] p-4 text-xs text-[#5c6b81] dark:border-[#333] dark:bg-[#1b1b1b] dark:text-[#a5b7d1] sm:flex-row sm:items-center sm:justify-between" role="alert">
          <div className="flex min-w-0 items-start gap-2">
            <CircleHelp className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0">
              <p className="font-semibold">Operational history is unavailable right now. No events are shown rather than inferred.</p>
              <p className="mt-1 leading-5">{KIND_PHRASE[failure.kind]}</p>
            </div>
          </div>
          {/* Task 220 — resource-scoped retry: re-requests only this section. */}
          <button type="button" onClick={() => { void load(true); }} className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg border border-current px-3 font-semibold">Retry</button>
        </div>
      )}

      {!loading && !failure && items.length === 0 && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-dashed border-[#d7e2f0] bg-[#f8faff] p-5 text-xs text-[#69758b] dark:border-[#383838] dark:bg-[#1b1b1b] dark:text-[#a5b7d1]">
          <Activity className="h-4 w-4 shrink-0" /> No operational events recorded in the last {windowDays || 14} days. This means nothing happened, not that events are missing.
        </div>
      )}

      {!loading && !failure && items.length > 0 && (
        <>
          <div className="mt-2 divide-y divide-[#edf0f5] dark:divide-[#303030]">
            {items.map(item => <ActivityRow key={item.event_id} item={item} />)}
          </div>
          {hasMore && cursor && (
            <button
              type="button"
              onClick={() => { void load(false, cursor); }}
              disabled={loadingMore}
              className="mt-3 inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-[#bfd7ff] px-3 text-[11px] font-bold text-[#0868ed] transition hover:bg-[#eff6ff] disabled:opacity-50 dark:border-[#334455] dark:text-[#86b5ff] dark:hover:bg-[#242424]"
            >
              {loadingMore ? "Loading…" : `Load more (${Math.max(0, total - items.length)} remaining)`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
