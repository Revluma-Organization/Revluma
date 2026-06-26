import type { ProductRow } from "@/data/mockOverview";
import { Monitor, ShoppingBag, Globe, Footprints, Home, ChevronRight } from "lucide-react";

const ICONS: Record<ProductRow["iconKey"], React.ElementType> = {
  monitor: Monitor, bag: ShoppingBag, globe: Globe, shoe: Footprints, home: Home,
};

const STATUS_TONE: Record<ProductRow["status"], { bg: string; color: string; label: string }> = {
  recovered:  { bg: "hsl(var(--green) / 0.10)", color: "hsl(var(--green))", label: "Recovered" },
  insequence: { bg: "hsl(var(--blue) / 0.10)",  color: "hsl(var(--blue))",  label: "In sequence" },
  lost:       { bg: "hsl(var(--red) / 0.10)",   color: "hsl(var(--red))",   label: "Lost" },
};

interface Props {
  products: ProductRow[] | null;
  loading?: boolean;
}

export function AbandonedProducts({ products, loading }: Props) {
  return (
    <section className="glass-card p-5">
      <header className="mb-4 flex items-center justify-between">
        <h3 className="section-title">Top Abandoned Products</h3>
        <button className="section-action">
          View all <ChevronRight className="h-3 w-3" />
        </button>
      </header>

      <div className="space-y-1">
        {loading || !products
          ? Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 rounded-lg px-2 py-2.5">
                <div className="h-4 w-5 animate-pulse rounded bg-bg-4" />
                <div className="h-9 w-9 animate-pulse rounded-md bg-bg-4" />
                <div className="flex-1">
                  <div className="h-3 w-36 animate-pulse rounded bg-bg-4" />
                  <div className="mt-1.5 h-2.5 w-20 animate-pulse rounded bg-bg-4" />
                </div>
                <div className="text-right">
                  <div className="h-3 w-14 animate-pulse rounded bg-bg-4" />
                  <div className="mt-1.5 h-4 w-16 animate-pulse rounded-full bg-bg-4" />
                </div>
              </div>
            ))
          : products.map((p) => {
              const Icon = ICONS[p.iconKey];
              const tone = STATUS_TONE[p.status];
              return (
                <div
                  key={p.rank}
                  className="flex items-center gap-3 rounded-lg border border-transparent px-2 py-2.5 transition-colors hover:border-border hover:bg-white/[0.025]"
                >
                  <span className="w-5 text-center text-[0.72rem] font-bold text-t3">{p.rank}</span>
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border"
                    style={{ background: "hsl(var(--glass) / 0.035)", borderColor: "hsl(var(--border-soft) / 0.07)" }}
                  >
                    <Icon className="h-4 w-4 text-t2" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[0.82rem] font-medium text-t1">{p.name}</div>
                    <div className="text-[0.68rem] text-t3">{p.abandoned} abandoned</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[0.82rem] font-semibold text-t1">{p.amt}</div>
                    <span
                      className="mt-0.5 inline-block rounded-full px-1.5 py-px text-[0.58rem] font-bold uppercase tracking-wider"
                      style={{ background: tone.bg, color: tone.color }}
                    >
                      {tone.label}
                    </span>
                  </div>
                </div>
              );
            })}
      </div>
    </section>
  );
}
