import { FC, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { ChangePasswordForm } from "./components/ChangePasswordForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload } from "lucide-react";
import { DESIGN_TOKENS } from "@/lib/DesignConstants";

const Profile: FC = () => {
  const { user } = useAuth();
  const [showChangePassword, setShowChangePassword] = useState(false);

  const nameParts = user?.full_name?.split(" ") || ["", ""];
  const firstName = nameParts[0];
  const lastName = nameParts.slice(1).join(" ");

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <h1 className={`text-2xl font-bold tracking-tight display ${DESIGN_TOKENS.primaryText}`}>Account</h1>
        <p className={`text-[0.85rem] mt-1 ${DESIGN_TOKENS.secondaryText}`}>Manage your personal profile and account settings.</p>
      </div>

      <div className={`space-y-8 p-6 shadow-sm relative overflow-hidden ${DESIGN_TOKENS.card}`}>
        {/* Subtle glass gradient effect */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-glass/[0.015] to-transparent" />

        {/* Profile Picture Section */}
        <div className="relative z-10 flex flex-col gap-2">
          <h3 className="font-semibold text-[0.85rem] text-t1">Profile Picture</h3>
          <div className="flex flex-col sm:flex-row sm:items-center gap-6 mt-2">
            <div className="h-16 w-16 rounded-full bg-bg-3 overflow-hidden flex items-center justify-center border border-border">
              <img src="https://ui-avatars.com/api/?name=Dianne+Russell&background=222&color=00e5a0" alt="Avatar" className="h-full w-full object-cover" />
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <Button className="bg-[hsl(var(--accent))] hover:bg-[hsl(var(--accent-2))] !text-black border-none font-bold shadow-[0_0_15px_hsl(var(--accent)/0.3)] flex items-center gap-2 rounded-lg text-xs h-8 px-4">
                  <Upload className="h-3.5 w-3.5" />
                  Upload Image
                </Button>
                <Button variant="outline" className="rounded-lg border-border bg-bg-3 text-t2 hover:text-t1 hover:bg-glass/[0.065] text-xs h-8 px-4 font-medium transition-colors">
                  Remove
                </Button>
              </div>
              <p className="text-[0.7rem] text-t3 font-medium">We support PNGs, JPEGs and GIFs under 10MB</p>
            </div>
          </div>
        </div>

        {/* Name Section */}
        <div className="relative z-10 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label htmlFor="firstName" className={`text-[0.8rem] font-semibold ${DESIGN_TOKENS.secondaryText}`}>First Name</Label>
            <Input id="firstName" defaultValue={firstName} className={`h-9 transition-all ${DESIGN_TOKENS.input}`} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lastName" className={`text-[0.8rem] font-semibold ${DESIGN_TOKENS.secondaryText}`}>Last Name</Label>
            <Input id="lastName" defaultValue={lastName} className={`h-9 transition-all ${DESIGN_TOKENS.input}`} />
          </div>
        </div>

        {/* Email Section */}
        <div className="relative z-10 space-y-2">
          <Label htmlFor="email" className={`text-[0.8rem] font-semibold ${DESIGN_TOKENS.secondaryText}`}>Email</Label>
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <Input id="email" defaultValue={user?.email || ""} readOnly disabled className={`max-w-md h-9 font-medium opacity-70 cursor-not-allowed ${DESIGN_TOKENS.input}`} />
          </div>
          <p className="text-[0.7rem] text-t3 font-medium pt-1">Used to log in to your account</p>
        </div>
        
        <hr className="relative z-10 border-border" />

        {/* Password Section */}
        <div className="relative z-10">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <h3 className="font-semibold text-[0.85rem] text-t1">Password</h3>
              <p className="text-[0.75rem] text-t3">Log in with your password instead of using temporary login codes</p>
            </div>
            {!showChangePassword && (
              <Button onClick={() => setShowChangePassword(true)} variant="outline" className="rounded-lg border-border bg-bg-3 text-t2 hover:text-t1 hover:bg-glass/[0.065] text-xs h-9 px-4 font-medium transition-colors shrink-0">
                Change Password
              </Button>
            )}
          </div>
          {showChangePassword && (
            <ChangePasswordForm onCancel={() => setShowChangePassword(false)} />
          )}
        </div>
      </div>

      {/* Save / Cancel Bar */}
      <div className="flex items-center justify-end gap-3 pt-4">
        <Button variant="ghost" className={`h-9 px-6 text-xs ${DESIGN_TOKENS.secondaryText} hover:${DESIGN_TOKENS.primaryText}`}>
          Cancel
        </Button>
        <Button className={`h-9 px-8 text-xs ${DESIGN_TOKENS.buttonPrimary}`}>
          Save Changes
        </Button>
      </div>
    </div>
  );
};

export default Profile;
