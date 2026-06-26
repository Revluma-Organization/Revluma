import { motion } from "framer-motion";
import {
  DollarSign, ShoppingCart, TrendingUp, Users, AlertTriangle, Star,
  ArrowUp, ArrowDown,
} from "lucide-react";
import type { KPI, KpiIconKey } from "@/data/mockOverview";
import { cn } from "@/lib/utils";

const ICON_MAP: Record<KpiIconKey, React.ElementType> = {
  dollar: DollarSign, cart: ShoppingCart, trend: TrendingUp,
  users: Users, alert: AlertTriangle, star: Star,
};

const TONES: Record<string, { bg: string; border: string; color: string; ring: string }> = {
  green:  { bg: "hsl(var(--green) / 0.10)",  border: "hsl(var(--green) / 0.22)",  color: "hsl(var(--green))",  ring: "hsl(var(--green))" },
  amber:  { bg: "hsl(var(--amber) / 0.10)",  border: "hsl(var(--amber) / 0.22)",  color: "hsl(var(--amber))",  ring: "hsl(var(--amber))" },
  blue:   { bg: "hsl(var(--blue) / 0.10)",   border: "hsl(var(--blue) / 0.22)",   color: "hsl(var(--blue))",   ring: "hsl(var(--blue))" },
  purple: { bg: "hsl(var(--purple) / 0.10)", border: "hsl(var(--purple) / 0.22)", color: "hsl(var(--purple))", ring: "hsl(var(--purple))" },
  red:    { bg: "hsl(var(--red) / 0.10)",    border: "hsl(var(--red) / 0.22)",    color: "hsl(var(--red))",    ring: "hsl(var(--red))" },
};

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (!data?.length) return null;
  const max = Math.max(...data), min = Math.min(...data);
  const range = max - min || 1;
  const w = 120, h = 38;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * (h - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="mt-3 h-9 w-full">
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function KpiCard({ kpi, index }: { kpi: KPI; index: number }) {
  const tone = TONES[kpi.color];
  const Icon = ICON_MAP[kpi.iconKey];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.04 + index * 0.04, duration: 0.32, ease: [0.4, 0, 0.2, 1] }}
      className="relative flex flex-col overflow-hidden rounded-xl border border-border bg-bg-2 p-4 transition-colors hover:border-border-md"
    >
      {/* subtle hover glow */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px opacity-0 transition-opacity group-hover:opacity-100"
        style={{ background: `linear-gradient(90deg, transparent, ${tone.color}, transparent)` }}
      />
      <div className="mb-3 flex items-start justify-between">
        <div
          className="flex h-7 w-7 items-center justify-center rounded-md border"
          style={{ background: tone.bg, borderColor: tone.border }}
        >
          <Icon className="h-3.5 w-3.5" style={{ color: tone.color, strokeWidth: 2 }} />
        </div>
        {kpi.delta && (
          <div
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[0.65rem] font-semibold",
              kpi.dir === "up" && "text-green",
              kpi.dir === "down" && "text-red",
              kpi.dir === "neutral" && "text-t2",
            )}
            style={kpi.dir === "up" ? { background: "hsl(var(--green) / 0.10)" } : kpi.dir === "down" ? { background: "hsl(var(--red) / 0.10)" } : { background: "hsl(var(--glass) / 0.07)" }}
          >
            {kpi.dir === "up" && <ArrowUp className="h-2.5 w-2.5" />}
            {kpi.dir === "down" && <ArrowDown className="h-2.5 w-2.5" />}
            {kpi.delta}
          </div>
        )}
      </div>
      <div className="display text-[1.6rem] font-extrabold leading-none text-t1">{kpi.value}</div>
      <div className="mt-2 text-[0.72rem] font-medium text-t2">{kpi.label}</div>
      <div className={cn("mt-1 text-[0.66rem]", kpi.atRisk ? "text-amber" : "text-t3")}>
        {kpi.atRisk || kpi.bench || ""}
      </div>
      {kpi.spark && <Sparkline data={kpi.spark} color={tone.color} />}
    </motion.div>
  );
}
