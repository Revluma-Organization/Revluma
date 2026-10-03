import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import {
  getBetaAutomationPolicy,
  listAutomationStores,
  policyForSave,
  updateBetaAutomationPolicy,
  type BetaAutomationPolicy,
} from "@/lib/betaAutomation";

describe("beta automation API", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns only active stores", async () => {
    vi.spyOn(api, "get").mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        success: true,
        data: {
          stores: [
            { id: "active", platform: "shopify", shop_domain: "active.test", status: "active" },
            { id: "paused", platform: "shopify", shop_domain: "paused.test", status: "paused" },
          ],
        },
      },
    });

    await expect(listAutomationStores()).resolves.toEqual([
      { id: "active", platform: "shopify", shop_domain: "active.test", status: "active" },
    ]);
  });

  it("uses the existing per-store settings endpoint", async () => {
    const policy: BetaAutomationPolicy = {
      enabled: false,
      allowed_actions: [],
      allowed_channels: [],
      max_discount_pct: 0,
      max_messages_per_customer_24h: 0,
      max_actions_per_store_24h: 0,
      kill_switch: true,
    };
    const get = vi.spyOn(api, "get").mockResolvedValue({
      ok: true,
      status: 200,
      data: { success: true, data: policy },
    });

    await expect(getBetaAutomationPolicy("store/id")).resolves.toEqual(policy);
    expect(get).toHaveBeenCalledWith("/settings/beta-automation/store%2Fid");
  });

  it("saves a bounded fail-closed policy", async () => {
    const put = vi.spyOn(api, "put").mockImplementation(async (_path, body) => ({
      ok: true,
      status: 200,
      data: { success: true, data: body as BetaAutomationPolicy },
    }));
    const unsafe: BetaAutomationPolicy = {
      enabled: true,
      allowed_actions: ["percentage_discount", "unsupported_action"],
      allowed_channels: ["sms"],
      max_discount_pct: 60,
      max_messages_per_customer_24h: 20,
      max_actions_per_store_24h: 5000,
      kill_switch: true,
    };

    const expected = policyForSave(unsafe);
    await expect(updateBetaAutomationPolicy("store-1", unsafe)).resolves.toEqual(expected);
    expect(put).toHaveBeenCalledWith(
      "/settings/beta-automation/store-1",
      {
        enabled: true,
        allowed_actions: ["cart_recovery_message", "percentage_discount"],
        allowed_channels: ["email"],
        max_discount_pct: 25,
        max_messages_per_customer_24h: 10,
        max_actions_per_store_24h: 1000,
        kill_switch: false,
      },
    );
  });
});
