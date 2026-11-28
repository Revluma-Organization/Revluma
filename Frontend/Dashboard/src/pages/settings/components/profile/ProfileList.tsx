import type { FC, ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ProfileSectionProps {
  id: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}

/**
 * A titled group of read-first rows. The heading sits above the card (as on
 * Google Account and Atlassian profile pages) so the card itself is only a
 * list of facts, each with at most one trailing action.
 */
export const ProfileSection: FC<ProfileSectionProps> = ({ id, title, description, children }) => (
  <section aria-labelledby={`${id}-title`} className="min-w-0 space-y-3">
    <div className="px-1">
      <h2 id={`${id}-title`} className="text-[15px] font-semibold leading-6 tracking-[-0.01em] text-ink">{title}</h2>
      {description ? <p className="text-[13px] leading-5 text-ink-muted">{description}</p> : null}
    </div>
    <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-panel shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      {children}
    </div>
  </section>
);

interface ProfileRowProps {
  label: string;
  /** Read state value. Hidden while `editor` is shown. */
  children?: ReactNode;
  /** Single trailing action: Edit, Change, a link with a chevron, a copy button. */
  action?: ReactNode;
  /** Inline editor that replaces the value (click-to-edit). */
  editor?: ReactNode;
  testId?: string;
}

/**
 * Label | value | action on desktop; label + action over the value on phones.
 * When `editor` is present the row expands in place instead of opening a
 * separate page, keeping the user's position on the page.
 */
export const ProfileRow: FC<ProfileRowProps> = ({ label, children, action, editor, testId }) => (
  <div
    data-testid={testId}
    className={cn(
      "grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-5 py-4 sm:grid-cols-[11rem_minmax(0,1fr)_auto] sm:px-6",
      editor ? "bg-subtle" : null,
    )}
  >
    <p className={cn("col-start-1 row-start-1 text-[13px] font-medium text-ink-muted", editor ? "sm:self-start sm:pt-0.5" : null)}>{label}</p>
    {editor ? (
      <div className="col-span-2 row-start-2 min-w-0 pt-1 sm:col-span-2 sm:col-start-2 sm:row-start-1 sm:pt-0">{editor}</div>
    ) : (
      <>
        <div className="col-span-2 row-start-2 min-w-0 text-[14px] leading-6 text-ink sm:col-span-1 sm:col-start-2 sm:row-start-1">
          {children}
        </div>
        {action ? <div className="col-start-2 row-start-1 justify-self-end sm:col-start-3">{action}</div> : null}
      </>
    )}
  </div>
);
