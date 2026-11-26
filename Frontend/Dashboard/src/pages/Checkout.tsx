import { FC, useState } from "react";
import { motion } from "framer-motion";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import { ArrowLeft, Lock, ShieldCheck, CheckCircle2, Loader2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

// Card details are never collected here. "Continue to Paystack" asks the
// backend for a Paystack checkout (amount decided server-side, always USD)
// and sends the merchant to Paystack's hosted page to pay.
// Prices mirror the backend PLANS in subscriptionController.js.
export const CHECKOUT_PLANS = {
  starter: { name: "Starter", monthly: 29, annualPerMonth: 23 },
  premium: { name: "Premium", monthly: 79, annualPerMonth: 63 },
} as const;

type PlanId = keyof typeof CHECKOUT_PLANS;
type Cycle = "monthly" | "annual";

const LEGACY_PLANS: Record<string, PlanId> = { growth: "starter", scale: "premium" };

export function resolveCheckoutSelection(rawPlan: string | null | undefined, rawCycle: string | null | undefined) {
  const key = String(rawPlan || "starter").trim().toLowerCase();
  const plan: PlanId = key in CHECKOUT_PLANS ? (key as PlanId) : LEGACY_PLANS[key] || "starter";
  const cycle: Cycle = rawCycle === "annual" || rawCycle === "yearly" ? "annual" : "monthly";
  const config = CHECKOUT_PLANS[plan];
  const total = cycle === "annual" ? config.annualPerMonth * 12 : config.monthly;
  return { plan, cycle, name: config.name, perMonth: cycle === "annual" ? config.annualPerMonth : config.monthly, total };
}

const usd = (amount: number) => `$${amount.toLocaleString("en-US")}`;

export const Checkout: FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((state) => state.user);

  // Plan and cycle come from the Subscription page (router state) or the
  // upgrade modal (?plan=&interval= query string).
  const query = new URLSearchParams(location.search);
  const state = (location.state || {}) as { plan?: string; cycle?: string };
  const selection = resolveCheckoutSelection(state.plan || query.get("plan"), state.cycle || query.get("interval"));

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const handleContinue = async () => {
    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await api.post<{ success: boolean; data?: { authorization_url: string }; error?: string }>(
        "/subscriptions/initialize",
        { plan: selection.plan, billing_cycle: selection.cycle, currency: "USD" },
        { skipAuthRedirect: true },
      );
      if (res.data.data?.authorization_url) {
        window.location.href = res.data.data.authorization_url;
        return;
      }
      setErrorMsg(res.data.error || "Could not start checkout. Please try again.");
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Network error. Check your connection and try again.");
    }
    setIsSubmitting(false);
  };

  return (
    <div className="min-h-screen w-full bg-slate-50 px-4 py-12 dark:bg-slate-950 sm:px-6 lg:px-8">
      <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="mx-auto max-w-xl">
        <div className="mb-8 flex items-center justify-between">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-sm font-medium text-slate-500 transition-colors hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Back</span>
          </button>
          <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
            <Lock className="h-4 w-4" />
            <span className="text-sm font-semibold">Secure checkout</span>
          </div>
        </div>

        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Review your plan</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">You will pay on Paystack&apos;s secure page. Revluma never sees your card details.</p>

        <section aria-label="Order summary" className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/50">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Plan</p>
              <p className="mt-1 text-lg font-bold text-slate-900 dark:text-white" data-testid="checkout-plan">
                Revluma {selection.name}
              </p>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {selection.cycle === "annual" ? `${usd(selection.perMonth)}/month, billed yearly` : "Billed monthly"}
              </p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-slate-900 dark:text-white" data-testid="checkout-total">
                {usd(selection.total)}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">USD {selection.cycle === "annual" ? "per year" : "per month"}</p>
            </div>
          </div>

          <dl className="mt-6 space-y-3 border-t border-slate-100 pt-5 text-sm dark:border-slate-800">
            {user?.email && (
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500 dark:text-slate-400">Account</dt>
                <dd className="truncate font-medium text-slate-900 dark:text-white">{user.email}</dd>
              </div>
            )}
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500 dark:text-slate-400">Currency</dt>
              <dd className="font-medium text-slate-900 dark:text-white">US dollars (USD)</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500 dark:text-slate-400">Renews</dt>
              <dd className="font-medium text-slate-900 dark:text-white">{selection.cycle === "annual" ? "Every year" : "Every month"}, cancel anytime</dd>
            </div>
          </dl>

          <ul className="mt-5 space-y-2 text-sm text-slate-600 dark:text-slate-300">
            <li className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Pay by card on Paystack
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Your plan is active as soon as payment is confirmed
            </li>
          </ul>
        </section>

        {errorMsg && (
          <div role="alert" className="mt-5 rounded-lg border border-red-500/20 bg-red-50 p-3 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400">
            {errorMsg}
          </div>
        )}

        <Button
          type="button"
          onClick={handleContinue}
          disabled={isSubmitting}
          className="mt-6 flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-sky-600 text-base font-bold text-white shadow-xl shadow-sky-600/20 transition-all hover:bg-sky-500 active:scale-[0.99]"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" /> Opening Paystack...
            </>
          ) : (
            <>
              Continue to Paystack <ExternalLink className="h-4 w-4" />
            </>
          )}
        </Button>

        <div className="mt-4 flex items-center justify-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <ShieldCheck className="h-4 w-4 text-emerald-500" />
          <span>Payments are processed and secured by Paystack.</span>
        </div>
      </motion.div>
    </div>
  );
};

export default Checkout;
