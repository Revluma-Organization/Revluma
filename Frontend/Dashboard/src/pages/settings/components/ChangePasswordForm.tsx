import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { AlertCircle, Check, Circle, Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuthStore } from "@/store/authStore";
import { passwordRequirements } from "@/lib/profileSettings";
import { settingsUi as ui } from "@/lib/settingsStyles";
import { cn } from "@/lib/utils";

interface PasswordFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  visible: boolean;
  invalid?: boolean;
  describedBy?: string;
  inputRef?: React.Ref<HTMLInputElement>;
}

function PasswordField({ id, label, value, onChange, autoComplete, visible, invalid, describedBy, inputRef }: PasswordFieldProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className={ui.fieldLabel}>{label}</label>
      <input
        ref={inputRef}
        id={id}
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        value={value}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
        className={ui.input}
      />
    </div>
  );
}

/**
 * Inline change-password form (POST /auth/change-password through the auth
 * store). Requirements are shown up front and tick off as the user types,
 * matching the API's validator so a submit never fails on rules we hid.
 */
export function ChangePasswordForm({ onCancel }: { onCancel: () => void }) {
  const { changePassword, loading, error, clearError } = useAuthStore();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [localError, setLocalError] = useState("");
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const baseId = useId();
  const ids = {
    current: `${baseId}-current`,
    next: `${baseId}-new`,
    confirm: `${baseId}-confirm`,
    rules: `${baseId}-rules`,
    error: `${baseId}-error`,
  };

  useEffect(() => {
    clearError();
    firstFieldRef.current?.focus();
    return () => clearError();
  }, [clearError]);

  const requirements = passwordRequirements(newPassword);
  const allMet = requirements.every((item) => item.met);
  const mismatch = confirmPassword.length > 0 && confirmPassword !== newPassword;
  const message = localError || error || "";

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLocalError("");
    clearError();
    if (!currentPassword || !newPassword || !confirmPassword) {
      setLocalError("Fill in all three fields.");
      return;
    }
    if (!allMet) {
      setLocalError("Your new password doesn't meet every requirement yet.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setLocalError("The new passwords don't match.");
      return;
    }
    if (newPassword === currentPassword) {
      setLocalError("Choose a password you haven't used for this account.");
      return;
    }
    try {
      await changePassword(currentPassword, newPassword, confirmPassword);
      toast.success("Password updated", { description: "Other devices have been signed out." });
      onCancel();
    } catch {
      // The store exposes the API's message through `error`.
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4 rounded-xl border border-line bg-panel p-4">
      <PasswordField
        id={ids.current}
        label="Current password"
        value={currentPassword}
        onChange={setCurrentPassword}
        autoComplete="current-password"
        visible={showPasswords}
        inputRef={firstFieldRef}
      />
      <div className="grid gap-4 md:grid-cols-2">
        <PasswordField
          id={ids.next}
          label="New password"
          value={newPassword}
          onChange={setNewPassword}
          autoComplete="new-password"
          visible={showPasswords}
          describedBy={ids.rules}
        />
        <PasswordField
          id={ids.confirm}
          label="Confirm new password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          autoComplete="new-password"
          visible={showPasswords}
          invalid={mismatch}
          describedBy={mismatch ? `${ids.confirm}-mismatch` : undefined}
        />
      </div>
      {mismatch ? (
        <p id={`${ids.confirm}-mismatch`} className={ui.fieldError}>
          <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" /> Passwords don't match.
        </p>
      ) : null}

      <ul id={ids.rules} aria-label="Password requirements" className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
        {requirements.map((item) => (
          <li key={item.id} className={cn("flex items-center gap-2 text-[12.5px]", item.met ? "text-success" : "text-ink-muted")}>
            {item.met ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Circle className="h-3 w-3" aria-hidden="true" />}
            <span>{item.label}</span>
            <span className="sr-only">{item.met ? "(met)" : "(not met)"}</span>
          </li>
        ))}
      </ul>

      {message ? (
        <p id={ids.error} role="alert" className={ui.fieldError}>
          <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" /> {message}
        </p>
      ) : null}

      <div className="flex flex-col-reverse gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={() => setShowPasswords((value) => !value)}
          className={cn(ui.ghostButton, "h-8 self-start px-2 text-[12.5px] sm:self-auto")}
          aria-pressed={showPasswords}
        >
          {showPasswords ? <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Eye className="h-3.5 w-3.5" aria-hidden="true" />}
          {showPasswords ? "Hide passwords" : "Show passwords"}
        </button>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <button type="button" onClick={onCancel} className={ui.secondaryButton} disabled={loading}>Cancel</button>
          <button type="submit" className={ui.primaryButton} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {loading ? "Updating" : "Update password"}
          </button>
        </div>
      </div>
    </form>
  );
}
