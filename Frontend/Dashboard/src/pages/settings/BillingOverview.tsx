import { FC, useState } from "react";
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

export const BillingOverview: FC = () => {
  const navigate = useNavigate();
  const [isDownloading, setIsDownloading] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const handleDownloadLatestInvoice = () => {
    setIsDownloading(true);
    setTimeout(() => {
      setIsDownloading(false);
      setToastMessage("Latest invoice (INV-2026-004.pdf) downloaded successfully.");
    }, 900);
  };

  return (
    <div className="w-full max-w-5xl space-y-8 text-slate-100">
      {/* Page Header */}
      <div className="border-b border-slate-800 pb-6">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-500/10 text-sky-400 ring-1 ring-sky-500/20">
            <CreditCard className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Billing Overview
            </h1>
            <p className="mt-1 text-sm text-slate-400">
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
        className="relative overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900/90 via-slate-900/60 to-slate-950 p-6 shadow-2xl sm:p-8"
      >
        {/* Subtle decorative accent light */}
        <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-sky-500/10 blur-3xl" />

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
                In Good Standing
              </Badge>
            </div>

            <div>
              <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
                Growth Plan
              </h2>
              <p className="mt-1 text-sm text-slate-400">
                Perfect for growing E-commerce stores with up to $50K/mo in revenue.
              </p>
            </div>

            <div className="flex items-baseline gap-2 pt-1">
              <span className="text-3xl font-extrabold text-white sm:text-4xl">
                $29.00
              </span>
              <span className="text-sm font-medium text-slate-400">
                / month
              </span>
              <span className="ml-2 inline-flex items-center gap-1.5 rounded-lg bg-slate-800/80 px-2.5 py-1 text-xs font-medium text-slate-300">
                <Calendar className="h-3.5 w-3.5 text-sky-400" />
                Renews on Aug 26, 2026
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
      </motion.section>

      {/* Section 2: Usage & Limits Grid */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.1 }}
        className="space-y-4"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">
            Current Month Usage &amp; Limits
          </h3>
          <span className="text-xs text-slate-400">
            Billing cycle ends in 31 days
          </span>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {/* Card 1: Tracked Visitors */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 shadow-xl transition-colors hover:border-slate-700/80">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Tracked Visitors
              </span>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/10 text-sky-400">
                <Activity className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-3 flex items-baseline justify-between">
              <span className="text-2xl font-bold text-white">450</span>
              <span className="text-xs font-medium text-slate-400">
                / 1,000 limit
              </span>
            </div>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-sky-500 transition-all duration-500"
                style={{ width: "45%" }}
              />
            </div>
            <div className="mt-2 flex justify-between text-[0.7rem] text-slate-400">
              <span>45% used</span>
              <span>550 remaining</span>
            </div>
          </div>

          {/* Card 2: API Requests */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 shadow-xl transition-colors hover:border-slate-700/80">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                API Requests
              </span>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
                <Zap className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-3 flex items-baseline justify-between">
              <span className="text-2xl font-bold text-white">12,000</span>
              <span className="text-xs font-medium text-slate-400">
                / 50k limit
              </span>
            </div>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                style={{ width: "24%" }}
              />
            </div>
            <div className="mt-2 flex justify-between text-[0.7rem] text-slate-400">
              <span>24% used</span>
              <span>38,000 remaining</span>
            </div>
          </div>

          {/* Card 3: Automated Workflows */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 shadow-xl transition-colors hover:border-slate-700/80">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Automated Workflows
              </span>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-500/10 text-purple-400">
                <Layers className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-3 flex items-baseline justify-between">
              <span className="text-2xl font-bold text-white">8</span>
              <span className="text-xs font-medium text-slate-400">
                / 15 limit
              </span>
            </div>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-purple-500 transition-all duration-500"
                style={{ width: "53%" }}
              />
            </div>
            <div className="mt-2 flex justify-between text-[0.7rem] text-slate-400">
              <span>53% used</span>
              <span>7 remaining</span>
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
        <div className="flex flex-col justify-between rounded-2xl border border-slate-800 bg-slate-900/50 p-6 shadow-xl transition-colors hover:border-slate-700/80">
          <div>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-white">
                Payment Method
              </h3>
              <Badge
                variant="outline"
                className="border-slate-700 bg-slate-800 px-2.5 py-0.5 text-xs text-slate-300"
              >
                Default
              </Badge>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Your saved card for monthly automatic billing.
            </p>

            <div className="mt-6 flex items-center gap-4 rounded-xl border border-slate-800/80 bg-slate-950/60 p-4">
              <div className="flex h-11 w-14 shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-sky-400 font-bold text-sm tracking-wider">
                VISA
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold text-white">
                  Visa ending in 4242
                </div>
                <div className="text-xs text-slate-400">
                  Expires 12/28 &bull; Default payment method
                </div>
              </div>
            </div>
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
              <span>Edit</span>
            </Button>
          </div>
        </div>

        {/* Column 2: Latest Invoice */}
        <div className="flex flex-col justify-between rounded-2xl border border-slate-800 bg-slate-900/50 p-6 shadow-xl transition-colors hover:border-slate-700/80">
          <div>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-white">
                Latest Invoice
              </h3>
              <Badge className="border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-300">
                Paid
              </Badge>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Most recent charge from Paystack for your Growth subscription.
            </p>

            <div className="mt-6 flex items-center justify-between rounded-xl border border-slate-800/80 bg-slate-950/60 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-900 text-slate-300 border border-slate-800">
                  <FileText className="h-5 w-5 text-sky-400" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-white">
                    INV-2026-004
                  </div>
                  <div className="text-xs text-slate-400">
                    Jul 26, 2026 &bull; Growth Plan
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-base font-bold text-white">$29.00</div>
                <div className="text-[0.7rem] font-medium text-emerald-400">
                  Paid
                </div>
              </div>
            </div>
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
              disabled={isDownloading}
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
