import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mail, KeyRound, Lock, ArrowRight, Loader2, CheckCircle2, ShieldCheck, ChevronLeft } from "lucide-react";
import { api } from "@/lib/api";

export default function ForgotPassword() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  // Form State
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Helpers
  const handleError = (err: any, fallback: string) => {
    setError(err?.body?.message || err?.response?.data?.message || err?.message || fallback);
  };

  const handleStep1 = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      setError("Please enter your email address.");
      return;
    }
    setLoading(true);
    setError("");

    try {
      await api.post<any>("/api/v1/auth/forgot-password", { email });
      setStep(2);
    } catch (err) {
      handleError(err, "Failed to send OTP. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleOtpChange = (index: number, value: string) => {
    // Handle paste
    if (value.length > 1) {
      const pastedData = value.slice(0, 6).replace(/[^0-9]/g, "").split("");
      const newOtp = [...otp];
      pastedData.forEach((char, i) => {
        if (index + i < 6) newOtp[index + i] = char;
      });
      setOtp(newOtp);
      const nextIndex = Math.min(5, index + pastedData.length);
      otpRefs.current[nextIndex]?.focus();
      return;
    }

    // Handle single char
    const sanitizedValue = value.replace(/[^0-9]/g, "");
    const newOtp = [...otp];
    newOtp[index] = sanitizedValue;
    setOtp(newOtp);

    if (sanitizedValue && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleStep2 = async (e: React.FormEvent) => {
    e.preventDefault();
    const otpString = otp.join("");
    if (otpString.length !== 6) {
      setError("Please enter the complete 6-digit OTP.");
      return;
    }
    setLoading(true);
    setError("");

    try {
      const res = await api.post<any>("/api/v1/auth/verify-otp", { email, otp: otpString });
      if (res.data?.resetToken) {
        setResetToken(res.data.resetToken);
      } else {
        // Fallback if backend returns token directly in a different property
        setResetToken(res.data?.token || res.data?.data?.resetToken);
      }
      setStep(3);
    } catch (err) {
      handleError(err, "Invalid or expired OTP. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleStep3 = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    setError("");

    try {
      await api.post<any>("/api/v1/auth/reset-password", {
        email,
        resetToken,
        newPassword,
      });
      setSuccessMessage("Your password has been successfully reset. You can now login with your new password.");
    } catch (err) {
      handleError(err, "Failed to reset password. Please try again or request a new OTP.");
    } finally {
      setLoading(false);
    }
  };

  // Focus management for OTP
  useEffect(() => {
    if (step === 2 && otpRefs.current[0]) {
      otpRefs.current[0].focus();
    }
  }, [step]);

  return (
    <div className="min-h-screen w-full bg-slate-950 flex flex-col items-center justify-center p-4 selection:bg-[#00D084]/30 selection:text-white">
      {/* Absolute top-left back button */}
      <div className="absolute top-8 left-8">
        <a
          href="/auth/login.html"
          className="flex items-center gap-2 text-sm font-medium text-slate-400 hover:text-white transition-colors bg-white/5 hover:bg-white/10 px-4 py-2 rounded-full border border-white/10 backdrop-blur-sm"
        >
          <ChevronLeft className="w-4 h-4" />
          Back to Login
        </a>
      </div>

      <div className="w-full max-w-md">
        {/* Brand Header */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center mb-4 shadow-xl">
            <ShieldCheck className="w-6 h-6 text-[#00D084]" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Account Recovery</h1>
          <p className="text-sm text-slate-400 mt-2 text-center max-w-[280px]">
            {step === 1 && "Enter the email associated with your account to receive a secure OTP."}
            {step === 2 && "We sent a 6-digit security code to your email. Enter it below."}
            {step === 3 && !successMessage && "Create a new, strong password for your account."}
            {successMessage && "You're all set."}
          </p>
        </div>

        {/* Main Card */}
        <div className="bg-slate-900/50 backdrop-blur-md border border-slate-800 rounded-2xl p-6 shadow-2xl relative overflow-hidden">
          
          {/* Decorative hairline */}
          <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-[#00D084]/50 to-transparent" />

          {/* Global Error Banner */}
          <AnimatePresence mode="wait">
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -10, height: 0 }}
                animate={{ opacity: 1, y: 0, height: "auto" }}
                exit={{ opacity: 0, y: -10, height: 0 }}
                className="mb-6 overflow-hidden"
              >
                <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-[0.82rem] font-medium px-4 py-3 rounded-lg flex items-start gap-2.5">
                  <ShieldCheck className="w-4 h-4 mt-[1px] shrink-0" />
                  <p>{error}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Success State */}
          <AnimatePresence mode="wait">
            {successMessage ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center py-6 text-center"
              >
                <div className="w-16 h-16 rounded-full bg-[#00D084]/10 border border-[#00D084]/20 flex items-center justify-center mb-5">
                  <CheckCircle2 className="w-8 h-8 text-[#00D084]" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">Password Reset!</h3>
                <p className="text-sm text-slate-400 mb-8">{successMessage}</p>
                <a
                  href="/auth/login.html"
                  className="w-full py-2.5 rounded-lg font-semibold bg-[#00D084] text-slate-950 transition-colors hover:bg-[#00E591] shadow-md flex items-center justify-center gap-2"
                >
                  Return to Login
                  <ArrowRight className="w-4 h-4" />
                </a>
              </motion.div>
            ) : (
              <div className="relative">
                {/* STEP 1 */}
                {step === 1 && (
                  <motion.form
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ duration: 0.2 }}
                    onSubmit={handleStep1}
                    className="space-y-4"
                  >
                    <div className="space-y-1.5">
                      <label className="text-[0.78rem] font-medium text-slate-300">Email Address</label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                          <Mail className="w-4 h-4" />
                        </div>
                        <input
                          type="email"
                          autoFocus
                          required
                          value={email}
                          onChange={(e) => {
                            setEmail(e.target.value);
                            setError("");
                          }}
                          disabled={loading}
                          placeholder="admin@yourstore.com"
                          className="w-full bg-slate-950/50 border border-slate-800 rounded-lg py-2.5 pl-9 pr-3 text-sm text-white placeholder-slate-600 outline-none transition-all focus:border-[#00D084]/50 focus:ring-1 focus:ring-[#00D084]/50 disabled:opacity-50"
                        />
                      </div>
                    </div>
                    <button
                      type="submit"
                      disabled={loading || !email}
                      className="w-full mt-2 py-2.5 rounded-lg font-semibold bg-[#00D084] text-slate-950 transition-colors hover:bg-[#00E591] shadow-md flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {loading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Sending...
                        </>
                      ) : (
                        <>
                          Send OTP
                          <ArrowRight className="w-4 h-4" />
                        </>
                      )}
                    </button>
                  </motion.form>
                )}

                {/* STEP 2 */}
                {step === 2 && (
                  <motion.form
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.2 }}
                    onSubmit={handleStep2}
                    className="space-y-6"
                  >
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between">
                        <label className="text-[0.78rem] font-medium text-slate-300">6-Digit Code</label>
                        <button
                          type="button"
                          onClick={() => setStep(1)}
                          className="text-[0.72rem] text-[#00D084] hover:text-[#00E591] font-medium"
                        >
                          Change Email
                        </button>
                      </div>
                      
                      <div className="flex justify-between gap-2">
                        {otp.map((digit, index) => (
                          <input
                            key={index}
                            ref={(el) => (otpRefs.current[index] = el)}
                            type="text"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            pattern="\d{1}"
                            maxLength={6} // allow pasting up to 6
                            value={digit}
                            onChange={(e) => handleOtpChange(index, e.target.value)}
                            onKeyDown={(e) => handleOtpKeyDown(index, e)}
                            disabled={loading}
                            className="w-12 h-14 bg-slate-950/50 border border-slate-800 rounded-xl text-center text-xl font-bold text-white outline-none transition-all focus:border-[#00D084]/50 focus:ring-1 focus:ring-[#00D084]/50 disabled:opacity-50"
                          />
                        ))}
                      </div>
                    </div>
                    <button
                      type="submit"
                      disabled={loading || otp.join("").length !== 6}
                      className="w-full py-2.5 rounded-lg font-semibold bg-[#00D084] text-slate-950 transition-colors hover:bg-[#00E591] shadow-md flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {loading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Verifying...
                        </>
                      ) : (
                        "Verify Code"
                      )}
                    </button>
                  </motion.form>
                )}

                {/* STEP 3 */}
                {step === 3 && (
                  <motion.form
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2 }}
                    onSubmit={handleStep3}
                    className="space-y-4"
                  >
                    <div className="space-y-1.5">
                      <label className="text-[0.78rem] font-medium text-slate-300">New Password</label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                          <KeyRound className="w-4 h-4" />
                        </div>
                        <input
                          type="password"
                          autoFocus
                          required
                          value={newPassword}
                          onChange={(e) => {
                            setNewPassword(e.target.value);
                            setError("");
                          }}
                          disabled={loading}
                          placeholder="••••••••"
                          className="w-full bg-slate-950/50 border border-slate-800 rounded-lg py-2.5 pl-9 pr-3 text-sm text-white placeholder-slate-600 outline-none transition-all focus:border-[#00D084]/50 focus:ring-1 focus:ring-[#00D084]/50 disabled:opacity-50"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[0.78rem] font-medium text-slate-300">Confirm Password</label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                          <Lock className="w-4 h-4" />
                        </div>
                        <input
                          type="password"
                          required
                          value={confirmPassword}
                          onChange={(e) => {
                            setConfirmPassword(e.target.value);
                            setError("");
                          }}
                          disabled={loading}
                          placeholder="••••••••"
                          className="w-full bg-slate-950/50 border border-slate-800 rounded-lg py-2.5 pl-9 pr-3 text-sm text-white placeholder-slate-600 outline-none transition-all focus:border-[#00D084]/50 focus:ring-1 focus:ring-[#00D084]/50 disabled:opacity-50"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={loading || !newPassword || !confirmPassword}
                      className="w-full mt-2 py-2.5 rounded-lg font-semibold bg-[#00D084] text-slate-950 transition-colors hover:bg-[#00E591] shadow-md flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {loading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Resetting...
                        </>
                      ) : (
                        "Update Password"
                      )}
                    </button>
                  </motion.form>
                )}
              </div>
            )}
          </AnimatePresence>
        </div>
        
        {/* Help text below card */}
        {step !== 3 && !successMessage && (
          <p className="text-center text-[0.7rem] text-slate-500 mt-6">
            If you need further assistance, please contact your account manager.
          </p>
        )}
      </div>
    </div>
  );
}
