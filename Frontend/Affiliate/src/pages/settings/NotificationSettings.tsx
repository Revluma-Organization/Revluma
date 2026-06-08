import { useState } from 'react';

type ToggleKey = 'email_new' | 'email_commission' | 'email_payout' | 'email_campaign' | 'push_new' | 'push_commission' | 'push_payout' | 'sms_payout';

const toggles: { key: ToggleKey; label: string; description: string }[] = [
  { key: 'email_new', label: 'New Referral', description: 'When someone signs up using your link', },
  { key: 'email_commission', label: 'Commission Earned', description: 'When a commission is credited to your account', },
  { key: 'email_payout', label: 'Payout Updates', description: 'When a withdrawal is processed or updated', },
  { key: 'email_campaign', label: 'Campaign Alerts', description: 'Performance milestones and campaign updates', },
  { key: 'push_new', label: 'Push - New Referral', description: 'Browser notification for new referrals', },
  { key: 'push_commission', label: 'Push - Commission', description: 'Browser notification for commissions', },
  { key: 'push_payout', label: 'Push - Payout', description: 'Browser notification for payout status', },
  { key: 'sms_payout', label: 'SMS - Payout Alerts', description: 'Text message for payout confirmations', },
];

const defaultEnabled: ToggleKey[] = ['email_new', 'email_commission', 'email_payout', 'push_new', 'push_commission'];

export default function NotificationSettings() {
  const [enabled, setEnabled] = useState<ToggleKey[]>(() => {
    try { return JSON.parse(localStorage.getItem('partner_notification_toggles') ?? 'null') ?? defaultEnabled; }
    catch { return defaultEnabled; }
  });
  const [saved, setSaved] = useState(false);

  const toggle = (key: ToggleKey) => {
    setEnabled(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  };

  const handleSave = () => {
    localStorage.setItem('partner_notification_toggles', JSON.stringify(enabled));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text)', marginBottom: 4 }}>Notifications</h1>
      <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 24 }}>
        Choose which notifications you receive
      </p>

      <div style={{
        background: 'var(--color-bg-card)', border: '1px solid var(--color-border)',
        borderRadius: 10, overflow: 'hidden', maxWidth: 560,
      }}>
        {toggles.map(t => (
          <div key={t.key} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 20px', borderBottom: '1px solid var(--color-border)',
          }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text)', marginBottom: 1 }}>
                {t.label}
              </div>
              <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>
                {t.description}
              </div>
            </div>
            <button onClick={() => toggle(t.key)} style={{
              width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer', position: 'relative',
              background: enabled.includes(t.key) ? 'var(--color-brand)' : 'var(--color-border)',
              transition: 'background 0.15s',
            }}>
              <span style={{
                position: 'absolute', top: 2, width: 16, height: 16, borderRadius: '50%',
                background: '#fff', transition: 'left 0.15s',
                left: enabled.includes(t.key) ? 18 : 2,
              }} />
            </button>
          </div>
        ))}
      </div>

      <button onClick={handleSave} style={{
        marginTop: 16, padding: '10px 24px', background: 'var(--color-brand)', color: '#fff',
        border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
      }}>
        {saved ? 'Saved!' : 'Save Preferences'}
      </button>
    </div>
  );
}
