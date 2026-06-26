import { useUI } from "@/store/ui";
import { MOCK } from "@/data/mockOverview";
import { cn } from "@/lib/utils";
import { useState } from "react";

const TONE: Record<string, { bg: string; border: string; color: string }> = {
  green:  { bg: "hsl(var(--green) / 0.10)",  border: "hsl(var(--green) / 0.22)",  color: "hsl(var(--green))" },
  amber:  { bg: "hsl(var(--amber) / 0.10)",  border: "hsl(var(--amber) / 0.22)",  color: "hsl(var(--amber))" },
  blue:   { bg: "hsl(var(--blue) / 0.10)",   border: "hsl(var(--blue) / 0.22)",   color: "hsl(var(--blue))" },
  purple: { bg: "hsl(var(--purple) / 0.10)", border: "hsl(var(--purple) / 0.22)", color: "hsl(var(--purple))" },
  gray:   { bg: "hsl(var(--glass) / 0.07)",  border: "hsl(var(--border-soft) / 0.11)", color: "hsl(var(--t2))" },
};

export function NotificationsPanel() {
  const { notifOpen, setNotifOpen } = useUI();
  const [items, setItems] = useState(MOCK.notifications);
  if (!notifOpen) return null;

  const markAll = () => setItems((arr) => arr.map((n) => ({ ...n, unread: false })));

  return (
    <>
      <div className="fixed inset-0 z-[150]" onClick={() => setNotifOpen(false)} />
      <div className="fixed right-3 top-[calc(var(--topbar-h)+8px)] z-[200] w-[360px] max-w-[calc(100vw-24px)] overflow-hidden rounded-xl border border-border-md bg-bg-notif shadow-elegant sm:right-6">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-sm font-semibold text-t1">Notifications</span>
          <button onClick={markAll} className="text-[0.72rem] font-medium text-t3 transition-colors hover:text-t1">
            Mark all read
          </button>
        </div>
        <div className="max-h-[460px] overflow-y-auto">
          {items.map((n) => {
            const tone = TONE[n.tagColor];
            return (
              <div
                key={n.id}
                className={cn("flex items-start gap-2.5 border-b border-border px-4 py-3 transition-colors hover:bg-white/[0.035]", n.unread && "bg-white/[0.018]")}
              >
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: n.unread ? "hsl(var(--accent))" : "hsl(var(--t4))" }} />
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
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
