// Rev Intelligence: the commerce component catalog (ChatGPT-UI study §9,
// adoption R5).
//
// ChatGPT's "intelligent UI" lets the model emit whitelisted components
// (cards, charts, tables) that the client renders with its own design tokens,
// always with a plain-text fallback. Rev keeps the same idea with one hard
// rule from the conversation spec: a visual may only be built from records
// the turn actually retrieved. Nothing here asks the model for numbers. Every
// card is derived from `evidence.items` / `evidence.comparison_items`, and
// every chart is derived from a table the answer already printed.
//
// These functions are pure so the selection rules can be tested without a DOM.

import type { EvidenceItem, RevAnswerPayload } from "@/lib/revStream";
import {
  evidenceItemWellFormed, formatEvidenceValue, formatPeriod, numericValue, recordList,
  textValue, validationSucceeded,
} from "@/lib/revPresentation";
import { plainCellText } from "@/lib/revTableExport";

/** How much the merchant can lean on a card's number. Never upgraded. */
export type MetricTrust = "verified" | "partial" | "unverified";

export interface MetricChange {
  /** current - previous, in the metric's own unit. */
  absolute: number;
  /** (current - previous) / |previous|; null when previous is zero. */
  relative: number | null;
  direction: "up" | "down" | "flat";
  /** Formatted previous value, exactly as the ledger would print it. */
  previousText: string;
  previousValue: number;
  previousPeriod: string;
  previousId: string;
}

export interface MetricCard {
  id: string;
  metric: string;
  label: string;
  value: number;
  valueText: string;
  unit: EvidenceItem["unit"];
  currency: string | null;
  period: string;
  trust: MetricTrust;
  change: MetricChange | null;
}

/** Most cards a single answer shows. The rest stay in the evidence ledger. */
export const MAX_METRIC_CARDS = 4;

/** Ledger formatting, except ratios keep one decimal so a card matches the prose (3.1%, not 3%). */
function cardValueText(item: EvidenceItem, value: number): string {
  return item.unit === "ratio" ? `${Math.round(value * 1000) / 10}%` : formatEvidenceValue(item);
}

function usable(item: EvidenceItem): boolean {
  return !formatEvidenceValue(item).startsWith("Unavailable");
}

function trustOf(item: EvidenceItem, validated: boolean): MetricTrust {
  if (validated && evidenceItemWellFormed(item) && item.status === "available") return "verified";
  return item.status === "partial" ? "partial" : "unverified";
}

function sameMeasure(a: EvidenceItem, b: EvidenceItem): boolean {
  return textValue(a.metric) !== "" && a.metric === b.metric && a.unit === b.unit
    && (textValue(a.currency) || null) === (textValue(b.currency) || null);
}

/** Format a signed difference in the metric's own unit. */
export function formatChange(card: Pick<MetricCard, "unit" | "currency">, change: MetricChange): string {
  const sign = change.absolute > 0 ? "+" : change.absolute < 0 ? "-" : "";
  const magnitude = Math.abs(change.absolute);
  if (card.unit === "currency") {
    const amount = magnitude.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${sign}${card.currency ? `${card.currency} ` : ""}${amount}`;
  }
  if (card.unit === "ratio") return `${sign}${Math.round(magnitude * 1000) / 10} pts`;
  return `${sign}${magnitude.toLocaleString()}`;
}

export function formatRelative(change: MetricChange): string | null {
  if (change.relative === null || !Number.isFinite(change.relative)) return null;
  const pct = Math.abs(change.relative * 100);
  const rounded = pct >= 10 ? Math.round(pct) : Math.round(pct * 10) / 10;
  return `${change.relative > 0 ? "+" : change.relative < 0 ? "-" : ""}${rounded}%`;
}

/**
 * Metric cards for a finished, non-quiet turn.
 *
 * Shown only when they add something the prose and ledger do not: three or
 * more usable numbers, or any number with a matching previous-period record. A single
 * bare number is already in the sentence and gets no card (spec P2: plain
 * text by default, visuals only when they aid comprehension).
 */
export function deriveMetricCards(payload: RevAnswerPayload | undefined | null): MetricCard[] {
  if (!payload) return [];
  const validated = validationSucceeded(payload.evidence);
  const current = recordList<EvidenceItem>(payload.evidence?.items).filter(usable);
  const previous = recordList<EvidenceItem>(payload.evidence?.comparison_items).filter(usable);
  const seen = new Set<string>();
  const cards: MetricCard[] = [];
  for (const item of current) {
    const key = `${item.metric}|${item.currency ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const value = numericValue(item.value);
    if (value === null) continue;
    const match = previous.find(candidate => sameMeasure(item, candidate));
    const previousValue = match ? numericValue(match.value) : null;
    let change: MetricChange | null = null;
    if (match && previousValue !== null) {
      const absolute = value - previousValue;
      change = {
        absolute,
        relative: previousValue === 0 ? null : absolute / Math.abs(previousValue),
        direction: absolute > 0 ? "up" : absolute < 0 ? "down" : "flat",
        previousText: cardValueText(match, previousValue),
        previousValue,
        previousPeriod: formatPeriod(match.period),
        previousId: textValue(match.id),
      };
    }
    cards.push({
      id: textValue(item.id),
      metric: textValue(item.metric),
      label: textValue(item.label) || textValue(item.metric) || "Metric",
      value,
      valueText: cardValueText(item, value),
      unit: item.unit,
      currency: textValue(item.currency) || null,
      period: formatPeriod(item.period),
      trust: trustOf(item, validated),
      change,
    });
  }
  // Bare numbers already sit in the evidence ledger right below; a strip of
  // them earns its space only as an at-a-glance summary of three or more.
  const worthShowing = cards.length >= 3 || cards.some(card => card.change !== null);
  return worthShowing ? cards.slice(0, MAX_METRIC_CARDS) : [];
}

/** One sentence per card for screen readers and the copy text. */
export function describeMetricCard(card: MetricCard): string {
  const base = `${card.label}: ${card.valueText}`;
  if (!card.change) return `${base}.`;
  if (card.change.direction === "flat") return `${base}, unchanged from ${card.change.previousText} in the previous period.`;
  const relative = formatRelative(card.change);
  return `${base}, ${card.change.direction} ${formatChange(card, card.change).replace(/^[+-]/, "")}${relative ? ` (${relative.replace(/^[+-]/, "")})` : ""} from ${card.change.previousText} in the previous period.`;
}

// ── Table charts ────────────────────────────────────────────────────────────

export interface TableChartSeries {
  /** Column index in the source table. */
  column: number;
  label: string;
}

export interface TableChartSpec {
  kind: "bar" | "line";
  labelColumn: number;
  categoryLabel: string;
  series: TableChartSeries[];
  rows: Array<{ label: string; values: Array<number | null> }>;
}

/** Most categories a bar chart shows before a table reads faster (skill: ≤15). */
export const MAX_CHART_ROWS = 15;

const TIME_LABEL = /^(?:\d{4}-\d{2}(?:-\d{2})?|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*(?:\s+\d{1,4})?(?:,?\s+\d{4})?|(?:week|wk|q[1-4]|day)\b.*)$/i;

/** A cell that is a single number, optionally with a currency code, symbol, % or unit word. */
export function chartCellNumber(cell: string): number | null {
  const text = plainCellText(cell).trim();
  if (!text || /^(?:n\/a|na|unavailable|unknown|-|—)$/i.test(text)) return null;
  const match = text.match(/^(?:[A-Z]{3}\s*)?[$€£₦¥]?\s*(-?\d[\d,]*(?:\.\d+)?)\s*(?:%|[A-Z]{3}|[a-z]{1,12})?$/);
  if (!match) return null;
  const value = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

/**
 * Decide whether a markdown table can honestly become a chart.
 *
 * Needs a text label column, at least one column where every row is a single
 * number, and 2 - 15 rows. Labels that read as dates or periods become a line
 * chart in source order; anything else becomes a bar chart (the renderer
 * sorts it descending). Returns null when a chart would mislead or add
 * nothing.
 */
export function tableChartSpec(rows: string[][]): TableChartSpec | null {
  const [head, ...body] = rows;
  if (!head || head.length < 2 || body.length < 2 || body.length > MAX_CHART_ROWS) return null;
  const width = head.length;
  if (body.some(row => row.length < width)) return null;
  const numericColumns: number[] = [];
  for (let col = 0; col < width; col += 1) {
    if (body.every(row => chartCellNumber(row[col] ?? "") !== null)) numericColumns.push(col);
  }
  const labelColumn = [...Array(width).keys()].find(col => !numericColumns.includes(col)
    && body.every(row => plainCellText(row[col] ?? "").trim() !== ""));
  if (labelColumn === undefined || numericColumns.length === 0) return null;
  const labels = body.map(row => plainCellText(row[labelColumn]).trim());
  if (new Set(labels).size !== labels.length) return null;
  const series = numericColumns.slice(0, 3).map(column => ({ column, label: plainCellText(head[column]).trim() || `Column ${column + 1}` }));
  const timeLike = labels.length >= 3 && labels.every(label => TIME_LABEL.test(label));
  return {
    kind: timeLike ? "line" : "bar",
    labelColumn,
    categoryLabel: plainCellText(head[labelColumn]).trim() || "Category",
    series,
    rows: body.map((row, index) => ({
      label: labels[index],
      values: series.map(entry => chartCellNumber(row[entry.column] ?? "")),
    })),
  };
}

/** A one-line text alternative for a chart (skill: chart needs a text summary). */
export function describeTableChart(spec: TableChartSpec, seriesIndex = 0): string {
  const entry = spec.series[seriesIndex];
  if (!entry) return "";
  const points = spec.rows
    .map(row => ({ label: row.label, value: row.values[seriesIndex] }))
    .filter((point): point is { label: string; value: number } => point.value !== null);
  if (!points.length) return "";
  if (spec.kind === "line") {
    const first = points[0];
    const last = points[points.length - 1];
    return `${entry.label} by ${spec.categoryLabel.toLowerCase()}, from ${first.value.toLocaleString()} (${first.label}) to ${last.value.toLocaleString()} (${last.label}).`;
  }
  const sorted = [...points].sort((a, b) => b.value - a.value);
  const top = sorted[0];
  const bottom = sorted[sorted.length - 1];
  return `${entry.label} by ${spec.categoryLabel.toLowerCase()}. Highest: ${top.label} (${top.value.toLocaleString()}). Lowest: ${bottom.label} (${bottom.value.toLocaleString()}).`;
}
