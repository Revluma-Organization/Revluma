import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { PageHeader } from "@/components/layout/PageHeader";
import { ShoppingCart, TrendingUp, RefreshCw, PackageOpen } from "lucide-react";
import { DESIGN_TOKENS } from "@/lib/DesignConstants";

interface CartRow {
  id: string;
  customer_name: string;
  cart_value: string;
  status: "abandoned" | "recovered" | "lost";
  abandoned_at: string;
}

const STATUS_STYLE: Record<CartRow["status"], { label: string; color: string; bg: string }> = {
  abandoned: { label: "Abandoned",  color: "hsl(var(--amber))", bg: "hsl(var(--amber) / 0.10)" },
  recovered: { label: "Recovered",  color: "hsl(var(--accent))", bg: "hsl(var(--accent) / 0.10)" },
  lost:      { label: "Lost",       color: "hsl(var(--red))",   bg: "hsl(var(--red)   / 0.10)" },
};

const STAT_TILES = [
  { label: "Total Abandoned",  key: "total_abandoned",  icon: ShoppingCart },
  { label: "Total Recovered",  key: "total_recovered",  icon: TrendingUp },
  { label: "Recovery Rate",    key: "recovery_rate",    icon: RefreshCw },
];

export default function CartRecovery() {
  const [stats, setStats] = useState<Record<string, string> | null>(null);
  const [carts, setCarts] = useState<CartRow[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setStats({ total_abandoned: "0", total_recovered: "0", recovery_rate: "0%" });
      setCarts([]);
      setLoading(false);
    }, 1500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="mx-auto max-w-[1480px] space-y-6">
      {/* Page header */}
      <PageHeader 
        title="Cart Recovery"
        subtitle="Recover abandoned carts and win back lost revenue."
      />

      {/* Stat tiles */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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

      {/* Carts table */}
      <section className="glass-card p-5">
        <header className="mb-4">
          <h3 className="section-title">Abandoned Carts</h3>
        </header>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left">
            <thead>
              <tr className="text-[0.62rem] font-bold uppercase tracking-[0.11em] text-t4">
                <th className="pb-3 pl-1">Customer</th>
                <th className="pb-3 text-right">Cart Value</th>
                <th className="pb-3 text-center">Status</th>
                <th className="pb-3 text-right">Abandoned At</th>
                <th className="pb-3 pr-1 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading && (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    <td className="py-3 pl-1">
                      <div className="h-3 w-36 animate-pulse rounded bg-bg-4" />
                    </td>
                    <td className="py-3 text-right">
                      <div className="ml-auto h-3 w-16 animate-pulse rounded bg-bg-4" />
                    </td>
                    <td className="py-3 text-center">
                      <div className="mx-auto h-5 w-20 animate-pulse rounded-full bg-bg-4" />
                    </td>
                    <td className="py-3 text-right">
                      <div className="ml-auto h-3 w-24 animate-pulse rounded bg-bg-4" />
                    </td>
                    <td className="py-3 pr-1 text-right">
                      <div className="ml-auto h-6 w-16 animate-pulse rounded-md bg-bg-4" />
                    </td>
                  </tr>
                ))
              )}
              {!loading && (!carts || carts.length === 0) && (
                <tr>
                  <td colSpan={5} className="py-20 text-center">
                    <div className={DESIGN_TOKENS.emptyState.container}>
                      <div className={DESIGN_TOKENS.emptyState.iconWrapper}>
                        <PackageOpen className={DESIGN_TOKENS.emptyState.icon} />
                      </div>
                      <h4 className={DESIGN_TOKENS.emptyState.title}>No abandoned carts yet</h4>
                      <p className={DESIGN_TOKENS.emptyState.description}>
                        Once you connect your store, Revluma will automatically start tracking and recovering abandoned carts.
                      </p>
                      <button className="bg-[#007FFF] text-white font-semibold px-5 py-2.5 rounded-lg hover:bg-[#007FFF]/90 transition-colors mt-4 inline-flex">
                        Connect your store
                      </button>
                    </div>
                  </td>
                </tr>
              )}
              {!loading && carts && carts.length > 0 && carts.map((c) => {
                const s = STATUS_STYLE[c.status];
                return (
                  <tr key={c.id} className="text-[0.78rem] text-t1">
                    <td className="py-3 pl-1 font-medium">{c.customer_name}</td>
                    <td className="py-3 text-right tabular-nums font-semibold">{c.cart_value}</td>
                    <td className="py-3 text-center">
                      <span
                        className="inline-block rounded-full px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide"
                        style={{ background: s.bg, color: s.color }}
                      >
                        {s.label}
                      </span>
                    </td>
                    <td className="py-3 text-right text-t3">{c.abandoned_at}</td>
                    <td className="py-3 pr-1 text-right">
                      <button
                        className="rounded-md border border-border bg-glass/[0.035] px-2.5 py-1 text-[0.72rem] font-medium text-t2 transition-colors hover:border-border-md hover:text-t1"
                      >
                        Recover
                      </button>
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