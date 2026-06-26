import type { DonutSlice } from "@/data/mockOverview";

interface Props {
  slices: DonutSlice[] | null;
  total: string | null;
  loading?: boolean;
}

export function RevenueAttribution({ slices, total, loading }: Props) {
  // Build SVG donut segments (same logic as original)
  const r = 56, c = 2 * Math.PI * r, cx = 70, cy = 70, w = 14;
  const totalVal = slices?.reduce((s, x) => s + x.value, 0) ?? 0;
  let offset = 0;
  const segs = (slices ?? []).map((s) => {
    const len = (s.value / (totalVal || 1)) * c;
    const seg = { ...s, dasharray: `${len} ${c - len}`, dashoffset: -offset };
    offset += len;
    return seg;
  });

  return (
    <section className="glass-card flex flex-col p-5">
      <header className="mb-4">
        <h3 className="section-title">Revenue Attribution</h3>
      </header>

      <div className="relative mx-auto mb-4 h-[140px] w-[140px]">
        {loading || !slices ? (
          <div className="h-full w-full animate-pulse rounded-full bg-bg-4" />
        ) : (
          <svg viewBox="0 0 140 140" className="-rotate-90 transform">
            <circle cx={cx} cy={cy} r={r} fill="none" stroke="hsl(var(--bg-4))" strokeWidth={w} />
            {segs.map((s, i) => (
              <circle
                key={i}
                cx={cx} cy={cy} r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={w}
                strokeDasharray={s.dasharray}
                strokeDashoffset={s.dashoffset}
                strokeLinecap="butt"
                style={{ transition: "stroke-dasharray 0.6s ease" }}
              />
            ))}
          </svg>
        )}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <div className="display text-[1.05rem] font-extrabold text-t1">
            {loading || !total ? <span className="text-t3">--</span> : total}
          </div>
          <div className="text-[0.6rem] uppercase tracking-wider text-t3">Recovered</div>
        </div>
      </div>

      <ul className="space-y-2">
        {loading || !slices
          ? Array.from({ length: 4 }).map((_, i) => (
              <li key={i} className="flex items-center justify-between">
                <div className="h-3 w-32 animate-pulse rounded bg-bg-4" />
                <div className="h-3 w-8 animate-pulse rounded bg-bg-4" />
              </li>
            ))
          : slices.map((s) => (
              <li key={s.label} className="flex items-center justify-between text-[0.74rem]">
                <span className="flex items-center gap-2 text-t2">
                  <span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />
                  {s.label}
                </span>
                <span className="font-semibold text-t1">{s.value}%</span>
              </li>
            ))}
      </ul>
    </section>
  );
}
