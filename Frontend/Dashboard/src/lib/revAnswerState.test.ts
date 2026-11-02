/**
 * The answer pill is a claim about what the merchant received, so it must not
 * call a clarification, a capability answer or a read-only refusal
 * "Insufficient store data" — that says Rev looked and found nothing, when in
 * fact Rev either needs input, was answering conversationally, or declined.
 */

import { describe, expect, it } from "vitest";

import type { EvidenceItem, RevAnswerPayload } from "@/lib/revStream";
import {
  STATE_PILL,
  deriveAnswerState,
  isEvidenceBearing,
} from "@/lib/revAnswerState";

function payload(overrides: Partial<RevAnswerPayload> = {}): RevAnswerPayload {
  return {
    read_only: true,
    response_type: "analysis",
    text: "Recorded order value was 30.31 USD.",
    ...overrides,
  };
}

function availableItem(id = "e1"): EvidenceItem {
  return {
    id,
    metric: "order_value",
    label: "Recorded order value",
    value: "30.31",
    currency: "USD",
    unit: "currency",
    status: "available",
    period: { start: "2026-10-01T00:00:00Z", end: "2026-10-31T23:59:59Z" },
    source: "orders",
    definition: "Sum of order totals recorded for the period.",
  };
}

describe("deriveAnswerState", () => {
  it("reports investigating while the turn is still open", () => {
    expect(deriveAnswerState(payload({ evidence: { items: [availableItem()] } }), true))
      .toBe("streaming");
  });

  it("grades a complete investigation as verified", () => {
    const state = deriveAnswerState(
      payload({ evidence: { items: [availableItem()] } }), false);
    expect(state).toBe("verified");
  });

  it("grades an investigation with an unavailable item as partial", () => {
    const state = deriveAnswerState(payload({
      evidence: { items: [{ ...availableItem(), status: "unavailable" }] },
    }), false);
    expect(state).toBe("partial");
  });

  it("grades a failed evidence validation as partial", () => {
    const state = deriveAnswerState(payload({
      evidence: {
        items: [availableItem()],
        validation: { valid: false, errors: ["currency mismatch"] },
      },
    }), false);
    expect(state).toBe("partial");
  });

  it("grades a degraded specialist as partial", () => {
    const state = deriveAnswerState(payload({
      evidence: { items: [availableItem()] },
      specialists: [{ name: "revenue", status: "error", warnings: ["query failed"] }],
    }), false);
    expect(state).toBe("partial");
  });

  it("reports insufficient store data only for a real investigation with no items", () => {
    const state = deriveAnswerState(payload({ evidence: { items: [] } }), false);
    expect(state).toBe("insufficient");
  });

  it.each([
    ["clarification", "clarification"],
    ["correction", "clarification"],
    ["no_store", "clarification"],
  ])("labels %s as needing input, not as insufficient data", (type, expected) => {
    expect(deriveAnswerState(payload({ response_type: type, evidence: { items: [] } }), false))
      .toBe(expected);
  });

  it("labels a read-only refusal as the boundary it is", () => {
    expect(deriveAnswerState(payload({ response_type: "read_only_boundary" }), false))
      .toBe("boundary");
  });

  it.each(["capability", "greeting", "identity", "chat", "conversational", "knowledge"])(
    "labels a %s answer as conversation",
    (type) => {
      expect(deriveAnswerState(payload({ response_type: type }), false))
        .toBe("conversational");
    },
  );

  it("is case-insensitive about the response type", () => {
    expect(deriveAnswerState(payload({ response_type: "Clarification" }), false))
      .toBe("clarification");
  });

  it("survives a missing response type", () => {
    const state = deriveAnswerState(
      payload({ response_type: "", evidence: { items: [availableItem()] } }), false);
    expect(state).toBe("verified");
  });
});

describe("STATE_PILL", () => {
  it("gives every reachable state a visible label", () => {
    for (const [state, pill] of Object.entries(STATE_PILL)) {
      expect(pill.label, state).toBeTruthy();
      expect(pill.fg, state).toMatch(/^#|^rgba/);
      expect(pill.bg, state).toBeTruthy();
    }
  });

  it("never claims an action was taken", () => {
    const labels = Object.values(STATE_PILL).map((pill) => pill.label.toLowerCase());
    for (const label of labels) {
      expect(label).not.toMatch(/\b(applied|sent|created|updated|launched|executed|done|fixed)\b/);
    }
  });
});

describe("isEvidenceBearing", () => {
  it("is true when items were gathered", () => {
    expect(isEvidenceBearing(payload({ evidence: { items: [availableItem()] } }))).toBe(true);
  });

  it("is true when only hypotheses were recorded", () => {
    expect(isEvidenceBearing(payload({
      evidence: { items: [] },
      hypotheses: [{
        statement: "Payment failure may explain the drop",
        status: "hypothesis",
        verified: false,
        confidence: 0.3,
      }],
    }))).toBe(true);
  });

  it("is false for a conversational answer", () => {
    expect(isEvidenceBearing(payload({ response_type: "capability" }))).toBe(false);
  });

  it("is false for a read-only refusal", () => {
    expect(isEvidenceBearing(payload({ response_type: "read_only_boundary" }))).toBe(false);
  });

  it("is false when an investigation gathered nothing", () => {
    expect(isEvidenceBearing(payload({ evidence: { items: [] } }))).toBe(false);
  });
});
