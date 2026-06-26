import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Activity, TrendingUp, Users, Zap, Info } from "lucide-react";

interface Metric {
  label: string;
  value: number;
  suffix?: string;
  prefix?: string;
  decimals?: number;
  delta: number;
  icon: React.ElementType;
  hint: string;
  tone?: "accent" | "blue" | "purple" | "amber";
}

const TONE: Record<NonNullable<Metric["tone"]>, string> = {
  accent: "hsl(var(--accent))",
  blue: "hsl(var(--blue))",
  purple: "hsl(var(--purple))",
  amber: "hsl(var(--amber))",
};

function useCountUp(target: number, duration = 900) {
  const [v, setV] = useState(0);
  const start = useRef<number | null>(null);
  useEffect(() => {
    let raf = 0;
    const step = (t: number) => {
      if (start.current === null) start.current = t;
      const p = Math.min(1, (t - start.current) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setV(target * eased);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    start.current = null;
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return v;
}

function MetricCard({ m, index }: { m: Metric; index: number }) {
  const v = useCountUp(m.value);
  const tone = TONE[m.tone ?? "accent"];
  const positive = m.delta >= 0;
  const formatted =
    (m.prefix ?? "") +
    v.toLocaleString(undefined, {
      minimumFractionDigits: m.decimals ?? 0,
      maximumFractionDigits: m.decimals ?? 0,
    }) +
    (m.suffix ?? "");

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="glass-card group relative overflow-hidden p-4 transition-colors hover:border-border-md"
    >
      <div
        className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full opacity-0 blur-2xl transition-opacity group-hover:opacity-30"
        style={{ background: tone }}
      />
      <div className="flex items-center justify-between">
        <div
          className="flex h-8 w-8 items-center justify-center rounded-lg"
          style={{ background: `${tone.replace("hsl(", "hsl(").replace(")", " / 0.12)")}` }}
        >
          <m.icon className="h-4 w-4" style={{ color: tone }} />
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Info className="h-3.5 w-3.5 cursor-help text-t3 transition-colors hover:text-t1" />
          </TooltipTrigger>
          <TooltipContent side="top">{m.hint}</TooltipContent>
        </Tooltip>
      </div>

      <div className="mt-3 text-[0.72rem] uppercase tracking-wider text-t3">{m.label}</div>
      <div className="display mt-1 text-[1.6rem] font-extrabold leading-none text-t1 tabular-nums">
        {formatted}
      </div>
      <div
        className="mt-2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.68rem] font-medium"
        style={{
          color: positive ? "hsl(var(--green))" : "hsl(var(--red))",
          borderColor: positive ? "hsl(var(--green) / 0.25)" : "hsl(var(--red) / 0.25)",
          background: positive ? "hsl(var(--green) / 0.08)" : "hsl(var(--red) / 0.08)",
        }}
      >
        <TrendingUp className={`h-3 w-3 ${positive ? "" : "rotate-180"}`} />
        {positive ? "+" : ""}
        {m.delta.toFixed(1)}%
      </div>
    </motion.div>
  );
}

export function MetricsBar() {
  const metrics: Metric[] = [
    { label: "Trending Now", value: 1284, delta: 12.4, icon: Zap, hint: "Active trending products tracked across all regions.", tone: "accent" },
    { label: "Avg. Growth", value: 84.6, suffix: "%", decimals: 1, delta: 8.2, icon: TrendingUp, hint: "Mean 7-day growth signal across the watchlist.", tone: "blue" },
    { label: "Unique Buyers (24h)", value: 38_420, delta: 5.7, icon: Users, hint: "Distinct buyers in the past 24 hours.", tone: "purple" },
    { label: "Live Signals", value: 96, suffix: "/min", delta: 22.1, icon: Activity, hint: "Inbound product signals per minute.", tone: "amber" },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {metrics.map((m, i) => (
        <MetricCard key={m.label} m={m} index={i} />
      ))}
    </div>
  );
}
