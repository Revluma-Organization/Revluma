import { useState, useEffect } from 'react';
import * as api from '../../lib/api';
import type { WithdrawalRequest } from '../../types';
import { SkeletonTable } from '../../components/common/Skeleton';

export default function BillingSettings() {
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getWithdrawals()
      .then(res => setWithdrawals((res.withdrawals ?? []) as WithdrawalRequest[]))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const totalPaid = withdrawals.filter(w => w.status === 'Paid').reduce((s, w) => s + w.amountUsd, 0);
  const pendingPayouts = withdrawals.filter(w => w.status === 'Pending Review' || w.status === 'Under Verification' || w.status === 'Approved' || w.status === 'Processing').reduce((s, w) => s + w.amountUsd, 0);

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text)', marginBottom: 4 }}>Billing & Payouts</h1>
      <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 24 }}>
        Payout history and withdrawal information
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, marginBottom: 24 }}>
        <div style={{
          background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', borderRadius: 10, padding: '16px 20px',
        }}>
          <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
            Total Paid
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--color-success)', letterSpacing: '-0.03em' }}>
            ${totalPaid.toFixed(2)}
          </div>
        </div>
        <div style={{
          background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', borderRadius: 10, padding: '16px 20px',
        }}>
          <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
            Pending Payouts
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--color-text)', letterSpacing: '-0.03em' }}>
            ${pendingPayouts.toFixed(2)}
          </div>
        </div>
      </div>

      <div style={{
        background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', borderRadius: 10, overflow: 'hidden',
      }}>
        {loading ? (
          <SkeletonTable rows={5} cols={4} />
        ) : withdrawals.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: 12, fontStyle: 'italic' }}>
            No withdrawal history yet.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', fontSize: 12, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-tertiary)' }}>
                  <th style={{ padding: '12px 16px', textAlign: 'left' }}>Date</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right' }}>Amount</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left' }}>Method</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {withdrawals.map(w => (
                  <tr key={w.id} style={{ borderBottom: '1px solid var(--color-border)' }}
                    onMouseEnter={ev => { ev.currentTarget.style.background = 'var(--color-bg-hover)'; }}
                    onMouseLeave={ev => { ev.currentTarget.style.background = 'transparent'; }}
                  >
                    <td style={{ padding: '12px 16px', color: 'var(--color-text)' }}>
                      {w.createdAt ? new Date(w.createdAt).toLocaleDateString() : '—'}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--color-text)' }}>
                      ${w.amountUsd.toFixed(2)}
                    </td>
                    <td style={{ padding: '12px 16px', color: 'var(--color-text-secondary)' }}>
                      {w.payoutMethod === 'paypal' ? 'PayPal' : 'Bank Transfer'}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{
                        padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600,
                        background: w.status === 'Paid' ? 'var(--color-success-bg)' : 'var(--color-bg-active)',
                        color: w.status === 'Paid' ? 'var(--color-success)' : 'var(--color-text-secondary)',
                      }}>
                        {w.status}
                      </span>
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
