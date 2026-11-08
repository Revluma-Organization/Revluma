import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import api from "@/lib/api";
import Overview from "./Overview";
import RevIntell from "./RevIntell";
import { ccPriorityFixture } from "@/test/commandCenterFixtures";

vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { full_name: "Test Merchant" } }) }));
vi.mock("@/store", () => ({ useThemeStore: (select: (state: { theme: string }) => unknown) => select({ theme: "light" }) }));
vi.mock("@/lib/api", () => {
  const mockedApi = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
  class FixtureApiError extends Error { constructor(public status: number, message: string, public body?: unknown) { super(message); } }
  return { default: mockedApi, api: mockedApi, ApiError: FixtureApiError };
});
vi.mock("@/lib/revStream", () => ({ streamRevAnswer: vi.fn(), RevStreamError: class extends Error {} }));

const reply = (data: unknown) => ({ ok: true, status: 200, data: { success: true, data } });
const flowData = () => ({ ...ccPriorityFixture({ title: "Revenue fell" }), activity: [{ id: "a1", kind: "business" as const, type: "revenue_change", finding_id: "finding-1", label: "Revenue fell", occurred_at: "2026-11-08T10:00:00Z", note: "Verified finding." }] });
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
