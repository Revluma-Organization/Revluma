import { useMemo } from "react";
import {
  ArrowUpRight, Check, Copy, Database, RefreshCw, TriangleAlert,
} from "lucide-react";
import RevMarkdown from "@/components/rev/RevMarkdown";
import { InvestigationTimeline } from "@/components/rev/InvestigationTimeline";
import type { RevAnswerPayload, RevFact, RevHypothesis, RevRecommendation, SpecialistsSummary, InvestigationStep } from "@/lib/revStream";
import { coveredBy, evidenceState, normaliseRevAnswer, recordList, stringList, textValue } from "@/lib/revPresentation";

interface Props {
  payload: RevAnswerPayload;
  streaming?: boolean;
  evidenceOpen?: boolean;
  onOpenEvidence?: (evidenceId?: string) => void;
  onFollowUp?: (text: string) => void;
  onRetry?: () => void;
  onCopy?: () => void;
  copied?: boolean;
  canRetry?: boolean;
  dark?: boolean;
}

type AnswerState = "verified" | "partial" | "unverified" | "unavailable" | "streaming";

const STATE_PILL: Record<AnswerState, { label: string; fg: string; bg: string }> = {
  verified: { label: "Evidence verified", fg: "#067647", bg: "#ECFDF3" },
  partial: { label: "Partial evidence", fg: "#B54708", bg: "#FFFAEB" },
  unverified: { label: "Evidence unverified", fg: "#B54708", bg: "#FFFAEB" },
  unavailable: { label: "Evidence unavailable", fg: "#475467", bg: "#F2F4F7" },
  streaming: { label: "Investigating", fg: "#1F06AC", bg: "rgba(31,6,172,0.08)" },
};

function deriveState(payload: RevAnswerPayload, streaming: boolean): AnswerState {
  if (streaming) return "streaming";
  const state = evidenceState(payload.evidence);
  const degraded = recordList<SpecialistsSummary>(payload.specialists).some(specialist => specialist.status !== "success")
    || ["partial", "insufficient_data", "failed"].includes(payload.investigation?.status)
    || recordList<InvestigationStep>(payload.investigation?.steps).some(step => step.status !== "completed");
  return state === "verified" && degraded ? "partial" : state;
}

export function RevAnswerView({
  payload: original, streaming = false, evidenceOpen = false, onOpenEvidence, onFollowUp,
  onRetry, onCopy, copied = false, canRetry = false, dark = false,
}: Props) {
  const payload = useMemo(() => normaliseRevAnswer(original) ?? original, [original]);
  const state = useMemo(() => deriveState(payload, streaming), [payload, streaming]);
  const pill = STATE_PILL[state];
  const strong = dark ? "#F2F4F7" : "#101828";
  const muted = dark ? "#98A2B3" : "#667085";
  const border = dark ? "rgba(255,255,255,0.09)" : "#EAECF0";

  const investigation = payload.investigation;
  const steps = recordList<InvestigationStep>(investigation?.steps);
  const evidenceCount = recordList(payload.evidence?.items).length + recordList(payload.evidence?.comparison_items).length;
  const warnings = [
    ...stringList(payload.warnings),
    ...stringList(payload.response?.warnings),
  ].filter((warning, index, list) => list.indexOf(warning) === index);
  const partialSpecialists = recordList<SpecialistsSummary>(payload.specialists).filter(
    (specialist) => specialist.status !== "success",
  );
  const followUps = stringList(investigation?.follow_ups);
  const confidence = payload.response?.confidence;
  const body = textValue(payload.text);
  let shown = body;
  const sections = (["situation", "insight", "implication", "recommendation"] as const).flatMap(key => {
    const text = textValue(payload.response?.[key]);
    if (!text || coveredBy(shown, text)) return [];
    shown += `\n${text}`;
    return [{ label: key[0].toUpperCase() + key.slice(1), text }];
  });
  const facts = [...recordList<RevFact>(payload.facts), ...recordList<RevFact>(payload.comparison_facts)]
    .map(fact => textValue(fact.text)).filter(text => text && !coveredBy(shown, text));
  const hypotheses = recordList<RevHypothesis>(payload.hypotheses).map(item => textValue(item.statement)).filter(text => text && !coveredBy(shown, text));
  const unknowns = stringList(payload.unknowns).filter(text => !coveredBy(shown, text));
  const recommendations = recordList<RevRecommendation>(payload.recommendations).filter(item => {
    const parts = [item.label, item.why, item.measure].map(textValue).filter(Boolean);
    return parts.length > 0 && !parts.every(text => coveredBy(shown, text));
  });
  const hasEvidence = Boolean(payload.evidence || facts.length || hypotheses.length || unknowns.length || recommendations.length || recordList(payload.comparison_facts).length || recordList(payload.facts).length);
  const detailGroups = [
    { label: "Facts", values: facts },
    { label: "Hypotheses — not verified", values: hypotheses },
    { label: "Unknowns and limits", values: unknowns },
  ];

  return (
    <article className="flex min-w-0 flex-col gap-3 [overflow-wrap:anywhere]">
      <div className="flex flex-wrap items-center gap-2">
        <span style={{
          fontSize: "0.62rem", fontWeight: 750, letterSpacing: "0.04em",
          textTransform: "uppercase", color: dark && state === "streaming" ? "#b4a8ff" : pill.fg, background: pill.bg,
          padding: "3px 8px", borderRadius: 999,
        }}>
          {pill.label}
        </span>
        {investigation?.label && (
          <span style={{ fontSize: "0.72rem", color: muted }}>{textValue(investigation.label)}</span>
        )}
        {typeof confidence?.score === "number" && Number.isFinite(confidence.score) && confidence.score >= 0 && confidence.score <= 1 && (
          <span style={{ fontSize: "0.72rem", color: muted }}>
            Confidence {Math.round(confidence.score * 100)}%
          </span>
        )}
        <span className="inline-flex items-center gap-1" style={{ fontSize: "0.7rem", color: muted, marginLeft: "auto" }}>
          <ShieldCheck size={12} color="#067647" />
          Read-only
        </span>
      </div>

      {steps.length > 0 && (
        <InvestigationTimeline
          steps={steps}
          investigation={investigation}
          streaming={streaming}
          dark={dark}
        />
      )}

      <div style={{ fontSize: "0.9rem", lineHeight: 1.65, color: strong }}>
        {body && <RevMarkdown text={body} tone={dark ? "dark" : "light"} />}
        {sections.map(section => <section key={section.label} className="mt-3">
          <h3 className="text-xs font-semibold mb-1">{section.label}</h3>
          <RevMarkdown text={section.text} tone={dark ? "dark" : "light"} />
        </section>)}
        {!body && !sections.length && !facts.length && !hypotheses.length && !unknowns.length && !recommendations.length && <p>No answer content was returned.</p>}
        {detailGroups.map(({ label, values }) => values.length > 0 && <section key={label} className="mt-3">
          <h3 className="text-xs font-semibold mb-1">{label}</h3>
          <ul className="list-disc pl-4">{[...new Set(values)].map(text => <li key={text}>{text}</li>)}</ul>
        </section>)}
      </div>

      {citedEvidenceIds.length > 0 && !streaming && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1" aria-label="Evidence cited in this answer">
          <span style={{ fontSize: "0.68rem", color: muted, fontWeight: 650 }}>Sources:</span>
          {citedEvidenceIds.map((id) => {
            const item = evidenceById.get(id)!;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onOpenEvidence?.(id)}
                className="inline-flex items-center"
                style={{
                  fontSize: "0.7rem", color: dark ? "#A5B4FC" : "#1F06AC", background: "transparent",
                  border: "none", padding: 0, cursor: "pointer",
                  textDecoration: "underline", textUnderlineOffset: 2,
                }}
                aria-label={`Open evidence: ${item.label}`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      )}

      {partialSpecialists.length > 0 && (
        <div style={{
          display: "flex", gap: 8, alignItems: "flex-start",
          background: dark ? "rgba(181,71,8,0.12)" : "#FFFAEB",
          border: `1px solid ${dark ? "rgba(181,71,8,0.3)" : "#FEDF89"}`,
          borderRadius: 10, padding: "9px 11px",
        }}>
          <TriangleAlert size={14} color="#B54708" style={{ marginTop: 1, flexShrink: 0 }} />
          <div>
            <p style={{ margin: 0, fontSize: "0.76rem", fontWeight: 650, color: dark ? "#FDB022" : "#B54708" }}>
              Some checks could not complete
            </p>
            <p style={{ margin: "2px 0 0", fontSize: "0.72rem", color: muted, lineHeight: 1.5 }}>
              {partialSpecialists.map((specialist) => `${textValue(specialist.name) || "Check"} (${textValue(specialist.status) || "unknown"})`).join(", ")}.
              Available findings are still shown; nothing was estimated to fill the gap.
            </p>
          </div>
        </div>
      )}

      {warnings.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 16, display: "flex", flexDirection: "column", gap: 3 }}>
          {warnings.map((warning) => (
            <li key={warning} style={{ fontSize: "0.72rem", color: muted, lineHeight: 1.5 }}>{warning}</li>
          ))}
        </ul>
      )}

      {recommendations.length > 0 && (
        <div className="flex flex-col gap-2" style={{ borderTop: `1px solid ${border}`, paddingTop: 10 }}>
          <p style={{ margin: 0, fontSize: "0.68rem", fontWeight: 750, color: muted, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Recommended next steps
          </p>
          <p className="text-xs" style={{ color: muted }}>Recommendations only — nothing was changed or sent.</p>
          {recommendations.map((recommendation, index) => (
            <div key={index} className="flex gap-2">
              <Check size={13} color="#1F06AC" style={{ marginTop: 3, flexShrink: 0 }} />
              <div>
                <p style={{ margin: 0, fontSize: "0.8rem", fontWeight: 600, color: strong }}>
                  {textValue(recommendation.label)}
                </p>
                <p style={{ margin: "1px 0 0", fontSize: "0.72rem", color: muted, lineHeight: 1.5 }}>
                  {textValue(recommendation.why)}
                  {textValue(recommendation.measure) ? ` Measure: ${recommendation.measure}` : ""}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {followUps.length > 0 && !streaming && (
        <div className="flex flex-wrap gap-2">
          {followUps.slice(0, 4).map((followUp) => (
            <button
              key={followUp}
              type="button"
              onClick={() => onFollowUp?.(followUp)}
              disabled={!onFollowUp}
              className="inline-flex min-h-11 max-w-full items-center gap-1 text-left disabled:opacity-50"
              style={{
                fontSize: "0.74rem", color: dark ? "#b4a8ff" : "#1F06AC",
                background: dark ? "rgba(31,6,172,0.18)" : "rgba(31,6,172,0.06)",
                border: "1px solid rgba(31,6,172,0.16)",
                borderRadius: 999, padding: "5px 11px", cursor: "pointer",
              }}
            >
              {followUp}
              <ArrowUpRight size={13} strokeWidth={1.8} aria-hidden="true" />
            </button>
          ))}
        </div>
      )}

      {!streaming && (
        <div className="flex flex-wrap items-center gap-3" style={{ paddingTop: 2 }}>
          <button
            type="button"
            onClick={onOpenEvidence}
            disabled={!hasEvidence || !onOpenEvidence}
            aria-expanded={evidenceOpen}
            className="inline-flex min-h-11 items-center gap-1.5"
            style={{
              fontSize: "0.74rem", fontWeight: 600,
              color: evidenceOpen ? (dark ? "#b4a8ff" : "#1F06AC") : muted,
              background: "transparent", border: "none",
              cursor: hasEvidence ? "pointer" : "not-allowed", padding: 0,
              opacity: hasEvidence ? 1 : 0.5,
            }}
          >
            <Database size={13} />
            {evidenceCount ? `Evidence (${evidenceCount})` : hasEvidence ? "Evidence and limitations" : "No evidence records"}
          </button>
          {onCopy && (
            <button
              type="button"
              onClick={onCopy}
              className="inline-flex items-center gap-1.5"
              style={{ fontSize: "0.74rem", color: muted, background: "transparent", border: "none", cursor: "pointer", padding: 0 }}
            >
              <Copy size={13} />
              {copied ? "Copied" : "Copy answer"}
            </button>
          )}
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              disabled={!canRetry}
              className="inline-flex items-center gap-1.5"
              style={{
                fontSize: "0.74rem", color: muted, background: "transparent",
                border: "none", cursor: canRetry ? "pointer" : "not-allowed",
                padding: 0, opacity: canRetry ? 1 : 0.5,
              }}
            >
              <RefreshCw size={13} />
              Regenerate
            </button>
          )}
        </div>
      )}
    </article>
  );
}

export default RevAnswerView;
