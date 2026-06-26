import type { Health } from "@/data/mockOverview";
import { Info } from "lucide-react";

interface Props {
  health: Health | null;
  loading?: boolean;
}

export function HealthScore({ health, loading }: Props) {
  const score = health?.score ?? null;
  const grade = health?.grade ?? null;
  const subs  = health?.subs  ?? null;

  const pathLen = 157;
  const offset = score !== null ? pathLen - (score / 100) * pathLen : pathLen;
  const gradeTone =
    score === null         ? "hsl(var(--bg-4))"
    : score >= 80          ? "hsl(var(--green))"
    : score >= 60          ? "hsl(var(--accent))"
    : score >= 40          ? "hsl(var(--amber))"
    :                        "hsl(var(--red))";

  return (
    <section className="glass-card flex flex-col p-5">
      <header className="mb-4 flex items-center justify-between">
        <h3 className="section-title">Store Health</h3>
        <button
          className="text-t3 transition-colors hover:text-t1"
          title="Recovery 30% + Deliverability 20% + Subscribers 20% + AOV 15% + Abandonment 15%"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </header>

      <div className="relative mx-auto mb-3 h-[80px] w-[140px]">
        <svg viewBox="0 0 120 70" className="h-full w-full">
          <path d="M10 65 A50 50 0 0 1 110 65" fill="none" stroke="hsl(var(--bg-4))" strokeWidth={8} strokeLinecap="round" />
          <path
            d="M10 65 A50 50 0 0 1 110 65"
            fill="none"
            stroke={gradeTone}
            strokeWidth={8}
            strokeLinecap="round"
            strokeDasharray={pathLen}
            strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 1.2s ease, stroke 0.5s ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-end pb-1">
          <div className="display text-[1.6rem] font-extrabold leading-none" style={{ color: gradeTone }}>
            {loading || score === null
              ? <span className="text-[1.2rem] animate-pulse text-t3">--</span>
              : score}
          </div>
          <div className="mt-0.5 text-[0.65rem] font-bold uppercase tracking-wider text-t2">
            Grade {grade ?? "--"}
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {loading || !subs
          ? Array.from({ length: 5 }).map((_, i) => (
              <div key={i}>
                <div className="mb-1 flex items-center justify-between">
                  <div className="h-2.5 w-32 animate-pulse rounded bg-bg-4" />
                  <div className="h-2.5 w-10 animate-pulse rounded bg-bg-4" />
                </div>
                <div className="h-1 w-full animate-pulse rounded-full bg-bg-4" />
              </div>
            ))
          : subs.map((s) => (
              <div key={s.label}>
                <div className="mb-1 flex items-center justify-between text-[0.72rem]">
                  <span className="text-t2">{s.label}</span>
                  <span className="font-semibold text-t1">{s.score}</span>
                </div>
                <div className="h-1 overflow-hidden rounded-full" style={{ background: "hsl(var(--bg-4))" }}>
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${s.val}%`,
                      background: s.val >= 70 ? "hsl(var(--accent))" : s.val >= 50 ? "hsl(var(--amber))" : "hsl(var(--red))",
                      transition: "width 0.8s ease",
                    }}
                  />
                </div>
              </div>
            ))}
      </div>
    </section>
  );
}
