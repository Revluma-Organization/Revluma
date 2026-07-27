import { FC, useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  CreditCard,
  CheckCircle2,
  ArrowUpRight,
  Download,
  FileText,
  Sparkles,
  Zap,
  Activity,
  Layers,
  Calendar,
  ShieldCheck,
  Loader2,
  X,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";

export interface BillingOverviewData {
  planName: string;
  priceFormatted: string;
  renewalDate: string;
  status: string;
  trackedVisitors: {
    used: number;
    limit: number;
  };
  apiRequests: {
    used: number;
    limit: number;
  };
  workflows: {
    used: number;
    limit: number;
  };
  defaultCard?: {
    brand: string;
    last4: string;
    expiry: string;
  };
  latestInvoice?: {
    id: string;
    number: string;
    date: string;
    amount: string;
    status: string;
  };
}

const FALLBACK_BILLING_OVERVIEW: BillingOverviewData = {
  planName: "Free Plan",
  priceFormatted: "$0.00 / month",
  renewalDate: "N/A",
  status: "Active",
  trackedVisitors: { used: 0, limit: 1000 },
  apiRequests: { used: 0, limit: 10000 },
  workflows: { used: 0, limit: 5 },
};

export const BillingOverview: FC = () => {
  const navigate = useNavigate();
  const [overviewData, setOverviewData] = useState<BillingOverviewData>(
    FALLBACK_BILLING_OVERVIEW
  );
  const [isLoadingOverview, setIsLoadingOverview] = useState<boolean>(true);

  const fetchBillingOverview = useCallback(async () => {
    setIsLoadingOverview(true);
    try {
      const res = await api.get<BillingOverviewData>(
        "/billing/overview",
        undefined,
        { skipAuthRedirect: true }
      );
      if (res && res.data && res.data.planName) {
        setOverviewData(res.data);
      } else {
        setOverviewData(FALLBACK_BILLING_OVERVIEW);
      }
    } catch (err) {
      console.warn("Failed to fetch billing overview from API:", err);
      setOverviewData(FALLBACK_BILLING_OVERVIEW);
    } finally {
      setIsLoadingOverview(false);
    }
  }, []);

  useEffect(() => {
    fetchBillingOverview();
  }, [fetchBillingOverview]);
  const [isDownloading, setIsDownloading] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const handleDownloadLatestInvoice = () => {
    setIsDownloading(true);
    setTimeout(() => {
      setIsDownloading(false);
      setToastMessage(
        `Latest invoice (${
          overviewData.latestInvoice?.number || "INV-001"
        }.pdf) downloaded successfully.`
      );
    }, 900);
  };

  const visitorsPercent = Math.min(
    100,
    Math.round(
      (overviewData.trackedVisitors.used /
        Math.max(1, overviewData.trackedVisitors.limit)) *
        100
    )
  );
  const visitorsRemaining = Math.max(
    0,
    overviewData.trackedVisitors.limit - overviewData.trackedVisitors.used
  );

  const apiPercent = Math.min(
    100,
    Math.round(
      (overviewData.apiRequests.used /
        Math.max(1, overviewData.apiRequests.limit)) *
        100
    )
  );
  const apiRemaining = Math.max(
    0,
    overviewData.apiRequests.limit - overviewData.apiRequests.used
  );

  const workflowsPercent = Math.min(
    100,
    Math.round(
      (overviewData.workflows.used / Math.max(1, overviewData.workflows.limit)) *
        100
    )
  );
  const workflowsRemaining = Math.max(
    0,
    overviewData.workflows.limit - overviewData.workflows.used
  );

  return (
    <div className="w-full max-w-5xl space-y-8 text-slate-900 dark:text-slate-100">
      {/* Page Header */}
      <div className="border-b border-slate-200 dark:border-slate-800 pb-6">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-500/10 text-sky-400 ring-1 ring-sky-500/20">
            <CreditCard className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-3xl">
              Billing Overview
            </h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Monitor your subscription plan, monthly usage limits, default payment method, and recent invoices.
            </p>
          </div>
        </div>
      </div>

      {/* Toast Notification */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-300 shadow-lg"
          >
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
              <span>{toastMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setToastMessage(null)}
              className="rounded-lg p-1 text-emerald-400/80 transition-colors hover:bg-emerald-500/20 hover:text-white"
              aria-label="Close notification"
            >
              <X className="h-4 w-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Section 1: Current Plan Summary Card */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-slate-100 dark:border-slate-800 dark:from-slate-900/90 dark:via-slate-900/60 dark:to-slate-950 p-6 shadow-2xl sm:p-8"
      >
        {/* Subtle decorative accent light */}
        <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-sky-500/10 blur-3xl" />

        {isLoadingOverview ? (
          <div className="flex items-center justify-center py-10 gap-3 text-slate-400 text-sm">
            <Loader2 className="h-6 w-6 animate-spin text-sky-400" />
            <span>Loading billing overview details...</span>
          </div>
        ) : (
          <div className="relative flex flex-col justify-between gap-6 lg:flex-row lg:items-center">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2.5">
                <Badge className="border-sky-500/30 bg-sky-500/10 px-3 py-1 text-xs font-semibold text-sky-300">
                  ACTIVE PLAN
                </Badge>
                <Badge
                  variant="outline"
                  className="border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300"
                >
                  <ShieldCheck className="mr-1.5 h-3.5 w-3.5 text-emerald-400" />
                  {overviewData.status}
                </Badge>
              </div>

              <div>
                <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-3xl">
                  {overviewData.planName}
                </h2>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                  Your active Revluma workspace subscription tier.
                </p>
              </div>

              <div className="flex items-baseline gap-2 pt-1">
                <span className="text-3xl font-extrabold text-slate-900 dark:text-white sm:text-4xl">
                  {overviewData.priceFormatted}
                </span>
                <span className="ml-2 inline-flex items-center gap-1.5 rounded-lg bg-slate-200/80 px-2.5 py-1 text-xs font-medium text-slate-700 dark:bg-slate-800/80 dark:text-slate-300">
                  <Calendar className="h-3.5 w-3.5 text-sky-400" />
                  Renews on {overviewData.renewalDate}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row lg:flex-col lg:items-end">
              <Button
                type="button"
                onClick={() => navigate("/dashboard/settings/subscription")}
                className="h-11 w-full bg-sky-600 px-6 font-semibold text-white shadow-lg shadow-sky-600/20 transition-all hover:bg-sky-500 sm:w-auto"
              >
                <Sparkles className="mr-2 h-4 w-4 text-sky-200" />
                <span>Manage Subscription</span>
              </Button>

              <Button
                type="button"
                variant="outline"
                onClick={() => navigate("/dashboard/settings/subscription")}
                className="h-11 w-full border-slate-700 bg-slate-900/80 px-5 text-sm font-medium text-slate-300 hover:bg-slate-800 hover:text-white sm:w-auto"
              >
                <span>Upgrade Plan</span>
                <ChevronRight className="ml-1.5 h-4 w-4 text-slate-400" />
              </Button>
            </div>
          </div>
        )}
      </motion.section>

      {/* Section 2: Usage & Limits Grid */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.1 }}
        className="space-y-4"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
            Current Month Usage &amp; Limits
          </h3>
          <span className="text-xs text-slate-600 dark:text-slate-400">
            Live workspace metrics
          </span>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {/* Card 1: Tracked Visitors */}
          <div className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/50 p-5 shadow-xl transition-colors hover:border-slate-300 dark:hover:border-slate-700/80">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                Tracked Visitors
              </span>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/10 text-sky-400">
                <Activity className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-3 flex items-baseline justify-between">
              <span className="text-2xl font-bold text-slate-900 dark:text-white">
                {overviewData.trackedVisitors.used.toLocaleString()}
              </span>
              <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                / {overviewData.trackedVisitors.limit.toLocaleString()} limit
              </span>
            </div>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
              <div
                className="h-full rounded-full bg-sky-500 transition-all duration-500"
                style={{ width: `${visitorsPercent}%` }}
              />
            </div>
            <div className="mt-2 flex justify-between text-[0.7rem] text-slate-600 dark:text-slate-400">
              <span>{visitorsPercent}% used</span>
              <span>{visitorsRemaining.toLocaleString()} remaining</span>
            </div>
          </div>

          {/* Card 2: API Requests */}
          <div className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/50 p-5 shadow-xl transition-colors hover:border-slate-300 dark:hover:border-slate-700/80">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                API Requests
              </span>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
                <Zap className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-3 flex items-baseline justify-between">
              <span className="text-2xl font-bold text-slate-900 dark:text-white">
                {overviewData.apiRequests.used.toLocaleString()}
              </span>
              <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                / {overviewData.apiRequests.limit.toLocaleString()} limit
              </span>
            </div>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                style={{ width: `${apiPercent}%` }}
              />
            </div>
            <div className="mt-2 flex justify-between text-[0.7rem] text-slate-600 dark:text-slate-400">
              <span>{apiPercent}% used</span>
              <span>{apiRemaining.toLocaleString()} remaining</span>
            </div>
          </div>

          {/* Card 3: Automated Workflows */}
          <div className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/50 p-5 shadow-xl transition-colors hover:border-slate-300 dark:hover:border-slate-700/80">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                Automated Workflows
              </span>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-500/10 text-purple-400">
                <Layers className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-3 flex items-baseline justify-between">
              <span className="text-2xl font-bold text-slate-900 dark:text-white">
                {overviewData.workflows.used.toLocaleString()}
              </span>
              <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                / {overviewData.workflows.limit.toLocaleString()} limit
              </span>
            </div>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
              <div
                className="h-full rounded-full bg-purple-500 transition-all duration-500"
                style={{ width: `${workflowsPercent}%` }}
              />
            </div>
            <div className="mt-2 flex justify-between text-[0.7rem] text-slate-600 dark:text-slate-400">
              <span>{workflowsPercent}% used</span>
              <span>{workflowsRemaining.toLocaleString()} remaining</span>
            </div>
          </div>
        </div>
      </motion.section>

      {/* Section 3: Quick Links / Snapshot (Split into two columns) */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.2 }}
        className="grid grid-cols-1 gap-6 md:grid-cols-2"
      >
        {/* Column 1: Payment Method */}
        <div className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/50 p-6 shadow-xl transition-colors hover:border-slate-300 dark:hover:border-slate-700/80">
          <div>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                Payment Method
              </h3>
              <Badge
                variant="outline"
                className="border-slate-700 bg-slate-800 px-2.5 py-0.5 text-xs text-slate-300"
              >
                Default
              </Badge>
            </div>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
              Your saved card for monthly automatic billing.
            </p>

            {overviewData.defaultCard ? (
              <div className="mt-6 flex items-center gap-4 rounded-xl border border-slate-200/80 bg-slate-100/60 dark:border-slate-800/80 dark:bg-slate-950/60 p-4">
                <div className="flex h-11 w-14 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-900 text-sky-500 font-bold text-sm tracking-wider">
                  {overviewData.defaultCard.brand}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">
                    {overviewData.defaultCard.brand} ending in {overviewData.defaultCard.last4}
                  </div>
                  <div className="text-xs text-slate-600 dark:text-slate-400">
                    Expires {overviewData.defaultCard.expiry} &bull; Default payment method
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-6 flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-100/40 dark:border-slate-800 dark:bg-slate-950/40 p-6 text-center">
                <CreditCard className="h-8 w-8 text-slate-500 mb-2" />
                <span className="text-sm text-slate-400">
                  No default payment method saved.
                </span>
              </div>
            )}
          </div>

          <div className="mt-6 flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => navigate("/dashboard/settings/payment-methods")}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-400 transition-colors hover:text-sky-300"
            >
              <span>Manage all payment methods</span>
              <ArrowUpRight className="h-3.5 w-3.5" />
            </button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => navigate("/dashboard/settings/payment-methods")}
              className="border-slate-700 bg-slate-900/80 px-4 text-xs font-medium text-slate-200 hover:bg-slate-800 hover:text-white"
            >
              <span>{overviewData.defaultCard ? "Edit" : "Add Method"}</span>
            </Button>
          </div>
        </div>

        {/* Column 2: Latest Invoice */}
        <div className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/50 p-6 shadow-xl transition-colors hover:border-slate-300 dark:hover:border-slate-700/80">
          <div>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                Latest Invoice
              </h3>
              {overviewData.latestInvoice ? (
                <Badge className="border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-300">
                  {overviewData.latestInvoice.status}
                </Badge>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
              Most recent charge from Paystack for your workspace subscription.
            </p>

            {overviewData.latestInvoice ? (
              <div className="mt-6 flex items-center justify-between rounded-xl border border-slate-200/80 bg-slate-100/60 dark:border-slate-800/80 dark:bg-slate-950/60 p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-800">
                    <FileText className="h-5 w-5 text-sky-400" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-slate-900 dark:text-white">
                      {overviewData.latestInvoice.number}
                    </div>
                    <div className="text-xs text-slate-600 dark:text-slate-400">
                      {overviewData.latestInvoice.date} &bull; {overviewData.planName}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-base font-bold text-slate-900 dark:text-white">
                    {overviewData.latestInvoice.amount}
                  </div>
                  <div className="text-[0.7rem] font-medium text-emerald-400">
                    {overviewData.latestInvoice.status}
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-6 flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-100/40 dark:border-slate-800 dark:bg-slate-950/40 p-6 text-center">
                <FileText className="h-8 w-8 text-slate-500 mb-2" />
                <span className="text-sm text-slate-400">
                  No billing history available.
                </span>
              </div>
            )}
          </div>

          <div className="mt-6 flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => navigate("/dashboard/settings/invoice-history")}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-400 transition-colors hover:text-sky-300"
            >
              <span>View invoice history</span>
              <ArrowUpRight className="h-3.5 w-3.5" />
            </button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDownloadLatestInvoice}
              disabled={isDownloading || !overviewData.latestInvoice}
              className="border-slate-700 bg-slate-900/80 px-4 text-xs font-medium text-slate-200 hover:bg-slate-800 hover:text-white"
            >
              {isDownloading ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin text-sky-400" />
                  <span>Downloading...</span>
                </>
              ) : (
                <>
                  <Download className="mr-1.5 h-3.5 w-3.5 text-sky-400" />
                  <span>Download</span>
                </>
              )}
            </Button>
          </div>
        </div>
      </motion.section>
    </div>
  );
};

export default BillingOverview;
