import { useState, useEffect } from 'react';
import * as api from '../../lib/api';
import type { ReferredUser } from '../../types';
import { SkeletonTable, SkeletonStats } from '../../components/common/Skeleton';

export default function ReferralsPage() {
  const [referrals, setReferrals] = useState<ReferredUser[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getReferrals()
      .then(res => setReferrals(res.referrals as ReferredUser[] ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const totalMonthly = referrals.reduce((s, r) => s + r.monthlyValue, 0);
  const totalLifetime = referrals.reduce((s, r) => s + r.lifetimeValue, 0);
  const active = referrals.filter(r => r.status === 'active' || r.planName);
  const pending = referrals.filter(r => r.status === 'pending');

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text)', marginBottom: 4 }}>Referrals</h1>
      <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 24 }}>
        Track your referred partners and their status
      </p>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        {[
          { label: 'Total Referrals', value: referrals.length.toString() },
          { label: 'Active', value: active.length.toString() },
          { label: 'Monthly Value', value: `$${totalMonthly.toFixed(2)}` },
          { label: 'Lifetime Value', value: `$${totalLifetime.toFixed(2)}` },
        ].map(s => (
          <div key={s.label} style={{
            background: 'var(--color-bg-card)',
            border: '1px solid var(--color-border)',
            borderRadius: 10,
            padding: '16px 20px',
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

      {/* Table */}
      <div style={{
        background: 'var(--color-bg-card)',
        border: '1px solid var(--color-border)',
        borderRadius: 10,
        overflow: 'hidden',
      }}>
        {loading ? (
          <SkeletonTable rows={5} cols={6} />
        ) : referrals.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: 12, fontStyle: 'italic' }}>
            No referrals yet. Share your referral link to get started.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', fontSize: 10, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-tertiary)' }}>
                  <th style={{ padding: '12px 16px', textAlign: 'left' }}>Email</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left' }}>Signed Up</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left' }}>Status</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left' }}>Plan</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right' }}>Monthly</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right' }}>Lifetime</th>
                </tr>
              </thead>
              <tbody>
                {referrals.map(r => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border)' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-hover)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <td style={{ padding: '12px 16px', color: 'var(--color-text)', fontFamily: 'var(--font-mono)' }}>
                      {r.emailMasked}
                    </td>
                    <td style={{ padding: '12px 16px', color: 'var(--color-text-secondary)' }}>
                      {new Date(r.signupDate).toLocaleDateString()}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{
                        padding: '2px 8px',
                        borderRadius: 4,
                        fontSize: 10,
                        fontWeight: 600,
                        fontFamily: 'var(--font-mono)',
                        background: (r.planName || r.status === 'active') ? 'var(--color-success-bg)' : 'var(--color-bg-active)',
                        color: (r.planName || r.status === 'active') ? 'var(--color-success)' : 'var(--color-text-tertiary)',
                      }}>
                        {r.planName ? 'Active' : r.status}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', color: 'var(--color-text-secondary)' }}>
                      {r.planName || '—'}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--color-text)', fontFamily: 'var(--font-mono)' }}>
                      ${r.monthlyValue.toFixed(2)}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--color-text)', fontFamily: 'var(--font-mono)' }}>
                      ${r.lifetimeValue.toFixed(2)}
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
