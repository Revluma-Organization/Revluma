/**
 * Form controls for the application. Native inputs throughout (text, radio,
 * checkbox) so keyboard, screen reader and autofill behaviour come for free;
 * the cards and pills are styled labels around visually hidden inputs.
 */
import { forwardRef, useId, type CSSProperties, type InputHTMLAttributes, type ReactNode, type RefObject } from "react";
import { AlertCircle, Check, type LucideIcon } from "lucide-react";
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
  /**
   * pills: compact tiles. scale: ordered ranges drawn with rising bars, so
   * "how many" reads at a glance. cards: icon tiles. price: amount tiles.
   */
  variant?: "pills" | "scale" | "cards" | "price";
  /** Extra text under an option label, e.g. "per month" on prices. */
  suffix?: string;
  icons?: Record<string, LucideIcon>;
};

/** "3 - 6 months" becomes a big "3 - 6" over a small "months". The full label stays the accessible name. */
function splitUnit(label: string): [string, string | null] {
  const match = /^(.*\S)\s+(months?|years?)$/.exec(label);
  return match ? [match[1], match[2]] : [label, null];
}

function Bars({ level, of }: { level: number; of: number }) {
  return (
    <span className="wl-bars" aria-hidden="true">
      {Array.from({ length: of }, (_, i) => (
        <i key={i} className={i < level ? "is-on" : undefined} style={{ height: `${30 + (70 * (i + 1)) / of}%` }} />
      ))}
    </span>
  );
}

function OptionIcon({ icon: Icon }: { icon?: LucideIcon }) {
  if (!Icon) return null;
  return (
    <span className="wl-choice__icon" aria-hidden="true">
      <Icon size={18} strokeWidth={2} />
    </span>
  );
}

/** Single choice: a radio group drawn as tiles. Native radios underneath, so arrow keys work. */
export function ChoiceGroup({ name, legend, description, options, value, error, onValue, variant = "pills", suffix, icons }: ChoiceProps) {
  return (
    <Group name={name} legend={legend} description={description} error={error}>
      <div className={`wl-choices wl-choices--${variant}`} role="presentation">
        {options.map((option, index) => {
          const selected = value === option.value;
          const [main, unit] = variant === "scale" ? splitUnit(option.label) : [option.label, null];
          return (
            <label key={option.value} className={`wl-choice${selected ? " is-selected" : ""}`} style={{ "--i": index } as CSSProperties}>
              <input type="radio" className="wl-choice__input" name={name} value={option.value} checked={selected} onChange={() => onValue(option.value)} />
              {variant === "scale" ? <Bars level={index + 1} of={options.length} /> : null}
              {variant === "cards" ? <OptionIcon icon={icons?.[option.value]} /> : null}
              <span className="wl-choice__text">
                {unit ? (
                  <span className="wl-choice__label">
                    <span className="wl-choice__main">{main}</span> <span className="wl-choice__unit">{unit}</span>
                  </span>
                ) : (
                  <span className="wl-choice__label">{option.label}</span>
                )}
                {suffix ? <span className="wl-choice__suffix">{option.value === "free" ? "No charge" : suffix}</span> : null}
              </span>
              {variant === "cards" ? <span className="wl-choice__mark wl-choice__mark--radio" aria-hidden="true" /> : null}
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
  icons?: Record<string, LucideIcon>;
};

/** Multiple choice as icon tiles. With `max`, the rest disable once the limit is reached. */
export function MultiChoice({ name, legend, description, options, value, error, max, onValue, extra, icons }: MultiProps) {
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
            <span className="wl-counter__dots" aria-hidden="true">
              {Array.from({ length: max }, (_, i) => (
                <i key={i} className={i < value.length ? "is-on" : undefined} />
              ))}
            </span>
            {value.length} of {max} selected
          </span>
        ) : null
      }
    >
      <div className="wl-choices wl-choices--cards">
        {options.map((option, index) => {
          const checked = value.includes(option.value);
          const disabled = !checked && full;
          return (
            <div key={option.value} className={`wl-choice-wrap${checked && extra?.[option.value] ? " has-extra" : ""}`} style={{ "--i": index } as CSSProperties}>
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
                <OptionIcon icon={icons?.[option.value]} />
                <span className="wl-choice__text">
                  <span className="wl-choice__label">{option.label}</span>
                </span>
                <span className="wl-choice__mark" aria-hidden="true">
                  <Check size={13} strokeWidth={3} />
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
