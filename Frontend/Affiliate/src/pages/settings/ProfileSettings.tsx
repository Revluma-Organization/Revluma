import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import * as api from '../../lib/api';
import type { PartnerProfile } from '../../types';

export default function ProfileSettings() {
  const { user: profile, hydrateUser } = useAuth();
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [website, setWebsite] = useState('');
  const [audienceNiche, setAudienceNiche] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (profile) {
      setFullName(profile.fullName ?? '');
      setUsername(profile.username ?? '');
      setWebsite(profile.website ?? '');
      setAudienceNiche(profile.audienceNiche ?? '');
    }
  }, [profile]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await api.updateProfile({ fullName, username, website, audienceNiche });
      if (res.profile) hydrateUser({ ...profile, ...res.profile } as PartnerProfile);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {}
    setSaving(false);
  };

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text)', marginBottom: 4 }}>Profile</h1>
      <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 24 }}>
        Manage your public profile information
      </p>

      <div style={{
        background: 'var(--color-bg-card)', border: '1px solid var(--color-border)',
        borderRadius: 10, padding: 24, maxWidth: 560,
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {[
            { label: 'Full Name', value: fullName, set: setFullName },
            { label: 'Username', value: username, set: setUsername },
            { label: 'Website', value: website, set: setWebsite },
            { label: 'Audience Niche', value: audienceNiche, set: setAudienceNiche },
          ].map(f => (
            <div key={f.label}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {f.label}
              </label>
              <input value={f.value} onChange={e => f.set(e.target.value)}
                style={{
                  width: '100%', padding: '10px 12px', background: 'var(--color-bg)',
                  border: '1px solid var(--color-border)', borderRadius: 8, color: 'var(--color-text)',
                  fontSize: 12, outline: 'none', fontFamily: 'inherit',
                  transition: 'border-color 0.1s',
                }}
                onFocus={e => { e.target.style.borderColor = 'var(--color-brand)'; }}
                onBlur={e => { e.target.style.borderColor = 'var(--color-border)'; }} />
            </div>
          ))}
        </div>

        <button onClick={handleSave} disabled={saving} style={{
          marginTop: 20, padding: '10px 24px', background: 'var(--color-brand)', color: '#fff',
          border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
          opacity: saving ? 0.7 : 1,
        }}>
          {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}
