import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import * as api from '../../lib/api';
import type { PartnerProfile, WithdrawalRequest, FounderBroadcast, ApprovalStatus, WithdrawalRequestStatus } from '../../types';

type AdminTab = 'approvals' | 'users' | 'broadcasts' | 'system' | 'withdrawals';

const tabs: { key: AdminTab; label: string }[] = [
  { key: 'approvals', label: 'Vetting Approvals' },
  { key: 'users', label: 'Affiliate Database' },
  { key: 'broadcasts', label: 'Bulletins' },
  { key: 'withdrawals', label: 'Payouts Queue' },
  { key: 'system', label: 'Ledger KPIs' },
];

function btnStyle(active: boolean): React.CSSProperties {
  return {
    width: '100%',
    padding: '12px 16px',
    borderRadius: 10,
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    fontFamily: 'var(--font-mono)',
    textAlign: 'left',
    cursor: 'pointer',
    border: 'none',
    background: active ? 'var(--color-bg-card)' : 'transparent',
    color: active ? 'var(--color-text)' : 'var(--color-text-tertiary)',
    borderBottom: active ? '1px solid var(--color-border)' : '1px solid transparent',
    transition: 'all var(--transition-fast)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  };
}

export default function AdminPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<AdminTab>('approvals');
  const [profiles, setProfiles] = useState<PartnerProfile[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [broadcasts, setBroadcasts] = useState<FounderBroadcast[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [wRes, pRes] = await Promise.allSettled([
        api.getWithdrawals(),
        fetch('/api/affiliate/admin/list', { credentials: 'include' }).then(r => r.ok ? r.json() : { affiliates: [] }),
      ]);
      if (wRes.status === 'fulfilled') {
        setWithdrawals(wRes.value.withdrawals as WithdrawalRequest[]);
      }
      if (pRes.status === 'fulfilled' && pRes.value.affiliates) {
        setProfiles(pRes.value.affiliates.map((a: any) => ({
          id: a.id ?? a.userId ?? '',
          username: a.username ?? '',
          fullName: a.fullName ?? a.full_name ?? '',
          email: a.email ?? '',
          avatarUrl: a.avatarUrl ?? null,
          tier: a.tier ?? a.membershipTier ?? 'Affiliate',
          role: a.role ?? 'affiliate',
          commissionRate: a.commissionRate ?? 0.20,
          referralCode: a.referralCode ?? '',
          country: a.country ?? '',
          phoneNumber: a.phoneNumber ?? '',
          audienceNiche: a.audienceNiche ?? '',
          audienceSize: a.audienceSize ?? '',
          affiliateExperience: a.affiliateExperience ?? '',
          whyJoin: a.whyJoin ?? '',
          twitterHandle: a.twitterHandle ?? undefined,
          linkedinProfile: a.linkedinProfile ?? a.linkedInProfile ?? undefined,
          status: a.status ?? 'pending',
          createdAt: a.createdAt ?? '',
        })));
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleStatus = async (id: string, status: ApprovalStatus) => {
    try {
      await api.updateAffiliateStatus(id, status);
      setProfiles(prev => prev.map(p => p.id === id ? { ...p, status } : p));
    } catch { /* ignore */ }
  };

  const handleRole = async (id: string, role: 'user' | 'admin' | 'affiliate') => {
    try {
      await api.updateAffiliateRole(id, role);
      setProfiles(prev => prev.map(p => p.id === id ? { ...p, role } : p));
    } catch { /* ignore */ }
  };

  const handleAddBroadcast = (title: string, content: string) => {
    const newBc: FounderBroadcast = {
      id: `bc_${Date.now()}`,
      title,
      content,
      date: new Date().toISOString(),
      author: user?.fullName ?? 'Admin',
    };
    setBroadcasts(prev => [newBc, ...prev]);
  };

  const handleWithdrawalUpdate = async (id: string, status: WithdrawalRequestStatus, notes?: string) => {
    try {
      await fetch(`/api/affiliate/admin/withdrawals/${id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, adminNotes: notes }),
      });
      setWithdrawals(prev => prev.map(w => w.id === id ? { ...w, status, adminNotes: notes } : w));
    } catch { /* ignore */ }
  };

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-text)', marginBottom: 4 }}>
          Supervisor Control Console
        </h1>
        <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
          Luminor Internal Operations Command
        </p>
      </div>

      {/* Tab bar */}
      <div style={{
        display: 'flex',
        gap: 4,
        marginBottom: 24,
        borderBottom: '1px solid var(--color-border)',
        paddingBottom: 0,
      }}>
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '10px 16px',
              fontWeight: activeTab === tab.key ? 600 : 450,
              color: activeTab === tab.key ? 'var(--color-text)' : 'var(--color-text-tertiary)',
              cursor: 'pointer',
              border: 'none',
              borderBottom: activeTab === tab.key ? '2px solid var(--color-brand)' : '2px solid transparent',
              background: 'transparent',
              transition: 'all var(--transition-fast)',
              fontFamily: 'var(--font-mono)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              fontSize: 10,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--color-text-tertiary)', fontSize: 12 }}>
          Loading...
        </div>
      ) : (
        <>
          {activeTab === 'approvals' && (
            <ApprovalsTab profiles={profiles} onStatus={handleStatus} />
          )}
          {activeTab === 'users' && (
            <UsersTab profiles={profiles} onRole={handleRole} />
          )}
          {activeTab === 'broadcasts' && (
            <BroadcastsTab
              broadcasts={broadcasts}
              onAdd={handleAddBroadcast}
            />
          )}
          {activeTab === 'withdrawals' && (
            <WithdrawalsTab
              withdrawals={withdrawals}
              onUpdate={handleWithdrawalUpdate}
            />
          )}
          {activeTab === 'system' && <SystemTab />}
        </>
      )}
    </div>
  );
}

/* ───── Approvals Tab ───── */
function ApprovalsTab({ profiles, onStatus }: {
  profiles: PartnerProfile[];
  onStatus: (id: string, s: ApprovalStatus) => void;
}) {
  const pending = profiles.filter(p => (p.status ?? '').toLowerCase() === 'pending');
  if (pending.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 60, color: 'var(--color-text-tertiary)', fontSize: 12, fontStyle: 'italic' }}>
        All vetting requests cleared. System idle.
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {pending.map(p => (
        <div key={p.id} style={{
          background: 'var(--color-bg-card)',
          border: '1px solid var(--color-border)',
          borderRadius: 10,
          padding: 20,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', marginBottom: 2 }}>
                {p.fullName}
                <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', marginLeft: 8, fontFamily: 'var(--font-mono)' }}>
                  @{p.username}
                </span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                {p.email}
                {p.country ? ` | ${p.country}` : ''}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => onStatus(p.id, 'approved')} style={{
                padding: '6px 14px',
                borderRadius: 6,
                fontSize: 10,
                fontWeight: 600,
                fontFamily: 'var(--font-mono)',
                color: 'var(--color-success)',
                background: 'var(--color-success-bg)',
                border: '1px solid transparent',
                cursor: 'pointer',
                transition: 'all var(--transition-fast)',
              }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-success)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'transparent'; }}
              >
                Approve
              </button>
              <button onClick={() => onStatus(p.id, 'rejected')} style={{
                padding: '6px 14px',
                borderRadius: 6,
                fontSize: 10,
                fontWeight: 600,
                fontFamily: 'var(--font-mono)',
                color: 'var(--color-error)',
                background: 'var(--color-error-bg)',
                border: '1px solid transparent',
                cursor: 'pointer',
                transition: 'all var(--transition-fast)',
              }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-error)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'transparent'; }}
              >
                Decline
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 12 }}>
            <div>
              <span style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-tertiary)', display: 'block', marginBottom: 2, fontFamily: 'var(--font-mono)' }}>
                Niche & Audience
              </span>
              {p.audienceNiche} ({p.audienceSize})
            </div>
            <div>
              <span style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-tertiary)', display: 'block', marginBottom: 2, fontFamily: 'var(--font-mono)' }}>
                Experience
              </span>
              {p.affiliateExperience || 'N/A'}
            </div>
            <div>
              <span style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-tertiary)', display: 'block', marginBottom: 2, fontFamily: 'var(--font-mono)' }}>
                Social
              </span>
              {p.twitterHandle ? `X: ${p.twitterHandle} ` : ''}{p.linkedinProfile ? 'LinkedIn: Yes' : ''}
            </div>
          </div>

          {p.whyJoin && (
            <div style={{
              background: 'var(--color-bg-inset)',
              borderRadius: 8,
              padding: 12,
              fontSize: 11,
              color: 'var(--color-text-secondary)',
              fontStyle: 'italic',
            }}>
              <span style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-tertiary)', display: 'block', marginBottom: 4, fontStyle: 'normal', fontFamily: 'var(--font-mono)' }}>
                Why Join
              </span>
              &ldquo;{p.whyJoin}&rdquo;
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ───── Users Tab ───── */
function UsersTab({ profiles, onRole }: {
  profiles: PartnerProfile[];
  onRole: (id: string, r: 'user' | 'admin' | 'affiliate') => void;
}) {
  return (
    <div style={{
      background: 'var(--color-bg-card)',
      border: '1px solid var(--color-border)',
      borderRadius: 10,
      overflow: 'hidden',
    }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--color-border)', fontSize: 9, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-tertiary)' }}>
              <th style={{ padding: '12px 16px', textAlign: 'left' }}>Name</th>
              <th style={{ padding: '12px 16px', textAlign: 'left' }}>Username</th>
              <th style={{ padding: '12px 16px', textAlign: 'left' }}>Tier</th>
              <th style={{ padding: '12px 16px', textAlign: 'left' }}>Commission</th>
              <th style={{ padding: '12px 16px', textAlign: 'left' }}>Status</th>
              <th style={{ padding: '12px 16px', textAlign: 'left' }}>Role</th>
              <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody style={{ color: 'var(--color-text-secondary)' }}>
            {profiles.map(p => (
              <tr key={p.id} style={{ borderBottom: '1px solid var(--color-border)' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-hover)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
              >
                <td style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--color-text)' }}>{p.fullName}</td>
                <td style={{ padding: '12px 16px', fontFamily: 'var(--font-mono)' }}>@{p.username}</td>
                <td style={{ padding: '12px 16px' }}>{p.tier}</td>
                <td style={{ padding: '12px 16px', fontFamily: 'var(--font-mono)' }}>{(p.commissionRate * 100)}%</td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{
                    padding: '2px 8px',
                    borderRadius: 4,
                    fontSize: 9,
                    fontWeight: 600,
                    fontFamily: 'var(--font-mono)',
                    background: p.status === 'approved' ? 'var(--color-success-bg)' :
                      p.status === 'rejected' ? 'var(--color-error-bg)' :
                      'var(--color-bg-active)',
                    color: p.status === 'approved' ? 'var(--color-success)' :
                      p.status === 'rejected' ? 'var(--color-error)' :
                      'var(--color-text-tertiary)',
                  }}>
                    {(p.status ?? '').toUpperCase()}
                  </span>
                </td>
                <td style={{ padding: '12px 16px', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', fontSize: 10 }}>{p.role}</td>
                <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                  {p.role !== 'admin' ? (
                    <button onClick={() => onRole(p.id, 'admin')} style={{
                      padding: '4px 10px',
                      borderRadius: 4,
                      fontSize: 9,
                      fontFamily: 'var(--font-mono)',
                      cursor: 'pointer',
                      border: '1px solid var(--color-border)',
                      background: 'transparent',
                      color: 'var(--color-text-secondary)',
                      transition: 'all var(--transition-fast)',
                    }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-hover)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                    >
                      Make Admin
                    </button>
                  ) : (
                    <button onClick={() => onRole(p.id, 'affiliate')} style={{
                      padding: '4px 10px',
                      borderRadius: 4,
                      fontSize: 9,
                      fontFamily: 'var(--font-mono)',
                      cursor: 'pointer',
                      border: '1px solid var(--color-border)',
                      background: 'transparent',
                      color: 'var(--color-text-tertiary)',
                      transition: 'all var(--transition-fast)',
                    }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-hover)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                    >
                      Set Affiliate
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ───── Broadcasts Tab ───── */
function BroadcastsTab({ broadcasts, onAdd }: {
  broadcasts: FounderBroadcast[];
  onAdd: (title: string, content: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [status, setStatus] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) {
      setStatus('Title and content required');
      return;
    }
    onAdd(title, content);
    setTitle('');
    setContent('');
    setStatus('Broadcast dispatched.');
    setTimeout(() => setStatus(''), 3000);
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
      <div style={{
        background: 'var(--color-bg-card)',
        border: '1px solid var(--color-border)',
        borderRadius: 10,
        padding: 20,
      }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 16 }}>
          New Broadcast
        </h3>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 10, fontWeight: 500, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 4 }}>
              Title
            </label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Revluma Q2 Update"
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg-inset)',
                color: 'var(--color-text)',
                fontSize: 12,
                outline: 'none',
              }}
            />
          </div>
          <div>
            <label style={{ fontSize: 10, fontWeight: 500, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 4 }}>
              Content
            </label>
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              rows={5}
              placeholder="Write your broadcast..."
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg-inset)',
                color: 'var(--color-text)',
                fontSize: 12,
                outline: 'none',
                resize: 'vertical',
                fontFamily: 'inherit',
              }}
            />
          </div>
          <button type="submit" style={{
            padding: '10px 16px',
            borderRadius: 8,
            fontSize: 11,
            fontWeight: 600,
            color: '#fff',
            background: 'var(--color-brand)',
            border: 'none',
            cursor: 'pointer',
            transition: 'opacity var(--transition-fast)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
            onMouseEnter={e => { e.currentTarget.style.opacity = '0.9'; }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
          >
            Dispatch
          </button>
          {status && (
            <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', padding: '8px 12px', borderRadius: 6, background: 'var(--color-bg-hover)' }}>
              {status}
            </div>
          )}
        </form>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 4 }}>
          Previous Broadcasts ({broadcasts.length})
        </h3>
        {broadcasts.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
            No broadcasts yet.
          </div>
        ) : (
          broadcasts.map(b => (
            <div key={b.id} style={{
              background: 'var(--color-bg-card)',
              border: '1px solid var(--color-border)',
              borderRadius: 8,
              padding: 14,
            }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)', marginBottom: 4 }}>
                {b.title}
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 6 }}>
                {b.content}
              </div>
              <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                {b.author} &middot; {b.date ? new Date(b.date).toLocaleDateString() : ''}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ───── Withdrawals Tab ───── */
function WithdrawalsTab({ withdrawals, onUpdate }: {
  withdrawals: WithdrawalRequest[];
  onUpdate: (id: string, status: WithdrawalRequestStatus, notes?: string) => void;
}) {
  const [notesMap, setNotesMap] = useState<Record<string, string>>({});
  const [editNotes, setEditNotes] = useState<string | null>(null);

  const pending = withdrawals.filter(w => w.status === 'Pending Review' || w.status === 'Under Verification');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {pending.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--color-text-tertiary)', fontSize: 12, fontStyle: 'italic' }}>
          All withdrawal requests processed.
        </div>
      ) : (
        pending.map(w => (
          <div key={w.id} style={{
            background: 'var(--color-bg-card)',
            border: '1px solid var(--color-border)',
            borderRadius: 10,
            padding: 16,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 2 }}>
                  ${w.amountUsd.toFixed(2)} — {w.payoutMethod === 'paypal' ? 'PayPal' : 'Bank Transfer'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                  {w.payoutEmail || w.accountNumber || ''} {w.country ? `(${w.country})` : ''}
                </div>
              </div>
              <span style={{
                padding: '2px 8px',
                borderRadius: 4,
                fontSize: 9,
                fontWeight: 600,
                fontFamily: 'var(--font-mono)',
                background: w.status === 'Pending Review' ? 'var(--color-warning-bg)' : 'var(--color-info-bg)',
                color: w.status === 'Pending Review' ? 'var(--color-warning)' : 'var(--color-info)',
              }}>
                {w.status}
              </span>
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              {(['Approved', 'Rejected'] as WithdrawalRequestStatus[]).map(action => (
                <button
                  key={action}
                  onClick={() => onUpdate(w.id, action, notesMap[w.id])}
                  style={{
                    padding: '4px 12px',
                    borderRadius: 4,
                    fontSize: 10,
                    fontWeight: 600,
                    fontFamily: 'var(--font-mono)',
                    cursor: 'pointer',
                    border: '1px solid transparent',
                    background: action === 'Approved' ? 'var(--color-success-bg)' : 'var(--color-error-bg)',
                    color: action === 'Approved' ? 'var(--color-success)' : 'var(--color-error)',
                    transition: 'all var(--transition-fast)',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = action === 'Approved' ? 'var(--color-success)' : 'var(--color-error)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'transparent'; }}
                >
                  {action === 'Approved' ? 'Approve' : 'Reject'}
                </button>
              ))}
              {editNotes === w.id ? (
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <input
                    value={notesMap[w.id] ?? ''}
                    onChange={e => setNotesMap(prev => ({ ...prev, [w.id]: e.target.value }))}
                    placeholder="Admin notes..."
                    style={{
                      padding: '4px 8px',
                      borderRadius: 4,
                      fontSize: 10,
                      border: '1px solid var(--color-border)',
                      background: 'var(--color-bg-inset)',
                      color: 'var(--color-text)',
                      outline: 'none',
                      width: 160,
                    }}
                  />
                  <button onClick={() => setEditNotes(null)} style={{ fontSize: 10, color: 'var(--color-text-tertiary)', cursor: 'pointer', border: 'none', background: 'none' }}>
                    Done
                  </button>
                </div>
              ) : (
                <button onClick={() => setEditNotes(w.id)} style={{
                  padding: '4px 8px',
                  borderRadius: 4,
                  fontSize: 10,
                  cursor: 'pointer',
                  border: '1px solid var(--color-border)',
                  background: 'transparent',
                  color: 'var(--color-text-tertiary)',
                }}>
                  {w.adminNotes ? 'Edit Note' : 'Add Note'}
                </button>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

/* ───── System Tab ───── */
function SystemTab() {
  return (
    <div style={{
      background: 'var(--color-bg-card)',
      border: '1px solid var(--color-border)',
      borderRadius: 10,
      padding: 24,
    }}>
      <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 16 }}>
        System Overview
      </h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <SystemStat label="Database" value="Postgres sync active" status="success" />
        <SystemStat label="RLS Policies" value="6 policies verified" status="success" />
        <SystemStat label="API Status" value="Operational" status="success" />
        <SystemStat label="Storage Buckets" value="Avatar, Assets" status="success" />
      </div>
    </div>
  );
}

function SystemStat({ label, value, status }: { label: string; value: string; status: 'success' | 'warning' | 'error' }) {
  const dotColor = status === 'success' ? 'var(--color-success)' : status === 'warning' ? 'var(--color-warning)' : 'var(--color-error)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, background: 'var(--color-bg-inset)' }}>
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
      <div>
        <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {label}
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
          {value}
        </div>
      </div>
    </div>
  );
}
