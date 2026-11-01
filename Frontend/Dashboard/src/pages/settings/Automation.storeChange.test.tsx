import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuthStore } from '@/store/authStore';
import { DISABLED_AUTOMATION_POLICY } from '@/lib/betaAutomation';

const requests = vi.hoisted(() => ({ stores: vi.fn(), policy: vi.fn(), save: vi.fn() }));
vi.mock('@/lib/betaAutomation', async original => ({
  ...await original<typeof import('@/lib/betaAutomation')>(),
  listAutomationStores: requests.stores, getBetaAutomationPolicy: requests.policy, updateBetaAutomationPolicy: requests.save,
}));
// Use a native select adapter to exercise controller races independently of Radix's pointer/portal implementation.
vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children, disabled }: { value: string; onValueChange: (value: string) => void; children: ReactNode; disabled: boolean }) =>
    <select aria-label="Connected store" value={value} onChange={event => onValueChange(event.target.value)} disabled={disabled}>{children}</select>,
  SelectTrigger: () => null, SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => <option value={value}>{children}</option>,
}));
import Automation from './Automation';

describe('Automation store selection', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useAuthStore.setState({ user: { id: 'sample-user', email: 'owner@example.test', full_name: 'Owner', role: 'owner', tenant_id: 'org', email_verified: true, onboarding_status: 'completed' } });
    requests.stores.mockResolvedValue(['first', 'second'].map(id => ({ id, platform: 'shopify', shop_domain: `${id}.myshopify.com`, status: 'active' })));
  });
  it('clears a previous policy immediately and ignores its late response', async () => {
    let finishFirst: (policy: typeof DISABLED_AUTOMATION_POLICY) => void;
    requests.policy.mockImplementation((id: string) => id === 'first'
      ? new Promise(resolve => { finishFirst = resolve; }) : Promise.resolve(DISABLED_AUTOMATION_POLICY));
    requests.save.mockResolvedValue(DISABLED_AUTOMATION_POLICY);
    render(<MemoryRouter><Automation /></MemoryRouter>);
    await waitFor(() => expect(requests.policy).toHaveBeenCalledWith('first'));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'second' } });
    const save = await screen.findByRole('button', { name: 'Save automation policy' });
    finishFirst!({ ...DISABLED_AUTOMATION_POLICY, enabled: true, kill_switch: false });
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Recovery authorisation' })).not.toBeChecked());
    fireEvent.click(save);
    await waitFor(() => expect(requests.save).toHaveBeenCalledWith('second', expect.objectContaining({ enabled: false })));
  });
  it('removes the form when management access is revoked', async () => {
    requests.policy.mockResolvedValue(DISABLED_AUTOMATION_POLICY);
    render(<MemoryRouter><Automation /></MemoryRouter>);
    await screen.findByRole('button', { name: 'Save automation policy' });
    act(() => useAuthStore.setState(state => ({ user: { ...state.user!, role: 'member' } })));
    expect(await screen.findByText('Owner or admin access required')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save automation policy' })).not.toBeInTheDocument();
    expect(requests.save).not.toHaveBeenCalled();
  });
});
