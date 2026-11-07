// src/hooks/useIntegrationStates.ts
// Task 213 — live canonical integration states for the UI.
//
// Polls the product API (GET /stores/integration-states) with an adaptive
// cadence: every 15s while any store is actively moving (synchronizing or
// needs_attention), otherwise every 60s. Refetches on window focus and via
// the returned `refetch` (used after the OAuth callback). The store list is
// the source of truth — there is deliberately NO sessionStorage cache: a
// cached status can lie about a store that just synced, failed, or was
// revoked.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import {
  normalizeIntegrationState,
  type IntegrationState,
} from "@/lib/integrationState";

const IDLE_INTERVAL_MS = 60_000;
const ACTIVE_INTERVAL_MS = 15_000;

// States that change without user interaction are worth polling faster.
const ACTIVE_STATES = new Set(["synchronizing", "needs_attention"]);

export interface UseIntegrationStates {
  states: IntegrationState[];
  byStoreId: Map<string, IntegrationState>;
  loading: boolean;
  error: boolean;
  lastFetchedAt: Date | null;
  refetch: () => Promise<IntegrationState[]>;
}

export function useIntegrationStates(): UseIntegrationStates {
  const [states, setStates] = useState<IntegrationState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);
  const activeRef = useRef(false);

  const refetch = useCallback(async (): Promise<IntegrationState[]> => {
    try {
      const res = await api.get<{
        success: boolean;
        data: { contract_version: string; states: unknown[] };
      }>("/stores/integration-states");
      if (res.data?.success !== true || !Array.isArray(res.data.data?.states)) {
        throw new Error("Integration states response was invalid.");
      }
      // Fail-closed: invalid blocks are dropped (the store renders unknown),
      // never rendered as connected.
      const normalized = res.data.data.states
        .map(normalizeIntegrationState)
        .filter((s): s is IntegrationState => s !== null);
      activeRef.current = normalized.some((s) => ACTIVE_STATES.has(s.overall_status));
      setStates(normalized);
      setError(false);
      setLastFetchedAt(new Date());
      return normalized;
    } catch (e) {
      console.error("Failed to fetch integration states", e);
      setError(true);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch + adaptive polling + refetch on focus. The first tick is
  // scheduled only AFTER the initial fetch resolves, so it already reflects
  // whether any store is actively moving (15s) or not (60s).
  useEffect(() => {
    let timer: number | undefined;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        await refetch();
        schedule();
      }, activeRef.current ? ACTIVE_INTERVAL_MS : IDLE_INTERVAL_MS);
    };
    void refetch().then(() => schedule());

    const onFocus = () => {
      void refetch();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refetch]);

  const byStoreId = useMemo(
    () => new Map(states.map((s) => [s.store.id, s])),
    [states],
  );

  return { states, byStoreId, loading, error, lastFetchedAt, refetch };
}
