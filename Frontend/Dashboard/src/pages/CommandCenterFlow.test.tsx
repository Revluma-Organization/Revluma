import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import api from "@/lib/api";
import Overview from "./Overview";
import RevIntell from "./RevIntell";
import { ccPriorityFixture } from "@/test/commandCenterFixtures";
import { operationalActivityFixture } from "@/test/businessHealthFixtures";

vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { full_name: "Test Merchant" } }) }));
vi.mock("@/store", () => ({ useThemeStore: (select: (state: { theme: string }) => unknown) => select({ theme: "light" }) }));
vi.mock("@/lib/api", () => {
  const mockedApi = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
  class FixtureApiError extends Error { constructor(public status: number, message: string, public body?: unknown) { super(message); } }
  return { default: mockedApi, api: mockedApi, ApiError: FixtureApiError };
});
vi.mock("@/lib/revStream", () => ({ streamRevAnswer: vi.fn(), RevStreamError: class extends Error {} }));

const reply = (data: unknown) => ({ ok: true, status: 200, data: { success: true, data } });
const flowData = () => ({
  ...ccPriorityFixture({ title: "Revenue fell" }),
  activity: [{ id: "a1", kind: "business" as const, type: "revenue_change", finding_id: "finding-1", label: "Revenue fell", occurred_at: "2026-11-08T10:00:00Z", note: "Verified finding." }],
  operational_activity: operationalActivityFixture({ items: [{ event_id: "finding:abc", type: "finding", category: "finding", severity: "warning", title: "Revenue fell", detail: "finding type: revenue_change", status: "open", occurred_at: "2026-11-08T10:00:00Z", received_at: "2026-11-08T10:00:02Z", source: "intelligence_findings", finding_id: "finding-1", link: "/findings" }], total: 1, returned: 1 }),
});
const renderFlow = () => render(<MemoryRouter initialEntries={["/dashboard/overview"]}><Routes><Route path="/dashboard/overview" element={<Overview />} /><Route path="/dashboard/rev-intell/:conversationId?" element={<RevIntell />} /></Routes></MemoryRouter>);

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Task 219 route-level end-to-end intelligence handoffs", () => {
  it("opens the real Rev workspace with the exact top-priority finding", async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === "/rev/command-center") return reply(flowData());
      if (url === "/rev/conversations") return reply([]);
      if (url === "/stores") return reply({ stores: [] });
      if (url === "/rev/findings/finding-1") return reply({ finding: { id: "finding-1", title: "Revenue fell", description: "Recorded revenue fell between equal UTC windows.", evidence: { private: "must not be exposed" } } });
      throw new Error(`Unexpected request: ${url}`);
    });
    renderFlow();
    fireEvent.click(await screen.findByRole("button", { name: "Investigate in Rev Intelligence" }));
    expect(await screen.findByText("Revenue fell")).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith("/rev/findings/finding-1");
    expect(document.body.textContent).not.toContain("must not be exposed");
  });

  it("loads additional persisted activity without duplicate initial fetches", async () => {
    const initial = operationalActivityFixture({ total: 2, returned: 1, has_more: true, next_cursor: "next-page", items: [{ event_id: "sync:one", type: "sync", category: "sync", severity: "info", title: "Orders synchronized", detail: "", status: "succeeded", occurred_at: "2026-11-08T10:00:00Z", received_at: "2026-11-08T10:00:01Z", source: "store_sync_domain_states", link: "/integrations" }] });
    const next = operationalActivityFixture({ total: 2, returned: 1, has_more: false, next_cursor: null, items: [{ event_id: "sync:two", type: "sync", category: "sync", severity: "info", title: "Products synchronized", detail: "", status: "succeeded", occurred_at: "2026-11-07T10:00:00Z", received_at: "2026-11-07T10:00:01Z", source: "store_sync_domain_states", link: "/integrations" }] });
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === "/rev/command-center") return reply({ ...flowData(), operational_activity: initial });
      if (url === "/stores/store-1/business-activity") return reply(next);
      if (url === "/rev/conversations") return reply([]);
      if (url === "/stores") return reply({ stores: [] });
      throw new Error(`Unexpected request: ${url}`);
    });
    renderFlow();
    fireEvent.click(await screen.findByRole("button", { name: "Load more (1 remaining)" }));
    expect(await screen.findByText("Products synchronized")).toBeInTheDocument();
    expect(screen.getByText("Orders synchronized")).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith("/stores/store-1/business-activity", { cursor: "next-page", limit: 20, signal: expect.any(AbortSignal) });
    expect(screen.queryByRole("button", { name: /Load more/ })).not.toBeInTheDocument();
  });

  it("keeps verified activity visible when a later page fails", async () => {
    const initial = operationalActivityFixture({ total: 2, returned: 1, has_more: true, next_cursor: "next-page", items: [{ event_id: "sync:one", type: "sync", category: "sync", severity: "info", title: "Orders synchronized", detail: "", status: "succeeded", occurred_at: "2026-11-08T10:00:00Z", received_at: "2026-11-08T10:00:01Z", source: "store_sync_domain_states", link: "/integrations" }] });
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === "/rev/command-center") return reply({ ...flowData(), operational_activity: initial });
      if (url === "/stores/store-1/business-activity") throw new Error("Unavailable");
      if (url === "/rev/conversations") return reply([]);
      if (url === "/stores") return reply({ stores: [] });
      throw new Error(`Unexpected request: ${url}`);
    });
    renderFlow();
    fireEvent.click(await screen.findByRole("button", { name: "Load more (1 remaining)" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("More activity could not be loaded");
    expect(screen.getByText("Orders synchronized")).toBeInTheDocument();
  });

  it("opens the exact investigation from a verified activity event", async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === "/rev/command-center") return reply(flowData());
      if (url === "/rev/conversations") return reply([]);
      if (url === "/stores") return reply({ stores: [] });
      if (url === "/rev/findings/finding-1") return reply({ finding: { id: "finding-1", title: "Revenue fell", description: "Recorded revenue fell between equal UTC windows." } });
      throw new Error(`Unexpected request: ${url}`);
    });
    renderFlow();
    fireEvent.click(await screen.findByRole("button", { name: "Investigate event" }));
    expect(await screen.findByText("Revenue fell")).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith("/rev/findings/finding-1");
  });
});
