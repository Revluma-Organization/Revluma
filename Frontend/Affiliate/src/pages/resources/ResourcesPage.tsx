const resources = [
  { title: 'Brand Guidelines', description: 'Official Revluma brand assets, logos, colors, and usage guidelines.', type: 'PDF', icon: '🎨' },
  { title: 'Social Media Kit', description: 'Pre-made graphics and templates for Twitter, LinkedIn, and Instagram.', type: 'ZIP', icon: '📱' },
  { title: 'Email Templates', description: 'Copy-paste email templates for outreach and promotion.', type: 'DOC', icon: '📧' },
  { title: 'Banner Ads', description: 'Ready-to-use banner ads in multiple sizes for your website.', type: 'ZIP', icon: '🖼️' },
  { title: 'Product Knowledge Base', description: 'Comprehensive guide to Revluma features and value propositions.', type: 'KB', icon: '📚' },
  { title: 'Affiliate Agreement', description: 'Current affiliate program terms and conditions document.', type: 'PDF', icon: '📄' },
];

export default function ResourcesPage() {
  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text)', marginBottom: 4 }}>Resources</h1>
      <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 24 }}>
        Assets, templates, and collateral for your marketing efforts
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
        {resources.map(r => (
          <div key={r.title} style={{
            background: 'var(--color-bg-card)', border: '1px solid var(--color-border)',
            borderRadius: 10, padding: 20, cursor: 'pointer',
            transition: 'border-color 0.15s',
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-brand)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <span style={{ fontSize: 24 }}>{r.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>
                  {r.title}
                </div>
                <span style={{
                  fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 600, textTransform: 'uppercase',
                  padding: '1px 6px', borderRadius: 3, background: 'var(--color-bg)', color: 'var(--color-text-tertiary)',
                  letterSpacing: '0.05em',
                }}>
                  {r.type}
                </span>
              </div>
            </div>
            <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: 0, lineHeight: 1.5 }}>
              {r.description}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
