/**
 * Answer-state derivation for Rev Intelligence.
 *
 * The pill above an answer is a claim about what the merchant just received, so
 * it has to distinguish "I looked and the data was thin" from "I need something
 * from you" and from "this is conversation, not an evidence-backed finding".
 * Deriving it from the evidence list alone labelled clarifications, capability
 * answers and read-only refusals as "Insufficient store data", which misstates
 * what Rev did.
 *
 * Kept out of the component so it can be tested without React and so the page
 * module stays free of non-component exports.
 */

import type { RevAnswerPayload } from "@/lib/revStream";

export type AnswerState =
  | "verified"
  | "partial"
  | "insufficient"
  | "clarification"
  | "boundary"
  | "conversational"
  | "streaming";

export const STATE_PILL: Record<AnswerState, { label: string; fg: string; bg: string }> = {
  verified: { label: "Evidence verified", fg: "#067647", bg: "#ECFDF3" },
  partial: { label: "Partial evidence", fg: "#B54708", bg: "#FFFAEB" },
  insufficient: { label: "Insufficient store data", fg: "#475467", bg: "#F2F4F7" },
  clarification: { label: "Needs your input", fg: "#B54708", bg: "#FFFAEB" },
  boundary: { label: "Read-only boundary", fg: "#1F06AC", bg: "rgba(31,6,172,0.08)" },
  conversational: { label: "Conversation", fg: "#475467", bg: "#F2F4F7" },
  streaming: { label: "Investigating", fg: "#1F06AC", bg: "rgba(31,6,172,0.08)" },
};

/** Response types that make no claim about store evidence. */
const CONVERSATIONAL_TYPES = new Set([
  "chat", "conversational", "conversation", "greeting", "identity",
  "capability", "knowledge",
]);

/** Response types where Rev declined to investigate because it may not write. */
const BOUNDARY_TYPES = new Set(["read_only_boundary", "read_only", "action_plan"]);

/** Response types where Rev needs the merchant to say or do something first. */
const CLARIFICATION_TYPES = new Set(["clarification", "correction", "no_store"]);

/**
 * Decide which pill an answer earns.
 *
 * Streaming wins outright: while the turn is open nothing is verified yet.
 * Response type comes next, because a clarification or a refusal is not an
 * evidence verdict however empty its evidence list is. Only genuine
 * investigations are graded on their evidence.
 */
export function deriveAnswerState(
  payload: RevAnswerPayload,
  streaming: boolean,
): AnswerState {
  if (streaming) return "streaming";

  const type = (payload.response_type || "").toLowerCase();
  if (BOUNDARY_TYPES.has(type)) return "boundary";
  if (CLARIFICATION_TYPES.has(type)) return "clarification";
  if (CONVERSATIONAL_TYPES.has(type)) return "conversational";

  const items = payload.evidence?.items ?? [];
  if (!items.length) return "insufficient";

  const validation = payload.evidence?.validation;
  const degraded = items.some((item) => item.status !== "available");
  const invalid = validation ? !validation.valid : false;
  const specialistsDegraded = (payload.specialists ?? []).some(
    (specialist) =>
      specialist.status === "partial" ||
      specialist.status === "error" ||
      specialist.status === "no_data",
  );
  return degraded || invalid || specialistsDegraded ? "partial" : "verified";
}

/**
 * Whether the evidence affordance means anything for this answer.
 *
 * A conversational or boundary answer has no evidence to inspect, so offering
 * the drawer invites the merchant to look for proof that was never gathered.
 */
export function isEvidenceBearing(payload: RevAnswerPayload): boolean {
  const type = (payload.response_type || "").toLowerCase();
  if (CONVERSATIONAL_TYPES.has(type) || BOUNDARY_TYPES.has(type)) return false;
  return (payload.evidence?.items?.length ?? 0) > 0
    || (payload.hypotheses?.length ?? 0) > 0;
}
