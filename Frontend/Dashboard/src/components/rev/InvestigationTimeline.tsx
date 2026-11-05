import { useState } from "react";
import { Check, ChevronDown, CircleAlert, Circle, ShieldCheck } from "lucide-react";
import { SkeletonDot } from "@/components/rev/RevSkeleton";
import type { InvestigationStep, RevInvestigationMeta } from "@/lib/revStream";
import { formatPeriod, recordList, textValue } from "@/lib/revPresentation";

interface Props {
  steps: InvestigationStep[];
  investigation?: RevInvestigationMeta | null;
  streaming?: boolean;
  dark?: boolean;
  /** Live one-line progress while a turn is running; no card, no history. */
  compact?: boolean;
}

function StepIcon({ status, isDark }: { status: InvestigationStep["status"]; isDark: boolean }) {
  if (status === "completed") return <Check size={13} strokeWidth={3} color="#067647" />;
  // Running = still loading: skeleton shimmer, never a spinner.
  if (status === "running") return <SkeletonDot size={13} isDark={isDark} />;
  if (status === "failed") return <CircleAlert size={13} color="#B42318" />;
  return <Circle size={10} color="#98A2B3" />;
}

export function InvestigationTimeline({ steps: originalSteps, investigation, streaming = false, dark = false, compact = false }: Props) {
  const [open, setOpen] = useState(false);
  const steps = recordList<InvestigationStep>(originalSteps);
  if (!steps.length) return null;
  if (compact) {
    // Progress copy names the check actually running right now (P4: honest
    // progress). Labels come from backend step metadata, never from a timer.
    const current = steps.find((step) => step.status === "running");
    const done = steps.filter((step) => step.status === "completed").length;
    const muted = dark ? "#98A2B3" : "#667085";
    return (
      <p role="status" aria-live="polite" style={{ margin: 0, fontSize: "0.76rem", color: muted }}>
        {current ? `${textValue(current.label) || "Checking your store"}\u2026` : "Preparing checks\u2026"}
        <span style={{ marginLeft: 6 }}>{done}/{steps.length}</span>
      </p>
    );
  }
  const complete = steps.filter((step) => step.status === "completed").length;
  const failed = steps.filter((step) => step.status === "failed").length;
  const completeInvestigation = complete === steps.length && (!investigation?.status || investigation.status === "complete");
  const label = streaming ? "Investigating your store evidence"
    : failed ? "Investigation has failed checks"
    : completeInvestigation ? "Investigation complete" : "Investigation incomplete";

  const border = dark ? "rgba(255,255,255,0.1)" : "#EAECF0";
  const muted = dark ? "#98A2B3" : "#667085";
  const strong = dark ? "#F2F4F7" : "#101828";

  return (
    <div style={{ border: `1px solid ${border}`, borderRadius: 12, overflow: "hidden", overflowWrap: "anywhere" }}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex min-h-11 w-full flex-wrap items-center gap-2 px-3.5 py-2.5 text-left"
        style={{ background: dark ? "rgba(255,255,255,0.03)" : "#FAFAFB", color: strong }}
      >
        {streaming ? (
          <SkeletonDot size={14} isDark={dark} />
        ) : !completeInvestigation ? (
          <CircleAlert size={14} color="#B42318" />
        ) : (
          <ShieldCheck size={14} color="#067647" />
        )}
        <span style={{ fontSize: "0.78rem", fontWeight: 650 }}>
          {label}
        </span>
        <span style={{ fontSize: "0.72rem", color: muted, marginLeft: 2 }}>
          {complete}/{steps.length} checks
          {failed ? ` · ${failed} unavailable` : ""}
        </span>
        <ChevronDown
          size={14}
          color={muted}
          style={{ marginLeft: "auto", transform: open ? "rotate(180deg)" : "none", transition: "transform 150ms" }}
        />
      </button>
      {open && (
        <ol className="flex flex-col gap-0 px-3.5 pb-2 pt-1" style={{ listStyle: "none", margin: 0 }}>
          {steps.map((step) => (
            <li key={step.id || step.tool} className="flex items-start gap-2.5 py-1.5">
              <span style={{ marginTop: 2 }}><StepIcon status={step.status} isDark={dark} /></span>
              <div style={{ minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: "0.78rem", color: strong, lineHeight: 1.4 }}>
                {textValue(step.label) || "Unnamed check"} <span style={{ color: muted }}>({textValue(step.status) || "unknown"})</span>
                </p>
                {step.detail && (
                  <p style={{ margin: "1px 0 0", fontSize: "0.7rem", color: muted, lineHeight: 1.45 }}>
                    {textValue(step.detail)}
                  </p>
                )}
              </div>
            </li>
          ))}
          {investigation?.period?.start && (
            <li style={{ fontSize: "0.7rem", color: muted, paddingTop: 6, borderTop: `1px solid ${border}`, marginTop: 6 }}>
              Reporting period: {formatPeriod(investigation.period)}
            </li>
          )}
        </ol>
      )}
    </div>
  );
}

export default InvestigationTimeline;
