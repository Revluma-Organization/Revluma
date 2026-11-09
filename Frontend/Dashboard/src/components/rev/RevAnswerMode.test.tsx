import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import RevAnswerView from "@/components/rev/RevAnswerView";
import { responseModeOf, type RevAnswerPayload } from "@/lib/revStream";

// Presentation-mode contract (REV-CONVERSATION-EXPERIENCE-SPEC v1.0.0 §2):
// the backend assigns the mode, the frontend validates it, and a simple answer
// must not carry report scaffolding.

const base = {
  success: true,
  response_type: "analysis",
  text: "Yes — your Shopify store is connected. The latest sync completed successfully.",
} as RevAnswerPayload;

const steps = [
  { id: "s1", tool: "store_health", label: "Checking your Shopify connection", status: "completed" },
  { id: "s2", tool: "data_coverage", label: "Checking the latest sync", status: "completed" },
] as never;

const period = { start: "2026-10-28T00:00:00Z", end: "2026-11-03T00:00:00Z" };

describe("response mode contract", () => {
  it("validates assigned modes and rejects unknown values", () => {
    expect(responseModeOf({ response_mode: "quick_verification" })).toBe("quick_verification");
    expect(responseModeOf({ response_mode: "sparkly" })).toBeNull();
    expect(responseModeOf({})).toBeNull();
    expect(responseModeOf(null)).toBeNull();
  });

  it("renders an assigned conversational answer without report scaffolding", () => {
    render(<RevAnswerView payload={{
      ...base,
      response_mode: "conversational",
      mode_reason: "the question needs no store investigation",
      investigation: { steps, status: "complete", period } as never,
    }} />);
    expect(screen.getByText(/your Shopify store is connected/)).toBeInTheDocument();
    // No completed timeline above a simple answer, no provenance line, no pill.
    expect(screen.queryByText(/Investigation complete/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Based on recorded store data/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Evidence verified/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Read-only/)).not.toBeInTheDocument();
  });

  it("shows live named progress while streaming and removes it afterwards", () => {
    const payload = {
      ...base,
      response_mode: "investigation",
      investigation: {
        status: "running",
        period,
        steps: [
          { id: "s1", tool: "revenue_observations", label: "Checking yesterday's revenue", status: "completed" },
          { id: "s2", tool: "refund_observations", label: "Reviewing orders and refunds", status: "running" },
        ],
      } as never,
    } as RevAnswerPayload;
    const view = render(<RevAnswerView payload={payload} streaming />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Reviewing orders and refunds");
    expect(status).not.toHaveTextContent(/\d+%|\d+\/\d+/);
    // The old card chrome is gone while streaming: progress is one quiet line.
    expect(screen.queryByRole("button", { name: /Investigating your store evidence/ })).not.toBeInTheDocument();
    const finished = ((payload.investigation as unknown as { steps?: Array<Record<string, unknown>> } | undefined)?.steps ?? [])
      .map(step => ({ ...step, status: "completed" }));
    view.rerender(<RevAnswerView payload={{ ...payload, investigation: { status: "complete", period, steps: finished } as never }} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("keeps a compact provenance line on investigative answers", () => {
    render(<RevAnswerView payload={{
      ...base,
      response_mode: "investigation",
      facts: [{ text: "Recorded orders fell by 12%.", evidence_ids: [] }] as never,
      investigation: { status: "complete", period, steps } as never,
    }} />);
    expect(screen.getByText(/Based on recorded store data for/)).toBeInTheDocument();
  });

  it("falls back to full rigour for legacy payloads without a mode", () => {
    render(<RevAnswerView payload={{
      ...base,
      facts: [{ text: "Recorded orders fell by 12%.", evidence_ids: [] }] as never,
      investigation: { status: "complete", period, steps } as never,
    }} />);
    expect(screen.getByText(/Based on recorded store data for/)).toBeInTheDocument();
  });
});
