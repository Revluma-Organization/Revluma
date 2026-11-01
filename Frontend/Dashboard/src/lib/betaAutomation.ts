import { api } from "@/lib/api";

export interface AutomationStore {
  id: string;
  platform: string;
  shop_domain: string | null;
  status: string;
  connection_status?: "connected" | "disconnected";
}

export interface BetaAutomationPolicy {
  enabled: boolean;
  allowed_actions: string[];
  allowed_channels: string[];
  max_discount_pct: number;
  max_messages_per_customer_24h: number;
  max_actions_per_store_24h: number;
  kill_switch: boolean;
}

export const DISABLED_AUTOMATION_POLICY: BetaAutomationPolicy = {
  enabled: false,
  allowed_actions: [],
  allowed_channels: [],
  max_discount_pct: 0,
  max_messages_per_customer_24h: 0,
  max_actions_per_store_24h: 0,
  kill_switch: true,
};

export function validateAutomationPolicy(policy: BetaAutomationPolicy, acknowledged: boolean): string | null {
  if (!policy.enabled) return null;
  const inRange = (value: number, min: number, max: number) => Number.isInteger(value) && value >= min && value <= max;
  if (!inRange(policy.max_messages_per_customer_24h, 1, 10)) return 'Emails per customer must be a whole number from 1 to 10.';
  if (!inRange(policy.max_actions_per_store_24h, 1, 1000)) return 'Actions per store must be a whole number from 1 to 1,000.';
  if (policy.allowed_actions.includes('percentage_discount') && !inRange(policy.max_discount_pct, 1, 25)) return 'Discount must be a whole percentage from 1 to 25.';
  if (!acknowledged) return 'Confirm merchant authorisation before saving an enabled policy.';
  return null;
}

function boundedInteger(value: number, minimum: number, maximum: number): number {
  const integer = Number.isFinite(value) ? Math.round(value) : minimum;
  return Math.min(maximum, Math.max(minimum, integer));
}

export function policyForSave(policy: BetaAutomationPolicy): BetaAutomationPolicy {
  const enabled = policy.enabled === true;
  const discountsEnabled = enabled && policy.allowed_actions.includes("percentage_discount");
  return {
    enabled,
    allowed_actions: enabled
      ? ["cart_recovery_message", ...(discountsEnabled ? ["percentage_discount"] : [])]
      : [],
    allowed_channels: enabled ? ["email"] : [],
    max_discount_pct: discountsEnabled
      ? boundedInteger(policy.max_discount_pct, 0, 25)
      : 0,
    max_messages_per_customer_24h: enabled
      ? boundedInteger(policy.max_messages_per_customer_24h, 1, 10)
      : 0,
    max_actions_per_store_24h: enabled
      ? boundedInteger(policy.max_actions_per_store_24h, 1, 1000)
      : 0,
    kill_switch: !enabled,
  };
}

export async function listAutomationStores(): Promise<AutomationStore[]> {
  const response = await api.get<{
    success: boolean;
    data: { stores: AutomationStore[] };
  }>("/stores");
  const stores = response.data?.data?.stores;
  if (response.data?.success !== true || !Array.isArray(stores)) throw new Error('Unable to verify connected stores.');
  return stores.filter((store) => store.status === "active" && store.platform === "shopify" && store.connection_status !== "disconnected");
}

export async function getBetaAutomationPolicy(
  storeId: string,
): Promise<BetaAutomationPolicy> {
  const response = await api.get<{
    success: boolean;
    data: BetaAutomationPolicy;
  }>(`/settings/beta-automation/${encodeURIComponent(storeId)}`);
  if (response.data?.success !== true || !isAutomationPolicy(response.data.data)) {
    throw new Error('The automation policy response was invalid.');
  }
  return response.data.data;
}

export async function updateBetaAutomationPolicy(
  storeId: string,
  policy: BetaAutomationPolicy,
): Promise<BetaAutomationPolicy> {
  const response = await api.put<{
    success: boolean;
    data: BetaAutomationPolicy;
  }>(
    `/settings/beta-automation/${encodeURIComponent(storeId)}`,
    policyForSave(policy),
  );
  if (response.data?.success !== true || !isAutomationPolicy(response.data.data)) {
    throw new Error('The automation policy response was invalid.');
  }
  return response.data.data;
}

function isAutomationPolicy(value: unknown): value is BetaAutomationPolicy {
  if (!value || typeof value !== 'object') return false;
  const policy = value as BetaAutomationPolicy;
  return typeof policy.enabled === 'boolean' && typeof policy.kill_switch === 'boolean' &&
    Array.isArray(policy.allowed_actions) && policy.allowed_actions.every(action => typeof action === 'string') &&
    Array.isArray(policy.allowed_channels) && policy.allowed_channels.every(channel => typeof channel === 'string') &&
    [policy.max_discount_pct, policy.max_messages_per_customer_24h, policy.max_actions_per_store_24h].every(Number.isFinite);
}
