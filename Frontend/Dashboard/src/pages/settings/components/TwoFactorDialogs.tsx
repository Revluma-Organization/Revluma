import { useCallback, useEffect, useId, useRef, useState, type FC, type FormEvent, type MouseEvent } from "react";
import { AlertCircle, Check, Copy, Loader2, RefreshCw } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { api } from "@/lib/api";
import { apiErrorMessage } from "@/lib/profileSettings";
import { settingsUi as ui } from "@/lib/settingsStyles";
import { cn } from "@/lib/utils";

interface SetupPayload {
  qrCode?: string;
  secret?: string;
}

interface TwoFactorSetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEnabled: () => void;
}

type SetupState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; qrCode: string; secret: string };

/** Groups a base32 secret in fours so it can be read aloud or typed. */
function groupSecret(secret: string): string {
  return secret.replace(/(.{4})(?=.)/g, "$1 ");
}

/**
 * Authenticator-app enrolment: fetches a fresh secret each time it opens
 * (POST /auth/2fa/setup), then confirms with a 6-digit code
 * (POST /auth/2fa/verify). Nothing is enabled until the code verifies.
 */
export const TwoFactorSetupDialog: FC<TwoFactorSetupDialogProps> = ({ open, onOpenChange, onEnabled }) => {
  const [setup, setSetup] = useState<SetupState>({ status: "loading" });
  const [code, setCode] = useState("");
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [copied, setCopied] = useState(false);
  const requestRef = useRef(0);
  const codeRef = useRef<HTMLInputElement>(null);
  const codeId = useId();
  const errorId = useId();

  const loadSetup = useCallback(async () => {
    const request = ++requestRef.current;
    setSetup({ status: "loading" });
    try {
      const res = await api.post<SetupPayload>("/auth/2fa/setup");
      if (request !== requestRef.current) return;
      const qrCode = res.data?.qrCode ?? "";
      const secret = res.data?.secret ?? "";
      if (!qrCode || !secret) throw new Error("incomplete");
      setSetup({ status: "ready", qrCode, secret });
    } catch (error) {
      if (request !== requestRef.current) return;
      setSetup({ status: "error", message: apiErrorMessage(error, "We couldn't start two-factor setup. Try again.") });
    }
  }, []);

  useEffect(() => {
    if (!open) {
      requestRef.current += 1;
      return;
    }
    setCode("");
    setVerifyError(null);
    setCopied(false);
    void loadSetup();
  }, [open, loadSetup]);

  useEffect(() => {
    if (setup.status === "ready") codeRef.current?.focus();
  }, [setup.status]);

  const handleCopy = async () => {
    if (setup.status !== "ready") return;
    try {
      await navigator.clipboard.writeText(setup.secret);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const handleVerify = async (event: FormEvent) => {
    event.preventDefault();
    if (code.length !== 6 || verifying) return;
    setVerifying(true);
    setVerifyError(null);
    try {
      await api.post("/auth/2fa/verify", { code }, { skipAuthRedirect: true });
      onEnabled();
      onOpenChange(false);
    } catch (error) {
      setVerifyError(apiErrorMessage(error, "That code didn't work. Check your app and try again."));
      setCode("");
      codeRef.current?.focus();
    } finally {
      setVerifying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!verifying) onOpenChange(next); }}>
      <DialogContent className={cn(ui.dialog, "max-h-[calc(100dvh-2rem)] overflow-y-auto")}>
        <div className="border-b border-line px-6 pb-4 pt-5">
          <DialogTitle className="text-[16px] font-semibold tracking-[-0.01em] text-ink">Set up two-factor authentication</DialogTitle>
          <DialogDescription className="mt-1 text-[13px] leading-5 text-ink-muted">
            Use an authenticator app such as 1Password, Google Authenticator or Authy.
          </DialogDescription>
        </div>

        <div className="space-y-5 px-6 py-5">
          <div>
            <p className="text-[13px] font-semibold text-ink">1. Scan this QR code</p>
            <div className="mt-3 flex flex-col items-center gap-3 sm:flex-row sm:items-start">
              <div className="flex h-36 w-36 shrink-0 items-center justify-center rounded-xl border border-line bg-white p-2">
                {setup.status === "ready" ? (
                  <img src={setup.qrCode} alt="QR code for your authenticator app" className="h-full w-full object-contain" />
                ) : setup.status === "loading" ? (
                  <div className="h-full w-full animate-pulse rounded-lg bg-skeleton" aria-hidden="true" />
                ) : (
                  <AlertCircle className="h-6 w-6 text-ink-faint" aria-hidden="true" />
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <p className={ui.helper}>Can't scan it? Enter this setup key in your app instead.</p>
                {setup.status === "ready" ? (
                  <div className="flex items-start gap-2 rounded-lg border border-line bg-subtle p-2.5">
                    <code className="min-w-0 flex-1 select-all break-words font-mono text-[12.5px] leading-5 tracking-[0.04em] text-ink">
                      {groupSecret(setup.secret)}
                    </code>
                    <button type="button" onClick={handleCopy} className={cn(ui.ghostButton, "h-7 px-2 text-[12px]")} aria-label={copied ? "Setup key copied" : "Copy setup key"}>
                      {copied ? <Check className="h-3.5 w-3.5 text-success" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                ) : setup.status === "loading" ? (
                  <div className="h-11 animate-pulse rounded-lg bg-skeleton" aria-hidden="true" />
                ) : null}
              </div>
            </div>
            {setup.status === "loading" ? <p className="sr-only" role="status">Preparing your setup key</p> : null}
            {setup.status === "error" ? (
              <div role="alert" className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-danger-line bg-danger-soft px-3 py-2.5 text-[12.5px] font-medium text-danger">
                <span className="flex items-center gap-1.5"><AlertCircle className="h-4 w-4" aria-hidden="true" />{setup.message}</span>
                <button type="button" onClick={() => void loadSetup()} className={cn(ui.ghostButton, "h-7 px-2 text-[12px] text-danger hover:text-danger")}>
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Retry
                </button>
              </div>
            ) : null}
          </div>

          <form onSubmit={handleVerify} className="space-y-2" noValidate>
            <label htmlFor={codeId} className="text-[13px] font-semibold text-ink">2. Enter the 6-digit code</label>
            <input
              ref={codeRef}
              id={codeId}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              value={code}
              disabled={setup.status !== "ready" || verifying}
              aria-invalid={verifyError ? true : undefined}
              aria-describedby={verifyError ? errorId : undefined}
              onChange={(event) => { setCode(event.target.value.replace(/\D/g, "").slice(0, 6)); setVerifyError(null); }}
              className={cn(ui.input, "h-11 text-center font-mono text-[18px] tracking-[0.4em] placeholder:tracking-[0.4em]")}
            />
            {verifyError ? (
              <p id={errorId} role="alert" className={ui.fieldError}><AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />{verifyError}</p>
            ) : null}
            <div className="flex flex-col-reverse gap-2 pt-3 sm:flex-row sm:justify-end">
              <button type="button" className={ui.secondaryButton} onClick={() => onOpenChange(false)} disabled={verifying}>Cancel</button>
              <button type="submit" className={ui.primaryButton} disabled={code.length !== 6 || verifying || setup.status !== "ready"}>
                {verifying ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                {verifying ? "Verifying" : "Verify and enable"}
              </button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
};

interface TwoFactorDisableDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDisabled: () => void;
}

/** Confirmation before removing the second factor (POST /auth/2fa/disable). */
export const TwoFactorDisableDialog: FC<TwoFactorDisableDialogProps> = ({ open, onOpenChange, onDisabled }) => {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const handleDisable = async (event: MouseEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api.post("/auth/2fa/disable");
      onDisabled();
      onOpenChange(false);
    } catch (err) {
      setError(apiErrorMessage(err, "We couldn't turn off two-factor authentication. Try again."));
    } finally {
      setPending(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!pending) onOpenChange(next); }}>
      <AlertDialogContent className={cn(ui.dialog, "p-6")}>
        <AlertDialogTitle className="text-[16px] font-semibold tracking-[-0.01em] text-ink">Turn off two-factor authentication?</AlertDialogTitle>
        <AlertDialogDescription className="mt-2 text-[13px] leading-5 text-ink-muted">
          Signing in will only need your password. Your authenticator app will stop working for Revluma, and you'll need to scan a new code to turn it back on.
        </AlertDialogDescription>
        {error ? (
          <p role="alert" className={cn(ui.fieldError, "mt-3")}><AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />{error}</p>
        ) : null}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <AlertDialogCancel disabled={pending} className={cn(ui.secondaryButton, "mt-0 h-9")}>Keep it on</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDisable}
            disabled={pending}
            className={cn(ui.primaryButton, "h-9 bg-red-700 text-white hover:bg-red-700 hover:brightness-110")}
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Turn off
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
};
