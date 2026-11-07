import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import RevAnswerView from "./RevAnswerView";
import type { RevAnswerPayload } from "@/lib/revStream";

const payload = {
  response_type: "analysis",
  text: "Recorded order value changed during the reporting period.",
  investigation: {
    id: "investigation-1",
    intent: "revenue_investigation",
    status: "complete",
    period: { start: "2026-10-01T00:00:00Z", end: "2026-10-31T23:59:59Z", label: "October" },
    steps: [],
    follow_ups: [],
  },
  evidence: {
    items: [{
      id: "evidence-order-value",
      metric: "recorded_order_value",
      label: "Recorded order value",
      value: 1250,
      unit: "currency",
      currency: "USD",
      status: "available",
      period: { start: "2026-10-01T00:00:00Z", end: "2026-10-31T23:59:59Z" },
      source: "Shopify orders",
      definition: "Recorded non-cancelled order value.",
    }],
    comparison_items: [],
  },
  facts: [{
    text: "Recorded order value changed.",
    evidence_ids: ["evidence-order-value"],
  }],
} as unknown as RevAnswerPayload;

describe("RevAnswerView evidence references", () => {
  it("opens the evidence drawer on the exact record cited by a fact", () => {
    const onOpenEvidence = vi.fn();
    render(<RevAnswerView payload={payload} onOpenEvidence={onOpenEvidence} />);

    fireEvent.click(screen.getByRole("button", { name: "Open evidence: Recorded order value" }));

    expect(onOpenEvidence).toHaveBeenCalledWith("evidence-order-value");
  });
});

describe("RevAnswerView reliability disclosure", () => {
  it("names failed domains while preserving independently valid evidence", () => {
    render(<RevAnswerView payload={{
      ...payload,
      reliability: {
        contract_version: "rev-reliability-v1",
        failures: [{ category: "timeout", stage: "response_composition", retryable: true }],
        fallback_used: true,
        partial_results_preserved: true,
      },
    }} />);
    expect(screen.getByText(/Some checks did not complete/i).textContent).toMatch(/response composition/i);
    expect(screen.getByRole("button", { name: "Open evidence: Recorded order value" })).toBeTruthy();
  });
});

describe("RevAnswerView streaming discipline (ChatGPT-UI study §3/§6)", () => {
  const tablePayload = {
    ...payload,
    text: "Weekly summary:\n\n| Period | Orders |\n| --- | --- |\n| 2026-10-01 → 2026-10-07 | 12 |",
  } as unknown as RevAnswerPayload;

  it("renders the full answer while streaming but suppresses interactive exports until it completes", () => {
    const { rerender } = render(<RevAnswerView payload={tablePayload} streaming />);
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Copy CSV" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy Markdown" })).toBeNull();

    rerender(<RevAnswerView payload={tablePayload} />);
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy CSV" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy Markdown" })).toBeTruthy();
  });
});
