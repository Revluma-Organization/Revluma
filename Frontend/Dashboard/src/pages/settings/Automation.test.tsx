import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { useAuthStore } from "@/store/authStore";

const automationApi = vi.hoisted(() => ({
  listStores: vi.fn(),
  getPolicy: vi.fn(),
  updatePolicy: vi.fn(),
}));

vi.mock("@/lib/betaAutomation", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/betaAutomation")>();
  return {
    ...original,
    listAutomationStores: automationApi.listStores,
    getBetaAutomationPolicy: automationApi.getPolicy,
    updateBetaAutomationPolicy: automationApi.updatePolicy,
  };
});

import Automation from "./Automation";

function setRole(role: string) {
  useAuthStore.setState({
    user: {
      id: "user-1",
      email: "owner@example.test",
      full_name: "Store Owner",
      role,
      tenant_id: "organization-1",
      email_verified: true,
      onboarding_status: "completed",
    },
  });
}

describe("Automation settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not load policies for a member", () => {
    setRole("member");

    render(<Automation />);

    expect(screen.getByText("Owner or admin access required")).toBeInTheDocument();
    expect(automationApi.listStores).not.toHaveBeenCalled();
  });

  it("loads the active store policy for an owner", async () => {
    setRole("owner");
    automationApi.listStores.mockResolvedValue([
      { id: "store-1", platform: "shopify", shop_domain: "shop.example.test", status: "active" },
    ]);
    automationApi.getPolicy.mockResolvedValue({
      enabled: true,
      allowed_actions: ["cart_recovery_message"],
      allowed_channels: ["email"],
      max_discount_pct: 0,
      max_messages_per_customer_24h: 1,
      max_actions_per_store_24h: 25,
      kill_switch: false,
    });

    render(<Automation />);

    expect(await screen.findByText("shop.example.test · shopify")).toBeInTheDocument();
    expect(await screen.findByText("Store authorization will be enabled after saving")).toBeInTheDocument();
    expect(automationApi.getPolicy).toHaveBeenCalledWith("store-1");
  });
});
