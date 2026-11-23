import type {
  BriefingAssessmentState,
  BriefingDataQualityState,
  CommandCenterData,
  EvidenceResource,
  FeaturedIntelligenceEmptyState,
  FeaturedIntelligenceItem,
  Finding,
  RecentDevelopmentItem,
  RecentDevelopmentLifecycle,
} from "@/components/command-center/types";
import type { CommandCenterFailure } from "./commandCenterError";

export type OperationalBriefingTone = "neutral" | "positive" | "attention" | "progress" | "negative";

export interface ResolvedBriefingTimestamp {
  label: string;
  exactTitle: string | null;
  iso: string | null;
  previousLabel: string | null;
}

export interface ResolvedBriefingAssessment {
  state: BriefingAssessmentState;
  label: string;
  tone: OperationalBriefingTone;
  dataQuality: BriefingDataQualityState;
  dataQualityLabel: string;
  dataQualityTone: OperationalBriefingTone;
  headline: string;
  summary: string;
  noFindingsNote: string | null;
  primaryAction: {
    kind: "review_priority" | "review_integration" | "explore_evidence";
    label: string;
    href: string;
    isAnchor: boolean;
  } | null;
}

export interface ResolvedFeaturedEmptyCopy {
  state: FeaturedIntelligenceEmptyState;
  statusLabel: string;
  headline: string;
  explanation: string;
  clarification: string | null;
  canRetry: boolean;
  actionHref: string | null;
  actionLabel: string | null;
}

export interface ResolvedFeaturedIntelligence {
  status: "qualified" | "empty";
  item: FeaturedIntelligenceItem | null;
  empty: ResolvedFeaturedEmptyCopy | null;
}

export interface ResolvedDevelopmentEntry {
  id: string;
  category: string;
  lifecycle: RecentDevelopmentLifecycle;
  lifecycleLabel: string;
  title: string;
  explanation: string;
  occurredAt: string;
  timeLabel: string;
  exactTimeTitle: string | null;
  route: string | null;
  actionLabel: string | null;
}

export interface ResolvedRecentDevelopments {
  items: ResolvedDevelopmentEntry[];
  emptyHeadline: string | null;
  emptyExplanation: string | null;
}

export interface ResolvedEvidenceCategory {
  id: string;
  name: string;
  statusLabel: string;
  tone: OperationalBriefingTone;
  freshnessDetail: string;
  coverageDetail: string | null;
  merchantNote: string | null;
  rawResourceKey: string;
}

export interface ResolvedBriefingContext {
  reportingPeriodLabel: string;
  comparisonPeriodLabel: string | null;
  timezone: string;
  categories: ResolvedEvidenceCategory[];
  merchantLimitations: string[];
  missingEvidenceNotes: string[];
  unknownSemantics: string;
  technicalReferences: { label: string; value: string }[];
  summaryPreview: string;
}

export interface ResolvedOperationalBriefing {
  timestamp: ResolvedBriefingTimestamp;
  assessment: ResolvedBriefingAssessment;
  featured: ResolvedFeaturedIntelligence;
  developments: ResolvedRecentDevelopments;
  context: ResolvedBriefingContext;
}

const DISCONNECTED_STATES = new Set([
  "disconnected",
  "authorization_required",
  "authorization_expired",
  "authorization_revoked",
]);

const FINDING_EVIDENCE_SUMMARY: Record<string, string> = {
  revenue_change: "Completed order revenue across comparable reporting periods.",
  order_volume_change: "Completed order volume across comparable reporting periods.",
  refund_increase: "Recorded refund transactions and order adjustment history.",
  returning_customer_change: "Verified returning-buyer records across comparable periods.",
  integration_failure: "Store authorization and synchronization status records.",
};

const FINDING_WHY_IT_MATTERS: Record<string, string> = {
  revenue_change:
    "A verified revenue shift helps narrow where to look across order volume, pricing, or product mix.",
  order_volume_change:
    "Order volume movement can point to shifts in product demand, storefront availability, or checkout conversion.",
  refund_increase:
    "Rising refund value can indicate product, fulfillment, or expectation issues worth examining early.",
  returning_customer_change:
    "Changes in returning-buyer share affect repeat revenue stability over time.",
  integration_failure:
    "Resolving data access or synchronization issues restores complete business visibility.",
};

const RESOURCE_FRIENDLY_NAMES: Record<string, string> = {
  orders: "Orders",
  "order.refunds": "Refunds",
  refunds: "Refunds",
  products: "Products",
  "inventory.levels": "Inventory",
  inventory: "Inventory",
  customers: "Customers",
  "abandoned-checkouts": "Abandoned checkouts",
  abandoned_checkouts: "Abandoned checkouts",
  fulfillments: "Fulfillments",
  "store.policies": "Store policies",
  legal_policies: "Store policies",
};

function isValidTimezone(tz: string | null | undefined): tz is string {
  if (!tz || typeof tz !== "string" || !tz.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz.trim() });
    return true;
  } catch {
    return false;
  }
}

function parseDate(value: string | null | undefined): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function formatExactDateTime(date: Date, timezone: string | null): string {
  const options: Intl.DateTimeFormatOptions = {
    dateStyle: "medium",
    timeStyle: "short",
    ...(isValidTimezone(timezone) ? { timeZone: timezone } : {}),
  };
  try {
    return new Intl.DateTimeFormat("en-US", options).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  }
}

function formatEditorialTime(date: Date, now: Date, timezone: string | null): string {
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 60_000) return "Just now";
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return mins === 1 ? "1 minute ago" : `${mins} minutes ago`;

  const dayKey = (d: Date) => {
    try {
      return new Intl.DateTimeFormat("en-CA", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        ...(isValidTimezone(timezone) ? { timeZone: timezone } : {}),
      }).format(d);
    } catch {
      return d.toISOString().slice(0, 10);
    }
  };

  if (dayKey(date) === dayKey(now)) {
    const hours = Math.floor(mins / 60);
    return hours <= 3 ? (hours === 1 ? "1 hour ago" : `${hours} hours ago`) : "Earlier today";
  }

  const yesterday = new Date(now.getTime() - 24 * 3600_000);
  if (dayKey(date) === dayKey(yesterday)) {
    return "Yesterday";
  }

  const days = Math.floor(diffMs / (24 * 3600_000));
  if (days < 7) return `${days} days ago`;

  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      ...(isValidTimezone(timezone) ? { timeZone: timezone } : {}),
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/**
 * Translate raw permission / scope / sync technical strings into clear,
 * calm, merchant-friendly explanations without leaking internal identifiers.
 */
export function translateLimitationToMerchantCopy(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  const lower = trimmed.toLowerCase();

  if (lower.includes("read_legal_policies") || lower.includes("legal_policies")) {
    return "We cannot currently review your store policies because the required access has not been granted.";
  }
  if (lower.includes("read_inventory") || (lower.includes("inventory") && (lower.includes("missing_scope") || lower.includes("permission")))) {
    return "We cannot currently review your inventory availability because the required Shopify access has not been granted.";
  }
  if (lower.includes("read_orders") || (lower.includes("orders") && lower.includes("missing_scope"))) {
    return "We cannot currently review your full order history because the required Shopify access has not been granted.";
  }
  if (lower.includes("read_products") || (lower.includes("products") && lower.includes("missing_scope"))) {
    return "We cannot currently review your product catalog because the required Shopify access has not been granted.";
  }
  if (lower.includes("read_customers") || (lower.includes("customers") && lower.includes("missing_scope"))) {
    return "We cannot currently review your customer records because the required Shopify access has not been granted.";
  }
  if (lower.includes("read_checkouts") || (lower.includes("checkout") && lower.includes("missing_scope"))) {
    return "We cannot currently review abandoned checkout records because the required Shopify access has not been granted.";
  }
  if (lower.includes("missing_scope") || lower.includes("missing app scope")) {
    return "Some store areas cannot be reviewed yet because the required Shopify permissions have not been granted.";
  }
  if (lower.includes("sync_failed") || lower.includes("retrieval_failed")) {
    return "One or more store data sources did not finish updating during the latest refresh.";
  }
  if (lower.includes("never_synchronized") || lower.includes("not_synchronized")) {
    return "Some store records have not been retrieved yet and are excluded from current conclusions.";
  }

  // Clean up any stray underscore-formatted identifiers in otherwise human sentences
  return trimmed.replace(/\b([a-z]+_[a-z_]+)\b/g, (token) => token.replaceAll("_", " "));
}

function friendlyResourceName(resource: EvidenceResource): string {
  const key = resource.resource.toLowerCase();
  if (RESOURCE_FRIENDLY_NAMES[key]) return RESOURCE_FRIENDLY_NAMES[key];
  const label = (resource.label || resource.resource).trim();
  const normalized = label.replaceAll(".", " ").replaceAll("_", " ").replaceAll("-", " ");
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function resolveTimezone(data: CommandCenterData): string {
  const candidates = [
    data.context.store?.iana_timezone,
    data.business_health?.reporting_period?.timezone,
    data.context.reporting_period?.timezone,
  ];
  for (const tz of candidates) {
    if (isValidTimezone(tz)) return tz.trim();
  }
  return "UTC";
}

function resolveBriefingTimestamp(
  data: CommandCenterData,
  timezone: string,
  now: Date,
): ResolvedBriefingTimestamp {
  // Strictly use authoritative briefing generation timestamp — NEVER conflate
  // with last_successful_sync_at or retrieved_at.
  const generatedIso =
    data.briefing.generated_at ??
    data.business_state.generated_at ??
    data.evidence.snapshot_generated_at ??
    null;
  const generatedDate = parseDate(generatedIso);

  const previousIso = data.briefing.previous_generated_at ?? null;
  const previousDate = parseDate(previousIso);

  if (!generatedDate) {
    return {
      label: "Briefing time unavailable",
      exactTitle: null,
      iso: null,
      previousLabel: previousDate ? formatExactDateTime(previousDate, timezone) : null,
    };
  }

  const relative = formatEditorialTime(generatedDate, now, timezone);
  const exact = formatExactDateTime(generatedDate, timezone);
  return {
    label: `Briefing updated ${relative.toLowerCase() === "just now" ? "just now" : relative.toLowerCase()}`,
    exactTitle: `Briefing generated ${exact} (${timezone})`,
    iso: generatedDate.toISOString(),
    previousLabel: previousDate ? `${formatExactDateTime(previousDate, timezone)} (${timezone})` : null,
  };
}

function assessmentTone(state: BriefingAssessmentState): OperationalBriefingTone {
  switch (state) {
    case "important_development":
    case "attention_needed":
      return "attention";
    case "investigating":
      return "progress";
    case "unavailable":
      return "negative";
    case "normal":
    case "insufficient_evidence":
    default:
      return "neutral";
  }
}

function dataQualityTone(quality: BriefingDataQualityState): OperationalBriefingTone {
  switch (quality) {
    case "verified":
      return "positive";
    case "syncing":
      return "progress";
    case "stale":
    case "partial":
      return "attention";
    case "unavailable":
      return "negative";
    case "insufficient":
    default:
      return "neutral";
  }
}

function featuredEmptyCopy(state: FeaturedIntelligenceEmptyState): ResolvedFeaturedEmptyCopy {
  switch (state) {
    case "no_new_findings":
      return {
        state,
        statusLabel: "No new findings",
        headline: "Nothing new requires highlighting right now.",
        explanation:
          "Revluma hasn't identified a new development that meets its criteria for a featured business insight.",
        clarification:
          "This doesn't necessarily mean there are no issues in your business. It means no new sufficiently supported finding qualifies for this section.",
        canRetry: false,
        actionHref: null,
        actionLabel: null,
      };
    case "insufficient_evidence":
      return {
        state,
        statusLabel: "Insufficient evidence",
        headline: "We don't yet have enough evidence to highlight a reliable business finding.",
        explanation:
          "Required store evidence is incomplete or unavailable, so Revluma is withholding featured conclusions rather than guessing.",
        clarification:
          "Review your store connection and permissions in Integrations to expand verified coverage.",
        canRetry: false,
        actionHref: "/dashboard/integrations",
        actionLabel: "Review Integrations",
      };
    case "investigation_running":
      return {
        state,
        statusLabel: "Examining evidence",
        headline: "Revluma is examining the available business evidence.",
        explanation:
          "Store data synchronization is currently in progress. Featured discoveries will appear once verified records are ready.",
        clarification:
          "No findings are assumed or fabricated while synchronization is underway.",
        canRetry: false,
        actionHref: null,
        actionLabel: null,
      };
    case "generation_failed":
      return {
        state,
        statusLabel: "Briefing unavailable",
        headline: "We couldn't prepare your intelligence briefing. Please try again.",
        explanation:
          "The latest briefing run did not complete. Revluma is not presenting unverified or partial guesses as current intelligence.",
        clarification: null,
        canRetry: true,
        actionHref: null,
        actionLabel: null,
      };
    case "no_previous_briefing":
      return {
        state,
        statusLabel: "First briefing",
        headline: "Your first intelligence briefing is being established.",
        explanation:
          "No previous briefing is on record for this store yet, so newly surfaced discoveries and period-to-period comparisons are still building.",
        clarification:
          "As verified store evidence accumulates, qualifying developments will be highlighted here.",
        canRetry: false,
        actionHref: null,
        actionLabel: null,
      };
  }
}

function fallbackFeaturedIntelligence(
  data: CommandCenterData,
  failure: CommandCenterFailure | null,
  now: Date,
): ResolvedFeaturedIntelligence {
  const status = data.business_state.presentation_status;
  const integrationStatus = data.integration?.overall_status ?? null;

  if (status === "failed" || (failure && !data.business_state.id)) {
    return { status: "empty", item: null, empty: featuredEmptyCopy("generation_failed") };
  }
  if (integrationStatus === "synchronizing") {
    return { status: "empty", item: null, empty: featuredEmptyCopy("investigation_running") };
  }

  const priorityId = data.priority_finding?.id ?? null;
  const previousIso = data.briefing.previous_generated_at ?? null;
  const previousDate = parseDate(previousIso);

  const candidates = (data.findings || []).filter(
    (f: Finding) =>
      f.id !== priorityId &&
      !f.lifecycle?.invalidated &&
      f.confidence?.classification !== "insufficient_evidence" &&
      f.confidence?.classification !== "unable_to_determine",
  );

  const isNew = (detectedAt: string): boolean => {
    const d = parseDate(detectedAt);
    if (!d) return false;
    if (previousDate) return d.getTime() > previousDate.getTime();
    return now.getTime() - d.getTime() <= 24 * 3600_000;
  };

  const newlyDetected = candidates.filter((f) => isNew(f.detected_at));
  const selected = newlyDetected[0] ?? candidates[0] ?? null;

  if (selected) {
    const isVerified =
      selected.evidence?.classification === "verified_observation" &&
      ["high", "moderate"].includes(selected.confidence?.classification);
    return {
      status: "qualified",
      empty: null,
      item: {
        id: `featured:${selected.id}`,
        finding_id: selected.id,
        title: selected.title,
        explanation: selected.description,
        why_it_matters:
          selected.recommendation?.rationale ?? FINDING_WHY_IT_MATTERS[selected.type] ?? null,
        evidence_summary:
          FINDING_EVIDENCE_SUMMARY[selected.type] ??
          `Verified ${selected.evidence.source.replaceAll("_", " ")} records.`,
        verification_status: isVerified ? "verified" : "hypothesis",
        confidence: selected.confidence.classification,
        severity: selected.severity,
        category: selected.category,
        detected_at: selected.detected_at,
        last_verified_at: selected.last_verified_at,
        is_new: isNew(selected.detected_at),
        action_label: "Examine supporting evidence",
        action_route: selected.investigation.route,
        references: selected.evidence.references ?? [],
      },
    };
  }

  if (integrationStatus && DISCONNECTED_STATES.has(integrationStatus)) {
    return { status: "empty", item: null, empty: featuredEmptyCopy("insufficient_evidence") };
  }
  if (status === "unavailable" || status === "unknown") {
    const noPrev = data.briefing.has_previous_briefing === false && integrationStatus === "connected";
    return {
      status: "empty",
      item: null,
      empty: featuredEmptyCopy(noPrev ? "no_previous_briefing" : "insufficient_evidence"),
    };
  }
  return { status: "empty", item: null, empty: featuredEmptyCopy("no_new_findings") };
}

function lifecycleLabel(lifecycle: RecentDevelopmentLifecycle): string {
  switch (lifecycle) {
    case "new":
      return "New";
    case "resolved":
      return "Resolved";
    case "ongoing":
    default:
      return "Ongoing";
  }
}

function resolveRecentDevelopments(
  data: CommandCenterData,
  featuredFindingId: string | null,
  timezone: string,
  now: Date,
): ResolvedRecentDevelopments {
  const backendDevs = data.briefing.recent_developments;
  const priorityId = data.priority_finding?.id ?? null;

  let rawItems: RecentDevelopmentItem[] = [];
  let emptyState: "no_changes" | "no_previous_briefing" | null = null;

  if (backendDevs) {
    rawItems = backendDevs.items.filter(
      (item) =>
        item.finding_id !== priorityId &&
        item.finding_id !== featuredFindingId,
    );
    emptyState = rawItems.length === 0 ? (backendDevs.empty_state ?? "no_changes") : null;
  } else {
    const previousDate = parseDate(data.briefing.previous_generated_at);
    const derived: RecentDevelopmentItem[] = [];
    for (const f of data.findings || []) {
      if (f.id === priorityId || f.id === featuredFindingId) continue;
      const detected = parseDate(f.detected_at);
      const isNew = detected
        ? previousDate
          ? detected.getTime() > previousDate.getTime()
          : now.getTime() - detected.getTime() <= 24 * 3600_000
        : false;
      derived.push({
        id: `dev-finding:${f.id}`,
        category: "finding",
        lifecycle: isNew ? "new" : "ongoing",
        title: f.title,
        explanation: f.description,
        occurred_at: f.detected_at,
        finding_id: f.id,
        route: f.investigation.route,
        action_label: "Examine finding",
      });
    }
    rawItems = derived.slice(0, 6);
    if (rawItems.length === 0) {
      emptyState =
        data.briefing.has_previous_briefing === false ? "no_previous_briefing" : "no_changes";
    }
  }

  const items: ResolvedDevelopmentEntry[] = rawItems.map((item) => {
    const date = parseDate(item.occurred_at);
    return {
      id: item.id,
      category: item.category,
      lifecycle: item.lifecycle,
      lifecycleLabel: lifecycleLabel(item.lifecycle),
      title: item.title,
      explanation: item.explanation,
      occurredAt: item.occurred_at,
      timeLabel: date ? formatEditorialTime(date, now, timezone) : "Time unavailable",
      exactTimeTitle: date ? `${formatExactDateTime(date, timezone)} (${timezone})` : null,
      route: item.route,
      actionLabel: item.action_label,
    };
  });

  if (items.length > 0) {
    return { items, emptyHeadline: null, emptyExplanation: null };
  }

  if (emptyState === "no_previous_briefing") {
    return {
      items: [],
      emptyHeadline: "No previous briefing is on record yet.",
      emptyExplanation:
        "Meaningful changes and ongoing developments will appear here as future briefings are prepared.",
    };
  }

  return {
    items: [],
    emptyHeadline: "Nothing significant has changed since your last briefing.",
    emptyExplanation:
      "This timeline is up to date based on the latest verified store evidence.",
  };
}

function resolveAssessment(
  data: CommandCenterData,
  featured: ResolvedFeaturedIntelligence,
): ResolvedBriefingAssessment {
  const hasPriority = Boolean(data.priority_finding);
  const status = data.business_state.presentation_status;
  const integrationStatus = data.integration?.overall_status ?? null;

  let state: BriefingAssessmentState;
  let label: string;
  let dataQuality: BriefingDataQualityState;
  let dataQualityLabel: string;

  if (data.briefing.assessment) {
    state = data.briefing.assessment.state;
    label = data.briefing.assessment.label;
    dataQuality = data.briefing.assessment.data_quality;
    dataQualityLabel = data.briefing.assessment.data_quality_label;
  } else {
    // Independent data-quality axis (never collapsed with business severity)
    if (integrationStatus === "synchronizing") {
      dataQuality = "syncing";
      dataQualityLabel = "Evidence syncing";
    } else if (status === "failed") {
      dataQuality = "unavailable";
      dataQualityLabel = "Evidence unavailable";
    } else if (
      (integrationStatus && DISCONNECTED_STATES.has(integrationStatus)) ||
      status === "unavailable" ||
      status === "unknown"
    ) {
      dataQuality = "insufficient";
      dataQualityLabel = "Insufficient evidence";
    } else if (status === "stale") {
      dataQuality = "stale";
      dataQualityLabel = "Evidence stale";
    } else if (status === "partial" || integrationStatus === "limited_access" || integrationStatus === "sync_partial") {
      dataQuality = "partial";
      dataQualityLabel = "Evidence partial";
    } else {
      dataQuality = "verified";
      dataQualityLabel = "Evidence verified";
    }

    // Independent business-assessment axis
    if (status === "failed") {
      state = "unavailable";
      label = "Briefing unavailable";
    } else if (integrationStatus === "synchronizing") {
      state = "investigating";
      label = "Preparing briefing";
    } else if (
      (integrationStatus && DISCONNECTED_STATES.has(integrationStatus)) ||
      status === "unavailable" ||
      status === "unknown"
    ) {
      state = "insufficient_evidence";
      label = "Insufficient evidence";
    } else if (
      (data.priority_finding && ["critical", "high"].includes(data.priority_finding.severity)) ||
      featured.status === "qualified"
    ) {
      state = "important_development";
      label = "Development detected";
    } else if (
      data.priority_finding ||
      status === "stale" ||
      data.integration?.merchant_action_required ||
      integrationStatus === "sync_failed" ||
      integrationStatus === "needs_attention"
    ) {
      state = "attention_needed";
      label = "Attention needed";
    } else {
      state = "normal";
      label = "No major issue established";
    }
  }

  // Avoid duplicating the Top Priority finding's title as the briefing headline
  // when a priority finding is already presented directly below.
  const headline = hasPriority
    ? "There are developments in your store that deserve closer attention."
    : data.briefing.headline;
  const summary = hasPriority
    ? "Revluma has surfaced a verified priority from current store evidence. Review the broader context below or jump straight to the top priority."
    : data.briefing.summary;

  let primaryAction: ResolvedBriefingAssessment["primaryAction"] = null;
  if (hasPriority) {
    primaryAction = {
      kind: "review_priority",
      label: "Review priority",
      href: "#priority-finding",
      isAnchor: true,
    };
  } else if (data.briefing.next_investigation?.route) {
    const next = data.briefing.next_investigation;
    primaryAction = {
      kind: next.kind === "review_integration" ? "review_integration" : "explore_evidence",
      label: next.label,
      href: next.route,
      isAnchor: false,
    };
  }

  return {
    state,
    label,
    tone: assessmentTone(state),
    dataQuality,
    dataQualityLabel,
    dataQualityTone: dataQualityTone(dataQuality),
    headline,
    summary,
    noFindingsNote: !hasPriority ? data.briefing.no_findings_note : null,
    primaryAction,
  };
}

function resolveEvidenceContext(
  data: CommandCenterData,
  timezone: string,
  now: Date,
): ResolvedBriefingContext {
  const resources = data.evidence.resources ?? [];
  const categories: ResolvedEvidenceCategory[] = resources.map((res) => {
    const name = friendlyResourceName(res);
    const lastSuccess = parseDate(res.last_success_at);
    const freshnessDetail = lastSuccess
      ? `Updated ${formatEditorialTime(lastSuccess, now, timezone).toLowerCase()}`
      : res.availability === "not_synchronized"
        ? "Not yet synchronized"
        : "Update time not recorded";

    let statusLabel = "Available";
    let tone: OperationalBriefingTone = "positive";
    let merchantNote: string | null = null;

    switch (res.availability) {
      case "available":
        statusLabel = "Verified";
        tone = "positive";
        break;
      case "stale":
        statusLabel = "May be out of date";
        tone = "attention";
        merchantNote = "Showing the last verified records rather than current activity.";
        break;
      case "partial":
        statusLabel = "Partially available";
        tone = "attention";
        merchantNote = "Only part of this data category has been verified.";
        break;
      case "unauthorized":
        statusLabel = "Access not granted";
        tone = "attention";
        merchantNote = `We cannot currently review your ${name.toLowerCase()} because the required Shopify access has not been granted.`;
        break;
      case "not_synchronized":
        statusLabel = "Not synchronized";
        tone = "neutral";
        merchantNote = `${name} have not been retrieved yet.`;
        break;
      case "retrieval_failed":
        statusLabel = "Update failed";
        tone = "negative";
        merchantNote = `The latest update for ${name.toLowerCase()} did not complete.`;
        break;
      case "unsupported":
        statusLabel = "Not supported";
        tone = "neutral";
        merchantNote = `${name} are not currently provided by this store connection.`;
        break;
      default:
        statusLabel = "Not verified";
        tone = "neutral";
        merchantNote = res.reason ? translateLimitationToMerchantCopy(res.reason) : null;
        break;
    }

    const coverageDetail =
      res.coverage === "complete"
        ? "Complete coverage"
        : res.coverage === "partial" || res.coverage === "incomplete"
          ? "Partial coverage"
          : null;

    return {
      id: `${res.store_id}:${res.resource}`,
      name,
      statusLabel,
      tone,
      freshnessDetail,
      coverageDetail,
      merchantNote,
      rawResourceKey: res.resource,
    };
  });

  const missingEvidenceNotes = categories
    .filter((cat) => cat.merchantNote !== null)
    .map((cat) => cat.merchantNote as string);

  const rawLimitations = [
    ...(data.briefing.limitations ?? []),
    ...(data.evidence.limitations ?? []),
    ...(data.business_state.warnings ?? []),
  ];
  const merchantLimitations = Array.from(
    new Set(
      rawLimitations
        .map((item) => translateLimitationToMerchantCopy(item))
        .filter(Boolean),
    ),
  );

  const reportingPeriodLabel =
    data.context.reporting_period?.label ??
    data.context.reporting_period?.kind?.replaceAll("_", " ") ??
    "Current reporting window";
  const comparisonPeriodLabel =
    data.context.comparison_period?.comparability === "unavailable"
      ? null
      : (data.context.comparison_period?.label ?? null);

  const technicalReferences: { label: string; value: string }[] = [];
  if (data.business_state.id) {
    technicalReferences.push({ label: "Snapshot ID", value: data.business_state.id });
  }
  if (data.business_state.version) {
    technicalReferences.push({ label: "Schema version", value: data.business_state.version });
  }
  if (data.briefing.generated_from?.finding_id) {
    technicalReferences.push({
      label: "Primary finding ID",
      value: data.briefing.generated_from.finding_id,
    });
  }
  if (data.context.store?.id) {
    technicalReferences.push({ label: "Store ID", value: data.context.store.id });
  }
  if (resources.length > 0) {
    technicalReferences.push({
      label: "Source keys",
      value: resources.map((r) => `${r.resource} (${r.sync_state})`).join(", "),
    });
  }

  const verifiedCount = categories.filter((c) => c.tone === "positive").length;
  const sourceWord = categories.length === 1 ? "source" : "sources";
  const summaryPreview =
    categories.length > 0
      ? `${verifiedCount} of ${categories.length} ${sourceWord} verified · ${reportingPeriodLabel}`
      : reportingPeriodLabel;

  return {
    reportingPeriodLabel,
    comparisonPeriodLabel,
    timezone,
    categories,
    merchantLimitations,
    missingEvidenceNotes,
    unknownSemantics:
      "Missing or unverified information is never treated as zero or assumed to be healthy.",
    technicalReferences,
    summaryPreview,
  };
}

export function resolveOperationalBriefing(
  data: CommandCenterData,
  options: { failure?: CommandCenterFailure | null; now?: Date } = {},
): ResolvedOperationalBriefing {
  const now = options.now ?? new Date();
  const failure = options.failure ?? null;
  const timezone = resolveTimezone(data);
  const timestamp = resolveBriefingTimestamp(data, timezone, now);

  let featured: ResolvedFeaturedIntelligence;
  if (data.briefing.featured_intelligence) {
    const fi = data.briefing.featured_intelligence;
    if (fi.status === "qualified" && fi.item) {
      featured = { status: "qualified", item: fi.item, empty: null };
    } else {
      featured = {
        status: "empty",
        item: null,
        empty: featuredEmptyCopy(fi.empty_state ?? "no_new_findings"),
      };
    }
  } else {
    featured = fallbackFeaturedIntelligence(data, failure, now);
  }

  const assessment = resolveAssessment(data, featured);
  const developments = resolveRecentDevelopments(
    data,
    featured.item?.finding_id ?? null,
    timezone,
    now,
  );
  const context = resolveEvidenceContext(data, timezone, now);

  return { timestamp, assessment, featured, developments, context };
}
