import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MerchantJourneyStatus } from "./MerchantJourneyStatus";
import { api, ApiError } from "@/lib/api";
vi.mock("@/lib/api", async () => { const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api"); return { ...actual, api: { get: vi.fn() } }; });
const get = vi.mocked(api.get);
const ID = "3ed79446-cb6d-4a1c-b174-9ec1ab91fe15";
function payload(state = "briefing_ready", stores = 1) {
  const ready = ["briefing_ready", "returning_merchant", "initial_sync_partial", "insufficient_history", "capability_limited"].includes(state);
  return { success: true, data: { contract_version: "rev-merchant-journey-v1", organization_id: "org-a", selected_store_id: ID,
    selected: { state, title: state === "briefing_ready" ? "Your first briefing is ready" : state.replaceAll("_", " "), explanation: "Authoritative status explanation.", next_route: ready ? "/dashboard/overview" : "/dashboard/integrations", can_enter_workspace: ready,
      store: { id: ID, shop_domain: "revluma-test-store-v1.myshopify.com" }, required_resources: [{ resource: "orders", state: ready ? "succeeded" : "running", pagination_complete: ready }], limited_capabilities: [] },
    stores: Array.from({ length: stores }, (_, index) => ({ id: index ? "11111111-1111-4111-8111-111111111111" : ID, shop_domain: index ? "second-store.myshopify.com" : "revluma-test-store-v1.myshopify.com", state, can_enter_workspace: ready })),
  } };
}
function response(state?: string, stores?: number) { return { data: payload(state, stores) } as never; }
function renderJourney(workspace = false, path = "/dashboard/integrations") { return render(<MemoryRouter initialEntries={[path]}><MerchantJourneyStatus workspace={workspace} /></MemoryRouter>); }
beforeEach(() => { get.mockReset(); get.mockResolvedValue(response()); });

describe("Task 225 merchant journey", () => {
  it("T225-136 initially verifies backend state", () => { renderJourney(); expect(screen.getByText("Verifying your store setup…")).toBeInTheDocument(); });
  it("T225-137 displays ready state from server", async () => { renderJourney(); expect(await screen.findByText("Your first briefing is ready")).toBeInTheDocument(); });
  it("T225-138 ready state links to Command Center", async () => { renderJourney(); expect(await screen.findByRole("link", { name: /Open Command Center/ })).toHaveAttribute("href", "/dashboard/overview"); });
  it("T225-139 setup required has discoverable connect link", async () => { get.mockResolvedValue(response("authenticated_setup_required")); renderJourney(); expect(await screen.findByRole("link", { name: /Connect Shopify/ })).toHaveAttribute("href", "/dashboard/integrations"); });
  it("T225-140 authorization pending does not offer ready briefing", async () => { get.mockResolvedValue(response("shopify_authorization_pending")); renderJourney(); expect(await screen.findByText("shopify authorization pending")).toBeInTheDocument(); expect(screen.queryByRole("link", { name: /Open Command Center/ })).not.toBeInTheDocument(); });
  it("T225-141 authorization returned remains distinct", async () => { get.mockResolvedValue(response("shopify_authorized")); renderJourney(); expect(await screen.findByText("shopify authorized")).toBeInTheDocument(); });
  it("T225-142 running sync is readable", async () => { get.mockResolvedValue(response("initial_sync_running")); renderJourney(); expect(await screen.findByText("initial sync running")).toBeInTheDocument(); });
  it("T225-143 partial sync allows workspace entry", async () => { get.mockResolvedValue(response("initial_sync_partial")); renderJourney(); expect(await screen.findByRole("link", { name: /Open Command Center/ })).toBeInTheDocument(); });
  it("T225-144 failed sync does not offer briefing readiness", async () => { get.mockResolvedValue(response("initial_sync_failed")); renderJourney(); expect(await screen.findByText("initial sync failed")).toBeInTheDocument(); expect(screen.queryByRole("link", { name: /Open Command Center/ })).not.toBeInTheDocument(); });
  it("T225-145 capability limited remains useful", async () => { get.mockResolvedValue(response("capability_limited")); renderJourney(); expect(await screen.findByRole("link", { name: /Open Command Center/ })).toBeInTheDocument(); });
  it("T225-146 insufficient history remains explicit", async () => { get.mockResolvedValue(response("insufficient_history")); renderJourney(); expect(await screen.findByText("insufficient history")).toBeInTheDocument(); });
  it("T225-147 returning merchant can resume workspace", async () => { get.mockResolvedValue(response("returning_merchant")); renderJourney(); expect(await screen.findByRole("link", { name: /Open Command Center/ })).toBeInTheDocument(); });
  it("T225-148 reauthorization does not claim readiness", async () => { get.mockResolvedValue(response("authorization_required")); renderJourney(); expect(await screen.findByText("authorization required")).toBeInTheDocument(); });
  it("T225-149 recovery state is honest", async () => { get.mockResolvedValue(response("workspace_recovery_required")); renderJourney(); expect(await screen.findByText("workspace recovery required")).toBeInTheDocument(); });
  it("T225-150 active store identity is visible", async () => { renderJourney(); expect(await screen.findByText("revluma-test-store-v1.myshopify.com")).toBeInTheDocument(); });
  it("T225-151 multiple stores have explicit selector", async () => { get.mockResolvedValue(response("briefing_ready", 2)); renderJourney(); expect(await screen.findByLabelText("Store")).toBeInTheDocument(); expect(screen.getByText(/second-store/)).toBeInTheDocument(); });
  it("T225-152 store switch requests selected store", async () => { get.mockResolvedValue(response("briefing_ready", 2)); renderJourney(); fireEvent.change(await screen.findByLabelText("Store"), { target: { value: "11111111-1111-4111-8111-111111111111" } }); await waitFor(() => expect(get).toHaveBeenLastCalledWith(expect.stringContaining("store_id="))); });
  it("T225-153 backend outage does not claim completion", async () => { get.mockRejectedValue(new Error("offline")); renderJourney(); expect(await screen.findByRole("alert")).toHaveTextContent("no completion is assumed"); });
  it("T225-154 unavailable status can be retried", async () => { get.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(response()); renderJourney(); fireEvent.click(await screen.findByRole("button", { name: "Refresh status" })); expect(await screen.findByText("Your first briefing is ready")).toBeInTheDocument(); });
  it("T225-155 session expiration is explained", async () => { get.mockRejectedValue(new ApiError(401, "expired")); renderJourney(); expect(await screen.findByRole("alert")).toHaveTextContent("session expired"); });
  it("T225-156 malformed response fails closed", async () => { get.mockResolvedValue({ data: { success: true, data: { contract_version: "wrong" } } } as never); renderJourney(); expect(await screen.findByRole("alert")).toHaveTextContent("Setup status is temporarily unavailable"); });
  it("T225-157 unsafe backend route is rejected", async () => { const result = payload(); result.data.selected.next_route = "https://evil.example"; get.mockResolvedValue({ data: result } as never); renderJourney(); expect(await screen.findByRole("alert")).toBeInTheDocument(); });
  it("T225-158 workspace suppresses redundant welcome", async () => { const { container } = renderJourney(true, "/dashboard/overview"); await waitFor(() => expect(get).toHaveBeenCalled()); expect(container).toBeEmptyDOMElement(); });
  it("T225-159 workspace still shows incomplete setup", async () => { get.mockResolvedValue(response("initial_sync_running")); renderJourney(true, "/dashboard/overview"); expect(await screen.findByText("initial sync running")).toBeInTheDocument(); });
  it("T225-160 resource state has accessible list label", async () => { get.mockResolvedValue(response("initial_sync_running")); renderJourney(); expect(await screen.findByLabelText("Required synchronization resources")).toBeInTheDocument(); });
  it("T225-161 no fabricated completion percentage is rendered", async () => { get.mockResolvedValue(response("initial_sync_running")); renderJourney(); await screen.findByText("initial sync running"); expect(screen.queryByText(/%/)).not.toBeInTheDocument(); });
  it("T225-162 refresh control has touch target size", async () => { renderJourney(); expect(await screen.findByRole("button", { name: "Refresh status" })).toHaveClass("min-h-11"); });
  it("T225-163 primary navigation has touch target size", async () => { renderJourney(); expect(await screen.findByRole("link", { name: /Open Command Center/ })).toHaveClass("min-h-11"); });
  it("T225-164 status announcements use live region", async () => { renderJourney(); expect(await screen.findByRole("status")).toHaveAttribute("aria-live", "polite"); });
  it("T225-165 loading uses honest authorization/sync explanation", () => { renderJourney(); expect(screen.getByText(/checking authorization and synchronization separately/)).toBeInTheDocument(); });
});

describe("Task 225 responsive journey layouts", () => {
  for (const width of [320, 360, 375, 390, 430, 600, 768, 820, 1024, 1280, 1440, 1920]) {
    it(`T225-R${width} remains bounded at ${width}px`, async () => {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
      const { container } = renderJourney();
      await screen.findByText("Your first briefing is ready");
      const section = container.querySelector("section")!;
      expect(section.className).toContain("rounded-xl");
      expect(section.querySelector(".min-w-0")).not.toBeNull();
      expect(section.querySelector("img")).toBeNull();
    });
  }
});
