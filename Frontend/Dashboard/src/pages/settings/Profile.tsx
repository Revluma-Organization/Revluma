import { FC, useState, useRef, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { useAuthStore } from "@/store/authStore";
import { ChangePasswordForm } from "./components/ChangePasswordForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Upload, X, Crown, Shield, User as UserIcon, ShieldCheck, Copy, Check, Loader2, QrCode } from "lucide-react";
import { DESIGN_TOKENS } from "@/lib/DesignConstants";
import { motion, AnimatePresence } from "framer-motion";
import { PageTransition, StaggeredList, StaggeredItem } from "@/components/MotionWrappers";
import { api } from "@/lib/api";

const MotionButton = motion.create(Button);

const Profile: FC = () => {
  const { user } = useAuth();
  const userRole = useAuthStore((s) => s.user?.role?.toLowerCase());
  const memberships = useAuthStore((s) => s.user?.organization_memberships);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [isEditingNames, setIsEditingNames] = useState(false);
  const [is2FAModalOpen, setIs2FAModalOpen] = useState(false);
  const [is2FAEnabled, setIs2FAEnabled] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [isVerifying2FA, setIsVerifying2FA] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);

  // New state for backend 2FA data
  const [setupSecret, setSetupSecret] = useState("");
  const [qrCodeUrl, setQrCodeUrl] = useState("");
  const [isFetching2FA, setIsFetching2FA] = useState(false);

  // Updated to use dynamic secret
  const handleCopySecret = () => {
    navigator.clipboard.writeText(setupSecret);
    setCopiedSecret(true);
    setTimeout(() => setCopiedSecret(false), 2000);
  };

  // New fetch function for the Setup button
  const handleSetup2FA = async () => {
    setIsFetching2FA(true);
    try {
      const res = await api.post("/auth/2fa/setup");
      setQrCodeUrl(res.data.qrCode);
      setSetupSecret(res.data.secret);
      setIs2FAModalOpen(true);
    } catch (err) {
      console.error("Failed to fetch 2FA setup data", err);
    } finally {
      setIsFetching2FA(false);
    }
  };

  const handleVerify2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpCode || otpCode.length < 6) return;
    setIsVerifying2FA(true);
    try {
      await api.post("/auth/2fa/verify", { code: otpCode }, { skipAuthRedirect: true });
      setIs2FAEnabled(true);
      setIs2FAModalOpen(false);
      setOtpCode("");
    } catch (err) {
      console.error("2FA verification API call failed:", err);
      setOtpCode(""); 
    } finally {
      setIsVerifying2FA(false);
    }
  };
  const handleDisable2FA = async () => {
    try {
      await api.post("/auth/2fa/disable");
      setIs2FAEnabled(false);
    } catch (err) {
      console.error("Failed to disable 2FA:", err);
    }
  };
  const nameParts = user?.full_name?.split(" ") || ["", ""];
  const initialFirstName = nameParts[0];
  const initialLastName = nameParts.slice(1).join(" ");

  const [firstName, setFirstName] = useState(initialFirstName);
  const [lastName, setLastName] = useState(initialLastName);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
    const fetchProfile = async () => {
      try {
        const res = await api.get("/api/v1/profile");
        if (res.data) {
          if (res.data.firstName) setFirstName(res.data.firstName);
          if (res.data.lastName) setLastName(res.data.lastName);
          if (res.data.profile_picture_url) setAvatarPreview(res.data.profile_picture_url);
        }
      } catch (err) {
        console.error("Failed to fetch profile data:", err);
        // Fallback to auth store if fetch fails
        setFirstName(initialFirstName);
        setLastName(initialLastName);
      }
    };

    fetchProfile();
  }, [initialFirstName, initialLastName]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setAvatarPreview(url);
    }
  };

    const handleSaveNames = async () => {
    try {
      await api.patch("/api/v1/profile", { firstName, lastName });
      setIsEditingNames(false);
    } catch (err) {
      console.error("Failed to update profile names:", err);
    }
  };

  return (
    <PageTransition className="max-w-4xl space-y-8 relative">
      <motion.div layout className="flex items-center justify-between">
        <div>
          <motion.h1 layout className={`text-2xl font-bold tracking-tight display ${DESIGN_TOKENS.primaryText}`}>Account</motion.h1>
          <motion.p layout className={`text-[0.85rem] mt-1 ${DESIGN_TOKENS.secondaryText}`}>Manage your personal profile and account settings.</motion.p>
        </div>
        <MotionButton whileTap={{ scale: 0.98 }} variant="ghost" size="icon" onClick={() => window.history.back()} className="rounded-full hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors">
          <X className="h-5 w-5 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white" />
        </MotionButton>
      </motion.div>

      <StaggeredList className={`space-y-0 shadow-sm relative overflow-hidden ${DESIGN_TOKENS.card}`}>
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-glass/[0.015] to-transparent" />

        {/* Profile Picture Section */}
        <StaggeredItem className="relative z-10 p-6 border-b border-slate-200 dark:border-slate-800">
          <motion.h3 layout className="font-semibold text-[0.85rem] text-slate-800 dark:text-slate-200 mb-4">Profile Picture</motion.h3>
          <motion.div layout className="flex flex-col sm:flex-row sm:items-center gap-6">
            <motion.div layout className="h-16 w-16 rounded-full bg-bg-3 overflow-hidden flex items-center justify-center border border-border shrink-0">
              {avatarPreview ? (
                <img src={avatarPreview} alt="Avatar" className="h-full w-full object-cover" />
              ) : (
                <div className="text-xl font-bold text-[#007FFF]">
                  {((firstName?.[0] || "") + (lastName?.[0] || "")).toUpperCase() || "?"}
                </div>
              )}
            </motion.div>
            <motion.div layout className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <input type="file" accept="image/png, image/jpeg, image/gif" className="hidden" ref={fileInputRef} onChange={handleFileChange} />
                <MotionButton whileTap={{ scale: 0.98 }} onClick={() => fileInputRef.current?.click()} className="bg-[hsl(var(--accent))] hover:bg-[hsl(var(--accent-2))] !text-white border-none font-bold shadow-[0_0_15px_hsl(var(--accent)/0.3)] flex items-center gap-2 rounded-lg text-xs h-8 px-4">
                  <Upload className="h-3.5 w-3.5" />
                  Upload Image
                </MotionButton>
                <MotionButton whileTap={{ scale: 0.98 }} onClick={() => setAvatarPreview(null)} variant="outline" className="rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs h-8 px-4 font-medium transition-colors">
                  Remove
                </MotionButton>
              </div>
              <p className="text-[0.75rem] text-slate-600 dark:text-slate-400 font-medium">Accepted formats: PNG, JPEG, GIF (Max 10MB)</p>
            </motion.div>
          </motion.div>
        </StaggeredItem>

        {/* Name Section */}
        <StaggeredItem className="relative z-10 p-6 border-b border-slate-200 dark:border-slate-800">
          <motion.div layout className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
            <div className="space-y-2">
              <Label htmlFor="firstName" className={`text-[0.8rem] font-semibold ${DESIGN_TOKENS.secondaryText}`}>First Name</Label>
              <Input 
                id="firstName" 
                value={firstName} 
                onChange={(e) => setFirstName(e.target.value)} 
                readOnly={!isEditingNames}
                className={`h-9 transition-all ${DESIGN_TOKENS.input} ${!isEditingNames ? 'opacity-70 cursor-not-allowed bg-slate-50 dark:bg-slate-900/50' : ''}`} 
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName" className={`text-[0.8rem] font-semibold ${DESIGN_TOKENS.secondaryText}`}>Last Name</Label>
              <Input 
                id="lastName" 
                value={lastName} 
                onChange={(e) => setLastName(e.target.value)} 
                readOnly={!isEditingNames}
                className={`h-9 transition-all ${DESIGN_TOKENS.input} ${!isEditingNames ? 'opacity-70 cursor-not-allowed bg-slate-50 dark:bg-slate-900/50' : ''}`} 
              />
            </div>
          </motion.div>
          <motion.div layout className="flex justify-end">
            {!isEditingNames ? (
              <MotionButton whileTap={{ scale: 0.98 }} onClick={() => setIsEditingNames(true)} variant="outline" className="rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs h-9 px-6 font-medium transition-colors">
                Edit
              </MotionButton>
            ) : (
              <MotionButton whileTap={{ scale: 0.98 }} onClick={handleSaveNames} className="bg-[#007FFF] hover:bg-[#007FFF]/90 text-white font-semibold transition-colors text-xs h-9 px-6 rounded-lg">
                Save
              </MotionButton>
            )}
          </motion.div>
        </StaggeredItem>

        {/* Email Section */}
        <StaggeredItem className="relative z-10 p-6 border-b border-slate-200 dark:border-slate-800">
          <motion.div layout className="space-y-2">
            <Label htmlFor="email" className={`text-[0.8rem] font-semibold ${DESIGN_TOKENS.secondaryText}`}>Email</Label>
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <Input id="email" defaultValue={user?.email || ""} readOnly disabled className={`max-w-md h-9 font-medium opacity-70 cursor-not-allowed ${DESIGN_TOKENS.input}`} />
            </div>
            <p className="text-[0.75rem] text-slate-600 dark:text-slate-400 font-medium pt-1">Used to log in to your account</p>
          </motion.div>
        </StaggeredItem>

        {/* Role & Organization Section */}
        <StaggeredItem className="relative z-10 p-6 border-b border-slate-200 dark:border-slate-800">
          <motion.div layout className="space-y-3">
            <Label className={`text-[0.8rem] font-semibold ${DESIGN_TOKENS.secondaryText}`}>Role</Label>
            <div className="flex items-center gap-3">
              <Badge
                variant="outline"
                className={`text-[0.75rem] font-semibold px-3 py-1 rounded-md capitalize gap-1.5 ${
                  userRole === "owner"
                    ? "bg-amber-500/15 text-amber-400 border border-amber-500/25"
                    : userRole === "admin"
                      ? "bg-blue-500/15 text-blue-400 border border-blue-500/25"
                      : "bg-slate-500/15 text-slate-400 border border-slate-500/25"
                }`}
              >
                {userRole === "owner" ? <Crown className="h-3.5 w-3.5" /> : userRole === "admin" ? <Shield className="h-3.5 w-3.5" /> : <UserIcon className="h-3.5 w-3.5" />}
                {userRole || "member"}
              </Badge>
              {memberships && memberships.length > 0 && (
                <p className="text-[0.75rem] text-slate-500 dark:text-slate-400 font-medium">
                  {memberships[0].organizations.company_name}
                </p>
              )}
            </div>
            <p className="text-[0.75rem] text-slate-600 dark:text-slate-400 font-medium">
              {userRole === "owner"
                ? "You are the organization owner with full control."
                : userRole === "admin"
                  ? "You can manage team members and settings."
                  : "Contact your organization owner to change your role."}
            </p>
          </motion.div>
        </StaggeredItem>

        {/* Password Section */}
        <StaggeredItem className="relative z-10 p-6 border-b border-slate-200 dark:border-slate-800">
          <motion.div layout className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <h3 className="font-semibold text-[0.85rem] text-slate-800 dark:text-slate-200">Password</h3>
            </div>
            {!showChangePassword && (
              <MotionButton whileTap={{ scale: 0.98 }} onClick={() => setShowChangePassword(true)} variant="outline" className="border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800 text-xs h-9 px-4 font-medium transition-colors shrink-0">
                Change Password
              </MotionButton>
            )}
          </motion.div>
          {showChangePassword && (
            <motion.div layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.25, ease: "easeOut" }} className="w-full mt-2 overflow-hidden">
              <ChangePasswordForm onCancel={() => setShowChangePassword(false)} />
            </motion.div>
          )}
        </StaggeredItem>

        {/* Two-Factor Authentication Section */}
        <StaggeredItem className="relative z-10 p-6">
          <motion.div layout className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-[0.85rem] text-slate-800 dark:text-slate-200">
                  Two-Factor Authentication (2FA)
                </h3>
                <Badge
                  variant="outline"
                  className={`text-[0.7rem] px-2 py-0.5 rounded-full font-medium ${
                    is2FAEnabled
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                      : "border-slate-700 bg-slate-800/80 text-slate-400"
                  }`}
                >
                  {is2FAEnabled ? "Enabled" : "Disabled"}
                </Badge>
              </div>
              <p className="text-[0.75rem] text-slate-600 dark:text-slate-400">
                Protect your Revluma account with an additional layer of security using an authenticator app.
              </p>
            </div>
            <MotionButton
              whileTap={{ scale: 0.98 }}
              onClick={is2FAEnabled ? handleDisable2FA : handleSetup2FA}
              variant="outline"
              className="border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800 text-xs h-9 px-4 font-medium transition-colors shrink-0"
            >
              <ShieldCheck className="mr-1.5 h-3.5 w-3.5 text-sky-400" />
              {is2FAEnabled ? "Manage 2FA" : "Setup 2FA"}
            </MotionButton>
          </motion.div>
        </StaggeredItem>
      </StaggeredList>

      {/* 2FA Setup Modal */}
      <AnimatePresence>
        {is2FAModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
            onClick={(e) => {
              if (e.target === e.currentTarget && !isVerifying2FA) {
                setIs2FAModalOpen(false);
              }
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              transition={{ type: "spring", stiffness: 300, damping: 28 }}
              className="relative w-full max-w-md overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 p-6 text-slate-100 shadow-2xl sm:p-8"
            >
              <button
                type="button"
                onClick={() => setIs2FAModalOpen(false)}
                disabled={isVerifying2FA}
                className="absolute right-4 top-4 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white disabled:opacity-50"
                aria-label="Close modal"
              >
                <X className="h-5 w-5" />
              </button>

              <div className="flex flex-col items-center text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-sky-500/10 text-sky-400 ring-1 ring-sky-500/20">
                  <ShieldCheck className="h-6 w-6" />
                </div>
                <h3 className="mt-4 text-lg font-bold text-white">
                  Setup Two-Factor Authentication
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-400">
                  Scan the QR code below using your authenticator app (e.g. Google Authenticator, 1Password, or Authy).
                </p>
              </div>

              {/* Placeholder QR Code */}
              <div className="my-6 flex flex-col items-center justify-center gap-3">
                <div className="flex h-36 w-36 items-center justify-center rounded-2xl border border-slate-200 bg-white p-4 shadow-md">
                  {qrCodeUrl ? (
    <img src={qrCodeUrl} alt="2FA QR Code" className="h-32 w-32 rounded-md bg-white p-1" />
  ) : (
    <div className="h-32 w-32 animate-pulse rounded-md bg-slate-800" />
  )}
                </div>
                <p className="text-[0.7rem] text-slate-500">
                  Can&apos;t scan? Enter the secret key manually:
                </p>
              </div>

              {/* Secret Key Copy Block */}
              <div className="mb-6 flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-2 font-mono text-xs text-slate-300">
                <span className="select-all tracking-widest">{setupSecret}</span>
                <button
                  type="button"
                  onClick={handleCopySecret}
                  className="inline-flex items-center gap-1 rounded bg-slate-800 px-2 py-1 text-[0.7rem] font-sans text-slate-300 hover:bg-slate-700 hover:text-white"
                >
                  {copiedSecret ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-400" />
                      <span className="text-emerald-400">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      <span>Copy Secret Key</span>
                    </>
                  )}
                </button>
              </div>

              {/* 6-Digit OTP Form */}
              <form onSubmit={handleVerify2FA} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="otp-code" className="text-xs font-semibold text-slate-300">
                    Verification Code
                  </Label>
                  <Input
                    id="otp-code"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="123456"
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                    className="h-11 text-center font-mono text-base tracking-[0.35em] border-slate-700 bg-slate-900/80 text-white placeholder:tracking-normal placeholder:text-slate-600 focus-visible:border-sky-500"
                    disabled={isVerifying2FA}
                  />
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIs2FAModalOpen(false)}
                    disabled={isVerifying2FA}
                    className="h-10 flex-1 border-slate-700 bg-transparent text-slate-300 hover:bg-slate-800 hover:text-white"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={otpCode.length !== 6 || isVerifying2FA}
                    className="h-10 flex-1 bg-[#007FFF] font-semibold text-white hover:bg-[#007FFF]/90 disabled:opacity-50"
                  >
                    {isVerifying2FA ? (
                      <span className="flex items-center justify-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Verifying...
                      </span>
                    ) : (
                      "Verify & Enable"
                    )}
                  </Button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </PageTransition>
  );
};

export default Profile;

