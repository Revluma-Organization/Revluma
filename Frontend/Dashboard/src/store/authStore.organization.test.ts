import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import * as logout from '@/lib/auth/logout';
import { useAuthStore } from './authStore';
import { notifySessionTokenChanged, resolveProfileMembership, assertCurrentSession, currentSessionGeneration } from '@/lib/auth/organization';

const membership = (organization_id: string, role: string, status = 'active') => ({ id: `member-${organization_id}`, organization_id, role, status, joined_at: null, organizations: { id: organization_id, company_name: organization_id } });
const profile = (role: string, selected: string | null = 'B') => ({ id: 'user', email: 'owner@example.test', full_name: 'Test Account', email_verified: true, onboarding_completed: true, active_organization_id: selected, organization_members: [membership('A', 'owner'), membership('B', role)] });
const reply = (data: unknown) => ({ ok: true, status: 200, data: { success: true, data } });

describe('organisation roles across session boundaries', () => {
  beforeEach(() => { vi.restoreAllMocks(); localStorage.clear(); useAuthStore.setState({ user: null, csrfToken: 'test-token', sessionVerified: false }); });
  it.each(['owner', 'admin', 'member', 'viewer'])('hydrates the selected %s membership rather than the first owner', async role => {
    vi.spyOn(api, 'get').mockResolvedValue(reply(profile(role)));
    await useAuthStore.getState().checkSession();
    expect(useAuthStore.getState().user).toMatchObject({ role, tenant_id: 'B' });
    expect(useAuthStore.getState().sessionVerified).toBe(true);
  });
  it('does not invent an organisation for ambiguous or inactive memberships', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(reply(profile('member', null)));
    await useAuthStore.getState().checkSession();
    expect(useAuthStore.getState().user).toMatchObject({ role: 'unknown', tenant_id: '' });
    expect(resolveProfileMembership([membership('A', 'owner', 'inactive')], 'A')).toBeUndefined();
    expect(resolveProfileMembership([], undefined)).toBeUndefined();
  });
  it('preserves a single legacy membership without granting ownership', () => {
    expect(resolveProfileMembership([membership('B', 'member')], undefined)?.role).toBe('member');
  });
  it('discards persisted roles until /auth/me revalidates them', async () => {
    localStorage.setItem('rv-auth', JSON.stringify({ state: { user: { ...profile('member'), role: 'owner', tenant_id: 'B' }, csrfToken: 'old-token' }, version: 0 }));
    await useAuthStore.persist.rehydrate();
    expect(useAuthStore.getState().user).toMatchObject({ role: 'unknown', tenant_id: 'B' });
    expect(useAuthStore.getState().sessionVerified).toBe(false);
    vi.spyOn(api, 'get').mockResolvedValue(reply(profile('member')));
    await useAuthStore.getState().checkSession();
    expect(useAuthStore.getState().user?.role).toBe('member');
  });
  it('revalidates role after refresh and keeps the rotated token in memory', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(reply(profile('viewer')));
    localStorage.setItem('rv-auth', JSON.stringify({ state: { csrfToken: 'rotated-token' }, version: 0 }));
    notifySessionTokenChanged('rotated-token');
    await vi.waitFor(() => expect(useAuthStore.getState().sessionVerified).toBe(true));
    expect(useAuthStore.getState()).toMatchObject({ csrfToken: 'rotated-token', user: { role: 'viewer', tenant_id: 'B' } });
  });
  it('uses verified workspace selection and then fetches the new role', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(reply(profile('member')));
    await useAuthStore.getState().checkSession();
    const post = vi.spyOn(api, 'post').mockResolvedValue(reply({ access_token: 'new-token', active_organization_id: 'A', role: 'owner' }));
    vi.mocked(api.get).mockResolvedValue(reply({ ...profile('member'), active_organization_id: 'A' }));
    await useAuthStore.getState().selectWorkspace('A');
    expect(post).toHaveBeenCalledWith('/auth/workspace', { organization_id: 'A' });
    expect(useAuthStore.getState().user).toMatchObject({ role: 'owner', tenant_id: 'A' });
  });
  it('does not trust a failed profile response', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ ok: true, status: 200, data: { success: false, data: profile('owner') } });
    await useAuthStore.getState().checkSession();
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().sessionVerified).toBe(false);
  });
  it.each([false, true])('discards late profile success/failure after local logout (failure=%s)', async failure => {
    let complete!: (value: ReturnType<typeof reply>) => void;
    let fail!: (reason: Error) => void;
    const get = vi.spyOn(api, 'get').mockImplementation(() => new Promise((resolve, reject) => { complete = resolve; fail = reject; }));
    const pending = useAuthStore.getState().checkSession();
    useAuthStore.getState().resetLocalAuthState();
    if (failure) fail(new Error('late failure')); else complete(reply(profile('owner')));
    await pending;
    expect(get).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState()).toMatchObject({ user: null, csrfToken: null, sessionVerified: false });
  });
  it('ignores a token notification after logout', async () => {
    const get = vi.spyOn(api, 'get');
    useAuthStore.getState().resetLocalAuthState();
    notifySessionTokenChanged('late-token');
    expect(get).not.toHaveBeenCalled();
    expect(useAuthStore.getState().csrfToken).toBeNull();
  });
  it('removes the previous role immediately and rejects a late workspace response after logout', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(reply(profile('owner')));
    await useAuthStore.getState().checkSession();
    let complete!: (value: ReturnType<typeof reply>) => void;
    vi.spyOn(api, 'post').mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const pending = useAuthStore.getState().selectWorkspace('A');
    expect(useAuthStore.getState()).toMatchObject({ sessionVerified: false, user: { role: 'unknown' } });
    useAuthStore.getState().resetLocalAuthState();
    complete(reply({ access_token: 'late-token', active_organization_id: 'A' }));
    await expect(pending).rejects.toThrow('Session changed');
    expect(useAuthStore.getState().user).toBeNull();
  });
  it('adopts another tab’s workspace without overwriting its credentials or trusting its cached role', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(reply(profile('owner')));
    await useAuthStore.getState().checkSession();
    let complete!: (value: ReturnType<typeof reply>) => void;
    vi.mocked(api.get).mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const user = { ...useAuthStore.getState().user, tenant_id: 'A', role: 'owner' };
    localStorage.setItem('rv-auth', JSON.stringify({ state: { user, csrfToken: 'other-tab-token' }, version: 0 }));
    const generation = currentSessionGeneration();
    expect(() => assertCurrentSession(generation)).toThrow('Session changed');
    expect(useAuthStore.getState()).toMatchObject({ csrfToken: 'other-tab-token', sessionVerified: false, user: { role: 'unknown', tenant_id: 'A' } });
    expect(JSON.parse(localStorage.getItem('rv-auth')!).state.csrfToken).toBe('other-tab-token');
    complete(reply({ ...profile('member'), active_organization_id: 'A', organization_members: [membership('A', 'viewer')] }));
    await vi.waitFor(() => expect(useAuthStore.getState().sessionVerified).toBe(true));
    expect(useAuthStore.getState().user).toMatchObject({ role: 'viewer', tenant_id: 'A' });
  });
  it('discards a profile response started before session rehydration', async () => {
    let complete!: (value: ReturnType<typeof reply>) => void;
    vi.spyOn(api, 'get').mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const pending = useAuthStore.getState().checkSession();
    localStorage.setItem('rv-auth', JSON.stringify({ state: { csrfToken: 'rehydrated-token' }, version: 0 }));
    await useAuthStore.persist.rehydrate();
    complete(reply(profile('owner')));
    await pending;
    expect(useAuthStore.getState()).toMatchObject({ user: null, csrfToken: 'rehydrated-token', sessionVerified: false });
  });
  it('recovers from a failed workspace selection by revalidating the original membership', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(reply(profile('member')));
    await useAuthStore.getState().checkSession();
    vi.spyOn(api, 'post').mockRejectedValue(new Error('selection unavailable'));
    await expect(useAuthStore.getState().selectWorkspace('A')).rejects.toThrow('selection unavailable');
    expect(useAuthStore.getState()).toMatchObject({ sessionVerified: true, user: { role: 'member', tenant_id: 'B' } });
  });
  it('invalidates requests started while workspace selection was pending', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(reply(profile('member')));
    await useAuthStore.getState().checkSession();
    let complete!: (value: ReturnType<typeof reply>) => void;
    vi.spyOn(api, 'post').mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const pending = useAuthStore.getState().selectWorkspace('A');
    const transitionGeneration = currentSessionGeneration();
    vi.mocked(api.get).mockResolvedValue(reply({ ...profile('member'), active_organization_id: 'A' }));
    complete(reply({ access_token: 'token-A', active_organization_id: 'A' }));
    await pending;
    expect(() => assertCurrentSession(transitionGeneration)).toThrow('Session changed');
    expect(useAuthStore.getState().user).toMatchObject({ role: 'owner', tenant_id: 'A' });
  });
  it('verifies legacy session-storage credentials and clears them on local logout', async () => {
    const user = { ...profile('owner'), tenant_id: 'A', role: 'owner' };
    sessionStorage.setItem('rv-auth', JSON.stringify({ state: { user, accessToken: 'session-token' } }));
    let complete!: (value: ReturnType<typeof reply>) => void;
    vi.spyOn(api, 'get').mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    useAuthStore.setState({ csrfToken: null });
    useAuthStore.getState().synchroniseSession();
    expect(useAuthStore.getState()).toMatchObject({ csrfToken: 'session-token', sessionVerified: false, user: { role: 'unknown' } });
    useAuthStore.getState().resetLocalAuthState();
    complete(reply(profile('owner')));
    await Promise.resolve();
    expect(sessionStorage.getItem('rv-auth')).toBeNull();
    expect(useAuthStore.getState()).toMatchObject({ csrfToken: null, user: null });
  });
  it.each(['login', 'verify2FA'] as const)('discards late %s credentials after logout', async method => {
    let complete!: (value: ReturnType<typeof reply>) => void;
    vi.spyOn(api, 'post').mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const pending = method === 'login' ? useAuthStore.getState().login('test@example.test', 'test-only') : useAuthStore.getState().verify2FA('123456', 'test-challenge', false);
    useAuthStore.getState().resetLocalAuthState();
    complete(reply({ access_token: 'late-token', refresh_token: 'test-only', user: profile('owner') }));
    await pending;
    expect(useAuthStore.getState()).toMatchObject({ user: null, csrfToken: null, sessionVerified: false });
  });
  it('captures the access credential before clearing local state for logout-all', async () => {
    const revoke = vi.spyOn(logout, 'performLogout').mockResolvedValue();
    await useAuthStore.getState().logout(true);
    expect(revoke).toHaveBeenCalledWith({ allSessions: true, accessToken: 'test-token' });
    expect(useAuthStore.getState()).toMatchObject({ user: null, csrfToken: null, sessionVerified: false });
  });
});
