import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import EvidencePanel from "./EvidencePanel";
import type { RevAnswerPayload } from "@/lib/revStream";

const evidence = {
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
} as unknown as RevAnswerPayload["evidence"];

describe("EvidencePanel focus", () => {
  it("expands the exact evidence record selected from an answer citation", () => {
    render(<EvidencePanel evidence={evidence} focusEvidenceId="evidence-order-value" />);

    expect(screen.getByRole("button", { name: /Recorded order value/ }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Evidence ID.")).toBeTruthy();
    expect(screen.getByText("evidence-order-value")).toBeTruthy();
  });
});
