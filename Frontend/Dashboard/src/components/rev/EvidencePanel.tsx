import { useState } from "react";
import { ChevronDown, Database, ShieldCheck, X } from "lucide-react";
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
  hypotheses?: RevHypothesis[];
  unknowns?: string[];
  recommendations?: RevRecommendation[];
  factsLabel?: string;
  dark?: boolean;
  onClose?: () => void;
  asSheet?: boolean;
  focusEvidenceId?: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  available: "Verified",
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

function formatValue(item: EvidenceItem): string {
  if (item.value === null || item.value === undefined) return "—";
  if (item.unit === "currency") {
    const numeric = Number(item.value);
    const formatted = Number.isFinite(numeric)
      ? numeric.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : String(item.value);
    return `${item.currency} ${formatted}`;
  }
  if (item.unit === "ratio") return `${Math.round(Number(item.value) * 100)}%`;
  return String(item.value);
}

function EvidenceRow({ item, dark, defaultOpen = false }: { item: EvidenceItem; dark: boolean; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const status = STATUS_COLOR[item.status] || STATUS_COLOR.unsupported;
  const strong = dark ? "#F2F4F7" : "#101828";
  const muted = dark ? "#98A2B3" : "#667085";
  const border = dark ? "rgba(255,255,255,0.09)" : "#EAECF0";
  return (
    <div style={{ borderBottom: `1px solid ${border}`, padding: "10px 0" }}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-start gap-2 text-left"
        aria-expanded={open}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: "0.8rem", fontWeight: 600, color: strong, lineHeight: 1.4 }}>
            {item.label}
          </p>
          <p style={{ margin: "2px 0 0", fontSize: "0.72rem", color: muted }}>
            {item.period?.start?.slice(0, 10)} → {item.period?.end?.slice(0, 10)} · {item.source}
          </p>
        </div>
        <div className="flex items-center gap-2" style={{ flexShrink: 0 }}>
          <span style={{ fontSize: "0.82rem", fontWeight: 700, color: strong, whiteSpace: "nowrap" }}>
            {formatValue(item)}
          </span>
          <span style={{
            fontSize: "0.62rem", fontWeight: 700, color: status.fg, background: status.bg,
            padding: "2px 6px", borderRadius: 999, whiteSpace: "nowrap",
          }}>
            {STATUS_LABEL[item.status] || item.status}
          </span>
        </div>
      </button>
      {open && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 5 }}>
          <p style={{ margin: 0, fontSize: "0.72rem", color: muted, lineHeight: 1.55 }}>
            <strong style={{ color: strong }}>What it measures.</strong> {item.definition}
          </p>
          <p style={{ margin: 0, fontSize: "0.7rem", color: muted }}>
            <strong style={{ color: strong }}>Evidence ID.</strong> <code>{item.id}</code>
          </p>
          {(item.limitations || []).map((limitation) => (
            <p key={limitation} style={{ margin: 0, fontSize: "0.7rem", color: muted, lineHeight: 1.5 }}>
              <strong style={{ color: strong }}>Limitation.</strong> {limitation}
            </p>
          ))}
          {item.currency && (
            <p style={{ margin: 0, fontSize: "0.7rem", color: muted }}>
              Currency-explicit. Amounts in different currencies are never combined.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function EvidencePanel({
  evidence, facts, hypotheses, unknowns, recommendations, factsLabel = "Verified facts",
  dark = false, onClose, asSheet = false, focusEvidenceId = null,
}: Props) {
  const strong = dark ? "#F2F4F7" : "#101828";
  const muted = dark ? "#98A2B3" : "#667085";
  const border = dark ? "rgba(255,255,255,0.09)" : "#EAECF0";
  const items = evidence?.items ?? [];
  const orderedItems = focusEvidenceId
    ? [...items].sort((a, b) => Number(b.id === focusEvidenceId) - Number(a.id === focusEvidenceId))
    : items;
  const grouped = orderedItems.reduce<Record<string, EvidenceItem[]>>((acc, item) => {
    const key = item.metric.replace(/(_count|_value)$/, "").replace(/_/g, " ");
    acc[key] = acc[key] || [];
    acc[key].push(item);
    return acc;
  }, {});
  const coverage = (evidence?.coverage || {}) as Record<string, unknown>;
  const freshness = evidence?.freshness || {};
  const complete = coverage.complete === true;

  return (
    <aside
      aria-label="Investigation evidence"
      style={{
        width: "100%",
        height: "100%",
        overflowY: "auto",
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
          fontSize: "0.62rem", fontWeight: 700, color: "#1F06AC",
          background: "rgba(31,6,172,0.08)", padding: "2px 7px", borderRadius: 999,
        }}>
          {items.length} record{items.length === 1 ? "" : "s"}
        </span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close evidence"
            style={{ marginLeft: "auto", color: muted, background: "transparent", border: "none", padding: 4, cursor: "pointer" }}
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
              {complete ? "Coverage certified for this period" : coverage.store_count
                ? "Partial coverage — see limitations"
                : "Coverage not certified"}
            </span>
          </div>
          <p style={{ margin: "6px 0 0", fontSize: "0.7rem", color: muted, lineHeight: 1.55 }}>
            {typeof coverage.certified_store_count === "number"
              ? `${coverage.certified_store_count} of ${coverage.store_count ?? 0} stores certify this reporting window.`
              : "No coverage certification was returned with this evidence."}
          </p>
          <p style={{ margin: "4px 0 0", fontSize: "0.7rem", color: muted }}>
            Data freshness: {freshness.state ?? "unknown"}
            {freshness.as_of ? ` · last sync ${String(freshness.as_of).replace("T", " ").slice(0, 16)} UTC` : ""}
          </p>
          {evidence?.validation && !evidence.validation.valid && (
            <p style={{ margin: "6px 0 0", fontSize: "0.7rem", color: "#B42318" }}>
              Validation reported: {evidence.validation.errors.join(", ")}
            </p>
          )}
        </div>

        {(evidence?.comparison_items?.length ?? 0) > 0 ? (
          <section>
            <h3 style={{ margin: "0 0 2px", fontSize: "0.72rem", fontWeight: 750, color: muted, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Previous period (cited by comparisons)
            </h3>
            {(evidence?.comparison_items ?? []).map((item) => <EvidenceRow key={item.id} item={item} dark={dark} defaultOpen={item.id === focusEvidenceId} />)}
          </section>
        ) : null}

        {facts?.length ? (
          <section>
            <h3 style={{ margin: "0 0 6px", fontSize: "0.72rem", fontWeight: 750, color: muted, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {factsLabel}
            </h3>
            <ul style={{ margin: 0, paddingLeft: 16, display: "flex", flexDirection: "column", gap: 6 }}>
              {facts.map((fact, index) => (
                <li key={index} style={{ fontSize: "0.78rem", color: strong, lineHeight: 1.55 }}>
                  {fact.text}
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
                {groupItems.map((item) => <EvidenceRow key={item.id} item={item} dark={dark} defaultOpen={item.id === focusEvidenceId} />)}
              </div>
            ))}
          </section>
        ) : (
          <p style={{ fontSize: "0.78rem", color: muted, margin: 0 }}>
            No verified evidence records were returned for this response.
          </p>
        )}

        {hypotheses?.length ? (
          <section>
            <h3 style={{ margin: "0 0 6px", fontSize: "0.72rem", fontWeight: 750, color: muted, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Hypotheses — not verified
            </h3>
            {hypotheses.map((hypothesis, index) => (
              <p key={index} style={{
                margin: "0 0 6px", fontSize: "0.76rem", color: "#B54708", lineHeight: 1.55,
                background: "#FFFAEB", padding: "8px 10px", borderRadius: 8,
              }}>
                {hypothesis.statement}
              </p>
            ))}
          </section>
        ) : null}

        {unknowns?.length ? (
          <section>
            <h3 style={{ margin: "0 0 6px", fontSize: "0.72rem", fontWeight: 750, color: muted, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Unknowns and limits
            </h3>
            <ul style={{ margin: 0, paddingLeft: 16, display: "flex", flexDirection: "column", gap: 5 }}>
              {unknowns.map((unknown, index) => (
                <li key={index} style={{ fontSize: "0.76rem", color: muted, lineHeight: 1.55 }}>{unknown}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {recommendations?.length ? (
          <section>
            <h3 style={{ margin: "0 0 6px", fontSize: "0.72rem", fontWeight: 750, color: muted, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Recommended next steps
            </h3>
            {recommendations.map((recommendation, index) => (
              <div key={index} style={{ marginBottom: 8 }}>
                <p style={{ margin: 0, fontSize: "0.78rem", fontWeight: 650, color: strong }}>
                  {recommendation.label}
                </p>
                <p style={{ margin: "2px 0 0", fontSize: "0.72rem", color: muted, lineHeight: 1.5 }}>
                  {recommendation.why} Measure: {recommendation.measure}
                </p>
                <p style={{ margin: "2px 0 0", fontSize: "0.68rem", color: "#1F06AC" }}>
                  Recommendation only — nothing was changed.
                </p>
              </div>
            ))}
          </section>
        ) : null}

        {evidence?.limitations?.length ? (
          <section>
            <h3 style={{ margin: "0 0 6px", fontSize: "0.72rem", fontWeight: 750, color: muted, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Source limitations
            </h3>
            <ul style={{ margin: 0, paddingLeft: 16, display: "flex", flexDirection: "column", gap: 4 }}>
              {evidence.limitations.map((limitation, index) => (
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
