import type { CommandCenterData, StoreSummary } from "@/components/command-center/types";
import type { IntegrationStateName } from "@/lib/integrationState";

export type ReportingPeriodKey = "7d" | "14d" | "30d";

export interface ReportingPeriodOption {
  value: ReportingPeriodKey;
  days: 7 | 14 | 30;
  label: string;
  comparisonLabel: string;
}

export const REPORTING_PERIOD_OPTIONS: readonly ReportingPeriodOption[] = [
  { value: "7d", days: 7, label: "Last 7 days", comparisonLabel: "vs. previous 7 days" },
  { value: "14d", days: 14, label: "Last 14 days", comparisonLabel: "vs. previous 14 days" },
  { value: "30d", days: 30, label: "Last 30 days", comparisonLabel: "vs. previous 30 days" },
] as const;

export type ConnectionTone = "positive" | "progress" | "warning" | "negative" | "neutral";

export interface ConciseConnectionStatus {
  label: string;
  tone: ConnectionTone;
  description: string;
  needsAttention: boolean;
  actionHref: string | null;
}

export interface TimezoneDisplay {
  iana: string;
  short: string;
  label: string;
  verified: boolean;
}

export interface ResolvedReportingContext {
  periodKey: ReportingPeriodKey;
  periodLabel: string;
  dateRangeLabel: string | null;
  timezone: TimezoneDisplay;
  /** Compact human-readable readout for headers and subtitles. */
  summaryLabel: string;
}

export interface ResolvedLastUpdate {
  label: string;
  title: string | null;
  timestamp: string | null;
}

const PERIOD_LABELS: Record<string, string> = {
  last_7_days: "Last 7 days",
  last_14_days: "Last 14 days",
  last_30_days: "Last 30 days",
  previous_7_days: "Previous 7 days",
  previous_14_days: "Previous 14 days",
  previous_30_days: "Previous 30 days",
  current_and_previous_utc_day: "Today & yesterday",
  current_utc_day: "Today",
  previous_utc_day: "Yesterday",
  equal_length_utc_windows: "Comparable period",
};

export function periodKeyFromKind(kind: string | null | undefined, days?: number | null): ReportingPeriodKey {
  if (days === 14 || kind === "last_14_days" || kind === "14d") return "14d";
  if (days === 30 || kind === "last_30_days" || kind === "30d") return "30d";
  return "7d";
}

export function formatPeriodLabel(kind: string | null | undefined, explicitLabel?: string | null): string {
  if (explicitLabel && explicitLabel.trim()) return explicitLabel.trim();
  if (!kind) return "Last 7 days";
  if (PERIOD_LABELS[kind]) return PERIOD_LABELS[kind];
  const cleaned = kind.replaceAll("_", " ").trim();
  return cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : "Last 7 days";
}

function isValidIanaTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function formatTimezoneDisplay(
  rawTimezone: string | null | undefined,
  verified: boolean,
  referenceDate: Date = new Date(),
): TimezoneDisplay {
  const candidate = typeof rawTimezone === "string" && rawTimezone.trim() ? rawTimezone.trim() : "UTC";
  const iana = isValidIanaTimezone(candidate) ? candidate : "UTC";

  if (iana === "UTC" || iana === "Etc/UTC") {
    return { iana: "UTC", short: "UTC", label: "UTC", verified };
  }

  let short = iana;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: iana,
      timeZoneName: "short",
    }).formatToParts(referenceDate);
    short = parts.find((part) => part.type === "timeZoneName")?.value || iana;
  } catch {
    short = iana;
  }

  const citySegment = iana.split("/").pop()?.replaceAll("_", " ") || iana;
  const label = short && short !== citySegment && !short.includes("/")
    ? `${citySegment} (${short})`
    : citySegment;

  return { iana, short, label, verified };
}

export function formatDateRangeInTimezone(
  startIso: string | null | undefined,
  endIso: string | null | undefined,
  ianaTimezone: string,
): string | null {
  if (!startIso || !endIso) return null;
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return null;
  const tz = isValidIanaTimezone(ianaTimezone) ? ianaTimezone : "UTC";
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      timeZone: tz,
    });
    const a = fmt.format(start);
    const b = fmt.format(end);
    return a === b ? a : `${a} – ${b}`;
  } catch {
    return null;
  }
}

export function formatTimestampInTimezone(
  value: string | null | undefined,
  ianaTimezone: string,
): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const tz = isValidIanaTimezone(ianaTimezone) ? ianaTimezone : "UTC";
  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: tz,
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  }
}

/**
 * Resolves ONE consistent reporting period and verified Shopify store timezone
 * across the entire Business Overview page so the header, briefing, and
 * business health sections never disagree on timeframe or timezone.
 */
export function resolveReportingContext(
  data: CommandCenterData | null,
  selectedPeriodOverride?: ReportingPeriodKey,
): ResolvedReportingContext {
  const healthPeriod = data?.business_health?.reporting_period ?? null;
  const contextPeriod = data?.context?.reporting_period ?? null;
  const storeTimezone = data?.context?.store?.iana_timezone ?? null;

  const rawTimezone =
    healthPeriod?.timezone ||
    storeTimezone ||
    contextPeriod?.timezone ||
    "UTC";

  const verified = Boolean(
    contextPeriod?.timezone_verified === true ||
    (storeTimezone && storeTimezone !== "UTC") ||
    (healthPeriod?.timezone && healthPeriod.timezone !== "UTC"),
  );

  const referenceIso = healthPeriod?.current?.end || contextPeriod?.end || data?.retrieved_at || null;
  const referenceDate = referenceIso && Number.isFinite(Date.parse(referenceIso))
    ? new Date(referenceIso)
    : new Date();
  const timezone = formatTimezoneDisplay(rawTimezone, verified, referenceDate);

  const kind = healthPeriod?.current?.label || contextPeriod?.kind || null;
  const explicitLabel = !healthPeriod && contextPeriod?.label ? contextPeriod.label : null;
  const periodKey = selectedPeriodOverride || periodKeyFromKind(kind, contextPeriod?.days);
  const periodLabel = healthPeriod
    ? formatPeriodLabel(healthPeriod.current.label)
    : formatPeriodLabel(contextPeriod?.kind, explicitLabel);

  const start = healthPeriod?.current?.start ?? contextPeriod?.start ?? null;
  const end = healthPeriod?.current?.end ?? contextPeriod?.end ?? null;
  const dateRangeLabel = formatDateRangeInTimezone(start, end, timezone.iana);

  return {
    periodKey,
    periodLabel,
    dateRangeLabel,
    timezone,
    summaryLabel: `${periodLabel} · ${timezone.label}`,
  };
}

/**
 * Maps canonical integration state to a concise, merchant-facing status label.
 * Never exposes raw internal enum strings (e.g., `sync_failed`, `authorization_expired`).
 */
export function resolveConnectionStatus(
  data: CommandCenterData | null,
  rawStatusOverride?: string | null,
): ConciseConnectionStatus {
  const hasStore = Boolean(data?.context?.store);
  const healthIntegrationIndicator = data?.business_health?.indicators?.find(
    (ind) => ind.category === "integration",
  );
  const raw =
    rawStatusOverride ??
    data?.integration?.overall_status ??
    (typeof healthIntegrationIndicator?.value === "string" ? healthIntegrationIndicator.value : null);

  if (!data) {
    return {
      label: "Checking connection",
      tone: "neutral",
      description: "Loading your store connection status.",
      needsAttention: false,
      actionHref: null,
    };
  }

  if (!hasStore && !raw) {
    return {
      label: "Not connected",
      tone: "neutral",
      description: "Connect your Shopify store to start tracking performance.",
      needsAttention: true,
      actionHref: "/dashboard/integrations",
    };
  }

  switch (raw as IntegrationStateName | "not_connected" | null) {
    case "connected":
      return {
        label: "Connected",
        tone: "positive",
        description: "Your Shopify store is connected and verified.",
        needsAttention: false,
        actionHref: null,
      };
    case "synchronizing":
      return {
        label: "Syncing",
        tone: "progress",
        description: "Your store data is currently updating.",
        needsAttention: false,
        actionHref: null,
      };
    case "limited_access":
    case "sync_partial":
      return {
        label: "Limited data",
        tone: "warning",
        description: "Connected with partial store data access. Review in Integrations.",
        needsAttention: true,
        actionHref: "/dashboard/integrations",
      };
    case "needs_attention":
    case "sync_failed":
    case "authorization_required":
    case "authorization_expired":
    case "authorization_revoked":
      return {
        label: "Needs attention",
        tone: "negative",
        description: "Your Shopify connection needs attention in Integrations.",
        needsAttention: true,
        actionHref: "/dashboard/integrations",
      };
    case "disconnected":
    case "not_connected":
      return {
        label: "Not connected",
        tone: "neutral",
        description: "Reconnect your Shopify store in Integrations.",
        needsAttention: true,
        actionHref: "/dashboard/integrations",
      };
    case "unsupported":
    case "unknown":
    default:
      return {
        label: hasStore ? "Status unavailable" : "Not connected",
        tone: "neutral",
        description: hasStore
          ? "Connection status could not be confirmed right now."
          : "Connect your Shopify store in Integrations.",
        needsAttention: !hasStore,
        actionHref: "/dashboard/integrations",
      };
  }
}

export function resolveStoreList(data: CommandCenterData | null): StoreSummary[] {
  if (!data) return [];
  if (Array.isArray(data.context.stores) && data.context.stores.length > 0) {
    return data.context.stores;
  }
  return data.context.store ? [data.context.store] : [];
}

export function storeDisplayName(store: StoreSummary | null | undefined): string {
  if (!store) return "No store connected";
  const display = typeof store.display_name === "string" ? store.display_name.trim() : "";
  return display || store.name || store.shop_domain || "Store";
}

export function storeSecondaryDomain(store: StoreSummary | null | undefined): string | null {
  if (!store) return null;
  const primary = storeDisplayName(store);
  const domain = (store.shop_domain || store.name || "").trim();
  return domain && domain !== primary ? domain : null;
}

/**
 * Formats the last successful data update in plain human language,
 * using the store's verified timezone for exact hover/assistive detail.
 */
export function resolveLastUpdate(
  data: CommandCenterData | null,
  lastSuccessfulAt: string | null | undefined,
  refreshing: boolean,
  ianaTimezone: string,
  now: Date = new Date(),
): ResolvedLastUpdate {
  const timestamp =
    lastSuccessfulAt ||
    data?.evidence?.last_successful_sync_at ||
    data?.business_state?.data_freshness_at ||
    data?.business_state?.generated_at ||
    null;

  const formatted = formatTimestampInTimezone(timestamp, ianaTimezone);
  const title = formatted ? `Last successful update: ${formatted}` : null;

  if (refreshing) {
    return {
      label: "Updating…",
      title: title || "Updating store data",
      timestamp,
    };
  }

  if (!timestamp) {
    return {
      label: "No updates yet",
      title: null,
      timestamp: null,
    };
  }

  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime())) {
    return {
      label: "No updates yet",
      title: null,
      timestamp: null,
    };
  }

  const diffMinutes = Math.max(0, Math.floor((now.getTime() - parsed.getTime()) / 60_000));
  if (diffMinutes < 1) {
    return { label: "Updated just now", title, timestamp };
  }
  if (diffMinutes < 60) {
    return { label: `Updated ${diffMinutes}m ago`, title, timestamp };
  }
  if (diffMinutes < 1440) {
    return { label: `Updated ${Math.floor(diffMinutes / 60)}h ago`, title, timestamp };
  }
  const tz = isValidIanaTimezone(ianaTimezone) ? ianaTimezone : "UTC";
  try {
    const shortDate = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      timeZone: tz,
    }).format(parsed);
    return { label: `Updated ${shortDate}`, title, timestamp };
  } catch {
    return { label: `Updated ${Math.floor(diffMinutes / 1440)}d ago`, title, timestamp };
  }
}
