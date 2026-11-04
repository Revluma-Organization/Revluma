import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import RevAnswerView from "@/components/rev/RevAnswerView";
import type { RevAnswerPayload } from "@/lib/revStream";

// Conversational intelligence upgrade §10/§16: a conversational, knowledge or
// clarification turn must never be rendered as an investigation report — not
// because of its own fields, and not because legacy/incidental metadata
// (an investigation shell, stale sections, facts) happens to ride along.
// The backend's `understanding.gate` and `response_mode` are authoritative;
// the frontend never infers "investigation" from structural leftovers.

const period = { start: "2026-10-28T00:00:00Z", end: "2026-11-03T00:00:00Z" };

/** Everything a report renderer could latch onto, without any real evidence. */
const incidentalReportFields = {
  investigation: {
    id: "inv-legacy",
    question: "hey",
    intent: "greeting",
    label: "Greeting",
    status: "complete",
    period,
    steps: [{ id: "s1", tool: "revenue_observations", label: "Checking revenue", status: "completed" }],
    follow_ups: ["Why did revenue change?"],
    tools_used: [],
  } as never,
  evidence: {
    items: [{
      id: "ev-1", metric: "orders", label: "Recorded orders", value: 3, unit: "count",
      currency: null, status: "available", period, source: "orders", definition: "Count.",
    }],
    limitations: [],
  } as never,
  response: { situation: "Store situation text.", insight: "Leftover insight." } as never,
  facts: [{ text: "Recorded orders fell by 12%.", evidence_ids: [] }] as never,
  hypotheses: [{ statement: "Maybe a holiday dip.", status: "hypothesis", verified: false, confidence: 0.5 }] as never,
  recommendations: [{ label: "Review checkout", why: "x", measure: "y", executed: false }] as never,
};

describe("quiet presentation contract (§10/§16)", () => {
  it("renders a conversational answer as conversation even with legacy report fields", () => {
    render(<RevAnswerView payload={{
      success: true, read_only: true, response_type: "chat",
      text: "Doing well, thank you for asking! Good to see you back.",
      response_mode: "conversational",
      understanding: { intent: "social", gate: "conversational", source: "fast_path", confidence: 1 },
      ...incidentalReportFields,
    } as RevAnswerPayload} />);
    expect(screen.getByText(/Doing well, thank you for asking/)).toBeInTheDocument();
    // No report scaffolding of any kind:
    expect(screen.queryByText(/Recommended next steps/)).not.toBeInTheDocument();
    expect(screen.queryByText("Facts")).not.toBeInTheDocument();
    expect(screen.queryByText(/Maybe a holiday dip/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Store situation text/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Leftover insight/)).not.toBeInTheDocument();
    expect(screen.queryByText(/How I checked/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Evidence verified/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Based on recorded store data/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Why did revenue change\?/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Evidence/ })).not.toBeInTheDocument();
  });

  it("trusts the gate over a missing response_mode with structural leftovers", () => {
    // Without `understanding`, the legacy fallback would read facts as an
    // investigation. The gate decision must win instead.
    render(<RevAnswerView payload={{
      success: true, read_only: true, response_type: "chat",
      text: "Thanks — appreciate you checking in.",
      understanding: { intent: "acknowledgement", gate: "conversational", source: "fast_path" },
      facts: [{ text: "Recorded orders fell by 12%.", evidence_ids: [] }] as never,
      investigation: { status: "complete", period, steps: [], label: "Leftover" } as never,
    } as RevAnswerPayload} />);
    expect(screen.getByText(/Thanks — appreciate you checking in/)).toBeInTheDocument();
    expect(screen.queryByText(/Recorded orders fell/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Based on recorded store data/)).not.toBeInTheDocument();
  });

  it("renders a clarification without report chrome", () => {
    render(<RevAnswerView payload={{
      success: true, read_only: true, response_type: "clarification",
      text: "Do you mean revenue or orders? Tell me which and I'll dig in.",
      response_mode: "conversational",
      understanding: { intent: "clarify", gate: "clarify", source: "model", confidence: 0.4 },
    } as RevAnswerPayload} />);
    expect(screen.getByText(/revenue or orders/)).toBeInTheDocument();
    expect(screen.queryByText(/Evidence verified/)).not.toBeInTheDocument();
    expect(screen.queryByText(/How I checked/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Insufficient store data/)).not.toBeInTheDocument();
  });

  it("keeps full rigour on investigative modes", () => {
    render(<RevAnswerView payload={{
      success: true, read_only: true, response_type: "analysis",
      text: "Recorded order value fell 12% against the prior period.",
      response_mode: "investigation",
      understanding: { intent: "revenue", gate: "tools", source: "fast_path" },
      facts: [{ text: "Recorded order value fell 12.0%.", evidence_ids: [] }] as never,
      recommendations: [{ label: "Review checkout", why: "Cart recovery slipped.", measure: "Weekly.", executed: false }] as never,
      investigation: { status: "complete", period, steps: [] } as never,
    } as RevAnswerPayload} />);
    expect(screen.getByText(/Recommended next steps/)).toBeInTheDocument();
    expect(screen.getByText("Facts")).toBeInTheDocument();
    expect(screen.getByText(/Based on recorded store data for/)).toBeInTheDocument();
  });
});
