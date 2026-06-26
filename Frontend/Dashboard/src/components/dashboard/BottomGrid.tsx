// src/components/dashboard/BottomGrid.tsx
// Task 1.FE2.2 — TrendingProducts and WinbackLeaderboard accept props.
// QuickActions is static navigation — no data, no change needed.

import type { Trending, WinbackEntry } from "@/data/mockOverview";
import {
  Mail, ShoppingCart, TrendingUp, Users,
  ChevronRight, Monitor, ShoppingBag, Globe,
} from "lucide-react";

// ── Quick Actions — UNCHANGED (static navigation, no data) ───────────────────

const QUICK_ACTIONS = [
  { Icon: Mail,         label: "Connect Store / Launch Campaign" },
  { Icon: ShoppingCart, label: "View Abandoned Carts" },
  { Icon: TrendingUp,   label: "Explore Trends" },
  { Icon: Users,        label: "Segment Customers" },
];

export function QuickActions() {
  return (
    <section className="glass-card p-5">
      <header className="mb-4"><h3 className="section-title">Quick Actions</h3></header>
      <div className="space-y-1.5">
        {QUICK_ACTIONS.map((a) => (
          <button
            key={a.label}
            className="flex w-full items-center gap-3 rounded-lg border border-border bg-white/[0.025] px-3 py-2.5 text-left transition-colors hover:border-border-md hover:bg-white/[0.045]"
          >
            <span
              className="flex h-8 w-8 items-center justify-center rounded-md border"
              style={{ background: "hsl(var(--accent) / 0.12)", borderColor: "hsl(var(--accent) / 0.25)" }}
            >
              <a.Icon className="h-3.5 w-3.5" style={{ color: "hsl(var(--accent))" }} />
            </span>
            <span className="flex-1 text-[0.8rem] font-medium text-t1">{a.label}</span>
            <ChevronRight className="h-4 w-4 text-t3" />
          </button>
        ))}
      </div>
    </section>
  );
}

// ── Trending Products ─────────────────────────────────────────────────────────

const PROD_ICONS: Record<string, React.ElementType> = {
  monitor: Monitor, bag: ShoppingBag, globe: Globe,
};

interface TrendingProps {
  products: Trending[] | null;
  loading?: boolean;
}

export function TrendingProducts({ products, loading }: TrendingProps) {
  return (
    <section className="glass-card p-5">
      <header className="mb-4 flex items-center gap-2">
        <span
          className="flex h-7 w-7 items-center justify-center rounded-md border"
          style={{ background: "hsl(var(--green) / 0.10)", borderColor: "hsl(var(--green) / 0.22)" }}
        >
          <TrendingUp className="h-3.5 w-3.5" style={{ color: "hsl(var(--green))" }} />
        </span>
        <h3 className="section-title">Top Winning Products</h3>
      </header>
      <div className="space-y-1">
        {loading || !products
          ? Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 rounded-lg px-2 py-2.5">
                <div className="h-4 w-5 animate-pulse rounded bg-bg-4" />
                <div className="h-9 w-9 animate-pulse rounded-md bg-bg-4" />
                <div className="flex-1">
                  <div className="h-3 w-36 animate-pulse rounded bg-bg-4" />
                  <div className="mt-1.5 h-2.5 w-28 animate-pulse rounded bg-bg-4" />
                </div>
                <div className="h-5 w-10 animate-pulse rounded-full bg-bg-4" />
              </div>
            ))
          : products.map((t) => {
              const Icon = PROD_ICONS[t.iconKey] ?? Monitor;
              return (
                <div key={t.rank} className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-white/[0.025]">
                  <span className="w-5 text-center text-[0.72rem] font-bold text-t3">{t.rank}</span>
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border"
                    style={{ background: "hsl(var(--glass) / 0.035)", borderColor: "hsl(var(--border-soft) / 0.07)" }}
                  >
                    <Icon className="h-4 w-4 text-t2" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[0.8rem] font-medium text-t1">{t.name}</div>
                    <div className="truncate text-[0.66rem] text-t3">{t.stats}</div>
                  </div>
                  <span
                    className="rounded-full px-1.5 py-0.5 text-[0.65rem] font-bold"
                    style={{ background: "hsl(var(--green) / 0.10)", color: "hsl(var(--green))" }}
                  >
                    {t.trend}
                  </span>
                </div>
              );
            })}
      </div>
    </section>
  );
}

//Win-Back Leaderboard

interface WinbackProps {
  entries: WinbackEntry[] | null;
  loading?: boolean;
}

export function WinbackLeaderboard({ entries, loading }: WinbackProps) {
  return (
    <section className="glass-card p-5">
      <header className="mb-4 flex items-center gap-2">
        <span
          className="flex h-7 w-7 items-center justify-center rounded-md border"
          style={{ background: "hsl(var(--purple) / 0.10)", borderColor: "hsl(var(--purple) / 0.22)" }}
        >
          <Users className="h-3.5 w-3.5" style={{ color: "hsl(var(--purple))" }} />
        </span>
        <h3 className="section-title">Win-Back Leaderboard</h3>
      </header>
      <div className="space-y-1">
        {loading || !entries
          ? Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 rounded-lg px-2 py-2.5">
                <div className="h-4 w-5 animate-pulse rounded bg-bg-4" />
                <div className="h-8 w-8 animate-pulse rounded-full bg-bg-4" />
                <div className="flex-1">
                  <div className="h-3 w-24 animate-pulse rounded bg-bg-4" />
                  <div className="mt-1.5 h-2.5 w-16 animate-pulse rounded bg-bg-4" />
                </div>
                <div className="h-3 w-14 animate-pulse rounded bg-bg-4" />
              </div>
            ))
          : entries.map((w, i) => (
              <div key={w.name} className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-white/[0.025]">
                <span className="w-5 text-center text-[0.72rem] font-bold text-t3">{i + 1}</span>
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[0.66rem] font-bold"
                  style={{ background: "hsl(var(--accent) / 0.12)", border: "1.5px solid hsl(var(--accent) / 0.25)", color: "hsl(var(--accent))" }}
                >
                  {w.name.split(" ").map((p) => p[0]).join("")}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[0.8rem] font-medium text-t1">{w.name}</div>
                  <div className="text-[0.66rem] text-t3">{w.count} {w.count === 1 ? "recovery" : "recoveries"}</div>
                </div>
                <span className="text-[0.82rem] font-semibold text-t1">{w.amount}</span>
              </div>
            ))}
      </div>
    </section>
  );
}
