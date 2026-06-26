import { motion } from "framer-motion";
import { Flame, TrendingUp, ArrowUpRight } from "lucide-react";
import { TrendSparkline } from "./TrendSparkline";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { TrendingProduct } from "@/data/mockTrending";

const VELOCITY_TONE: Record<TrendingProduct["velocity"], string> = {
  Surging: "hsl(var(--accent))",
  Climbing: "hsl(var(--blue))",
  Steady: "hsl(var(--t2))",
  Cooling: "hsl(var(--amber))",
};

function formatNum(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toString();
}

interface Props {
  product: TrendingProduct;
  index: number;
}

export function ProductRow({ product: p, index }: Props) {
  const positive = p.growth >= 0;
  const tone = VELOCITY_TONE[p.velocity];

  return (
    <motion.tr
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      className="group border-b border-border transition-colors hover:bg-bg-3/40"
    >
      {/* Rank + Product */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="display w-6 shrink-0 text-[0.78rem] font-bold text-t3 tabular-nums">
            {String(p.rank).padStart(2, "0")}
          </span>
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border text-base"
            style={{
              background: "hsl(var(--bg-3))",
              borderColor: "hsl(var(--border-soft) / 0.08)",
            }}
            aria-hidden
          >
            {p.emoji}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[0.86rem] font-semibold text-t1">{p.name}</span>
              {p.hot && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[0.6rem] font-bold uppercase tracking-wider"
                      style={{
                        color: "hsl(var(--accent))",
                        borderColor: "hsl(var(--accent) / 0.3)",
                        background: "hsl(var(--accent) / 0.1)",
                      }}
                    >
                      <Flame className="h-2.5 w-2.5" />
                      Hot
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Top 5% growth this week.</TooltipContent>
                </Tooltip>
              )}
            </div>
            <div className="truncate text-[0.72rem] text-t3">
              {p.brand} · {p.category}
            </div>
          </div>
        </div>
      </td>

      {/* Region */}
      <td className="hidden px-4 py-3 md:table-cell">
        <span className="pill">{p.region}</span>
      </td>

      {/* Price */}
      <td className="hidden px-4 py-3 lg:table-cell">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-[0.84rem] font-medium text-t1 tabular-nums">${p.price}</span>
          </TooltipTrigger>
          <TooltipContent>Average list price across stores.</TooltipContent>
        </Tooltip>
      </td>

      {/* Volume */}
      <td className="hidden px-4 py-3 sm:table-cell">
        <div className="flex flex-col">
          <span className="text-[0.84rem] font-medium text-t1 tabular-nums">
            {formatNum(p.searchVolume)}
          </span>
          <span
            className="text-[0.68rem] tabular-nums"
            style={{ color: p.volumeDelta >= 0 ? "hsl(var(--green))" : "hsl(var(--red))" }}
          >
            {p.volumeDelta >= 0 ? "+" : ""}
            {p.volumeDelta.toFixed(1)}%
          </span>
        </div>
      </td>

      {/* Growth + sparkline */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1.5">
                <TrendingUp
                  className={`h-3.5 w-3.5 ${positive ? "" : "rotate-180"}`}
                  style={{ color: positive ? "hsl(var(--green))" : "hsl(var(--red))" }}
                />
                <span
                  className="display text-[0.92rem] font-bold tabular-nums"
                  style={{ color: positive ? "hsl(var(--green))" : "hsl(var(--red))" }}
                >
                  {positive ? "+" : ""}
                  {p.growth.toFixed(1)}%
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent>7-day growth signal vs prior period.</TooltipContent>
          </Tooltip>
          <div className="hidden w-24 sm:block">
            <TrendSparkline data={p.spark} positive={positive} id={p.id} />
          </div>
        </div>
      </td>

      {/* Velocity */}
      <td className="hidden px-4 py-3 xl:table-cell">
        <span
          className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[0.7rem] font-medium"
          style={{
            color: tone,
            borderColor: `${tone.replace(")", " / 0.25)")}`,
            background: `${tone.replace(")", " / 0.08)")}`,
          }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: tone }} />
          {p.velocity}
        </span>
      </td>

      {/* Action */}
      <td className="px-4 py-3 text-right">
        <button
          className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-[0.72rem] font-medium text-t2 opacity-0 transition-all hover:border-border-md hover:text-t1 group-hover:opacity-100"
          aria-label={`Inspect ${p.name}`}
        >
          Inspect
          <ArrowUpRight className="h-3 w-3" />
        </button>
      </td>
    </motion.tr>
  );
}
