import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { RevInvestigationView } from "./RevInvestigationView";
import { RevMetricCards } from "./RevMetricCards";
import RevMarkdown from "./RevMarkdown";
import { deriveMetricCards } from "@/lib/revVisuals";
import type { EvidenceItem, RevAnswerPayload } from "@/lib/revStream";

// The commerce component catalog (adoption R5) and table charts (study §9):
// visuals appear only when the turn's own records or printed table support
// them, never while streaming, never in quiet modes.

beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  }
});
afterEach(cleanup);

const period = { start: "2026-10-01T00:00:00Z", end: "2026-10-31T23:59:59Z", timezone: "UTC" };
const previous = { start: "2026-09-01T00:00:00Z", end: "2026-09-30T23:59:59Z", timezone: "UTC" };
const item = (overrides: Partial<EvidenceItem> = {}): EvidenceItem => ({
  id: "ev-revenue", metric: "recorded_order_value", label: "Recorded order value",
  value: 1250, unit: "currency", currency: "USD", status: "available",
  source: "Shopify orders", definition: "Recorded non-cancelled order value.",
  period, ...overrides,
});
const payload = (overrides: Partial<RevAnswerPayload> = {}): RevAnswerPayload => ({
  read_only: true, response_type: "analysis", text: "Recorded order value rose this month.",
  response_mode: "comparison",
  evidence: {
    items: [item(), item({ id: "ev-orders", metric: "orders", label: "Orders", unit: "count", currency: null, value: 42 })],
    comparison_items: [item({ id: "ev-revenue-prev", value: 1000, period: previous })],
    validation: { valid: true, errors: [] },
  },
  ...overrides,
});

describe("RevMetricCards", () => {
  it("renders each card as one accessible sentence that opens the evidence", () => {
    const onOpen = vi.fn();
    render(<RevMetricCards cards={deriveMetricCards(payload())} onOpen={onOpen} />);
    const region = screen.getByRole("region", { name: "Key numbers" });
    const revenue = within(region).getByRole("button", { name: /^Recorded order value: USD 1,250.00, up USD 250.00 \(25%\) from USD 1,000.00 in the previous period\. Open evidence\.$/ });
    within(region).getByRole("button", { name: "Orders: 42. Open evidence." });
    fireEvent.click(revenue);
    expect(onOpen).toHaveBeenCalledWith("ev-revenue");
    expect(region).toHaveTextContent("vs previous");
    expect(region).toHaveTextContent("from retrieved store records");
  });

  it("names weaker trust on the card itself", () => {
    const cards = deriveMetricCards(payload({ evidence: { ...payload().evidence!, validation: { valid: false, errors: ["stale"] } } }));
    render(<RevMetricCards cards={cards} />);
    expect(screen.getAllByText("Unverified").length).toBeGreaterThan(0);
  });

  it("renders nothing without cards", () => {
    const { container } = render(<RevMetricCards cards={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("RevInvestigationView visuals", () => {
  it("shows key numbers for a finished comparison", () => {
    render(<RevInvestigationView payload={payload()} />);
    expect(screen.getByRole("region", { name: "Key numbers" })).toBeInTheDocument();
  });

  it("hides key numbers while streaming and in quiet modes", () => {
    const { rerender } = render(<RevInvestigationView payload={payload()} streaming />);
    expect(screen.queryByRole("region", { name: "Key numbers" })).not.toBeInTheDocument();
    rerender(<RevInvestigationView payload={payload({ response_mode: "conversational" })} />);
    expect(screen.queryByRole("region", { name: "Key numbers" })).not.toBeInTheDocument();
    rerender(<RevInvestigationView payload={payload({ understanding: { gate: "clarify" } })} />);
    expect(screen.queryByRole("region", { name: "Key numbers" })).not.toBeInTheDocument();
  });
});

describe("table chart view", () => {
  const table = [
    "| Product | Orders |",
    "| --- | --- |",
    "| Mug | 12 |",
    "| Tee | 30 |",
    "| Cap | 7 |",
  ].join("\n");

  it("offers a Table / Chart switch for a chartable table and keeps the table by default", async () => {
    render(<RevMarkdown text={table} />);
    const group = screen.getByRole("group", { name: "Table view" });
    expect(within(group).getByRole("button", { name: "Table" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("table")).toBeInTheDocument();
    fireEvent.click(within(group).getByRole("button", { name: "Chart" }));
    expect(await screen.findByText("Orders by product. Highest: Tee (30). Lowest: Cap (7).")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    fireEvent.click(within(group).getByRole("button", { name: "Table" }));
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("offers no chart while streaming or for a table without numbers", () => {
    const { rerender } = render(<RevMarkdown text={table} streaming />);
    expect(screen.queryByRole("group", { name: "Table view" })).not.toBeInTheDocument();
    rerender(<RevMarkdown text={"| Product | Note |\n| --- | --- |\n| Mug | slow |\n| Tee | fast |"} />);
    expect(screen.queryByRole("group", { name: "Table view" })).not.toBeInTheDocument();
  });
});
