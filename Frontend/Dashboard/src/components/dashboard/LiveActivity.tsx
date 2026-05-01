import { useState } from "react";
import { MOCK, type ActivityTag } from "@/data/mockOverview";
import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";

const FILTERS: { id: "all" | ActivityTag; label: string }[] = [
  { id: "all", label: "All" },
  { id: "recovery", label: "Recoveries" },
  { id: "cart", label: "Carts" },
  { id: "campaign", label: "Campaigns" },
];

const TAG_TONE: Record<ActivityTag, string> = {
  recovery: "hsl(var(--green))",
  cart: "hsl(var(--amber))",
  campaign: "hsl(var(--blue))",
  subscribe: "hsl(var(--purple))",
};

export function LiveActivity() {
  const [filter, setFilter] = useState<"all" | ActivityTag>("all");
  const items = MOCK.activity.filter((i) => filter === "all" || i.tag === filter);

  return (
    <section className="glass-card flex flex-col p-5">
      <header className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="live-dot" />
          <h3 className="section-title">Live Activity</h3>
        </div>
        <button className="section-action">
          View all <ChevronRight className="h-3 w-3" />
        </button>
      </header>

      <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={cn(
              "shrink-0 rounded-full border px-2.5 py-1 text-[0.7rem] font-medium transition-colors",
              filter === f.id
                ? "border-border-md bg-white/[0.08] text-t1"
                : "border-border bg-white/[0.035] text-t3 hover:text-t1",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex-1 space-y-px overflow-y-auto pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((i) => (
          <div key={i.id} className="flex items-center gap-2.5 rounded-md px-2 py-2 transition-colors hover:bg-white/[0.035]">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: TAG_TONE[i.tag] }} />
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[0.65rem] font-bold"
              style={{ background: "hsl(var(--glass) / 0.07)", borderColor: "hsl(var(--border-soft) / 0.11)", color: "hsl(var(--t1))" }}
            >
              {i.initials}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[0.78rem] text-t1">
                <span className="font-semibold">{i.name}</span> <span className="text-t3">— {i.text}</span>
              </div>
            </div>
            <span className="text-[0.72rem] font-semibold text-t1">{i.amt}</span>
            <span className="ml-2 shrink-0 text-[0.65rem] text-t3">{i.time}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
