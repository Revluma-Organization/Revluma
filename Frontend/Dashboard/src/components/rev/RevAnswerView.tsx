import { useMemo } from "react";
import {
  ArrowUpRight, Check, Copy, Database, RefreshCw, TriangleAlert,
} from "lucide-react";
import RevMarkdown from "@/components/rev/RevMarkdown";
import { InvestigationTimeline } from "@/components/rev/InvestigationTimeline";
import type { RevAnswerPayload } from "@/lib/revStream";
import { STATE_PILL, deriveAnswerState, isEvidenceBearing } from "@/lib/revAnswerState";

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

export function RevAnswerView({
  payload, streaming = false, evidenceOpen = false, onOpenEvidence, onFollowUp,
  onRetry, onCopy, copied = false, canRetry = false, dark = false,
}: Props) {
  const state = useMemo(() => deriveAnswerState(payload, streaming), [payload, streaming]);
  const pill = STATE_PILL[state];
  const strong = dark ? "#F2F4F7" : "#101828";
  const muted = dark ? "#98A2B3" : "#667085";
  const border = dark ? "rgba(255,255,255,0.09)" : "#EAECF0";

  const investigation = payload.investigation;
  const steps = investigation?.steps ?? [];
  const evidenceCount = payload.evidence?.items?.length ?? 0;
  const evidenceById = new Map(
    [...(payload.evidence?.items ?? []), ...(payload.evidence?.comparison_items ?? [])]
      .map((item) => [item.id, item] as const),
  );
  const citedEvidenceIds = [...new Set([
    ...(payload.facts ?? []).flatMap((fact) => fact.evidence_ids ?? []),
    ...(payload.comparison_facts ?? []).flatMap((fact) => fact.evidence_ids ?? []),
    ...(payload.recommendations ?? []).flatMap((item) => item.evidence_ids ?? []),
    ...(payload.hypotheses ?? []).flatMap((item) => item.basis_evidence_ids ?? []),
  ])].filter((id) => evidenceById.has(id)).slice(0, 6);
  const warnings = [
    ...(payload.warnings ?? []),
    ...(payload.response?.warnings ?? []),
  ].filter((warning, index, list) => list.indexOf(warning) === index);
  const partialSpecialists = (payload.specialists ?? []).filter(
    (specialist) => specialist.status !== "success" && specialist.status !== "no_data",
  );
  const followUps = investigation?.follow_ups ?? [];
  const confidence = payload.response?.confidence;
  const body = payload.text || payload.response?.situation || "";

  return (
    <article className="flex flex-col gap-3">
      {(state !== "conversational" || confidence?.score !== undefined) && (
        <div className="flex flex-wrap items-center gap-2">
          {state !== "conversational" && (
            <>
              <span style={{
                fontSize: "0.62rem", fontWeight: 750, letterSpacing: "0.04em",
                textTransform: "uppercase", color: pill.fg, background: pill.bg,
                padding: "3px 8px", borderRadius: 999,
              }}>
                {pill.label}
              </span>
              {investigation?.label && (
                <span style={{ fontSize: "0.72rem", color: muted }}>{investigation.label}</span>
              )}
            </>
          )}
          {confidence?.score !== undefined && (
            <span style={{ fontSize: "0.72rem", color: muted }}>
              Confidence {Math.round(confidence.score * 100)}%
            </span>
          )}
        </div>
      )}

      {steps.length > 0 && (
        <InvestigationTimeline
          steps={steps}
          investigation={investigation}
          streaming={streaming}
          dark={dark}
        />
      )}

      <div style={{ fontSize: "0.9rem", lineHeight: 1.65, color: strong }}>
        <RevMarkdown text={body} tone={dark ? "dark" : "light"} />
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
              {partialSpecialists.map((specialist) => `${specialist.name} (${specialist.status})`).join(", ")}.
              Available findings are still shown; nothing was estimated to fill the gap.
            </p>
          </div>
        </div>
      )}

      {warnings.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 16, display: "flex", flexDirection: "column", gap: 3 }}>
          {warnings.slice(0, 6).map((warning) => (
            <li key={warning} style={{ fontSize: "0.72rem", color: muted, lineHeight: 1.5 }}>{warning}</li>
          ))}
        </ul>
      )}

      {(payload.recommendations ?? []).length > 0 && (
        <div className="flex flex-col gap-2" style={{ borderTop: `1px solid ${border}`, paddingTop: 10 }}>
          <p style={{ margin: 0, fontSize: "0.68rem", fontWeight: 750, color: muted, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Recommended next steps
          </p>
          {(payload.recommendations ?? []).slice(0, 4).map((recommendation, index) => (
            <div key={index} className="flex gap-2">
              <Check size={13} color="#1F06AC" style={{ marginTop: 3, flexShrink: 0 }} />
              <div>
                <p style={{ margin: 0, fontSize: "0.8rem", fontWeight: 600, color: strong }}>
                  {recommendation.label}
                </p>
                <p style={{ margin: "1px 0 0", fontSize: "0.72rem", color: muted, lineHeight: 1.5 }}>
                  {recommendation.why}
                  {recommendation.measure ? ` Measure: ${recommendation.measure}` : ""}
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
              className="inline-flex items-center gap-1"
              style={{
                fontSize: "0.78rem", fontWeight: 400, color: strong,
                background: "transparent", border: "none", borderRadius: 0,
                padding: "2px 0", textDecoration: "underline",
                textUnderlineOffset: "3px", textDecorationThickness: "1px",
                cursor: "pointer",
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
            disabled={!isEvidenceBearing(payload)}
            className="inline-flex items-center gap-1.5"
            style={{
              fontSize: "0.74rem", fontWeight: 600,
              color: evidenceOpen ? "#1F06AC" : muted,
              background: "transparent", border: "none",
              cursor: evidenceCount ? "pointer" : "not-allowed", padding: 0,
              opacity: evidenceCount ? 1 : 0.5,
            }}
          >
            <Database size={13} />
            {evidenceCount ? `Evidence (${evidenceCount})` : "No evidence records"}
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
