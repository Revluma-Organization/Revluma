import { api } from "@/lib/api";

export interface AutomationStore {
  id: string;
  platform: string;
  shop_domain: string | null;
  status: string;
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
  return response.data.data.stores.filter((store) => store.status === "active");
}

export async function getBetaAutomationPolicy(
  storeId: string,
): Promise<BetaAutomationPolicy> {
  const response = await api.get<{
    success: boolean;
    data: BetaAutomationPolicy;
  }>(`/settings/beta-automation/${encodeURIComponent(storeId)}`);
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
  return response.data.data;
}
