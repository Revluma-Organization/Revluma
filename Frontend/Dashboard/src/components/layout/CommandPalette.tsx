import { Command } from "cmdk";
import { useUI } from "@/store/ui";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { NAV } from "@/data/nav";
import {
  LayoutGrid, Mail, Users, BarChart3, ShoppingCart, Sparkles, Plug, Layers,
  Plus, Download, Settings,
} from "lucide-react";

export function CommandPalette() {
  const { cmdOpen, setCmdOpen } = useUI();
  const navigate = useNavigate();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen(!cmdOpen);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [cmdOpen, setCmdOpen]);

  const go = (to: string) => { setCmdOpen(false); navigate(to); };

  if (!cmdOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[300] flex items-start justify-center bg-black/60 px-4 pt-[12vh] backdrop-blur-sm"
      onClick={() => setCmdOpen(false)}
    >
      <Command
        className="w-full max-w-[640px] overflow-hidden rounded-2xl border border-border-md bg-bg-notif shadow-elegant"
        onClick={(e) => e.stopPropagation()}
        loop
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <svg viewBox="0 0 24 24" className="h-4 w-4 stroke-t3" fill="none" strokeWidth={2} strokeLinecap="round">
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
          <Command.Input
            autoFocus
            placeholder="Search or jump to…"
            className="flex-1 bg-transparent text-sm text-t1 outline-none placeholder:text-t3"
          />
          <kbd className="rounded border border-border bg-bg-3 px-1.5 py-px text-[0.65rem] text-t3">esc</kbd>
        </div>
        <Command.List className="max-h-[420px] overflow-y-auto p-2">
          <Command.Empty className="px-3 py-8 text-center text-sm text-t3">No results.</Command.Empty>

          <Command.Group heading="Pages" className="px-2 text-[0.62rem] font-bold uppercase tracking-[0.11em] text-t4 [&_[cmdk-group-heading]]:px-1.5 [&_[cmdk-group-heading]]:py-2">
            {NAV.map((n) => {
              const Icon = n.icon;
              return (
                <Command.Item
                  key={n.to}
                  value={`${n.label} ${n.group}`}
                  onSelect={() => go(n.to)}
                  className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-t2 aria-selected:bg-white/[0.065] aria-selected:text-t1"
                >
                  <Icon className="h-4 w-4" />
                  <span>{n.label}</span>
                  <span className="ml-auto text-[0.65rem] text-t4">{n.group}</span>
                </Command.Item>
              );
            })}
          </Command.Group>

          <Command.Group heading="Actions" className="px-2 text-[0.62rem] font-bold uppercase tracking-[0.11em] text-t4 [&_[cmdk-group-heading]]:px-1.5 [&_[cmdk-group-heading]]:py-2">
            {[
              { icon: Plus, label: "Connect new store" },
              { icon: Mail, label: "Launch new campaign" },
              { icon: Download, label: "Export overview report (CSV)" },
              { icon: Settings, label: "Open account settings" },
            ].map((a) => (
              <Command.Item
                key={a.label}
                value={a.label}
                onSelect={() => setCmdOpen(false)}
                className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-t2 aria-selected:bg-white/[0.065] aria-selected:text-t1"
              >
                <a.icon className="h-4 w-4" />
                <span>{a.label}</span>
              </Command.Item>
            ))}
          </Command.Group>
        </Command.List>
        <div className="flex items-center gap-4 border-t border-border px-4 py-2 text-[0.7rem] text-t3">
          <span><kbd className="mr-1 rounded border border-border bg-bg-3 px-1 py-px">↑↓</kbd>navigate</span>
          <span><kbd className="mr-1 rounded border border-border bg-bg-3 px-1 py-px">↵</kbd>select</span>
          <span><kbd className="mr-1 rounded border border-border bg-bg-3 px-1 py-px">esc</kbd>close</span>
        </div>
      </Command>
    </div>
  );
}

// silence unused imports linter (icons reserved for future categories)
void [LayoutGrid, Users, BarChart3, ShoppingCart, Sparkles, Plug, Layers];
