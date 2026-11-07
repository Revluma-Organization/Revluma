import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { api } from '@/lib/api';
import Integrations from './Integrations';

const response = (stores: unknown[]) => ({ ok: true, status: 200, data: { success: true, data: { stores } } });
describe('Shopify integrations store list', () => {
  beforeEach(() => { vi.restoreAllMocks(); sessionStorage.clear(); });
  it('shows an honest failure and performs a visible refetch on Retry', async () => {
    let complete: (value: ReturnType<typeof response>) => void;
    const get = vi.spyOn(api, 'get').mockRejectedValueOnce(new Error('offline'))
      .mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    render(<MemoryRouter><Integrations /></MemoryRouter>);
    expect(await screen.findByText('Connection status unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Not Connected')).not.toBeInTheDocument();
    expect(screen.queryByText('No Store Connected')).not.toBeInTheDocument();
    expect(screen.queryByText(/0 Shopify stores connected/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.getByRole('button', { name: 'Retrying…' })).toBeDisabled();
    expect(get).toHaveBeenCalledTimes(2);
    complete!(response([]));
    expect(await screen.findByText('No Store Connected')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'WooCommerce' })).not.toBeInTheDocument();
  });
  it('reports a repeated retry failure', async () => {
    const get = vi.spyOn(api, 'get').mockRejectedValue(new Error('offline'));
    render(<MemoryRouter><Integrations /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeEnabled();
    expect(screen.queryByText('No Store Connected')).not.toBeInTheDocument();
  });
  it.each([
    ['healthy first, failed second', false, 'failed', 'connected', 'Needs attention'],
    ['failed first, healthy second', true, 'failed', 'connected', 'Needs attention'],
    ['healthy first, disconnected installation second', false, 'complete', 'disconnected', 'Needs attention'],
    ['disconnected installation first, healthy second', true, 'complete', 'disconnected', 'Needs attention'],
    ['healthy first, pending second', false, 'pending', 'connected', 'Syncing / setup pending'],
    ['pending first, healthy second', true, 'pending', 'connected', 'Syncing / setup pending'],
  ])('aggregates deterministically: %s', async (_name, reverse, setup_status, connection_status, label) => {
    const healthy = { id: 'healthy', platform: 'shopify', shop_domain: 'healthy.myshopify.com', connection_status: 'connected', setup_status: 'complete', sync_status: 'complete', webhooks_registered: 9, webhooks_required: 9, last_synced_at: '2026-10-30', installed_at: '2026-10-29' };
    const stores = [healthy, { ...healthy, id: 'unhealthy', shop_domain: 'unhealthy.myshopify.com', setup_status, connection_status }];
    vi.spyOn(api, 'get').mockResolvedValue(response(reverse ? stores.reverse() : stores));
    render(<MemoryRouter><Integrations /></MemoryRouter>);
    expect(await screen.findByText(label, { exact: true })).toBeInTheDocument();
  });
  it.each([
    ['complete', 'complete', 'Connected'],
    ['pending', 'pending', 'Syncing / setup pending'],
    ['failed', 'failed', 'Needs attention'],
  ])('separates %s setup from other connection states', async (setup_status, sync_status, label) => {
    vi.spyOn(api, 'get').mockResolvedValue(response([{
      id: 'shop', platform: 'shopify', shop_domain: 'sample.myshopify.com', connection_status: 'connected',
      setup_status, sync_status, webhooks_registered: 9, webhooks_required: 9, last_synced_at: '2026-10-30',
    }]));
    render(<MemoryRouter><Integrations /></MemoryRouter>);
    expect(await screen.findByText(label, { exact: true })).toBeInTheDocument();
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
      if (path === '/stores') return response([disconnectedStore]) as never;
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
    sessionStorage.setItem('revluma:integration-store-status:v1', JSON.stringify([{ ...disconnectedStore, connection_status: 'connected', connection_state: 'connected', setup_status: 'complete' }]));
    vi.spyOn(api, 'get').mockResolvedValue(response([{ ...disconnectedStore, connection_state: 'reconnect_failed', diagnostic: { ...disconnectedStore.diagnostic, reason_code: 'TOKEN_EXCHANGE_FAILED' } }]));
    render(<MemoryRouter initialEntries={['/dashboard/integrations?shopify=reconnect_failed&shop=revluma-test-store-v1.myshopify.com']}><Integrations /></MemoryRouter>);
    expect(await screen.findByText('Shopify reconnect required')).toBeInTheDocument();
    expect(screen.queryByText('Your store is ready!')).not.toBeInTheDocument();
    expect(screen.queryByText('Shopify Store Connected')).not.toBeInTheDocument();
  });

  it('shows actual resource failures and preserves independent product results', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(response([disconnectedStore]));
    render(<MemoryRouter><Integrations /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'View diagnostics' }));
    expect(await screen.findByText('Resource coverage')).toBeInTheDocument();
    expect(screen.getByText(/products · required/)).toBeInTheDocument();
    expect(screen.getByText(/ok · 8 retrieved/)).toBeInTheDocument();
    expect(screen.getByText(/failed · SHOPIFY_AUTHORIZATION_REQUIRED/)).toBeInTheDocument();
    expect(screen.getByText(/not progress estimates/)).toBeInTheDocument();
  });
});
