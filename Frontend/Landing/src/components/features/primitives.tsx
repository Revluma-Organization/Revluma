import type { CSSProperties, ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import icon from "@/assets/revluma-icon.png";

/**
 * Building blocks for the feature visuals.
 *
 * They are drawn as screenshots of the real Revluma dashboard, not as
 * illustrations: the palette, type scale and severity ramp come from
 * design-system/revluma/MASTER.md (Command Center tokens), and the layout
 * follows the skill-verified "Minimalism & Swiss" direction for enterprise
 * SaaS: one accent, hairline structure, sentence-case labels, no decorative
 * glow. Status is never carried by colour alone; every marker has a word.
 */

export const vars = (v: Record<string, string | number>) => v as CSSProperties;

/** Row index for staggered reveals inside a visual (read as --r in CSS). */
export const row = (r: number) => vars({ "--r": r });

/** Sample workspace shown in the app chrome of every visual. */
export const SAMPLE_STORE = "Linen & Loom";

/** The app window every visual sits in: workspace breadcrumb plus a "Sample data" tag. */
export function ProductWindow({ app, status, children }: { app: string; status?: ReactNode; children: ReactNode }) {
  return (
    <div className="fx-window">
      <div className="fx-window__bar">
        <span className="fx-window__crumbs">
          <img src={icon} alt="" />
          <span className="fx-window__ws">{SAMPLE_STORE}</span>
          <ChevronRight className="fx-window__sep" size={12} strokeWidth={2} aria-hidden="true" />
          <b>{app}</b>
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

const SEVERITY_WORD: Record<Severity, string> = { high: "High", medium: "Medium", low: "Low" };

/** Severity as the dashboard shows it: a small square marker plus a word (never colour alone). */
export function SeverityMark({ level, suffix }: { level: Severity; suffix?: string }) {
  return (
    <span className={`fx-sev fx-sev--${level}`}>
      <i aria-hidden="true" />
      {SEVERITY_WORD[level]}
      {suffix ? ` ${suffix}` : ""}
    </span>
  );
}

/** A three-step level meter (impact, urgency, evidence). Levels, not figures. */
export function Meter({ label, level }: { label: string; level: 1 | 2 | 3 }) {
  const word = ["Low", "Medium", "High"][level - 1];
  return (
    <span className={`fx-meter fx-meter--${level}`} title={`${label}: ${word}`}>
      <span className="fx-meter__label" aria-hidden="true">
        {label}
      </span>
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

/** Numbered evidence reference, like Rev's citation markers. With a label it renders as a source chip. */
export function Cite({ n, label }: { n: number; label?: string }) {
  return (
    <span className={`fx-cite${label ? " fx-cite--chip" : ""}`}>
      <b>{n}</b>
      {label && <span>{label}</span>}
    </span>
  );
}

export function Kicker({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`fx-kicker ${className}`}>{children}</p>;
}
