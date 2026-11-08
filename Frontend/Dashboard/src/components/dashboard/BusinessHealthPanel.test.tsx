import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { api } from "@/lib/api";
import BusinessHealthPanel from "./BusinessHealthPanel";
import { businessHealthFixture } from "./businessHealthFixtures";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", async importOriginal => ({ ...await importOriginal<typeof import("react-router-dom")>(), useNavigate: () => navigate }));

function mockHealth(body: unknown) {
  vi.spyOn(api, "get").mockResolvedValue(body as never);
}

describe("Task 218 BusinessHealthPanel", () => {
  afterEach(() => { vi.restoreAllMocks(); navigate.mockReset(); });

  it("renders the five indicator cards and the overall status", async () => {
    mockHealth({ ok: true, status: 200, data: { success: true, data: businessHealthFixture() } });
    render(<MemoryRouter><BusinessHealthPanel storeId="store-1" /></MemoryRouter>);
    await screen.findByText("$42,510.50"); // wait for the store-scoped fetch
    expect(screen.getByRole("heading", { name: "Business health" })).toBeInTheDocument();
    // Overall + per-indicator status badges (all healthy in the fixture).
    expect(screen.getAllByText("Healthy").length).toBeGreaterThanOrEqual(5);
    // Category labels (unique exact texts).
    expect(screen.getByText("Revenue")).toBeInTheDocument();
    expect(screen.getByText("Checkouts")).toBeInTheDocument();
    expect(screen.getByText("Product availability")).toBeInTheDocument();
    expect(screen.getByText("Integration & sync")).toBeInTheDocument();
    // Values come from the store-scoped contract, formatted by category.
    expect(screen.getByText("$42,510.50")).toBeInTheDocument();
    expect(screen.getByText("312 orders")).toBeInTheDocument();
    expect(screen.getByText("9 abandoned")).toBeInTheDocument();
    expect(screen.getByText("1,180 available")).toBeInTheDocument();
    // The integration indicator renders the canonical state, never a number.
    expect(screen.getByText("Connected")).toBeInTheDocument();
    // Revenue components stay distinct (gross / refunded / net are not merged).
    expect(screen.getByText("$44,010.50")).toBeInTheDocument();
    expect(screen.getByText("$1,500.00")).toBeInTheDocument();
    // Conversion rate only when the backend asserted one.
    expect(screen.getByText("76.9%")).toBeInTheDocument();
  });

  it("fails closed on a payload that does not match the closed contract", async () => {
    // A different (valid) contract must never be rendered as business health.
    mockHealth({ ok: true, status: 200, data: { success: true, data: { contract_version: "command-center-v1", briefing: {} } } });
    render(<MemoryRouter><BusinessHealthPanel storeId="store-1" /></MemoryRouter>);
    expect(await screen.findByText(/Business health is unavailable right now/)).toBeInTheDocument();
    expect(screen.queryByText("$42,510.50")).not.toBeInTheDocument();
  });

  it("treats a contract version mismatch as unavailable", async () => {
    mockHealth({ ok: true, status: 200, data: { success: true, data: { ...businessHealthFixture(), contract_version: "rev-business-health-v2" } } });
    render(<MemoryRouter><BusinessHealthPanel storeId="store-1" /></MemoryRouter>);
    expect(await screen.findByText(/Business health is unavailable right now/)).toBeInTheDocument();
  });

  it("shows the investigate action only when the capability is real", async () => {
    mockHealth({ ok: true, status: 200, data: { success: true, data: businessHealthFixture() } });
    const { rerender } = render(<MemoryRouter><BusinessHealthPanel storeId="store-1" /></MemoryRouter>);
    expect(screen.queryByRole("button", { name: "Investigate with Rev" })).not.toBeInTheDocument();
    rerender(<MemoryRouter><BusinessHealthPanel storeId="store-1" canInvestigate /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Investigate with Rev" }));
    expect(navigate).toHaveBeenCalledWith("/dashboard/rev-intell");
  });

  it("progressive disclosure: the card leads with the value, details expand", async () => {
    mockHealth({ ok: true, status: 200, data: { success: true, data: businessHealthFixture() } });
    render(<MemoryRouter><BusinessHealthPanel storeId="store-1" /></MemoryRouter>);
    await screen.findAllByText("Details"); // cards render after the fetch
    expect(screen.getAllByText("Details").length).toBe(5);
    expect(screen.queryByText(/Illustrative metric definition/)).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByText("Details")[0]);
    expect(screen.getByText(/Illustrative metric definition/)).toBeInTheDocument();
    expect(screen.getByText(/All required domains are fresh/)).toBeInTheDocument();
  });
});
