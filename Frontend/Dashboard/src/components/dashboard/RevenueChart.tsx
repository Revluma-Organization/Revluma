// src/components/dashboard/RevenueChart.tsx
// Task 1.FE2.2 — accepts chartData prop instead of importing MOCK

import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
  Tooltip, CartesianGrid, Legend,
} from "recharts";
import { useState } from "react";
import type { ChartData } from "@/data/mockOverview";
import { cn } from "@/lib/utils";

type Period = "7d" | "30d" | "90d";

interface Props {
  chartData: ChartData | null;
  loading?: boolean;
}

export function RevenueChart({ chartData, loading }: Props) {
  const [period, setPeriod] = useState<Period>("7d");
  const data = chartData?.[period] ?? null;

  return (
    <section className="glass-card p-5">
      <header className="mb-4 flex items-center justify-between gap-3">
        <h3 className="section-title">Revenue Recovery Performance</h3>
        <div className="inline-flex rounded-md border border-border bg-white/[0.035] p-0.5">
          {(["7d", "30d", "90d"] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={cn(
                "rounded px-2.5 py-1 text-[0.7rem] font-semibold uppercase tracking-wider text-t3 transition-colors",
                period === p && "bg-white/[0.08] text-t1",
              )}
            >
              {p}
            </button>
          ))}
        </div>
      </header>

      <div className="h-[260px] w-full">
        {loading || !data ? (
          <div className="h-full w-full animate-pulse rounded-lg bg-bg-4" />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="grad-recovered" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="grad-abandoned" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--red))" stopOpacity={0.18} />
                  <stop offset="100%" stopColor="hsl(var(--red))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="hsl(var(--border-soft) / 0.06)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: "hsl(var(--t3))", fontSize: 11 }} stroke="hsl(var(--border-soft) / 0.08)" />
              <YAxis tick={{ fill: "hsl(var(--t3))", fontSize: 11 }} stroke="hsl(var(--border-soft) / 0.08)" />
              <Tooltip
                cursor={{ stroke: "hsl(var(--border-soft) / 0.18)", strokeWidth: 1 }}
                contentStyle={{
                  background: "hsl(var(--bg-2))",
                  border: "1px solid hsl(var(--border-soft) / 0.12)",
                  borderRadius: "10px",
                  fontSize: "12px",
                  color: "hsl(var(--t1))",
                }}
                labelStyle={{ color: "hsl(var(--t2))" }}
              />
              <Legend wrapperStyle={{ fontSize: "11px", color: "hsl(var(--t2))" }} iconType="circle" />
              <Area type="monotone" dataKey="abandoned" name="Abandoned" stroke="hsl(var(--red))" strokeWidth={2} fill="url(#grad-abandoned)" />
              <Area type="monotone" dataKey="recovered" name="Recovered" stroke="hsl(var(--accent))" strokeWidth={2} fill="url(#grad-recovered)" />
              <Area type="monotone" dataKey="revenue" name="Revenue ($)" stroke="hsl(var(--blue))" strokeWidth={2} fillOpacity={0} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}
