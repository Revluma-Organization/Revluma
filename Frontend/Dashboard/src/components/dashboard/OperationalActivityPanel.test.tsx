import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { api } from "@/lib/api";
import OperationalActivityPanel from "./OperationalActivityPanel";
import { operationalActivityFixture } from "./businessHealthFixtures";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", async importOriginal => ({ ...await importOriginal<typeof import("react-router-dom")>(), useNavigate: () => navigate }));

function mockActivity(body: unknown) {
  vi.spyOn(api, "get").mockResolvedValue(body as never);
}

describe("Task 218 OperationalActivityPanel", () => {
  afterEach(() => { vi.restoreAllMocks(); navigate.mockReset(); });

  it("renders recorded events with closed type and severity labels", async () => {
    mockActivity({ ok: true, status: 200, data: { success: true, data: operationalActivityFixture() } });
    render(<MemoryRouter><OperationalActivityPanel storeId="store-1" /></MemoryRouter>);
    await screen.findByText("2 recorded"); // wait for the store-scoped fetch
    expect(screen.getByRole("heading", { name: "Operational history" })).toBeInTheDocument();
    expect(screen.getByText("Synchronization completed for orders")).toBeInTheDocument();
    expect(screen.getByText("Net sales declined")).toBeInTheDocument();
    expect(screen.getByText("Synchronization")).toBeInTheDocument();
    expect(screen.getByText("Finding")).toBeInTheDocument();
    expect(screen.getByText("Info")).toBeInTheDocument();
    expect(screen.getByText("Warning")).toBeInTheDocument();
  });

  it("paginates with the server cursor and appends without losing items", async () => {
    const extraItem = {
      event_id: "lifecycle:sync:connected:2026-11-02T08:00:00Z",
      type: "integration_change",
      category: "integration",
      severity: "info",
      title: "Integration moved to connected",
      detail: "reason: none",
      status: "connected",
      occurred_at: "2026-11-02T08:00:00Z",
      received_at: "2026-11-02T08:00:03Z",
      source: "integration_lifecycle_events",
      link: "/integrations",
    };
    const page1 = operationalActivityFixture({ has_more: true, next_cursor: "c2VjdW5kLXBhZ2U=", total: 3, returned: 2 });
    const page2 = operationalActivityFixture({ items: [extraItem as never], has_more: false, next_cursor: null, total: 3, returned: 1 });
    const get = vi.spyOn(api, "get")
      .mockResolvedValueOnce({ ok: true, status: 200, data: { success: true, data: page1 } } as never)
      .mockResolvedValueOnce({ ok: true, status: 200, data: { success: true, data: page2 } } as never);
    render(<MemoryRouter><OperationalActivityPanel storeId="store-1" /></MemoryRouter>);
    const more = await screen.findByRole("button", { name: "Load more (1 remaining)" });
    fireEvent.click(more);
    expect(await screen.findByText("Integration moved to connected")).toBeInTheDocument();
    expect(screen.getByText("3 recorded")).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[1][1]).toMatchObject({ limit: 15, cursor: "c2VjdW5kLXBhZ2U=" });
    // Page 1 items were preserved by the append.
    expect(screen.getByText("Synchronization completed for orders")).toBeInTheDocument();
  });

  it("fails closed on a payload that does not match the closed contract", async () => {
    mockActivity({ ok: true, status: 200, data: { success: true, data: { contract_version: "command-center-v1", activity: [] } } });
    render(<MemoryRouter><OperationalActivityPanel storeId="store-1" /></MemoryRouter>);
    expect(await screen.findByText(/Operational history is unavailable right now/)).toBeInTheDocument();
  });

  it("shows an honest empty state for an empty window", async () => {
    mockActivity({ ok: true, status: 200, data: { success: true, data: operationalActivityFixture({ items: [], total: 0, returned: 0, has_more: false }) } });
    render(<MemoryRouter><OperationalActivityPanel storeId="store-1" /></MemoryRouter>);
    expect(await screen.findByText(/No operational events recorded in the last 14 days/)).toBeInTheDocument();
  });

  it("only navigates to routes that exist", async () => {
    mockActivity({ ok: true, status: 200, data: { success: true, data: operationalActivityFixture() } });
    render(<MemoryRouter><OperationalActivityPanel storeId="store-1" /></MemoryRouter>);
    const views = await screen.findAllByRole("button", { name: "View" });
    expect(views.length).toBe(2);
    fireEvent.click(views[0]); // item 1 links to /integrations
    expect(navigate).toHaveBeenCalledWith("/dashboard/integrations");
    fireEvent.click(views[1]); // item 2 links to /findings → the Command Center (no standalone findings route)
    expect(navigate).toHaveBeenLastCalledWith("/dashboard/overview");
  });
});
