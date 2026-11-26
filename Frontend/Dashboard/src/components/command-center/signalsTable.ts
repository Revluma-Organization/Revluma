import type { Finding } from "./types";
import { categoryLabelFor, formatSourceLabel, isVerifiedFinding } from "./findingDisplay";

/**
 * Pure model for the Stage 4 signals table. Filtering, sorting, and tier
 * counts derive from the loaded findings payload only — no invented states,
 * no lifecycle tabs (findings expose no lifecycle status worth tabbing).
 */

export type SignalSeverityTier = "all" | "critical_high" | "medium" | "low";
export type SignalVerificationFilter = "all" | "verified" | "evidence_limited";
export type SignalSort = "priority" | "severity" | "detected";

/** Rows per signals-table page (Master: compact 6–8 row pages). */
export const SIGNALS_PAGE_SIZE = 6;

export const SIGNAL_TIERS: { id: Exclude<SignalSeverityTier, "all">; label: string }[] = [
  { id: "critical_high", label: "Critical & High" },
  { id: "medium", label: "Medium" },
  { id: "low", label: "Low" },
];

export function matchesSignalTier(
  severity: Finding["severity"],
  tier: SignalSeverityTier,
): boolean {
  if (tier === "all") return true;
  if (tier === "critical_high") return severity === "critical" || severity === "high";
  return severity === tier;
}

export function signalVerificationState(
  finding: Finding,
): Exclude<SignalVerificationFilter, "all"> {
  return isVerifiedFinding(finding) ? "verified" : "evidence_limited";
}

export function countBySignalTier(queue: Finding[]): {
  all: number;
  criticalHigh: number;
  medium: number;
  low: number;
} {
  const counts = { all: queue.length, criticalHigh: 0, medium: 0, low: 0 };
  for (const item of queue) {
    if (item.severity === "critical" || item.severity === "high") counts.criticalHigh += 1;
    else if (item.severity === "medium") counts.medium += 1;
    else counts.low += 1;
  }
  return counts;
}

/** Distinct category labels in first-appearance (backend) order. */
export function signalCategories(queue: Finding[]): string[] {
  const seen = new Set<string>();
  for (const item of queue) {
    const label = categoryLabelFor(item);
    if (!seen.has(label)) seen.add(label);
  }
  return [...seen];
}

export interface SignalFilterInput {
  tier: SignalSeverityTier;
  verification: SignalVerificationFilter;
  /** Category label, or "all". */
  category: string;
  query: string;
}

function searchableText(finding: Finding): string {
  return [finding.title, finding.description, categoryLabelFor(finding), formatSourceLabel(finding.evidence.source)]
    .join("\n")
    .toLowerCase();
}

export function filterSignals(queue: Finding[], input: SignalFilterInput): Finding[] {
  const query = input.query.trim().toLowerCase();
  return queue.filter((item) => {
    if (!matchesSignalTier(item.severity, input.tier)) return false;
    if (input.verification !== "all" && signalVerificationState(item) !== input.verification) {
      return false;
    }
    if (input.category !== "all" && categoryLabelFor(item) !== input.category) return false;
    if (query && !searchableText(item).includes(query)) return false;
    return true;
  });
}

const SEVERITY_RANK: Record<Finding["severity"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function detectedTimestamp(finding: Finding): number {
  const stamp = Date.parse(finding.detected_at || finding.last_verified_at || "");
  return Number.isNaN(stamp) ? Number.NEGATIVE_INFINITY : stamp;
}

/**
 * Stable sorts over the filtered rows. `priority` preserves backend order
 * exactly; ties in every other sort keep backend order (stable sort).
 */
export function sortSignals(rows: Finding[], sort: SignalSort): Finding[] {
  if (sort === "priority") return [...rows];
  const ranked = rows.map((item, index) => ({ item, index }));
  if (sort === "severity") {
    ranked.sort(
      (a, b) => SEVERITY_RANK[a.item.severity] - SEVERITY_RANK[b.item.severity] || a.index - b.index,
    );
  } else {
    ranked.sort((a, b) => detectedTimestamp(b.item) - detectedTimestamp(a.item) || a.index - b.index);
  }
  return ranked.map((entry) => entry.item);
}
