// src/pages/Overview.tsx
// All MOCK references replaced with useState hooks initialised to null.
// Loading state  → skeleton placeholders (visual match to current UI)
// Error state    → neutral "--" via error flag
// Visual output  → IDENTICAL to mock version
// Week 3 wiring: uncomment fetchDashboard(), delete the setLoading(false) stub.

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { motion } from "framer-motion";
import { PageHeader } from "@/components/layout/PageHeader";
import { ConnectBanner } from "@/components/dashboard/ConnectBanner";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { RevenueChart } from "@/components/dashboard/RevenueChart";
import { GlobalOnboarding } from "@/components/dashboard/GlobalOnboarding";
import { LiveActivity } from "@/components/dashboard/LiveActivity";
import { SequencesTable } from "@/components/dashboard/SequencesTable";
import { AbandonedProducts } from "@/components/dashboard/AbandonedProducts";
import { AIInsights } from "@/components/dashboard/AIInsights";
import { RevenueAttribution } from "@/components/dashboard/RevenueAttribution";
import { HealthScore } from "@/components/dashboard/HealthScore";
import { AnalyticsStrip, InnovationRow } from "@/components/dashboard/Strips";
import { QuickActions, TrendingProducts, WinbackLeaderboard } from "@/components/dashboard/BottomGrid";
import type {
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
  const [userName, setUserName] = useState<string | null>(null);
  const [kpi, setKpi] = useState<KPI[] | null>(null);
  const [chart, setChart] = useState<ChartData | null>(null);
  const [activity, setActivity] = useState<ActivityItem[] | null>(null);
  const [sequences, setSequences] = useState<SequenceRow[] | null>(null);
  const [abandonedProducts, setAbandonedProducts] = useState<ProductRow[] | null>(null);
  const [donutSlices, setDonutSlices] = useState<DonutSlice[] | null>(null);
  const [donutTotal, setDonutTotal] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticTile[] | null>(null);
  const [innovation, setInnovation] = useState<InnovationCard[] | null>(null);
  const [trendingProducts, setTrendingProducts] = useState<Trending[] | null>(null);
  const [winback, setWinback] = useState<WinbackEntry[] | null>(null);
  const [insights, setInsights] = useState<AIInsight[] | null>(null);
  const [storeConnected, setStoreConnected] = useState<boolean | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [showSecondaryInsights, setShowSecondaryInsights] = useState(false);

  useEffect(() => {
    async function fetchDashboard() {
      // ── Step 1: Fetch user identity (most critical — drives welcome header) ────
      // Backend has /auth/getProfile and /auth/me (alias added in 2.BE1.3)
      // Try /auth/me first, fall back to /auth/getProfile if not yet deployed
      try {
        let meData: { full_name: string; organizations?: Array<{ id: string }> } | null = null;
        try {
          const meRes = await api.get<{ success: boolean; data: { full_name: string; organizations?: Array<{ id: string }> } }>("/auth/me");
          meData = meRes.data.data;
        } catch {
          // /auth/me not yet deployed — try legacy route
          try {
            const meRes = await api.get<{ success: boolean; data: { full_name: string } }>("/auth/getProfile");
            meData = meRes.data.data;
          } catch {
            // Both failed — user identity unavailable, dashboard continues without name
          }
        }
        if (meData?.full_name) setUserName(meData.full_name);
      } catch {
        // Non-blocking — welcome header shows "--" but dashboard still loads
      }

      // ── Step 2: Fetch dashboard data independently ─────────────────────────────
      // Each endpoint is fetched independently so a missing endpoint (not yet built)
      // does not kill the entire dashboard. Sections without data show skeletons.
      const settled = await Promise.allSettled([
        api.get<{ success: boolean; data: { kpi: KPI[] } }>("/dashboard/kpis"),
        api.get<{ success: boolean; data: { chart: ChartData } }>("/dashboard/chart"),
        api.get<{ success: boolean; data: { activity: ActivityItem[] } }>("/dashboard/activity", { limit: 20 }),
        api.get<{ success: boolean; data: { stores: Array<{ status: string }> } }>("/stores"),
      ]);

      const [kpiResult, chartResult, activityResult, storesResult] = settled;

      if (kpiResult.status === "fulfilled") {
        setKpi(kpiResult.value.data.data?.kpi ?? null);
      }
      if (chartResult.status === "fulfilled") {
        setChart(chartResult.value.data.data?.chart ?? null);
      }
      if (activityResult.status === "fulfilled") {
        setActivity(activityResult.value.data.data?.activity ?? null);
      }
      if (storesResult.status === "fulfilled") {
        setStoreConnected(
          storesResult.value.data.data?.stores?.some((s) => s.status === "active") ?? false
        );
      }

      setLoading(false);
      // Note: remaining sections (attribution, health, analytics, etc.) wire in Week 4
    }
    fetchDashboard();
  }, []);

  const firstName = userName ? userName.split(" ")[0] : null;

  return (
    <div className="mx-auto max-w-[1480px] space-y-5">
      <ConnectBanner storeConnected={storeConnected} />

      {/* Welcome */}
      <PageHeader
        title={
          <>
            Welcome back,{" "}
            {loading
              ? <span className="inline-block h-7 w-28 animate-pulse rounded-md bg-bg-4 align-middle" />
              : (firstName ?? "--")}{" "}
            <span className="wave-emoji">👋</span>
          </>
        }
        subtitle="Here's what's happening with your store today"
      />

      {!loading && storeConnected === false ? (
        <GlobalOnboarding />
      ) : (
        <>
          {/* Zone 1: Performance at a Glance */}
          <div className="mb-8">
            <h2 className="mb-4 text-sm font-bold uppercase tracking-widest text-t3">Performance at a glance</h2>
            <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 mb-4">
              {kpi
                ? kpi.map((k, i) => <KpiCard key={k.id} kpi={k} index={i} />)
                : Array.from({ length: 6 }).map((_, i) => <KpiCardSkeleton key={i} index={i} />)}
            </section>

            <section className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
              <RevenueChart chartData={chart} loading={loading} />
              <LiveActivity items={activity} loading={loading} />
            </section>
          </div>

          {/* Expander for secondary metrics */}
          {!showSecondaryInsights ? (
            <div className="flex justify-center py-6">
              <button
                onClick={() => setShowSecondaryInsights(true)}
                className="rounded-full border border-border bg-bg-3 px-6 py-2.5 text-sm font-semibold text-t2 transition-all hover:border-border-md hover:text-t1"
              >
                Show deep intelligence &amp; insights
              </button>
            </div>
          ) : (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              className="space-y-5"
            >
              {/* Zone 2: Intelligence */}
              <h2 className="mb-4 mt-2 text-sm font-bold uppercase tracking-widest text-t3">Intelligence &amp; Deep Analytics</h2>

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

              {/* 3-col bottom grid */}
              <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <QuickActions />
                <TrendingProducts products={trendingProducts} loading={loading} />
                <WinbackLeaderboard entries={winback} loading={loading} />
              </section>
            </motion.div>
          )}
        </>
      )}

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
      <div className="mt-2 h-3 w-28 animate-pulse rounded-md bg-bg-4" />
      <div className="mt-1 h-2.5 w-20 animate-pulse rounded-md bg-bg-4" />
      <div className="mt-3 h-9 w-full animate-pulse rounded-md bg-bg-4" />
    </motion.div>
  );
}