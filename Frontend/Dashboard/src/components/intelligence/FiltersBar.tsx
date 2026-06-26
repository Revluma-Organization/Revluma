import { Search } from "lucide-react";
import { CATEGORIES, REGIONS, type Category, type Region } from "@/data/mockTrending";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export type SortKey = "growth" | "volume" | "price" | "rank";

interface Props {
  query: string;
  onQuery: (v: string) => void;
  region: Region | "All";
  onRegion: (v: Region | "All") => void;
  category: Category | "All";
  onCategory: (v: Category | "All") => void;
  sort: SortKey;
  onSort: (v: SortKey) => void;
}

export function FiltersBar({
  query, onQuery, region, onRegion, category, onCategory, sort, onSort,
}: Props) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="relative w-full lg:max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-t3" />
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search product, brand, category…"
          className="h-9 w-full rounded-lg border bg-bg-2 pl-9 pr-3 text-[0.82rem] text-t1 outline-none transition-colors placeholder:text-t3 focus:border-border-md"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={region} onValueChange={(v) => onRegion(v as Region | "All")}>
          <SelectTrigger className="h-9 w-[130px] border-border bg-bg-2 text-[0.78rem]">
            <SelectValue placeholder="Region" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All regions</SelectItem>
            {REGIONS.map((r) => (
              <SelectItem key={r} value={r}>{r}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={category} onValueChange={(v) => onCategory(v as Category | "All")}>
          <SelectTrigger className="h-9 w-[150px] border-border bg-bg-2 text-[0.78rem]">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All categories</SelectItem>
            {CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={sort} onValueChange={(v) => onSort(v as SortKey)}>
          <SelectTrigger className="h-9 w-[150px] border-border bg-bg-2 text-[0.78rem]">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="growth">Sort: Growth</SelectItem>
            <SelectItem value="volume">Sort: Volume</SelectItem>
            <SelectItem value="price">Sort: Price</SelectItem>
            <SelectItem value="rank">Sort: Rank</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
