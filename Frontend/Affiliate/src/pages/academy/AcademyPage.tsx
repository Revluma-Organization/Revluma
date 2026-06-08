const courses = [
  { title: 'Getting Started with Affiliate Marketing', description: 'Learn the fundamentals of affiliate marketing and how to leverage your network effectively.', duration: '20 min', level: 'Beginner', icon: '🚀' },
  { title: 'Advanced Campaign Strategies', description: 'Deep dive into UTMs, multi-channel attribution, and conversion optimization.', duration: '45 min', level: 'Advanced', icon: '📊' },
  { title: 'Content Creation for Partners', description: 'How to create compelling content that converts — from social media to email.', duration: '30 min', level: 'Intermediate', icon: '✍️' },
  { title: 'Understanding Your Dashboard', description: 'Walk through every metric in your dashboard and learn how to interpret the data.', duration: '15 min', level: 'Beginner', icon: '📈' },
  { title: 'Maximizing Commission Payouts', description: 'Strategies to increase your affiliate revenue and move up the tier ladder.', duration: '25 min', level: 'Intermediate', icon: '💰' },
  { title: 'Building Your Personal Brand', description: 'Establish yourself as a trusted authority in your niche with Revluma.', duration: '35 min', level: 'Advanced', icon: '🌟' },
];

export default function AcademyPage() {
  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text)', marginBottom: 4 }}>Academy</h1>
      <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 24 }}>
        Learn, grow, and master your affiliate strategy
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
        {courses.map(c => (
          <div key={c.title} style={{
            background: 'var(--color-bg-card)', border: '1px solid var(--color-border)',
            borderRadius: 10, padding: 20, cursor: 'pointer',
            transition: 'border-color 0.15s, box-shadow 0.15s',
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-brand)'; e.currentTarget.style.boxShadow = '0 0 0 1px var(--color-brand)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.boxShadow = 'none'; }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <span style={{ fontSize: 24 }}>{c.icon}</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>
                  {c.title}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                  <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--color-text-tertiary)' }}>
                    {c.duration}
                  </span>
                  <span style={{
                    fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 600, textTransform: 'uppercase',
                    padding: '1px 6px', borderRadius: 3,
                    background: c.level === 'Beginner' ? 'var(--color-success-bg)' : c.level === 'Intermediate' ? 'var(--color-bg-active)' : 'var(--color-bg-hover)',
                    color: c.level === 'Beginner' ? 'var(--color-success)' : 'var(--color-text-secondary)',
                  }}>
                    {c.level}
                  </span>
                </div>
              </div>
            </div>
            <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: 0, lineHeight: 1.5 }}>
              {c.description}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
