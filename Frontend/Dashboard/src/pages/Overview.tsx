import { MOCK } from "@/data/mockOverview";
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

export default function Overview() {
  const firstName = MOCK.user.name.split(" ")[0];

  return (
    <div className="mx-auto max-w-[1480px] space-y-5">
      <ConnectBanner />

      {/* Welcome */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32 }}
      >
        <h1 className="display text-[1.6rem] font-extrabold tracking-tight text-t1 sm:text-[1.85rem]">
          Welcome back, {firstName} <span className="wave-emoji">👋</span>
        </h1>
        <p className="mt-1 text-[0.85rem] text-t2">
          Here's what's happening with your store today
        </p>
      </motion.div>

      {/* KPI grid */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {MOCK.kpi.map((k, i) => <KpiCard key={k.id} kpi={k} index={i} />)}
      </section>

      {/* Chart + Activity */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
        <RevenueChart />
        <LiveActivity />
      </section>

      {/* Sequences + Products */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
        <SequencesTable />
        <AbandonedProducts />
      </section>

      {/* Insights + Donut + Health */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <AIInsights />
        <RevenueAttribution />
        <HealthScore />
      </section>

      {/* Analytics strip */}
      <AnalyticsStrip />

      {/* Innovation row */}
      <InnovationRow />

      {/* Bottom: Quick Actions + Trending + Win-back */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <QuickActions />
        <TrendingProducts />
        <WinbackLeaderboard />
      </section>
    </div>
  );
}
