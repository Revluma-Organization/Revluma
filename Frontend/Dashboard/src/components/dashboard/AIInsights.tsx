import { MOCK, type AIInsight } from "@/data/mockOverview";
import { Clock, Phone, Star, ChevronRight, Sparkles } from "lucide-react";

const ICONS: Record<AIInsight["iconKey"], { Icon: React.ElementType; tone: string; bg: string; border: string }> = {
  timing:     { Icon: Clock, tone: "hsl(var(--amber))",  bg: "hsl(var(--amber) / 0.10)",  border: "hsl(var(--amber) / 0.22)" },
  behavior:   { Icon: Phone, tone: "hsl(var(--green))",  bg: "hsl(var(--green) / 0.10)",  border: "hsl(var(--green) / 0.22)" },
  prediction: { Icon: Star,  tone: "hsl(var(--purple))", bg: "hsl(var(--purple) / 0.10)", border: "hsl(var(--purple) / 0.22)" },
};

export function AIInsights() {
  return (
    <section className="glass-card p-5">
      <header className="mb-4 flex items-center gap-2">
        <span
          className="flex h-7 w-7 items-center justify-center rounded-md border"
          style={{ background: "hsl(var(--accent) / 0.12)", borderColor: "hsl(var(--accent) / 0.25)" }}
        >
          <Sparkles className="h-3.5 w-3.5" style={{ color: "hsl(var(--accent))" }} />
        </span>
        <h3 className="section-title">AI Insights</h3>
        <span className="pill text-[0.55rem] uppercase tracking-wider" style={{ color: "hsl(var(--accent))" }}>
          AI
        </span>
      </header>

      <div className="space-y-3">
        {MOCK.insights.map((i) => {
          const { Icon, tone, bg, border } = ICONS[i.iconKey];
          return (
            <div key={i.id} className="flex gap-3 rounded-lg border border-border p-3 transition-colors hover:border-border-md">
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border"
                style={{ background: bg, borderColor: border }}
              >
                <Icon className="h-3.5 w-3.5" style={{ color: tone }} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[0.78rem] leading-relaxed text-t1" dangerouslySetInnerHTML={{ __html: i.textHTML }} />
                <button className="mt-1.5 inline-flex items-center gap-1 text-[0.72rem] font-semibold accent-text transition-opacity hover:opacity-80">
                  {i.cta} <ChevronRight className="h-3 w-3" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
