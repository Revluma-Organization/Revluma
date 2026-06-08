import { useAuth } from '../../hooks/useAuth';
import { getTierInfo, TIER_INFORMATION } from '../../types';

export default function DashboardHome() {
  const { user } = useAuth();

  if (!user) return null;

  const tierInfo = getTierInfo(user.tier);
  const nextTier = TIER_INFORMATION.find(t => t.minReferrals > (tierInfo?.minReferrals ?? 0));

  return (
    <div>
      {/* Page header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{
          fontSize: 22,
          fontWeight: 700,
          color: 'var(--color-text)',
          letterSpacing: '-0.02em',
          marginBottom: 4,
        }}>
          Welcome back, {user.fullName || user.username}
        </h1>
        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
          Here's your affiliate performance overview
        </p>
      </div>

      {/* Stats row */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 16,
        marginBottom: 32,
      }}>
        {[
          { label: 'Total Referrals', value: '0', sub: 'All time' },
          { label: 'Active Referrals', value: '0', sub: 'Paying accounts' },
          { label: 'Commission Rate', value: `${(tierInfo?.commissionRate ?? 0.20) * 100}%`, sub: user.tier },
          { label: 'Total Earned', value: '$0.00', sub: 'Lifetime' },
        ].map((stat) => (
          <div
            key={stat.label}
            style={{
              background: 'var(--color-bg-card)',
              border: '1px solid var(--color-border)',
              borderRadius: 10,
              padding: '16px 20px',
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
              {stat.label}
            </div>
            <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--color-text)', letterSpacing: '-0.03em', marginBottom: 2 }}>
              {stat.value}
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
              {stat.sub}
            </div>
          </div>
        ))}
      </div>

      {/* Tier Progress + Next Tier */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 16,
        marginBottom: 32,
      }}>
        {/* Current Tier card */}
        <div style={{
          background: 'var(--color-bg-card)',
          border: '1px solid var(--color-border)',
          borderRadius: 10,
          padding: 24,
        }}>
          <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16 }}>
            Current Tier
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-text)', marginBottom: 4 }}>
            {user.tier}
          </div>
          <div style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 16 }}>
            {tierInfo?.description}
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-tertiary)', marginBottom: 12 }}>
            Rewards
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {tierInfo?.rewards.map((reward, i) => (
              <li key={i} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 12,
                color: 'var(--color-text-secondary)',
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {reward}
              </li>
            ))}
          </ul>
        </div>

        {/* Next Tier card */}
        <div style={{
          background: 'var(--color-bg-card)',
          border: '1px solid var(--color-border)',
          borderRadius: 10,
          padding: 24,
        }}>
          {nextTier ? (
            <>
              <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16 }}>
                Next Tier
              </div>
              <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-text)', marginBottom: 4 }}>
                {nextTier.name}
              </div>
              <div style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 16 }}>
                {nextTier.description}
              </div>
              <div style={{
                background: 'var(--color-bg-hover)',
                borderRadius: 8,
                padding: 12,
                marginBottom: 12,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>Progress</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)' }}>0 / {nextTier.minReferrals}</span>
                </div>
                <div style={{
                  width: '100%',
                  height: 6,
                  background: 'var(--color-bg-active)',
                  borderRadius: 3,
                  overflow: 'hidden',
                }}>
                  <div style={{
                    width: '0%',
                    height: '100%',
                    background: 'var(--color-brand)',
                    borderRadius: 3,
                    transition: 'width 0.5s ease',
                  }} />
                </div>
              </div>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {nextTier.rewards.slice(0, 3).map((reward, i) => (
                  <li key={i} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 12,
                    color: 'var(--color-text-tertiary)',
                  }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    {reward}
                  </li>
                ))}
                {nextTier.rewards.length > 3 && (
                  <li style={{ fontSize: 11, color: 'var(--color-text-tertiary)', paddingLeft: 22 }}>
                    +{nextTier.rewards.length - 3} more rewards
                  </li>
                )}
              </ul>
            </>
          ) : (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              textAlign: 'center',
              gap: 8,
            }}>
              <div style={{ fontSize: 40 }}>🏆</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text)' }}>
                Maximum Tier Reached
              </div>
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                You're at the top — enjoy all Ambassador benefits
              </div>
            </div>
          )}
        </div>
      </div>

      {/* All Tiers Overview */}
      <div style={{
        background: 'var(--color-bg-card)',
        border: '1px solid var(--color-border)',
        borderRadius: 10,
        padding: 24,
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 16 }}>
          All Tiers
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          {TIER_INFORMATION.map((tier) => (
            <div
              key={tier.name}
              style={{
                flex: 1,
                padding: 16,
                borderRadius: 8,
                background: user.tier === tier.name ? 'var(--color-bg-hover)' : 'transparent',
                border: `1px solid ${user.tier === tier.name ? 'var(--color-border-hover)' : 'var(--color-border)'}`,
                transition: 'all var(--transition-fast)',
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text)', marginBottom: 4 }}>
                {tier.name}
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-brand)', marginBottom: 8 }}>
                {(tier.commissionRate * 100)}%
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                {tier.minReferrals === 0 ? 'Start' : `${tier.minReferrals} referrals`}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
