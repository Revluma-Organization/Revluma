import { useEffect, useRef, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Check, CloudOff, Loader2, RotateCw } from "lucide-react";
import type { SaveState } from "../useApplication";
import { ErrorSummary } from "./fields";

/**
 * One step of the application: heading (focused when the step opens so
 * screen readers announce it), the questions, then Back / save status /
 * Continue. Continue stays disabled while a save is in flight, and the save
 * status is announced politely.
 */
type Props = {
  step: number;
  total: number;
  title: string;
  description: ReactNode;
  errors: Record<string, string | undefined>;
  labels: Record<string, string>;
  showSummary: boolean;
  /** Changes on every failed Continue: the error summary takes focus then. */
  attemptKey: number;
  save: SaveState;
  onBack?: () => void;
  onContinue: () => void;
  continueLabel: string;
  children: ReactNode;
};

export function SaveStatus({ save }: { save: SaveState }) {
  let content: ReactNode = null;
  if (save.kind === "saving") {
    content = (
      <>
        <Loader2 className="wl-spin" size={15} strokeWidth={2.2} aria-hidden="true" />
        Saving…
      </>
    );
  } else if (save.kind === "saved") {
    content = (
      <>
        <Check size={15} strokeWidth={2.6} aria-hidden="true" />
        Saved
      </>
    );
  } else if (save.kind === "error") {
    content = (
      <>
        <CloudOff size={15} strokeWidth={2.2} aria-hidden="true" />
        {save.message}
      </>
    );
  }
  return (
    <p className={`wl-save wl-save--${save.kind}`} role="status" aria-live="polite">
      {content}
    </p>
  );
}

export function StepFrame({
  step,
  total,
  title,
  description,
  errors,
  labels,
  showSummary,
  attemptKey,
  save,
  onBack,
  onContinue,
  continueLabel,
  children,
}: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  const summary = useRef<HTMLDivElement>(null);
  const saving = save.kind === "saving";
  const failed = save.kind === "error";
  const hasErrors = Object.values(errors).some(Boolean);

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (attemptKey) summary.current?.focus();
    // Only a new failed attempt moves focus, never typing or blurring.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptKey]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!saving) onContinue();
  };

  return (
    <form className="wl-step" noValidate onSubmit={submit} aria-labelledby={`wl-step-${step}-title`} aria-busy={saving || undefined}>
      <header className="wl-step__head">
        <p className="wl-step__count wl-step__count--step">
          Step {step} of {total}
        </p>
        <h2 id={`wl-step-${step}-title`} ref={heading} tabIndex={-1} className="wl-step__title">
          {title}
        </h2>
        <p className="wl-step__desc">{description}</p>
      </header>
      {showSummary && hasErrors ? <ErrorSummary errors={errors} labels={labels} summaryRef={summary} /> : null}
      <div className="wl-step__body">{children}</div>
      <footer className="wl-step__foot">
        {onBack ? (
          <button type="button" className="wl-btn wl-btn--ghost" onClick={onBack} disabled={saving}>
            <ArrowLeft size={16} strokeWidth={2.2} aria-hidden="true" />
            Back
          </button>
        ) : (
          <span />
        )}
        <div className="wl-step__go">
          <SaveStatus save={save} />
          <button type="submit" className="wl-btn wl-btn--primary" disabled={saving} aria-disabled={saving || undefined}>
            {saving ? (
              <>
                <Loader2 className="wl-spin" size={16} strokeWidth={2.4} aria-hidden="true" />
                Saving
              </>
            ) : failed ? (
              <>
                <RotateCw size={16} strokeWidth={2.4} aria-hidden="true" />
                Retry
              </>
            ) : (
              <>
                {continueLabel}
                <ArrowRight size={16} strokeWidth={2.4} aria-hidden="true" />
              </>
            )}
          </button>
        </div>
      </footer>
    </form>
  );
}
