import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RevInvestigationView } from "./RevInvestigationView";
import type { EvidenceItem, RevAnswerPayload, RevInvestigationMeta } from "@/lib/revStream";

// Phase 5E — the evidence-first workspace renderer. One turn renders as an
// investigation hierarchy (summary → evidence → findings → next steps) built
// only from the payload's own contract: classifications come from record
// status plus the validation block, missing values never render as zero,
// and confidence renders only as the backend's own sentence.

type Evidence = NonNullable<RevAnswerPayload["evidence"]>;

const item = (overrides: Partial<EvidenceItem> = {}): EvidenceItem => ({
  id: "ev-current", metric: "recorded_order_value", label: "Recorded order value",
  value: 1250, unit: "currency", currency: "USD", status: "available",
  source: "Shopify orders", definition: "Recorded non-cancelled order value.",
  period: { start: "2026-10-01T00:00:00Z", end: "2026-10-31T23:59:59Z" },
  ...overrides,
});

const evidence = (items: EvidenceItem[], overrides: Partial<Evidence> = {}): Evidence => ({
  items, validation: { valid: true, errors: [] }, ...overrides,
});

const investigation = (overrides: Partial<RevInvestigationMeta> = {}): RevInvestigationMeta => ({
  id: "inv-1", question: "How are sales?", intent: "revenue", status: "complete",
  period: { start: "2026-10-01T00:00:00Z", end: "2026-10-31T23:59:59Z" },
  steps: [], follow_ups: [], ...overrides,
});

const payload = (overrides: Partial<RevAnswerPayload> = {}): RevAnswerPayload => ({
  response_type: "analysis", read_only: true, text: "Recorded results.",
  response_mode: "investigation",
  evidence: evidence([item()]),
  investigation: investigation(),
  ...overrides,
});

/** Assert sections appear in investigation order in the DOM. */
const expectOrder = (...labels: string[]) => {
  const sections = labels.map(label => screen.getByRole("region", { name: label }));
  for (let i = 1; i < sections.length; i++) {
    expect(sections[i - 1].compareDocumentPosition(sections[i]) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
  }
};

afterEach(cleanup);

describe("investigation hierarchy", () => {
  it("renders summary, evidence, findings and next steps in order", () => {
    render(<RevInvestigationView payload={payload({
      facts: [{ text: "Twelve orders recorded.", evidence_ids: ["ev-current"] }],
      recommendations: [{ label: "Review refunds", why: "Refunds rose.", measure: "Refund rate", executed: false }],
    })} />);
    expectOrder("Executive summary", "Evidence", "Findings", "Next steps");
  });

  it("shows the conclusion first, then sections, then the confidence sentence", () => {
    render(<RevInvestigationView payload={payload({
      text: "Conclusion: sales held steady.",
      response: {
        sections: [{ id: "s1", label: "Detail", text: "Order volume was flat week over week." }],
        confidence: {
          category: "moderate", claims: {},
          communication: "Moderate confidence: coverage is complete but refunds lag.",
        },
      },
    })} />);
    const summary = screen.getByRole("region", { name: "Executive summary" });
    const text = summary.textContent ?? "";
    const conclusion = text.indexOf("Conclusion: sales held steady.");
    const detail = text.indexOf("Order volume was flat");
    const confidence = text.indexOf("Moderate confidence");
    expect(conclusion).toBeGreaterThanOrEqual(0);
    expect(detail).toBeGreaterThan(conclusion);
    expect(confidence).toBeGreaterThan(detail);
  });

  it("renders no invented sections for an empty answer", () => {
    render(<RevInvestigationView payload={{ response_type: "analysis", read_only: true, text: "" }} />);
    expect(screen.getByText("No answer content was returned.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Executive summary" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Evidence" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Findings" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Next steps" })).not.toBeInTheDocument();
  });
});

describe("confidence discipline", () => {
  it("renders confidence as the backend sentence, never a badge or percentage", () => {
    render(<RevInvestigationView payload={payload({
      text: "Recorded results.",
      response: {
        confidence: {
          category: "high", claims: {},
          communication: "High confidence: every check completed on complete coverage.",
        },
      },
    })} />);
    expect(screen.getByText(/High confidence: every check completed/)).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it("hides a legacy numeric confidence instead of badging it", () => {
    render(<RevInvestigationView payload={payload({
      response: { confidence: { score: 0.92, basis: "model prior" } as never },
    })} />);
    expect(screen.queryByText(/0\.92/)).not.toBeInTheDocument();
    expect(screen.queryByText(/model prior/)).not.toBeInTheDocument();
  });
});

describe("evidence ledger", () => {
  it("shows each record's label, value, source and period", () => {
    render(<RevInvestigationView payload={payload()} />);
    const ledger = screen.getByRole("region", { name: "Evidence" });
    expect(within(ledger).getByText("Recorded order value")).toBeInTheDocument();
    expect(within(ledger).getByText("USD 1,250.00")).toBeInTheDocument();
    expect(within(ledger).getByText(/Shopify orders/)).toBeInTheDocument();
    expect(within(ledger).getByText(/01 Oct 2026 → 31 Oct 2026/)).toBeInTheDocument();
  });

  it("badges a record Verified only with clean validation, form and value", () => {
    render(<RevInvestigationView payload={payload()} />);
    expect(screen.getByText("Verified")).toBeInTheDocument();
  });

  it("refuses to upgrade an available record without validation", () => {
    render(<RevInvestigationView payload={payload({
      evidence: evidence([item()], { validation: { valid: false, errors: ["stale"] } }),
    })} />);
    expect(screen.queryByText("Verified")).not.toBeInTheDocument();
    expect(screen.getByText("Available — unverified")).toBeInTheDocument();
  });

  it("renders a missing value as Unavailable, never zero", () => {
    render(<RevInvestigationView payload={payload({
      evidence: evidence([item({ value: null })]),
    })} />);
    const ledger = screen.getByRole("region", { name: "Evidence" });
    expect(within(ledger).getByText("Unavailable")).toBeInTheDocument();
    expect(within(ledger).queryByText("0")).not.toBeInTheDocument();
    expect(within(ledger).queryByText("USD 0.00")).not.toBeInTheDocument();
  });

  it("tags previous-period records as Comparison without hiding their verification", () => {
    render(<RevInvestigationView payload={payload({
      evidence: evidence([item()], { comparison_items: [item({ id: "ev-prev", label: "Prior order value" })] }),
    })} />);
    expect(screen.getByText("Comparison")).toBeInTheDocument();
    // Both records validated: both badges stay visible.
    expect(screen.getAllByText("Verified")).toHaveLength(2);
  });

  it("expands a record to its definition, updated time, limits and id", () => {
    render(<RevInvestigationView payload={payload({
      evidence: evidence([item({
        freshness: { state: "fresh", as_of: "2026-11-01T00:00:00Z" },
        limitations: ["Refunds lag by a day."],
      })]),
    })} />);
    const toggle = screen.getByRole("button", { name: /Recorded order value.*Expand details/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/Refunds lag by a day/)).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/Recorded non-cancelled order value/)).toBeInTheDocument();
    expect(screen.getByText(/2026-11-01 00:00:00/)).toBeInTheDocument();
    expect(screen.getByText(/Refunds lag by a day/)).toBeInTheDocument();
    expect(screen.getByText("ev-current")).toBeInTheDocument();
  });

  it("marks stale records without inventing a refresh time", () => {
    render(<RevInvestigationView payload={payload({
      evidence: evidence([item({ freshness: { state: "stale", as_of: null } })]),
    })} />);
    fireEvent.click(screen.getByRole("button", { name: /Recorded order value.*Expand details/ }));
    expect(screen.getAllByText(/stale/).length).toBeGreaterThan(0);
    expect(screen.getByText((_content, node) =>
      node?.textContent === "Updated. Not supplied — stale")).toBeInTheDocument();
  });

  it("labels unsupported and unknown statuses honestly", () => {
    render(<RevInvestigationView payload={payload({
      evidence: evidence([
        item({ id: "a", label: "First", status: "unsupported" }),
        item({ id: "b", label: "Second", status: "mystery" as never }),
      ]),
    })} />);
    expect(screen.getByText("Not supported")).toBeInTheDocument();
    expect(screen.getByText("Unverified")).toBeInTheDocument();
    expect(screen.queryByText("Verified")).not.toBeInTheDocument();
  });

  it("opens the evidence panel from an expanded record", () => {
    const onOpen = vi.fn();
    render(<RevInvestigationView onOpenEvidence={onOpen} payload={payload()} />);
    fireEvent.click(screen.getByRole("button", { name: /Recorded order value.*Expand details/ }));
    fireEvent.click(screen.getByRole("button", { name: "Open in evidence panel" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe("findings hierarchy", () => {
  it("cites findings at the claim and drops unresolvable ids", () => {
    render(<RevInvestigationView payload={payload({
      text: "",
      facts: [{ text: "Twelve orders recorded.", evidence_ids: ["ev-current", "ev-absent"] }],
    })} />);
    const findings = screen.getByRole("region", { name: "Findings" });
    expect(within(findings).getByText(/Twelve orders recorded/)).toBeInTheDocument();
    // ev-absent resolves to nothing, so it never becomes a chip.
    expect(within(findings).getAllByRole("button", { name: /Citation \d+: .* — open evidence/ })).toHaveLength(1);
  });

  it("badges comparison facts as Calculated", () => {
    render(<RevInvestigationView payload={payload({
      text: "",
      comparison_facts: [{ text: "Revenue rose 5% on the prior period.", evidence_ids: ["ev-current"] }],
    })} />);
    expect(screen.getByText("Compared with the previous period")).toBeInTheDocument();
    expect(screen.getByText("Calculated")).toBeInTheDocument();
  });

  it("labels hypotheses as not verified", () => {
    render(<RevInvestigationView payload={payload({
      text: "",
      hypotheses: [{ statement: "A discount may explain the lift.", status: "hypothesis", verified: false, confidence: 0.4 }],
    })} />);
    expect(screen.getByText("Hypotheses — not verified")).toBeInTheDocument();
    expect(screen.getByText("Hypothesis")).toBeInTheDocument();
  });

  it("lists unknowns as unknowns", () => {
    render(<RevInvestigationView payload={payload({
      text: "", unknowns: ["Refund coverage for the period is incomplete."],
    })} />);
    expect(screen.getByText("Unknowns and limits")).toBeInTheDocument();
    expect(screen.getByText("Unknown")).toBeInTheDocument();
    expect(screen.getByText(/Refund coverage for the period is incomplete/)).toBeInTheDocument();
  });

  it("does not repeat a finding the summary already carries", () => {
    render(<RevInvestigationView payload={payload({
      text: "Twelve orders recorded.",
      facts: [{ text: "Twelve orders recorded.", evidence_ids: ["ev-current"] }],
    })} />);
    expect(screen.queryByRole("region", { name: "Findings" })).not.toBeInTheDocument();
  });
});

describe("next-step guidance", () => {
  it("renders recommendations as review text with the read-only disclaimer", () => {
    render(<RevInvestigationView payload={payload({
      recommendations: [{ label: "Review refunds", why: "Refunds rose.", measure: "Refund rate", executed: false }],
    })} />);
    const next = screen.getByRole("region", { name: "Next steps" });
    expect(within(next).getByText("Review refunds")).toBeInTheDocument();
    expect(within(next).getByText(/Refunds rose\. Measure: Refund rate/)).toBeInTheDocument();
    expect(within(next).getByText(/nothing was changed or sent/)).toBeInTheDocument();
    // No executing control: the section holds no button that is not a follow-up question.
    expect(within(next).queryByRole("button")).not.toBeInTheDocument();
  });

  it("sends follow-ups as new questions and hides them while streaming", () => {
    const onFollowUp = vi.fn();
    const props = {
      onFollowUp,
      payload: payload({ investigation: investigation({ follow_ups: ["Why did refunds rise?"] }) }),
    };
    const { rerender } = render(<RevInvestigationView {...props} />);
    const group = screen.getByRole("group", { name: "Continue investigating" });
    fireEvent.click(within(group).getByRole("button", { name: /Why did refunds rise/ }));
    expect(onFollowUp).toHaveBeenCalledWith("Why did refunds rise?");
    rerender(<RevInvestigationView {...props} streaming />);
    expect(screen.queryByRole("group", { name: "Continue investigating" })).not.toBeInTheDocument();
  });
});

describe("quiet and streaming behaviour", () => {
  it("keeps a conversational turn plain: body only, no report sections", () => {
    render(<RevInvestigationView payload={{
      response_type: "chat", read_only: true, text: "Hey, good to see you.",
      response_mode: "conversational",
      investigation: investigation(),
      evidence: evidence([item()]),
    }} />);
    expect(screen.getByText("Hey, good to see you.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Executive summary" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Evidence" })).not.toBeInTheDocument();
    expect(screen.queryByText("How I checked")).not.toBeInTheDocument();
  });

  it("shows the investigation timeline while streaming and hides follow-ups", () => {
    render(<RevInvestigationView streaming payload={payload({
      investigation: investigation({
        steps: [{ id: "s1", tool: "revenue_observations", label: "Reviewing recorded revenue", status: "running" }],
        follow_ups: ["Why did refunds rise?"],
      }),
    })} />);
    expect(screen.getByText(/Reviewing recorded revenue/)).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Continue investigating" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Evidence \(/ })).not.toBeInTheDocument();
  });
});

describe("warnings and degraded states", () => {
  it("warns when checks could not complete without estimating the gap", () => {
    render(<RevInvestigationView payload={payload({
      specialists: [{ name: "refunds", status: "partial", fact_count: 0 }],
    })} />);
    expect(screen.getByText("Some checks could not complete")).toBeInTheDocument();
    expect(screen.getByText(/nothing was estimated to fill the gap/)).toBeInTheDocument();
  });

  it("shows the honest state pill for partial evidence and hides it when verified", () => {
    const { rerender } = render(<RevInvestigationView payload={payload({
      evidence: evidence([item()], { validation: { valid: false, errors: ["stale"] } }),
    })} />);
    expect(screen.getByText("Evidence unverified")).toBeInTheDocument();
    rerender(<RevInvestigationView payload={payload()} />);
    expect(screen.queryByText("Evidence verified")).not.toBeInTheDocument();
  });

  it("keeps the How I checked disclosure collapsed by default", () => {
    render(<RevInvestigationView payload={payload({
      investigation: investigation({
        steps: [{ id: "s1", tool: "revenue_observations", label: "Reviewing recorded revenue", status: "completed" }],
      }),
    })} />);
    const summary = screen.getByText("How I checked");
    const details = summary.closest("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    fireEvent.click(summary);
    expect(details.open).toBe(true);
    expect(screen.getByText(/Reviewing recorded revenue — completed/)).toBeInTheDocument();
  });
});
