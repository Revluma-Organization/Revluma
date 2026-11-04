import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import RevAnswerView from "@/components/rev/RevAnswerView";
import RevMarkdown from "@/components/rev/RevMarkdown";
import { legacyResponseToPayload } from "@/lib/revPresentation";

// Legacy parity (spec §8.9): persisted turns from before the normalized payload
// contract render through the same adaptive renderer as new turns, with no
// loss of sections, prose or inline emphasis.

describe("legacy response adapter", () => {
  it("maps analysis sections into the shared schema", () => {
    const payload = legacyResponseToPayload({
      response_type: "analysis",
      text: "Revenue was down yesterday.",
      situation: "Orders fell between the two periods.",
      insight: "The clearest change was refund volume.",
      implication: "Cause is not established by these observations.",
      recommendation: "Compare refund reasons over the period.",
      confidence: { score: 0.6, basis: "partial evidence" },
      warnings: ["Coverage incomplete"],
    });
    expect(payload.response_type).toBe("analysis");
    expect(payload.text).toBe("Revenue was down yesterday.");
    expect(payload.response?.situation).toBe("Orders fell between the two periods.");
    expect(payload.response?.recommendation).toBe("Compare refund reasons over the period.");
    expect(payload.response?.warnings).toEqual(["Coverage incomplete"]);
    expect(payload.read_only).toBe(true);
  });

  it("tolerates malformed legacy objects without inventing content", () => {
    const payload = legacyResponseToPayload({ response_type: "analysis", text: 42, situation: null });
    expect(payload.text).toBe("");
    expect(payload.response).toBeUndefined();
    expect(legacyResponseToPayload(null).response_type).toBe("analysis");
  });

  it("renders a legacy analysis turn with its sections through the shared renderer", () => {
    render(<RevAnswerView payload={legacyResponseToPayload({
      response_type: "analysis",
      text: "Revenue was down yesterday.",
      situation: "Orders fell between the two periods.",
      insight: "The clearest change was refund volume.",
    })} />);
    expect(screen.getByText("Revenue was down yesterday.")).toBeInTheDocument();
    for (const label of ["Situation", "Insight"]) {
      expect(screen.getByRole("heading", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByText("Orders fell between the two periods.")).toBeInTheDocument();
  });

  it("renders legacy prose with inline emphasis through the shared markdown", () => {
    render(<RevMarkdown text={"Connection **confirmed** and *recently* synced."} />);
    expect(screen.getByText("confirmed")).toBeInTheDocument();
    expect(screen.getByText("recently")).toBeInTheDocument();
  });

  it("uses a semantic heading scale without decorative uppercase", () => {
    const { container } = render(<RevMarkdown text={"# Section\n\nBody line.\n\n## Subsection\n\nMore."} />);
    const h2 = container.querySelector("h2");
    const h3 = container.querySelector("h3");
    expect(h2).toHaveTextContent("Section");
    expect(h3).toHaveTextContent("Subsection");
    expect(h3?.style.textTransform).not.toBe("uppercase");
  });
});
