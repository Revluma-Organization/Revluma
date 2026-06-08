import { useState, useEffect, useCallback } from 'react';
import * as api from '../../lib/api';
import type { NotificationItem } from '../../types';
import Skeleton from '../../components/common/Skeleton';

const typeIcon: Record<string, string> = {
  commission: '💰',
  approval: '✅',
  payout: '💳',
  system: '🔔',
  campaign: '📢',
};

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    try {
      const res = await api.getNotifications();
      setNotifications((res.notifications ?? []) as NotificationItem[]);
    } catch { }
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const handleMarkRead = async (id: string) => {
    try {
      await api.markNotificationRead(id);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true, is_read: true } : n));
    } catch { }
  };

  const handleMarkAllRead = async () => {
    try {
      await api.markAllNotificationsRead();
      setNotifications(prev => prev.map(n => ({ ...n, read: true, is_read: true })));
    } catch { }
  };

  const unread = notifications.filter(n => !(n.read ?? n.is_read));

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text)' }}>Notifications</h1>
        {unread.length > 0 && (
          <button onClick={handleMarkAllRead} style={{
            padding: '6px 12px', background: 'transparent', border: '1px solid var(--color-border)',
            borderRadius: 8, color: 'var(--color-text-secondary)', fontSize: 11, cursor: 'pointer',
          }}>
            Mark all read
          </button>
        )}
      </div>
      <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 24 }}>
        {unread.length > 0 ? `You have ${unread.length} unread notification${unread.length > 1 ? 's' : ''}` : 'All caught up!'}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} style={{
              padding: '14px 16px', background: 'var(--color-bg-card)',
              border: '1px solid var(--color-border)', borderRadius: 10,
              display: 'flex', gap: 12, alignItems: 'flex-start',
            }}>
              <Skeleton width={18} height={18} borderRadius="50%" />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <Skeleton width="50%" height={13} />
                <Skeleton width="80%" height={11} />
                <Skeleton width="30%" height={9} />
              </div>
            </div>
          ))
        ) : notifications.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: 12, fontStyle: 'italic' }}>
            No notifications yet.
          </div>
        ) : (
          notifications.map(n => {
            const isRead = n.read ?? n.is_read;
            return (
              <div key={n.id} onClick={() => !isRead && handleMarkRead(n.id)} style={{
                display: 'flex', alignItems: 'flex-start', gap: 12,
                padding: '14px 16px',
                background: isRead ? 'var(--color-bg-card)' : 'var(--color-bg-active)',
                border: '1px solid var(--color-border)',
                borderRadius: 10,
                cursor: isRead ? 'default' : 'pointer',
                transition: 'background 0.15s',
              }}
                onMouseEnter={e => { if (!isRead) e.currentTarget.style.background = 'var(--color-bg-hover)'; }}
                onMouseLeave={e => { if (!isRead) e.currentTarget.style.background = 'var(--color-bg-active)'; }}
              >
                <div style={{ fontSize: 18, lineHeight: 1 }}>{typeIcon[n.type ?? 'system']}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: isRead ? 500 : 700, color: 'var(--color-text)' }}>
                      {n.title}
                    </span>
                    {!isRead && (
                      <span style={{
                        width: 6, height: 6, borderRadius: '50%', background: 'var(--color-brand)',
                        display: 'inline-block', flexShrink: 0,
                      }} />
                    )}
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: 0, lineHeight: 1.4 }}>
                    {n.message}
                  </p>
                  <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 4, display: 'block', fontFamily: 'var(--font-mono)' }}>
                    {new Date(n.timestamp).toLocaleString()}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
