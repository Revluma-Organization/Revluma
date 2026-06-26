import { motion } from "framer-motion";
import { Sparkles, RefreshCw } from "lucide-react";
import { MetricsBar } from "@/components/intelligence/MetricsBar";
import { TrendingTable } from "@/components/intelligence/TrendingTable";
import { useTrendingProducts } from "@/hooks/useTrendingProducts";

export default function Intelligence() {
  const { data, isLoading, isFetching, refetch, dataUpdatedAt } = useTrendingProducts();

  const updated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "—";

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <motion.header
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"
      >
        <div>
          <div className="flex items-center gap-2">
            <span
              className="flex h-7 w-7 items-center justify-center rounded-lg"
              style={{ background: "hsl(var(--accent) / 0.12)" }}
            >
              <Sparkles className="h-3.5 w-3.5" style={{ color: "hsl(var(--accent))" }} />
            </span>
            <span className="pill">
              <span className="live-dot" />
              Live intelligence
            </span>
          </div>
          <h1 className="display mt-2 text-[1.7rem] font-extrabold tracking-tight text-t1 sm:text-[2rem]">
            Trending Products
          </h1>
          <p className="mt-1 max-w-xl text-[0.85rem] text-t2">
            Real-time market signals, growth velocity, and category momentum across your connected
            stores.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[0.72rem] text-t3">Last updated {updated}</span>
          <button
            onClick={() => refetch()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-bg-2 px-3 py-1.5 text-[0.78rem] font-medium text-t2 transition-colors hover:border-border-md hover:text-t1"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </motion.header>

      {/* Metrics */}
      <MetricsBar />

      {/* Trending Table */}
      <TrendingTable data={data} loading={isLoading} />
    </div>
  );
}
