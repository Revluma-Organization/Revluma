const faqs = [
  { q: 'How do I get my referral link?', a: 'Your referral link is on the Referrals page. Copy and share it anywhere.' },
  { q: 'When do commissions pay out?', a: 'Commissions are paid within 30 days of the referred customer\'s payment.' },
  { q: 'How do I move to the next tier?', a: 'Refer more customers. See the Dashboard Home page for your current progress and next tier requirements.' },
  { q: 'Can I create my own campaigns?', a: 'Yes! Use the Campaigns page to create UTM-tagged campaigns and track their performance.' },
  { q: 'How do I reset my password?', a: 'Go to Settings > Security to change your password.' },
];

const supportChannels = [
  { label: 'Email Support', value: 'partners@revluma.com', icon: '📧' },
  { label: 'Discord', value: 'Join our partner Discord', icon: '💬' },
  { label: 'Documentation', value: 'Visit the Academy', icon: '📚' },
];

export default function HelpPage() {
  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text)', marginBottom: 4 }}>Help</h1>
      <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 24 }}>
        Frequently asked questions and support channels
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {faqs.map(f => (
            <details key={f.q} style={{
              background: 'var(--color-bg-card)', border: '1px solid var(--color-border)',
              borderRadius: 8, padding: '12px 16px', cursor: 'pointer',
            }}>
              <summary style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', cursor: 'pointer' }}>
                {f.q}
              </summary>
              <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '8px 0 0', lineHeight: 1.5 }}>
                {f.a}
              </p>
            </details>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-tertiary)', marginBottom: 4 }}>
            Support Channels
          </div>
          {supportChannels.map(c => (
            <div key={c.label} style={{
              background: 'var(--color-bg-card)', border: '1px solid var(--color-border)',
              borderRadius: 8, padding: '14px 16px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                <span>{c.icon}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)' }}>{c.label}</span>
              </div>
              <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{c.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
