// src/lib/integrationState.ts
// Task 213 — canonical integration state (rev-integration-state-v1) for the UI.
//
// The state of a store is never inferred here from setup flags or cache. It is
// evaluated server-side from the persisted integration records (Python
// keystone, mirrored in Node) and served by the product API. This module
// normalizes that contract FAIL-CLOSED: an invalid, stale-shaped, or missing
// block yields `unknown`, never `connected`. Green is reserved for the single
// verified state.

export const INTEGRATION_STATE_CONTRACT_VERSION = "rev-integration-state-v1";

export const INTEGRATION_STATES = [
  "connected",
  "synchronizing",
  "limited_access",
  "needs_attention",
  "disconnected",
  "authorization_required",
  "authorization_expired",
  "authorization_revoked",
  "sync_failed",
  "sync_partial",
  "unsupported",
  "unknown",
] as const;

export type IntegrationStateName = (typeof INTEGRATION_STATES)[number];

/** No-store sentinel used by UI rollups (not a contract state). */
export const NOT_CONNECTED = "not_connected";
export type UiIntegrationStatus = IntegrationStateName | typeof NOT_CONNECTED;

export interface IntegrationStoreBlock {
  id: string;
  shop_domain: string;
  provider: string;
  installed_at: string | null;
  last_synced_at: string | null;
}

export interface IntegrationAuthorizationBlock {
  verification: string;
  valid: boolean;
  verified: boolean;
  last_verified_at: string | null;
  missing_app_scopes: string[];
}

export interface IntegrationSynchronizationBlock {
  state: string;
  running_domains: string[];
  failed_domains: string[];
  partial_domains: string[];
  last_succeeded_at: string | null;
}

export interface IntegrationState {
  contract_version: string;
  organization_id: string;
  integration_id: string;
  store: IntegrationStoreBlock;
  overall_status: IntegrationStateName;
  status_reason: string;
  status_explanation: string;
  merchant_action_required: boolean;
  recommended_next_step: string | null;
  authorization: IntegrationAuthorizationBlock;
  synchronization: IntegrationSynchronizationBlock;
  evaluated_at: string;
  /** Additional contract blocks (capabilities, webhooks, coverage, last_error). */
  [key: string]: unknown;
}

// Server rollup order (worst first). Mirrors STATE_SEVERITY in the keystones.
const STATE_SEVERITY: Record<IntegrationStateName, number> = {
  authorization_revoked: 0,
  authorization_expired: 1,
  authorization_required: 2,
  needs_attention: 3,
  sync_failed: 4,
  sync_partial: 5,
  disconnected: 6,
  unsupported: 7,
  unknown: 8,
  synchronizing: 9,
  limited_access: 10,
  connected: 11,
};

export function isIntegrationStateName(value: unknown): value is IntegrationStateName {
  return typeof value === "string" && (INTEGRATION_STATES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/**
 * Fail-closed normalizer. Returns a well-typed IntegrationState, or null when
 * the block is missing, malformed, or from an unrecognized contract version.
 * The UI must render null as `unknown` — it must never treat a failed
 * validation as a connected store.
 */
export function normalizeIntegrationState(value: unknown): IntegrationState | null {
  if (!isRecord(value)) return null;
  if (value.contract_version !== INTEGRATION_STATE_CONTRACT_VERSION) return null;
  if (!isIntegrationStateName(value.overall_status)) return null;
  const store = value.store;
  if (!isRecord(store) || typeof store.id !== "string" || !store.id) return null;
  const authorization = value.authorization;
  if (!isRecord(authorization) || typeof authorization.verified !== "boolean") return null;
  const synchronization = value.synchronization;
  if (!isRecord(synchronization) || typeof synchronization.state !== "string") return null;
  if (!isStringArray(authorization.missing_app_scopes)) return null;
  if (!isStringArray(synchronization.running_domains)) return null;
  if (!isStringArray(synchronization.failed_domains)) return null;
  if (!isStringArray(synchronization.partial_domains)) return null;
  // Defense in depth: the contract must never carry credential material.
  const serialized = JSON.stringify(value);
  if (/shpat_[A-Za-z0-9_]{8,}|access_token|refresh_token/.test(serialized)) return null;

  return {
    contract_version: INTEGRATION_STATE_CONTRACT_VERSION,
    organization_id: typeof value.organization_id === "string" ? value.organization_id : "",
    integration_id: typeof value.integration_id === "string" ? value.integration_id : store.id,
    store: {
      id: store.id,
      shop_domain: typeof store.shop_domain === "string" ? store.shop_domain : "",
      provider: typeof store.provider === "string" ? store.provider : "shopify",
      installed_at: typeof store.installed_at === "string" ? store.installed_at : null,
      last_synced_at: typeof store.last_synced_at === "string" ? store.last_synced_at : null,
    },
    overall_status: value.overall_status,
    status_reason: typeof value.status_reason === "string" ? value.status_reason : "",
    status_explanation: typeof value.status_explanation === "string" ? value.status_explanation : "",
    merchant_action_required: value.merchant_action_required === true,
    recommended_next_step:
      typeof value.recommended_next_step === "string" ? value.recommended_next_step : null,
    authorization: {
      verification: typeof authorization.verification === "string" ? authorization.verification : "unknown",
      valid: authorization.valid === true,
      verified: authorization.verified,
      last_verified_at:
        typeof authorization.last_verified_at === "string" ? authorization.last_verified_at : null,
      missing_app_scopes: authorization.missing_app_scopes as string[],
    },
    synchronization: {
      state: synchronization.state as string,
      running_domains: synchronization.running_domains as string[],
      failed_domains: synchronization.failed_domains as string[],
      partial_domains: synchronization.partial_domains as string[],
      last_succeeded_at:
        typeof synchronization.last_succeeded_at === "string"
          ? synchronization.last_succeeded_at
          : null,
    },
    evaluated_at: typeof value.evaluated_at === "string" ? value.evaluated_at : "",
  } as IntegrationState;
}

/**
 * Worst-state rollup across a set of stores (same severity table as the
 * server). Returns null when there are no states. A single unavailable store
 * prevents claiming the organization's data is current.
 */
export function worstIntegrationState(
  states: Array<IntegrationState | null | undefined>,
): IntegrationState | null {
  const present = states.filter((s): s is IntegrationState => Boolean(s));
  if (!present.length) return null;
  return [...present].sort((a, b) => STATE_SEVERITY[a.overall_status] - STATE_SEVERITY[b.overall_status])[0];
}

/**
 * Platform-level status for UI badges: the worst canonical state among that
 * platform's stores, or `not_connected` when the platform has no stores.
 */
export function platformStatusFromStates(
  states: Array<IntegrationState | null | undefined>,
  provider = "shopify",
): UiIntegrationStatus {
  const match = states.filter((s) => s && s.store.provider === provider);
  if (!match.length) return NOT_CONNECTED;
  const worst = worstIntegrationState(match);
  return worst ? worst.overall_status : NOT_CONNECTED;
}

export const INTEGRATION_STATE_LABELS: Record<UiIntegrationStatus, string> = {
  connected: "Connected",
  synchronizing: "Synchronizing",
  limited_access: "Limited access",
  needs_attention: "Needs attention",
  disconnected: "Disconnected",
  authorization_required: "Authorization required",
  authorization_expired: "Authorization expired",
  authorization_revoked: "Authorization revoked",
  sync_failed: "Sync failed",
  sync_partial: "Sync partially failed",
  unsupported: "Unsupported platform",
  unknown: "Status unknown",
  [NOT_CONNECTED]: "Not Connected",
};

// Green ONLY for `connected`. Synchronizing/limited/needs-attention are amber
// (in progress or degraded); authorization problems and sync failures are red;
// disconnected/unsupported/unknown are neutral (no false urgency, no false green).
export const INTEGRATION_STATE_STYLES: Record<
  UiIntegrationStatus,
  { color: string; bg: string; pulse?: boolean }
> = {
  connected: { color: "hsl(var(--accent))", bg: "hsl(var(--accent) / 0.12)" },
  synchronizing: { color: "hsl(var(--amber))", bg: "hsl(var(--amber) / 0.12)", pulse: true },
  limited_access: { color: "hsl(var(--amber))", bg: "hsl(var(--amber) / 0.12)" },
  needs_attention: { color: "hsl(var(--amber))", bg: "hsl(var(--amber) / 0.12)" },
  disconnected: { color: "hsl(var(--t3))", bg: "hsl(var(--bg-4))" },
  authorization_required: { color: "hsl(var(--red))", bg: "hsl(var(--red) / 0.12)" },
  authorization_expired: { color: "hsl(var(--red))", bg: "hsl(var(--red) / 0.12)" },
  authorization_revoked: { color: "hsl(var(--red))", bg: "hsl(var(--red) / 0.12)" },
  sync_failed: { color: "hsl(var(--red))", bg: "hsl(var(--red) / 0.12)" },
  sync_partial: { color: "hsl(var(--red))", bg: "hsl(var(--red) / 0.12)" },
  unsupported: { color: "hsl(var(--t3))", bg: "hsl(var(--bg-4))" },
  unknown: { color: "hsl(var(--t3))", bg: "hsl(var(--bg-4))" },
  [NOT_CONNECTED]: { color: "hsl(var(--t3))", bg: "hsl(var(--bg-4))" },
};

/**
 * Human-readable headline for a canonical state, used by page copy. The text
 * is deliberately capability-aware: it says what is and is not available.
 */
export function integrationStateCopy(status: UiIntegrationStatus): {
  title: string;
  body: string;
} {
  switch (status) {
    case "connected":
      return {
        title: "Your store is connected and ready to explore",
        body: "Here's your store's current operational picture. Explore the evidence behind each reported figure.",
      };
    case "synchronizing":
      return {
        title: "Synchronizing your store",
        body: "Your store is connected and its data is synchronizing. Some figures may not yet reflect the latest activity.",
      };
    case "limited_access":
      return {
        title: "Your store is connected with limited data",
        body: "Part of your store data is available; other capabilities are currently limited. Review the integration to see exactly what is covered.",
      };
    case "needs_attention":
    case "sync_failed":
    case "sync_partial":
      return {
        title: "Your store integration needs attention",
        body: "Review the integration before relying on newly synchronized information.",
      };
    case "authorization_expired":
      return {
        title: "Your Shopify authorization expired",
        body: "Reconnect the store to resume monitoring its activity.",
      };
    case "authorization_revoked":
      return {
        title: "Your Shopify authorization was revoked",
        body: "The store's access to Revluma was revoked. Reconnect the store to resume monitoring.",
      };
    case "authorization_required":
      return {
        title: "Store authorization required",
        body: "The store is saved but its Shopify authorization is incomplete. Finish the connection to start monitoring.",
      };
    case "disconnected":
    case "unsupported":
    case "unknown":
      return {
        title: "Your store connection could not be verified",
        body: "Review the integration to see the current status of your store connection.",
      };
    case NOT_CONNECTED:
    default:
      return {
        title: "Connect your store to get started",
        body: "Connect your store to begin monitoring business activity.",
      };
  }
}
