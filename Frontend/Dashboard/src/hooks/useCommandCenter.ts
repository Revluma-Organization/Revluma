import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import type { CommandCenterData, CommandCenterResponse } from "@/components/command-center/types";
import {
  COMMAND_CENTER_TIMEOUT_MS,
  classifyCommandCenterFailure,
  createTimedAbortController,
  type CommandCenterFailure,
} from "@/lib/commandCenterError";

const REFRESH_MS = 60_000;

export interface CommandCenterState {
  data: CommandCenterData | null;
  loading: boolean;
  refreshing: boolean;
  /** Classified failure of the briefing request; null when healthy. */
  failure: CommandCenterFailure | null;
  /** The `retrieved_at` of the last successful snapshot, for stale display. */
  lastSuccessfulAt: string | null;
  /** Polite live-region text for background refresh outcomes (announced once each). */
  announcement: string | null;
  refetch: (background?: boolean) => Promise<void>;
}

/** One in-flight request per mounted consumer; obsolete store/session reads abort. */
export function useCommandCenter(): CommandCenterState {
  const organizationId = useAuthStore(state => state.user?.tenant_id || null);
  const [data, setData] = useState<CommandCenterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failure, setFailure] = useState<CommandCenterFailure | null>(null);
  const [lastSuccessfulAt, setLastSuccessfulAt] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const abortRef = useRef<{ controller: AbortController; clear: () => void } | null>(null);
  const mountedRef = useRef(true);

  const refetch = useCallback(async (background = false) => {
    abortRef.current?.clear();
    abortRef.current?.controller.abort();
    const { controller, clear, timedOut } = createTimedAbortController(COMMAND_CENTER_TIMEOUT_MS);
    abortRef.current = { controller, clear };
    if (background) { setRefreshing(true); } else { setLoading(true); setFailure(null); }
    try {
      const result = await api.get<CommandCenterResponse>("/rev/command-center", { signal: controller.signal });
      if (controller.signal.aborted || !mountedRef.current) return;
      const next = result.data?.data;
      if (result.data?.success !== true || next?.contract_version !== "command-center-v1" ||
        typeof next.context?.organization_id !== "string" || !next.briefing ||
        !Array.isArray(next.metrics) || !Array.isArray(next.findings) || !Array.isArray(next.evidence?.resources)) {
        setFailure({ kind: "invalid_contract", retryAfterSeconds: null, backendMessage: null });
        if (background) setAnnouncement("The refresh failed: the server response was not usable. The last successful briefing is still shown.");
        return;
      }
      setData(next);
      setFailure(null);
      setLastSuccessfulAt(next.retrieved_at ?? null);
      if (background) {
        const when = next.retrieved_at ? new Date(next.retrieved_at).toLocaleTimeString() : "";
        setAnnouncement(when ? `Briefing refreshed at ${when}.` : "Briefing refreshed.");
      }
    } catch (reason) {
      if (controller.signal.aborted) {
        if (timedOut() && mountedRef.current) {
          // We aborted it ourselves for being too slow: that is a timeout, not a success.
          setFailure({ kind: "timeout", retryAfterSeconds: null, backendMessage: null });
          if (background) setAnnouncement("The refresh timed out. The last successful briefing is still shown.");
        }
        return; // Plain abort (superseded/unmount): ignore.
      }
      if (!mountedRef.current) return;
      const classified = classifyCommandCenterFailure(reason);
      setFailure(classified);
      if (background) {
        setAnnouncement("The refresh failed. Showing the last successful briefing instead of new data.");
      }
    } finally {
      clear();
      // A timeout abort ends this request's lifecycle too (the timer was this
      // request's own); only superseded/unmount aborts are ignored.
      if (mountedRef.current && (timedOut() || !controller.signal.aborted)) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    // Clear the previous merchant immediately on workspace change; an old
    // tenant's snapshot can never remain visible under a new store context.
    setData(null);
    setFailure(null);
    setAnnouncement(null);
    setLastSuccessfulAt(null);
    setLoading(true);
    void refetch();
    const timer = window.setInterval(() => void refetch(true), REFRESH_MS);
    const onFocus = () => void refetch(true);
    window.addEventListener("focus", onFocus);
    return () => {
      mountedRef.current = false;
      abortRef.current?.clear();
      abortRef.current?.controller?.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
    // lastSuccessfulAt intentionally not a dependency: workspace identity is
    // the only input that should restart the lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refetch, organizationId]);

  const scopedData = organizationId && data?.context.organization_id !== organizationId ? null : data;
  return { data: scopedData, loading, refreshing, failure, lastSuccessfulAt, announcement, refetch };
}
