import { useMemo, useState } from "react";
import { ProductRow } from "./ProductRow";
import { Skeleton } from "@/components/ui/skeleton";
import { FiltersBar, type SortKey } from "./FiltersBar";
import type { Category, Region, TrendingProduct } from "@/data/mockTrending";

interface Props {
  data: TrendingProduct[] | undefined;
  loading: boolean;
}

const PAGE_SIZE = 8;

export function TrendingTable({ data, loading }: Props) {
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState<Region | "All">("All");
  const [category, setCategory] = useState<Category | "All">("All");
  const [sort, setSort] = useState<SortKey>("growth");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const list = (data ?? []).filter((p) => {
      if (region !== "All" && p.region !== region) return false;
      if (category !== "All" && p.category !== category) return false;
      if (query.trim()) {
        const q = query.toLowerCase();
        if (
          !p.name.toLowerCase().includes(q) &&
          !p.brand.toLowerCase().includes(q) &&
          !p.category.toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });
    const sorted = [...list].sort((a, b) => {
      switch (sort) {
        case "growth": return b.growth - a.growth;
        case "volume": return b.searchVolume - a.searchVolume;
        case "price":  return b.price - a.price;
        case "rank":   return a.rank - b.rank;
      }
    });
    return sorted;
  }, [data, region, category, query, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div className="glass-card overflow-hidden">
      <div className="border-b border-border p-4">
        <FiltersBar
          query={query}
          onQuery={(v) => { setQuery(v); setPage(1); }}
          region={region}
          onRegion={(v) => { setRegion(v); setPage(1); }}
          category={category}
          onCategory={(v) => { setCategory(v); setPage(1); }}
          sort={sort}
          onSort={setSort}
        />
      </div>

      <div className="relative w-full overflow-x-auto">
        <table className="w-full text-left">
          <thead className="sticky top-0 z-10 bg-bg-2/95 backdrop-blur">
            <tr className="border-b border-border text-[0.7rem] uppercase tracking-wider text-t3">
              <th className="px-4 py-3 font-medium">Product</th>
              <th className="hidden px-4 py-3 font-medium md:table-cell">Region</th>
              <th className="hidden px-4 py-3 font-medium lg:table-cell">Price</th>
              <th className="hidden px-4 py-3 font-medium sm:table-cell">Volume</th>
              <th className="px-4 py-3 font-medium">Growth</th>
              <th className="hidden px-4 py-3 font-medium xl:table-cell">Velocity</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="border-b border-border">
                  <td className="px-4 py-3"><Skeleton className="h-9 w-full" /></td>
                  <td className="hidden px-4 py-3 md:table-cell"><Skeleton className="h-5 w-16" /></td>
                  <td className="hidden px-4 py-3 lg:table-cell"><Skeleton className="h-5 w-12" /></td>
                  <td className="hidden px-4 py-3 sm:table-cell"><Skeleton className="h-5 w-16" /></td>
                  <td className="px-4 py-3"><Skeleton className="h-5 w-32" /></td>
                  <td className="hidden px-4 py-3 xl:table-cell"><Skeleton className="h-5 w-20" /></td>
                  <td className="px-4 py-3"><Skeleton className="h-7 w-16 ml-auto" /></td>
                </tr>
              ))}
            {!loading && pageItems.map((p, i) => (
              <ProductRow key={p.id} product={p} index={i} />
            ))}
            {!loading && pageItems.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-16 text-center text-[0.85rem] text-t3">
                  No products match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {!loading && filtered.length > PAGE_SIZE && (
        <div className="flex items-center justify-between border-t border-border px-4 py-3 text-[0.74rem] text-t3">
          <span>
            Showing <span className="text-t1">{(safePage - 1) * PAGE_SIZE + 1}</span>–
            <span className="text-t1">{Math.min(safePage * PAGE_SIZE, filtered.length)}</span> of{" "}
            <span className="text-t1">{filtered.length}</span>
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage === 1}
              className="rounded-md border border-border px-2.5 py-1 transition-colors hover:border-border-md hover:text-t1 disabled:opacity-40"
            >
              Prev
            </button>
            <span className="px-2 text-t2 tabular-nums">{safePage} / {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage === totalPages}
              className="rounded-md border border-border px-2.5 py-1 transition-colors hover:border-border-md hover:text-t1 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
