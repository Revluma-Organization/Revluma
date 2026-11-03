import { useState } from "react";
import { ChevronDown, Database, ShieldCheck, X } from "lucide-react";
import { evidenceItemWellFormed, evidenceState, formatEvidenceValue, formatPeriod, formatTimestamp, numericValue, recordList, stringList, textValue, validationSucceeded } from "@/lib/revPresentation";
import type {
  EvidenceItem,
  RevAnswerPayload,
  RevFact,
  RevHypothesis,
  RevRecommendation,
} from "@/lib/revStream";

interface Props {
  evidence?: RevAnswerPayload["evidence"];
  facts?: RevFact[];
  comparisonFacts?: RevFact[];
  hypotheses?: RevHypothesis[];
  unknowns?: string[];
  recommendations?: RevRecommendation[];
  factsLabel?: string;
  dark?: boolean;
  onClose?: () => void;
  asSheet?: boolean;
}

const STATUS_LABEL: Record<string, string> = {
  available: "Available — unverified",
  partial: "Partial",
  unavailable: "Unavailable",
  unsupported: "Not supported",
};

const STATUS_COLOR: Record<string, { fg: string; bg: string }> = {
  available: { fg: "#067647", bg: "#ECFDF3" },
  partial: { fg: "#B54708", bg: "#FFFAEB" },
  unavailable: { fg: "#B42318", bg: "#FEF3F2" },
  unsupported: { fg: "#475467", bg: "#F2F4F7" },
};

function EvidenceRow({ item, dark, validated }: { item: EvidenceItem; dark: boolean; validated: boolean }) {
  const [open, setOpen] = useState(false);
  const usable = !formatEvidenceValue(item).startsWith("Unavailable");
  const verified = validated && evidenceItemWellFormed(item) && item.status === "available" && usable;
  const knownStatus = typeof item.status === "string" && Object.prototype.hasOwnProperty.call(STATUS_LABEL, item.status) ? item.status : null;
  const status = knownStatus ? (verified ? STATUS_COLOR.available : knownStatus === "available" ? STATUS_COLOR.partial : STATUS_COLOR[knownStatus]) : STATUS_COLOR.unsupported;
  const statusLabel = verified ? "Verified" : knownStatus ? STATUS_LABEL[knownStatus] : "Unverified";
  const strong = dark ? "#F2F4F7" : "#101828";
  const muted = dark ? "#98A2B3" : "#667085";
  const border = dark ? "rgba(255,255,255,0.09)" : "#EAECF0";
  return (
    <div style={{ borderBottom: `1px solid ${border}`, padding: "10px 0" }}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full flex-wrap items-start gap-2 text-left"
        aria-expanded={open}
      >
        <div style={{ flex: "1 1 10rem", minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: "0.8rem", fontWeight: 600, color: strong, lineHeight: 1.4 }}>
            {textValue(item.label) || "Evidence record"}
          </p>
          <p style={{ margin: "2px 0 0", fontSize: "0.72rem", color: muted }}>
            {formatPeriod(item.period)} · {textValue(item.source) || "Source not supplied"}
          </p>
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-2">
          <span style={{ fontSize: "0.82rem", fontWeight: 700, color: strong, overflowWrap: "anywhere" }}>
            {formatEvidenceValue(item)}
          </span>
          <span style={{
            fontSize: "0.62rem", fontWeight: 700, color: status.fg, background: status.bg,
            padding: "2px 6px", borderRadius: 999, whiteSpace: "nowrap",
          }}>
            {statusLabel}
          </span>
        </div>
      </button>
      {open && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 5 }}>
          <p style={{ margin: 0, fontSize: "0.72rem", color: muted, lineHeight: 1.55 }}>
            <strong style={{ color: strong }}>What it measures.</strong> {textValue(item.definition) || "Not supplied"}
          </p>
          <p style={{ margin: 0, fontSize: "0.7rem", color: muted }}>
            <strong style={{ color: strong }}>Evidence ID.</strong> <code>{textValue(item.id) || "Not supplied"}</code>
          </p>
          {stringList(item.limitations).map((limitation) => (
            <p key={limitation} style={{ margin: 0, fontSize: "0.7rem", color: muted, lineHeight: 1.5 }}>
              <strong style={{ color: strong }}>Limitation.</strong> {limitation}
            </p>
          ))}
          {typeof item.currency === "string" && /^[A-Z]{3}$/.test(item.currency) && (
            <p style={{ margin: 0, fontSize: "0.7rem", color: muted }}>
              Currency supplied: {item.currency}. Values are shown separately by currency.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function EvidencePanel({
  evidence, facts, comparisonFacts, hypotheses, unknowns, recommendations, factsLabel = "Facts",
  dark = false, onClose, asSheet = false,
}: Props) {
  const strong = dark ? "#F2F4F7" : "#101828";
  const muted = dark ? "#98A2B3" : "#667085";
  const border = dark ? "rgba(255,255,255,0.09)" : "#EAECF0";
  const items = recordList<EvidenceItem>(evidence?.items);
  const comparisons = recordList<EvidenceItem>(evidence?.comparison_items);
  const state = evidenceState(evidence);
  const validated = validationSucceeded(evidence) && ["verified", "partial"].includes(state);
  const factRecords = recordList<RevFact>(facts).filter(fact => textValue(fact.text));
  const comparisonRecords = recordList<RevFact>(comparisonFacts).filter(fact => textValue(fact.text));
  const hypothesisRecords = recordList<RevHypothesis>(hypotheses).filter(item => textValue(item.statement));
  const recommendationRecords = recordList<RevRecommendation>(recommendations);
  const unknownRecords = stringList(unknowns);
  const knownIds = new Set([...items, ...comparisons].map(item => textValue(item.id)).filter(Boolean));
  const citations = (ids: unknown) => {
    const references = stringList(ids);
    return <p className="mt-1 text-xs" style={{ color: muted }}>
      {references.length ? references.map((id, index) => <span key={`${id}-${index}`}>
        {index > 0 ? ", " : "Evidence: "}<code>{id}</code>{knownIds.has(id) ? "" : " (record unavailable)"}
      </span>) : "No supporting evidence references supplied."}
    </p>;
  };
  const grouped = items.reduce<Record<string, EvidenceItem[]>>((acc, item) => {
    const key = textValue(item.metric).replace(/(_count|_value)$/, "").replace(/_/g, " ") || "Other evidence";
    acc[key] = acc[key] || [];
    acc[key].push(item);
    return acc;
  }, Object.create(null) as Record<string, EvidenceItem[]>);
  const coverage = (evidence?.coverage || {}) as Record<string, unknown>;
  const freshness = evidence?.freshness || {};
  const complete = coverage.complete === true;
  const storeCount = numericValue(coverage.store_count);
  const certifiedCount = numericValue(coverage.certified_store_count);

  return (
    <aside
      aria-label="Investigation evidence"
      style={{
        width: "100%",
        height: "100%",
        overflowY: "auto",
        overflowWrap: "anywhere",
        background: dark ? "#0F1420" : "#FFFFFF",
        borderLeft: asSheet ? "none" : `1px solid ${border}`,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <header className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: `1px solid ${border}`, position: "sticky", top: 0, background: dark ? "#0F1420" : "#FFF", zIndex: 1 }}>
        <Database size={15} color="#1F06AC" />
        <h2 style={{ margin: 0, fontSize: "0.9rem", fontWeight: 750, color: strong }}>
          Evidence
        </h2>
        <span style={{
          fontSize: "0.62rem", fontWeight: 700, color: dark ? "#b4a8ff" : "#1F06AC",
          background: "rgba(31,6,172,0.08)", padding: "2px 7px", borderRadius: 999,
        }}>
          {items.length + comparisons.length} record{items.length + comparisons.length === 1 ? "" : "s"}
        </span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close evidence"
            style={{ marginLeft: "auto", flexShrink: 0, minWidth: 44, minHeight: 44, display: "grid", placeItems: "center", color: muted, background: "transparent", border: "none", padding: 4, cursor: "pointer" }}
          >
            <X size={16} />
          </button>
        )}
      </header>

      <div className="flex flex-col gap-5 px-4 py-4">
        <div style={{
          border: `1px solid ${border}`, borderRadius: 10, padding: 12,
          background: dark ? "rgba(255,255,255,0.03)" : "#FAFAFB",
        }}>
          <div className="flex items-center gap-2">
            <ShieldCheck size={14} color={complete ? "#067647" : "#B54708"} />
            <span style={{ fontSize: "0.75rem", fontWeight: 700, color: strong }}>
              {complete ? "Coverage reported complete for this period" : storeCount !== null && storeCount > 0
                ? "Partial coverage — see limitations"
                : "Coverage not certified"}
            </span>
          </div>
          <p style={{ margin: "6px 0 0", fontSize: "0.7rem", color: muted, lineHeight: 1.55 }}>
            {storeCount !== null && certifiedCount !== null && Number.isInteger(storeCount) && Number.isInteger(certifiedCount) && certifiedCount >= 0 && certifiedCount <= storeCount
              ? `${certifiedCount} of ${storeCount} stores certify this reporting window.`
              : "No coverage certification was returned with this evidence."}
          </p>
          <p style={{ margin: "4px 0 0", fontSize: "0.7rem", color: muted }}>
            Data freshness: {textValue(freshness.state) || "unknown"}
            {freshness.as_of ? ` · last sync ${formatTimestamp(freshness.as_of)}` : ""}
          </p>
          <p className="mt-2 text-xs" style={{ color: strong }}>Evidence {state}.</p>
          {evidence?.validation && !evidence.validation.valid && (
            <p style={{ margin: "6px 0 0", fontSize: "0.7rem", color: "#B42318" }}>
              Validation reported: {stringList(evidence.validation.errors).join(", ") || "No successful validation supplied"}
            </p>
          )}
        </div>

        {comparisons.length > 0 ? (
          <section>
            <h3 style={{ margin: "0 0 2px", fontSize: "0.72rem", fontWeight: 750, color: muted, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Previous period (cited by comparisons)
            </h3>
            {comparisons.map((item, index) => <EvidenceRow key={`${textValue(item.id)}-${index}`} item={item} dark={dark} validated={validated} />)}
          </section>
        ) : null}

        {comparisonRecords.length > 0 && <section>
          <h3 className="text-xs font-semibold mb-2" style={{ color: muted }}>Comparison facts</h3>
          <p className="text-xs mb-2" style={{ color: muted }}>Arithmetic observations, not verified causes.</p>
          <ul className="list-disc pl-4">{comparisonRecords.map((fact, index) => <li key={index} className="text-sm mb-2" style={{ color: strong }}>
            {textValue(fact.text)}{citations(fact.evidence_ids)}
          </li>)}</ul>
        </section>}

        {factRecords.length ? (
          <section>
            <h3 style={{ margin: "0 0 6px", fontSize: "0.72rem", fontWeight: 750, color: muted, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {factsLabel === "Verified facts" && !validated ? "Facts — unverified" : factsLabel}
            </h3>
            <ul style={{ margin: 0, paddingLeft: 16, display: "flex", flexDirection: "column", gap: 6 }}>
              {factRecords.map((fact, index) => (
                <li key={index} style={{ fontSize: "0.78rem", color: strong, lineHeight: 1.55 }}>
                  {textValue(fact.text)}{citations(fact.evidence_ids)}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {Object.keys(grouped).length ? (
          <section>
            <h3 style={{ margin: "0 0 2px", fontSize: "0.72rem", fontWeight: 750, color: muted, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Evidence records
            </h3>
            {Object.entries(grouped).map(([group, groupItems]) => (
              <div key={group} style={{ marginTop: 8 }}>
                <p style={{ margin: "0 0 2px", fontSize: "0.68rem", color: muted, textTransform: "capitalize" }}>
                  {group}
                </p>
                {groupItems.map((item, index) => <EvidenceRow key={`${textValue(item.id)}-${index}`} item={item} dark={dark} validated={validated} />)}
              </div>
            ))}
          </section>
        ) : (
          <p style={{ fontSize: "0.78rem", color: muted, margin: 0 }}>
            No current-period evidence records were returned for this response.
          </p>
        )}

        {hypothesisRecords.length ? (
          <section>
            <h3 style={{ margin: "0 0 6px", fontSize: "0.72rem", fontWeight: 750, color: muted, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Hypotheses — not verified
            </h3>
            {hypothesisRecords.map((hypothesis, index) => (
              <p key={index} style={{
                margin: "0 0 6px", fontSize: "0.76rem", color: "#B54708", lineHeight: 1.55,
                background: "#FFFAEB", padding: "8px 10px", borderRadius: 8,
              }}>
                {textValue(hypothesis.statement)}
              </p>
            ))}
          </section>
        ) : null}

        {unknownRecords.length ? (
          <section>
            <h3 style={{ margin: "0 0 6px", fontSize: "0.72rem", fontWeight: 750, color: muted, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Unknowns and limits
            </h3>
            <ul style={{ margin: 0, paddingLeft: 16, display: "flex", flexDirection: "column", gap: 5 }}>
              {unknownRecords.map((unknown, index) => (
                <li key={index} style={{ fontSize: "0.76rem", color: muted, lineHeight: 1.55 }}>{unknown}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {recommendationRecords.length ? (
          <section>
            <h3 style={{ margin: "0 0 6px", fontSize: "0.72rem", fontWeight: 750, color: muted, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Recommended next steps
            </h3>
            {recommendationRecords.map((recommendation, index) => (
              <div key={index} style={{ marginBottom: 8 }}>
                <p style={{ margin: 0, fontSize: "0.78rem", fontWeight: 650, color: strong }}>
                  {textValue(recommendation.label)}
                </p>
                <p style={{ margin: "2px 0 0", fontSize: "0.72rem", color: muted, lineHeight: 1.5 }}>
                  {textValue(recommendation.why)}{textValue(recommendation.measure) ? ` Measure: ${recommendation.measure}` : ""}
                </p>
                <p style={{ margin: "2px 0 0", fontSize: "0.68rem", color: dark ? "#b4a8ff" : "#1F06AC" }}>
                  Recommendation only — nothing was changed.
                </p>
              </div>
            ))}
          </section>
        ) : null}

        {stringList(evidence?.limitations).length ? (
          <section>
            <h3 style={{ margin: "0 0 6px", fontSize: "0.72rem", fontWeight: 750, color: muted, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Source limitations
            </h3>
            <ul style={{ margin: 0, paddingLeft: 16, display: "flex", flexDirection: "column", gap: 4 }}>
              {stringList(evidence.limitations).map((limitation, index) => (
                <li key={index} style={{ fontSize: "0.72rem", color: muted, lineHeight: 1.5 }}>{limitation}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <p style={{ margin: "4px 0 16px", fontSize: "0.68rem", color: muted, lineHeight: 1.5 }}>
          Rev Intelligence is read-only. Evidence identifiers are stable and can be cited
          when reviewing a finding. Amounts are never combined across currencies.
        </p>
      </div>
    </aside>
  );
}

export default EvidencePanel;
