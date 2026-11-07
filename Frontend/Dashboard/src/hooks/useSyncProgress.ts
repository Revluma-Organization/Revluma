// src/hooks/useSyncProgress.ts
// Task 215 — bounded, controlled polling for a store's authoritative sync-progress.
//
// The backend is the single source of truth; this hook only ever renders what
// the API returns (it never increments or assumes a state locally). It polls
// ONLY while the job is actively changing (running / stalled / queued), then
// STOPS on a terminal state (completed / partial / failed / idle /
// unavailable) — so there is no unbounded polling. It backs off to a slower
// cadence for stalled/queued work, caps total poll time, dedupes in-flight
// requests, and cleans up on unmount. `refetch` is used after a retry so the
// backend immediately overrides any stale view.

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import {
  normalizeSyncProgress,
  ACTIVE_JOB_STATUSES,
  TERMINAL_JOB_STATUSES,
  type SyncProgress,
} from "@/lib/integrationProgress";

const RUNNING_INTERVAL_MS = 4_000;
const SLOW_INTERVAL_MS = 15_000;
// Hard bound: never poll a single job for more than this (no unbounded polling).
const MAX_POLL_MS = 30 * 60 * 1_000;

export interface UseSyncProgressResult {
  progress: SyncProgress | null;
  loading: boolean;
  error: boolean;
  refetch: () => Promise<SyncProgress | null>;
}

export function useSyncProgress(
  storeId: string | null,
  options: { enabled?: boolean } = {},
): UseSyncProgressResult {
  const enabled = options.enabled ?? true;
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const progressRef = useRef<SyncProgress | null>(null);
  const inFlightRef = useRef(false);
  const settledRef = useRef(false);
  const timerRef = useRef<number | undefined>(undefined);
  const startedAtRef = useRef<number>(0);

  const setProgressBoth = useCallback((next: SyncProgress | null) => {
    progressRef.current = next;
    setProgress(next);
  }, []);

  const fetchOnce = useCallback(async (): Promise<SyncProgress | null> => {
    if (!storeId) {
      setLoading(false);
      return null;
    }
    // Dedup: never fire a second request while one is in flight.
    if (inFlightRef.current) return progressRef.current;
    inFlightRef.current = true;
    try {
      const res = await api.get<{ success: boolean; data: unknown }>(
        `/stores/${storeId}/sync-progress`,
      );
      // Fail-closed: an invalid contract normalizes to null (honest unknown).
      const normalized = normalizeSyncProgress(res.data?.data);
      setProgressBoth(normalized);
      setError(false);
      return normalized;
    } catch {
      setError(true);
      return null;
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [storeId, setProgressBoth]);

  const schedule = useCallback(() => {
    window.clearTimeout(timerRef.current);
    const current = progressRef.current;
    const status = current?.job.status;
    // Stop on terminal (or no data): do not keep polling.
    if (!status || !ACTIVE_JOB_STATUSES.has(status)) {
      settledRef.current = true;
      return;
    }
    // Bound total poll time.
    if (Date.now() - startedAtRef.current > MAX_POLL_MS) {
      settledRef.current = true;
      return;
    }
    const interval = status === "running" ? RUNNING_INTERVAL_MS : SLOW_INTERVAL_MS;
    timerRef.current = window.setTimeout(async () => {
      const next = await fetchOnce();
      if (next && (TERMINAL_JOB_STATUSES.has(next.job.status) || !ACTIVE_JOB_STATUSES.has(next.job.status))) {
        settledRef.current = true;
      }
      schedule();
    }, interval);
  }, [fetchOnce]);

  useEffect(() => {
    if (!enabled || !storeId) {
      setLoading(false);
      setProgressBoth(null);
      return;
    }
    settledRef.current = false;
    startedAtRef.current = Date.now();
    let cancelled = false;
    void (async () => {
      const first = await fetchOnce();
      if (cancelled) return;
      if (first && !ACTIVE_JOB_STATUSES.has(first.job.status)) {
        settledRef.current = true;
      } else {
        schedule();
      }
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(timerRef.current);
    };
  }, [storeId, enabled, fetchOnce, schedule, setProgressBoth]);

  const refetch = useCallback(async (): Promise<SyncProgress | null> => {
    // A retry (or focus) forces the backend to override any stale view.
    settledRef.current = false;
    startedAtRef.current = Date.now();
    const next = await fetchOnce();
    if (next && !ACTIVE_JOB_STATUSES.has(next.job.status)) {
      settledRef.current = true;
    } else {
      schedule();
    }
    return next;
  }, [fetchOnce, schedule]);

  return { progress, loading, error, refetch };
}
