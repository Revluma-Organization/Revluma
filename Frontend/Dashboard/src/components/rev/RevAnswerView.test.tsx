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
