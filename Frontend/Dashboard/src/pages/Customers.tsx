import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { PageHeader } from "@/components/layout/PageHeader";
import { Users, TrendingUp, Star, Inbox, Mail } from "lucide-react";
import { DESIGN_TOKENS } from "@/lib/DesignConstants";

interface CustomerRow {
  id: string;
  full_name: string;
  email: string;
  orders_count: number;
  ltv: string;
  rfm_segment: string | null;
}

const SEGMENT_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  champion:    { label: "Champion",    color: "hsl(var(--green))",  bg: "hsl(var(--green)  / 0.10)" },
  loyal:       { label: "Loyal",       color: "hsl(var(--blue))",   bg: "hsl(var(--blue)   / 0.10)" },
  at_risk:     { label: "At Risk",     color: "hsl(var(--amber))",  bg: "hsl(var(--amber)  / 0.10)" },
  hibernating: { label: "Hibernating", color: "hsl(var(--purple))", bg: "hsl(var(--purple) / 0.10)" },
  lost:        { label: "Lost",        color: "hsl(var(--red))",    bg: "hsl(var(--red)    / 0.10)" },
};

const STAT_TILES = [
  { label: "Total Customers",    key: "total_customers",    icon: Users },
  { label: "Active Subscribers", key: "active_subscribers", icon: Mail },
];

export default function Customers() {
  const [stats, setStats] = useState<Record<string, string> | null>(null);
  const [customers, setCustomers] = useState<CustomerRow[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setStats({ total_customers: "0", active_subscribers: "0" });
      setCustomers([]);
      setLoading(false);
    }, 1500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="mx-auto max-w-[1480px] space-y-6">
      {/* Page header */}
      <PageHeader 
        title="Customers"
        subtitle="View and manage your synced customer base."
      />

      {/* Stat tiles */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {STAT_TILES.map(({ label, key, icon: Icon }) => (
          <div key={key} className="glass-card p-5">
            <div className="mb-2 flex items-center gap-2">
              <span
                className="flex h-7 w-7 items-center justify-center rounded-md border"
                style={{ background: "hsl(var(--accent) / 0.10)", borderColor: "hsl(var(--accent) / 0.22)" }}
              >
                <Icon className="h-3.5 w-3.5" style={{ color: "hsl(var(--accent))" }} />
              </span>
              <span className="text-[0.7rem] font-bold uppercase tracking-[0.11em] text-t4">{label}</span>
            </div>
            {loading ? (
              <div className="h-8 w-24 animate-pulse rounded-md bg-bg-4" />
            ) : (
              <div className="display text-[1.6rem] font-extrabold text-t1">
                {stats?.[key] ?? "--"}
              </div>
            )}
          </div>
        ))}
      </section>

      {/* Customers table */}
      <section className="glass-card p-5">
        <header className="mb-4">
          <h3 className="section-title">Customers</h3>
        </header>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left">
            <thead>
              <tr className="text-[0.62rem] font-bold uppercase tracking-[0.11em] text-t4">
                <th className="pb-3 pl-1">Name</th>
                <th className="pb-3">Email</th>
                <th className="pb-3 text-right">Orders</th>
                <th className="pb-3 text-right">LTV</th>
                <th className="pb-3 pr-1 text-right">Segment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading && (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    <td className="py-3 pl-1">
                      <div className="flex items-center gap-2.5">
                        <div className="h-7 w-7 animate-pulse rounded-full bg-bg-4" />
                        <div className="h-3 w-28 animate-pulse rounded bg-bg-4" />
                      </div>
                    </td>
                    <td className="py-3">
                      <div className="h-3 w-40 animate-pulse rounded bg-bg-4" />
                    </td>
                    <td className="py-3 text-right">
                      <div className="ml-auto h-3 w-8 animate-pulse rounded bg-bg-4" />
                    </td>
                    <td className="py-3 text-right">
                      <div className="ml-auto h-3 w-14 animate-pulse rounded bg-bg-4" />
                    </td>
                    <td className="py-3 pr-1 text-right">
                      <div className="ml-auto h-5 w-20 animate-pulse rounded-full bg-bg-4" />
                    </td>
                  </tr>
                ))
              )}
              {!loading && (!customers || customers.length === 0) && (
                <tr>
                  <td colSpan={5} className="py-20 text-center">
                    <div className={DESIGN_TOKENS.emptyState.container}>
                      <div className={DESIGN_TOKENS.emptyState.iconWrapper}>
                        <Inbox className={DESIGN_TOKENS.emptyState.icon} />
                      </div>
                      <h4 className={DESIGN_TOKENS.emptyState.title}>No customers synced yet</h4>
                      <p className={DESIGN_TOKENS.emptyState.description}>
                        Once you connect your store, Revluma will import and automatically segment your customer data.
                      </p>
                      <button className="bg-[#00D084] text-slate-950 font-semibold px-5 py-2.5 rounded-lg hover:bg-[#00B370] transition-colors mt-4 inline-flex">
                        Connect your store
                      </button>
                    </div>
                  </td>
                </tr>
              )}
              {!loading && customers && customers.length > 0 && customers.map((c) => {
                const seg = c.rfm_segment ? SEGMENT_STYLE[c.rfm_segment] : null;
                const initials = c.full_name
                  .split(' ')
                  .filter(Boolean)
                  .map((p) => p[0])
                  .join('')
                  .slice(0, 2)
                  .toUpperCase();
                return (
                  <tr key={c.id} className="text-[0.78rem] text-t1">
                    <td className="py-3 pl-1">
                      <div className="flex items-center gap-2.5">
                        <span
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[0.65rem] font-bold"
                          style={{ background: "hsl(var(--accent) / 0.12)", border: "1.5px solid hsl(var(--accent) / 0.25)", color: "hsl(var(--accent))" }}
                        >
                          {initials}
                        </span>
                        <span className="font-medium">{c.full_name}</span>
                      </div>
                    </td>
                    <td className="py-3 text-t2">{c.email}</td>
                    <td className="py-3 text-right tabular-nums text-t2">{c.orders_count}</td>
                    <td className="py-3 text-right tabular-nums font-semibold">{c.ltv}</td>
                    <td className="py-3 pr-1 text-right">
                      {seg ? (
                        <span
                          className="inline-block rounded-full px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide"
                          style={{ background: seg.bg, color: seg.color }}
                        >
                          {seg.label}
                        </span>
                      ) : (
                        <span className="text-t4">--</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}