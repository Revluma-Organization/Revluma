import { FC, useState, useRef, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { useAuthStore } from "@/store/authStore";
import { ChangePasswordForm } from "./components/ChangePasswordForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Upload, X, Crown, Shield, User as UserIcon } from "lucide-react";
import { DESIGN_TOKENS } from "@/lib/DesignConstants";
import { motion } from "framer-motion";
import { PageTransition, StaggeredList, StaggeredItem } from "@/components/MotionWrappers";

const MotionButton = motion.create(Button);

const Profile: FC = () => {
  const { user } = useAuth();
  const userRole = useAuthStore((s) => s.user?.role?.toLowerCase());
  const memberships = useAuthStore((s) => s.user?.organization_memberships);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [isEditingNames, setIsEditingNames] = useState(false);

  const nameParts = user?.full_name?.split(" ") || ["", ""];
  const initialFirstName = nameParts[0];
  const initialLastName = nameParts.slice(1).join(" ");

  const [firstName, setFirstName] = useState(initialFirstName);
  const [lastName, setLastName] = useState(initialLastName);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setFirstName(initialFirstName);
    setLastName(initialLastName);
  }, [initialFirstName, initialLastName]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setAvatarPreview(url);
    }
  };

  const handleSaveNames = () => {
    // Save logic would go here
    setIsEditingNames(false);
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
                <div className="text-xl font-bold text-[#00e5a0]">
                  {((firstName?.[0] || "") + (lastName?.[0] || "")).toUpperCase() || "?"}
                </div>
              )}
            </motion.div>
            <motion.div layout className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <input type="file" accept="image/png, image/jpeg, image/gif" className="hidden" ref={fileInputRef} onChange={handleFileChange} />
                <MotionButton whileTap={{ scale: 0.98 }} onClick={() => fileInputRef.current?.click()} className="bg-[hsl(var(--accent))] hover:bg-[hsl(var(--accent-2))] !text-black border-none font-bold shadow-[0_0_15px_hsl(var(--accent)/0.3)] flex items-center gap-2 rounded-lg text-xs h-8 px-4">
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
              <MotionButton whileTap={{ scale: 0.98 }} onClick={handleSaveNames} className="bg-[#00D084] hover:bg-[#00B370] text-slate-950 font-semibold transition-colors text-xs h-9 px-6 rounded-lg">
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
        <StaggeredItem className="relative z-10 p-6">
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
      </StaggeredList>
    </PageTransition>
  );
};

export default Profile;

