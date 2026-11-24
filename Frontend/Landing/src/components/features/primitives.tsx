import type { CSSProperties, ReactNode } from "react";
import icon from "@/assets/revluma-icon.png";

/**
 * Building blocks for the feature visuals. They follow the dashboard's own
 * Command Center contract (Frontend/Dashboard/src/components/command-center/
 * tokens.ts and CommandCenterSections.tsx): the same text and border colours,
 * severity / confidence pills, uppercase section labels and brand indigo for
 * intelligence, so the landing page shows the product as it looks.
 */

export const vars = (v: Record<string, string | number>) => v as CSSProperties;

/** Row index for staggered reveals inside a visual (read as --r in CSS). */
export const row = (r: number) => vars({ "--r": r });

/** The app window every visual sits in: Revluma chrome plus a "Sample data" tag. */
export function ProductWindow({ app, status, children }: { app: string; status?: ReactNode; children: ReactNode }) {
  return (
    <div className="fx-window">
      <div className="fx-window__bar">
        <span className="fx-window__dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="fx-window__app">
          <img src={icon} alt="" />
          {app}
        </span>
        <span className="fx-window__aside">
          {status}
          <span className="fx-window__sample">Sample data</span>
        </span>
      </div>
      <div className="fx-window__body">{children}</div>
    </div>
  );
}

export type Severity = "high" | "medium" | "low";

export function SeverityPill({ level, suffix = "priority" }: { level: Severity; suffix?: string }) {
  return (
    <span className={`fx-pill fx-pill--${level}`}>
      {level} {suffix}
    </span>
  );
}

export function ConfidencePill({ level }: { level: "high" | "moderate" | "low" }) {
  return (
    <span className="fx-pill fx-pill--confidence">
      <i aria-hidden="true" />
      {level} confidence
    </span>
  );
}

/** A three-step level meter (impact, urgency, evidence). Levels, not figures. */
export function Meter({ label, level, compact = false }: { label: string; level: 1 | 2 | 3; compact?: boolean }) {
  const word = ["Low", "Medium", "High"][level - 1];
  return (
    <span className={`fx-meter fx-meter--${level}${compact ? " fx-meter--compact" : ""}`} title={`${label}: ${word}`}>
      {!compact && <span className="fx-meter__label">{label}</span>}
      <span className="fx-meter__bars" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="fx-sr">
        {label}: {word}
      </span>
    </span>
  );
}

/** Numbered evidence reference, like Rev's citation chips. */
export function Cite({ n, label }: { n: number; label?: string }) {
  return (
    <span className="fx-cite">
      <b>{n}</b>
      {label && <span>{label}</span>}
    </span>
  );
}

export function Kicker({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`fx-kicker ${className}`}>{children}</p>;
}
