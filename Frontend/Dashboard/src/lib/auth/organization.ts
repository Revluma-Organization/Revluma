export interface ProfileMembership {
  id: string;
  role: string;
  organization_id: string;
  status?: string;
  joined_at: string | null;
  organizations: { id: string; company_name: string };
}

export function resolveProfileMembership(
  memberships: ProfileMembership[],
  activeOrganizationId: string | null | undefined,
): ProfileMembership | undefined {
  const active = memberships.filter(member => member.status === undefined || member.status === 'active');
  if (activeOrganizationId) return active.find(member => member.organization_id === activeOrganizationId);
  // An explicit null means the server requires workspace selection.
  if (activeOrganizationId === undefined && active.length === 1) return active[0];
  return undefined;
}

// This is a selection hint, never authorisation; the backend revalidates membership.
export function storedOrganizationId(): string | undefined {
  try {
    for (const storage of [localStorage, sessionStorage]) {
      const state = JSON.parse(storage.getItem('rv-auth') || 'null')?.state;
      const user = state?.user;
      const id = user?.tenant_id || user?.active_organization_id;
      if (typeof id === 'string' && id) return id;
      const token = state?.accessToken || state?.csrfToken;
      if (typeof token === 'string') {
        try {
          const claims = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
          if (typeof claims.tenantId === 'string' && claims.tenantId) return claims.tenantId;
        } catch { /* Malformed legacy tokens cannot select a workspace. */ }
      }
    }
  } catch { /* A missing selection requires server-side resolution. */ }
  return undefined;
}

let tokenChanged: ((accessToken: string) => void) | undefined;
export function onSessionTokenChanged(handler: (accessToken: string) => void): void {
  tokenChanged = handler;
}
export function notifySessionTokenChanged(accessToken: string): void {
  tokenChanged?.(accessToken);
}

let sessionGeneration = 0;
let synchroniseSession: (() => void) | undefined;
export function invalidateSession(): void { sessionGeneration += 1; }
export function currentSessionGeneration(): number { return sessionGeneration; }
export function onSessionSynchronisation(handler: () => void): void { synchroniseSession = handler; }
export function assertCurrentSession(generation: number): void {
  synchroniseSession?.();
  if (generation !== sessionGeneration) throw new Error('Session changed; please retry in the current workspace.');
}
