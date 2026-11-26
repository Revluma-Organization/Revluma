import type { Answers, StepNumber } from "./schema";

/** The required answers on each step. Optional ones (phone, notes) don't count toward progress. */
const REQUIRED: Record<StepNumber, readonly (keyof Answers)[]> = {
  1: ["full_name", "work_email", "store_name", "store_url", "store_age", "monthly_orders"],
  2: ["challenges", "problem_discovery"],
  3: ["price_willingness", "capabilities", "founding_interest"],
};

function answered(value: Answers[keyof Answers]): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  return value !== null && value !== undefined;
}

/** How much of one step is filled in, from 0 to 1. Drives the live progress bar. */
export function stepFill(answers: Answers, step: StepNumber): number {
  const fields = REQUIRED[step];
  return fields.filter((field) => answered(answers[field])).length / fields.length;
}

/** Answered and total required questions across the whole application. */
export function overallFill(answers: Answers): { done: number; total: number } {
  const all = [...REQUIRED[1], ...REQUIRED[2], ...REQUIRED[3]];
  return { done: all.filter((field) => answered(answers[field])).length, total: all.length };
}
