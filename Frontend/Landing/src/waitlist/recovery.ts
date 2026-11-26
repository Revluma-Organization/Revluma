/**
 * Local recovery for answers that could not be saved (network or server
 * failure). The backend is the source of truth: a draft is written only when a
 * save fails, offered back once on the next visit, and deleted as soon as that
 * step saves. It never holds the resume token or anything the server sent.
 */
import { STEP_FIELDS, type Answers, type StepNumber } from "./schema";

const KEY = "rv_wl_recovery";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type Stored = { v: 1; savedAt: number; steps: Partial<Record<StepNumber, Partial<Answers>>> };

function read(): Stored | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Stored;
    if (parsed?.v !== 1 || typeof parsed.savedAt !== "number" || Date.now() - parsed.savedAt > MAX_AGE_MS) {
      window.localStorage.removeItem(KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function write(stored: Stored | null) {
  try {
    if (!stored || !Object.keys(stored.steps).length) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    // Storage full or disabled: recovery is best effort.
  }
}

/** Keep one step's unsaved answers after a failed save. */
export function keepUnsaved(step: StepNumber, answers: Answers) {
  const stored = read() ?? { v: 1 as const, savedAt: Date.now(), steps: {} };
  const values: Partial<Answers> = {};
  for (const field of STEP_FIELDS[step]) (values as Record<string, unknown>)[field] = answers[field];
  stored.steps[step] = values;
  stored.savedAt = Date.now();
  write(stored);
}

/** That step is now saved on the server: forget the local copy. */
export function forgetUnsaved(step: StepNumber) {
  const stored = read();
  if (!stored) return;
  delete stored.steps[step];
  write(stored);
}

export function forgetAllUnsaved() {
  write(null);
}

/** Unsaved drafts, if any, keyed by step. */
export function unsavedDrafts(): Partial<Record<StepNumber, Partial<Answers>>> {
  return read()?.steps ?? {};
}
