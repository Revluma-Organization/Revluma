import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import type { CommandCenterData, CommandCenterResponse } from "@/components/command-center/types";

const REFRESH_MS = 60_000;

/** One in-flight request per mounted consumer; obsolete store/session reads abort. */
export function useCommandCenter() {
  const organizationId = useAuthStore(state => state.user?.tenant_id || null);
  const [data, setData] = useState<CommandCenterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  const refetch = useCallback(async (background = false) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    if (background) setRefreshing(true); else setLoading(true);
    try {
      const result = await api.get<CommandCenterResponse>("/rev/command-center", { signal: controller.signal });
      if (controller.signal.aborted || !mountedRef.current) return;
      const next = result.data?.data;
      if (result.data?.success !== true || next?.contract_version !== "command-center-v1" ||
        typeof next.context?.organization_id !== "string" || !next.briefing ||
        !Array.isArray(next.metrics) || !Array.isArray(next.findings) || !Array.isArray(next.evidence?.resources)) {
        throw new Error("Invalid Command Center response");
      }
      setData(next);
      setError(false);
    } catch (reason) {
      if (!controller.signal.aborted && mountedRef.current) setError(true);
      if (reason instanceof Error && reason.name === "AbortError") return;
    } finally {
      if (!controller.signal.aborted && mountedRef.current) {
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
    void refetch();
    const timer = window.setInterval(() => void refetch(true), REFRESH_MS);
    const onFocus = () => void refetch(true);
    window.addEventListener("focus", onFocus);
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refetch, organizationId]);

  const scopedData = organizationId && data?.context.organization_id !== organizationId ? null : data;
  return { data: scopedData, loading, refreshing, error, refetch };
}
