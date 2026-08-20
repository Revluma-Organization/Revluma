import { FC, useState, useEffect, useCallback, type FormEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CreditCard,
  Plus,
  CheckCircle2,
  ShieldCheck,
  Trash2,
  Star,
  Lock,
  Loader2,
  X,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";

export interface SavedCard {
  id: string;
  brand: "Visa" | "Mastercard" | "American Express";
  last4: string;
  expMonth: string;
  expYear: string;
  isDefault: boolean;
  tokenizedVia: string;
}

export const PaymentMethods: FC = () => {
  const [cards, setCards] = useState<SavedCard[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  const fetchPaymentMethods = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.get<SavedCard[]>(
        "/billing/payment-methods",
        undefined,
        { skipAuthRedirect: true }
      );
      if (res && Array.isArray(res.data)) {
        setCards(res.data);
      } else {
        setCards([]);
      }
    } catch (err) {
      console.warn("Failed to fetch payment methods from API:", err);
      setCards([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPaymentMethods();
  }, [fetchPaymentMethods]);

  const handleMakeDefault = (id: string) => {
    setCards((prev) =>
      prev.map((card) => ({
        ...card,
        isDefault: card.id === id,
      }))
    );
    const targetCard = cards.find((c) => c.id === id);
    if (targetCard) {
      setFeedbackMessage(
        `Set "${targetCard.brand} ending in ${targetCard.last4}" as your default payment method.`
      );
    }
  };

  const handleRemoveCard = async (id: string) => {
    const targetCard = cards.find((c) => c.id === id);
    try {
      await api.delete(`/billing/payment-methods/${id}`, { skipAuthRedirect: true });
      setCards((prev) => prev.filter((c) => c.id !== id));
      if (targetCard) {
        setFeedbackMessage(
          `Removed "${targetCard.brand} ending in ${targetCard.last4}" from your saved payment methods.`
        );
      }
    } catch (err) {
      console.error("Failed API delete payment method:", err);
    }
  };

  return (
    <div className="w-full max-w-5xl space-y-8 rounded-2xl bg-white p-6 text-slate-900 shadow-xl border border-slate-200 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 sm:p-8 md:p-10 transition-colors duration-200">
      {/* Page Header */}
      <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-6 dark:border-slate-800 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-100 text-sky-600 ring-1 ring-sky-500/20 dark:bg-sky-500/10 dark:text-sky-400 dark:ring-sky-500/20">
            <CreditCard className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-3xl">
              Payment Methods
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Manage your billing information and saved cards.
            </p>
          </div>
        </div>

        {/* Top Action Button */}
        <Button
          type="button"
          onClick={() => router.push('/dashboard/checkout')}
          className="h-11 bg-sky-600 px-5 font-semibold text-white shadow-lg shadow-sky-600/25 transition-all hover:bg-sky-500 active:scale-[0.98]"
        >
          <Plus className="mr-2 h-4 w-4" />
          <span>Add Payment Method</span>
        </Button>
      </div>

      {/* Inline Feedback Toast */}
      <AnimatePresence>
        {feedbackMessage && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 p-4 text-sm text-emerald-700 dark:text-emerald-200"
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500 dark:text-emerald-400" />
              <span className="font-medium">{feedbackMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setFeedbackMessage(null)}
              className="rounded p-1 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white"
              aria-label="Dismiss notification"
            >
              <X className="h-4 w-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Secure Tokenization Banner */}
      <div className="flex items-center justify-between rounded-xl border border-emerald-500/20 bg-emerald-50 p-4 text-xs text-emerald-700 dark:bg-emerald-500/5 dark:text-slate-300 sm:text-sm">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <p>
            Cards are tokenized and encrypted via{" "}
            <span className="font-bold text-emerald-800 dark:text-white">Paystack Secure Vault</span>.
            We never store raw card numbers on our servers.
          </p>
        </div>
        <Lock className="hidden h-4 w-4 shrink-0 text-emerald-600/50 dark:text-slate-500 sm:block" />
      </div>

      {/* Saved Cards List */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white sm:text-xl">
            Saved Credit & Debit Cards ({cards.length})
          </h2>
          <span className="text-xs font-medium text-slate-500">
            Default card is charged for subscription renewals
          </span>
        </div>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 py-16 dark:border-slate-800 dark:bg-slate-900/40">
            <Loader2 className="h-8 w-8 animate-spin text-sky-600 dark:text-sky-400" />
            <p className="mt-3 text-sm font-medium text-slate-500 dark:text-slate-400">
              Fetching saved payment methods...
            </p>
          </div>
        ) : cards.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 py-12 text-center dark:border-slate-800 dark:bg-slate-900/30">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-200 text-slate-500 dark:bg-slate-800/80 dark:text-slate-400">
              <CreditCard className="h-6 w-6" />
            </div>
            <h3 className="mt-4 text-base font-semibold text-slate-900 dark:text-white">
              No saved payment methods
            </h3>
            <p className="mt-1 max-w-sm text-xs text-slate-500 dark:text-slate-400">
              Add a payment card to ensure uninterrupted access to Revluma storefront automation features.
            </p>
            <Button
              type="button"
              onClick={() => router.push('/dashboard/checkout')}
              className="mt-6 bg-sky-600 font-semibold text-white hover:bg-sky-500"
            >
              <Plus className="mr-2 h-4 w-4" />
              <span>Add Payment Method</span>
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <AnimatePresence initial={false}>
              {cards.map((card) => (
                <motion.div
                  key={card.id}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0, scale: 0.96 }}
                  transition={{ duration: 0.25 }}
                  className={`flex flex-col justify-between gap-4 rounded-2xl border p-5 shadow-sm transition-all duration-300 sm:flex-row sm:items-center ${
                    card.isDefault
                      ? "border-sky-500/50 bg-sky-50 dark:bg-slate-900/80 dark:shadow-sky-500/10"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800/80 dark:bg-slate-900/50 dark:hover:border-slate-700/80 dark:hover:bg-slate-900/70"
                  }`}
                >
                  {/* Left Card Info */}
                  <div className="flex items-center gap-4">
                    <div className="flex h-12 w-16 shrink-0 flex-col justify-between rounded-xl border border-slate-200 bg-gradient-to-br from-slate-100 to-slate-200 p-2 shadow-inner dark:border-slate-700/80 dark:from-slate-800 dark:to-slate-950">
                      <div className="flex items-center justify-between">
                        <span className="h-1.5 w-2.5 rounded-sm bg-amber-400/80" />
                        <CreditCard className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
                      </div>
                      <span className="font-mono text-[0.65rem] font-bold text-slate-700 dark:text-slate-200">
                        •••• {card.last4}
                      </span>
                    </div>

                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <span className="font-bold text-slate-900 dark:text-white">
                          {card.brand} ending in {card.last4}
                        </span>
                        {card.isDefault && (
                          <Badge className="rounded-full border border-sky-500/30 bg-sky-100 px-2.5 py-0.5 text-[0.65rem] font-bold uppercase tracking-wider text-sky-700 dark:bg-sky-500/20 dark:text-sky-300">
                            Default
                          </Badge>
                        )}
                      </div>

                      <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                        <span>
                          Expires {card.expMonth}/{card.expYear}
                        </span>
                        <span>•</span>
                        <span className="font-medium text-emerald-600 dark:text-emerald-400">
                          Tokenized via {card.tokenizedVia}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Right Trailing Actions */}
                  <div className="flex items-center justify-end gap-3 self-end sm:self-center">
                    {!card.isDefault ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleMakeDefault(card.id)}
                        className="border-slate-200 bg-white text-xs font-semibold text-slate-600 hover:border-sky-500/50 hover:bg-sky-50 hover:text-sky-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-sky-500/10 dark:hover:text-sky-300"
                      >
                        <Star className="mr-1.5 h-3.5 w-3.5" />
                        <span>Make Default</span>
                      </Button>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-3 py-1 text-xs font-semibold text-sky-600 dark:text-sky-400">
                        <CheckCircle2 className="h-4 w-4" />
                        <span>Primary Billing Card</span>
                      </span>
                    )}

                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => handleRemoveCard(card.id)}
                      className="h-9 w-9 border-slate-200 bg-white text-slate-400 hover:border-red-500/30 hover:bg-red-50 hover:text-red-600 dark:border-slate-700 dark:bg-slate-950 dark:hover:bg-red-500/10 dark:hover:text-red-300"
                      aria-label={`Remove ${card.brand} ending in ${card.last4}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}

        {/* Bottom Helper Bar */}
        <div className="flex flex-col justify-between gap-3 pt-4 sm:flex-row sm:items-center">
          <p className="text-xs text-slate-500">
            To update the billing address for invoices, visit your Organization or Billing settings.
          </p>
        </div>
      </div>

       </div>
  );
};

export default PaymentMethods;
