import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import RevAnswerView from "./RevAnswerView";
import EvidencePanel from "./EvidencePanel";
import InvestigationTimeline from "./InvestigationTimeline";
import { coveredBy, evidenceState, formatEvidenceValue, formatPeriod, formatTimestamp, normaliseRevAnswer } from "@/lib/revPresentation";
import type { EvidenceItem, InvestigationStep, RevAnswerPayload, RevInvestigationMeta } from "@/lib/revStream";

const item = (overrides: Partial<EvidenceItem> = {}): EvidenceItem => ({
  id: "ev-current", metric: "orders_count", label: "Recorded orders", value: 12, unit: "count",
  currency: null, status: "available", source: "orders", definition: "Recorded orders in the reporting period.",
  period: { start: "2026-10-01", end: "2026-11-01" }, ...overrides,
});
const evidence = (): NonNullable<RevAnswerPayload["evidence"]> => ({ items: [item()], validation: { valid: true, errors: [] } });
const payload = (overrides: Partial<RevAnswerPayload> = {}): RevAnswerPayload => ({
  response_type: "analysis", read_only: true, text: "Recorded results.", evidence: evidence(), ...overrides,
});
const step = (status: InvestigationStep["status"]): InvestigationStep => ({ id: status, tool: status, label: `${status} check`, status });
afterEach(cleanup);

describe("answer validation and content", () => {
  it.each([null, 42, "malformed", [], {}])("does not certify mixed evidence containing %j", malformed => {
    const mixed = { ...evidence(), items: [item(), malformed] } as unknown as RevAnswerPayload["evidence"];
    render(<RevAnswerView payload={payload({ evidence: mixed })} />);
    expect(screen.getByText("Evidence unverified")).toBeInTheDocument();
    expect(screen.queryByText("Evidence verified")).not.toBeInTheDocument();
  });
  it.each([null, 42, "malformed", [null], ["record"], {}])("rejects malformed comparison_items: %j", malformed => {
    expect(evidenceState({ ...evidence(), comparison_items: malformed } as unknown as RevAnswerPayload["evidence"])).toBe("unverified");
  });
  it.each([null, {}, "records", 42])("requires a valid items collection: %j", malformed => {
    expect(evidenceState({ ...evidence(), items: malformed, comparison_items: [item()] } as unknown as RevAnswerPayload["evidence"])).toBe("unverified");
  });
  it("treats empty evidence as unavailable, not verified", () => {
    expect(evidenceState({ ...evidence(), items: [] })).toBe("unavailable");
  });
  it.each([
    ["Revenue increased by 120%.", "Revenue increased by 20%."],
    ["Increase: 120%.", "20%"],
    ["Revenue increased by 20%.", "Revenue decreased by 20%."],
    ["Revenue did not increase by 20%.", "Revenue increased by 20%."],
    ["No evidence that revenue increased by 20%.", "Revenue increased by 20%."],
    ["Revenue did not increase.", "Revenue did increase."],
    ["Orders fell by -12%.", "Orders fell by +12%."],
    ["Lower order volume may contribute.", "Lower order values may contribute."],
    ["No evidence that\nrevenue increased by 20%.", "Revenue increased by 20%."],
    ["Measure: Revenue increased by 20%.", "Revenue increased by 20%."],
    ["Revenue increased by 20%?", "Revenue increased by 20%."],
    ["The share is 1/2.", "The share is 1 2."],
    ["Order value is USD 1,200.", "Order value is USD 1 200."],
  ])("preserves distinct claims: %s / %s", (body, insight) => {
    expect(coveredBy(body, insight)).toBe(false);
    render(<RevAnswerView payload={payload({ text: body, response: { insight } })} />);
    expect(screen.getByRole("heading", { name: "Insight" })).toBeInTheDocument();
    expect(screen.getByText(insight)).toBeInTheDocument();
  });
  it("recognises complete duplicated paragraphs, sentences and markdown blocks", () => {
    expect(coveredBy("## Facts\n\n- Revenue increased by **20%**.\n\nOrders are unchanged.", "Revenue increased by 20%.")).toBe(true);
    expect(coveredBy("Revenue increased by 20%. Orders are unchanged.", "Orders are unchanged.")).toBe(true);
    expect(coveredBy("A distinct paragraph. It has two sentences.\n\nAnother paragraph.", "A distinct paragraph. It has two sentences.")).toBe(true);
  });
  it.each([undefined, { valid: false, errors: ["attribution_gap"] }, { valid: true, errors: ["contradiction"] }])("does not certify available evidence without successful validation: %j", validation => {
    render(<RevAnswerView payload={payload({ evidence: { items: [item()], validation } })} />);
    expect(screen.getByText("Evidence unverified")).toBeInTheDocument();
    expect(screen.queryByText("Evidence verified")).not.toBeInTheDocument();
  });
  it("requires explicit successful validation even if the request itself succeeded", () => {
    render(<RevAnswerView payload={payload({ success: true, evidence: { items: [item()] } })} />);
    expect(screen.getByText("Evidence unverified")).toBeInTheDocument();
  });
  it("keeps a verified investigation quiet instead of badging every answer", () => {
    // Badge discipline (spec P5/P9): a healthy verified answer carries no
    // status pill at all. The unverified/partial/unavailable cases below still
    // warn, because those states change what the merchant may rely on.
    render(<RevAnswerView payload={payload()} />);
    expect(screen.queryByText("Evidence verified")).not.toBeInTheDocument();
  });
  it("keeps malformed provenance unverified even if validation claims success", () => {
    render(<RevAnswerView payload={payload({ evidence: { ...evidence(), items: [item({ source: "" })] } })} />);
    expect(screen.getByText("Evidence unverified")).toBeInTheDocument();
  });
  it("distinguishes partially available evidence from entirely unavailable evidence", () => {
    const view = render(<RevAnswerView payload={payload({ evidence: { ...evidence(), items: [item(), item({ id: "ev-missing", status: "unavailable", value: null })] } })} />);
    expect(screen.getByText("Partial evidence")).toBeInTheDocument();
    view.rerender(<RevAnswerView payload={payload({ evidence: { ...evidence(), items: [item({ status: "unavailable", value: null })] } })} />);
    expect(screen.getByText("Evidence unavailable")).toBeInTheDocument();
  });
  it.each([false, true])("preserves all structured sections alongside an incomplete text answer (dark=%s)", dark => {
    render(<RevAnswerView dark={dark} payload={payload({ text: "Short summary.", response: {
      situation: "The observed situation.", insight: "A distinct insight.", implication: "A cautious implication.", recommendation: "Review the records.",
    } })} />);
    for (const text of ["Short summary.", "The observed situation.", "A distinct insight.", "A cautious implication.", "Review the records."]) expect(screen.getByText(text)).toBeInTheDocument();
    for (const label of ["Situation", "Insight", "Implication", "Recommendation"]) expect(screen.getByRole("heading", { name: label })).toBeInTheDocument();
    // Read-only is product-level education, not a per-message badge (spec §5).
    expect(screen.queryByText("Read-only")).not.toBeInTheDocument();
  });
  it("does not repeat structured sections or recommendations already covered by a complete text answer", () => {
    render(<RevAnswerView payload={payload({
      text: "## Situation\n\nObserved orders fell.\n\n## Insight\n\nThe recorded change is -12%.\n\n## Implication\n\nThe cause is unknown.\n\n## Recommended next steps\n\n**Review records** — Compare periods. Measure: Recorded orders.",
      response: { situation: "Observed orders fell.", insight: "The recorded change is -12%.", implication: "The cause is unknown.", recommendation: "Review records" },
      recommendations: [{ label: "Review records", why: "Compare periods.", measure: "Recorded orders.", executed: false }],
    })} />);
    expect(screen.getAllByText("Observed orders fell.")).toHaveLength(1);
    expect(screen.getAllByText("The recorded change is -12%.")).toHaveLength(1);
    expect(screen.getAllByRole("heading", { name: "Recommended next steps" })).toHaveLength(1);
    expect(screen.getAllByText("Review records")).toHaveLength(1);
  });
  it("preserves legacy top-level sections and does not mistake opposite numeric claims for duplicates", () => {
    const legacy = normaliseRevAnswer({ response_type: "analysis", text: "Change is +12%.", situation: "Legacy situation", insight: "Change is -12%.", implication: "Legacy implication", recommendation: "Legacy recommendation" })!;
    render(<RevAnswerView payload={legacy} />);
    for (const text of ["Change is +12%.", "Change is -12%.", "Legacy situation", "Legacy implication", "Legacy recommendation"]) expect(screen.getByText(text)).toBeInTheDocument();
  });
  it("keeps facts, hypotheses, unknowns and recommendations separate and read-only", () => {
    render(<RevAnswerView payload={payload({
      facts: [{ text: "Twelve orders recorded.", evidence_ids: ["ev-current"] }],
      hypotheses: [{ statement: "Traffic might contribute.", verified: false, status: "hypothesis", confidence: 0.2 }],
      unknowns: ["Acquisition source is unknown."],
      recommendations: [{ label: "Check tracking", why: "Verify coverage.", measure: "Recorded events", executed: false }],
    })} />);
    for (const label of ["Facts", "Hypotheses — not verified", "Unknowns and limits"]) expect(screen.getByRole("heading", { name: label })).toBeInTheDocument();
    expect(screen.getByText(/Recommendations only — nothing was changed or sent/)).toBeInTheDocument();
  });
  it("exposes evidence details when only comparison facts and limitations are returned", () => {
    const onOpen = vi.fn();
    render(<RevAnswerView onOpenEvidence={onOpen} payload={payload({ evidence: undefined, comparison_facts: [{ text: "Comparison unavailable.", evidence_ids: [] }], unknowns: ["Missing prior period."] })} />);
    fireEvent.click(screen.getByRole("button", { name: "Evidence and limitations" })); expect(onOpen).toHaveBeenCalledTimes(1);
  });
  it("handles absent content and malformed optional fields without showing fabricated confidence", () => {
    render(<RevAnswerView payload={{ text: {}, evidence: { items: [null], validation: { valid: "true", errors: null } }, response: { confidence: { score: Infinity } }, warnings: {}, recommendations: [null], hypotheses: {}, specialists: [null], investigation: { steps: null, follow_ups: {} } } as unknown as RevAnswerPayload} />);
    expect(screen.getByText("No answer content was returned.")).toBeInTheDocument();
    // GREET-001 contract: a payload that claims no analysis and carries no
    // usable evidence renders as quiet chat — the fallback line states the
    // absence honestly instead of investigation chrome; confidence is never
    // fabricated from a malformed score.
    expect(screen.queryByText("Evidence unavailable")).not.toBeInTheDocument();
    expect(screen.queryByText("How I checked")).not.toBeInTheDocument();
    expect(screen.queryByText(/Confidence/)).not.toBeInTheDocument();
  });
});

describe("Task 210 adaptive answer structure and confidence", () => {
  const communication = "Treat this as a partial reading — some records for this period are missing from the source.";
  const adaptivePayload = (overrides: Partial<RevAnswerPayload> = {}): RevAnswerPayload => ({
    response_type: "analysis", read_only: true,
    text: "## What I can verify\n\nFor Yesterday (1 day, UTC):\n\n- Recorded order value USD 30.31 across 3 orders",
    evidence: evidence(),
    response: {
      situation: "Recorded order value USD 30.31 across 3 orders",
      confidence: {
        category: "limited",
        claims: { "clm-1": { category: "limited", basis: ["partial_coverage"], limitations: ["Some records for this period are missing from the source."] } },
        coverage: {
          window: { label: "Yesterday", start: "2026-11-06", end: "2026-11-07", timezone: "UTC" },
          coverage: "partial", freshness: "fresh", currency_comparable: true, certified: false,
          limits: ["Some records for this period are missing from the source."],
        },
        communication,
      },
      sections: [
        { id: "direct_answer", label: "Direct answer", text: "Recorded order value USD 30.31 across 3 orders" },
        { id: "evidence", label: "Evidence", text: "Store records for Yesterday: 3 source entries, currencies USD." },
        { id: "confidence", label: "Confidence", text: communication },
      ],
    },
    response_profile: {
      contract_version: "rev-response-adaptation-v1", response_intent: "direct_factual",
      complexity: "simple", explanation_depth: "concise",
      recommendation_appropriate: false, clarification_required: false,
      confidence_communication: "inline", reason: "a single recorded metric answers the question directly",
    },
    ...overrides,
  });

  it("renders the backend's sections in the given order without re-deriving the legacy keys", () => {
    const { container } = render(<RevAnswerView payload={adaptivePayload({
      text: "Something the text answer already says.",
      response: {
        situation: "A situation the backend did not select.",
        insight: "An insight the backend did not select.",
        confidence: adaptivePayload().response?.confidence,
        sections: [
          { id: "limitations", label: "Limitations", text: "The gap in recorded data." },
          { id: "confidence", label: "Confidence", text: communication },
        ],
      },
    })} />);
    expect(screen.queryByRole("heading", { name: "Situation" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Insight" })).not.toBeInTheDocument();
    const headings = [...container.querySelectorAll("h3")].map(h => h.textContent);
    expect(headings.indexOf("Limitations")).toBeGreaterThan(-1);
    expect(headings.indexOf("Confidence")).toBeGreaterThan(headings.indexOf("Limitations"));
  });

  it("never renders an empty section", () => {
    render(<RevAnswerView payload={adaptivePayload({
      response: {
        ...adaptivePayload().response,
        sections: [
          { id: "limitations", label: "Limitations", text: "A real limitation." },
          { id: "unknowns", label: "Unknowns", text: "   " },
        ],
      },
    })} />);
    expect(screen.getByRole("heading", { name: "Limitations" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Unknowns" })).not.toBeInTheDocument();
  });

  it("renders the confidence standing as natural language, never a badge", () => {
    const { container } = render(<RevAnswerView payload={adaptivePayload()} />);
    expect(screen.getAllByText(communication).length).toBe(1);
    // No badge chrome around the category: nothing styled as a pill with a
    // bare category word.
    expect(screen.queryByText(/^limited$/i)).not.toBeInTheDocument();
    expect(container.querySelector("[data-confidence-badge]")).toBeNull();
  });

  it("does not duplicate a confidence sentence that its sections already carry", () => {
    render(<RevAnswerView payload={adaptivePayload({ text: "No overlap with the standing." })} />);
    expect(screen.getAllByText(communication)).toHaveLength(1);
  });

  it("renders the standing once when the sections omit the confidence element", () => {
    const base = adaptivePayload();
    render(<RevAnswerView payload={adaptivePayload({
      text: "No overlap with the standing.",
      response: { ...base.response, sections: (base.response?.sections ?? []).filter(s => s.id !== "confidence") },
    })} />);
    expect(screen.getAllByText(communication)).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "Confidence" })).not.toBeInTheDocument();
  });

  it("discloses coverage and data state under How I checked, separate from confidence", () => {
    render(<RevAnswerView payload={adaptivePayload({ text: "No overlap with the standing." })} />);
    fireEvent.click(screen.getByText("How I checked"));
    expect(screen.getByText("Coverage and data state")).toBeInTheDocument();
    expect(screen.getByText(/Coverage: partial/)).toBeInTheDocument();
    expect(screen.getByText(/Freshness: fresh/)).toBeInTheDocument();
    expect(screen.getByText(/Currencies comparable: yes/)).toBeInTheDocument();
    expect(screen.getByText(/Order coverage certified: no/)).toBeInTheDocument();
    expect(screen.getByText("Some records for this period are missing from the source.")).toBeInTheDocument();
  });

  it("never renders a legacy numeric confidence as a standing", () => {
    render(<RevAnswerView payload={adaptivePayload({
      text: "Short summary.",
      response: {
        situation: "Orders were spread across the day.",
        confidence: { score: 0.6, basis: "partial evidence" },
      },
    })} />);
    expect(screen.getByRole("heading", { name: "Situation" })).toBeInTheDocument();
    expect(screen.getByText("Orders were spread across the day.")).toBeInTheDocument();
    expect(screen.queryByText(communication)).not.toBeInTheDocument();
    expect(screen.queryByText(/60%|0\.6/)).not.toBeInTheDocument();
  });

  it("refuses to render a communication that carries a percentage", () => {
    const base = adaptivePayload();
    render(<RevAnswerView payload={adaptivePayload({
      text: "No overlap with the standing.",
      response: { ...base.response, sections: [], confidence: { ...base.response!.confidence, communication: "I am 80% sure about this." } },
    })} />);
    expect(screen.queryByText(/80% sure/)).not.toBeInTheDocument();
  });

  it("hides a malformed confidence object entirely", () => {
    const base = adaptivePayload();
    render(<RevAnswerView payload={adaptivePayload({
      response: {
        ...base.response,
        sections: [],
        confidence: { category: "medium", claims: {}, coverage: null, communication: "Whatever." } as never,
      },
    })} />);
    expect(screen.queryByText(/Whatever/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("How I checked"));
    expect(screen.queryByText("Coverage and data state")).not.toBeInTheDocument();
  });

  it("keeps legacy four-key section rendering when no sections are supplied", () => {
    render(<RevAnswerView payload={adaptivePayload({
      text: "Short summary.",
      response: {
        situation: "The observed situation.",
        insight: "A distinct insight.",
        confidence: adaptivePayload().response?.confidence,
      },
    })} />);
    expect(screen.getByRole("heading", { name: "Situation" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Insight" })).toBeInTheDocument();
  });
});

describe("formatPeriod merchant copy", () => {
  it("renders microsecond UTC windows as human dates with one timezone note", () => {
    expect(formatPeriod({ start: "2026-10-28T08:43:22.111755Z", end: "2026-11-04T08:43:22.111755Z", timezone: "UTC", semantics: "[start, end)" } as never))
      .toBe("28 Oct 2026 → 04 Nov 2026 (UTC)");
  });
  it("keeps raw fidelity for offset timestamps and never renders interval notation", () => {
    const text = formatPeriod({ start: "2026-11-01T10:15:00+02:00", end: "2026-11-08T10:15:00+02:00", timezone: "UTC", semantics: "[start, end)" } as never);
    expect(text).toContain("2026-11-01 10:15:00+02:00");
    expect(text).not.toContain("[start");
  });
  it("labels a missing timezone honestly instead of assuming UTC", () => {
    expect(formatPeriod({ start: "2026-10-01", end: "2026-11-01" } as never))
      .toBe("01 Oct 2026 → 01 Nov 2026 (timezone not supplied)");
  });
});

describe("evidence records and attribution", () => {
  it.each([{}, null, 42, "unexpected", "__proto__", "constructor"])('renders a neutral fallback for status %j', status => {
    render(<EvidencePanel evidence={{ ...evidence(), items: [item({ status } as unknown as Partial<EvidenceItem>)] }} />);
    expect(screen.getByText("Recorded orders")).toBeInTheDocument();
    expect(screen.getByText("Unverified")).toBeInTheDocument();
    expect(screen.queryByText("Verified")).not.toBeInTheDocument();
  });
  it.each([
    ["available", "Verified"], ["partial", "Partial"], ["unavailable", "Unavailable"], ["unsupported", "Not supported"],
  ] as const)("retains the valid %s label", (status, label) => {
    render(<EvidencePanel evidence={{ ...evidence(), items: [item({ status, value: ["unavailable", "unsupported"].includes(status) ? null : 12 })] }} />);
    expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  });
  it("keeps valid records visible but unverified when another raw entry is malformed", () => {
    render(<EvidencePanel evidence={{ ...evidence(), items: [item(), null] }} />);
    expect(screen.getByText("Recorded orders")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("Evidence unverified.")).toBeInTheDocument();
    expect(screen.queryByText("Verified")).not.toBeInTheDocument();
  });
  it.each([false, true])("displays comparison facts and both resolvable and missing references (dark=%s)", dark => {
    render(<EvidencePanel dark={dark} evidence={{ ...evidence(), comparison_items: [item({ id: "ev-before", label: "Previous orders" })] }}
      comparisonFacts={[{ text: "Orders declined by arithmetic comparison.", evidence_ids: ["ev-current", "ev-before", "ev-absent"] }]} />);
    expect(screen.getByRole("heading", { name: "Comparison facts" })).toBeInTheDocument();
    expect(screen.getByText("Orders declined by arithmetic comparison.")).toBeInTheDocument();
    for (const id of ["ev-current", "ev-before", "ev-absent"]) expect(screen.getByText(id)).toBeInTheDocument();
    expect(screen.getByText(/record unavailable/)).toBeInTheDocument();
    expect(screen.getByText("Previous orders")).toBeInTheDocument();
  });
  it("does not call available records verified when validation is absent", () => {
    render(<EvidencePanel evidence={{ items: [item()] }} factsLabel="Verified facts" facts={[{ text: "Observed fact", evidence_ids: [] }]} />);
    expect(screen.getByText("Available — unverified")).toBeInTheDocument();
    expect(screen.getByText("Evidence unverified.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Facts — unverified" })).toBeInTheDocument();
    expect(screen.getByText("No supporting evidence references supplied.")).toBeInTheDocument();
  });
  it.each([
    [{ unit: "currency", currency: null, value: 12 }, "Unavailable (currency missing or invalid)"],
    [{ unit: "currency", currency: "invalid", value: 12 }, "Unavailable (currency missing or invalid)"],
    [{ unit: "currency", currency: "USD", value: "NaN" }, "Unavailable"],
    [{ unit: "currency", currency: "USD", value: "" }, "Unavailable"],
    [{ unit: "ratio", value: Infinity }, "Unavailable"],
    [{ unit: "ratio", value: "not-a-number" }, "Unavailable"],
    [{ unit: "ratio", value: 1e308 }, "Unavailable"],
    [{ unit: "count", value: -1 }, "Unavailable"],
    [{ unit: "count", value: 1.5 }, "Unavailable"],
    [{ unit: "count", value: 0 }, "0"],
    [{ unit: "ratio", value: 0.125 }, "13%"],
    [{ status: "unsupported", value: 123 }, "Unavailable"],
  ] as Array<[Partial<EvidenceItem>, string]>)('formats %j conservatively', (overrides, expected) => {
    expect(formatEvidenceValue(item(overrides))).toBe(expected);
  });
  it("keeps supplied currencies separate and does not append an assumed UTC suffix", () => {
    render(<EvidencePanel evidence={{ ...evidence(), items: [item({ unit: "currency", currency: "USD", value: "12.30" }), item({ id: "ev-eur", label: "EUR orders", unit: "currency", currency: "EUR", value: "9.50" })], freshness: { state: "fresh", as_of: "2026-11-01T10:15:00+02:00" } }} />);
    expect(screen.getByText("USD 12.30")).toBeInTheDocument(); expect(screen.getByText("EUR 9.50")).toBeInTheDocument();
    expect(screen.getByText(/last sync/)).toHaveTextContent("2026-11-01 10:15:00+02:00");
    expect(screen.queryByText(/UTC/)).not.toBeInTheDocument();
  });
  it.each(["2026-11-01T10:15:00", "bad-date", "2026-02-30", null])("does not infer UTC for %j", timestamp => {
    const text = formatTimestamp(timestamp); expect(text).not.toContain("UTC");
    expect(text).toContain(timestamp === "2026-11-01T10:15:00" ? "timezone not supplied" : "Not supplied or invalid");
  });
  it("handles incomplete evidence metadata and expandable rows accessibly", () => {
    render(<EvidencePanel evidence={{ items: [null, { label: "Incomplete record", value: NaN, status: "available" }], freshness: { as_of: "bad-date" }, validation: { valid: false, errors: null } } as unknown as RevAnswerPayload["evidence"]} />);
    const row = screen.getByRole("button", { name: /Incomplete record/ });
    expect(row).toHaveAttribute("aria-expanded", "false"); fireEvent.click(row);
    expect(row).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/What it measures/).parentElement).toHaveTextContent("Not supplied");
    expect(screen.queryByText(/NaN|undefined|null/)).not.toBeInTheDocument();
  });
  it("does not treat inherited object keys as evidence groups", () => {
    render(<EvidencePanel evidence={{ ...evidence(), items: [item({ metric: "__proto__" })] }} />);
    expect(screen.getByText("Recorded orders")).toBeInTheDocument();
  });
  it("keeps duplicate identifiers unverified and preserves both visible records", () => {
    render(<EvidencePanel evidence={{ ...evidence(), items: [item(), item({ label: "Conflicting record" })] }} />);
    expect(screen.getByText("Evidence unverified.")).toBeInTheDocument();
    expect(screen.getByText("Conflicting record")).toBeInTheDocument();
    expect(screen.getByText("Recorded orders")).toBeInTheDocument();
    expect(screen.queryByText("Verified")).not.toBeInTheDocument();
  });
});

describe("investigation status", () => {
  it.each([
    [[step("completed")], false, "complete", "Investigation complete"],
    [[step("completed"), step("failed")], false, "complete", "Investigation has failed checks"],
    [[step("completed"), step("pending")], false, "complete", "Investigation incomplete"],
    [[step("running")], false, "running", "Investigation incomplete"],
    [[step("completed")], false, "partial", "Investigation incomplete"],
    [[step("running")], true, "running", "Investigating your store evidence"],
  ] as Array<[InvestigationStep[], boolean, string, string]>)('labels %j (streaming=%s, status=%s)', (steps, streaming, status, label) => {
    render(<InvestigationTimeline steps={steps} streaming={streaming} investigation={{ status } as RevInvestigationMeta} />);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(label) }));
    expect(screen.getByRole("list")).toBeInTheDocument();
    if (label !== "Investigation complete") expect(screen.queryByText("Investigation complete")).not.toBeInTheDocument();
  });
  it("displays the supplied timezone as human dates and never renders interval notation", () => {
    const view = render(<InvestigationTimeline steps={[step("completed")]} investigation={{ status: "complete", period: { start: "2026-10-01", end: "2026-11-01" } } as RevInvestigationMeta} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText(/Reporting period/)).toHaveTextContent("01 Oct 2026 → 01 Nov 2026 (timezone not supplied)");
    expect(screen.queryByText(/UTC/)).not.toBeInTheDocument();
    view.rerender(<InvestigationTimeline steps={[step("completed")]} investigation={{ status: "complete", period: { start: "2026-10-01", end: "2026-11-01", timezone: "UTC", semantics: "[start, end)" } } as RevInvestigationMeta} />);
    expect(screen.getByText(/Reporting period/)).toHaveTextContent("01 Oct 2026 → 01 Nov 2026 (UTC)");
    expect(screen.getByText(/Reporting period/)).not.toHaveTextContent("[start, end)");
  });
  it("renders nothing for absent or malformed checks", () => {
    const { container } = render(<InvestigationTimeline steps={null} />); expect(container).toBeEmptyDOMElement();
  });
});

describe('Phase 5.4 answer controls', () => {
  it('exposes unavailable callbacks as disabled rather than dead controls', () => {
    render(<RevAnswerView payload={payload({ investigation: {
      id: "fixture", question: "Explain", intent: "analysis", status: "completed",
      period: { start: "2026-10-01", end: "2026-11-01" }, steps: [], follow_ups: ['Explain these figures'],
    } })} />);
    expect(screen.getByRole('button', { name: 'Explain these figures' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Evidence \(/ })).toBeDisabled();
  });
  it.each([false, true])('exposes the evidence expansion state (%s) and invokes its callback', open => {
    const onOpen = vi.fn();
    render(<RevAnswerView payload={payload()} evidenceOpen={open} onOpenEvidence={onOpen} />);
    const button = screen.getByRole('button', { name: /Evidence \(/ });
    expect(button).toHaveAttribute('aria-expanded', String(open));
    fireEvent.click(button); expect(onOpen).toHaveBeenCalledOnce();
  });
});
