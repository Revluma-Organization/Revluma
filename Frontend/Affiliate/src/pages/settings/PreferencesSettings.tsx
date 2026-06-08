import { useState } from 'react';

export default function PreferencesSettings() {
  const [timezone, setTimezone] = useState('UTC');
  const [dateFormat, setDateFormat] = useState('MM/DD/YYYY');
  const [language, setLanguage] = useState('English (US)');
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    localStorage.setItem('partner_preferences', JSON.stringify({ timezone, dateFormat, language }));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text)', marginBottom: 4 }}>Preferences</h1>
      <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 24 }}>
        Customize your experience
      </p>

      <div style={{
        background: 'var(--color-bg-card)', border: '1px solid var(--color-border)',
        borderRadius: 10, padding: 24, maxWidth: 480,
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Timezone
            </label>
            <select value={timezone} onChange={e => setTimezone(e.target.value)}
              style={{
                width: '100%', padding: '10px 12px', background: 'var(--color-bg)',
                border: '1px solid var(--color-border)', borderRadius: 8, color: 'var(--color-text)',
                fontSize: 12, outline: 'none', fontFamily: 'inherit', cursor: 'pointer',
              }}>
              {['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Tokyo', 'Asia/Shanghai'].map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Date Format
            </label>
            <select value={dateFormat} onChange={e => setDateFormat(e.target.value)}
              style={{
                width: '100%', padding: '10px 12px', background: 'var(--color-bg)',
                border: '1px solid var(--color-border)', borderRadius: 8, color: 'var(--color-text)',
                fontSize: 12, outline: 'none', fontFamily: 'inherit', cursor: 'pointer',
              }}>
              {['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'].map(f => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Language
            </label>
            <select value={language} onChange={e => setLanguage(e.target.value)}
              style={{
                width: '100%', padding: '10px 12px', background: 'var(--color-bg)',
                border: '1px solid var(--color-border)', borderRadius: 8, color: 'var(--color-text)',
                fontSize: 12, outline: 'none', fontFamily: 'inherit', cursor: 'pointer',
              }}>
              {['English (US)', 'English (UK)', 'Spanish', 'French', 'German', 'Japanese'].map(l => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </div>
        </div>

        <button onClick={handleSave} style={{
          marginTop: 20, padding: '10px 24px', background: 'var(--color-brand)', color: '#fff',
          border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
        }}>
          {saved ? 'Saved!' : 'Save Preferences'}
        </button>
      </div>
    </div>
  );
}
