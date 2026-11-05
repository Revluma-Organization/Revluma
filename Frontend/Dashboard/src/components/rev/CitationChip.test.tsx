import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import CitationChip from "./CitationChip";
import type { EvidenceItem } from "@/lib/revStream";

const item: EvidenceItem = {
  id: "ev-1",
  metric: "recorded_order_value",
  label: "Recorded order value",
  value: 1250,
  unit: "currency",
  currency: "USD",
  status: "available",
  period: { start: "2026-10-01T00:00:00Z", end: "2026-10-31T23:59:59Z" },
  source: "Shopify orders",
  definition: "Recorded non-cancelled order value.",
  limitations: ["Excludes canceled orders"],
};

describe("CitationChip marker variant", () => {
  it("keeps the pinned aria contract and shows no preview until asked", () => {
    render(<CitationChip number={1} item={item} tone="light" variant="marker" onOpen={vi.fn()} />);
    const chip = screen.getByRole("button", { name: "Citation 1: Recorded order value — open evidence" });
    expect(chip).toHaveTextContent("1");
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("opens a payload-only preview on hover with source, period, definition and limitation", () => {
    render(<CitationChip number={1} item={item} tone="light" variant="marker" onOpen={vi.fn()} />);
    fireEvent.mouseEnter(screen.getByRole("button", { name: /Citation 1/ }).parentElement!);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("Recorded order value");
    expect(tooltip).toHaveTextContent("Shopify orders");
    expect(tooltip).toHaveTextContent("Recorded non-cancelled order value.");
    expect(tooltip).toHaveTextContent("Excludes canceled orders");
    expect(tooltip).toHaveTextContent(/USD/);
  });

  it("closes the preview after the pointer leaves", async () => {
    render(<CitationChip number={1} item={item} tone="light" variant="marker" onOpen={vi.fn()} />);
    const wrap = screen.getByRole("button", { name: /Citation 1/ }).parentElement!;
    fireEvent.mouseEnter(wrap);
    expect(screen.getByRole("tooltip")).toBeTruthy();
    fireEvent.mouseLeave(wrap);
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
  });

  it("opens on keyboard focus and closes on Escape — the preview is not pointer-only", () => {
    render(<CitationChip number={1} item={item} tone="light" variant="marker" onOpen={vi.fn()} />);
    const chip = screen.getByRole("button", { name: /Citation 1/ });
    fireEvent.focus(chip);
    expect(screen.getByRole("tooltip")).toBeTruthy();
    expect(chip).toHaveAttribute("aria-describedby");
    fireEvent.keyDown(chip, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("still opens the evidence panel on click — the preview never replaces the source of truth", () => {
    const onOpen = vi.fn();
    render(<CitationChip number={1} item={item} tone="light" variant="marker" onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: /Citation 1/ }));
    expect(onOpen).toHaveBeenCalledWith("ev-1");
  });

  it("reads Not supplied for absent fields instead of inventing them", () => {
    const sparse: EvidenceItem = { ...item, source: "", definition: "", limitations: [], period: { start: "", end: "" } };
    render(<CitationChip number={2} item={sparse} tone="dark" variant="marker" onOpen={vi.fn()} />);
    fireEvent.mouseEnter(screen.getByRole("button", { name: /Citation 2/ }).parentElement!);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("Not supplied");
    expect(tooltip.textContent).not.toContain("Period.");
  });
});

describe("CitationChip source variant", () => {
  it("keeps the pinned Sources-row contract and previews on hover", () => {
    render(<CitationChip number={1} item={item} tone="light" variant="source" onOpen={vi.fn()} />);
    const chip = screen.getByRole("button", { name: "Open evidence: Recorded order value" });
    expect(chip).toHaveTextContent("1.");
    expect(chip).toHaveTextContent("Recorded order value");
    fireEvent.mouseEnter(chip.parentElement!);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Shopify orders");
  });
});
