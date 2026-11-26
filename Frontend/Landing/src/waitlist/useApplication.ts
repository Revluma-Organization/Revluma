/**
 * State for the Founding Merchants application.
 *
 * The server is the source of truth: answers shown after a load or a save are
 * the ones the server returned, and the page only moves past a step once the
 * server has confirmed it saved. Local storage only keeps answers that failed
 * to save, so they can be offered back (see recovery.ts).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, newIdempotencyKey, waitlistApi, type Application } from "./api";
import { forgetAllUnsaved, forgetUnsaved, keepUnsaved, unsavedDrafts } from "./recovery";
import { REFERRAL_FORMAT, captureReferral, rememberReferral } from "./referral";
import { EMPTY_ANSWERS, STEP_FIELDS, stepPayload, validateStep, type Answers, type Errors, type StepNumber } from "./schema";

export type Screen = 1 | 2 | 3 | 4; // 4 = review
export type View = "loading" | "load-error" | "form" | "resume" | "done";
export type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; step: StepNumber } | { kind: "error"; message: string };
export type Notice = { tone: "info" | "warn"; text: string; action?: "resume" } | null;

const START_IN_FLIGHT_RETRIES = 3;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The step whose answers a server field belongs to. */
function stepOfField(field: string): StepNumber | null {
  for (const step of [1, 2, 3] as StepNumber[]) if ((STEP_FIELDS[step] as readonly string[]).includes(field)) return step;
  return null;
}

export function useApplication() {
  const [view, setView] = useState<View>("loading");
  const [screen, setScreen] = useState<Screen>(1);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [furthest, setFurthest] = useState<Screen>(1);
  const [answers, setAnswers] = useState<Answers>(EMPTY_ANSWERS);
  const [errors, setErrors] = useState<Errors>({});
  const [attempted, setAttempted] = useState(false);
  const [attemptKey, setAttemptKey] = useState(0);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [app, setApp] = useState<Application | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [returnToReview, setReturnToReview] = useState(false);
  const [resumeEmail, setResumeEmail] = useState("");
  const [referral, setReferral] = useState<string | null>(null);
  const [justSubmitted, setJustSubmitted] = useState(false);

  // One save at a time: a second Continue while the first is in flight is ignored.
  const busy = useRef(false);
  // Kept across retries of the same first save so the server can de-duplicate them.
  const startKey = useRef<string | null>(null);
  // The hidden bot trap on step 1 (people never see or fill it).
  const honeypot = useRef<HTMLInputElement>(null);
  const answersRef = useRef(answers);
  answersRef.current = answers;

  /** Show what the server has, then lay unsaved local answers over it. */
  const adopt = useCallback((next: Application | null, options: { restoreDrafts?: boolean } = {}) => {
    setApp(next);
    let merged: Answers = next ? { ...EMPTY_ANSWERS, ...next.answers, phone: next.answers.phone ?? "" } : EMPTY_ANSWERS;
    let restored = false;
    if (options.restoreDrafts && (!next || next.status === "in_progress")) {
      const drafts = unsavedDrafts();
      for (const step of [1, 2, 3] as StepNumber[]) {
        if (!drafts[step]) continue;
        // A draft for a step the server has never seen, or newer edits to an earlier step.
        merged = { ...merged, ...drafts[step] };
        restored = true;
      }
    }
    answersRef.current = merged;
    setAnswers(merged);
    if (restored) setNotice({ tone: "info", text: "We restored answers that hadn't been saved yet. Continue to save them." });
    return merged;
  }, []);

  const goTo = useCallback((next: Screen, dir: 1 | -1) => {
    setDirection(dir);
    setScreen(next);
    setErrors({});
    setAttempted(false);
  }, []);

  const load = useCallback(async () => {
    setView("loading");
    setReferral(captureReferral());
    try {
      const current = await waitlistApi.resume();
      adopt(current, { restoreDrafts: true });
      if (current && current.status !== "in_progress") {
        forgetAllUnsaved();
        setView("done");
        return;
      }
      const step = (current?.current_step ?? 1) as Screen;
      setFurthest(step);
      setScreen(step);
      setView("form");
    } catch {
      setView("load-error");
    }
  }, [adopt]);

  useEffect(() => {
    void load();
  }, [load]);

  const update = useCallback(<K extends keyof Answers>(field: K, value: Answers[K]) => {
    const next = { ...answersRef.current, [field]: value };
    answersRef.current = next;
    setAnswers(next);
    // Once an error is showing, clear it as soon as the answer is fixed.
    setErrors((current) => {
      if (!current[field]) return current;
      const step = stepOfField(field as string);
      if (!step) return current;
      const fresh = validateStep(step, next);
      const copy = { ...current };
      if (fresh[field]) copy[field] = fresh[field];
      else delete copy[field];
      return copy;
    });
    setSave((s) => (s.kind === "error" || s.kind === "saved" ? { kind: "idle" } : s));
  }, []);

  /** Validate one field when it loses focus (only if it has a value or was already flagged). */
  const blur = useCallback((field: keyof Answers) => {
    const step = stepOfField(field as string);
    if (!step) return;
    const value = answersRef.current[field];
    const empty = value === "" || value === null || (Array.isArray(value) && !value.length);
    setErrors((current) => {
      if (empty && !current[field]) return current;
      const fresh = validateStep(step, answersRef.current);
      const copy = { ...current };
      if (fresh[field]) copy[field] = fresh[field];
      else delete copy[field];
      return copy;
    });
  }, []);

  /** Save one step, retrying the first save's well-known races. */
  const sendStep = useCallback(
    async (step: StepNumber, current: Answers): Promise<Application> => {
      if (step === 1 && !app) {
        const payload: Record<string, unknown> = { ...stepPayload(1, current), hp_field: honeypot.current?.value ?? "" };
        if (referral && REFERRAL_FORMAT.test(referral)) payload.referral_code = referral;
        startKey.current ??= newIdempotencyKey();
        for (let attempt = 0; ; attempt += 1) {
          try {
            return await waitlistApi.start(payload, startKey.current);
          } catch (error) {
            if (!(error instanceof ApiError)) throw error;
            if (error.code === "START_IN_FLIGHT" && attempt < START_IN_FLIGHT_RETRIES) {
              await wait(800 * (attempt + 1));
              continue;
            }
            if (error.code === "START_REPLAY_REJECTED" && attempt === 0) {
              // The answers changed since a lost first save (a new email): start afresh.
              startKey.current = newIdempotencyKey();
              continue;
            }
            throw error;
          }
        }
      }
      return waitlistApi.saveStep(step, stepPayload(step, current));
    },
    [app, referral],
  );

  const handleError = useCallback(
    (error: unknown, step: StepNumber | null) => {
      const e = error instanceof ApiError ? error : new ApiError(0, null, "Unable to save.");
      if (step) keepUnsaved(step, answersRef.current);
      if (e.code === "VALIDATION") {
        const fields: Errors = {};
        for (const [field, message] of Object.entries(e.fields)) fields[field as keyof Answers] = message;
        setErrors(fields);
        setAttempted(true);
        setAttemptKey((k) => k + 1);
        setSave({ kind: "idle" });
        return;
      }
      if (e.code === "EMAIL_HAS_APPLICATION") {
        setErrors({ work_email: "This email already has an application." });
        setAttempted(true);
        setNotice({ tone: "warn", text: "This email already has an application. We can email you a code to continue it here.", action: "resume" });
        setResumeEmail(answersRef.current.work_email.trim());
        setSave({ kind: "idle" });
        return;
      }
      if (e.code === "NO_SESSION") {
        setNotice({
          tone: "warn",
          text: "This browser is no longer signed in to your application. Continue with your email to pick it up again.",
          action: "resume",
        });
        setResumeEmail(answersRef.current.work_email.trim());
        setSave({ kind: "idle" });
        return;
      }
      if (e.code === "ALREADY_SUBMITTED" && e.application) {
        adopt(e.application);
        forgetAllUnsaved();
        setView("done");
        setSave({ kind: "idle" });
        return;
      }
      if ((e.code === "STEP_LOCKED" || e.code === "INCOMPLETE") && e.application) {
        adopt(e.application);
        const target = (e.step ?? e.application.current_step) as Screen;
        setFurthest(e.application.current_step as Screen);
        goTo(target, -1);
        setNotice({ tone: "warn", text: "Some answers are missing. Please finish this step first." });
        setSave({ kind: "idle" });
        return;
      }
      const fallback = step ? "Unable to save. Retry." : "Unable to submit. Retry.";
      setSave({ kind: "error", message: e.transient ? fallback : e.message || fallback });
    },
    [adopt, goTo],
  );

  const continueStep = useCallback(async () => {
    if (busy.current || screen === 4) return;
    const step = screen as StepNumber;
    const current = answersRef.current;
    const found = validateStep(step, current);
    setAttempted(true);
    if (Object.keys(found).length) {
      setErrors(found);
      setAttemptKey((k) => k + 1);
      setSave({ kind: "idle" });
      return { ok: false as const, errors: found };
    }
    setErrors({});
    busy.current = true;
    setSave({ kind: "saving" });
    try {
      const saved = await sendStep(step, current);
      startKey.current = null;
      forgetUnsaved(step);
      adopt(saved);
      setNotice(
        step === 1 && !app && referral && !saved.referred
          ? { tone: "info", text: `We couldn't find referral code ${referral}, so your application continues without one.` }
          : null,
      );
      const reached = Math.max(saved.current_step, step + 1) as Screen;
      setFurthest(reached);
      setSave({ kind: "saved", step });
      goTo(returnToReview ? 4 : ((step + 1) as Screen), 1);
      if (returnToReview) setReturnToReview(false);
      return { ok: true as const };
    } catch (error) {
      handleError(error, step);
      return { ok: false as const };
    } finally {
      busy.current = false;
    }
  }, [adopt, app, goTo, handleError, referral, returnToReview, screen, sendStep]);

  const back = useCallback(() => {
    if (busy.current || screen === 1) return;
    setSave({ kind: "idle" });
    setNotice(null);
    goTo((screen - 1) as Screen, -1);
  }, [goTo, screen]);

  const edit = useCallback(
    (step: StepNumber) => {
      if (busy.current) return;
      setSave({ kind: "idle" });
      setReturnToReview(true);
      goTo(step, -1);
    },
    [goTo],
  );

  /** Reopen an earlier step from the progress rail (nothing unsaved is sent). */
  const jump = useCallback(
    (target: Screen) => {
      if (busy.current || target === screen || target > furthest) return;
      setSave({ kind: "idle" });
      setNotice(null);
      if (target === 4) {
        setReturnToReview(false);
        goTo(4, 1);
        return;
      }
      setReturnToReview(furthest === 4);
      goTo(target, target < screen ? -1 : 1);
    },
    [furthest, goTo, screen],
  );

  const submit = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setSave({ kind: "saving" });
    try {
      const done = await waitlistApi.submit();
      adopt(done);
      forgetAllUnsaved();
      setSave({ kind: "idle" });
      setJustSubmitted(true);
      setView("done");
    } catch (error) {
      handleError(error, null);
    } finally {
      busy.current = false;
    }
  }, [adopt, handleError]);

  const openResume = useCallback((email?: string) => {
    if (email !== undefined) setResumeEmail(email);
    setView("resume");
  }, []);

  const closeResume = useCallback(() => setView(app && app.status !== "in_progress" ? "done" : "form"), [app]);

  /** A code from the email was accepted: this browser now holds the application. */
  const resumed = useCallback(
    (next: Application) => {
      adopt(next, { restoreDrafts: false });
      startKey.current = null;
      setNotice(null);
      setErrors({});
      setSave({ kind: "idle" });
      if (next.status !== "in_progress") {
        forgetAllUnsaved();
        setView("done");
        return;
      }
      const step = next.current_step as Screen;
      setFurthest(step);
      setDirection(1);
      setScreen(step);
      setView("form");
    },
    [adopt],
  );

  /** Shared device: sign this browser out of the application and start a new one. */
  const startOver = useCallback(async () => {
    if (busy.current) return;
    try {
      await waitlistApi.endSession();
    } catch {
      // Signing out is best effort; the page still clears.
    }
    forgetAllUnsaved();
    startKey.current = null;
    setApp(null);
    answersRef.current = EMPTY_ANSWERS;
    setAnswers(EMPTY_ANSWERS);
    setFurthest(1);
    setNotice(null);
    setSave({ kind: "idle" });
    setReturnToReview(false);
    goTo(1, -1);
    setView("form");
  }, [goTo]);

  return {
    view,
    screen,
    direction,
    furthest,
    answers,
    errors,
    attempted,
    attemptKey,
    save,
    app,
    notice,
    referral,
    justSubmitted,
    returnToReview,
    resumeEmail,
    honeypot,
    load,
    update,
    blur,
    continueStep,
    back,
    edit,
    jump,
    submit,
    openResume,
    closeResume,
    resumed,
    startOver,
    dismissNotice: () => setNotice(null),
    setReferral: (code: string) => {
      setReferral(code || null);
      rememberReferral(code || null);
    },
  };
}

export type ApplicationState = ReturnType<typeof useApplication>;
