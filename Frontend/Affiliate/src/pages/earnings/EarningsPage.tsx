import { useState, useEffect } from 'react';
import * as api from '../../lib/api';
import type { EarningRecord } from '../../types';
import { SkeletonTable } from '../../components/common/Skeleton';

export default function EarningsPage() {
  const [earnings, setEarnings] = useState<EarningRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getEarnings()
      .then(res => setEarnings(res.earnings as EarningRecord[] ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const total = earnings.reduce((s, e) => s + e.amount, 0);
  const thisMonth = earnings
    .filter(e => {
      const d = new Date(e.date);
      const now = new Date();
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    })
    .reduce((s, e) => s + e.amount, 0);

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text)', marginBottom: 4 }}>Earnings</h1>
      <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 24 }}>
        Track your commissions and payouts
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
        {[
          { label: 'Total Earned', value: `$${total.toFixed(2)}` },
          { label: 'This Month', value: `$${thisMonth.toFixed(2)}` },
          { label: 'Transactions', value: earnings.length.toString() },
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

      <div style={{
        background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', borderRadius: 10, overflow: 'hidden',
      }}>
        {loading ? (
          <SkeletonTable rows={5} cols={4} />
        ) : earnings.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: 12, fontStyle: 'italic' }}>
            No earnings recorded yet.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', fontSize: 12, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-tertiary)' }}>
                  <th style={{ padding: '12px 16px', textAlign: 'left' }}>Date</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left' }}>Source</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left' }}>Note</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {earnings.map((e, i) => (
                  <tr key={e.id || i} style={{ borderBottom: '1px solid var(--color-border)' }}
                    onMouseEnter={ev => { ev.currentTarget.style.background = 'var(--color-bg-hover)'; }}
                    onMouseLeave={ev => { ev.currentTarget.style.background = 'transparent'; }}
                  >
                    <td style={{ padding: '12px 16px', color: 'var(--color-text)' }}>
                      {new Date(e.date).toLocaleDateString()}
                    </td>
                    <td style={{ padding: '12px 16px', color: 'var(--color-text-secondary)' }}>
                      {e.source || '—'}
                    </td>
                    <td style={{ padding: '12px 16px', color: 'var(--color-text-secondary)' }}>
                      {e.note || '—'}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--color-success)' }}>
                      +${e.amount.toFixed(2)}
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
