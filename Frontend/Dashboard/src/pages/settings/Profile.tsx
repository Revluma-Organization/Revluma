import { FC, useState, useRef, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { ChangePasswordForm } from "./components/ChangePasswordForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload, X } from "lucide-react";
import { DESIGN_TOKENS } from "@/lib/DesignConstants";

const Profile: FC = () => {
  const { user } = useAuth();
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
    <div className="max-w-4xl space-y-8 relative">
      <div className="flex items-center justify-between">
        <div>
          <h1 className={`text-2xl font-bold tracking-tight display ${DESIGN_TOKENS.primaryText}`}>Account</h1>
          <p className={`text-[0.85rem] mt-1 ${DESIGN_TOKENS.secondaryText}`}>Manage your personal profile and account settings.</p>
        </div>
        <Button variant="ghost" size="icon" onClick={() => window.history.back()} className="rounded-full hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors">
          <X className="h-5 w-5 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white" />
        </Button>
      </div>

      <div className={`space-y-0 shadow-sm relative overflow-hidden ${DESIGN_TOKENS.card}`}>
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-glass/[0.015] to-transparent" />

        {/* Profile Picture Section */}
        <div className="relative z-10 p-6 border-b border-slate-200 dark:border-slate-800">
          <h3 className="font-semibold text-[0.85rem] text-t1 mb-4">Profile Picture</h3>
          <div className="flex items-center gap-6 mb-4">
            <div className="h-16 w-16 rounded-full bg-bg-3 overflow-hidden flex items-center justify-center border border-border shrink-0">
              {avatarPreview ? (
                <img src={avatarPreview} alt="Avatar" className="h-full w-full object-cover" />
              ) : (
                <div className="text-xl font-bold text-[#00e5a0]">
                  {((firstName?.[0] || "") + (lastName?.[0] || "")).toUpperCase() || "?"}
                </div>
              )}
            </div>
            <p className="text-[0.7rem] text-t3 font-medium">Accepted formats: PNG, JPEG, GIF (Max 10MB)</p>
          </div>
          <div className="flex items-center justify-end gap-3">
            <input type="file" accept="image/png, image/jpeg, image/gif" className="hidden" ref={fileInputRef} onChange={handleFileChange} />
            <Button onClick={() => setAvatarPreview(null)} variant="outline" className="rounded-lg border-border bg-bg-3 text-t2 hover:text-t1 hover:bg-glass/[0.065] text-xs h-9 px-4 font-medium transition-colors">
              Remove
            </Button>
            <Button onClick={() => fileInputRef.current?.click()} className="bg-[#00D084] hover:bg-[#00B370] text-slate-950 font-semibold transition-colors text-xs h-9 px-4 rounded-lg flex items-center gap-2">
              <Upload className="h-3.5 w-3.5" />
              Upload Image
            </Button>
          </div>
        </div>

        {/* Name Section */}
        <div className="relative z-10 p-6 border-b border-slate-200 dark:border-slate-800">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
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
          </div>
          <div className="flex justify-end">
            {!isEditingNames ? (
              <Button onClick={() => setIsEditingNames(true)} variant="outline" className="rounded-lg border-border bg-bg-3 text-t2 hover:text-t1 hover:bg-glass/[0.065] text-xs h-9 px-6 font-medium transition-colors">
                Edit
              </Button>
            ) : (
              <Button onClick={handleSaveNames} className="bg-[#00D084] hover:bg-[#00B370] text-slate-950 font-semibold transition-colors text-xs h-9 px-6 rounded-lg">
                Save
              </Button>
            )}
          </div>
        </div>

        {/* Email Section */}
        <div className="relative z-10 p-6 border-b border-slate-200 dark:border-slate-800">
          <div className="space-y-2">
            <Label htmlFor="email" className={`text-[0.8rem] font-semibold ${DESIGN_TOKENS.secondaryText}`}>Email</Label>
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <Input id="email" defaultValue={user?.email || ""} readOnly disabled className={`max-w-md h-9 font-medium opacity-70 cursor-not-allowed ${DESIGN_TOKENS.input}`} />
            </div>
            <p className="text-[0.7rem] text-t3 font-medium pt-1">Used to log in to your account</p>
          </div>
        </div>

        {/* Password Section */}
        <div className="relative z-10 p-6 flex flex-col items-end">
          {!showChangePassword && (
            <Button onClick={() => setShowChangePassword(true)} className="bg-[#00D084] hover:bg-[#00B370] text-slate-950 font-semibold transition-colors text-xs h-9 px-6 rounded-lg">
              Change Password
            </Button>
          )}
          {showChangePassword && (
            <div className="w-full">
              <ChangePasswordForm onCancel={() => setShowChangePassword(false)} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Profile;

