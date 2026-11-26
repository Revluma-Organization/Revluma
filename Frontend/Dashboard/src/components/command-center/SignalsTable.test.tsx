import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import axe from "axe-core";
import { SignalsTable } from "./SignalsTable";
import { SIGNALS_PAGE_SIZE } from "./signalsTable";
import { ccFinding, ccFixture } from "@/test/commandCenterFixtures";
import type { CommandCenterData, Finding } from "./types";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));

afterEach(() => {
  cleanup();
  navigate.mockReset();
});

const signal = (extra: Record<string, unknown> = {}) => ccFinding(extra) as Finding;
const limited = (extra: Record<string, unknown> = {}) =>
  signal({
    evidence: { ...ccFinding().evidence, classification: "unverified_observation" },
    confidence: { classification: "low", rationale: [], numerical_score: null },
    ...extra,
  });
const dataFor = (findings: Finding[], extra: Partial<CommandCenterData> = {}) =>
  ccFixture({ findings, ...extra });

function renderTable(data: CommandCenterData) {
  return render(
    <MemoryRouter>
      <SignalsTable data={data} />
    </MemoryRouter>,
  );
}

function bodyRows() {
  return screen.getAllByRole("row").slice(1);
}

function rowForTitle(title: string) {
  return screen.getByRole("rowheader", { name: new RegExp(title) }).closest("tr") as HTMLElement;
}

describe("SignalsTable", () => {
  it("renders every column from real finding fields", () => {
    renderTable(dataFor([signal()]));
    const row = rowForTitle("Net sales declined");
    const cells = within(row).getAllByRole("cell");
    expect(cells).toHaveLength(6);
    // Severity, category, verification, freshness, detected, action.
    expect(cells[0]).toHaveTextContent("High");
    expect(cells[1]).toHaveTextContent("orders");
    expect(cells[2]).toHaveTextContent("Verified");
    expect(cells[3].textContent).toMatch(/Fresh/);
    expect(cells[4].textContent).toMatch(/(\d+[mhd] ago|Just now|Yesterday|Recently)/);
    expect(cells[4].querySelector("span")?.getAttribute("title")).toContain("2026");
    within(cells[5]).getByRole("button", { name: "Inspect" });
    expect(screen.getByRole("status")).toHaveTextContent("Showing 1 of 1 signal");
  });

  it("filters by severity tier with real counts and pressed states", () => {
    renderTable(
      dataFor([
        signal({ id: "f1", severity: "critical", title: "Critical signal" }),
        signal({ id: "f2", severity: "medium", title: "Medium signal" }),
        signal({ id: "f3", severity: "low", title: "Low signal" }),
      ]),
    );
    const group = screen.getByRole("group", { name: "Filter by severity" });
    const all = within(group).getByRole("button", { name: "All (3)" });
    const criticalHigh = within(group).getByRole("button", { name: "Critical & High (1)" });
    expect(all).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(criticalHigh);
    expect(criticalHigh).toHaveAttribute("aria-pressed", "true");
    expect(bodyRows()).toHaveLength(1);
    expect(screen.getByRole("rowheader", { name: /Critical signal/ })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Showing 1 of 1 signal");
  });

  it("searches titles, descriptions, categories, and sources without touching other rows", () => {
    renderTable(
      dataFor([
        signal({ id: "f1", title: "Checkout conversion dropped sharply" }),
        signal({ id: "f2", title: "Inventory sync delayed", signal_category: "product_inventory" }),
      ]),
    );
    const search = screen.getByRole("searchbox", { name: /Search signals/ });
    fireEvent.change(search, { target: { value: "CHECKOUT" } });
    expect(bodyRows()).toHaveLength(1);
    expect(screen.getByRole("rowheader", { name: /Checkout conversion/ })).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "inventory" } });
    expect(bodyRows()).toHaveLength(1);
    expect(screen.getByRole("rowheader", { name: /Inventory sync/ })).toBeInTheDocument();
  });

  it("filters by verification state on the shared verified contract", () => {
    renderTable(
      dataFor([
        signal({ id: "f1", title: "Verified signal" }),
        limited({ id: "f2", title: "Limited signal" }),
      ]),
    );
    const verification = screen.getByRole("combobox", { name: "Filter by verification state" });
    fireEvent.change(verification, { target: { value: "evidence_limited" } });
    expect(bodyRows()).toHaveLength(1);
    expect(screen.getByRole("rowheader", { name: /Limited signal/ })).toBeInTheDocument();
  });

  it("offers a category filter only when several categories exist, and filters honestly", () => {
    const { rerender } = renderTable(dataFor([signal({ id: "f1" }), signal({ id: "f2" })]));
    expect(screen.queryByRole("combobox", { name: "Filter by category" })).not.toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <SignalsTable
          data={dataFor([signal({ id: "f1", title: "Revenue signal" }), signal({ id: "f2", title: "Inventory signal", signal_category: "product_inventory" })])}
        />
      </MemoryRouter>,
    );
    const category = screen.getByRole("combobox", { name: "Filter by category" });
    fireEvent.change(category, { target: { value: "Product & inventory" } });
    expect(bodyRows()).toHaveLength(1);
    expect(screen.getByRole("rowheader", { name: /Inventory signal/ })).toBeInTheDocument();
  });

  it("sorts by severity and detection while default order preserves the backend queue", () => {
    renderTable(
      dataFor([
        signal({ id: "f1", severity: "low", title: "Oldest low", detected_at: "2026-11-06T10:00:00Z" }),
        signal({ id: "f2", severity: "critical", title: "Newest critical", detected_at: "2026-11-09T10:00:00Z" }),
        signal({ id: "f3", severity: "high", title: "Middle high", detected_at: "2026-11-07T10:00:00Z" }),
      ]),
    );
    const titles = () =>
      screen.getAllByRole("rowheader").map((cell) => cell.querySelector("span")?.textContent);
    expect(titles()).toEqual(["Oldest low", "Newest critical", "Middle high"]);
    const sort = screen.getByRole("combobox", { name: "Sort signals" });
    fireEvent.change(sort, { target: { value: "severity" } });
    expect(titles()).toEqual(["Newest critical", "Middle high", "Oldest low"]);
    fireEvent.change(sort, { target: { value: "detected" } });
    expect(titles()).toEqual(["Newest critical", "Middle high", "Oldest low"]);
  });

  it("paginates long queues with honest remaining counts and resets on filter change", () => {
    const findings = Array.from({ length: 8 }, (_, index) =>
      signal({ id: `f${index + 1}`, severity: index === 0 ? "critical" : "low", title: `Signal ${index + 1}` }),
    );
    renderTable(dataFor(findings));
    expect(bodyRows()).toHaveLength(SIGNALS_PAGE_SIZE);
    expect(screen.getByRole("status")).toHaveTextContent("Showing 6 of 8 signals");
    fireEvent.click(screen.getByRole("button", { name: "Show more (2 remaining)" }));
    expect(bodyRows()).toHaveLength(8);
    expect(screen.getByRole("button", { name: "Show less" })).toBeInTheDocument();

    // A new filter restarts pagination from the first page.
    fireEvent.click(screen.getByRole("button", { name: /Low \(7\)/ }));
    expect(bodyRows()).toHaveLength(SIGNALS_PAGE_SIZE);
    expect(screen.getByRole("status")).toHaveTextContent("Showing 6 of 7 signals");
    fireEvent.click(screen.getByRole("button", { name: "Show more (1 remaining)" }));
    expect(bodyRows()).toHaveLength(7);
    fireEvent.click(screen.getByRole("button", { name: "Show less" }));
    expect(bodyRows()).toHaveLength(SIGNALS_PAGE_SIZE);
  });

  it("clears every filter, search, and sort back to the backend queue", () => {
    renderTable(
      dataFor([
        signal({ id: "f1", severity: "critical", title: "Critical signal" }),
        signal({ id: "f2", severity: "low", title: "Low signal" }),
      ]),
    );
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Low \(1\)/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Sort signals" }), { target: { value: "detected" } });
    expect(bodyRows()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(bodyRows()).toHaveLength(2);
    expect(screen.getByRole("button", { name: "All (2)" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("combobox", { name: "Sort signals" })).toHaveValue("priority");
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  });

  it("shows an honest no-results state with a working reset", () => {
    renderTable(dataFor([signal({ id: "f1", title: "Revenue signal" })]));
    fireEvent.change(screen.getByRole("searchbox", { name: /Search signals/ }), {
      target: { value: "no such signal" },
    });
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText("No signals match the current filters.")).toBeInTheDocument();
    const resets = screen.getAllByRole("button", { name: "Clear filters" });
    fireEvent.click(resets[resets.length - 1]);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(bodyRows()).toHaveLength(1);
  });

  it("shows an honest empty state without filter controls when the queue is empty", () => {
    renderTable(dataFor([]));
    expect(screen.getByText("No signals recorded")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Filter by severity" })).not.toBeInTheDocument();
  });

  it("renders stale and unknown evidence freshness honestly", () => {
    renderTable(
      dataFor([
        signal({
          id: "f1",
          title: "Stale signal",
          evidence_freshness: { state: "stale", as_of: "2026-11-08T11:00:00Z", observed_at: "2026-11-05T00:00:00Z", age_seconds: 3600, reason: "Sync delayed" },
        }),
        signal({
          id: "f2",
          title: "Unknown signal",
          evidence_freshness: { state: "", as_of: null, observed_at: null, age_seconds: null, reason: null },
        }),
      ]),
    );
    const staleCells = within(rowForTitle("Stale signal")).getAllByRole("cell");
    expect(staleCells[3].textContent).toMatch(/Stale/);
    const unknownCells = within(rowForTitle("Unknown signal")).getAllByRole("cell");
    expect(unknownCells[3]).toHaveTextContent("Unknown");
  });

  it("collapses secondary columns on small screens while keeping essentials in the row", () => {
    const { container } = renderTable(dataFor([signal()]));
    const headers = within(screen.getByRole("table")).getAllByRole("columnheader");
    const hidden = headers.filter((cell) => cell.className.includes("hidden"));
    expect(hidden.map((cell) => cell.textContent)).toEqual([
      "Category",
      "Verification",
      "Evidence freshness",
      "Detected",
    ]);
    for (const cell of hidden) {
      expect(cell.className).toContain("md:table-cell");
    }
    const meta = container.querySelector("tbody th .md\\:hidden") as HTMLElement;
    expect(meta.textContent).toMatch(/orders/);
    expect(meta.textContent).toMatch(/Verified/);
    expect(meta.textContent).toMatch(/Fresh/);
    expect(meta.textContent).toMatch(/Detected/);
  });

  it("opens the existing finding drawer from Inspect and returns focus on close", async () => {
    const primary = signal({ id: "f1", title: "Drawer signal" });
    renderTable(dataFor([primary], { priority_finding: primary }));
    const inspect = screen.getByRole("button", { name: "Inspect" });
    const row = rowForTitle("Drawer signal");
    fireEvent.click(inspect);

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAccessibleName("Drawer signal");
    expect(dialog.getAttribute("aria-label")).toBe("Full details for priority 1: Drawer signal");
    expect(row).toHaveAttribute("data-selected", "true");
    const scoped = within(dialog);
    expect(scoped.getByText("Drawer signal")).toBeInTheDocument();
    expect(scoped.getByLabelText("Key supporting evidence")).toBeInTheDocument();
    expect(scoped.getByText("Recommended next step")).toBeInTheDocument();
    expect(scoped.getByText("Why this is the priority")).toBeInTheDocument();

    fireEvent.click(scoped.getByRole("button", { name: "Ask Rev about this finding" }));
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(String(navigate.mock.calls[0][0])).toContain("/dashboard/rev-intell");

    fireEvent.click(scoped.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(document.activeElement).toBe(inspect));
    expect(row).not.toHaveAttribute("data-selected");
  });

  it("passes axe-core checks for the toolbar, table, and empty states", async () => {
    const { container, unmount } = renderTable(
      dataFor([
        signal({ id: "f1", severity: "critical" }),
        limited({ id: "f2", severity: "low", title: "Limited low signal" }),
      ]),
    );
    expect((await axe.run(container, { rules: { "color-contrast": { enabled: false } } })).violations).toEqual([]);
    unmount();

    const empty = renderTable(dataFor([]));
    expect(
      (await axe.run(empty.container, { rules: { "color-contrast": { enabled: false } } })).violations,
    ).toEqual([]);
    empty.unmount();
  });
});
