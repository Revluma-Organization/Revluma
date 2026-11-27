import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  ArrowUpRight, Calculator, Check, Database, FlaskConical, HelpCircle, TriangleAlert,
} from "lucide-react";
import RevMarkdown from "@/components/rev/RevMarkdown";
import { CitationChip } from "@/components/rev/CitationChip";
import { RevVerifiedComparison } from "@/components/rev/RevVerifiedComparison";
import { RevMetricCards } from "@/components/rev/RevMetricCards";
import { parseVerifiedComparison } from "@/lib/revComparison";
import { deriveMetricCards } from "@/lib/revVisuals";
import { InvestigationTimeline } from "@/components/rev/InvestigationTimeline";
import type { EvidenceItem, RevAnswerPayload, RevFact, RevHypothesis, RevRecommendation, SpecialistsSummary, InvestigationStep } from "@/lib/revStream";

import {
  ANSWER_STATE_PILL, answerConfidence, answerSections, coverageDisclosure, coverageText, coveredBy,
  deriveAnswerState, evidenceItemWellFormed, formatEvidenceValue, formatPeriod, formatTimestamp,
  freshnessText, normaliseRevAnswer, recordList, stepStatusWord, stringList, textValue, validationSucceeded,
} from "@/lib/revPresentation";
import { responseModeOf, type RevResponseMode } from "@/lib/revStream";

interface Props {
  payload: RevAnswerPayload;
  streaming?: boolean;
  evidenceOpen?: boolean;
  onOpenEvidence?: (evidenceId?: string) => void;
  onFollowUp?: (text: string) => void;
  dark?: boolean;
}

const DISCLOSURE_HEADING: CSSProperties = {
  margin: "0 0 3px", fontSize: "0.64rem", fontWeight: 750,
  textTransform: "uppercase", letterSpacing: "0.05em",
};
const DISCLOSURE_LINE: CSSProperties = { margin: 0, fontSize: "0.72rem", lineHeight: 1.55 };

// Evidence-record verification badges mirror EvidencePanel's row logic
// exactly: "Verified" requires a clean validation block, a well-formed
// record, an available status and a usable value. Anything less keeps its
// honest weaker label — availability is never upgraded to verification.
const RECORD_STATUS_LABEL: Record<string, string> = {
  available: "Available — unverified",
  partial: "Partial",
  unavailable: "Unavailable",
  unsupported: "Not supported",
};

const RECORD_STATUS_COLOR: Record<string, { fg: string; bg: string }> = {
  available: { fg: "#067647", bg: "#ECFDF3" },
  partial: { fg: "#B54708", bg: "#FFFAEB" },
  unavailable: { fg: "#B42318", bg: "#FEF3F2" },
  unsupported: { fg: "#475467", bg: "#F2F4F7" },
};

// Finding-class badges. Every colour is already in the Rev palette: green
// for verified records, brand purple for backend-derived calculations, amber
// for hypotheses, grey for unknowns. The classes are disjoint by construction
// — a row carries exactly one class badge.
const CLASS_BADGE = {
  calculated: { label: "Calculated", fg: "#1F06AC", bg: "rgba(31,6,172,0.08)" },
  comparison: { label: "Comparison", fg: "#1F06AC", bg: "rgba(31,6,172,0.08)" },
  hypothesis: { label: "Hypothesis", fg: "#B54708", bg: "#FFFAEB" },
  unknown: { label: "Unknown", fg: "#475467", bg: "#F2F4F7" },
} as const;

function Badge({ fg, bg, label }: { fg: string; bg: string; label: string }) {
  return (
    <span style={{
      fontSize: "0.62rem", fontWeight: 700, color: fg, background: bg,
      padding: "2px 6px", borderRadius: 999, whiteSpace: "nowrap",
    }}>
      {label}
    </span>
  );
}

function SectionHeading({ icon, title, count, muted }: {
  icon: ReactNode; title: string; count?: number; muted: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
      {icon}
      <h3 style={{ margin: 0, fontSize: "0.68rem", fontWeight: 750, color: muted, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {title}{typeof count === "number" ? ` (${count})` : ""}
      </h3>
    </div>
  );
}

/**
 * One retrieved evidence record in the ledger. Every field renders only from
 * the record itself: a missing value reads "Unavailable" (formatEvidenceValue
 * never renders a zero for a null), a missing timestamp reads "Not supplied
 * or invalid", and limitations render verbatim or not at all.
 */
function EvidenceLedgerRow({ item, comparison, validated, dark, strong, muted, border, onOpen }: {
  item: EvidenceItem; comparison: boolean; validated: boolean;
  dark: boolean; strong: string; muted: string; border: string;
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const usable = !formatEvidenceValue(item).startsWith("Unavailable");
  const verified = validated && evidenceItemWellFormed(item) && item.status === "available" && usable;
  const knownStatus = typeof item.status === "string" && Object.prototype.hasOwnProperty.call(RECORD_STATUS_LABEL, item.status) ? item.status : null;
  const status = knownStatus ? (verified ? RECORD_STATUS_COLOR.available : knownStatus === "available" ? RECORD_STATUS_COLOR.partial : RECORD_STATUS_COLOR[knownStatus]) : RECORD_STATUS_COLOR.unsupported;
  const statusLabel = verified ? "Verified" : knownStatus ? RECORD_STATUS_LABEL[knownStatus] : "Unverified";
  const limitations = stringList(item.limitations);
  const freshness = freshnessText(item.freshness);
  const coverage = coverageText(item.coverage);
  const stale = textValue(item.freshness?.state).toLowerCase() === "stale";
  return (
    <div style={{ border: `1px solid ${border}`, borderRadius: 10, padding: "9px 11px", background: dark ? "rgba(255,255,255,0.02)" : "#FFFFFF" }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={`${textValue(item.label) || "Evidence record"} — ${statusLabel}${comparison ? ", comparison period" : ""}. ${open ? "Collapse" : "Expand"} details.`}
        className="flex w-full flex-wrap items-start gap-2 text-left"
      >
        <div style={{ flex: "1 1 12rem", minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: "0.8rem", fontWeight: 600, color: strong, lineHeight: 1.4 }}>
            {textValue(item.label) || textValue(item.metric) || "Evidence record"}
          </p>
          <p style={{ margin: "2px 0 0", fontSize: "0.7rem", color: muted }}>
            {textValue(item.source) || "Source not supplied"} · {formatPeriod(item.period)}
          </p>
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-2">
          <span style={{ fontSize: "0.82rem", fontWeight: 700, color: strong, overflowWrap: "anywhere" }}>
            {formatEvidenceValue(item)}
          </span>
          <Badge fg={status.fg} bg={status.bg} label={statusLabel} />
          {comparison && <Badge fg={CLASS_BADGE.comparison.fg} bg={CLASS_BADGE.comparison.bg} label={CLASS_BADGE.comparison.label} />}
        </div>
      </button>
      {open && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 5, borderTop: `1px solid ${border}`, paddingTop: 8 }}>
          <p style={{ margin: 0, fontSize: "0.72rem", color: muted, lineHeight: 1.55 }}>
            <strong style={{ color: strong }}>What it measures.</strong> {textValue(item.definition) || "Not supplied"}
          </p>
          <p style={{ margin: 0, fontSize: "0.7rem", color: muted }}>
            <strong style={{ color: strong }}>Value.</strong> {formatEvidenceValue(item)}
            {typeof item.currency === "string" && /^[A-Z]{3}$/.test(item.currency) ? ` (${item.currency})` : ""}
          </p>
          <p style={{ margin: 0, fontSize: "0.7rem", color: muted }}>
            <strong style={{ color: strong }}>Updated.</strong> {item.freshness?.as_of ? formatTimestamp(item.freshness.as_of) : "Not supplied"}
            {stale ? " — stale" : ""}
          </p>
          {freshness && (
            <p style={{ margin: 0, fontSize: "0.7rem", color: muted }}>
              <strong style={{ color: strong }}>Freshness.</strong> {freshness}
            </p>
          )}
          {coverage && (
            <p style={{ margin: 0, fontSize: "0.7rem", color: muted }}>
              <strong style={{ color: strong }}>Coverage.</strong> {coverage}
            </p>
          )}
          {limitations.length > 0 ? limitations.map((limitation) => (
            <p key={limitation} style={{ margin: 0, fontSize: "0.7rem", color: muted, lineHeight: 1.5 }}>
              <strong style={{ color: strong }}>Limitation.</strong> {limitation}
            </p>
          )) : (
            <p style={{ margin: 0, fontSize: "0.7rem", color: muted }}>
              <strong style={{ color: strong }}>Limitations.</strong> None supplied
            </p>
          )}
          <p style={{ margin: 0, fontSize: "0.7rem", color: muted }}>
            <strong style={{ color: strong }}>Evidence ID.</strong> <code>{textValue(item.id) || "Not supplied"}</code>
          </p>
          {onOpen && (
            <button
              type="button"
              onClick={onOpen}
              className="self-start text-left"
              style={{ fontSize: "0.72rem", fontWeight: 600, color: dark ? "#b4a8ff" : "#1F06AC", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}
            >
              Open in evidence panel
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Phase 5E — the evidence-first workspace renderer for one Rev turn.
 *
 * The same payload contract as RevAnswerView (which the copilot keeps), the
 * same derivations, the same quiet/conversational discipline — restructured
 * into the investigation hierarchy: executive summary first, then the
 * evidence ledger, then the findings hierarchy (findings → calculated
 * changes → hypotheses → unknowns), then next-step guidance. Nothing here
 * strengthens a claim: classifications come from the record's own status and
 * the payload's own validation block, missing values never render as zero,
 * and confidence renders only as the backend's own sentence.
 */
export function RevInvestigationView({
  payload: original, streaming = false, evidenceOpen = false, onOpenEvidence, onFollowUp, dark = false,
}: Props) {
  const payload = useMemo(() => normaliseRevAnswer(original) ?? original, [original]);
  const metricCards = useMemo(() => deriveMetricCards(payload), [payload]);
  const state = useMemo(() => deriveAnswerState(payload, streaming), [payload, streaming]);
  const pill = ANSWER_STATE_PILL[state];
  const strong = dark ? "#F2F4F7" : "#101828";
  const muted = dark ? "#98A2B3" : "#667085";
  const border = dark ? "rgba(255,255,255,0.09)" : "#EAECF0";

  const investigation = payload.investigation;
  const steps = recordList<InvestigationStep>(investigation?.steps);
  const currentItems = recordList<EvidenceItem>(payload.evidence?.items);
  const comparisonItems = recordList<EvidenceItem>(payload.evidence?.comparison_items);
  const evidenceItems = [...currentItems, ...comparisonItems];
  const evidenceCount = evidenceItems.length;
  const currencies = [...new Set(evidenceItems.map(item => textValue(item?.currency)).filter(Boolean))];
  const monetary = evidenceItems.some(item => item?.unit === "currency" || Boolean(textValue(item?.currency)));
  const validated = validationSucceeded(payload.evidence);

  const evidenceById = useMemo(() => {
    const map = new Map<string, EvidenceItem>();
    for (const item of evidenceItems) {
      const id = textValue(item?.id);
      if (id && !map.has(id)) map.set(id, item);
    }
    return map;
  }, [payload]);

  const citedEvidenceIds = useMemo(() => {
    const cited = [
      ...recordList<RevFact>(payload.facts),
      ...recordList<RevFact>(payload.comparison_facts),
    ].flatMap(fact => stringList(fact?.evidence_ids));
    return [...new Set(cited)].filter(id => evidenceById.has(id));
  }, [payload, evidenceById]);
  const reliabilityFailures = Array.isArray(payload.reliability?.failures)
    ? payload.reliability.failures.filter(failure => failure && typeof failure.stage === "string")
    : [];
  const warnings = [
    ...stringList(payload.warnings),
    ...stringList(payload.response?.warnings),
    ...(reliabilityFailures.length
      ? [`Some checks did not complete (${reliabilityFailures.map(failure => failure.stage.replace(/_/g, " ")).join(", ")}). Available results are shown without treating the failed checks as successful.`]
      : []),
  ].filter((warning, index, list) => list.indexOf(warning) === index);
  const partialSpecialists = recordList<SpecialistsSummary>(payload.specialists).filter(
    (specialist) => specialist.status !== "success",
  );
  const followUps = stringList(investigation?.follow_ups);
  const body = textValue(payload.text);
  const evidenceContent = (ev: unknown) => {
    const record = ev as { items?: unknown; limitations?: unknown } | null | undefined;
    return recordList<EvidenceItem>(record?.items).length > 0 ||
      stringList(record?.limitations).length > 0;
  };
  const carriesEvidence = evidenceContent(payload.evidence);
  const mode: RevResponseMode = responseModeOf(payload) ?? (
    recordList(payload.facts).length || recordList(payload.comparison_facts).length ||
    recordList(payload.hypotheses).length || recordList(payload.recommendations).length ||
    Boolean(textValue(payload.response?.situation) || textValue(payload.response?.insight) ||
            textValue(payload.response?.implication) || textValue(payload.response?.recommendation)) ||
    carriesEvidence
      ? "investigation"
      : "conversational"
  );
  const gate = textValue((payload.understanding as { gate?: unknown } | undefined)?.gate);
  const gateQuiet = gate === "conversational" || gate === "clarify" || gate === "refuse";
  const quiet = gateQuiet || mode === "conversational" || mode === "quick_verification";
  let shown = body;
  const appendSection = (label: string, text: string): { id?: string; label: string; text: string } | null => {
    if (!text || coveredBy(shown, text)) return null;
    shown += `\n${text}`;
    return { label, text };
  };
  const adaptiveSections = answerSections(payload.response);
  const sections = adaptiveSections.length > 0
    ? adaptiveSections.flatMap(section => {
        const added = appendSection(section.label, section.text);
        return added ? [{ ...added, id: section.id }] : [];
      })
    : (["situation", "insight", "implication", "recommendation"] as const).flatMap(key => {
        const added = appendSection(key[0].toUpperCase() + key.slice(1), textValue(payload.response?.[key]));
        return added ? [added] : [];
      });
  const confidence = answerConfidence(payload.response);
  const confidenceSentence = confidence && !coveredBy(shown, confidence.communication)
    ? confidence.communication
    : null;
  const coverageDisclosureData = confidence?.coverage
    ? coverageDisclosure(confidence.coverage)
    : null;
  const factEntry = (fact: RevFact) => ({
    text: textValue(fact.text),
    ids: stringList(fact?.evidence_ids).filter(id => evidenceById.has(id)),
  });
  const facts = recordList<RevFact>(payload.facts).map(factEntry)
    .filter(entry => entry.text && !coveredBy(shown, entry.text));
  const comparisonFacts = recordList<RevFact>(payload.comparison_facts).map(factEntry)
    .filter(entry => entry.text && !coveredBy(shown, entry.text)
      && !facts.some(other => other.text === entry.text));
  const hypotheses = recordList<RevHypothesis>(payload.hypotheses).map(item => textValue(item.statement)).filter(text => text && !coveredBy(shown, text));
  const unknowns = stringList(payload.unknowns).filter(text => !coveredBy(shown, text));
  const recommendations = recordList<RevRecommendation>(payload.recommendations).filter(item => {
    const parts = [item.label, item.why, item.measure].map(textValue).filter(Boolean);
    return parts.length > 0 && !parts.every(text => coveredBy(shown, text));
  });
  const hasEvidence = Boolean(evidenceContent(payload.evidence) || facts.length || hypotheses.length || unknowns.length || recommendations.length || recordList(payload.comparison_facts).length || recordList(payload.facts).length);
  const hasSummary = Boolean(body || sections.length || confidenceSentence);
  const hasFindings = facts.length > 0 || comparisonFacts.length > 0 || hypotheses.length > 0 || unknowns.length > 0;
  const hasNextSteps = recommendations.length > 0 || (followUps.length > 0 && !streaming);
  const empty = !hasSummary && !facts.length && !comparisonFacts.length && !hypotheses.length && !unknowns.length && !recommendations.length;

  const renderCitedEntry = (entry: { text: string; ids: string[] }) => (
    <>
      {entry.text}
      {entry.ids.map(id => {
        const item = evidenceById.get(id);
        if (!item) return null;
        return (
          <CitationChip
            key={id}
            number={citedEvidenceIds.indexOf(id) + 1}
            item={item}
            tone={dark ? "dark" : "light"}
            variant="marker"
            onOpen={onOpenEvidence}
          />
        );
      })}
    </>
  );

  return (
    <article className="flex min-w-0 flex-col gap-4 [overflow-wrap:anywhere]">
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

      {streaming && !quiet && steps.length > 0 && (
        <InvestigationTimeline
          steps={steps}
          investigation={investigation}
          streaming={streaming}
          dark={dark}
          compact
        />
      )}

      {!quiet && !streaming && body && <RevVerifiedComparison text={body} dark={dark} strong={strong} muted={muted} border={border} />}

      {/* Executive summary — the conclusion first, then the backend's own
          ordered sections, then its confidence sentence. Never a badge, never
          a percentage, never filler. */}
      {!quiet && hasSummary && (
        <section aria-label="Executive summary" className="flex flex-col gap-2">
          {/* Answer first, unboxed (ChatGPT-UI study §3): no visible report
              label above the answer; the heading stays for assistive tech. */}
          <h3 className="sr-only">Summary</h3>
          <div style={{ fontSize: "0.9rem", lineHeight: 1.65, color: strong }}>
            {body && <RevMarkdown text={body} tone={dark ? "dark" : "light"} streaming={streaming} />}
            {sections.map(section => <section key={section.id ?? section.label} className="mt-3">
              <h4 className="text-xs font-semibold mb-1" style={{ color: strong }}>{section.label}</h4>
              <RevMarkdown text={section.text} tone={dark ? "dark" : "light"} streaming={streaming} />
            </section>)}
            {confidenceSentence && (
              <p className="mt-2" style={{ margin: "0.5rem 0 0", fontSize: "0.9rem", lineHeight: 1.65 }}>{confidenceSentence}</p>
            )}
          </div>
        </section>
      )}

      {quiet && body && (
        <div style={{ fontSize: "0.9rem", lineHeight: 1.65, color: strong }}>
          <RevMarkdown text={body} tone={dark ? "dark" : "light"} streaming={streaming} />
        </div>
      )}

      {empty && <p style={{ fontSize: "0.9rem", color: strong }}>No answer content was returned.</p>}

      {/* Commerce component catalog (adoption R5): KPI cards built only from
          retrieved evidence records, shown when they add more than the prose.
          The legacy verified-comparison card set takes precedence. */}
      {!quiet && !streaming && metricCards.length > 0 && !parseVerifiedComparison(body) && (
        <RevMetricCards cards={metricCards} tone={dark ? "dark" : "light"} onOpen={onOpenEvidence ? () => onOpenEvidence() : undefined} />
      )}


      {/* Evidence ledger — every retrieved record with its own
          classification. Comparison-period records carry a Comparison tag in
          addition to their verification badge; the calculation itself (the
          derived change) lives with the comparison facts below. */}
      {!quiet && !streaming && evidenceItems.length > 0 && (
        <section aria-label="Evidence" className="flex flex-col gap-2">
          <SectionHeading icon={<Database size={13} color={muted} aria-hidden="true" />} title="Evidence" count={evidenceCount} muted={muted} />
          {currentItems.map((item, index) => (
            <EvidenceLedgerRow key={textValue(item?.id) || `current-${index}`} item={item} comparison={false}
              validated={validated} dark={dark} strong={strong} muted={muted} border={border}
              onOpen={onOpenEvidence ? () => onOpenEvidence() : undefined} />
          ))}
          {comparisonItems.map((item, index) => (
            <EvidenceLedgerRow key={textValue(item?.id) || `comparison-${index}`} item={item} comparison
              validated={validated} dark={dark} strong={strong} muted={muted} border={border}
              onOpen={onOpenEvidence ? () => onOpenEvidence() : undefined} />
          ))}
        </section>
      )}

      {/* Findings hierarchy — backend findings with claim-adjacent citations,
          then backend-derived calculations, then hypotheses (never verified),
          then unknowns. */}
      {!quiet && hasFindings && (
        <section aria-label="Findings" className="flex flex-col gap-3">
          <SectionHeading icon={<Check size={13} color={muted} aria-hidden="true" />} title="Findings" muted={muted} />
          {facts.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold mb-1" style={{ color: strong }}>Findings</h4>
              <ul className="list-disc pl-4" style={{ color: strong, fontSize: "0.86rem", lineHeight: 1.6 }}>
                {[...new Map(facts.map(entry => [entry.text, entry])).values()].map(entry => (
                  <li key={entry.text}>{renderCitedEntry(entry)}</li>
                ))}
              </ul>
            </div>
          )}
          {comparisonFacts.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h4 className="text-xs font-semibold" style={{ color: strong, margin: 0 }}>Compared with the previous period</h4>
                <Badge fg={CLASS_BADGE.calculated.fg} bg={CLASS_BADGE.calculated.bg} label={CLASS_BADGE.calculated.label} />
              </div>
              <ul className="list-disc pl-4" style={{ color: strong, fontSize: "0.86rem", lineHeight: 1.6 }}>
                {[...new Map(comparisonFacts.map(entry => [entry.text, entry])).values()].map(entry => (
                  <li key={entry.text}>{renderCitedEntry(entry)}</li>
                ))}
              </ul>
            </div>
          )}
          {hypotheses.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h4 className="text-xs font-semibold" style={{ color: strong, margin: 0 }}>Hypotheses — not verified</h4>
                <Badge fg={CLASS_BADGE.hypothesis.fg} bg={CLASS_BADGE.hypothesis.bg} label={CLASS_BADGE.hypothesis.label} />
              </div>
              <ul className="list-disc pl-4" style={{ color: strong, fontSize: "0.86rem", lineHeight: 1.6 }}>
                {[...new Set(hypotheses)].map(text => (
                  <li key={text}><FlaskConical size={11} style={{ display: "inline", verticalAlign: "-1px", marginRight: 4 }} color={muted} aria-hidden="true" />{text}</li>
                ))}
              </ul>
            </div>
          )}
          {unknowns.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h4 className="text-xs font-semibold" style={{ color: strong, margin: 0 }}>Unknowns and limits</h4>
                <Badge fg={CLASS_BADGE.unknown.fg} bg={CLASS_BADGE.unknown.bg} label={CLASS_BADGE.unknown.label} />
              </div>
              <ul className="list-disc pl-4" style={{ color: strong, fontSize: "0.86rem", lineHeight: 1.6 }}>
                {[...new Set(unknowns)].map(text => (
                  <li key={text}><HelpCircle size={11} style={{ display: "inline", verticalAlign: "-1px", marginRight: 4 }} color={muted} aria-hidden="true" />{text}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* Next-step guidance — investigation only. Recommendations render as
          review text with their measure; follow-ups send a new question.
          Nothing here executes a store change or promises revenue. */}
      {!quiet && hasNextSteps && (
        <section aria-label="Next steps" className="flex flex-col gap-2" style={{ borderTop: `1px solid ${border}`, paddingTop: 12 }}>
          <SectionHeading icon={<Calculator size={13} color={muted} aria-hidden="true" />} title="Next steps" muted={muted} />
          {recommendations.length > 0 && <p className="text-xs" style={{ color: muted, margin: 0 }}>Recommendations only — nothing was changed or sent.</p>}
          {recommendations.map((recommendation, index) => (
            <div key={index} className="flex gap-2">
              <Check size={13} color="#1F06AC" style={{ marginTop: 3, flexShrink: 0 }} aria-hidden="true" />
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
          {followUps.length > 0 && !streaming && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Continue investigating">
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
        </section>
      )}

      {!streaming && (quiet ? monetary : Boolean(investigation?.period?.start || monetary)) && (
        <p style={{ margin: 0, fontSize: "0.7rem", color: muted }}>
          Based on recorded store data
          {investigation?.period?.start ? ` for ${formatPeriod(investigation.period)}` : ""}
          {monetary && currencies.length > 0 ? ` · ${currencies.join(", ")}` : ""}.
        </p>
      )}

      {citedEvidenceIds.length > 0 && !streaming && (!quiet || monetary) && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1" aria-label="Evidence cited in this answer">
          <span style={{ fontSize: "0.68rem", color: muted, fontWeight: 650 }}>Sources:</span>
          {citedEvidenceIds.map((id) => {
            const item = evidenceById.get(id);
            if (!item) return null;
            return (
              <CitationChip
                key={id}
                number={citedEvidenceIds.indexOf(id) + 1}
                item={item}
                tone={dark ? "dark" : "light"}
                variant="source"
                onOpen={onOpenEvidence}
              />
            );
          })}
        </div>
      )}

      {!streaming && !quiet && (steps.length > 0 || evidenceItems.length > 0) && (
        <details style={{ border: `1px solid ${border}`, borderRadius: 10 }}>
          <summary style={{
            cursor: "pointer", padding: "8px 11px", listStyle: "none",
            display: "flex", alignItems: "center", gap: 6,
            fontSize: "0.74rem", fontWeight: 650, color: muted,
          }}>
            <Database size={13} aria-hidden="true" />
            How I checked
          </summary>
          <div style={{ padding: "2px 11px 10px", display: "flex", flexDirection: "column", gap: 9 }}>
            {steps.length > 0 && (
              <div>
                <p style={{ ...DISCLOSURE_HEADING, color: muted }}>Checks that ran</p>
                <ul style={{ margin: 0, paddingLeft: 16 }}>
                  {steps.map((step, index) => (
                    <li key={textValue(step?.id) || index} style={{ ...DISCLOSURE_LINE, color: muted }}>
                      {textValue(step?.label) || textValue(step?.tool) || "Unnamed check"} — {stepStatusWord(step?.status)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div>
              <p style={{ ...DISCLOSURE_HEADING, color: muted }}>Period and currency</p>
              <p style={{ ...DISCLOSURE_LINE, color: muted }}>
                {investigation?.period?.start ? formatPeriod(investigation.period) : "Period unavailable"}
                {" · "}
                {currencies.length > 0 ? currencies.join(", ") : "Currency unavailable"}
              </p>
              {investigation?.period?.compared_to?.start && (
                <p style={{ ...DISCLOSURE_LINE, color: muted, marginTop: 2 }}>
                  Compared with {formatPeriod(investigation.period.compared_to)}
                  {textValue(investigation.period.compared_to.label) ? ` — ${investigation.period.compared_to.label}` : ""}
                </p>
              )}
            </div>
            {coverageDisclosureData && (
              <div>
                <p style={{ ...DISCLOSURE_HEADING, color: muted }}>Coverage and data state</p>
                <p style={{ ...DISCLOSURE_LINE, color: muted }}>{coverageDisclosureData.summary}</p>
                {coverageDisclosureData.limits.map(limit => (
                  <p key={limit} style={{ ...DISCLOSURE_LINE, color: muted, marginTop: 2 }}>{limit}</p>
                ))}
              </div>
            )}
          </div>
        </details>
      )}

      {!quiet && partialSpecialists.length > 0 && (
        <div style={{
          display: "flex", gap: 8, alignItems: "flex-start",
          background: dark ? "rgba(181,71,8,0.12)" : "#FFFAEB",
          border: `1px solid ${dark ? "rgba(181,71,8,0.3)" : "#FEDF89"}`,
          borderRadius: 10, padding: "9px 11px",
        }} role="status">
          <TriangleAlert size={14} color="#B54708" style={{ marginTop: 1, flexShrink: 0 }} aria-hidden="true" />
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
        <ul style={{ margin: 0, paddingLeft: 16, display: "flex", flexDirection: "column", gap: 3 }} aria-label="Warnings">
          {warnings.map((warning) => (
            <li key={warning} style={{ fontSize: "0.72rem", color: muted, lineHeight: 1.5 }}>{warning}</li>
          ))}
        </ul>
      )}

      {!streaming && (
        <div className="flex flex-wrap items-center gap-3" style={{ paddingTop: 2 }}>
          {(!quiet || monetary) && (
          <button
            type="button"
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
            <Database size={13} aria-hidden="true" />
            {evidenceCount ? `Evidence (${evidenceCount})` : hasEvidence ? "Evidence and limitations" : "No evidence records"}
          </button>
          )}
        </div>
      )}
    </article>
  );
}

export default RevInvestigationView;
