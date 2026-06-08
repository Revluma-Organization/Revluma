import { useAuth } from '../../hooks/useAuth';

export default function AccountSettings() {
  const { profile } = useAuth();

  const details = [
    { label: 'Email', value: profile?.email ?? '—' },
    { label: 'Country', value: profile?.country ?? '—' },
    { label: 'Phone', value: profile?.phoneNumber ?? '—' },
    { label: 'Member Since', value: profile?.createdAt ? new Date(profile.createdAt).toLocaleDateString() : '—' },
    { label: 'Tier', value: profile?.tier ?? profile?.membershipTier ?? '—' },
    { label: 'Commission Rate', value: profile?.commissionRate ? `${(profile.commissionRate * 100).toFixed(0)}%` : '—' },
  ];

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text)', marginBottom: 4 }}>Account</h1>
      <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 24 }}>
        Account details and overview
      </p>

      <div style={{
        background: 'var(--color-bg-card)', border: '1px solid var(--color-border)',
        borderRadius: 10, overflow: 'hidden', maxWidth: 560,
      }}>
        {details.map(d => (
          <div key={d.label} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '14px 20px', borderBottom: '1px solid var(--color-border)',
          }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-secondary)' }}>
              {d.label}
            </span>
            <span style={{ fontSize: 12, color: 'var(--color-text)', fontFamily: 'var(--font-mono)' }}>
              {d.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
