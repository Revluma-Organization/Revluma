import type { FC, ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SettingsSectionProps {
  id: string;
  title: string;
  description?: ReactNode;
  /** Right side of the header: a status badge or a single quiet action. */
  aside?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * One settings card: header (title + description), hairline-separated rows,
 * optional footer bar for helper text and the section's save actions.
 * The landmark is labelled by its own heading so screen readers can jump
 * between sections.
 */
export const SettingsSection: FC<SettingsSectionProps> = ({ id, title, description, aside, footer, children, className }) => (
  <section
    aria-labelledby={`${id}-title`}
    className={cn("min-w-0 overflow-hidden rounded-xl border border-line bg-panel shadow-[0_1px_2px_rgba(16,24,40,0.04)]", className)}
  >
    <header className="flex flex-col gap-3 border-b border-line px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-6">
      <div className="min-w-0">
        <h2 id={`${id}-title`} className="text-[15px] font-semibold leading-6 tracking-[-0.01em] text-ink">
          {title}
        </h2>
        {description ? <p className="mt-0.5 max-w-[60ch] text-[13px] leading-5 text-ink-muted">{description}</p> : null}
      </div>
      {aside ? <div className="shrink-0">{aside}</div> : null}
    </header>
    <div className="divide-y divide-line">{children}</div>
    {footer ? (
      <footer className="flex flex-col gap-3 border-t border-line bg-subtle px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        {footer}
      </footer>
    ) : null}
  </section>
);

interface SettingsRowProps {
  label: ReactNode;
  description?: ReactNode;
  /** id of the primary control, so the row label is a real <label>. */
  htmlFor?: string;
  labelId?: string;
  children: ReactNode;
  className?: string;
}

/**
 * Label column (what + why) on the left, control column on the right from
 * `sm` up; stacked on phones. Mirrors the annotated settings layout used by
 * Linear, Stripe and GitHub account pages.
 */
export const SettingsRow: FC<SettingsRowProps> = ({ label, description, htmlFor, labelId, children, className }) => {
  const labelClass = "text-[13.5px] font-medium leading-5 text-ink";
  return (
    <div className={cn("grid min-w-0 gap-3 px-5 py-5 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] sm:gap-8 sm:px-6", className)}>
      <div className="min-w-0">
        {htmlFor ? (
          <label htmlFor={htmlFor} id={labelId} className={labelClass}>{label}</label>
        ) : (
          <p id={labelId} className={labelClass}>{label}</p>
        )}
        {description ? <p className="mt-1 text-[12.5px] leading-5 text-ink-muted">{description}</p> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
};
