import { useState } from "react";
import { useAuthStore } from "@/store/authStore";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { DESIGN_TOKENS } from "@/lib/DesignConstants";
import { Loader2 } from "lucide-react";
import { motion } from "framer-motion";

const MotionButton = motion.create(Button);

export function ChangePasswordForm({ onCancel }: { onCancel: () => void }) {
  const { changePassword, loading, error, clearError } = useAuthStore();
  
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [localError, setLocalError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError("");
    setSuccess(false);
    clearError();

    if (!currentPassword || !newPassword || !confirmPassword) {
      setLocalError("All fields are required.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setLocalError("New passwords do not match.");
      return;
    }

    if (newPassword.length < 8) {
      setLocalError("New password must be at least 8 characters.");
      return;
    }

    try {
      await changePassword(currentPassword, newPassword, confirmPassword);
      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => {
        onCancel();
      }, 2000);
    } catch (err) {
      // Error is already handled/set in the store
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mt-4 p-4 border border-border rounded-lg bg-bg-2 shadow-sm space-y-4">
      <div className="space-y-2">
        <Label htmlFor="currentPassword" className={`text-[0.8rem] font-semibold ${DESIGN_TOKENS.secondaryText}`}>Current Password</Label>
        <Input 
          id="currentPassword" 
          type="password" 
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          className={`h-9 transition-all ${DESIGN_TOKENS.input}`} 
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="newPassword" className={`text-[0.8rem] font-semibold ${DESIGN_TOKENS.secondaryText}`}>New Password</Label>
          <Input 
            id="newPassword" 
            type="password" 
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className={`h-9 transition-all ${DESIGN_TOKENS.input}`} 
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirmPassword" className={`text-[0.8rem] font-semibold ${DESIGN_TOKENS.secondaryText}`}>Confirm New Password</Label>
          <Input 
            id="confirmPassword" 
            type="password" 
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className={`h-9 transition-all ${DESIGN_TOKENS.input}`} 
          />
        </div>
      </div>

      {(localError || error) && (
        <p className="text-red-500 text-[0.75rem] font-medium">{localError || error}</p>
      )}

      {success && (
        <p className="text-[#00D084] text-[0.75rem] font-medium">Password changed successfully!</p>
      )}

      <div className="flex flex-col items-end gap-2 pt-2">
        <MotionButton whileTap={{ scale: 0.98 }} type="submit" disabled={loading} className="!bg-[#007FFF] hover:!bg-[#00B370] !text-white font-semibold h-8 px-6 text-xs transition-colors rounded-md border-none">
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Update Password"}
        </MotionButton>
        <MotionButton whileTap={{ scale: 0.98 }} type="button" onClick={onCancel} variant="ghost" className="text-gray-400 hover:text-white h-8 px-4 text-xs transition-colors rounded-md">
          Cancel
        </MotionButton>
      </div>
    </form>
  );
}
