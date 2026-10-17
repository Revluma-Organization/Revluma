import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mail, KeyRound, Lock, ArrowRight, Loader2, CheckCircle2, ShieldCheck, ChevronLeft, AlertCircle, Eye, EyeOff } from "lucide-react";
import { api } from "@/lib/api";

export default function ForgotPassword() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [resendSeconds, setResendSeconds] = useState(0);
  const [expirySeconds, setExpirySeconds] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Form State
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Helpers
  const handleError = (err: unknown, fallback: string) => {
    const apiError = err as { body?: { error?: string; message?: string; errors?: string[] }; status?: number; message?: string };
    const body = apiError?.body;
    const backendMessage = body?.error || body?.message || body?.errors?.[0];
    if (apiError?.status === 400) setError(backendMessage || "We couldn’t verify those details. Check them and try again.");
    else if (apiError?.status === 429) setError("Too many attempts. Please wait before trying again.");
    else if (apiError?.status === 0) setError("We couldn’t connect. Check your connection and try again.");
    else setError(backendMessage || fallback);
  };

  const formatTime = (seconds: number) => String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
  const maskedEmail = (value: string) => {
    const parts = value.split("@");
    if (parts.length !== 2) return value;
    return parts[0].slice(0, 1) + "•••••@" + parts[1];
  };

  useEffect(() => {
    if (step !== 2 || (resendSeconds <= 0 && expirySeconds <= 0)) return;
    const interval = window.setInterval(() => {
      setResendSeconds((value) => Math.max(0, value - 1));
      setExpirySeconds((value) => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [step, resendSeconds > 0, expirySeconds > 0]);

  const handleStep1 = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      setError("Please enter your email address.");
      return;
    }
    setLoading(true);
    setError("");

    try {
      await api.post<any>("/auth/forgot-password", { email });
      setOtp(["", "", "", "", "", ""]);
      setResendSeconds(45);
      setExpirySeconds(10 * 60);
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

  const handleResend = async () => {
    if (loading || resendSeconds > 0) return;
    setLoading(true);
    setError("");
    try {
      await api.post<any>("/auth/forgot-password", { email });
      setOtp(["", "", "", "", "", ""]);
      setResendSeconds(45);
      setExpirySeconds(10 * 60);
      otpRefs.current[0]?.focus();
    } catch (err) {
      handleError(err, "We couldn’t request another code. Please try again.");
    } finally {
      setLoading(false);
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
      const res = await api.post<any>("/auth/forgot-password/verify", { 
        email, 
        code: otpString 
      });
            const token = res.data?.reset_token 
        || res.data?.resetToken 
        || res.data?.data?.reset_token 
        || res.data?.data?.resetToken 
        || res.data?.token;

      if (token) {
        setResetToken(token);
        setStep(3);
      } else {
        throw new Error("Verification successful, but no reset token was returned.");
      }
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
      await api.post<any>("/auth/forgot-password/reset", {
        email: email,
        reset_token: resetToken,
        password: newPassword,
      });
      setSuccessMessage("Your password has been updated. Redirecting you to sign in…");
      window.setTimeout(() => { window.location.assign("/auth/login.html?reset=1"); }, 1800);
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
    <div className="recovery-page min-h-screen w-full flex flex-col items-center justify-center px-4 py-16 sm:py-20">
      {/* Absolute top-left back button */}
      <div className="absolute top-6 left-6 sm:top-8 sm:left-8">
        <a href="/auth/login.html" className="recovery-back flex items-center gap-2 text-sm font-semibold px-3 py-2 rounded-lg transition-colors">
          <ChevronLeft className="w-4 h-4" /> Back to sign in
        </a>
      </div>

      <div className="w-full max-w-[440px]">
        {/* Brand Header */}
        <div className="flex flex-col items-center mb-8">
          <div className="recovery-illustration-wrap" aria-hidden="true">
            {step === 1 ? <Mail className="recovery-hero-icon" strokeWidth={1.7} /> : step === 2 ? <ShieldCheck className="recovery-hero-icon" strokeWidth={1.7} /> : successMessage ? <CheckCircle2 className="recovery-hero-icon" strokeWidth={1.7} /> : <Lock className="recovery-hero-icon" strokeWidth={1.7} />}
          </div>
          <h1 className="text-[28px] sm:text-3xl font-bold tracking-tight text-slate-950">{step === 1 ? "Forgot your password?" : step === 2 ? "Enter OTP code" : successMessage ? "Password updated" : "Create new password"}</h1>
          <p className="text-sm text-slate-600 mt-2 text-center max-w-[320px]">
            {step === 1 && "Enter the email associated with your account to receive a secure OTP."}
            {step === 2 && "We sent a 6-digit security code to your email. Enter it below."}
            {step === 3 && !successMessage && "Create a new, strong password for your account."}
            {successMessage && "You're all set."}
          </p>
        </div>

        {/* Main Card */}
        <div className="recovery-card border rounded-2xl p-6 sm:p-8 relative overflow-hidden">
          
          {/* Decorative hairline */}
          <div className="absolute top-0 left-0 w-full h-1 bg-blue-600" />

          {/* Global Error Banner */}
          <AnimatePresence mode="wait">
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -10, height: 0 }}
                animate={{ opacity: 1, y: 0, height: "auto" }}
                exit={{ opacity: 0, y: -10, height: 0 }}
                className="mb-6 overflow-hidden"
              >
                <div role="alert" aria-live="polite" className="recovery-alert recovery-alert-error text-sm font-semibold px-4 py-3 rounded-xl flex items-start gap-2.5">
                  <AlertCircle className="w-5 h-5 mt-[1px] shrink-0" aria-hidden="true" />
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
                <div className="recovery-illustration-wrap recovery-illustration-large" aria-hidden="true"><CheckCircle2 className="recovery-hero-icon" strokeWidth={1.7} /></div>
                <h3 className="text-xl font-bold text-slate-950 mb-2">Password updated</h3>
                <div role="status" aria-live="polite" className="recovery-alert recovery-alert-success mb-6 text-sm font-medium px-4 py-3 rounded-xl">{successMessage}</div>
                <a
                  href="/auth/login.html"
                  className="recovery-primary w-full py-3 rounded-lg font-bold transition-colors flex items-center justify-center gap-2"
                >
                  Return to login
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
                      <label htmlFor="recovery-email" className="text-sm font-bold text-slate-800">Email address</label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-blue-500">
                          <Mail className="w-5 h-5" />
                        </div>
                        <input
                          id="recovery-email"
                          type="email"
                          autoComplete="email"
                          autoFocus
                          required
                          value={email}
                          onChange={(e) => {
                            setEmail(e.target.value);
                            setError("");
                          }}
                          disabled={loading}
                          placeholder="you@example.com"
                          className="recovery-input w-full rounded-xl py-4 pl-12 pr-4 text-base outline-none transition-all disabled:opacity-50"
                        />
                      </div>
                    </div>
                    <button
                      type="submit"
                      disabled={loading || !email}
                      className="recovery-primary w-full mt-2 py-3 rounded-lg font-bold transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
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
                    <div className="space-y-4">
                      <div className="recovery-destination rounded-xl border p-4">
                        <p className="text-sm font-bold text-slate-900">Check your inbox</p>
                        <p className="mt-1 text-sm text-slate-700">We requested a code for {maskedEmail(email)}.</p>
                        <p className="mt-2 text-xs leading-5 text-slate-600">If it doesn’t arrive, check your spam folder. For security, we don’t reveal whether an account exists.</p>
                      </div>
                      <div className="space-y-2.5">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-bold text-slate-800">6-digit verification code</label>
                        <button
                          type="button"
                          onClick={() => setStep(1)}
                          className="text-sm text-blue-700 hover:text-blue-900 font-bold"
                        >
                          Change Email
                        </button>
                      </div>
                      
                      <div className="flex justify-between gap-2 sm:gap-3">
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
                            className="recovery-otp min-w-0 flex-1 h-14 sm:h-16 rounded-xl text-center text-xl sm:text-2xl font-bold outline-none transition-all disabled:opacity-50"
                          />
                        ))}
                      </div>
                      </div>
                    </div>
                    <button
                      type="submit"
                      disabled={loading || otp.join("").length !== 6}
                      className="recovery-primary w-full py-3 rounded-lg font-bold transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
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
                    <div className="flex flex-col gap-3 border-t border-slate-800 pt-4 text-sm sm:flex-row sm:items-center sm:justify-between">
                      <span className={expirySeconds > 0 ? "text-slate-600" : "text-amber-700"}>{expirySeconds > 0 ? "Code expires in " + formatTime(expirySeconds) : "This code may have expired. Request a new one."}</span>
                      <button type="button" onClick={handleResend} disabled={loading || resendSeconds > 0} className="inline-flex items-center gap-2 font-bold text-blue-700 transition hover:text-blue-900 disabled:cursor-not-allowed disabled:text-slate-400">
                        {resendSeconds > 0 ? "Resend code in " + formatTime(resendSeconds) : "Resend code"}
                      </button>
                    </div>
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
                      <label className="text-sm font-bold text-slate-800">New password</label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                          <KeyRound className="w-4 h-4" />
                        </div>
                        <input
                          type={showPassword ? "text" : "password"}
                          autoComplete="new-password"
                          autoFocus
                          required
                          value={newPassword}
                          onChange={(e) => {
                            setNewPassword(e.target.value);
                            setError("");
                          }}
                          disabled={loading}
                          placeholder="••••••••"
                          className="recovery-input w-full rounded-lg py-3 pl-10 pr-12 text-sm outline-none transition-all disabled:opacity-50"
                        />
                        <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"} className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-500 hover:text-blue-700">{showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}</button>
                      </div>
                      <p className="text-xs leading-5 text-slate-600">Use at least 8 characters, including uppercase and lowercase letters, a number, and a supported special character.</p>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-sm font-bold text-slate-800">Confirm password</label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                          <Lock className="w-4 h-4" />
                        </div>
                        <input
                          type={showConfirmPassword ? "text" : "password"}
                          autoComplete="new-password"
                          required
                          value={confirmPassword}
                          onChange={(e) => {
                            setConfirmPassword(e.target.value);
                            setError("");
                          }}
                          disabled={loading}
                          placeholder="••••••••"
                          className="recovery-input w-full rounded-lg py-3 pl-10 pr-12 text-sm outline-none transition-all disabled:opacity-50"
                        />
                        <button type="button" onClick={() => setShowConfirmPassword((value) => !value)} aria-label={showConfirmPassword ? "Hide confirmation password" : "Show confirmation password"} className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-500 hover:text-blue-700">{showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}</button>
                      </div>
                      {confirmPassword && <p className={`text-xs ${newPassword === confirmPassword ? "text-blue-700" : "text-amber-700"}`}>{newPassword === confirmPassword ? "Passwords match" : "Passwords do not match yet"}</p>}
                    </div>

                    <button
                      type="submit"
                      disabled={loading || !newPassword || !confirmPassword}
                      className="w-full mt-2 py-2.5 rounded-lg font-semibold bg-[#007FFF] text-white transition-colors hover:bg-[#007FFF]/90 shadow-md flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
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
      <style>{`
        .recovery-page { background:radial-gradient(ellipse at top, #eaf3ff 0%, #f5f8ff 45%, #f8fafc 100%); color:#111827; font-family:Arial,Helvetica,sans-serif; }
        .recovery-page * { font-family:Arial,Helvetica,sans-serif; }
        .recovery-page .recovery-back { color:#31527f; background:rgba(255,255,255,.82); border:1px solid #d8e5f8; box-shadow:0 2px 8px rgba(37,99,235,.04); }
        .recovery-page .recovery-back:hover { background:#fff; color:#1d4ed8; }
        .recovery-page .text-white { color:#0f172a!important; } .recovery-page .text-slate-100 { color:#0f172a!important; } .recovery-page .text-slate-200 { color:#1e293b!important; } .recovery-page .text-slate-300 { color:#334155!important; } .recovery-page .text-slate-400 { color:#475569!important; } .recovery-page .text-slate-500 { color:#64748b!important; } .recovery-page .text-slate-600 { color:#475569!important; }
        .recovery-page .recovery-card { background:rgba(255,255,255,.96); border-color:#e0eaf8; box-shadow:0 24px 70px rgba(37,99,235,.10); padding:30px; }
        .recovery-page .recovery-input { background:#fff; border:1px solid #dbe5f2; color:#0f172a; }
        .recovery-page .recovery-input::placeholder { color:#94a3b8; }
        .recovery-page .recovery-input:focus { border-color:#3b82f6; box-shadow:0 0 0 4px rgba(59,130,246,.12); }
        .recovery-page .recovery-otp { background:#fff; border:1px solid #cbd5e1; color:#0f172a; }
        .recovery-page .recovery-otp:focus { border-color:#2563eb; box-shadow:0 0 0 4px rgba(37,99,235,.12); }
        .recovery-page .recovery-primary { background:linear-gradient(100deg,#2563eb,#1677ff); color:#fff; box-shadow:0 8px 18px rgba(37,99,235,.18); border-radius:12px; min-height:52px; }
        .recovery-page .recovery-primary:hover:not(:disabled) { background:linear-gradient(100deg,#1d4ed8,#0965df); }
        .recovery-page .recovery-destination { background:#f4f8ff; border-color:#dbeafe; }
        .recovery-page .recovery-alert-error { color:#991b1b; background:#fef2f2; border:1px solid #fecaca; }
        .recovery-page .recovery-alert-success { color:#166534; background:#f0fdf4; border:1px solid #bbf7d0; }
        .recovery-page .recovery-illustration-wrap { width:88px; height:88px; border-radius:26px; display:flex; align-items:center; justify-content:center; margin-bottom:18px; color:#2563eb; background:linear-gradient(145deg,#eff6ff,#dbeafe); border:1px solid #dbeafe; box-shadow:0 12px 28px rgba(37,99,235,.10); } .recovery-page .recovery-hero-icon { width:46px; height:46px; }
        .recovery-page .recovery-illustration-large { width:96px; height:96px; margin:0 auto 18px; }
        @media (max-width:640px) { .recovery-page .absolute.top-6.left-6 { top:12px; left:12px; } .recovery-page .recovery-card { padding:22px; } .recovery-page .recovery-illustration-wrap { width:76px; height:76px; border-radius:22px; } .recovery-page .recovery-hero-icon { width:40px; height:40px; } }
        @media (prefers-reduced-motion:reduce) { .recovery-page *, .recovery-page *::before, .recovery-page *::after { animation-duration:.01ms!important; transition-duration:.01ms!important; } }
      `}</style>
    </div>
  );
}
