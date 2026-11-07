import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { api } from '@/lib/api';
import { useIntegrationStates } from './useIntegrationStates';
import { INTEGRATION_STATE_CONTRACT_VERSION } from '@/lib/integrationState';

const statesPayload = (states: unknown[]) => ({
  ok: true, status: 200,
  data: { success: true, data: { contract_version: INTEGRATION_STATE_CONTRACT_VERSION, states } },
});

const state = (overall_status: string, id = 's1') => ({
  contract_version: INTEGRATION_STATE_CONTRACT_VERSION,
  organization_id: 'org-1', integration_id: `int-${id}`,
  store: { id, shop_domain: `${id}.myshopify.com`, provider: 'shopify', installed_at: null, last_synced_at: null },
  overall_status, status_reason: 'r', status_explanation: 'e', merchant_action_required: false,
  recommended_next_step: null,
  authorization: { verification: 'unknown', valid: false, verified: false, last_verified_at: null, missing_app_scopes: [] },
  synchronization: { state: 'unknown', running_domains: [], failed_domains: [], partial_domains: [], last_succeeded_at: null },
  evaluated_at: '2026-11-07T12:00:00Z',
});

const mockStates = (states: unknown[]) => vi.spyOn(api, 'get').mockImplementation((url: string) =>
  String(url).includes('/integration-states')
    ? Promise.resolve(statesPayload(states))
    : Promise.resolve({ ok: true, status: 200, data: {} }),
);

// Flush the initial fetch's microtasks (no real timers needed for resolution).
const settle = () => act(async () => {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
});

describe('useIntegrationStates', () => {
  beforeEach(() => { vi.restoreAllMocks(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('returns the normalized states keyed by store id', async () => {
    mockStates([state('connected'), state('limited_access', 's2')]);
    const { result } = renderHook(() => useIntegrationStates());
    await settle();
    expect(result.current.loading).toBe(false);
    expect(result.current.states).toHaveLength(2);
    expect(result.current.byStoreId.get('s1')?.overall_status).toBe('connected');
    expect(result.current.byStoreId.get('s2')?.overall_status).toBe('limited_access');
  });

  it('drops invalid blocks (fail-closed) and keeps valid ones', async () => {
    mockStates([state('connected'), { ...state('connected', 'bad'), overall_status: 'healthy' }]);
    const { result } = renderHook(() => useIntegrationStates());
    await settle();
    expect(result.current.loading).toBe(false);
    expect(result.current.states).toHaveLength(1);
    expect(result.current.states[0].store.id).toBe('s1');
  });

  it('treats a malformed response as an error, not as connected', async () => {
    vi.spyOn(api, 'get').mockImplementation((url: string) =>
      String(url).includes('/integration-states')
        ? Promise.resolve({ ok: true, status: 200, data: { success: false } })
        : Promise.resolve({}),
    );
    const { result } = renderHook(() => useIntegrationStates());
    await settle();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe(true);
    expect(result.current.states).toHaveLength(0);
  });

  it('polls at the active cadence (15s) while a store is synchronizing', async () => {
    const getSpy = vi.spyOn(api, 'get').mockImplementation((url: string) =>
      String(url).includes('/integration-states')
        ? Promise.resolve(statesPayload([state('synchronizing')]))
        : Promise.resolve({}),
    );
    const { unmount } = renderHook(() => useIntegrationStates());
    await settle();
    const initial = getSpy.mock.calls.length;
    await act(async () => { vi.advanceTimersByTime(15_000); await Promise.resolve(); });
    expect(getSpy.mock.calls.length).toBeGreaterThan(initial);
    unmount();
  });

  it('polls at the idle cadence (60s) when no store is actively moving', async () => {
    const getSpy = vi.spyOn(api, 'get').mockImplementation((url: string) =>
      String(url).includes('/integration-states')
        ? Promise.resolve(statesPayload([state('connected')]))
        : Promise.resolve({}),
    );
    const { unmount } = renderHook(() => useIntegrationStates());
    await settle();
    const initial = getSpy.mock.calls.length;
    // At 45s nothing has refetched yet (idle = 60s).
    await act(async () => { vi.advanceTimersByTime(45_000); await Promise.resolve(); });
    expect(getSpy.mock.calls.length).toBe(initial);
    // Crossing 60s triggers a refetch.
    await act(async () => { vi.advanceTimersByTime(15_000); await Promise.resolve(); });
    expect(getSpy.mock.calls.length).toBeGreaterThan(initial);
    unmount();
  });

  it('refetches on window focus', async () => {
    const getSpy = mockStates([state('connected')]);
    renderHook(() => useIntegrationStates());
    await settle();
    const initial = getSpy.mock.calls.length;
    await act(async () => { window.dispatchEvent(new Event('focus')); await Promise.resolve(); });
    expect(getSpy.mock.calls.length).toBeGreaterThan(initial);
  });

  it('exposes a manual refetch', async () => {
    const getSpy = mockStates([state('connected')]);
    const { result } = renderHook(() => useIntegrationStates());
    await settle();
    const initial = getSpy.mock.calls.length;
    await act(async () => { await result.current.refetch(); });
    expect(getSpy.mock.calls.length).toBeGreaterThan(initial);
    expect(result.current.states).toHaveLength(1);
  });
});
