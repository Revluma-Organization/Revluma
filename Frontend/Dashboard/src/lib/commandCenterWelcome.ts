import type { CommandCenterData, StoreSummary } from "@/components/command-center/types";
import type { CommandCenterFailure } from "@/lib/commandCenterError";
import type { IntegrationStateName } from "@/lib/integrationState";
import { isIntegrationStateName } from "@/lib/integrationState";

export interface WelcomeUserProfile {
  full_name?: string | null;
  display_name?: string | null;
  nickname?: string | null;
  preferred_name?: string | null;
  timezone?: string | null;
}

export type GreetingPeriod = "morning" | "afternoon" | "evening";

export interface ResolvedWelcomeGreeting {
  /** Base time-of-day salutation without trailing emoji or name. */
  salutation: string;
  /** Merchant display name/nickname or first name, or null when unavailable. */
  merchantName: string | null;
  /** Full greeting line without decorative emoji (used for accessible text). */
  text: string;
  period: GreetingPeriod;
  timezone: string | null;
}

export type WelcomeConnectionTone = "positive" | "progress" | "warning" | "negative" | "neutral";

export interface WelcomeConnectionStatus {
  label: string;
  tone: WelcomeConnectionTone;
  description: string;
  /** True strictly when Shopify connection is verified as `connected`. */
  isConfirmedConnected: boolean;
  needsAction: boolean;
  actionHref: string | null;
}

export interface WelcomeStoreIdentity {
  /** Quiet label above the store name/domain. */
  label: string;
  /** Primary store name or myshopify domain, or null while loading / unavailable. */
  primaryName: string | null;
  /** Secondary domain when a human shop name is displayed as primaryName. */
  secondaryDomain: string | null;
  platform: string;
  hasStore: boolean;
  store: StoreSummary | null;
  stores: StoreSummary[];
  /** True only when multiple stores exist so no fake dropdown is shown. */
  hasMultipleStores: boolean;
}

export type LastSynchronizedState =
  | "loading"
  | "synced"
  | "never_synced"
  | "syncing_initial"
  | "unavailable";

export interface ResolvedLastSynchronized {
  label: string;
  title: string | null;
  timestamp: string | null;
  state: LastSynchronizedState;
}

export const WELCOME_SUPPORTING_COPY =
  "Here's what's happening across your business today.";

function isValidIanaTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function cleanNameToken(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  // Never greet with a raw email address if a malformed profile stores one as a name.
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Resolves the authenticated merchant's greeting name from profile data.
 * Prefers configured nickname / preferred_name / display_name when present;
 * otherwise extracts the first name from full_name. Never hardcodes a name.
 */
export function resolveMerchantGreetingName(
  user: WelcomeUserProfile | null | undefined,
): string | null {
  if (!user) return null;

  const preferred =
    cleanNameToken(user.nickname) ||
    cleanNameToken(user.preferred_name) ||
    cleanNameToken(user.display_name);
  if (preferred) return preferred;

  const fullName = cleanNameToken(user.full_name);
  if (!fullName) return null;

  const first = fullName.split(" ")[0]?.trim();
  return first || null;
}

/**
 * Resolves the timezone used for the time-of-day greeting:
 *   1. Account timezone from user profile/preferences when present and valid.
 *   2. Connected store's verified Shopify IANA timezone when available.
 *   3. Merchant's local browser timezone fallback.
 */
export function resolveGreetingTimezone(
  user: WelcomeUserProfile | null | undefined,
  data: CommandCenterData | null,
): string | null {
  const userTz = typeof user?.timezone === "string" ? user.timezone.trim() : "";
  if (userTz && isValidIanaTimezone(userTz)) return userTz;

  const storeTz = data?.context?.store?.iana_timezone?.trim() || "";
  if (storeTz && isValidIanaTimezone(storeTz)) return storeTz;

  const healthTz = data?.business_health?.reporting_period?.timezone?.trim() || "";
  if (healthTz && healthTz !== "UTC" && isValidIanaTimezone(healthTz)) return healthTz;

  const contextPeriod = data?.context?.reporting_period;
  const periodTz = contextPeriod?.timezone?.trim() || "";
  if (periodTz && contextPeriod?.timezone_verified === true && isValidIanaTimezone(periodTz)) {
    return periodTz;
  }

  try {
    const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (localTz && isValidIanaTimezone(localTz)) return localTz;
  } catch {
    // Fall back to runtime local Date#getHours().
  }
  return null;
}

function resolveLocalHour(now: Date, timezone: string | null): number {
  if (timezone && isValidIanaTimezone(timezone)) {
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        hourCycle: "h23",
        timeZone: timezone,
      }).formatToParts(now);
      const hourPart = parts.find((part) => part.type === "hour")?.value;
      if (hourPart != null) {
        const parsed = Number.parseInt(hourPart, 10);
        if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 23) {
          return parsed;
        }
      }
    } catch {
      // Fall back to local Date#getHours() below.
    }
  }
  return now.getHours();
}

export function getGreetingPeriod(now: Date, timezone: string | null): GreetingPeriod {
  const hour = resolveLocalHour(now, timezone);
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  return "evening";
}

export function formatWelcomeGreeting(
  user: WelcomeUserProfile | null | undefined,
  data: CommandCenterData | null,
  now: Date = new Date(),
): ResolvedWelcomeGreeting {
  const timezone = resolveGreetingTimezone(user, data);
  const period = getGreetingPeriod(now, timezone);
  const salutation =
    period === "morning"
      ? "Good morning"
      : period === "afternoon"
        ? "Good afternoon"
        : "Good evening";
  const merchantName = resolveMerchantGreetingName(user);
  const text = merchantName ? `${salutation}, ${merchantName}` : salutation;

  return { salutation, merchantName, text, period, timezone };
}

/**
 * Resolves the canonical Shopify connection status honestly.
 *
 * Invariants:
 *  - Green ("positive") and "Connected" appear ONLY when the authoritative
 *    integration contract confirms `overall_status === "connected"` and
 *    authorization is not flagged invalid/unverified.
 *  - Connection state is never conflated with data sync/completeness.
 *  - Loading and API failure states never fabricate "Connected" or "Disconnected".
 */
export function resolveWelcomeConnectionStatus(
  data: CommandCenterData | null,
  loading: boolean,
  failure: CommandCenterFailure | null,
  rawStatusOverride?: string | null,
): WelcomeConnectionStatus {
  if (loading && !data) {
    return {
      label: "Checking connection",
      tone: "neutral",
      description: "Checking your Shopify store connection status.",
      isConfirmedConnected: false,
      needsAction: false,
      actionHref: null,
    };
  }

  if (failure && !data) {
    return {
      label: "Status unavailable",
      tone: "neutral",
      description: "Store connection status could not be loaded right now.",
      isConfirmedConnected: false,
      needsAction: false,
      actionHref: null,
    };
  }

  if (!data && !rawStatusOverride) {
    return {
      label: "Status unavailable",
      tone: "neutral",
      description: "Store connection status is currently unavailable.",
      isConfirmedConnected: false,
      needsAction: false,
      actionHref: null,
    };
  }

  const hasStore = Boolean(data?.context?.store || data?.integration?.store);
  const healthIntegrationIndicator = data?.business_health?.indicators?.find(
    (ind) => ind.category === "integration",
  );
  const healthIndicatorStatus =
    typeof healthIntegrationIndicator?.value === "string" &&
    isIntegrationStateName(healthIntegrationIndicator.value)
      ? healthIntegrationIndicator.value
      : null;

  const raw =
    rawStatusOverride ??
    data?.integration?.overall_status ??
    healthIndicatorStatus ??
    null;

  if (!hasStore && !raw) {
    return {
      label: "Not connected",
      tone: "neutral",
      description: "Connect your Shopify store in Integrations to begin monitoring.",
      isConfirmedConnected: false,
      needsAction: true,
      actionHref: "/dashboard/integrations",
    };
  }

  const authBlock = data?.integration?.authorization ?? null;
  const authInvalid = Boolean(authBlock && (!authBlock.verified || !authBlock.valid));

  switch (raw as IntegrationStateName | "not_connected" | null) {
    case "connected":
      if (authInvalid) {
        return {
          label: "Reconnect required",
          tone: "negative",
          description: "Shopify authorization could not be verified. Reconnect in Integrations.",
          isConfirmedConnected: false,
          needsAction: true,
          actionHref: "/dashboard/integrations",
        };
      }
      return {
        label: "Connected",
        tone: "positive",
        description:
          "Your Shopify store connection is verified. Data synchronization freshness is shown separately below.",
        isConfirmedConnected: true,
        needsAction: false,
        actionHref: null,
      };
    case "synchronizing":
      return {
        label: "Syncing",
        tone: "progress",
        description: "Your Shopify store is authorized and data synchronization is in progress.",
        isConfirmedConnected: false,
        needsAction: false,
        actionHref: null,
      };
    case "limited_access":
      return {
        label: "Limited access",
        tone: "warning",
        description:
          "Connected with restricted Shopify permissions. Review permissions in Integrations.",
        isConfirmedConnected: false,
        needsAction: true,
        actionHref: "/dashboard/integrations",
      };
    case "sync_partial":
      return {
        label: "Partial data",
        tone: "warning",
        description:
          "Your store is connected, but some data domains have not finished synchronizing.",
        isConfirmedConnected: false,
        needsAction: true,
        actionHref: "/dashboard/integrations",
      };
    case "sync_failed":
      return {
        label: "Sync issue",
        tone: "warning",
        description:
          "Your store is connected, but the latest data synchronization failed. Review in Integrations.",
        isConfirmedConnected: false,
        needsAction: true,
        actionHref: "/dashboard/integrations",
      };
    case "authorization_expired":
      return {
        label: "Authorization expired",
        tone: "negative",
        description: "Your Shopify authorization has expired. Reconnect your store in Integrations.",
        isConfirmedConnected: false,
        needsAction: true,
        actionHref: "/dashboard/integrations",
      };
    case "authorization_revoked":
    case "authorization_required":
      return {
        label: "Reconnect required",
        tone: "negative",
        description: "Your Shopify store requires reauthorization in Integrations.",
        isConfirmedConnected: false,
        needsAction: true,
        actionHref: "/dashboard/integrations",
      };
    case "needs_attention":
      return authInvalid
        ? {
            label: "Reconnect required",
            tone: "negative",
            description: "Shopify access needs to be reauthorized in Integrations.",
            isConfirmedConnected: false,
            needsAction: true,
            actionHref: "/dashboard/integrations",
          }
        : {
            label: "Needs attention",
            tone: "warning",
            description: "Your Shopify integration requires review in Integrations.",
            isConfirmedConnected: false,
            needsAction: true,
            actionHref: "/dashboard/integrations",
          };
    case "disconnected":
      return {
        label: "Disconnected",
        tone: "neutral",
        description: "Your Shopify store is disconnected. Reconnect it in Integrations.",
        isConfirmedConnected: false,
        needsAction: true,
        actionHref: "/dashboard/integrations",
      };
    case "not_connected":
      return {
        label: "Not connected",
        tone: "neutral",
        description: "Connect your Shopify store in Integrations to begin monitoring.",
        isConfirmedConnected: false,
        needsAction: true,
        actionHref: "/dashboard/integrations",
      };
    case "unsupported":
    case "unknown":
    default:
      return {
        label: hasStore ? "Status unavailable" : "Not connected",
        tone: "neutral",
        description: hasStore
          ? "Shopify connection status could not be confirmed right now."
          : "Connect your Shopify store in Integrations to begin monitoring.",
        isConfirmedConnected: false,
        needsAction: !hasStore,
        actionHref: hasStore ? null : "/dashboard/integrations",
      };
  }
}

export function resolveWelcomeStoreIdentity(
  data: CommandCenterData | null,
  loading: boolean,
  failure: CommandCenterFailure | null,
  connection: WelcomeConnectionStatus,
): WelcomeStoreIdentity {
  if (loading && !data) {
    return {
      label: "Store connection",
      primaryName: null,
      secondaryDomain: null,
      platform: "shopify",
      hasStore: false,
      store: null,
      stores: [],
      hasMultipleStores: false,
    };
  }

  if (!data) {
    return {
      label: "Store connection",
      primaryName: failure ? "Store details unavailable" : "No store connected",
      secondaryDomain: null,
      platform: "shopify",
      hasStore: false,
      store: null,
      stores: [],
      hasMultipleStores: false,
    };
  }

  const contextStore = data.context.store ?? null;
  const fallbackIntegrationStore: StoreSummary | null =
    !contextStore && data.integration?.store
      ? {
          id: data.integration.store.id,
          name: data.integration.store.shop_domain,
          shop_domain: data.integration.store.shop_domain,
          platform: data.integration.store.provider || "shopify",
        }
      : null;

  const activeStore = contextStore ?? fallbackIntegrationStore;
  const rawStores = Array.isArray(data.context.stores) && data.context.stores.length > 0
    ? data.context.stores
    : activeStore
      ? [activeStore]
      : [];

  // Deduplicate stores by id while preserving order.
  const seen = new Set<string>();
  const stores = rawStores.filter((item) => {
    if (!item?.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });

  if (!activeStore) {
    return {
      label: "Store connection",
      primaryName: "No store connected",
      secondaryDomain: null,
      platform: "shopify",
      hasStore: false,
      store: null,
      stores: [],
      hasMultipleStores: false,
    };
  }

  const domain = (activeStore.shop_domain || activeStore.name || "").trim();
  const displayName =
    typeof activeStore.display_name === "string" ? activeStore.display_name.trim() : "";

  const primaryName = displayName || domain || "Connected store";
  const secondaryDomain = domain && domain !== primaryName ? domain : null;
  const platform = (activeStore.platform || "shopify").toLowerCase();

  const label = connection.isConfirmedConnected
    ? "Your connected store"
    : platform === "shopify"
      ? "Shopify store"
      : "Store";

  return {
    label,
    primaryName,
    secondaryDomain,
    platform,
    hasStore: true,
    store: activeStore,
    stores,
    hasMultipleStores: stores.length > 1,
  };
}

function parseValidTimestamp(value: string | null | undefined): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function formatExactTimestamp(date: Date, timezone: string | null): string {
  const options: Intl.DateTimeFormatOptions = {
    dateStyle: "medium",
    timeStyle: "short",
    ...(timezone && isValidIanaTimezone(timezone) ? { timeZone: timezone } : {}),
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

function formatRelativeTime(date: Date, now: Date, timezone: string | null): string {
  const diffMs = now.getTime() - date.getTime();
  // Guard against minor client/server clock skew.
  if (diffMs < 60_000) return "just now";

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes === 1) return "1 minute ago";
  if (minutes < 60) return `${minutes} minutes ago`;

  const hours = Math.floor(minutes / 60);
  if (hours === 1) return "1 hour ago";
  if (hours < 24) return `${hours} hours ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return "1 day ago";
  if (days < 7) return `${days} days ago`;

  const sameYear = date.getUTCFullYear() === now.getUTCFullYear();
  const options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    ...(timezone && isValidIanaTimezone(timezone) ? { timeZone: timezone } : {}),
  };
  try {
    return new Intl.DateTimeFormat("en-US", options).format(date);
  } catch {
    return `${days} days ago`;
  }
}

/**
 * Resolves the last successful synchronization detail strictly from
 * authoritative successful-sync timestamps (never from `last_attempt_at` or
 * API `retrieved_at` timestamps).
 */
export function resolveLastSynchronized(
  data: CommandCenterData | null,
  loading: boolean,
  failure: CommandCenterFailure | null,
  timezone: string | null,
  now: Date = new Date(),
): ResolvedLastSynchronized {
  if (loading && !data) {
    return {
      label: "Checking synchronization status…",
      title: null,
      timestamp: null,
      state: "loading",
    };
  }

  if (!data) {
    return {
      label: "Last synchronized: Unavailable",
      title: failure
        ? "Last successful synchronization time is unavailable while the briefing cannot be reached."
        : "Last successful synchronization time is unavailable.",
      timestamp: null,
      state: "unavailable",
    };
  }

  const hasStore = Boolean(data.context.store || data.integration?.store);
  if (!hasStore) {
    return {
      label: "Last synchronized: Unavailable",
      title: "Connect a Shopify store to synchronize store data.",
      timestamp: null,
      state: "unavailable",
    };
  }

  // Strictly successful sync candidates — never last_attempt_at or retrieved_at.
  const rawCandidates: Array<string | null | undefined> = [
    data.integration?.synchronization?.last_succeeded_at,
    data.evidence?.last_successful_sync_at,
    ...(Array.isArray(data.evidence?.resources)
      ? data.evidence.resources.map((resource) => resource.last_success_at)
      : []),
    data.integration?.store?.last_synced_at,
  ];

  let latestDate: Date | null = null;
  let latestIso: string | null = null;
  let sawMalformedValue = false;

  for (const candidate of rawCandidates) {
    if (candidate == null || candidate === "") continue;
    const parsed = parseValidTimestamp(candidate);
    if (!parsed) {
      sawMalformedValue = true;
      continue;
    }
    if (!latestDate || parsed.getTime() > latestDate.getTime()) {
      latestDate = parsed;
      latestIso = candidate;
    }
  }

  if (latestDate && latestIso) {
    const relative = formatRelativeTime(latestDate, now, timezone);
    const exact = formatExactTimestamp(latestDate, timezone);
    return {
      label: `Last synchronized: ${relative}`,
      title: `Last successful synchronization: ${exact}. Individual data domains may update on separate schedules.`,
      timestamp: latestIso,
      state: "synced",
    };
  }

  if (sawMalformedValue) {
    return {
      label: "Last synchronized: Unavailable",
      title: "Synchronization timestamp could not be read.",
      timestamp: null,
      state: "unavailable",
    };
  }

  const syncBlock = data.integration?.synchronization;
  const isInitialSyncRunning =
    data.integration?.overall_status === "synchronizing" ||
    syncBlock?.state === "running" ||
    syncBlock?.state === "in_progress" ||
    (Array.isArray(syncBlock?.running_domains) && syncBlock.running_domains.length > 0);

  if (isInitialSyncRunning) {
    return {
      label: "Last synchronized: Initial synchronization in progress",
      title: "No synchronization has completed yet.",
      timestamp: null,
      state: "syncing_initial",
    };
  }

  const hasKnownSyncMetadata = Boolean(
    syncBlock ||
      (data.evidence &&
        ("last_successful_sync_at" in data.evidence || Array.isArray(data.evidence.resources))),
  );

  if (hasKnownSyncMetadata) {
    return {
      label: "Last synchronized: Not yet synchronized",
      title: "No successful synchronization has been recorded for this store yet.",
      timestamp: null,
      state: "never_synced",
    };
  }

  return {
    label: "Last synchronized: Unavailable",
    title: "Synchronization timestamp is currently unavailable.",
    timestamp: null,
    state: "unavailable",
  };
}
