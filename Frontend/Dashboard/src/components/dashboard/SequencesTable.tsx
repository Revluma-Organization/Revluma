import type { SequenceRow } from "@/data/mockOverview";
import { TrendingUp, Mail, MessageSquare } from "lucide-react";

interface Props {
  sequences: SequenceRow[] | null;
  loading?: boolean;
}

export function SequencesTable({ sequences, loading }: Props) {
  return (
    <section className="glass-card p-5">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="section-title">Recovery Email Sequences</h3>
        <span className="pill">
          <TrendingUp className="h-3 w-3" style={{ color: "hsl(var(--accent))" }} />
          Revluma 2026 benchmarks
        </span>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left">
          <thead>
            <tr className="text-[0.62rem] font-bold uppercase tracking-[0.11em] text-t4">
              <th className="pb-3 pl-1">Sequence</th>
              <th className="pb-3 text-right">Sent</th>
              <th className="pb-3 text-right">Open</th>
              <th className="pb-3 text-right">Click</th>
              <th className="pb-3 text-right">Conv.</th>
              <th className="pb-3 pr-1 text-right">Rev / Recipient</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading || !sequences
              ? Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    <td className="py-3 pl-1">
                      <div className="flex items-center gap-2.5">
                        <div className="h-7 w-7 animate-pulse rounded-md bg-bg-4" />
                        <div>
                          <div className="h-3 w-48 animate-pulse rounded bg-bg-4" />
                          <div className="mt-1.5 h-2 w-36 animate-pulse rounded bg-bg-4" />
                        </div>
                      </div>
                    </td>
                    {Array.from({ length: 5 }).map((_, j) => (
                      <td key={j} className="py-3 text-right">
                        <div className="ml-auto h-3 w-12 animate-pulse rounded bg-bg-4" />
                      </td>
                    ))}
                  </tr>
                ))
              : sequences.map((s) => {
                  const Icon = s.channel === "email" ? Mail : MessageSquare;
                  const tone = s.channel === "email" ? "hsl(var(--blue))" : "hsl(var(--accent))";
                  return (
                    <tr key={s.name} className="text-[0.78rem] text-t1">
                      <td className="py-3 pl-1">
                        <div className="flex items-center gap-2.5">
                          <span
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border"
                            style={{
                              background: s.channel === "email" ? "hsl(var(--blue) / 0.10)" : "hsl(var(--accent) / 0.12)",
                              borderColor: s.channel === "email" ? "hsl(var(--blue) / 0.22)" : "hsl(var(--accent) / 0.25)",
                            }}
                          >
                            <Icon className="h-3.5 w-3.5" style={{ color: tone }} />
                          </span>
                          <div>
                            <div className="font-medium">{s.name}</div>
                            <div className="mt-1 flex items-center gap-2 text-[0.65rem] text-t3">
                              <span>Benchmark {s.bench.open}%</span>
                              <span className="h-1 flex-1 overflow-hidden rounded-full" style={{ background: "hsl(var(--bg-4))", minWidth: 60 }}>
                                <span
                                  className="block h-full rounded-full"
                                  style={{
                                    width: `${Math.min(100, (s.bench.ours / s.bench.open) * 100)}%`,
                                    background: "linear-gradient(90deg, hsl(var(--accent)), hsl(var(--accent-2)))",
                                  }}
                                />
                              </span>
                              <span className="font-semibold text-t1">{s.bench.ours}%</span>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 text-right tabular-nums text-t2">{s.sent}</td>
                      <td className="py-3 text-right tabular-nums">{s.open}</td>
                      <td className="py-3 text-right tabular-nums">{s.click}</td>
                      <td className="py-3 text-right tabular-nums">{s.conv}</td>
                      <td className="py-3 pr-1 text-right font-semibold accent-text">{s.rpr}</td>
                    </tr>
                  );
                })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
