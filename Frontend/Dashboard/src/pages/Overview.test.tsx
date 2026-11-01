import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { api } from '@/lib/api';
import Overview from './Overview';
vi.mock('@/components/dashboard/IntelligenceFindingsPanel', () => ({ default: () => <div>Verified findings panel</div> }));
vi.mock('@/components/dashboard/MorningBriefing', () => ({ default: () => null }));
vi.mock('@/components/dashboard/RevenueChart', () => ({ RevenueChart: () => null }));
vi.mock('@/components/dashboard/LiveActivity', () => ({ LiveActivity: () => null }));

describe('Command Center store status', () => {
  afterEach(() => vi.restoreAllMocks());
  it('retains the approved heading and Shopify action after a verified empty result', async () => {
    vi.spyOn(api, 'get').mockImplementation(async path => ({ ok: true, status: 200, data: { success: true, data: path === '/stores' ? { stores: [] } : {} } }));
    render(<MemoryRouter><Overview /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Connect your store to get started' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect Shopify' })).toBeInTheDocument();
  });
  it('keeps failures unavailable instead of reporting a disconnected store', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new Error('unavailable'));
    render(<MemoryRouter><Overview /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Store status is unavailable' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Connect your store to get started' })).not.toBeInTheDocument();
    expect(screen.queryByText('Not connected')).not.toBeInTheDocument();
  });
});
