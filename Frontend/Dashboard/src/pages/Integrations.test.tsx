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
});
