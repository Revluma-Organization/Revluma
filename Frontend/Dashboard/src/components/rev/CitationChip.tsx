import { useEffect, useId, useRef, useState } from "react";
import { revTokens, type RevTone } from "@/lib/revTokens";
import {
  formatEvidenceValue, formatPeriod, stringList, textValue,
} from "@/lib/revPresentation";
import type { EvidenceItem } from "@/lib/revStream";

/**
 * Evidence citation with a hover/focus preview (ChatGPT-UI study §5
 * "Citations": claim-adjacent chip → preview popover → full sources panel).
 * Rev already had the chip and the panel; this adds the middle layer so a
 * merchant can verify a claim without leaving the sentence.
 *
 * Hard rules, mirroring the evidence contract:
 * - The preview renders ONLY fields present on the retrieved EvidenceItem —
 *   an unavailable value reads "Not supplied", never an estimate or a guess.
 * - A citation whose id does not resolve to a retrieved record is never
 *   rendered as a chip by the caller; this component additionally refuses to
 *   open a preview without an item.
 * - Click behaviour is unchanged: it still opens the evidence panel focused
 *   on this record. The preview is additive, never a replacement.
 * - Dependency-free hover card (state-driven, not CSS-only) so the preview
 *   content exists in the DOM only while open — screen readers get a
 *   role="tooltip" tied to the chip with aria-describedby, and keyboard
 *   focus opens the same preview the pointer does.
 */

interface Props {
  /** Position of this citation in the answer's cited-evidence list (1-based). */
  number: number;
  item: EvidenceItem;
  tone: RevTone;
  variant: "marker" | "source";
  onOpen?: (evidenceId: string) => void;
}

function PreviewRow({ label, value, t }: { label: string; value: string; t: ReturnType<typeof revTokens> }) {
  return (
    <p style={{ margin: 0, fontSize: "0.68rem", lineHeight: 1.5, color: t.muted }}>
      <strong style={{ color: t.strong, fontWeight: 650 }}>{label}.</strong> {value}
    </p>
  );
}

export function CitationChip({ number, item, tone, variant, onOpen }: Props) {
  const t = revTokens(tone);
  const [open, setOpen] = useState(false);
  const tooltipId = useId();
  const closeTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
  }, []);

  const openPreview = () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    setOpen(true);
  };
  // A small close delay lets the pointer travel into the preview itself
  // without it vanishing mid-read (the same grace ChatGPT's hover cards use).
  const scheduleClose = () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 120);
  };

  const id = textValue(item.id);
  const label = textValue(item.label) || textValue(item.metric) || "Evidence record";
  const limitations = stringList(item.limitations).filter(Boolean).slice(0, 2);
  const source = textValue(item.source);
  const definition = textValue(item.definition);
  const period = item.period?.start ? formatPeriod(item.period) : "";
  const value = formatEvidenceValue(item);

  const chipStyle = variant === "marker"
    ? {
        fontSize: "0.62rem", fontWeight: 700, lineHeight: 1, marginLeft: 5,
        color: t.accentFg, background: t.accentSoft,
        border: `1px solid ${t.accentBorder}`, borderRadius: 6,
        padding: "2px 5px", verticalAlign: "baseline" as const,
        cursor: onOpen ? "pointer" : "default",
      }
    : {
        fontSize: "0.7rem", color: t.accentFg, background: "transparent",
        border: "none", padding: 0, cursor: onOpen ? "pointer" : "default",
        textDecoration: "underline" as const, textUnderlineOffset: 2,
      };

  return (
    <span
      style={{ position: "relative", display: variant === "marker" ? "inline" : "inline-flex", alignItems: "center" }}
      onMouseEnter={openPreview}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        onClick={() => onOpen?.(id)}
        onFocus={openPreview}
        onBlur={scheduleClose}
        onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}
        aria-label={
          variant === "marker"
            ? `Citation ${number}: ${label} — open evidence`
            : `Open evidence: ${label}`
        }
        aria-describedby={open ? tooltipId : undefined}
        style={chipStyle}
      >
        {variant === "marker"
          ? number
          : <><span aria-hidden="true" style={{ fontWeight: 750, marginRight: 3 }}>{number}.</span>{label}</>}
      </button>
      {open && (
        <span
          id={tooltipId}
          role="tooltip"
          onMouseEnter={openPreview}
          onMouseLeave={scheduleClose}
          data-rev-citation-preview
          style={{
            position: "absolute", bottom: "calc(100% + 6px)", left: 0, zIndex: 30,
            width: "min(280px, 78vw)", display: "flex", flexDirection: "column", gap: 4,
            padding: "10px 12px", borderRadius: 10,
            background: t.overlay, border: `1px solid ${t.border}`, boxShadow: t.shadow,
            textAlign: "left",
          }}
        >
          <span style={{ margin: 0, fontSize: "0.74rem", fontWeight: 700, color: t.strong, lineHeight: 1.35 }}>
            {label}
          </span>
          <span style={{ fontSize: "0.78rem", fontWeight: 700, color: t.strong, overflowWrap: "anywhere" }}>
            {value}
          </span>
          <PreviewRow label="Source" value={source || "Not supplied"} t={t} />
          {period ? <PreviewRow label="Period" value={period} t={t} /> : null}
          {definition ? <PreviewRow label="Measures" value={definition} t={t} /> : null}
          {limitations.map(limitation => (
            <PreviewRow key={limitation} label="Limitation" value={limitation} t={t} />
          ))}
        </span>
      )}
    </span>
  );
}

export default CitationChip;
