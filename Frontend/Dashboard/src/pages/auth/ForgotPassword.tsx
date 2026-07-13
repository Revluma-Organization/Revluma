import { useState } from "react";
import { useAuthStore } from "@/store/authStore";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { DESIGN_TOKENS } from "@/lib/DesignConstants";
import { Loader2, ArrowLeft, Mail, KeyRound, Lock } from "lucide-react";

export default function ForgotPassword() {
  const { requestOtp, verifyOtp, resetPassword, loading, error, clearError } = useAuthStore();
  
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [resetToken, setResetToken] = useState("");
  
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [localError, setLocalError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    setLocalError("");
    if (!email) return setLocalError("Email is required.");
    
    try {
      await requestOtp(email);
      setStep(2);
    } catch (err) {}
  };

  const handleOtpChange = (index: number, value: string) => {
    if (value.length > 1) return; // Only allow 1 char
    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);
    
    // Auto focus next
    if (value && index < 5) {
      const nextInput = document.getElementById(`otp-${index + 1}`);
      nextInput?.focus();
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      const prevInput = document.getElementById(`otp-${index - 1}`);
      prevInput?.focus();
    }
  };

  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    setLocalError("");
    const code = otp.join("");
    if (code.length < 6) return setLocalError("Please enter the 6-digit code.");
    
    try {
      const res = await verifyOtp(email, code);
      setResetToken(res.resetToken);
      setStep(3);
    } catch (err) {}
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    setLocalError("");
    
    if (newPassword !== confirmPassword) return setLocalError("Passwords do not match.");
    if (newPassword.length < 8) return setLocalError("Password must be at least 8 characters.");
    
    try {
      await resetPassword(email, resetToken, newPassword);
      setSuccess(true);
      setTimeout(() => {
        window.location.href = "/auth/login.html";
      }, 2000);
    } catch (err) {}
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-bg-1 p-4">
      <div className={`w-full max-w-md p-8 ${DESIGN_TOKENS.card} relative overflow-hidden`}>
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-glass/[0.015] to-transparent" />
        
        <div className="relative z-10 flex flex-col items-center text-center mb-8">
          <div className="h-12 w-12 rounded-full bg-[hsl(var(--accent)/0.1)] border border-[hsl(var(--accent)/0.2)] flex items-center justify-center mb-4 text-[hsl(var(--accent))]">
            {step === 1 && <Mail className="h-6 w-6" />}
            {step === 2 && <KeyRound className="h-6 w-6" />}
            {step === 3 && <Lock className="h-6 w-6" />}
          </div>
          <h2 className={`text-2xl font-bold tracking-tight display ${DESIGN_TOKENS.primaryText}`}>
            {step === 1 && "Forgot Password"}
            {step === 2 && "Enter Verification Code"}
            {step === 3 && "Set New Password"}
          </h2>
          <p className={`text-[0.85rem] mt-2 ${DESIGN_TOKENS.secondaryText}`}>
            {step === 1 && "Enter your email address and we'll send you a 6-digit verification code to reset your password."}
            {step === 2 && `We've sent a code to ${email}`}
            {step === 3 && "Your new password must be different to previously used passwords."}
          </p>
        </div>

        <div className="relative z-10">
          {(localError || error) && (
            <div className="mb-4 p-3 rounded-md bg-red-500/10 border border-red-500/20 text-red-500 text-[0.75rem] font-medium text-center">
              {localError || error}
            </div>
          )}

          {success && (
            <div className="mb-4 p-3 rounded-md bg-[#00D084]/10 border border-[#00D084]/20 text-[#00D084] text-[0.75rem] font-medium text-center">
              Password successfully reset! Redirecting to login...
            </div>
          )}

          {step === 1 && (
            <form onSubmit={handleEmailSubmit} className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
              <div className="space-y-2 text-left">
                <Label htmlFor="email" className={`text-[0.8rem] font-semibold ${DESIGN_TOKENS.secondaryText}`}>Email Address</Label>
                <Input 
                  id="email" 
                  type="email" 
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={`h-10 transition-all ${DESIGN_TOKENS.input}`} 
                />
              </div>
              <Button type="submit" disabled={loading} className={`w-full h-10 ${DESIGN_TOKENS.buttonPrimary}`}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Send Verification Code"}
              </Button>
              <div className="text-center pt-4">
                <a href="/auth/login.html" className="text-[0.8rem] text-t3 hover:text-t1 font-medium inline-flex items-center gap-1 transition-colors">
                  <ArrowLeft className="h-3.5 w-3.5" /> Back to Login
                </a>
              </div>
            </form>
          )}

          {step === 2 && (
            <form onSubmit={handleOtpSubmit} className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
              <div className="flex justify-center gap-2">
                {otp.map((digit, i) => (
                  <Input
                    key={i}
                    id={`otp-${i}`}
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="\d{1}"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOtpChange(i, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(i, e)}
                    className={`h-12 w-12 text-center text-lg font-bold transition-all ${DESIGN_TOKENS.input}`}
                  />
                ))}
              </div>
              <Button type="submit" disabled={loading} className={`w-full h-10 ${DESIGN_TOKENS.buttonPrimary}`}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Verify Code"}
              </Button>
              <div className="text-center pt-2">
                <button type="button" onClick={() => setStep(1)} className="text-[0.8rem] text-t3 hover:text-t1 font-medium inline-flex items-center gap-1 transition-colors">
                  <ArrowLeft className="h-3.5 w-3.5" /> Change Email
                </button>
              </div>
            </form>
          )}

          {step === 3 && (
            <form onSubmit={handlePasswordSubmit} className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
              <div className="space-y-2 text-left">
                <Label htmlFor="newPassword" className={`text-[0.8rem] font-semibold ${DESIGN_TOKENS.secondaryText}`}>New Password</Label>
                <Input 
                  id="newPassword" 
                  type="password" 
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className={`h-10 transition-all ${DESIGN_TOKENS.input}`} 
                />
              </div>
              <div className="space-y-2 text-left">
                <Label htmlFor="confirmPassword" className={`text-[0.8rem] font-semibold ${DESIGN_TOKENS.secondaryText}`}>Confirm New Password</Label>
                <Input 
                  id="confirmPassword" 
                  type="password" 
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className={`h-10 transition-all ${DESIGN_TOKENS.input}`} 
                />
              </div>
              <Button type="submit" disabled={loading || success} className={`w-full h-10 mt-2 ${DESIGN_TOKENS.buttonPrimary}`}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Reset Password"}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
