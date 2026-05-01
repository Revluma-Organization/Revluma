import { MOCK, type InnovationCard } from "@/data/mockOverview";
import { Users, Zap, Mail, TrendingUp } from "lucide-react";

const ICONS: Record<InnovationCard["iconKey"], React.ElementType> = {
  users: Users, bolt: Zap, mail: Mail, trend: TrendingUp,
};

const TONE: Record<InnovationCard["iconColor"], string> = {
  green: "hsl(var(--green))",
  blue: "hsl(var(--blue))",
  amber: "hsl(var(--amber))",
  purple: "hsl(var(--purple))",
  red: "hsl(var(--red))",
};

export function AnalyticsStrip() {
  return (
    <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {MOCK.analytics.map((a) => (
        <div key={a.label} className="glass-card p-4">
          <div className="text-[0.62rem] font-bold uppercase tracking-[0.11em] text-t4">{a.label}</div>
          <div className="display mt-2 text-[1.3rem] font-extrabold text-t1">{a.value}</div>
          <div className="mt-1 text-[0.66rem] text-t3">{a.sub}</div>
        </div>
      ))}
    </section>
  );
}

export function InnovationRow() {
  return (
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {MOCK.innovation.map((c) => {
        const Icon = ICONS[c.iconKey];
        const color = TONE[c.iconColor];
        return (
          <div key={c.label} className="glass-card p-4">
            <header className="mb-3 flex items-center gap-2">
              <span
                className="flex h-7 w-7 items-center justify-center rounded-md border"
                style={{
                  background: `${color.replace("hsl(", "hsl(").replace(")", " / 0.10)")}`,
                  borderColor: color.replace(")", " / 0.22)"),
                }}
              >
                <Icon className="h-3.5 w-3.5" style={{ color }} />
              </span>
              <div className="text-[0.7rem] font-semibold text-t2">{c.label}</div>
            </header>
            <div className="display text-[1.4rem] font-extrabold text-t1">{c.value}</div>
            <div className="mt-1 text-[0.66rem] text-t3">{c.sub}</div>
            {c.barVal > 0 && (
              <div className="mt-3 h-1 overflow-hidden rounded-full" style={{ background: "hsl(var(--bg-4))" }}>
                <div className="h-full rounded-full" style={{ width: `${c.barVal}%`, background: color, transition: "width 0.8s ease" }} />
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
