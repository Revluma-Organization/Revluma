/**
 * Form controls for the application. Native inputs throughout (text, radio,
 * checkbox) so keyboard, screen reader and autofill behaviour come for free;
 * the cards and pills are styled labels around visually hidden inputs.
 */
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type RefObject } from "react";
import { AlertCircle, Check } from "lucide-react";
import type { Option } from "../schema";
import { scrollBehavior } from "../motion";

function FieldError({ id, message }: { id: string; message?: string }) {
  return (
    <p id={id} className="wl-error" aria-live="polite">
      {message ? (
        <>
          <AlertCircle size={14} strokeWidth={2.2} aria-hidden="true" />
          {message}
        </>
      ) : null}
    </p>
  );
}

type TextFieldProps = {
  name: string;
  label: string;
  optional?: boolean;
  hint?: ReactNode;
  value: string;
  error?: string;
  onValue: (value: string) => void;
  onBlur?: () => void;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "onBlur" | "name">;

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { name, label, optional, hint, value, error, onValue, onBlur, ...input },
  ref,
) {
  const id = `wl-${name}`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <div className={`wl-field${error ? " is-invalid" : ""}`}>
      <label className="wl-label" htmlFor={id}>
        {label}
        {optional ? <span className="wl-optional">Optional</span> : null}
      </label>
      <input
        ref={ref}
        id={id}
        name={name}
        className="wl-input"
        value={value}
        onChange={(event) => onValue(event.target.value)}
        onBlur={onBlur}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hint ? hintId : "", errorId].filter(Boolean).join(" ")}
        {...input}
      />
      {hint ? (
        <p id={hintId} className="wl-hint">
          {hint}
        </p>
      ) : null}
      <FieldError id={errorId} message={error} />
    </div>
  );
});

type GroupProps = {
  name: string;
  legend: string;
  description?: ReactNode;
  error?: string;
  children: ReactNode;
  aside?: ReactNode;
  className?: string;
};

function Group({ name, legend, description, error, children, aside, className }: GroupProps) {
  const descId = `wl-${name}-desc`;
  const errorId = `wl-${name}-error`;
  return (
    <fieldset
      className={`wl-group${error ? " is-invalid" : ""}${className ? ` ${className}` : ""}`}
      id={`wl-${name}`}
      tabIndex={-1}
      aria-describedby={[description ? descId : "", errorId].filter(Boolean).join(" ")}
      aria-invalid={error ? true : undefined}
    >
      <legend className="wl-legend">
        <span>{legend}</span>
        {aside}
      </legend>
      {description ? (
        <p id={descId} className="wl-hint wl-hint--group">
          {description}
        </p>
      ) : null}
      {children}
      <FieldError id={errorId} message={error} />
    </fieldset>
  );
}

type ChoiceProps = {
  name: string;
  legend: string;
  description?: ReactNode;
  options: readonly Option[];
  value: string | null;
  error?: string;
  onValue: (value: string) => void;
  variant?: "pills" | "cards" | "price";
  /** Extra text under an option label, e.g. "/ month" on prices. */
  suffix?: string;
};

/** Single choice: a radio group drawn as pills, cards or price tiles. */
export function ChoiceGroup({ name, legend, description, options, value, error, onValue, variant = "pills", suffix }: ChoiceProps) {
  return (
    <Group name={name} legend={legend} description={description} error={error}>
      <div className={`wl-choices wl-choices--${variant}`} role="presentation">
        {options.map((option) => {
          const selected = value === option.value;
          return (
            <label key={option.value} className={`wl-choice${selected ? " is-selected" : ""}`}>
              <input type="radio" className="wl-choice__input" name={name} value={option.value} checked={selected} onChange={() => onValue(option.value)} />
              {variant === "cards" ? <span className="wl-choice__mark wl-choice__mark--radio" aria-hidden="true" /> : null}
              <span className="wl-choice__text">
                <span className="wl-choice__label">{option.label}</span>
                {suffix ? <span className="wl-choice__suffix">{option.value === "free" ? "No charge" : suffix}</span> : null}
              </span>
            </label>
          );
        })}
      </div>
    </Group>
  );
}

type MultiProps = {
  name: string;
  legend: string;
  description?: ReactNode;
  options: readonly Option[];
  value: string[];
  error?: string;
  max?: number;
  onValue: (value: string[]) => void;
  /** Rendered under the option it belongs to when that option is checked. */
  extra?: Partial<Record<string, ReactNode>>;
};

/** Multiple choice as cards. With `max`, the rest disable once the limit is reached. */
export function MultiChoice({ name, legend, description, options, value, error, max, onValue, extra }: MultiProps) {
  const counterId = useId();
  const full = max !== undefined && value.length >= max;
  const toggle = (key: string) => {
    if (value.includes(key)) onValue(value.filter((v) => v !== key));
    else if (!full) onValue([...value, key]);
  };
  return (
    <Group
      name={name}
      legend={legend}
      description={description}
      error={error}
      aside={
        max !== undefined ? (
          <span id={counterId} className={`wl-counter${full ? " is-full" : ""}`} aria-live="polite">
            {value.length} of {max} selected
          </span>
        ) : null
      }
    >
      <div className="wl-choices wl-choices--cards">
        {options.map((option) => {
          const checked = value.includes(option.value);
          const disabled = !checked && full;
          return (
            <div key={option.value} className="wl-choice-wrap">
              <label className={`wl-choice${checked ? " is-selected" : ""}${disabled ? " is-disabled" : ""}`}>
                <input
                  type="checkbox"
                  className="wl-choice__input"
                  name={name}
                  value={option.value}
                  checked={checked}
                  disabled={disabled}
                  onChange={() => toggle(option.value)}
                  aria-describedby={max !== undefined ? counterId : undefined}
                />
                <span className="wl-choice__mark" aria-hidden="true">
                  <Check size={13} strokeWidth={3} />
                </span>
                <span className="wl-choice__text">
                  <span className="wl-choice__label">{option.label}</span>
                </span>
              </label>
              {checked && extra?.[option.value] ? <div className="wl-choice-extra">{extra[option.value]}</div> : null}
            </div>
          );
        })}
      </div>
      {full ? <p className="wl-hint wl-hint--limit">You've picked {max}. Unselect one to choose another.</p> : null}
    </Group>
  );
}

/** A short list of what's wrong, focused after a failed Continue. */
export function ErrorSummary({
  errors,
  labels,
  summaryRef,
}: {
  errors: Record<string, string | undefined>;
  labels: Record<string, string>;
  summaryRef: RefObject<HTMLDivElement>;
}) {
  const entries = Object.entries(errors).filter(([, message]) => message);
  if (!entries.length) return null;
  return (
    <div ref={summaryRef} className="wl-summary" role="alert" tabIndex={-1}>
      <p className="wl-summary__title">
        <AlertCircle size={16} strokeWidth={2.2} aria-hidden="true" />
        {entries.length === 1 ? "One answer needs attention" : `${entries.length} answers need attention`}
      </p>
      <ul>
        {entries.map(([field]) => (
          <li key={field}>
            <a
              href={`#wl-${field}`}
              onClick={(event) => {
                event.preventDefault();
                const target = document.getElementById(`wl-${field}`);
                const focusable = target?.matches("input,textarea") ? target : (target?.querySelector<HTMLElement>("input:not([disabled]),textarea") ?? target);
                focusable?.focus();
                target?.scrollIntoView({ block: "center", behavior: scrollBehavior() });
              }}
            >
              {labels[field] ?? field}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
