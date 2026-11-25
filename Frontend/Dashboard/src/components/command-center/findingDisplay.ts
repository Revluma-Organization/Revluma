import { AlertTriangle, Eye, Gauge, Siren } from "lucide-react";
import type { CommandCenterAppState } from "./StateBadge";
import type { Finding, SignalCategoryId } from "./types";

/**
 * Shared finding display helpers for the minimal priority card and its
 * full-details side drawer. Pure formatting/severity logic only, no JSX, so
 * both surfaces stay consistent without import cycles.
 */

export const SIGNAL_CATEGORY_LABELS: Record<SignalCategoryId, string> = {
  storefront_readiness: "Storefront readiness",
  traffic_acquisition: "Traffic & acquisition",
  sales_revenue: "Sales & revenue",
  conversion_purchasing: "Conversion & purchasing",
  product_inventory: "Product & inventory",
  customer_fulfillment: "Customer & fulfillment",
};

export const money = (value: number, currency: string) => {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
  } catch {
    return `${value} ${currency}`;
  }
};

export const dateTime = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(value),
      )
    : "Not recorded";

export const relativeTime = (value: string | null) => {
  if (!value) return "Recently";
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "Recently";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  const days = Math.floor(minutes / 1440);
  if (days === 1) return "Yesterday";
  return `${days}d ago`;
};

export type Observation = Finding["evidence"]["observations"][number];

export function observationText(item: Observation): string {
  if (item.value === null || item.availability !== "available") return "Unavailable";
  if (item.unit === "money" && typeof item.value === "number" && item.currency) {
    return money(item.value, item.currency);
  }
  if (item.unit === "count" || item.unit === "status") {
    return `${item.value}`;
  }
  if (item.unit === "percent" && typeof item.value === "number") {
    return `${item.value}%`;
  }
  return `${item.value} ${item.unit}`;
}

export function isVerifiedFinding(finding: Finding): boolean {
  return (
    finding.evidence?.classification === "verified_observation" &&
    ["high", "moderate"].includes(finding.confidence?.classification)
  );
}

export function findingEvidenceAppState(finding: Finding): CommandCenterAppState {
  if (finding.evidence_freshness.state === "stale") return "stale";
  if (finding.coverage.state === "partial" || finding.coverage.state === "incomplete") {
    return "partial";
  }
  if (finding.evidence_freshness.state === "fresh" && finding.coverage.complete) {
    return "current";
  }
  return "unavailable";
}

export function formatSourceLabel(source: string): string {
  return source.replaceAll("_", " ");
}

export function categoryLabelFor(finding: Finding): string {
  return finding.signal_category
    ? SIGNAL_CATEGORY_LABELS[finding.signal_category]
    : formatSourceLabel(finding.evidence.source);
}

export function confidenceTextFor(finding: Finding): string {
  return `${finding.confidence.classification.replaceAll("_", " ")} confidence`;
}

export function confidenceLabelFor(finding: Finding): string {
  const text = finding.confidence.classification.replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Evidence window derived from the finding's real reporting period dates,
 * e.g. "7d window". Null when the period bounds are absent or invalid, in
 * which case the card omits the window chip instead of inventing one.
 */
export function evidenceWindowLabelFor(finding: Finding): string | null {
  const { current_start, current_end } = finding.reporting_period;
  if (!current_start || !current_end) return null;
  const start = new Date(current_start).getTime();
  const end = new Date(current_end).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  const days = Math.round((end - start) / 86_400_000);
  if (!Number.isFinite(days) || days <= 0) return null;
  return `${days}d window`;
}

export function periodLabelFor(finding: Finding): string {
  return `${finding.reporting_period.kind.replaceAll("_", " ")} · ${finding.reporting_period.timezone}`;
}

export function verificationLabelFor(finding: Finding, isPrimary: boolean): string {
  const verified = isVerifiedFinding(finding);
  if (isPrimary) return verified ? "Verified finding" : "Evidence-limited";
  return verified ? "Ongoing" : "Evidence-limited";
}

export interface SeverityMeta {
  label: string;
  longLabel: string;
  base: string;
  deep: string;
  softBg: string;
  border: string;
  glowRgba: string;
  frameFrom: string;
  impactBars: number;
  Icon: typeof Siren;
}

export function getSeverityMeta(severity: Finding["severity"]): SeverityMeta {
  if (severity === "critical") {
    return {
      label: "Critical",
      longLabel: "Critical priority",
      base: "#E5484D",
      deep: "#A12A22",
      softBg: "#FFF5F4",
      border: "#F3C7C3",
      glowRgba: "rgba(229, 72, 77, 0.16)",
      frameFrom: "rgba(229, 72, 77, 0.55)",
      impactBars: 3,
      Icon: Siren,
    };
  }
  if (severity === "high") {
    return {
      label: "High",
      longLabel: "High priority",
      base: "#F07832",
      deep: "#9A4A12",
      softBg: "#FFF6F0",
      border: "#F5D3B8",
      glowRgba: "rgba(240, 120, 50, 0.16)",
      frameFrom: "rgba(240, 120, 50, 0.55)",
      impactBars: 3,
      Icon: AlertTriangle,
    };
  }
  if (severity === "medium") {
    return {
      label: "Medium",
      longLabel: "Medium priority",
      base: "#E5A126",
      deep: "#925B13",
      softBg: "#FFFDF4",
      border: "#F2DDB8",
      glowRgba: "rgba(229, 161, 38, 0.18)",
      frameFrom: "rgba(229, 161, 38, 0.6)",
      impactBars: 2,
      Icon: Gauge,
    };
  }
  return {
    label: "Low",
    longLabel: "Low priority",
    base: "#6475E8",
    deep: "#39449F",
    softBg: "#F4F6FF",
    border: "#D8D7FA",
    glowRgba: "rgba(100, 117, 232, 0.16)",
    frameFrom: "rgba(100, 117, 232, 0.55)",
    impactBars: 1,
    Icon: Eye,
  };
}
