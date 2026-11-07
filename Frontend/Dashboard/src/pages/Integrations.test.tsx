import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { api } from '@/lib/api';
import Integrations from './Integrations';

const storesResponse = (stores: unknown[]) => ({ ok: true, status: 200, data: { success: true, data: { stores } } });
const statesResponse = (states: unknown[]) => ({ ok: true, status: 200, data: { success: true, data: { contract_version: 'rev-integration-state-v1', states } } });

// A minimal-but-valid rev-integration-state-v1 block (server contract shape).
const canonicalState = (overallStatus: string, storeId = 'shop', overrides: Record<string, unknown> = {}) => ({
  contract_version: 'rev-integration-state-v1',
  organization_id: 'org-1',
  integration_id: `int-${storeId}`,
  store: { id: storeId, shop_domain: `${storeId}.myshopify.com`, provider: 'shopify', installed_at: null, last_synced_at: null },
  overall_status: overallStatus,
  status_reason: 'test_reason',
  status_explanation: 'Test explanation.',
  merchant_action_required: overallStatus !== 'connected',
  recommended_next_step: null,
  authorization: { verification: 'unknown', valid: false, verified: false, last_verified_at: null, missing_app_scopes: [] },
  synchronization: { state: 'unknown', running_domains: [], failed_domains: [], partial_domains: [], last_succeeded_at: null },
  evaluated_at: '2026-11-07T12:00:00Z',
  ...overrides,
});

const connectedStore = {
  id: 'shop', platform: 'shopify', shop_domain: 'shop.myshopify.com',
  connection_status: 'connected', setup_status: 'complete', sync_status: 'complete',
  webhooks_registered: 9, webhooks_required: 9, last_synced_at: '2026-10-30', installed_at: '2026-10-29',
};

// Route mocks by URL so the store list and the canonical states endpoint are
// independent sources (the UI joins them).
function mockApi({ stores = [], states = [] }: { stores?: unknown[]; states?: unknown[] } = {}) {
  return vi.spyOn(api, 'get').mockImplementation((url: string) => {
    if (String(url).includes('/integration-states')) return Promise.resolve(statesResponse(states));
    return Promise.resolve(storesResponse(stores));
  });
}

describe('Task 213 — canonical integration state on the integrations page', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('renders green Connected ONLY for the verified canonical state', async () => {
    mockApi({ stores: [connectedStore], states: [canonicalState('connected')] });
    render(<MemoryRouter><Integrations /></MemoryRouter>);
    // Both the platform card and the store card carry the verified state.
    expect((await screen.findAllByText('Connected', { exact: true })).length).toBeGreaterThanOrEqual(1);
  });

  it('renders limited_access as Limited access, never as Connected', async () => {
    mockApi({ stores: [connectedStore], states: [canonicalState('limited_access')] });
    render(<MemoryRouter><Integrations /></MemoryRouter>);
    expect((await screen.findAllByText('Limited access', { exact: true })).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryAllByText('Connected', { exact: true })).toHaveLength(0);
  });

  it('aggregates the worst canonical state across stores', async () => {
    mockApi({
      stores: [connectedStore, { ...connectedStore, id: 'bad', shop_domain: 'bad.myshopify.com' }],
      states: [canonicalState('connected'), canonicalState('needs_attention', 'bad')],
    });
    render(<MemoryRouter><Integrations /></MemoryRouter>);
    // The platform badge takes the WORST state (needs_attention), while the
    // healthy store's own badge may still truthfully read Connected.
    expect((await screen.findAllByText('Needs attention', { exact: true })).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('2 Shopify stores connected')).toBeInTheDocument();
  });

  it('fail-closed: a connected store with an INVALID canonical block is never green', async () => {
    // The states endpoint serves a block with the wrong contract version.
    mockApi({
      stores: [connectedStore],
      states: [{ ...canonicalState('connected'), contract_version: 'rev-integration-state-v0' }],
    });
    render(<MemoryRouter><Integrations /></MemoryRouter>);
    // Platform badge: no valid canonical state while store records exist.
    expect((await screen.findAllByText('Status unknown', { exact: true })).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryAllByText('Connected', { exact: true })).toHaveLength(0);
  });

  it('fail-closed: a failed states endpoint with store records renders Status unknown', async () => {
    vi.spyOn(api, 'get').mockImplementation((url: string) => {
      if (String(url).includes('/integration-states')) return Promise.reject(new Error('offline'));
      return Promise.resolve(storesResponse([connectedStore]));
    });
    render(<MemoryRouter><Integrations /></MemoryRouter>);
    expect((await screen.findAllByText('Status unknown', { exact: true })).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryAllByText('Connected', { exact: true })).toHaveLength(0);
  });

  it('per-store badge falls back to the store list additive block when polling has no state', async () => {
    vi.spyOn(api, 'get').mockImplementation((url: string) => {
      if (String(url).includes('/integration-states')) return Promise.reject(new Error('offline'));
      return Promise.resolve(storesResponse([{ ...connectedStore, integration_state: canonicalState('synchronizing') }]));
    });
    render(<MemoryRouter><Integrations /></MemoryRouter>);
    // The store card's own badge still tells the truth from the additive block.
    expect(await screen.findByText('Synchronizing', { exact: true })).toBeInTheDocument();
  });

  it('no store records and no canonical states renders Not Connected (honest empty state)', async () => {
    mockApi({ stores: [], states: [] });
    render(<MemoryRouter><Integrations /></MemoryRouter>);
    expect(await screen.findByText('No Store Connected')).toBeInTheDocument();
    expect(screen.getByText('Not Connected', { exact: true })).toBeInTheDocument();
  });
});

describe('Shopify integrations store list (failure + retry)', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('shows an honest failure and performs a visible refetch on Retry', async () => {
    let complete: (value: ReturnType<typeof storesResponse>) => void;
    let storesCalls = 0;
    vi.spyOn(api, 'get').mockImplementation((url: string) => {
      if (String(url).includes('/integration-states')) return Promise.resolve(statesResponse([]));
      storesCalls += 1;
      // First store-list call fails; the Retry call hangs until resolved.
      if (storesCalls === 1) return Promise.reject(new Error('offline'));
      return new Promise(resolve => { complete = resolve; });
    });
    render(<MemoryRouter><Integrations /></MemoryRouter>);
    expect(await screen.findByText('Connection status unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.getByRole('button', { name: 'Retrying…' })).toBeDisabled();
    complete!(storesResponse([]));
    expect(await screen.findByText('No Store Connected')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'WooCommerce' })).not.toBeInTheDocument();
  });

  it('reports a repeated retry failure', async () => {
    const get = vi.spyOn(api, 'get').mockImplementation((url: string) => {
      if (String(url).includes('/integration-states')) return Promise.resolve(statesResponse([]));
      return Promise.reject(new Error('offline'));
    });
    render(<MemoryRouter><Integrations /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    // mount: /integration-states + /stores; retry click: /stores again.
    await waitFor(() => expect(get).toHaveBeenCalledTimes(3));
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeEnabled();
    expect(screen.queryByText('No Store Connected')).not.toBeInTheDocument();
  });
  const disconnectedStore = {
    id: '11111111-1111-4111-8111-111111111111', platform: 'shopify', shop_domain: 'revluma-test-store-v1.myshopify.com',
    status: 'disconnected', installed_at: '2026-10-29', connection_status: 'disconnected', connection_state: 'authorization_required',
    setup_status: 'disconnected', sync_status: 'failed', reconnect_eligible: true,
    diagnostic: { reason_code: 'AUTHORIZATION_REQUIRED', severity: 'error', explanation: 'Your Shopify connection needs to be renewed. Reconnect your store to restore access.', merchant_action_required: true, recommended_action: 'reconnect', retry_eligible: false, reconnect_eligible: true },
    diagnostics: {
      connection: { authorization: 'verification_unavailable', authorization_verified_at: null },
      webhooks: { registration: { complete: false }, delivery: { status: 'no_evidence', note: 'No delivery evidence.' } },
      synchronization: { status: 'failed', attempt_count: 1, required_resources_complete: false, resources: [
        { resource: 'products', required: true, status: 'ok', retrieved_record_count: 8, persisted_record_count: 8, pagination_complete: true, last_successful_sync: '2026-11-01', error_code: null },
        { resource: 'orders', required: true, status: 'failed', retrieved_record_count: null, persisted_record_count: null, pagination_complete: false, last_successful_sync: null, error_code: 'SHOPIFY_AUTHORIZATION_REQUIRED' },
      ] },
    },
  };

  it('starts a store-bound reconnect and prevents duplicate submissions', async () => {
    const get = vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/stores') return storesResponse([disconnectedStore]) as never;
      return { ok: true, status: 200, data: { success: true, redirectUrl: 'https://revluma-test-store-v1.myshopify.com/admin/oauth/authorize?state=secure' } } as never;
    });
    render(<MemoryRouter><Integrations /></MemoryRouter>);
    expect(await screen.findByText('Shopify reconnect required')).toBeInTheDocument();
    expect(screen.queryByText('Your store is ready!')).not.toBeInTheDocument();
    const reconnect = screen.getByRole('button', { name: 'Reconnect Shopify' });
    fireEvent.click(reconnect);
    fireEvent.click(reconnect);
    await waitFor(() => expect(get).toHaveBeenCalledWith('/shopify/install', { shop: disconnectedStore.shop_domain, store_id: disconnectedStore.id, mode: 'reconnect' }));
    expect(get.mock.calls.filter(([path]) => path === '/shopify/install')).toHaveLength(1);
  });

  it('never restores cached connected UI after a failed reconnect callback', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(storesResponse([{ ...disconnectedStore, connection_state: 'reconnect_failed', diagnostic: { ...disconnectedStore.diagnostic, reason_code: 'TOKEN_EXCHANGE_FAILED' } }]));
    render(<MemoryRouter initialEntries={['/dashboard/integrations?shopify=reconnect_failed&shop=revluma-test-store-v1.myshopify.com']}><Integrations /></MemoryRouter>);
    expect(await screen.findByText('Shopify reconnect required')).toBeInTheDocument();
    expect(screen.queryByText('Your store is ready!')).not.toBeInTheDocument();
    expect(screen.queryByText('Shopify Store Connected')).not.toBeInTheDocument();
  });

  it('shows actual resource failures and preserves independent product results', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(storesResponse([disconnectedStore]));
    render(<MemoryRouter><Integrations /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'View diagnostics' }));
    expect(await screen.findByText('Resource coverage')).toBeInTheDocument();
    expect(screen.getByText(/products · required/)).toBeInTheDocument();
    expect(screen.getByText(/ok · 8 retrieved/)).toBeInTheDocument();
    expect(screen.getByText(/failed · SHOPIFY_AUTHORIZATION_REQUIRED/)).toBeInTheDocument();
    expect(screen.getByText(/not progress estimates/)).toBeInTheDocument();
  });
});

describe('Task 214 — secure reconnect, diagnostics and truthful resource state', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  // A tenant-owned store whose authorization needs renewal; webhooks/sync are
  // independent evidence. The diagnostics block is the authoritative shape.
  const disconnectedStore = {
    id: '11111111-1111-4111-8111-111111111111', platform: 'shopify', shop_domain: 'revluma-test-store-v1.myshopify.com',
    status: 'disconnected', installed_at: '2026-10-29', connection_status: 'disconnected', connection_state: 'authorization_required',
    setup_status: 'disconnected', sync_status: 'failed', reconnect_eligible: true,
    diagnostic: { reason_code: 'AUTHORIZATION_REQUIRED', severity: 'error', explanation: 'Your Shopify connection needs to be renewed. Reconnect your store to restore access.', merchant_action_required: true, recommended_action: 'reconnect', retry_eligible: false, reconnect_eligible: true },
    diagnostics: {
      connection: { authorization: 'verification_unavailable', authorization_verified_at: null },
      webhooks: { registration: { complete: false }, delivery: { status: 'no_evidence', note: 'No delivery evidence.' } },
      synchronization: { status: 'failed', attempt_count: 1, required_resources_complete: false, resources: [
        { resource: 'products', required: true, status: 'ok', retrieved_record_count: 8, persisted_record_count: 8, pagination_complete: true, last_successful_sync: '2026-11-01', error_code: null },
        { resource: 'orders', required: true, status: 'failed', retrieved_record_count: null, persisted_record_count: null, pagination_complete: false, last_successful_sync: null, error_code: 'SHOPIFY_AUTHORIZATION_REQUIRED' },
      ] },
    },
  };

  it('starts a store-bound reconnect and prevents duplicate submissions', async () => {
    const get = vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (String(path).includes('/integration-states')) return statesResponse([]) as never;
      if (path === '/stores') return storesResponse([disconnectedStore]) as never;
      // /shopify/install (reconnect) returns a provider redirect.
      return { ok: true, status: 200, data: { success: true, redirectUrl: 'https://revluma-test-store-v1.myshopify.com/admin/oauth/authorize?state=secure' } } as never;
    });
    render(<MemoryRouter><Integrations /></MemoryRouter>);
    expect(await screen.findByText('Shopify reconnect required')).toBeInTheDocument();
    expect(screen.queryByText('Your store is ready!')).not.toBeInTheDocument();
    const reconnect = screen.getByRole('button', { name: 'Reconnect Shopify' });
    fireEvent.click(reconnect);
    fireEvent.click(reconnect);
    await waitFor(() => expect(get).toHaveBeenCalledWith('/shopify/install', { shop: disconnectedStore.shop_domain, store_id: disconnectedStore.id, mode: 'reconnect' }));
    expect(get.mock.calls.filter(([path]) => path === '/shopify/install')).toHaveLength(1);
  });

  it('never restores cached connected UI after a failed reconnect callback', async () => {
    // A stale optimistic cache must not override the authoritative failed state.
    sessionStorage.setItem('revluma:integration-store-status:v1', JSON.stringify([{ ...disconnectedStore, connection_status: 'connected', connection_state: 'connected', setup_status: 'complete' }]));
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (String(path).includes('/integration-states')) return statesResponse([]) as never;
      return storesResponse([{ ...disconnectedStore, connection_state: 'reconnect_failed', diagnostic: { ...disconnectedStore.diagnostic, reason_code: 'TOKEN_EXCHANGE_FAILED' } }]) as never;
    });
    render(<MemoryRouter initialEntries={['/dashboard/integrations?shopify=reconnect_failed&shop=revluma-test-store-v1.myshopify.com']}><Integrations /></MemoryRouter>);
    expect(await screen.findByText('Shopify reconnect required')).toBeInTheDocument();
    expect(screen.queryByText('Your store is ready!')).not.toBeInTheDocument();
  });

  it('shows actual resource failures and preserves independent product results', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (String(path).includes('/integration-states')) return statesResponse([]) as never;
      return storesResponse([disconnectedStore]) as never;
    });
    render(<MemoryRouter><Integrations /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'View diagnostics' }));
    expect(await screen.findByText('Resource coverage')).toBeInTheDocument();
    expect(screen.getByText(/products · required/)).toBeInTheDocument();
    expect(screen.getByText(/ok · 8 retrieved/)).toBeInTheDocument();
    expect(screen.getByText(/failed · SHOPIFY_AUTHORIZATION_REQUIRED/)).toBeInTheDocument();
    expect(screen.getByText(/not progress estimates/)).toBeInTheDocument();
  });
});
