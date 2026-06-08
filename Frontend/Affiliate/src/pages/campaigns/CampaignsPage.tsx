import { useState, useEffect, useCallback } from 'react';
import * as api from '../../lib/api';
import type { CampaignInfo } from '../../types';
import { SkeletonTable } from '../../components/common/Skeleton';

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<CampaignInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [tag, setTag] = useState('');
  const [source, setSource] = useState('');
  const [creating, setCreating] = useState(false);

  const fetch = useCallback(async () => {
    try {
      const res = await api.getCampaigns();
      setCampaigns((res.campaigns ?? []) as CampaignInfo[]);
    } catch { }
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const handleCreate = async () => {
    if (!name.trim() || !tag.trim()) return;
    setCreating(true);
    try {
      await api.createCampaign({ name: name.trim(), tag: tag.trim(), source: source.trim() || undefined });
      setShowCreate(false);
      setName('');
      setTag('');
      setSource('');
      setLoading(true);
      fetch();
    } catch { }
    setCreating(false);
  };

  const totalClicks = campaigns.reduce((s, c) => s + c.clicks, 0);
  const totalSignups = campaigns.reduce((s, c) => s + c.signups, 0);
  const totalRevenue = campaigns.reduce((s, c) => s + c.revenue, 0);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text)' }}>Campaigns</h1>
        <button onClick={() => setShowCreate(true)} style={{
          padding: '8px 16px', background: 'var(--color-brand)', color: '#fff', border: 'none',
          borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
        }}>
          + New Campaign
        </button>
      </div>
      <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 24 }}>
        Track your campaign performance and UTMs
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
        {[
          { label: 'Total Clicks', value: totalClicks.toLocaleString() },
          { label: 'Total Signups', value: totalSignups.toLocaleString() },
          { label: 'Revenue Generated', value: `$${totalRevenue.toFixed(2)}` },
        ].map(s => (
          <div key={s.label} style={{
            background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', borderRadius: 10, padding: '16px 20px',
          }}>
            <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
              {s.label}
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--color-text)', letterSpacing: '-0.03em' }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {/* Create Campaign Modal */}
      {showCreate && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }} onClick={() => setShowCreate(false)}>
          <div style={{
            background: 'var(--color-bg-card)', border: '1px solid var(--color-border)',
            borderRadius: 12, padding: 24, width: 400, maxWidth: '90vw',
          }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text)', marginBottom: 16 }}>Create Campaign</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <input placeholder="Campaign Name" value={name} onChange={e => setName(e.target.value)}
                style={{ padding: '10px 12px', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 8, color: 'var(--color-text)', fontSize: 12 }} />
              <input placeholder="UTM Tag (e.g. spring24)" value={tag} onChange={e => setTag(e.target.value)}
                style={{ padding: '10px 12px', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 8, color: 'var(--color-text)', fontSize: 12 }} />
              <input placeholder="Source (optional)" value={source} onChange={e => setSource(e.target.value)}
                style={{ padding: '10px 12px', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 8, color: 'var(--color-text)', fontSize: 12 }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button onClick={() => setShowCreate(false)} style={{ padding: '8px 16px', background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 8, color: 'var(--color-text-secondary)', fontSize: 12, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={handleCreate} disabled={creating || !name.trim() || !tag.trim()} style={{
                padding: '8px 16px', background: !name.trim() || !tag.trim() ? 'var(--color-border)' : 'var(--color-brand)',
                border: 'none', borderRadius: 8, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: creating ? 0.7 : 1,
              }}>
                {creating ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{
        background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', borderRadius: 10, overflow: 'hidden',
      }}>
        {loading ? (
          <SkeletonTable rows={5} cols={8} />
        ) : campaigns.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: 12, fontStyle: 'italic' }}>
            No campaigns yet. Create one to start tracking.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', fontSize: 12, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-tertiary)' }}>
                  <th style={{ padding: '12px 16px', textAlign: 'left' }}>Tag</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left' }}>Source</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right' }}>Clicks</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right' }}>Signups</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right' }}>Trials</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right' }}>Active Subs</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right' }}>Conv. Rate</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right' }}>Revenue</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map(c => (
                  <tr key={c.tag} style={{ borderBottom: '1px solid var(--color-border)' }}
                    onMouseEnter={ev => { ev.currentTarget.style.background = 'var(--color-bg-hover)'; }}
                    onMouseLeave={ev => { ev.currentTarget.style.background = 'transparent'; }}
                  >
                    <td style={{ padding: '12px 16px', color: 'var(--color-brand)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                      {c.tag}
                    </td>
                    <td style={{ padding: '12px 16px', color: 'var(--color-text-secondary)' }}>
                      {c.source || '—'}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--color-text)', fontFamily: 'var(--font-mono)' }}>
                      {c.clicks.toLocaleString()}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--color-text)', fontFamily: 'var(--font-mono)' }}>
                      {c.signups.toLocaleString()}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--color-text)', fontFamily: 'var(--font-mono)' }}>
                      {c.trials.toLocaleString()}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--color-text)', fontFamily: 'var(--font-mono)' }}>
                      {c.activeSubscribers.toLocaleString()}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--color-text)' }}>
                      {(c.conversionRate * 100).toFixed(1)}%
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--color-success)' }}>
                      ${c.revenue.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
