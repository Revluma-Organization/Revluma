import { useTheme } from '../../hooks/useTheme';

const themeLabels = {
  dark: '🌙 Dark',
  light: '☀️ Light',
};

const fontSizes = [12, 13, 14];

export default function AppearanceSettings() {
  const { theme, setTheme } = useTheme();

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text)', marginBottom: 4 }}>Appearance</h1>
      <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 24 }}>
        Customize how the portal looks
      </p>

      <div style={{
        background: 'var(--color-bg-card)', border: '1px solid var(--color-border)',
        borderRadius: 10, padding: 24, maxWidth: 480,
      }}>
        <div style={{ marginBottom: 24 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Theme
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            {(Object.entries(themeLabels) as [string, string][]).map(([t, label]) => (
              <button key={t} onClick={() => setTheme(t as 'dark' | 'light')} style={{
                flex: 1, padding: '12px 16px', borderRadius: 8, border: '1px solid',
                borderColor: theme === t ? 'var(--color-brand)' : 'var(--color-border)',
                background: theme === t ? 'var(--color-bg-active)' : 'var(--color-bg)',
                color: 'var(--color-text)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                transition: 'border-color 0.1s, background 0.1s',
              }}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Font Size
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            {fontSizes.map(s => (
              <button key={s} onClick={() => {
                document.documentElement.style.fontSize = `${s}px`;
                localStorage.setItem('partner_font_size', String(s));
              }} style={{
                flex: 1, padding: '12px 16px', borderRadius: 8, border: '1px solid var(--color-border)',
                background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: s,
                fontWeight: 600, cursor: 'pointer',
              }}>
                {s}px
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
