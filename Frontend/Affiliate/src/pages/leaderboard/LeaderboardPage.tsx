import { useState, useEffect } from 'react';
import * as api from '../../lib/api';
import type { LeaderboardUser } from '../../types';
import { SkeletonTable } from '../../components/common/Skeleton';

const tierColors: Record<string, string> = {
  Affiliate: 'var(--color-text-tertiary)',
  Growth: 'var(--color-brand)',
  Elite: 'var(--color-success)',
  Ambassador: '#a855f7',
};

export default function LeaderboardPage() {
  const [users, setUsers] = useState<LeaderboardUser[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getLeaderboard()
      .then(res => setUsers((res.leaderboard ?? []) as LeaderboardUser[]))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text)', marginBottom: 4 }}>Leaderboard</h1>
      <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 24 }}>
        Top-performing affiliates this period
      </p>

      <div style={{
        background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', borderRadius: 10, overflow: 'hidden',
      }}>
        {loading ? (
          <SkeletonTable rows={8} cols={5} />
        ) : users.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: 12, fontStyle: 'italic' }}>
            Leaderboard data coming soon.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', fontSize: 12, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-tertiary)' }}>
                  <th style={{ padding: '12px 16px', textAlign: 'left', width: 60 }}>Rank</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left' }}>Partner</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left' }}>Tier</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right' }}>Referrals</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right' }}>Revenue</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u, i) => (
                  <tr key={u.username} style={{ borderBottom: '1px solid var(--color-border)' }}
                    onMouseEnter={ev => { ev.currentTarget.style.background = 'var(--color-bg-hover)'; }}
                    onMouseLeave={ev => { ev.currentTarget.style.background = 'transparent'; }}
                  >
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: 24, height: 24, borderRadius: '50%',
                        background: i === 0 ? '#ffd700' : i === 1 ? '#c0c0c0' : i === 2 ? '#cd7f32' : 'var(--color-bg)',
                        color: i < 3 ? '#000' : 'var(--color-text)',
                        fontSize: 11, fontWeight: 700,
                      }}>
                        {i + 1}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', color: 'var(--color-text)', fontWeight: 600 }}>
                      {u.username}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      {u.tier && (
                        <span style={{
                          padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600,
                          background: `${tierColors[u.tier] ?? 'var(--color-bg)'}20`,
                          color: tierColors[u.tier] ?? 'var(--color-text)',
                        }}>
                          {u.tier}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--color-text)', fontFamily: 'var(--font-mono)' }}>
                      {u.referralsCount}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--color-success)' }}>
                      ${u.revenueGenerated.toFixed(2)}
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
