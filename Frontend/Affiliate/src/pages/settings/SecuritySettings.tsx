import { useState } from 'react';
import * as api from '../../lib/api';

export default function SecuritySettings() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changing, setChanging] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword) { setMessage({ type: 'error', text: 'All fields required' }); return; }
    if (newPassword !== confirmPassword) { setMessage({ type: 'error', text: 'Passwords do not match' }); return; }
    if (newPassword.length < 8) { setMessage({ type: 'error', text: 'Password must be at least 8 characters' }); return; }
    setChanging(true);
    try {
      await api.updateProfile({ currentPassword, password: newPassword } as any);
      setMessage({ type: 'success', text: 'Password updated successfully' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch {
      setMessage({ type: 'error', text: 'Failed to update password' });
    }
    setChanging(false);
  };

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text)', marginBottom: 4 }}>Security</h1>
      <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 24 }}>
        Manage your password and security settings
      </p>

      <div style={{
        background: 'var(--color-bg-card)', border: '1px solid var(--color-border)',
        borderRadius: 10, padding: 24, maxWidth: 480,
      }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', marginBottom: 16 }}>Change Password</h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[
            { label: 'Current Password', value: currentPassword, set: setCurrentPassword },
            { label: 'New Password', value: newPassword, set: setNewPassword },
            { label: 'Confirm New Password', value: confirmPassword, set: setConfirmPassword },
          ].map(f => (
            <div key={f.label}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {f.label}
              </label>
              <input type="password" value={f.value} onChange={e => f.set(e.target.value)}
                style={{
                  width: '100%', padding: '10px 12px', background: 'var(--color-bg)',
                  border: '1px solid var(--color-border)', borderRadius: 8, color: 'var(--color-text)',
                  fontSize: 12, outline: 'none', fontFamily: 'inherit',
                }}
                onFocus={e => { e.target.style.borderColor = 'var(--color-brand)'; }}
                onBlur={e => { e.target.style.borderColor = 'var(--color-border)'; }} />
            </div>
          ))}
        </div>

        {message && (
          <div style={{
            marginTop: 12, padding: '8px 12px', borderRadius: 6, fontSize: 11,
            background: message.type === 'success' ? 'var(--color-success-bg)' : 'var(--color-error-bg)',
            color: message.type === 'success' ? 'var(--color-success)' : 'var(--color-error)',
          }}>
            {message.text}
          </div>
        )}

        <button onClick={handleChangePassword} disabled={changing} style={{
          marginTop: 16, padding: '10px 24px', background: 'var(--color-brand)', color: '#fff',
          border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
          opacity: changing ? 0.7 : 1,
        }}>
          {changing ? 'Updating...' : 'Update Password'}
        </button>
      </div>
    </div>
  );
}
