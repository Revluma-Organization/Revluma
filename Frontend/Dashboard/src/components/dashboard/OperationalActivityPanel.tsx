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
import { Activity, CircleHelp, ExternalLink } from "lucide-react";

const PAGE_SIZE = 15;

// The backend `link` is a destination hint; only routes that actually exist in
// the app are rendered as active navigation (unavailable actions are not shown
// active).
const LINK_TARGET: Record<string, string> = {
  "/findings": "/dashboard/overview", // priority findings panel lives in the Command Center
  "/integrations": "/dashboard/integrations",
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
        {item.detail && <p className="mt-0.5 truncate text-[11px] text-[#69758b] dark:text-[#a5b7d1]">{item.detail}</p>}
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
          className="inline-flex shrink-0 items-center gap-1 text-[11px] font-bold text-[#0868ed] dark:text-[#86b5ff]"
        >
          View <ExternalLink className="h-3 w-3" />
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
  const [failed, setFailed] = useState(false);
  const [windowDays, setWindowDays] = useState<number | null>(null);
  // Generation guard: a slow response for a previous store can never overwrite
  // a newer one.
  const genRef = useRef(0);

  const load = useCallback(async (reset: boolean, nextCursor?: string | null) => {
    if (!storeId) return;
    const gen = ++genRef.current;
    if (reset) {
      setLoading(true); setFailed(false);
      setItems([]); setTotal(0); setCursor(null); setHasMore(false);
    } else {
      setLoadingMore(true);
    }
    try {
      const params: Record<string, unknown> = { limit: PAGE_SIZE };
      if (nextCursor) params.cursor = nextCursor;
      const res = await api.get<{ success?: boolean; data?: unknown }>(`/stores/${storeId}/business-activity`, params);
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
      } else {
        setFailed(true);
      }
    } catch {
      if (gen === genRef.current) setFailed(true);
    } finally {
      if (gen === genRef.current) { setLoading(false); setLoadingMore(false); }
    }
  }, [storeId]);

  useEffect(() => {
    void load(true);
    return () => { genRef.current += 1; };
  }, [load]);

  if (!storeId) return null;

  return (
    <section aria-label="Operational history" className="rounded-2xl border border-[#e7ebf2] bg-white p-4 shadow-[0_3px_18px_rgba(15,23,42,0.035)] dark:border-[#292929] dark:bg-[#111111] dark:shadow-none sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-extrabold">Operational history</h2>
            {windowDays && <span className="rounded-full bg-[#eef1f6] px-2 py-0.5 text-[10px] font-semibold text-[#5b6a80] dark:bg-[#1f1f1f] dark:text-[#a5b7d1]">last {windowDays} days</span>}
          </div>
          <p className="mt-1 text-xs text-[#8190a4] dark:text-[#a5b7d1]">Recorded events — findings, synchronization, integration and webhook changes · ordered by when they occurred</p>
        </div>
        {total > 0 && <span className="text-[11px] font-semibold text-[#8190a4] dark:text-[#a5b7d1]">{total} recorded</span>}
      </div>

      {loading && (
        <div className="mt-4 space-y-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-[#f1f4f8] dark:bg-[#1b1b1b]" />)}</div>
      )}

      {!loading && failed && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-[#e7ebf2] bg-[#f8faff] p-4 text-xs text-[#5c6b81] dark:border-[#333] dark:bg-[#1b1b1b] dark:text-[#a5b7d1]">
          <CircleHelp className="h-4 w-4 shrink-0" /> Operational history is unavailable right now. No events are shown rather than inferred.
        </div>
      )}

      {!loading && !failed && items.length === 0 && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-dashed border-[#d7e2f0] bg-[#f8faff] p-5 text-xs text-[#69758b] dark:border-[#383838] dark:bg-[#1b1b1b] dark:text-[#a5b7d1]">
          <Activity className="h-4 w-4 shrink-0" /> No operational events recorded in the last {windowDays || 14} days. This means nothing happened, not that events are missing.
        </div>
      )}

      {!loading && !failed && items.length > 0 && (
        <>
          <div className="mt-2 divide-y divide-[#edf0f5] dark:divide-[#303030]">
            {items.map(item => <ActivityRow key={item.event_id} item={item} />)}
          </div>
          {hasMore && cursor && (
            <button
              type="button"
              onClick={() => { void load(false, cursor); }}
              disabled={loadingMore}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-[#bfd7ff] px-3 py-2 text-[11px] font-bold text-[#0868ed] transition hover:bg-[#eff6ff] disabled:opacity-50 dark:border-[#334455] dark:text-[#86b5ff] dark:hover:bg-[#242424]"
            >
              {loadingMore ? "Loading…" : `Load more (${Math.max(0, total - items.length)} remaining)`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
