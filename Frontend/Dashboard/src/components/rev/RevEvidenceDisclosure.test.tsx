import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import RevAnswerView from "./RevAnswerView";
import type { EvidenceItem, RevAnswerPayload, RevInvestigationMeta } from "@/lib/revStream";

// Evidence disclosure, inline citations and comparison layout contract
// (REV-CONVERSATION-EXPERIENCE-SPEC v1.0.0 §6, §7, I5). The disclosure may
// only restate what the payload actually carries: missing fields are labelled
// unavailable, never guessed.

type Evidence = NonNullable<RevAnswerPayload["evidence"]>;

const item = (overrides: Partial<EvidenceItem> = {}): EvidenceItem => ({
  id: "ev-current", metric: "recorded_order_value", label: "Recorded order value",
  value: 1250, unit: "currency", currency: "USD", status: "available",
  source: "Shopify orders", definition: "Recorded non-cancelled order value.",
  period: { start: "2026-10-01T00:00:00Z", end: "2026-10-31T23:59:59Z" },
  ...overrides,
});

const evidence = (items: EvidenceItem[]): Evidence => ({
  items, validation: { valid: true, errors: [] },
});

const investigation = (overrides: Partial<RevInvestigationMeta> = {}): RevInvestigationMeta => ({
  id: "inv-1", question: "How are sales?", intent: "revenue", status: "complete",
  period: { start: "2026-10-01T00:00:00Z", end: "2026-10-31T23:59:59Z" },
  steps: [], follow_ups: [], ...overrides,
});

const payload = (overrides: Partial<RevAnswerPayload> = {}): RevAnswerPayload => ({
  response_type: "analysis", read_only: true, text: "Recorded results.",
  evidence: evidence([item()]),
  investigation: investigation(),
  ...overrides,
});

afterEach(cleanup);

describe("How I checked disclosure", () => {
  it("is collapsed by default and expands on click", () => {
    render(<RevAnswerView payload={payload()} />);
    const summary = screen.getByText("How I checked");
    const details = summary.closest("details") as HTMLDetailsElement;
    expect(details).not.toBeNull();
    expect(details.open).toBe(false);
    fireEvent.click(summary);
    expect(details.open).toBe(true);
  });

  it("names the checks that ran with honest statuses", () => {
    render(<RevAnswerView payload={payload({
      investigation: investigation({
        steps: [
          { id: "s1", tool: "revenue_observations", label: "Reviewing recorded revenue", status: "completed" },
          { id: "s2", tool: "checkout_observations", label: "Checking checkout activity", status: "failed" },
          { id: "s3", tool: "data_coverage", label: "Certifying data coverage", status: "pending" },
        ],
      }),
    })} />);
    expect(screen.getByText("Checks that ran")).toBeInTheDocument();
    expect(screen.getByText(/Reviewing recorded revenue — completed/)).toBeInTheDocument();
    expect(screen.getByText(/Checking checkout activity — failed/)).toBeInTheDocument();
    expect(screen.getByText(/Certifying data coverage — did not run/)).toBeInTheDocument();
  });

  it("restates per-source detail and labels missing fields unavailable", () => {
    render(<RevAnswerView payload={payload({
      evidence: evidence([
        item({
          coverage: { orders_synced: 120, gaps: "none" },
          freshness: { state: "fresh", as_of: "2026-11-01T00:00:00Z", age_minutes: 42 },
          limitations: ["Refunds lag by a day."],
        }),
        item({ id: "ev-2", label: "Recorded refunds", source: "", definition: "", limitations: [] }),
      ]),
    })} />);
    expect(screen.getByText("Per-source detail")).toBeInTheDocument();
    expect(screen.getByText(/Recorded non-cancelled order value\./)).toBeInTheDocument();
    expect(screen.getByText(/Coverage: orders_synced: 120 · gaps: none/)).toBeInTheDocument();
    expect(screen.getByText(/Freshness: fresh · 2026-11-01T00:00:00Z · 42 minutes old/)).toBeInTheDocument();
    expect(screen.getByText(/Refunds lag by a day\./)).toBeInTheDocument();
    // The second record carries no source or definition: labelled, not invented.
    expect(screen.getAllByText(/Source: Unavailable · Definition: Unavailable/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Limitations: Unavailable/).length).toBeGreaterThan(0);
  });

  it("shows period and currency, labelling a missing currency unavailable", () => {
    render(<RevAnswerView payload={payload({
      evidence: evidence([item({ unit: "count", currency: null })]),
    })} />);
    expect(screen.getByText("Period and currency")).toBeInTheDocument();
    expect(screen.getByText(/Currency unavailable/)).toBeInTheDocument();
    expect(screen.queryByText(/USD/)).not.toBeInTheDocument();
  });

  it("stays hidden for quiet conversational answers even when records exist", () => {
    render(<RevAnswerView payload={{
      response_type: "chat", read_only: true, text: "Hey, good to see you.",
      response_mode: "conversational",
      investigation: investigation(),
      evidence: evidence([item()]),
    }} />);
    // The quiet gate — not an empty payload — is what keeps the answer clean.
    expect(screen.queryByText("How I checked")).not.toBeInTheDocument();
  });
});

describe("inline citations at the claim", () => {
  it("renders a numbered chip on the fact and opens the exact record", () => {
    const onOpen = vi.fn();
    render(<RevAnswerView onOpenEvidence={onOpen} payload={payload({
      text: "",
      facts: [{ text: "Twelve orders recorded.", evidence_ids: ["ev-current", "ev-absent"] }],
      evidence: evidence([item({ unit: "count", currency: null })]),
    })} />);
    // ev-absent does not resolve to a retrieved record, so it never becomes a chip.
    const chips = screen.getAllByRole("button", { name: /Citation \d+: .* — open evidence/ });
    expect(chips).toHaveLength(1);
    expect(chips[0]).toHaveTextContent("1");
    fireEvent.click(chips[0]);
    expect(onOpen).toHaveBeenCalledWith("ev-current");
  });

  it("numbers chips consistently with the sources list", () => {
    render(<RevAnswerView onOpenEvidence={vi.fn()} payload={payload({
      text: "",
      facts: [
        { text: "First claim.", evidence_ids: ["ev-2"] },
        { text: "Second claim.", evidence_ids: ["ev-current"] },
      ],
      evidence: evidence([item(), item({ id: "ev-2", label: "Recorded refunds" })]),
    })} />);
    // Citation order follows the cited-evidence list: ev-2 is cited first.
    expect(screen.getByRole("button", { name: "Citation 1: Recorded refunds — open evidence" })).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: "Citation 2: Recorded order value — open evidence" })).toHaveTextContent("2");
    expect(screen.getByRole("button", { name: "Open evidence: Recorded refunds" })).toHaveTextContent("1.");
  });
});

describe("comparison layout", () => {
  it("gives comparison facts their own section separate from plain facts", () => {
    render(<RevAnswerView payload={payload({
      facts: [{ text: "Twelve orders recorded.", evidence_ids: [] }],
      comparison_facts: [{ text: "Orders declined by 12% against the previous period.", evidence_ids: [] }],
    })} />);
    expect(screen.getByRole("heading", { name: "Facts" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Compared with the previous period" })).toBeInTheDocument();
    expect(screen.getByText("Orders declined by 12% against the previous period.")).toBeInTheDocument();
  });

  it("does not repeat a comparison fact already stated as a fact", () => {
    render(<RevAnswerView payload={payload({
      facts: [{ text: "Orders declined by 12%.", evidence_ids: [] }],
      comparison_facts: [{ text: "Orders declined by 12%.", evidence_ids: [] }],
    })} />);
    expect(screen.getAllByText("Orders declined by 12%.")).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "Compared with the previous period" })).not.toBeInTheDocument();
  });
});

describe("monetary provenance in quiet modes", () => {
  it("keeps the compact provenance line for a monetary quick verification", () => {
    render(<RevAnswerView payload={payload({
      response_mode: "quick_verification",
      text: "Recorded order value is $1,250 this period.",
    })} />);
    expect(screen.getByText(/Based on recorded store data/)).toBeInTheDocument();
    expect(screen.getByText(/USD/)).toBeInTheDocument();
  });

  it("omits the provenance line for a quiet non-monetary verification", () => {
    render(<RevAnswerView payload={payload({
      response_mode: "quick_verification",
      text: "Yes — your Shopify store is connected.",
      evidence: evidence([item({ unit: "count", currency: null, value: 1 })]),
    })} />);
    expect(screen.queryByText(/Based on recorded store data/)).not.toBeInTheDocument();
  });
});

describe("quiet verification chrome (transcript A)", () => {
  it("hides sources, evidence count, chips and disclosure on a non-monetary quick verification", () => {
    render(<RevAnswerView onOpenEvidence={vi.fn()} onFollowUp={vi.fn()} payload={payload({
      response_mode: "quick_verification",
      text: "Yes — your Shopify store is connected. The latest sync completed successfully.",
      evidence: evidence([item({ unit: "count", currency: null })]),
      facts: [{ text: "Your Shopify store is connected.", evidence_ids: ["ev-current"] }],
      investigation: investigation({ follow_ups: ["Compare with last week"] }),
    })} />);
    // Transcript A: no provenance table, no evidence count, no follow-up block.
    expect(screen.queryByText("Sources:")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Evidence/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Compare with last week")).not.toBeInTheDocument();
    expect(screen.queryByText("How I checked")).not.toBeInTheDocument();
    expect(screen.queryByText(/Based on recorded store data/)).not.toBeInTheDocument();
  });

  it("keeps compact provenance and sources for a monetary quick verification", () => {
    render(<RevAnswerView onOpenEvidence={vi.fn()} payload={payload({
      response_mode: "quick_verification",
      text: "Recorded order value is $1,250 for the window.",
      facts: [{ text: "Recorded order value was $1,250 for the period.", evidence_ids: ["ev-current"] }],
    })} />);
    expect(screen.getByText(/Based on recorded store data/)).toBeInTheDocument();
    expect(screen.getByText("Sources:")).toBeInTheDocument();
  });
});

describe("greeting chrome suppression (GREET-001)", () => {
  const greetingText = "Hey Chief, good to see you. How's your day going?\n\nWhenever you're ready, tell me what you're working on or what's on your mind, and we'll dig into it together.";

  it("renders a conversational turn as plain chat: no badges, provenance, disclosure or evidence button", () => {
    render(<RevAnswerView onOpenEvidence={vi.fn()} payload={payload({
      response_mode: "conversational",
      response_type: "chat",
      text: greetingText,
      evidence: evidence([]),
      investigation: investigation({ intent: "greeting", label: "Conversation", steps: [] }),
    })} />);
    expect(screen.getByText(/good to see you/)).toBeInTheDocument();
    expect(screen.queryByText(/Evidence unavailable/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Conversation/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Based on recorded store data/)).not.toBeInTheDocument();
    expect(screen.queryByText("How I checked")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Evidence/ })).not.toBeInTheDocument();
  });

  it("does not let an empty evidence shell upgrade a mode-less payload to investigation", () => {
    const shell: Record<string, unknown> = {
      ...payload({
        response_type: "chat",
        text: greetingText,
        evidence: evidence([]),
        investigation: investigation({ intent: "greeting", label: "Conversation", steps: [] }),
      }),
    };
    delete shell.response_mode;
    render(<RevAnswerView onOpenEvidence={vi.fn()} payload={shell as never} />);
    expect(screen.queryByText(/Evidence unavailable/i)).not.toBeInTheDocument();
    expect(screen.queryByText("How I checked")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Evidence/ })).not.toBeInTheDocument();
  });

  it("keeps the disclosure for a real investigation with steps", () => {
    render(<RevAnswerView payload={payload({
      response_mode: "investigation",
      investigation: investigation({ steps: [{ id: "store_health", status: "completed", label: "Store health" } as never] }),
    })} />);
    expect(screen.getByText("How I checked")).toBeInTheDocument();
  });
});
