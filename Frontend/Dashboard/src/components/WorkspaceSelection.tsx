import { useState, type FormEvent } from 'react';
import { useAuthStore } from '@/store/authStore';

export function WorkspaceSelection({ compact = false }: { compact?: boolean }) {
  const user = useAuthStore(state => state.user);
  const selectWorkspace = useAuthStore(state => state.selectWorkspace);
  const [selected, setSelected] = useState(user?.tenant_id || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const memberships = user?.organization_memberships || [];
  if (compact && memberships.length < 2) return null;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selected || saving) return;
    setSaving(true); setError('');
    try {
      await selectWorkspace(selected);
      // Remount all tenant-specific views and discard previous workspace caches.
      window.location.reload();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to select workspace.');
      setSaving(false);
    }
  }
  return <form onSubmit={submit} className={compact ? 'flex max-w-xs flex-wrap items-center gap-2' : 'mx-auto max-w-lg space-y-4 p-8 text-t1'}>
    {!compact && <><h1 className="text-xl font-semibold">Select your workspace</h1><p className="text-sm text-t2">Permissions are checked separately for each organisation.</p></>}
    {memberships.length ? <>
      <label className="sr-only" htmlFor={compact ? 'workspace-topbar' : 'workspace-selection'}>Active workspace</label>
      <select id={compact ? 'workspace-topbar' : 'workspace-selection'} value={selected} onChange={event => setSelected(event.target.value)} disabled={saving} className="min-w-0 max-w-44 rounded border border-border bg-bg-2 p-2 text-sm text-t1">
        <option value="" disabled>Select workspace</option>
        {memberships.map(member => <option key={member.id} value={member.organization_id}>{member.organizations.company_name} · {member.role}</option>)}
      </select>
      <button disabled={!selected || saving || selected === user?.tenant_id} className="rounded border border-border bg-bg-3 p-2 text-sm text-t1 disabled:opacity-50">{saving ? 'Checking…' : 'Open workspace'}</button>
    </> : <p role="status" className="text-sm text-t2">No active organisation membership is available. Ask your workspace owner to review your access.</p>}
    {error && <p role="alert" className="w-full text-sm text-red-700 dark:text-red-300">{error}</p>}
  </form>;
}
