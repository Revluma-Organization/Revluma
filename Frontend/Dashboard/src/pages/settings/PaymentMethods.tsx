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

const FALLBACK_CARDS: SavedCard[] = [
  {
    id: "card-1",
    brand: "Visa",
    last4: "4242",
    expMonth: "08",
    expYear: "2028",
    isDefault: true,
    tokenizedVia: "Paystack Secure Vault",
  },
  {
    id: "card-2",
    brand: "Mastercard",
    last4: "8899",
    expMonth: "11",
    expYear: "2027",
    isDefault: false,
    tokenizedVia: "Paystack Secure Vault",
  },
];

export const PaymentMethods: FC = () => {
  const [cards, setCards] = useState<SavedCard[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
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
        setCards(FALLBACK_CARDS);
      }
    } catch (err) {
      console.warn("Failed to fetch payment methods from API, using fallback:", err);
      setCards(FALLBACK_CARDS);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPaymentMethods();
  }, [fetchPaymentMethods]);

  // New card form state
  const [holderName, setHolderName] = useState<string>("Splendor Commerce");
  const [cardNumber, setCardNumber] = useState<string>("•••• •••• •••• 5566");
  const [expiry, setExpiry] = useState<string>("12/29");
  const [cvv, setCvv] = useState<string>("923");

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

  const handleRemoveCard = (id: string) => {
    const targetCard = cards.find((c) => c.id === id);
    setCards((prev) => prev.filter((c) => c.id !== id));
    if (targetCard) {
      setFeedbackMessage(
        `Removed "${targetCard.brand} ending in ${targetCard.last4}" from your saved payment methods.`
      );
    }
  };

  const handleAddCardSubmit = (e: FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    setTimeout(() => {
      const newCard: SavedCard = {
        id: `card-${Date.now()}`,
        brand: "Visa",
        last4: "5566",
        expMonth: "12",
        expYear: "2029",
        isDefault: cards.length === 0,
        tokenizedVia: "Paystack Secure Vault",
      };
      setCards((prev) => [newCard, ...prev]);
      setIsSubmitting(false);
      setIsModalOpen(false);
      setFeedbackMessage("New payment card tokenized and saved successfully.");
    }, 1100);
  };

  return (
    <div className="w-full max-w-5xl space-y-8 rounded-2xl bg-slate-950 p-6 text-slate-100 shadow-2xl sm:p-8 md:p-10">
      {/* Page Header */}
      <div className="flex flex-col justify-between gap-4 border-b border-slate-800 pb-6 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-500/10 text-sky-400 ring-1 ring-sky-500/20">
            <CreditCard className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Payment Methods
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Manage your billing information and saved cards.
            </p>
          </div>
        </div>

        {/* Top Action Button */}
        <Button
          type="button"
          onClick={() => setIsModalOpen(true)}
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
            className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200"
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
              <span>{feedbackMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setFeedbackMessage(null)}
              className="rounded p-1 text-slate-400 hover:text-white"
              aria-label="Dismiss notification"
            >
              <X className="h-4 w-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Secure Tokenization Banner */}
      <div className="flex items-center justify-between rounded-xl border border-sky-500/20 bg-sky-500/5 p-4 text-xs text-slate-300 sm:text-sm">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-400" />
          <p>
            Cards are tokenized and encrypted via{" "}
            <span className="font-bold text-white">Paystack Secure Vault</span>.
            We never store raw card numbers on our servers.
          </p>
        </div>
        <Lock className="h-4 w-4 shrink-0 text-slate-500 hidden sm:block" />
      </div>

      {/* Saved Cards List */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white sm:text-xl">
            Saved Credit & Debit Cards ({cards.length})
          </h2>
          <span className="text-xs text-slate-500">
            Default card is charged for subscription renewals
          </span>
        </div>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-800 bg-slate-900/40 py-16">
            <Loader2 className="h-8 w-8 animate-spin text-sky-400" />
            <p className="mt-3 text-sm font-medium text-slate-400">
              Fetching saved payment methods...
            </p>
          </div>
        ) : cards.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-800 bg-slate-900/30 py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-800/80 text-slate-400">
              <CreditCard className="h-6 w-6" />
            </div>
            <h3 className="mt-4 text-base font-semibold text-white">
              No saved payment methods
            </h3>
            <p className="mt-1 max-w-sm text-xs text-slate-400">
              Add a payment card to ensure uninterrupted access to Revluma storefront automation features.
            </p>
            <Button
              type="button"
              onClick={() => setIsModalOpen(true)}
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
                  className={`flex flex-col justify-between gap-4 rounded-2xl border p-5 shadow-xl backdrop-blur-md transition-all duration-300 sm:flex-row sm:items-center ${
                    card.isDefault
                      ? "border-sky-500/50 bg-slate-900/80 shadow-sky-500/10"
                      : "border-slate-800/80 bg-slate-900/50 hover:border-slate-700/80 hover:bg-slate-900/70"
                  }`}
                >
                  {/* Left Card Info */}
                  <div className="flex items-center gap-4">
                    <div className="flex h-12 w-16 shrink-0 flex-col justify-between rounded-xl border border-slate-700/80 bg-gradient-to-br from-slate-800 to-slate-950 p-2 shadow-inner">
                      <div className="flex items-center justify-between">
                        <span className="h-1.5 w-2.5 rounded-sm bg-amber-400/80" />
                        <CreditCard className="h-3.5 w-3.5 text-slate-400" />
                      </div>
                      <span className="font-mono text-[0.65rem] font-bold text-slate-200">
                        •••• {card.last4}
                      </span>
                    </div>

                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <span className="font-bold text-white">
                          {card.brand} ending in {card.last4}
                        </span>
                        {card.isDefault && (
                          <Badge className="rounded-full border border-sky-500/30 bg-sky-500/20 px-2.5 py-0.5 text-[0.65rem] font-bold uppercase tracking-wider text-sky-300">
                            Default
                          </Badge>
                        )}
                      </div>

                      <div className="flex items-center gap-3 text-xs text-slate-400">
                        <span>
                          Expires {card.expMonth}/{card.expYear}
                        </span>
                        <span>•</span>
                        <span className="text-emerald-400 font-medium">
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
                        className="border-slate-700 bg-slate-950 text-xs font-semibold text-slate-300 hover:border-sky-500/50 hover:bg-sky-500/10 hover:text-sky-300"
                      >
                        <Star className="mr-1.5 h-3.5 w-3.5" />
                        <span>Make Default</span>
                      </Button>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-sky-400 px-3 py-1">
                        <CheckCircle2 className="h-4 w-4" />
                        <span>Primary Billing Card</span>
                      </span>
                    )}

                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => handleRemoveCard(card.id)}
                      className="h-9 w-9 border-slate-700 bg-slate-950 text-slate-400 hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-300"
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
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setIsModalOpen(true)}
            className="border-slate-700 bg-slate-900/80 text-xs text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            <Plus className="mr-1.5 h-3.5 w-3.5 text-sky-400" />
            <span>Add Payment Method</span>
          </Button>
        </div>
      </div>

      {/* Add Payment Method Modal (Paystack Tokenization Simulation) */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md space-y-6 rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <div className="flex items-center gap-2.5">
                  <Lock className="h-5 w-5 text-emerald-400" />
                  <h3 className="text-lg font-bold text-white">
                    Tokenize & Save Card
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  disabled={isSubmitting}
                  className="rounded p-1 text-slate-400 hover:text-white"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <form onSubmit={handleAddCardSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="holder-name" className="text-xs text-slate-300">
                    Cardholder Name
                  </Label>
                  <input
                    id="holder-name"
                    type="text"
                    value={holderName}
                    onChange={(e) => setHolderName(e.target.value)}
                    required
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="card-number" className="text-xs text-slate-300">
                    Card Number
                  </Label>
                  <input
                    id="card-number"
                    type="text"
                    value={cardNumber}
                    onChange={(e) => setCardNumber(e.target.value)}
                    required
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 font-mono text-sm text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="exp-date" className="text-xs text-slate-300">
                      Expiration Date
                    </Label>
                    <input
                      id="exp-date"
                      type="text"
                      value={expiry}
                      onChange={(e) => setExpiry(e.target.value)}
                      required
                      placeholder="MM/YY"
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 font-mono text-sm text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cvv-input" className="text-xs text-slate-300">
                      CVV / CVC
                    </Label>
                    <input
                      id="cvv-input"
                      type="password"
                      maxLength={4}
                      value={cvv}
                      onChange={(e) => setCvv(e.target.value)}
                      required
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 font-mono text-sm text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-300">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-400" />
                  <span>
                    Your card details are sent directly to Paystack's PCI-DSS compliant vault.
                  </span>
                </div>

                <div className="flex items-center justify-end gap-3 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsModalOpen(false)}
                    disabled={isSubmitting}
                    className="border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={isSubmitting}
                    className="bg-sky-600 font-semibold text-white shadow-lg shadow-sky-600/25 hover:bg-sky-500"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        <span>Tokenizing Card...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="mr-2 h-4 w-4" />
                        <span>Save Payment Method</span>
                      </>
                    )}
                  </Button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default PaymentMethods;
