import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { api } from "@/lib/api";
import Overview from "./Overview";
import type { CommandCenterData } from "@/components/command-center/types";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", async importOriginal => ({ ...await importOriginal<typeof import("react-router-dom")>(), useNavigate: () => navigate }));

const metric = (extra = {}) => ({ id: "net_sales_today", label: "Net sales today", value: 18420, unit: "money", currency: "USD", definition: "Order totals net of refunds.", availability: "available", availability_reason: null, reporting_period: { timezone: "UTC" }, zero_semantics: null, ...extra });
const finding = (extra = {}) => ({ id: "finding-1", store_id: "store-1", type: "revenue_change", severity: "high", title: "Net sales declined", description: "Recorded net sales declined between comparable periods.", detected_at: "2026-11-08T11:00:00Z", evidence_quality: "verified", evidence: { verified: true }, next_step: { label: "Investigate with Rev", route: "/dashboard/rev-intell?finding=finding-1" }, ...extra });
const resource = (extra = {}) => ({ store_id: "store-1", resource: "orders", label: "orders", availability: "available", reason: null, freshness: "fresh", last_success_at: "2026-11-08T11:50:00Z", last_attempt_at: "2026-11-08T11:50:00Z", sync_state: "succeeded", limitations: [], coverage: "complete", ...extra });
const fixture = (extra: Partial<CommandCenterData> = {}): CommandCenterData => ({
  contract_version: "command-center-v1", read_only: true, retrieved_at: "2026-11-08T12:00:00Z",
  context: { organization_id: "merchant-a", store: { id: "store-1", name: "revluma-test-store-v1.myshopify.com", platform: "shopify" }, currency: "USD", reporting_period: { kind: "current_and_previous_utc_day", timezone: "UTC", note: "UTC snapshot" }, comparison_period: { kind: "previous_utc_day", comparability: "same_metric_definition" } },
  business_state: { id: "state-1", version: "1.1", generated_at: "2026-11-08T11:55:00Z", data_freshness_at: "2026-11-08T11:50:00Z", computation_status: "complete", presentation_status: "current", stale: false, warnings: [] },
  integration: null,
  briefing: { headline: "Your latest synchronized business picture", summary: "The current UTC-day snapshot is available.", tone: "default", observation: null, implication: null, evidence_quality: "complete_snapshot", no_findings_note: "No open verified priority findings are recorded. This is not proof that no issue exists.", limitations: [], next_investigation: { kind: "explore_evidence", finding_id: null, label: "Explore the evidence with Rev", reason: "Investigate available order and checkout evidence.", route: "/dashboard/rev-intell" } },
  metrics: [metric() as CommandCenterData["metrics"][number]], findings: [], activity: [],
  evidence: { overall: "current", snapshot_generated_at: "2026-11-08T11:55:00Z", source_data_at: "2026-11-08T11:50:00Z", last_successful_sync_at: "2026-11-08T11:50:00Z", resources: [resource() as CommandCenterData["evidence"]["resources"][number]], limitations: [], unknown_semantics: "Null is never zero." },
  ...extra,
});
function mockApi(data: CommandCenterData) { vi.spyOn(api, "get").mockResolvedValue({ ok: true, status: 200, data: { success: true, data } }); }
async function renderPage(data: CommandCenterData) { mockApi(data); render(<MemoryRouter><Overview /></MemoryRouter>); await screen.findByText("Operational briefing"); }

describe("Task 216 Command Center", () => {
  afterEach(() => { vi.restoreAllMocks(); navigate.mockReset(); });

  it("places the operational briefing before supporting business sections", async () => {
    await renderPage(fixture());
    const briefing = screen.getByRole("heading", { name: "Your latest synchronized business picture" });
    const business = screen.getByRole("heading", { name: "Business situation" });
    expect(briefing.compareDocumentPosition(business) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("revluma-test-store-v1.myshopify.com")).toBeInTheDocument();
    expect(screen.getByText("Today & yesterday · UTC")).toBeInTheDocument();
  });

  it("healthy sufficient evidence stays calm and has no promotional cards", async () => {
    await renderPage(fixture());
    expect(screen.getByRole("heading", { name: "Your latest synchronized business picture" })).toBeInTheDocument();
    expect(screen.queryByText(/Execution intelligence/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Evidence-backed intelligence/i)).not.toBeInTheDocument();
  });

  it("verified revenue deterioration receives primary emphasis", async () => {
    await renderPage(fixture({ briefing: { ...fixture().briefing, headline: "Net sales declined", summary: "Recorded sales declined; the cause is not established.", tone: "attention", observation: "The evidence establishes the observation, not its cause." }, findings: [finding() as CommandCenterData["findings"][number]] }));
    expect(screen.getByRole("heading", { name: "Net sales declined", level: 2 })).toBeInTheDocument();
    expect(screen.getAllByText(/cause is not established|not its cause/).length).toBeGreaterThan(0);
  });

  it("inventory authorization failure is local and never zero stock", async () => {
    const limited = resource({ resource: "inventory.levels", label: "inventory levels", availability: "unauthorized", reason: "The required Shopify permission is unavailable.", coverage: "unknown" });
    await renderPage(fixture({ evidence: { ...fixture().evidence, resources: [resource() as CommandCenterData["evidence"]["resources"][number], limited as CommandCenterData["evidence"]["resources"][number]] } }));
    fireEvent.click(screen.getByText("Review resource freshness and coverage"));
    expect(screen.getByText("Limited access")).toBeInTheDocument();
    expect(screen.getByText("The required Shopify permission is unavailable.")).toBeInTheDocument();
    expect(screen.queryByText(/zero inventory|0 in stock/i)).not.toBeInTheDocument();
  });

  it("stale evidence is labelled and dated rather than presented as current", async () => {
    await renderPage(fixture({ business_state: { ...fixture().business_state, presentation_status: "stale", stale: true }, metrics: [metric({ availability: "stale", availability_reason: "Historical value, not current performance." }) as CommandCenterData["metrics"][number]] }));
    expect(screen.getAllByText("Stale").length).toBeGreaterThan(0);
    expect(screen.getByText(/Historical evidence remains available; it is not current performance/)).toBeInTheDocument();
  });

  it("new merchant synchronization does not fabricate comparisons", async () => {
    await renderPage(fixture({ briefing: { ...fixture().briefing, headline: "Revluma is preparing your first business overview", summary: "Comparisons remain limited until the required history is available." }, metrics: [metric({ value: null, availability: "not_synchronized", availability_reason: "Orders have not synchronized." }) as CommandCenterData["metrics"][number]] }));
    expect(screen.getByRole("heading", { name: "Revluma is preparing your first business overview" })).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("$18,420.00")).not.toBeInTheDocument();
  });

  it("no findings language is bounded by evidence and detector scope", async () => {
    await renderPage(fixture());
    expect(screen.getByText(/does not establish that no issue exists outside/)).toBeInTheDocument();
    expect(screen.queryByText(/Everything is healthy/i)).not.toBeInTheDocument();
  });

  it("unknown contradictory financial evidence remains unavailable", async () => {
    await renderPage(fixture({ metrics: [metric({ value: null, currency: null, availability: "unknown", availability_reason: "Conflicting currencies cannot be reconciled." }) as CommandCenterData["metrics"][number]] }));
    expect(screen.getByText("Unknown")).toBeInTheDocument();
    expect(screen.getByText("Conflicting currencies cannot be reconciled.")).toBeInTheDocument();
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
  });

  it("partial and failed generation states remain visible", async () => {
    await renderPage(fixture({ business_state: { ...fixture().business_state, presentation_status: "partial", computation_status: "partial" }, briefing: { ...fixture().briefing, headline: "A partial operational picture is available" } }));
    expect(screen.getByText("Evidence partial")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "A partial operational picture is available" })).toBeInTheDocument();
  });

  it("finding navigation preserves the selected finding id", async () => {
    await renderPage(fixture({ findings: [finding({ id: "abc/def", next_step: { label: "Investigate", route: "/dashboard/rev-intell?finding=abc%2Fdef" } }) as CommandCenterData["findings"][number]] }));
    fireEvent.click(screen.getByRole("button", { name: "Investigate" }));
    expect(navigate).toHaveBeenCalledWith("/dashboard/rev-intell?finding=abc%2Fdef");
  });

  it("business metrics include definitions and currency context", async () => {
    await renderPage(fixture());
    expect(screen.getByText("$18,420.00")).toBeInTheDocument();
    expect(screen.getByText(/Current and previous UTC day · USD/)).toBeInTheDocument();
    expect(screen.getAllByText(/Order totals net of refunds/).length).toBeGreaterThan(0);
  });

  it("system activity is not presented as merchant action", async () => {
    await renderPage(fixture({ activity: [{ id: "sync", kind: "system", type: "synchronization_completed", label: "Shopify synchronization completed", occurred_at: "2026-11-08T11:50:00Z", note: "System activity; not a merchant action or business event." }] }));
    expect(screen.getByText("system", { exact: true })).toBeInTheDocument();
    expect(screen.getByText(/not a merchant action/)).toBeInTheDocument();
  });

  it("failed API response shows recovery and no fabricated disconnected store", async () => {
    vi.spyOn(api, "get").mockRejectedValue(new Error("unavailable"));
    render(<MemoryRouter><Overview /></MemoryRouter>);
    expect(await screen.findByRole("alert")).toHaveTextContent("operational briefing is unavailable");
    expect(screen.queryByText("Not connected")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("manual refresh reuses the same authoritative endpoint", async () => {
    await renderPage(fixture());
    fireEvent.click(screen.getByRole("button", { name: "Refresh briefing" }));
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(api.get).toHaveBeenLastCalledWith("/rev/command-center", { signal: expect.any(AbortSignal) });
  });

  it("resource evidence is accessible through a keyboard-native disclosure", async () => {
    await renderPage(fixture());
    const disclosure = screen.getByText("Review resource freshness and coverage");
    expect(disclosure.tagName).toBe("SUMMARY");
    fireEvent.click(disclosure);
    expect(screen.getByText(/^Last success /)).toBeInTheDocument();
  });

  it("page sections fit a single-column mobile hierarchy without horizontal tables", async () => {
    await renderPage(fixture());
    expect(document.querySelectorAll("table")).toHaveLength(0);
    expect(document.querySelector("main")?.className).toContain("overflow-x-clip");
    expect(screen.getByRole("button", { name: "Refresh briefing" })).toBeInTheDocument();
  });
});
