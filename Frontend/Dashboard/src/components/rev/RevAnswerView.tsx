import { useMemo } from "react";
import {
  ArrowUpRight, Check, Copy, Database, RefreshCw, TriangleAlert,
} from "lucide-react";
import RevMarkdown from "@/components/rev/RevMarkdown";
import { parseVerifiedComparison } from "@/lib/revComparison";
import { InvestigationTimeline } from "@/components/rev/InvestigationTimeline";
import type { EvidenceItem, RevAnswerPayload, RevFact, RevHypothesis, RevRecommendation, SpecialistsSummary, InvestigationStep } from "@/lib/revStream";

import { coveredBy, evidenceState, formatPeriod, normaliseRevAnswer, recordList, stringList, textValue } from "@/lib/revPresentation";
import { responseModeOf, type RevResponseMode } from "@/lib/revStream";

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

/** Structured cards derived only from values explicitly present in Rev's verified answer. */
function VerifiedComparison({ text, dark, strong, muted, border }: {
  text: string; dark: boolean; strong: string; muted: string; border: string;
}) {
  const metrics = parseVerifiedComparison(text);
  if (!metrics) return null;
  return (
    <section aria-label="Verified store performance comparison">
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <Database size={15} color="#1F06AC" />
        <span style={{ color: strong, fontSize: 13, fontWeight: 750 }}>Verified performance evidence</span>
        <span style={{ color: muted, fontSize: 11 }}>Rolling 7-day periods · UTC</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
        {metrics.map((period, index) => (
          <div key={index} style={{ border: `1px solid ${index === 0 ? "#1F06AC" : border}`, borderRadius: 12,
            padding: 14, background: index === 0 ? (dark ? "#1b1740" : "#f4f2ff") : "transparent" }}>
            <div style={{ color: strong, fontSize: 13, fontWeight: 750 }}>{period.title}</div>
            <div style={{ color: muted, fontSize: 11, marginTop: 4, marginBottom: 12 }}>{period.dates}</div
            >
            {([["Orders", period.orders], ["Abandoned carts", period.carts], ["New profiles", period.customers],
               ["First-time orders", period.firstTime], ["Returning orders", period.returning]] as Array<[string, string | null]>).map(([label, value]) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "5px 0" }}>
                <span style={{ color: muted, fontSize: 12 }}>{label}</span>
                <strong style={{ color: strong, fontSize: 13 }}>{value ?? "—"}</strong>
              </div>
            ))}
            {period.cartValues.map((value, i) => <div key={`c${i}`} style={{ color: strong, fontSize: 12, marginTop: 6 }}>Recorded cart value: <strong>{value}</strong></div>)}
            {period.values.map((value, i) => <div key={`v${i}`} style={{ color: strong, fontSize: 12, marginTop: 9 }}>Recorded order value: <strong>{value}</strong></div>)}
            {period.discounts.map((value, i) => <div key={`d${i}`} style={{ color: muted, fontSize: 12, marginTop: 4 }}>Discounts: {value}</div>)}
          </div>
        ))}
      </div>
      <div style={{ fontSize: 12, color: muted, marginTop: 10 }}>Recorded merchant data, not verified net sales. Review the evidence limitations below.</div>
    </section>
  );
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
  const evidenceItems = [
    ...recordList<EvidenceItem>(payload.evidence?.items),
    ...recordList<EvidenceItem>(payload.evidence?.comparison_items),
  ];
  const evidenceCount = evidenceItems.length;

  // Evidence actually retrieved, keyed by id, so a citation can be resolved to a
  // real record with a real label.
  const evidenceById = useMemo(() => {
    const map = new Map<string, EvidenceItem>();
    for (const item of evidenceItems) {
      const id = textValue(item?.id);
      if (id && !map.has(id)) map.set(id, item);
    }
    return map;
  }, [payload]);

  // Ids cited by facts and comparison facts, de-duplicated, and filtered to those
  // that resolve to a retrieved record. A citation to a record that does not exist
  // is dropped rather than rendered: evidence references must correspond to actual
  // retrieved records, and an unresolvable id must never become a clickable source
  // that opens nothing or throws when its label is read.
  const citedEvidenceIds = useMemo(() => {
    const cited = [
      ...recordList<RevFact>(payload.facts),
      ...recordList<RevFact>(payload.comparison_facts),
    ].flatMap(fact => stringList(fact?.evidence_ids));
    return [...new Set(cited)].filter(id => evidenceById.has(id));
  }, [payload, evidenceById]);
  const warnings = [
    ...stringList(payload.warnings),
    ...stringList(payload.response?.warnings),
  ].filter((warning, index, list) => list.indexOf(warning) === index);
  const partialSpecialists = recordList<SpecialistsSummary>(payload.specialists).filter(
    (specialist) => specialist.status !== "success",
  );
  const followUps = stringList(investigation?.follow_ups);
  const body = textValue(payload.text);
  // Presentation mode comes from the backend's deterministic selection. A
  // legacy payload without a mode keeps full rigour when it carries structured
  // evidence, and reads as plain conversation when it carries none.
  // An evidence object that yields nothing usable is a warning state, not a
  // quiet conversation: the merchant must see that the check produced nothing.
  const carriesEvidence = Boolean(payload.evidence) && (
    recordList<EvidenceItem>(payload.evidence?.items).length > 0 ||
    evidenceState(payload.evidence) !== "verified"
  );
  const mode: RevResponseMode = responseModeOf(payload) ?? (
    recordList(payload.facts).length || recordList(payload.comparison_facts).length ||
    recordList(payload.hypotheses).length || recordList(payload.recommendations).length ||
    carriesEvidence
      ? "investigation"
      : "conversational"
  );
  const quiet = mode === "conversational" || mode === "quick_verification";
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
      {!quiet && state !== "streaming" && state !== "verified" && (
        <div className="flex flex-wrap items-center gap-2">
          <span style={{
            fontSize: "0.62rem", fontWeight: 750, letterSpacing: "0.04em",
            textTransform: "uppercase", color: pill.fg, background: pill.bg,
            padding: "3px 8px", borderRadius: 999,
          }}>
            {pill.label}
          </span>
          {investigation?.label && (
            <span style={{ fontSize: "0.72rem", color: muted }}>{textValue(investigation.label)}</span>
          )}
        </div>
      )}

      {streaming && steps.length > 0 && (
        <InvestigationTimeline
          steps={steps}
          investigation={investigation}
          streaming={streaming}
          dark={dark}
          compact
        />
      )}

      {!streaming && body && <VerifiedComparison text={body} dark={dark} strong={strong} muted={muted} border={border} />}

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

      {!streaming && !quiet && investigation?.period?.start && (
        <p style={{ margin: 0, fontSize: "0.7rem", color: muted }}>
          Based on recorded store data for {formatPeriod(investigation.period)} (UTC).
        </p>
      )}

      {citedEvidenceIds.length > 0 && !streaming && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1" aria-label="Evidence cited in this answer">
          <span style={{ fontSize: "0.68rem", color: muted, fontWeight: 650 }}>Sources:</span>
          {citedEvidenceIds.map((id) => {
            const item = evidenceById.get(id);
            if (!item) return null;
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
            // This button toggles the whole panel, so it must not report an
            // evidence id. Wired straight to onClick it handed the handler a
            // MouseEvent where the contract declares `evidenceId?: string`.
            onClick={() => onOpenEvidence?.()}
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
