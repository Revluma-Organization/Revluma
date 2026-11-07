import type {
  EvidenceItem, EvidencePeriod, RevAnswerConfidence,
  RevAnswerPayload, RevClaimConfidence, RevCoverageSummary,
  RevConfidenceCategory, RevResponseSection,
} from "./revStream";

export const textValue = (value: unknown): string => typeof value === "string" ? value : "";
export const stringList = (value: unknown): string[] => Array.isArray(value)
  ? value.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim())) : [];
export const recordList = <T extends object>(value: unknown): T[] => Array.isArray(value)
  ? value.filter((entry): entry is T => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry)) : [];
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : {};

/** Both gateway response formats are retained; no evidence is certified here. */
export function normaliseRevAnswer(value: unknown): RevAnswerPayload | undefined {
  let parsed = value;
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed); } catch { return undefined; }
  }
  const outer = record(parsed);
  if (!["text", "response_type", "response", "situation", "insight", "implication", "recommendation", "evidence", "facts", "comparison_facts", "investigation"].some(key => key in outer)) return undefined;
  const nested = record(outer.response);
  const response = { ...outer, ...nested } as Partial<NonNullable<RevAnswerPayload["response"]>>;
  return {
    ...nested, ...outer,
    response_type: textValue(outer.response_type) || "analysis",
    read_only: true,
    text: textValue(outer.text) || textValue(nested.text),
    response: {
      situation: textValue(nested.situation) || textValue(outer.situation),
      insight: textValue(nested.insight) || textValue(outer.insight),
      implication: textValue(nested.implication) || textValue(outer.implication),
      recommendation: textValue(nested.recommendation) || textValue(outer.recommendation),
      confidence: response.confidence,
      // Task 210: the backend's ordered sections are carried verbatim and
      // validated at render time (answerSections), never re-ordered here.
      sections: response.sections,
      warnings: stringList(nested.warnings),
    },
  };
}

// ── Task 210: adaptive answer structure & evidence-derived confidence ───────
// The frontend renders only what the backend derived from recorded evidence.
// Malformed or legacy-shaped values are hidden, never adapted into invented
// certainty (the same no-fabrication discipline as the evidence state).

const CONFIDENCE_CATEGORIES: readonly RevConfidenceCategory[] =
  ["high", "moderate", "limited", "insufficient"];
const COVERAGE_STATES = ["no_data", "partial", "complete", "unknown"] as const;
const PERCENTAGE = /\d+(\.\d+)?\s*%/;

/**
 * The backend's ordered composable sections, kept in the exact order given.
 * A section with an empty id/label/text is dropped (no section may render
 * empty); a duplicated id keeps its first occurrence only.
 */
export function answerSections(
  value?: RevAnswerPayload["response"] | null,
): RevResponseSection[] {
  const raw = record(value as unknown).sections;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const sections: RevResponseSection[] = [];
  for (const entry of raw) {
    const item = record(entry);
    const id = textValue(item.id);
    const label = textValue(item.label).trim();
    const text = textValue(item.text).trim();
    if (!id || !label || !text || seen.has(id)) continue;
    seen.add(id);
    sections.push({ id, label, text });
  }
  return sections;
}

function validCoverage(value: unknown): RevCoverageSummary | undefined {
  const cov = record(value);
  if (!COVERAGE_STATES.includes(cov.coverage as (typeof COVERAGE_STATES)[number])) return undefined;
  if (typeof cov.currency_comparable !== "boolean" || typeof cov.certified !== "boolean") return undefined;
  if (typeof cov.freshness !== "string" || !cov.freshness.trim()) return undefined;
  const window = record(cov.window);
  return {
    window: {
      label: textValue(window.label) || null,
      start: textValue(window.start) || null,
      end: textValue(window.end) || null,
      timezone: textValue(window.timezone) || null,
    },
    coverage: cov.coverage as RevCoverageSummary["coverage"],
    freshness: cov.freshness,
    currency_comparable: cov.currency_comparable,
    certified: cov.certified,
    limits: stringList(cov.limits),
  };
}

/**
 * The evidence-derived confidence contract. Returns `undefined` — the
 * renderer then shows nothing — for a legacy numeric `{ score, basis }`
 * shape, a malformed object, or a communication that carries a percentage
 * (a number in confidence is exactly what this contract forbids).
 */
export function answerConfidence(
  value?: RevAnswerPayload["response"] | null,
): RevAnswerConfidence | undefined {
  const confidence = record(value as unknown).confidence;
  const entry = record(confidence);
  if (!CONFIDENCE_CATEGORIES.includes(entry.category as RevConfidenceCategory)) return undefined;
  const communication = textValue(entry.communication).trim();
  if (!communication || PERCENTAGE.test(communication)) return undefined;
  const claims: Record<string, RevClaimConfidence> = {};
  for (const [claimId, rawClaim] of Object.entries(record(entry.claims))) {
    const claim = record(rawClaim);
    if (!CONFIDENCE_CATEGORIES.includes(claim.category as RevConfidenceCategory)) return undefined;
    claims[claimId] = {
      category: claim.category as RevConfidenceCategory,
      basis: stringList(claim.basis),
      limitations: stringList(claim.limitations),
    };
  }
  // A malformed coverage block hides only the "How I checked" disclosure;
  // the (separate) communication sentence still renders when it is clean.
  const coverage = validCoverage(entry.coverage);
  return {
    category: entry.category as RevConfidenceCategory,
    claims,
    coverage,
    communication,
  };
}

/**
 * Merchant copy for the coverage representation, kept separate from
 * confidence (spec 5.D: "coverage is not confidence"). Rendered in the
 * "How I checked" disclosure, never inline with the answer.
 */
export function coverageDisclosure(
  coverage: RevCoverageSummary,
): { summary: string; limits: string[] } {
  const state = coverage.coverage.replace("_", " ");
  const summary = [
    `Coverage: ${state}`,
    `Freshness: ${coverage.freshness}`,
    `Currencies comparable: ${coverage.currency_comparable ? "yes" : "no"}`,
    `Order coverage certified: ${coverage.certified ? "yes" : "no"}`,
  ].join(" · ");
  return { summary, limits: coverage.limits };
}

// Deduplicate only matching content, never infer that a summary covers a section.
export const comparableText = (value: string): string => value.toLowerCase().replace(/\*\*|__|`/g, "").replace(/\s+/g, " ").trim();
export function coveredBy(body: string, value: string): boolean {
  const normalise = (text: string) => comparableText(text).replace(/\s+([.!?])/g, "$1").replace(/\.$/, "").trim();
  const candidate = normalise(value);
  if (!candidate) return false;
  const blocks = [body];
  const sentences = (text: string) => {
    const chunks = text.split(/([.!?])\s+/);
    return chunks.filter((_chunk, index) => index % 2 === 0).map((chunk, index) => chunk + (chunks[index * 2 + 1] || ""));
  };
  const paragraphs: string[] = [];
  let pending: string[] = [];
  const flush = () => { if (pending.length) paragraphs.push(pending.join(" ")); pending = []; };
  for (const original of body.split("\n")) {
    if (!original.trim()) { flush(); continue; }
    const heading = original.match(/^\s*#{1,6}\s+(.*)$/);
    if (heading) { flush(); paragraphs.push(heading[1]); continue; }
    const entry = original.match(/^\s*(?:[-*+]\s+|\d+[.)]\s+)(.*)$/);
    if (entry) { flush(); pending.push(entry[1]); }
    else pending.push(original.trim());
  }
  flush();
  for (const line of paragraphs) {
    blocks.push(line);
    // The backend's numbered recommendations use a bold label and an em dash.
    // Recognise those explicit fields, without treating arbitrary substrings
    // (including statements within a negation) as independent claims.
    const recommendation = line.match(/^\*\*([^*]+)\*\*\s*[—–]\s*(.*)$/);
    if (recommendation) blocks.push(recommendation[1], recommendation[2]);
    blocks.push(...sentences(line));
    if (recommendation) blocks.push(...sentences(recommendation[2]).map(sentence => sentence.replace(/^Measure:\s*/, "")));
  }
  return blocks.some(block => normalise(block) === candidate);
}

export function numericValue(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim()))) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function formatEvidenceValue(item: EvidenceItem): string {
  if (!["available", "partial"].includes(item.status)) return "Unavailable";
  const numeric = numericValue(item.value);
  if (numeric === null) return "Unavailable";
  if (item.unit === "currency") {
    if (typeof item.currency !== "string" || !/^[A-Z]{3}$/.test(item.currency)) return "Unavailable (currency missing or invalid)";
    return `${item.currency} ${numeric.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (item.unit === "ratio") return Number.isFinite(numeric * 100) ? `${Math.round(numeric * 100)}%` : "Unavailable";
  return item.unit === "count" && Number.isInteger(numeric) && numeric >= 0 ? String(numeric) : "Unavailable";
}

export type EvidenceState = "verified" | "partial" | "unverified" | "unavailable";
export function validationSucceeded(evidence?: RevAnswerPayload["evidence"]): boolean {
  return evidence?.validation?.valid === true && Array.isArray(evidence.validation.errors) && evidence.validation.errors.length === 0;
}
export function evidenceItemWellFormed(item: EvidenceItem): boolean {
  return [item.id, item.metric, item.label, item.source, item.definition, item.period?.start, item.period?.end]
    .every(value => typeof value === "string" && Boolean(value.trim()))
    && validTimestamp(item.period?.start) && validTimestamp(item.period?.end);
}
export function evidenceState(evidence?: RevAnswerPayload["evidence"]): EvidenceState {
  const collections = [evidence?.items, evidence?.comparison_items];
  const malformed = collections.some((collection, index) => {
    // comparison_items is optional; items is required by the evidence contract.
    if (index === 1 && collection === undefined) return false;
    return !Array.isArray(collection) || collection.some(entry => !entry || typeof entry !== "object" || Array.isArray(entry));
  });
  const items = [...recordList<EvidenceItem>(evidence?.items), ...recordList<EvidenceItem>(evidence?.comparison_items)];
  const usable = items.filter(item => !formatEvidenceValue(item).startsWith("Unavailable"));
  if (!usable.length) return "unavailable";
  if (malformed || !validationSucceeded(evidence) || items.some(item => !evidenceItemWellFormed(item))
    || new Set(items.map(item => item.id)).size !== items.length) return "unverified";
  return usable.length !== items.length || items.some(item => item.status !== "available") || evidence?.coverage?.complete === false ? "partial" : "verified";
}

function validTimestamp(value: unknown): boolean {
  const text = textValue(value);
  return /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(text)
    && Number.isFinite(Date.parse(text))
    && new Date(`${text.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) === text.slice(0, 10);
}
export function formatTimestamp(value: unknown): string {
  const text = textValue(value);
  if (!validTimestamp(text)) return "Not supplied or invalid";
  return text.replace("T", " ") + (text.includes("T") && !/(?:Z|[+-]\d{2}:\d{2})$/.test(text) ? " (timezone not supplied)" : "");
}

/** Human day-level date for a period bound; "" when the value must keep raw fidelity. */
function humanDate(value: unknown): string {
  const text = textValue(value);
  if (!validTimestamp(text)) return "";
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text);
  // Only re-format values with an explicit UTC basis (date-only or Z-suffixed).
  // Offset or naive timestamps keep formatTimestamp's raw fidelity contract:
  // never imply a conversion that was not made.
  if (!dateOnly && !/Z$/.test(text)) return "";
  const parsed = new Date(dateOnly ? `${text}T00:00:00Z` : text);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "UTC",
  });
}

export function formatPeriod(period?: EvidencePeriod): string {
  // Interval semantics ("[start, end)") are engineering notation, never
  // merchant copy (spec §8): not rendered whatever the payload supplies.
  const timezone = textValue(period?.timezone);
  const start = humanDate(period?.start);
  const end = humanDate(period?.end);
  if (start && end) {
    return `${start} → ${end}${timezone ? ` (${timezone})` : " (timezone not supplied)"}`;
  }
  const bounds = `${formatTimestamp(period?.start)} → ${formatTimestamp(period?.end)}`;
  if (timezone) return `${bounds} (${timezone})`;
  return bounds.includes("timezone not supplied") ? bounds : `${bounds} (timezone not supplied)`;
}

/**
 * Adapt a legacy RevResponse object (persisted turns from before the
 * normalized payload contract) into the shared answer schema, so one renderer
 * presents every turn. Confidence is carried but never badged: the presentation
 * layer decides, and badge discipline (spec P5) hides uncalibrated scores.
 */
export function legacyResponseToPayload(value: unknown): RevAnswerPayload {
  const record = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const pick = (key: string) => textValue(record[key]);
  const response: Record<string, unknown> = {};
  for (const key of ["situation", "insight", "implication", "recommendation"] as const) {
    const text = pick(key);
    if (text) response[key] = text;
  }
  const confidence = record.confidence as { score?: unknown; basis?: unknown } | undefined;
  if (typeof confidence?.score === "number" && Number.isFinite(confidence.score)) {
    response.confidence = { score: confidence.score, basis: textValue(confidence.basis) };
  }
  const warnings = stringList(record.warnings);
  if (warnings.length) response.warnings = warnings;
  return {
    read_only: true,
    response_type: pick("response_type") || "analysis",
    text: pick("text"),
    response: Object.keys(response).length
      ? response as NonNullable<RevAnswerPayload["response"]>
      : undefined,
  };
}
