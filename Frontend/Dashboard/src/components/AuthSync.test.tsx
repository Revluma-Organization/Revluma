import { act, render } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { AuthSync } from './AuthSync';

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  useAuthStore.getState().resetLocalAuthState();
});

it.each(['storage', 'pageshow'])('suspends the old role on %s and verifies the new membership', async eventType => {
  const user = { id: 'user', email: 'test@example.test', full_name: 'Test Account', role: 'owner', tenant_id: 'A', email_verified: true, onboarding_status: 'completed' };
  useAuthStore.setState({ user, csrfToken: 'token-A', sessionVerified: true });
  let complete!: (value: unknown) => void;
  vi.spyOn(api, 'get').mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  render(<AuthSync />);
  act(() => {
    localStorage.setItem('rv-auth', JSON.stringify({ state: { user: { ...user, tenant_id: 'B' }, csrfToken: 'token-B' }, version: 0 }));
    const event = eventType === 'storage' ? new StorageEvent('storage', { key: 'rv-auth' }) : new Event('pageshow');
    if (eventType === 'pageshow') Object.defineProperty(event, 'persisted', { value: true });
    window.dispatchEvent(event);
  });
  expect(useAuthStore.getState()).toMatchObject({ csrfToken: 'token-B', sessionVerified: false, user: { role: 'unknown', tenant_id: 'B' } });
  await act(async () => {
    complete({ ok: true, status: 200, data: { success: true, data: { ...user, active_organization_id: 'B', organization_members: [{ id: 'membership', organization_id: 'B', role: 'viewer', status: 'active', joined_at: null, organizations: { id: 'B', company_name: 'Workspace B' } }] } } });
  });
  expect(useAuthStore.getState()).toMatchObject({ sessionVerified: true, user: { role: 'viewer', tenant_id: 'B' } });
});
