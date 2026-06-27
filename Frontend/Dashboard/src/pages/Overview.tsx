// src/pages/Overview.tsx
// All MOCK references replaced with useState hooks initialised to null.
// Loading state  → skeleton placeholders (visual match to current UI)
// Error state    → neutral "--" via error flag
// Visual output  → IDENTICAL to mock version
// Week 3 wiring: uncomment fetchDashboard(), delete the setLoading(false) stub.

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { ConnectBanner } from "@/components/dashboard/ConnectBanner";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { RevenueChart } from "@/components/dashboard/RevenueChart";
import { LiveActivity } from "@/components/dashboard/LiveActivity";
import { SequencesTable } from "@/components/dashboard/SequencesTable";
import { AbandonedProducts } from "@/components/dashboard/AbandonedProducts";
import { AIInsights } from "@/components/dashboard/AIInsights";
import { RevenueAttribution } from "@/components/dashboard/RevenueAttribution";
import { HealthScore } from "@/components/dashboard/HealthScore";
import { AnalyticsStrip, InnovationRow } from "@/components/dashboard/Strips";
import { QuickActions, TrendingProducts, WinbackLeaderboard } from "@/components/dashboard/BottomGrid";
import { 
  MOCK_OVERVIEW_DATA,
  type
  KPI,
  ActivityItem,
  SequenceRow,
  ProductRow,
  DonutSlice,
  Health,
  AnalyticTile,
  InnovationCard,
  ChartData,
  AIInsight,
  Trending,
  WinbackEntry,
} from "@/data/mockOverview";

export default function Overview() {
  //State hooks: one per data group from DASHBOARD_DATA_MAP.md
  const [userName, setUserName]                     = useState<string | null>("Alex Johnson");
  const [kpi, setKpi]                               = useState<KPI[] | null>(MOCK_OVERVIEW_DATA.kpi);
  const [chart, setChart]                           = useState<ChartData | null>(MOCK_OVERVIEW_DATA.chart);
  const [activity, setActivity]                     = useState<ActivityItem[] | null>(MOCK_OVERVIEW_DATA.activity);
  const [sequences, setSequences]                   = useState<SequenceRow[] | null>(MOCK_OVERVIEW_DATA.sequences);
  const [abandonedProducts, setAbandonedProducts]   = useState<ProductRow[] | null>(MOCK_OVERVIEW_DATA.abandonedProducts);
  const [donutSlices, setDonutSlices]               = useState<DonutSlice[] | null>(MOCK_OVERVIEW_DATA.donutSlices);
  const [donutTotal, setDonutTotal]                 = useState<string | null>(MOCK_OVERVIEW_DATA.donutTotal);
  const [health, setHealth]                         = useState<Health | null>(MOCK_OVERVIEW_DATA.health);
  const [analytics, setAnalytics]                   = useState<AnalyticTile[] | null>(MOCK_OVERVIEW_DATA.analytics);
  const [innovation, setInnovation]                 = useState<InnovationCard[] | null>(MOCK_OVERVIEW_DATA.innovation);
  const [trendingProducts, setTrendingProducts]     = useState<Trending[] | null>(MOCK_OVERVIEW_DATA.trending);
  const [winback, setWinback]                       = useState<WinbackEntry[] | null>(MOCK_OVERVIEW_DATA.winback);
  const [insights, setInsights]                     = useState<AIInsight[] | null>(MOCK_OVERVIEW_DATA.insights);
  const [storeConnected, setStoreConnected]         = useState<boolean | null>(true);

  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    // TODO Week 3: replace stub with real fetches 
    // import { api } from "@/lib/api";
    //
    // async function fetchDashboard() {
    //   try {
    //     const [
    //       meRes, kpiRes, chartRes, activityRes, attrRes,
    //       healthRes, analyticsRes, innovationRes, trendingRes,
    //       winbackRes, abandonedRes, insightsRes, seqRes, storesRes,
    //     ] = await Promise.all([
    //       api.get("/auth/me"),
    //       api.get("/dashboard/kpis"),
    //       api.get("/dashboard/chart"),
    //       api.get("/dashboard/activity", { limit: 20 }),
    //       api.get("/dashboard/attribution"),
    //       api.get("/dashboard/health"),
    //       api.get("/dashboard/analytics"),
    //       api.get("/dashboard/innovation"),
    //       api.get("/dashboard/trending-products", { limit: 3 }),
    //       api.get("/dashboard/winback-leaderboard", { limit: 5 }),
    //       api.get("/dashboard/abandoned-products", { limit: 5 }),
    //       api.get("/dashboard/insights"),
    //       api.get("/sequences/stats"),
    //       api.get("/stores"),
    //     ]);
    //     setUserName(meRes.data.full_name);
    //     setKpi(kpiRes.data.kpi);
    //     setChart(chartRes.data.chart);
    //     setActivity(activityRes.data.activity);
    //     setDonutSlices(attrRes.data.slices);
    //     setDonutTotal(attrRes.data.total);
    //     setHealth(healthRes.data.health);
    //     setAnalytics(analyticsRes.data.analytics);
    //     setInnovation(innovationRes.data.innovation);
    //     setTrendingProducts(trendingRes.data.trending);
    //     setWinback(winbackRes.data.winback);
    //     setAbandonedProducts(abandonedRes.data.products);
    //     setInsights(insightsRes.data.insights);
    //     setSequences(seqRes.data.sequences);
    //     setStoreConnected(storesRes.data.stores?.length > 0);
    //   } catch {
    //     setError("Failed to load dashboard data.");
    //   } finally {
    //     setLoading(false);
    //   }
    // }
    // fetchDashboard();
    // END Week 3 block

    // Week 1–2 stub: no data yet, just stop the loading spinner
    setLoading(false);
  }, []);

  const firstName = userName ? userName.split(" ")[0] : null;

  return (
    <div className="mx-auto max-w-[1480px] space-y-5">
      <ConnectBanner storeConnected={storeConnected} />

      {/* Welcome */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32 }}
      >
        <h1 className="display text-[1.6rem] font-extrabold tracking-tight text-t1 sm:text-[1.85rem]">
          Welcome back,{" "}
          {loading
            ? <span className="inline-block h-7 w-28 animate-pulse rounded-md bg-bg-4 align-middle" />
            : (firstName ?? "--")}{" "}
          <span className="wave-emoji">👋</span>
        </h1>
        <p className="mt-1 text-[0.85rem] text-t2">
          Here's what's happening with your store today
        </p>
      </motion.div>

      {/* KPI grid */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {kpi
          ? kpi.map((k, i) => <KpiCard key={k.id} kpi={k} index={i} />)
          : Array.from({ length: 6 }).map((_, i) => <KpiCardSkeleton key={i} index={i} />)}
      </section>

      {/* Chart + Activity */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
        <RevenueChart chartData={chart} loading={loading} />
        <LiveActivity items={activity} loading={loading} />
      </section>

      {/* Sequences + Products */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
        <SequencesTable sequences={sequences} loading={loading} />
        <AbandonedProducts products={abandonedProducts} loading={loading} />
      </section>

      {/* Insights + Donut + Health */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <AIInsights insights={insights} loading={loading} />
        <RevenueAttribution slices={donutSlices} total={donutTotal} loading={loading} />
        <HealthScore health={health} loading={loading} />
      </section>

      {/* Analytics strip */}
      <AnalyticsStrip tiles={analytics} loading={loading} />

      {/* Innovation row */}
      <InnovationRow cards={innovation} loading={loading} />

      {/* Bottom grid */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <QuickActions />
        <TrendingProducts products={trendingProducts} loading={loading} />
        <WinbackLeaderboard entries={winback} loading={loading} />
      </section>

      {/* Global error toast */}
      {error && (
        <div className="fixed bottom-4 right-4 z-[999] rounded-xl border border-red-500/30 bg-bg-2 px-4 py-3 text-[0.82rem] shadow-elegant" style={{ color: "hsl(var(--red))" }}>
          {error}
        </div>
      )}
    </div>
  );
}

// KPI skeleton (shown while kpi state is null) 
function KpiCardSkeleton({ index }: { index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.04 + index * 0.04, duration: 0.32 }}
      className="relative flex flex-col overflow-hidden rounded-xl border border-border bg-bg-2 p-4"
    >
      <div className="mb-3 flex items-start justify-between">
        <div className="h-7 w-7 animate-pulse rounded-md bg-bg-4" />
        <div className="h-5 w-14 animate-pulse rounded-full bg-bg-4" />
      </div>
      <div className="h-8 w-24 animate-pulse rounded-md bg-bg-4" />
      <div className="mt-2 h-3 w-28 animate-pulse rounded bg-bg-4" />
      <div className="mt-1 h-2.5 w-20 animate-pulse rounded bg-bg-4" />
      <div className="mt-3 h-9 w-full animate-pulse rounded bg-bg-4" />
    </motion.div>
  );
}
