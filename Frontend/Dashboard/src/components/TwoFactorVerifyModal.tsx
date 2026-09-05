import, { FC, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Loader2, ShieldCheck, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";

interface TwoFactorVerifyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const TwoFactorVerifyModal: FC<TwoFactorVerifyModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [otpCode, setOtpCode] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState("");

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otpCode.length !== 6) return;
    
    setIsVerifying(true);
    setError("");
    
    try {
      await api.post("/auth/2fa/verify", { code: otpCode }, { skipAuthRedirect: true });
      setOtpCode("");
      onSuccess(); // Triggers the next step (e.g., opening the confirmation modal or logging in)
    } catch (err) {
      console.error("2FA verification failed:", err);
      setError("Invalid verification code. Please try again.");
      setOtpCode(""); 
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 dark:bg-black/80 p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isVerifying) onClose();
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
            transition={{ type: "spring", stiffness: 300, damping: 28 }}
            className="relative w-full max-w-md overflow-hidden rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-6 text-slate-900 dark:text-slate-100 shadow-2xl sm:p-8"
          >
            <button
              type="button"
              onClick={onClose}
              disabled={isVerifying}
              className="absolute right-4 top-4 rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-white disabled:opacity-50"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex flex-col items-center text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-50 dark:bg-sky-500/10 text-[#007FFF] dark:text-sky-400 ring-1 ring-sky-500/20">
                <ShieldCheck className="h-7 w-7" />
              </div>
              <h3 className="mt-5 text-xl font-bold text-slate-900 dark:text-white">
                Two-step Authentication
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                Please enter the 6-digit verification code from your authenticator app to proceed.
              </p>
            </div>

            <form onSubmit={handleVerify} className="mt-6 space-y-5">
              <div className="space-y-2">
                <Label htmlFor="verify-otp-code" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Verification Code
                </Label>
                <Input
                  id="verify-otp-code"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="123456"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                  className="h-12 text-center font-mono text-lg tracking-[0.35em] border-slate-300 bg-white text-slate-900 dark:border-slate-700 dark:bg-slate-900/80 dark:text-white placeholder:tracking-normal placeholder:text-slate-400 dark:placeholder:text-slate-600 focus-visible:border-[#007FFF] dark:focus-visible:border-sky-500 shadow-sm transition-all"
                  disabled={isVerifying}
                  autoComplete="off"
                />
              </div>

              {error && (
                <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div className="flex items-center gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={onClose}
                  disabled={isVerifying}
                  className="h-11 flex-1 border-slate-200 dark:border-slate-700 bg-white dark:bg-transparent text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 dark:hover:text-white shadow-sm transition-all"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={otpCode.length !== 6 || isVerifying}
                  className="h-11 flex-1 bg-[#007FFF] font-semibold text-white hover:bg-[#007FFF]/90 disabled:opacity-50 shadow-sm transition-all"
                >
                  {isVerifying ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Verifying...
                    </span>
                  ) : (
                    "Verify"
                  )}
                </Button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
