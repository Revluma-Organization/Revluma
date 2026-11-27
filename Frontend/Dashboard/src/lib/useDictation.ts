import { useCallback, useEffect, useRef, useState } from "react";
import { appendInterim, appendPhrase, finishSentence } from "./dictationText";

// Live voice dictation for the Rev composer (ChatGPT-style voice input, with
// words appearing in the field while the merchant speaks).
//
// Engine: the browser's Web Speech API (SpeechRecognition). It streams interim
// results, so text lands in the composer immediately and is refined as each
// phrase finalises. Nothing is sent to Revluma until the merchant presses send:
// dictation only fills the text field.
//
// A separate getUserMedia stream feeds the waveform. It also makes the browser
// show its standard microphone prompt up front, so a denied permission is
// reported clearly before recognition starts.
//
// Behaviour contract:
// - start(): remembers the text already in the field and appends speech to it.
// - stop():  keeps exactly what the merchant saw (final + interim words).
// - cancel(): restores the field to what it was before dictation began.
// - Recognition ends on its own after silence in some browsers; while the
//   merchant has not stopped, it is restarted transparently and the words
//   already captured are kept.
// - Hard limits: the composer's max length and MAX_DICTATION_MS.
// - Punctuation: each recognised phrase is formatted as written prose on the
//   device as it arrives (lib/dictationText.ts). On stop, the optional
//   `polish` callback (a guarded model pass on the server) may refine it; the
//   result is applied only if the field still shows the dictated text.
// - Network drops: Chrome's speech service occasionally fails with "network".
//   That is retried with backoff (falling back to on-device recognition where
//   the browser offers it) and only reported after repeated failures. Words
//   already captured are always kept.

export const MAX_DICTATION_MS = 3 * 60 * 1000;

export type DictationError =
  | "permission"
  | "no-microphone"
  | "network"
  | "blocked"
  | "language"
  | "unsupported"
  | "failed";

export const DICTATION_ERROR_MESSAGES: Record<DictationError, string> = {
  permission: "Microphone access is blocked. Allow it for this site in your browser settings, then try again.",
  "no-microphone": "No microphone was found. Connect one and try again.",
  network: "Voice input lost its connection to your browser's speech service. Your words are kept. Tap the mic to continue.",
  blocked: "This browser blocks its speech service. Try Chrome, Edge or Safari.",
  language: "Voice input isn't available for your browser language yet.",
  unsupported: "Voice input isn't supported in this browser. Try Chrome, Edge or Safari.",
  failed: "Voice input stopped unexpectedly. Please try again.",
};

/* Minimal typings for the Web Speech API (not in lib.dom for every TS target). */
interface SpeechAlternativeLike { transcript: string }
interface SpeechResultLike { isFinal: boolean; length: number; [index: number]: SpeechAlternativeLike }
interface SpeechResultListLike { length: number; [index: number]: SpeechResultLike }
interface SpeechEventLike { resultIndex: number; results: SpeechResultListLike }
interface SpeechErrorEventLike { error: string }
export interface SpeechRecognitionLike {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  /** Chrome 139+: on-device recognition (no network). */
  processLocally?: boolean;
  onresult: ((event: SpeechEventLike) => void) | null;
  onerror: ((event: SpeechErrorEventLike) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start: () => void; stop: () => void; abort: () => void;
}
type SpeechRecognitionCtor = (new () => SpeechRecognitionLike) & {
  available?: (options: { langs: string[]; processLocally: boolean }) => Promise<string>;
};

// Brave exposes webkitSpeechRecognition but blocks Google's speech service, so
// every session fails with "network". Treat it as unsupported up front.
const isBrave = () => typeof navigator !== "undefined" && Boolean((navigator as unknown as { brave?: unknown }).brave);

export function getSpeechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  if (isBrave()) return null;
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Joins existing text and a spoken phrase with exactly one space. */
export function joinDictation(prefix: string, spoken: string): string {
  const words = spoken.replace(/\s+/g, " ").trim();
  if (!words) return prefix;
  if (!prefix.trim()) return words.charAt(0).toUpperCase() + words.slice(1);
  return /\s$/.test(prefix) ? prefix + words : `${prefix} ${words}`;
}

/** True when the browser can recognise this language on the device (Chrome 139+). */
async function canRecogniseLocally(lang: string): Promise<boolean> {
  const Ctor = getSpeechRecognition();
  if (!Ctor?.available) return false;
  try {
    return (await Ctor.available({ langs: [lang], processLocally: true })) === "available";
  } catch {
    return false;
  }
}

function mapError(code: string): DictationError | null {
  switch (code) {
    case "no-speech":
    case "aborted":
      return null; // silence or our own abort: not an error
    case "not-allowed":
    case "service-not-allowed":
      return "permission";
    case "audio-capture":
      return "no-microphone";
    case "network":
      return "network";
    case "language-not-supported":
      return "language";
    default:
      return "failed";
  }
}

// Chrome on Android repeats earlier final results in continuous mode, which
// duplicates words. Single-utterance sessions with transparent restarts avoid it.
const isAndroid = () => typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);

export interface UseDictationOptions {
  value: string;
  onChange: (text: string) => void;
  maxLength: number;
  lang?: string;
  /** Optional punctuation pass for the dictated text when dictation stops. */
  polish?: (text: string) => Promise<string | null>;
}

const MAX_NETWORK_RETRIES = 3;

export function useDictation({ value, onChange, maxLength, lang, polish }: UseDictationOptions) {
  const supported = getSpeechRecognition() !== null;
  const [polishing, setPolishing] = useState(false);
  const polishRef = useRef(polish);
  polishRef.current = polish;
  const polishTokenRef = useRef(0);
  const [listening, setListening] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<DictationError | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);

  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const wantRef = useRef(false);           // merchant still wants to dictate
  const baseRef = useRef("");              // field text before dictation began
  const prefixRef = useRef("");            // base + finals from earlier sessions
  const sessionPhrasesRef = useRef<string[]>([]); // finals in the current session
  const sessionInterimRef = useRef("");    // unfinished words in the current session
  const networkFailuresRef = useRef(0);    // consecutive "network" errors
  const heardRef = useRef(false);          // any words recognised this dictation
  const localRef = useRef(false);          // use on-device recognition
  const retryDelayRef = useRef(120);
  const shownRef = useRef("");             // what the field currently shows
  const streamRef = useRef<MediaStream | null>(null);
  const limitTimerRef = useRef<number | null>(null);
  const restartTimerRef = useRef<number | null>(null);
  const restartsRef = useRef(0);
  const activityRef = useRef(0);           // bumps on every result (waveform fallback)
  const tokenRef = useRef(0);              // invalidates callbacks from old sessions

  const write = useCallback((text: string) => {
    const bounded = text.slice(0, maxLength);
    shownRef.current = bounded;
    onChangeRef.current(bounded);
    return bounded.length >= maxLength;
  }, [maxLength]);

  const releaseMedia = useCallback(() => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    setStream(null);
    if (limitTimerRef.current !== null) window.clearTimeout(limitTimerRef.current);
    if (restartTimerRef.current !== null) window.clearTimeout(restartTimerRef.current);
    limitTimerRef.current = null;
    restartTimerRef.current = null;
  }, []);

  const teardown = useCallback(() => {
    wantRef.current = false;
    tokenRef.current += 1;
    const rec = recRef.current;
    recRef.current = null;
    if (rec) {
      rec.onresult = null; rec.onerror = null; rec.onend = null; rec.onstart = null;
      try { rec.abort(); } catch { /* already stopped */ }
    }
    releaseMedia();
    setListening(false);
    setStarting(false);
    setStartedAt(null);
  }, [releaseMedia]);

  /** Close the last dictated sentence when dictation ends mid-phrase. */
  const finishShown = useCallback(() => {
    const base = baseRef.current;
    const shown = shownRef.current;
    if (!heardRef.current || shown === base || !shown.startsWith(base)) return shown;
    const finished = finishSentence(shown);
    if (finished !== shown && finished.length <= maxLength) write(finished);
    return shownRef.current;
  }, [maxLength, write]);

  /** Stop and keep everything the merchant saw in the field, then polish it. */
  const stop = useCallback((options?: { polish?: boolean }) => {
    if (!wantRef.current && !recRef.current) return;
    const base = baseRef.current;
    teardown();
    const shown = finishShown();
    const runPolish = options?.polish === false ? undefined : polishRef.current;
    if (!runPolish || !heardRef.current || !shown.startsWith(base)) return;
    const dictated = shown.slice(base.length).trim();
    if (dictated.split(/\s+/).length < 2) return;
    const token = ++polishTokenRef.current;
    setPolishing(true);
    runPolish(dictated)
      .then(polished => {
        if (token !== polishTokenRef.current || !polished || !polished.trim()) return;
        // Apply only if the merchant has not edited, sent or re-dictated.
        if (valueRef.current !== shown) return;
        const joined = base.trim() ? `${base.replace(/\s+$/, "")} ${polished.trim()}` : polished.trim();
        write(joined);
      })
      .catch(() => undefined)
      .finally(() => { if (token === polishTokenRef.current) setPolishing(false); });
  }, [finishShown, teardown, write]);

  /** Stop and put the field back exactly as it was before dictation. */
  const cancel = useCallback(() => {
    if (!wantRef.current && !recRef.current) return;
    polishTokenRef.current += 1;
    setPolishing(false);
    const base = baseRef.current;
    teardown();
    onChangeRef.current(base);
  }, [teardown]);

  const fail = useCallback((reason: DictationError) => {
    teardown();
    finishShown();
    setError(reason);
  }, [finishShown, teardown]);

  const startSession = useCallback((token: number) => {
    const Ctor = getSpeechRecognition();
    if (!Ctor || token !== tokenRef.current || !wantRef.current) return;
    const rec = new Ctor();
    rec.lang = lang || (typeof navigator !== "undefined" ? navigator.language : "") || "en-US";
    rec.continuous = !isAndroid();
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    if (localRef.current) rec.processLocally = true;
    sessionPhrasesRef.current = [];
    sessionInterimRef.current = "";
    retryDelayRef.current = 120;

    rec.onstart = () => {
      if (token !== tokenRef.current) return;
      setStarting(false);
      setListening(true);
    };
    rec.onresult = event => {
      if (token !== tokenRef.current) return;
      const phrases: string[] = [];
      let interim = "";
      for (let i = 0; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) phrases.push(transcript);
        else interim += ` ${transcript}`;
      }
      sessionPhrasesRef.current = phrases;
      sessionInterimRef.current = interim;
      activityRef.current += 1;
      networkFailuresRef.current = 0;
      if (phrases.some(phrase => phrase.trim()) || interim.trim()) heardRef.current = true;
      // Each finished phrase is written as prose; the live phrase follows it.
      const finished = phrases.reduce(appendPhrase, prefixRef.current);
      if (write(appendInterim(finished, interim))) { wantRef.current = false; teardown(); }
    };
    rec.onerror = event => {
      if (token !== tokenRef.current) return;
      const reason = mapError(event.error);
      if (reason === "network" && wantRef.current) {
        // Transient drop: onend follows and restarts with backoff. Prefer
        // on-device recognition for the retry when the browser has it.
        networkFailuresRef.current += 1;
        if (networkFailuresRef.current <= MAX_NETWORK_RETRIES) {
          retryDelayRef.current = 400 * networkFailuresRef.current;
          void canRecogniseLocally(rec.lang).then(local => { if (local) localRef.current = true; });
          return;
        }
        fail(heardRef.current ? "network" : "blocked");
        return;
      }
      if (reason) fail(reason);
    };
    rec.onend = () => {
      if (token !== tokenRef.current) return;
      recRef.current = null;
      if (!wantRef.current) { teardown(); return; }
      // Ended on its own (silence, Android single-utterance). Keep the finals
      // and resume listening, unless it keeps ending immediately.
      // Words still being recognised when the session dropped were already on
      // screen; keep them unfinished so the next session continues the sentence.
      const finished = sessionPhrasesRef.current.reduce(appendPhrase, prefixRef.current);
      prefixRef.current = appendInterim(finished, sessionInterimRef.current);
      if (shownRef.current !== prefixRef.current) write(prefixRef.current);
      restartsRef.current += 1;
      if (restartsRef.current > 60) { teardown(); return; }
      restartTimerRef.current = window.setTimeout(() => startSession(token), retryDelayRef.current);
    };

    recRef.current = rec;
    try {
      rec.start();
    } catch {
      fail("failed");
    }
  }, [fail, lang, teardown, write]);

  const start = useCallback(async () => {
    if (wantRef.current) return;
    setError(null);
    if (!getSpeechRecognition()) { setError("unsupported"); return; }
    // Never transcribe Rev reading an answer aloud.
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();

    const token = ++tokenRef.current;
    polishTokenRef.current += 1;
    setPolishing(false);
    wantRef.current = true;
    restartsRef.current = 0;
    networkFailuresRef.current = 0;
    heardRef.current = false;
    localRef.current = false;
    baseRef.current = valueRef.current;
    prefixRef.current = valueRef.current;
    shownRef.current = valueRef.current;
    activityRef.current = 0;
    setStarting(true);

    // Waveform stream + explicit permission prompt. A denial is final; any
    // other failure (no mediaDevices, insecure context) only loses the waveform.
    const media = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    if (media?.getUserMedia) {
      try {
        const granted = await media.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        if (token !== tokenRef.current) { granted.getTracks().forEach(track => track.stop()); return; }
        streamRef.current = granted;
        setStream(granted);
      } catch (cause) {
        if (token !== tokenRef.current) return;
        const name = (cause as { name?: string } | null)?.name;
        if (name === "NotAllowedError" || name === "SecurityError") { fail("permission"); return; }
        if (name === "NotFoundError" || name === "OverconstrainedError") { fail("no-microphone"); return; }
      }
    }

    setStartedAt(Date.now());
    limitTimerRef.current = window.setTimeout(() => { if (token === tokenRef.current) stop(); }, MAX_DICTATION_MS);
    startSession(token);
  }, [fail, startSession, stop]);

  // Release the microphone if the composer unmounts mid-dictation.
  useEffect(() => () => teardown(), [teardown]);

  return {
    supported,
    /** True from the click until dictation ends (includes the permission prompt). */
    active: listening || starting,
    listening, starting, polishing, error, stream, startedAt, activityRef,
    start, stop, cancel,
    clearError: useCallback(() => setError(null), []),
  };
}
