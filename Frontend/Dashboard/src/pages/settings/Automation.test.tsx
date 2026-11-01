import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { MemoryRouter } from "react-router-dom";
import { DISABLED_AUTOMATION_POLICY } from "@/lib/betaAutomation";
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
    vi.resetAllMocks();
  });

  it("does not load policies for a member", () => {
    setRole("member");

    render(<MemoryRouter><Automation /></MemoryRouter>);

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

    render(<MemoryRouter><Automation /></MemoryRouter>);

    expect(await screen.findByText("shop.example.test · shopify")).toBeInTheDocument();
    expect(await screen.findByText("Existing authorisation recorded; recovery is deferred")).toBeInTheDocument();
    expect(automationApi.getPolicy).toHaveBeenCalledWith("store-1");
  });
});

const sampleStore = { id: 'store-1', platform: 'shopify', shop_domain: 'shop.example.test', status: 'active' };
describe('Automation request and save states', () => {
  beforeEach(() => { vi.resetAllMocks(); setRole('owner'); });
  const renderPage = () => render(<MemoryRouter><Automation /></MemoryRouter>);
  it('keeps loading separate from a verified empty result', async () => {
    let resolve: (stores: typeof sampleStore[]) => void;
    automationApi.listStores.mockImplementation(() => new Promise(done => { resolve = done; }));
    renderPage();
    expect(screen.getByLabelText('Loading connected stores')).toBeInTheDocument();
    expect(screen.queryByText('Connect an active store first')).not.toBeInTheDocument();
    resolve!([]);
    expect(await screen.findByRole('link', { name: 'Open Integrations' })).toHaveAttribute('href', '/dashboard/integrations');
  });
  it('retries store failures without claiming there is no store', async () => {
    automationApi.listStores.mockRejectedValueOnce(new Error('Store service unavailable')).mockResolvedValueOnce([]);
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Store service unavailable');
    expect(screen.queryByText('Connect an active store first')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry stores' }));
    expect(await screen.findByText('Connect an active store first')).toBeInTheDocument();
    expect(automationApi.listStores).toHaveBeenCalledTimes(2);
  });
  it('hides the policy form while loading and after failure; retries safely', async () => {
    automationApi.listStores.mockResolvedValue([sampleStore]);
    let reject: (error: Error) => void;
    automationApi.getPolicy.mockImplementationOnce(() => new Promise((_done, fail) => { reject = fail; }))
      .mockResolvedValueOnce(DISABLED_AUTOMATION_POLICY);
    renderPage();
    expect(await screen.findByText('Loading store policy…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save automation policy' })).not.toBeInTheDocument();
    reject!(new Error('Policy request failed'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Policy request failed');
    expect(screen.queryByRole('button', { name: 'Save automation policy' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry policy' }));
    expect(await screen.findByRole('button', { name: 'Save automation policy' })).toBeEnabled();
    expect(screen.getByRole('switch', { name: 'Recovery authorisation' })).toBeDisabled();
  });
  it('prevents duplicate writes and reports saved only after API success', async () => {
    automationApi.listStores.mockResolvedValue([sampleStore]);
    automationApi.getPolicy.mockResolvedValue(DISABLED_AUTOMATION_POLICY);
    let resolve: (policy: typeof DISABLED_AUTOMATION_POLICY) => void;
    automationApi.updatePolicy.mockImplementation(() => new Promise(done => { resolve = done; }));
    renderPage();
    const save = await screen.findByRole('button', { name: 'Save automation policy' });
    fireEvent.click(save); fireEvent.click(save);
    expect(automationApi.updatePolicy).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Automation policy saved.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();
    resolve!(DISABLED_AUTOMATION_POLICY);
    expect(await screen.findByText('Automation policy saved.')).toBeInTheDocument();
  });
  it('keeps a failed save recoverable without a false success', async () => {
    automationApi.listStores.mockResolvedValue([sampleStore]);
    automationApi.getPolicy.mockResolvedValue(DISABLED_AUTOMATION_POLICY);
    automationApi.updatePolicy.mockRejectedValueOnce(new Error('Save unavailable')).mockResolvedValueOnce(DISABLED_AUTOMATION_POLICY);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Save automation policy' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Save unavailable');
    expect(screen.queryByText('Automation policy saved.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save automation policy' }));
    expect(await screen.findByText('Automation policy saved.')).toBeInTheDocument();
  });
  it('allows an admin to pause an existing policy without enabling recovery', async () => {
    setRole('admin');
    automationApi.listStores.mockResolvedValue([sampleStore]);
    automationApi.getPolicy.mockResolvedValue({ ...DISABLED_AUTOMATION_POLICY, enabled: true, kill_switch: false });
    automationApi.updatePolicy.mockResolvedValue(DISABLED_AUTOMATION_POLICY);
    renderPage();
    const toggle = await screen.findByRole('switch', { name: 'Recovery authorisation' });
    expect(screen.getByRole('button', { name: 'Save automation policy' })).toBeDisabled();
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: 'Save automation policy' }));
    await waitFor(() => expect(automationApi.updatePolicy).toHaveBeenCalledWith('store-1', expect.objectContaining({ enabled: false, kill_switch: true })));
  });
});
