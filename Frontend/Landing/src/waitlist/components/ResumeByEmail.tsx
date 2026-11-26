import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Loader2, MailCheck } from "lucide-react";
import { ApiError, waitlistApi, type Application } from "../api";
import { normaliseEmail } from "../schema";

const RESEND_SECONDS = 60;

/**
 * Continue on another device: we email a six digit code to the address on the
 * application, and only that code (never the email alone) opens it here. The
 * request answers the same way whether or not the email has an application.
 */
export function ResumeByEmail({ initialEmail, onResumed, onCancel }: { initialEmail: string; onResumed: (app: Application) => void; onCancel: () => void }) {
  const [stage, setStage] = useState<"email" | "code">("email");
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (stage === "code") codeInput.current?.focus();
  }, [stage]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy) return;
    const normalised = normaliseEmail(email);
    if (!normalised) {
      setError("Enter the work email you applied with.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await waitlistApi.requestCode(normalised);
      setEmail(normalised);
      setStage("code");
      setCooldown(RESEND_SECONDS);
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 429
          ? "Too many requests. Please wait a few minutes and try again."
          : "We couldn't send a code just now. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const verify = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6 digit code from the email.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onResumed(await waitlistApi.verifyCode(email, code));
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === "CODE_INVALID"
          ? "That code is not valid or has expired. Check the latest email or request a new code."
          : e instanceof ApiError && e.status === 429
            ? "Too many attempts. Please wait a few minutes and try again."
            : "We couldn't check the code just now. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wl-step wl-resume">
      <header className="wl-step__head">
        <p className="wl-step__count">Continue your application</p>
        <h2 ref={heading} tabIndex={-1} className="wl-step__title">
          {stage === "email" ? "Pick up where you left off" : "Check your email"}
        </h2>
        <p className="wl-step__desc">
          {stage === "email" ? (
            "Enter the work email you applied with. If it has an application, we'll send a code to continue it in this browser."
          ) : (
            <>
              If <strong>{email}</strong> has an application, a 6 digit code is on its way. It expires in 15 minutes.
            </>
          )}
        </p>
      </header>

      {stage === "email" ? (
        <form className="wl-step__body" noValidate onSubmit={send}>
          <div className={`wl-field${error ? " is-invalid" : ""}`}>
            <label className="wl-label" htmlFor="wl-resume-email">
              Work email
            </label>
            <input
              id="wl-resume-email"
              className="wl-input"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby="wl-resume-error"
            />
            <p id="wl-resume-error" className="wl-error" aria-live="polite">
              {error}
            </p>
          </div>
          <div className="wl-step__foot">
            <button type="button" className="wl-btn wl-btn--ghost" onClick={onCancel} disabled={busy}>
              <ArrowLeft size={16} strokeWidth={2.2} aria-hidden="true" />
              Back
            </button>
            <button type="submit" className="wl-btn wl-btn--primary" disabled={busy}>
              {busy ? (
                <Loader2 className="wl-spin" size={16} strokeWidth={2.4} aria-hidden="true" />
              ) : (
                <MailCheck size={16} strokeWidth={2.2} aria-hidden="true" />
              )}
              {busy ? "Sending" : "Email me a code"}
            </button>
          </div>
        </form>
      ) : (
        <form className="wl-step__body" noValidate onSubmit={verify}>
          <div className={`wl-field${error ? " is-invalid" : ""}`}>
            <label className="wl-label" htmlFor="wl-resume-code">
              6 digit code
            </label>
            <input
              ref={codeInput}
              id="wl-resume-code"
              className="wl-input wl-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              aria-invalid={error ? true : undefined}
              aria-describedby="wl-code-error"
            />
            <p id="wl-code-error" className="wl-error" aria-live="polite">
              {error}
            </p>
          </div>
          <p className="wl-hint">
            Didn't get it? Check spam, or{" "}
            <button type="button" className="wl-link" onClick={() => void send()} disabled={busy || cooldown > 0}>
              {cooldown > 0 ? `send another in ${cooldown}s` : "send another code"}
            </button>
            .
          </p>
          <div className="wl-step__foot">
            <button
              type="button"
              className="wl-btn wl-btn--ghost"
              onClick={() => {
                setStage("email");
                setCode("");
                setError(null);
              }}
              disabled={busy}
            >
              <ArrowLeft size={16} strokeWidth={2.2} aria-hidden="true" />
              Change email
            </button>
            <button type="submit" className="wl-btn wl-btn--primary" disabled={busy}>
              {busy ? <Loader2 className="wl-spin" size={16} strokeWidth={2.4} aria-hidden="true" /> : null}
              {busy ? "Checking" : "Continue application"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
