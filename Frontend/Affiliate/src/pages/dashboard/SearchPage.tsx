import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

const quickLinks = [
  { label: 'Referrals', path: '/dashboard/referrals' },
  { label: 'Earnings', path: '/dashboard/earnings' },
  { label: 'Campaigns', path: '/dashboard/campaigns' },
  { label: 'Copilot', path: '/dashboard/copilot' },
  { label: 'Leaderboard', path: '/dashboard/leaderboard' },
  { label: 'Academy', path: '/dashboard/academy' },
  { label: 'Settings', path: '/settings/profile' },
];

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => { inputRef.current?.focus(); }, []);

  const results = query.trim()
    ? quickLinks.filter(l => l.label.toLowerCase().includes(query.toLowerCase()))
    : quickLinks;

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text)', marginBottom: 16 }}>Search</h1>

      <div style={{
        background: 'var(--color-bg-card)', border: '1px solid var(--color-border)',
        borderRadius: 10, overflow: 'hidden', marginBottom: 16,
      }}>
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search pages, settings, help articles..."
          style={{
            width: '100%', padding: '14px 16px', background: 'transparent', border: 'none',
            color: 'var(--color-text)', fontSize: 14, outline: 'none', fontFamily: 'inherit',
          }}
        />
      </div>

      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-tertiary)', marginBottom: 8 }}>
        {query.trim() ? `Results (${results.length})` : 'Quick Links'}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {results.map(l => (
          <div key={l.path} onClick={() => navigate(l.path)} style={{
            padding: '12px 16px', background: 'var(--color-bg-card)',
            border: '1px solid var(--color-border)', borderRadius: 8,
            cursor: 'pointer', fontSize: 13, color: 'var(--color-text)',
            transition: 'border-color 0.1s',
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-brand)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}
          >
            {l.label}
          </div>
        ))}
      </div>
    </div>
  );
}
