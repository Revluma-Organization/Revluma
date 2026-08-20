import { useNavigate } from "react-router-dom";
import { FC, useState, type FormEvent } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Lock,
  ShieldCheck,
  CreditCard,
  CheckCircle2,
  Loader2,
  User
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export const Checkout: FC = () => {
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  
  // Form State
  const [holderName, setHolderName] = useState<string>("");
  const [cardNumber, setCardNumber] = useState<string>("");
  const [expiry, setExpiry] = useState<string>("");
  const [cvv, setCvv] = useState<string>("");

  const handleCheckoutSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    // Paystack API call here!
    setTimeout(() => {
      setIsSubmitting(false);
      console.log("Paystack tokenization triggered for:", { holderName, cardNumber });
    }, 2000);
  };
  
  const handleGoBack = () => {
  navigate(-1); 
};
  
  return (
    <div className="min-h-screen w-full bg-slate-50 px-4 py-12 dark:bg-slate-950 sm:px-6 lg:px-8">
      <motion.div 
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="mx-auto max-w-2xl"
      >
        {/* Top Navigation */}
        <div className="mb-8 flex items-center justify-between">
          <button 
            onClick={handleGoBack}
            className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Back</span>
          </button>
          <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
            <Lock className="h-4 w-4" />
            <span className="text-sm font-semibold">Secure Checkout</span>
          </div>
        </div>

        {/* Main Checkout Form */}
        <form onSubmit={handleCheckoutSubmit} className="space-y-8">
          
          {/* Step 1: Contact Information */}
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-sky-600 text-xs font-bold text-white shadow-md">
                1
              </div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">Contact Information</h2>
            </div>
            
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/50">
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Full Name</Label>
                  <div className="relative">
                    <User className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      disabled
                      value="Workspace Owner" // This can be dynamically pulled from AuthStore later
                      className="w-full rounded-xl border border-slate-200 bg-slate-100 py-2.5 pl-10 pr-3.5 text-sm text-slate-500 cursor-not-allowed dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Email Address</Label>
                  <input
                    type="email"
                    disabled
                    value="owner@revluma.com" // Dynamically pull from AuthStore later
                    className="w-full rounded-xl border border-slate-200 bg-slate-100 px-3.5 py-2.5 text-sm text-slate-500 cursor-not-allowed dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Step 2: Payment Method */}
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-sky-600 text-xs font-bold text-white shadow-md">
                2
              </div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">Payment Method</h2>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/50">
              {/* Card Selector */}
              <div className="mb-6 flex gap-3">
                <div className="flex items-center gap-2 rounded-lg border-2 border-sky-600 bg-sky-50 px-4 py-2.5 dark:bg-sky-500/10">
                  <CreditCard className="h-5 w-5 text-sky-600 dark:text-sky-400" />
                  <span className="text-sm font-bold text-sky-700 dark:text-sky-300">Card</span>
                </div>
                {/* Future proofing for when we add Bank Transfer */}
                <div className="flex cursor-not-allowed items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 opacity-50 dark:border-slate-800 dark:bg-slate-900">
                  <span className="text-sm font-medium text-slate-500">Bank Transfer</span>
                </div>
              </div>

              <div className="space-y-5">
                <div className="space-y-1.5">
                  <Label htmlFor="checkout-card" className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Card Number
                  </Label>
                  <div className="relative">
                    <input
                      id="checkout-card"
                      type="text"
                      placeholder="0000 0000 0000 0000"
                      value={cardNumber}
                      onChange={(e) => setCardNumber(e.target.value)}
                      required
                      className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-3.5 pr-10 font-mono text-sm text-slate-900 placeholder-slate-400 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:placeholder-slate-500"
                    />
                    <CreditCard className="absolute right-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-300 dark:text-slate-600" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-5">
                  <div className="space-y-1.5">
                    <Label htmlFor="checkout-exp" className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Expiry Date
                    </Label>
                    <input
                      id="checkout-exp"
                      type="text"
                      placeholder="MM/YY"
                      value={expiry}
                      onChange={(e) => setExpiry(e.target.value)}
                      required
                      className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 font-mono text-sm text-slate-900 placeholder-slate-400 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:placeholder-slate-500"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="checkout-cvv" className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      CVV
                    </Label>
                    <input
                      id="checkout-cvv"
                      type="password"
                      maxLength={4}
                      placeholder="123"
                      value={cvv}
                      onChange={(e) => setCvv(e.target.value)}
                      required
                      className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 font-mono text-sm text-slate-900 placeholder-slate-400 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:placeholder-slate-500"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="checkout-name" className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Name on Card
                  </Label>
                  <input
                    id="checkout-name"
                    type="text"
                    placeholder="Enter name on card"
                    value={holderName}
                    onChange={(e) => setHolderName(e.target.value)}
                    required
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:placeholder-slate-500"
                  />
                </div>
              </div>
            </div>
          </div>

                    {/* Submit Action Area */}
          <div className="pt-2 flex flex-col gap-4">
            
            {/* Save Card Checkbox */}
            <div className="flex items-center gap-2.5 px-1">
              <input
                type="checkbox"
                id="save-card"
                defaultChecked
                className="h-4 w-4 cursor-pointer rounded border-slate-300 text-sky-600 accent-sky-600 focus:ring-sky-600 dark:border-slate-700"
              />
              <Label htmlFor="save-card" className="cursor-pointer text-sm font-medium text-slate-700 dark:text-slate-300">
                Save this card for faster payments
              </Label>
            </div>

            <Button
              type="submit"
              disabled={isSubmitting}
              className="flex h-14 w-full items-center justify-center rounded-xl bg-sky-600 text-base font-bold text-white shadow-xl shadow-sky-600/20 transition-all hover:bg-sky-500 active:scale-[0.99]"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Processing...
                </>
              ) : (
                <div className="flex w-full items-center justify-between px-2">
                  <div className="flex items-center gap-2">
                    <Lock className="h-5 w-5" />
                    <span>Pay Securely</span>
                  </div>
                  <span className="text-xl leading-none">›</span>
                </div>
              )}
            </Button>
            
            <div className="mt-2 flex items-center justify-center gap-2 text-sm text-slate-500 dark:text-slate-400">
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
              <span>Your data is safe and encrypted via Paystack Vault.</span>
            </div>
          </div>

          </form>
      </motion.div>
    </div>
  );
};

export default Checkout;
