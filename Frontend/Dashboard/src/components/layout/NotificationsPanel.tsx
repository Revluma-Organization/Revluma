import { useUI } from '@/store/ui';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useState, useEffect } from 'react';

interface NotifItem {
  id: string | number;
  unread: boolean;
  tag: string;
  tagColor: string;
  text: string;
  time: string;
}

interface NotificationRecord {
  id: string;
  type: string;
  message: string;
  unread: boolean;
  created_at: string;
}

const TONE: Record<string, { bg: string; border: string; color: string }> = {
  green:  { bg: 'hsl(var(--accent) / 0.10)',  border: 'hsl(var(--accent) / 0.22)',  color: 'hsl(var(--accent))' },
  amber:  { bg: 'hsl(var(--amber) / 0.10)',  border: 'hsl(var(--amber) / 0.22)',  color: 'hsl(var(--amber))' },
  blue:   { bg: 'hsl(var(--blue) / 0.10)',   border: 'hsl(var(--blue) / 0.22)',   color: 'hsl(var(--blue))' },
  purple: { bg: 'hsl(var(--purple) / 0.10)', border: 'hsl(var(--purple) / 0.22)', color: 'hsl(var(--purple))' },
  gray:   { bg: 'hsl(var(--glass) / 0.07)',  border: 'hsl(var(--border-soft) / 0.11)', color: 'hsl(var(--t2))' },
};

const TAG_COLOR_MAP: Record<string, string> = {
  recovery:        'green',
  cart:            'amber',
  cart_anomaly:    'amber',
  campaign:        'blue',
  subscribe:       'purple',
  alert:           'amber',
  anomaly_alert:   'amber',
  revenue_anomaly: 'amber',
  churn_risk:      'purple',
  insight:         'purple',
  system:          'gray',
};

// Human-readable tags for anomaly types
const TYPE_TAG_MAP: Record<string, string> = {
  revenue_anomaly: 'Revenue Alert',
  cart_anomaly:    'Cart Alert',
  churn_risk:      'Churn Risk',
  anomaly_alert:   'Alert',
  recovery:        'Recovery',
  campaign:        'Campaign',
};

function formatRelativeTime(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins  = Math.floor(diff / 60_000);
    const hours = Math.floor(diff / 3_600_000);
    const days  = Math.floor(diff / 86_400_000);
    if (mins < 1)  return 'just now';
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days === 1) return 'Yesterday';
    return `${days}d ago`;
  } catch {
    return '';
  }
}

export function NotificationsPanel() {
  const { notifOpen, setNotifOpen } = useUI();
  const [items, setItems] = useState<NotifItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [mutationError, setMutationError] = useState(false);
  const [pendingIds, setPendingIds] = useState<Set<string | number>>(new Set());

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setNotifOpen(false);
    }
    if (notifOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [notifOpen, setNotifOpen]);

  useEffect(() => {
    if (!notifOpen) return;
    let active = true;
    setLoading(true);
    setLoadError(false);
    setMutationError(false);
    api.get<{ data: { notifications: NotificationRecord[] } }>(
      '/notifications?limit=20'
    )
      .then((res) => {
        if (!active) return;
        if (!Array.isArray(res.data.data?.notifications)) throw new Error('Invalid notification response');
        setItems(
          res.data.data.notifications.map((n) => ({
            id:        n.id,
            unread:    n.unread,
            tag:       TYPE_TAG_MAP[n.type] ?? n.type ?? 'system',
            tagColor:  TAG_COLOR_MAP[n.type] ?? 'gray',
            text:      n.message,
            time:      formatRelativeTime(n.created_at),
          }))
        );
      })
      .catch(() => { if (active) { setItems(null); setLoadError(true); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [notifOpen]);

  async function markRead(id: string | number) {
    if (pendingIds.has(id)) return;
    setMutationError(false);
    setPendingIds(current => new Set(current).add(id));
    try {
      await api.patch(`/notifications/${encodeURIComponent(String(id))}/read`);
      setItems((arr) => arr?.map((n) => (n.id === id ? { ...n, unread: false } : n)) ?? null);
    } catch {
      setMutationError(true);
    } finally {
      setPendingIds(current => { const next = new Set(current); next.delete(id); return next; });
    }
  }

  async function markAll() {
    const unread = items?.filter(n => n.unread).map(n => n.id) ?? [];
    const results = await Promise.allSettled(unread.map(id => markRead(id)));
    if (results.some(result => result.status === 'rejected')) setMutationError(true);
  }

  if (!notifOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-[150]" onClick={() => setNotifOpen(false)} aria-hidden="true" />
      <div 
        role="dialog"
        aria-modal="true"
        aria-label="Notifications"
        className="fixed right-3 top-[calc(var(--topbar-h)+8px)] z-[200] w-[360px] max-w-[calc(100vw-24px)] overflow-hidden rounded-xl border border-border-md bg-bg-notif shadow-elegant sm:right-6"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-sm font-semibold text-t1">Notifications</span>
          <button type="button" onClick={() => void markAll()} disabled={pendingIds.size > 0 || !items?.some(item => item.unread)} className="text-[0.72rem] font-medium text-t3 transition-colors hover:text-t1 disabled:opacity-50">
            {pendingIds.size > 0 ? 'Updating…' : 'Mark all read'}
          </button>
        </div>

        <div className="max-h-[460px] overflow-y-auto">
          {loadError && <div role="alert" className="px-4 py-6 text-center text-[0.8rem] text-t2">Notifications are unavailable. Close and reopen this panel to retry.</div>}
          {mutationError && <p role="alert" className="px-4 py-2 text-center text-[0.72rem] text-t2">The read status could not be saved. Please try again.</p>}
          {loading && (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-start gap-2.5 border-b border-border px-4 py-3">
                <div className="mt-1 h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-bg-4" />
                <div className="flex-1 space-y-2">
                  <div className="h-2 w-20 animate-pulse rounded bg-bg-4" />
                  <div className="h-3 w-full animate-pulse rounded bg-bg-4" />
                </div>
              </div>
            ))
          )}

          {!loading && items !== null && items.length === 0 && (
            <div className="py-10 text-center text-[0.8rem] text-t3">
              No notifications yet
            </div>
          )}

          {!loading && items !== null && items.map((n) => {
            const tone = TONE[n.tagColor] ?? TONE.gray;
            return (
              <button
                type="button"
                key={n.id}
                onClick={() => void markRead(n.id)}
                disabled={!n.unread || pendingIds.has(n.id)}
                aria-label={n.unread ? `Mark notification read: ${n.text}` : `Read notification: ${n.text}`}
                className={cn(
                  'flex w-full cursor-pointer items-start gap-2.5 border-b border-border px-4 py-3 text-left transition-colors hover:bg-glass/[0.035] disabled:cursor-default',
                  n.unread && 'bg-glass/[0.018]'
                )}
              >
                <span
                  className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: n.unread ? 'hsl(var(--accent))' : 'hsl(var(--t4))' }}
                />
                <div className="min-w-0 flex-1">
                  <div className="mb-1.5 flex items-center gap-2">
                    <span
                      className="rounded-full border px-1.5 py-px text-[0.58rem] font-bold uppercase tracking-wider"
                      style={{ background: tone.bg, borderColor: tone.border, color: tone.color }}
                    >
                      {n.tag}
                    </span>
                    <span className="text-[0.66rem] text-t3">{n.time}</span>
                  </div>
                  <p className="text-[0.78rem] leading-snug text-t1">{n.text}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
