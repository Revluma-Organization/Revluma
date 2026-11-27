import { motion } from "framer-motion";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { revTokens, type RevTone } from "@/lib/revTokens";
import {
  describeMetricCard, formatChange, formatRelative, type MetricCard,
} from "@/lib/revVisuals";

/**
 * KPI cards for one Rev answer (commerce component catalog, adoption R5).
 *
 * Every number comes from a retrieved evidence record (see revVisuals), so a
 * card is a lens on the ledger, never a new claim. Direction is shown with an
 * arrow and words, not colour alone, and it is never judged as good or bad:
 * refunds going up and revenue going up look the same here, because deciding
 * which is "good" would be Rev inventing an interpretation.
 */
export function RevMetricCards({ cards, tone = "light", onOpen }: {
  cards: MetricCard[];
  tone?: RevTone;
  onOpen?: (evidenceId?: string) => void;
}) {
  const t = revTokens(tone);
  const dark = tone === "dark";
  if (!cards.length) return null;
  const periods = [...new Set(cards.map(card => card.period))];
  const compared = cards.find(card => card.change)?.change?.previousPeriod;

  return (
    <section aria-label="Key numbers" data-rev-metric-cards className="flex flex-col gap-2">
      <ul className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${cards.length === 4 ? 240 : 168}px), 1fr))`, margin: 0, padding: 0, listStyle: "none" }}>
        {cards.map((card, index) => {
          const change = card.change;
          const Arrow = !change ? null : change.direction === "up" ? ArrowUpRight : change.direction === "down" ? ArrowDownRight : Minus;
          const relative = change ? formatRelative(change) : null;
          const max = change ? Math.max(Math.abs(card.value), Math.abs(change.previousValue)) : 0;
          const nowWidth = max > 0 ? Math.max(4, (Math.abs(card.value) / max) * 100) : 0;
          const beforeWidth = change && max > 0 ? Math.max(4, (Math.abs(change.previousValue) / max) * 100) : 0;
          const trustLabel = card.trust === "partial" ? "Partial data" : card.trust === "unverified" ? "Unverified" : null;
          return (
            <motion.li
              key={card.id || card.metric}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, delay: index * 0.04, ease: "easeOut" }}
              style={{ minWidth: 0 }}
            >
              <button
                type="button"
                onClick={() => onOpen?.(card.id || undefined)}
                disabled={!onOpen}
                aria-label={`${describeMetricCard(card)}${trustLabel ? ` ${trustLabel}.` : ""}${onOpen ? " Open evidence." : ""}`}
                className="rev-metric-card group flex h-full w-full flex-col gap-1.5 text-left transition-[transform,box-shadow,border-color] duration-150 enabled:hover:-translate-y-px disabled:cursor-default"
                style={{
                  minHeight: 44, padding: "13px 14px 12px", borderRadius: 16,
                  background: dark ? "rgba(255,255,255,0.035)" : "#FFFFFF",
                  border: `1px solid ${t.border}`,
                  boxShadow: dark ? "none" : "0 1px 2px rgba(16,24,40,0.04)",
                  cursor: onOpen ? "pointer" : "default", font: "inherit", color: "inherit",
                }}
              >
                <span className="flex w-full items-center gap-2" aria-hidden="true">
                  <span className="truncate" style={{ fontSize: "0.72rem", fontWeight: 600, color: t.muted }}>{card.label}</span>
                  {trustLabel && (
                    <span style={{ marginLeft: "auto", fontSize: "0.6rem", fontWeight: 700, color: "#B54708", whiteSpace: "nowrap" }}>{trustLabel}</span>
                  )}
                </span>
                <span aria-hidden="true" className="tabular-nums" style={{ fontSize: "1.32rem", lineHeight: 1.15, fontWeight: 700, letterSpacing: "-0.015em", color: t.strong, overflowWrap: "anywhere" }}>
                  {card.valueText}
                </span>
                {change && Arrow && (
                  <span aria-hidden="true" className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 tabular-nums" style={{ fontSize: "0.72rem", color: t.body }}>
                    <span className="inline-flex items-center gap-0.5" style={{ fontWeight: 650 }}>
                      <Arrow size={13} strokeWidth={2.2} />
                      {change.direction === "flat" ? "No change" : formatChange(card, change)}
                    </span>
                    {relative && change.direction !== "flat" && <span style={{ color: t.muted }}>({relative})</span>}
                    <span style={{ color: t.muted }}>vs previous</span>
                  </span>
                )}
                {change && max > 0 && (
                  <span aria-hidden="true" className="mt-1 flex w-full flex-col gap-1">
                    <span className="flex items-center gap-2">
                      <span style={{ width: 46, flexShrink: 0, fontSize: "0.6rem", color: t.muted }}>Now</span>
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: dark ? "rgba(255,255,255,0.06)" : "#F2F4F7" }}>
                        <motion.span className="block h-full rounded-full" style={{ background: dark ? "#7C6CFF" : "#1F06AC" }}
                          initial={{ width: 0 }} animate={{ width: `${nowWidth}%` }} transition={{ duration: 0.45, delay: 0.1 + index * 0.04, ease: [0.22, 1, 0.36, 1] }} />
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span style={{ width: 46, flexShrink: 0, fontSize: "0.6rem", color: t.muted }}>Before</span>
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: dark ? "rgba(255,255,255,0.06)" : "#F2F4F7" }}>
                        <motion.span className="block h-full rounded-full" style={{ background: dark ? "#667085" : "#98A2B3" }}
                          initial={{ width: 0 }} animate={{ width: `${beforeWidth}%` }} transition={{ duration: 0.45, delay: 0.14 + index * 0.04, ease: [0.22, 1, 0.36, 1] }} />
                      </span>
                    </span>
                  </span>
                )}
              </button>
            </motion.li>
          );
        })}
      </ul>
      <p style={{ margin: 0, fontSize: "0.66rem", color: t.muted }}>
        {periods.length === 1 ? periods[0] : "Several periods"}
        {compared ? ` · compared with ${compared}` : ""}
        {" · from retrieved store records"}
      </p>
    </section>
  );
}

export default RevMetricCards;
