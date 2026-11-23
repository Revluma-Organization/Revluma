// Capability reauthorization — the merchant-facing half of Revluma's
// permission manager.
//
// The backend decides which scopes are actually missing (never re-requesting
// granted ones, refusing unsupported or plan-restricted capabilities) and
// records why the permission is being asked for. The frontend only names the
// capability and, when Rev asked, where to resume afterwards.

import { api } from "@/lib/api";

export interface CapabilityAuthorizationRequest {
  storeId: string;
  shopDomain: string;
  capabilities: string[];
  resume?: { surface: "rev" | "integrations"; conversationId?: string | null };
  trigger?: "merchant" | "rev_investigation";
}

export type CapabilityAuthorizationResult =
  | { kind: "redirect"; url: string }
  | { kind: "not_needed"; refused: { capability: string; reason: string; explanation?: string }[] };

interface InstallResponse {
  redirectUrl?: string | null;
  data?: { refused?: { capability: string; reason: string; explanation?: string }[] };
}

export async function startCapabilityAuthorization(request: CapabilityAuthorizationRequest): Promise<CapabilityAuthorizationResult> {
  const params: Record<string, string> = {
    shop: request.shopDomain,
    store_id: request.storeId,
    mode: "reauthorize",
    capabilities: request.capabilities.join(","),
    trigger: request.trigger ?? "merchant",
    resume_surface: request.resume?.surface ?? "integrations",
  };
  if (request.resume?.conversationId) params.conversation_id = request.resume.conversationId;
  const res = await api.get("/shopify/install", params);
  const body = (res.data ?? {}) as InstallResponse;
  if (body.redirectUrl) return { kind: "redirect", url: body.redirectUrl };
  return { kind: "not_needed", refused: body.data?.refused ?? [] };
}

const CAPABILITY_LABELS: Record<string, string> = {
  orders: "orders, payments and refunds",
  checkouts: "abandoned checkouts",
  products: "products and catalog",
  inventory: "inventory and locations",
  customers: "customers",
  store_policies: "store policies",
  url_redirects: "URL redirects",
  publications: "sales-channel publishing",
  markets: "markets",
  contextual_pricing: "market pricing",
  metaobjects: "custom data (metaobjects)",
};

export function capabilityLabel(id: string): string {
  return CAPABILITY_LABELS[id] ?? id.replace(/_/g, " ");
}
