// Live voice call with Rev (ChatGPT Voice-style, on Gemini Live).
//
// How it feels like talking to a person:
// - Full duplex: the mic streams continuously and Rev's voice streams back.
//   Gemini decides when the merchant has finished (patient end-of-speech, so
//   thinking pauses are not cut off) and ignores speech not meant for Rev.
// - Barge-in: the moment the merchant talks over Rev, playback is flushed and
//   Rev answers what they just said.
// - Delegation: store questions go to Rev's grounded investigation pipeline
//   (ask_rev, non-blocking) while the conversation keeps flowing; the written
//   answer with its evidence lands in the chat, and the voice explains it.
// - Continuity: the call starts with the open thread as context, and survives
//   Gemini's periodic connection resets through session resumption.
//
// Node meters the call (30 minutes per organization per day by default):
// heartbeats every 15 s, server-clock accounting, auto-end at the limit.
//
// A call is a conversation, exactly like a typed chat (ChatGPT keeps voice
// chats in history the same way): the server gives a call started outside a
// conversation its own, every finished spoken line is saved into it as it
// happens, and whatever is still unsaved rides along with the hang-up (also
// when the tab closes). The page adopts the conversation for its URL, title
// and history.
import { useCallback, useEffect, useRef, useState } from "react";
import api, { ApiError, getApiBaseUrl, getStreamingAuthHeaders } from "@/lib/api";
import { LiveAudio, MicError, liveAudioSupported } from "@/lib/revLiveAudio";
import { LiveClient, type LiveConnectOptions, type LiveFunctionCall } from "@/lib/revLiveClient";
import {
  END_MESSAGES, appendTranscript, finalizeTranscript, markInterrupted, questionFromArgs, transcriptWire,
  voiceToolResult,
  type CallActivity, type CallEndReason, type CallPhase, type CallView, type TranscriptEntry, type TranscriptWire,
  type VoiceAskOutcome,
} from "@/lib/revLiveCall";

export interface LiveSession {
  session_id: string;
  token: string;
  ws_url: string;
  model: string;
  voice?: string | null;
  max_seconds: number;
  remaining_seconds?: number;
  heartbeat_interval_ms?: number;
  /** The conversation this call is saved into (created by the server when needed). */
  conversation_id?: string | null;
  /** True when the server created the conversation for this call. */
  conversation_created?: boolean;
}

/** Progress of saving the call's spoken lines. */
export interface CallSaveState {
  /** Spoken lines saved into the conversation so far. */
  lines: number;
  /** Words the merchant said in saved lines (decides when to title the chat). */
  userWords: number;
}

export interface CallEndedInfo {
  /** The call's conversation, or null when the server removed it (nothing was said). */
  conversationId: string | null;
  /** The conversation the call was attached to when it started. */
  callConversationId: string | null;
  created: boolean;
  saved: CallSaveState;
}

interface AudioLike {
  readonly levels: { input: number; output: number };
  prime(): void;
  start(): Promise<void>;
  setMuted(muted: boolean): void;
  play(base64Pcm: string): void;
  flush(): void;
  readonly speaking: boolean;
  drained(timeoutMs?: number): Promise<void>;
  sampleOutput(): number;
  close(): void;
}

interface ClientLike {
  connect(): void;
  readonly open: boolean;
  sendAudio(base64Pcm: string): void;
  sendAudioStreamEnd(): void;
  sendToolResponse(id: string, name: string, response: Record<string, unknown>,
    scheduling: "INTERRUPT" | "WHEN_IDLE" | "SILENT"): void;
  close(): void;
}

export interface UseRevLiveCallOptions {
  conversationId: string | null;
  /** Run a store question through Rev's normal pipeline (shown in chat). */
  onAsk: (question: string) => Promise<VoiceAskOutcome>;
  /** The call is attached to this conversation (created: the server made it for the call). */
  onConversation?: (conversationId: string, created: boolean) => void;
  /** Spoken lines were saved into the call's conversation. */
  onSaved?: (conversationId: string, saved: CallSaveState) => void;
  /** The call ended and its last lines were saved (or could not be). */
  onEnded?: (info: CallEndedInfo) => void;
  /** Test seams. */
  createAudio?: (onChunk: (pcm: string) => void) => AudioLike;
  createClient?: (options: LiveConnectOptions) => ClientLike;
  isSupported?: () => boolean;
}

const MAX_RECONNECTS = 3;
const SAVE_DEBOUNCE_MS = 700;
const SAVE_BATCH = 25;
// How long a store question waits for the lines before it to be saved, so the
// saved conversation reads in the order it was spoken.
const SAVE_BEFORE_ASK_MS = 2500;
const FINAL_SAVE_MS = 4000;
// Browsers cap keepalive request bodies at 64 KB in total.
const KEEPALIVE_TEXT_BUDGET = 56_000;
const SETUP_TIMEOUT_MS = 12_000;
const WARN_AT_SECONDS = 60;
const USER_LEVEL_THRESHOLD = 0.14;

type ApiBody = { success?: boolean; data?: unknown; error?: { code?: string; message?: string } };

function errorMessage(error: unknown): string {
  if (error instanceof MicError) return error.message;
  if (error instanceof ApiError) {
    const body = error.body as ApiBody | undefined;
    const code = body?.error?.code;
    if (code === "VOICE_LIMIT_REACHED") return END_MESSAGES.limit as string;
    if (code === "RATE_LIMITED") return "Too many calls started. Please wait a few minutes.";
    if (code === "VOICE_UNAVAILABLE" || error.status === 503) return END_MESSAGES.unavailable as string;
    if (error.status === 0) return "You're offline or the service can't be reached. Check your connection and try again.";
  }
  return "The call couldn't start. Please try again.";
}

function settleWithin(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise(resolve => {
    const timer = window.setTimeout(resolve, ms);
    promise.then(() => resolve(), () => resolve()).finally(() => window.clearTimeout(timer));
  });
}

function userWords(entries: TranscriptWire[]): number {
  return entries.filter(entry => entry.speaker === "user")
    .reduce((total, entry) => total + entry.text.split(/\s+/).filter(Boolean).length, 0);
}

export function useRevLiveCall({
  conversationId, onAsk, onConversation, onSaved, onEnded, createAudio, createClient, isSupported,
}: UseRevLiveCallOptions) {
  const [phase, setPhase] = useState<CallPhase>("idle");
  const [activity, setActivity] = useState<CallActivity>("listening");
  const [muted, setMutedState] = useState(false);
  const [view, setView] = useState<CallView>("chat");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [maxSeconds, setMaxSeconds] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [supported] = useState(() => (isSupported ?? liveAudioSupported)());
  const [callConversationId, setCallConversationId] = useState<string | null>(null);
  const [saved, setSaved] = useState<CallSaveState>({ lines: 0, userWords: 0 });

  const phaseRef = useRef<CallPhase>("idle");
  const audioRef = useRef<AudioLike | null>(null);
  const clientRef = useRef<ClientLike | null>(null);
  const sessionRef = useRef<LiveSession | null>(null);
  const handleRef = useRef<string | null>(null);
  const reconnectsRef = useRef(0);
  const goAwayRef = useRef(false);
  const mutedRef = useRef(false);
  const timersRef = useRef<number[]>([]);
  const rafRef = useRef(0);
  const askingRef = useRef(new Map<string, boolean>()); // id -> cancelled
  const countsRef = useRef({ turns: 0, asks: 0 });
  const lastInputAtRef = useRef(0);
  const lastOutputAtRef = useRef(0);
  const startedAtRef = useRef<number | null>(null);
  const warnedRef = useRef(false);
  const authRef = useRef<Record<string, string>>({});
  const conversationRef = useRef(conversationId);
  const onAskRef = useRef(onAsk);
  const onConversationRef = useRef(onConversation);
  const onSavedRef = useRef(onSaved);
  const onEndedRef = useRef(onEnded);
  const levelsRef = useRef({ input: 0, output: 0 });
  conversationRef.current = conversationId;
  onAskRef.current = onAsk;
  onConversationRef.current = onConversation;
  onSavedRef.current = onSaved;
  onEndedRef.current = onEnded;

  // Transcript mirror: socket callbacks update it synchronously so a save can
  // read exactly what was said, without waiting for a render.
  const transcriptRef = useRef<TranscriptEntry[]>([]);
  const updateTranscript = useCallback((change: (entries: TranscriptEntry[]) => TranscriptEntry[]) => {
    const next = change(transcriptRef.current);
    if (next === transcriptRef.current) return;
    transcriptRef.current = next;
    setTranscript(next);
  }, []);

  // Saving spoken lines.
  const saveTargetRef = useRef<{ sessionId: string; conversationId: string | null; created: boolean } | null>(null);
  const savedIdsRef = useRef(new Set<string>());
  const savedRef = useRef<CallSaveState>({ lines: 0, userWords: 0 });
  const saveRunRef = useRef<Promise<void> | null>(null);
  const saveTimerRef = useRef(0);
  const saveFailuresRef = useRef(0);
  const saveStoppedRef = useRef(false);

  const unsavedLines = useCallback((source: TranscriptEntry[] = transcriptRef.current): TranscriptWire[] => source
    .filter(entry => entry.final && !savedIdsRef.current.has(entry.id))
    .map(transcriptWire)
    .filter((entry): entry is TranscriptWire => entry !== null), []);

  const markSaved = useCallback((batch: TranscriptWire[], conversation: string | null) => {
    if (!batch.length) return;
    batch.forEach(entry => savedIdsRef.current.add(entry.client_id));
    savedRef.current = {
      lines: savedRef.current.lines + batch.length,
      userWords: savedRef.current.userWords + userWords(batch),
    };
    setSaved(savedRef.current);
    if (conversation) onSavedRef.current?.(conversation, savedRef.current);
  }, []);

  /**
   * Save every finished, unsaved line (serialised; retried with backoff).
   * `source` pins the lines to save (hanging up snapshots them, because the
   * page may clear the visible transcript while the save is in flight).
   */
  const saveLines = useCallback(async (source?: TranscriptEntry[]): Promise<void> => {
    if (saveRunRef.current) await saveRunRef.current.catch(() => undefined);
    const target = saveTargetRef.current;
    const lines = () => unsavedLines(source ?? transcriptRef.current);
    if (!target || saveStoppedRef.current || !lines().length) return;
    const run = (async () => {
      for (let round = 0; round < 40; round += 1) {
        const batch = lines().slice(0, SAVE_BATCH);
        if (!batch.length || saveTargetRef.current !== target) return;
        try {
          const res = await api.post<ApiBody>(`/rev/live/session/${target.sessionId}/transcript`,
            { entries: batch }, { timeoutMs: 10000 });
          const data = res?.data?.data as { conversation_id?: string | null } | undefined;
          saveFailuresRef.current = 0;
          markSaved(batch, data?.conversation_id ?? target.conversationId);
        } catch (err) {
          const status = err instanceof ApiError ? err.status : 0;
          if (status === 400) {
            // A malformed line can never succeed; skip it rather than loop.
            batch.forEach(entry => savedIdsRef.current.add(entry.client_id));
            continue;
          }
          if (status === 404 || status === 409) {
            // The call or its conversation is gone (deleted, or long over).
            saveStoppedRef.current = true;
            return;
          }
          saveFailuresRef.current += 1;
          const delay = Math.min(15_000, 1000 * 2 ** Math.min(saveFailuresRef.current, 4));
          window.clearTimeout(saveTimerRef.current);
          saveTimerRef.current = window.setTimeout(() => { void saveLines(); }, delay);
          return;
        }
      }
    })();
    saveRunRef.current = run;
    try { await run; } finally { if (saveRunRef.current === run) saveRunRef.current = null; }
  }, [markSaved, unsavedLines]);

  /** Lines finish in bursts (speaker change, turn end): save shortly after. */
  const scheduleSave = useCallback(() => {
    if (!saveTargetRef.current) return;
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => { void saveLines(); }, SAVE_DEBOUNCE_MS);
  }, [saveLines]);

  const setPhaseBoth = useCallback((next: CallPhase) => { phaseRef.current = next; setPhase(next); }, []);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach(id => { window.clearInterval(id); window.clearTimeout(id); });
    timersRef.current = [];
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
  }, []);

  const teardown = useCallback(() => {
    clearTimers();
    clientRef.current?.close();
    clientRef.current = null;
    audioRef.current?.close();
    audioRef.current = null;
    levelsRef.current = { input: 0, output: 0 };
    askingRef.current.forEach((_, id) => askingRef.current.set(id, true));
  }, [clearTimers]);

  const finish = useCallback(async (reason: CallEndReason, { notifyServer = true } = {}) => {
    const current = phaseRef.current;
    if (current === "idle" || current === "ended" || current === "error" || current === "ending") return;
    setPhaseBoth("ending");
    teardown();
    updateTranscript(finalizeTranscript);
    setActivity("listening");
    setView("chat");
    const session = sessionRef.current;
    const target = saveTargetRef.current;
    let keptConversation: string | null = target?.conversationId ?? null;
    // Save what was said before hanging up; anything still unsaved rides
    // along with the hang-up so it lands before the server tidies up.
    const said = transcriptRef.current;
    window.clearTimeout(saveTimerRef.current);
    await settleWithin(saveLines(said), FINAL_SAVE_MS);
    if (session && notifyServer) {
      const leftovers = saveStoppedRef.current ? [] : unsavedLines(said).slice(-SAVE_BATCH);
      try {
        const res = await api.post<ApiBody>(`/rev/live/session/${session.session_id}/end`, {
          reason, turn_count: countsRef.current.turns, ask_count: countsRef.current.asks,
          ...(leftovers.length ? { entries: leftovers } : {}),
        }, { timeoutMs: 8000 });
        const data = res?.data?.data as { conversation_id?: string | null } | undefined;
        if (data && "conversation_id" in data) keptConversation = data.conversation_id ?? null;
        if (leftovers.length && keptConversation) markSaved(leftovers, keptConversation);
      } catch { /* the server reaps calls that stop heartbeating */ }
    }
    window.clearTimeout(saveTimerRef.current);
    saveTargetRef.current = null;
    sessionRef.current = null;
    setNotice(END_MESSAGES[reason] ?? null);
    setPhaseBoth("ended");
    if (target) {
      if (!keptConversation) setCallConversationId(null);
      onEndedRef.current?.({
        conversationId: keptConversation,
        callConversationId: target.conversationId,
        created: target.created,
        saved: savedRef.current,
      });
    }
  }, [markSaved, saveLines, setPhaseBoth, teardown, unsavedLines, updateTranscript]);

  const end = useCallback((reason: CallEndReason = "hangup") => { void finish(reason); }, [finish]);

  const handleToolCalls = useCallback((calls: LiveFunctionCall[]) => {
    for (const call of calls) {
      if (call.name === "end_call") {
        clientRef.current?.sendToolResponse(call.id, call.name, { result: "ok" }, "SILENT");
        const audio = audioRef.current;
        void (audio ? audio.drained(6000) : Promise.resolve()).then(() => finish("assistant"));
        continue;
      }
      if (call.name !== "ask_rev") continue;
      const question = questionFromArgs(call.args);
      countsRef.current.asks += 1;
      askingRef.current.set(call.id, false);
      const respond = (outcome: VoiceAskOutcome) => {
        const cancelled = askingRef.current.get(call.id);
        askingRef.current.delete(call.id);
        if (cancelled || phaseRef.current !== "live") return;
        clientRef.current?.sendToolResponse(call.id, call.name, voiceToolResult(outcome), "WHEN_IDLE");
      };
      if (!question) { respond({ ok: false, reason: "failed", message: "No question was given." }); continue; }
      // What the merchant just said is saved first, so the conversation reads
      // in the order it was spoken (their words, then the investigated answer).
      updateTranscript(finalizeTranscript);
      void settleWithin(saveLines(), SAVE_BEFORE_ASK_MS)
        .then(() => onAskRef.current(question))
        .then(respond, () => respond({ ok: false, reason: "failed" }));
    }
  }, [finish, saveLines, updateTranscript]);

  const connect = useCallback((session: LiveSession, resumeHandle: string | null) => {
    clientRef.current?.close();
    const make = createClient ?? ((options: LiveConnectOptions) => new LiveClient(options));
    const client = make({
      wsUrl: session.ws_url,
      token: session.token,
      model: session.model,
      resumeHandle,
      handlers: {
        onReady: () => {
          window.clearTimeout(setupTimer);
          reconnectsRef.current = 0;
          goAwayRef.current = false;
          if (mutedRef.current) client.sendAudioStreamEnd();
          setPhaseBoth("live");
          if (startedAtRef.current === null) {
            startedAtRef.current = Date.now();
            setStartedAt(startedAtRef.current);
          }
        },
        onAudio: (pcm) => {
          lastOutputAtRef.current = Date.now();
          audioRef.current?.play(pcm);
        },
        onInputTranscript: (text) => {
          const at = Date.now();
          if (at - lastInputAtRef.current > 1500 && lastOutputAtRef.current >= lastInputAtRef.current) {
            countsRef.current.turns += 1;
          }
          lastInputAtRef.current = at;
          updateTranscript(entries => appendTranscript(entries, "user", text, at));
        },
        onOutputTranscript: (text) => {
          lastOutputAtRef.current = Date.now();
          updateTranscript(entries => appendTranscript(entries, "rev", text));
        },
        onInterrupted: () => {
          audioRef.current?.flush();
          updateTranscript(markInterrupted);
          scheduleSave();
        },
        onTurnComplete: () => {
          updateTranscript(finalizeTranscript);
          scheduleSave();
          if (goAwayRef.current) reconnect();
        },
        onToolCall: handleToolCalls,
        onToolCancel: (ids) => ids.forEach(id => { if (askingRef.current.has(id)) askingRef.current.set(id, true); }),
        onResumeHandle: (handle) => { handleRef.current = handle; },
        onGoAway: (timeLeftMs) => {
          goAwayRef.current = true;
          // Reconnect between sentences when possible, never after the cut-off.
          const audio = audioRef.current;
          if (!audio?.speaking) { reconnect(); return; }
          const id = window.setTimeout(() => { if (goAwayRef.current) reconnect(); }, Math.max(0, timeLeftMs - 1500));
          timersRef.current.push(id);
        },
        onClose: ({ code }) => handleDrop(code),
      },
    });
    clientRef.current = client;
    // A socket that opens but never finishes setup is treated as a drop.
    const setupTimer = window.setTimeout(() => {
      if (clientRef.current !== client) return;
      if (phaseRef.current !== "connecting" && phaseRef.current !== "reconnecting") return;
      client.close();
      handleDrop(4000);
    }, SETUP_TIMEOUT_MS);
    timersRef.current.push(setupTimer);
    client.connect();

    function handleDrop(code: number) {
      if (clientRef.current !== client) return;
      if (phaseRef.current !== "live" && phaseRef.current !== "reconnecting" && phaseRef.current !== "connecting") return;
      // Once a call has been live, a drop resumes the same conversation
      // (the handle), even if a reconnect attempt itself drops again.
      const wasLive = startedAtRef.current !== null;
      if (wasLive && handleRef.current && reconnectsRef.current < MAX_RECONNECTS && code !== 1008) {
        reconnectsRef.current += 1;
        setPhaseBoth("reconnecting");
        const id = window.setTimeout(() => reconnect(), 400 * reconnectsRef.current);
        timersRef.current.push(id);
        return;
      }
      setError(wasLive ? (END_MESSAGES.error as string) : "Couldn't connect the call. Please try again.");
      void finish("error");
    }

    function reconnect() {
      const current = sessionRef.current;
      if (!current || phaseRef.current === "ending" || phaseRef.current === "ended") return;
      goAwayRef.current = false;
      setPhaseBoth("reconnecting");
      connect(current, handleRef.current);
    }
  }, [createClient, finish, handleToolCalls, scheduleSave, setPhaseBoth, updateTranscript]);

  const startLoops = useCallback((session: LiveSession) => {
    const interval = Math.max(5000, session.heartbeat_interval_ms ?? 15000);
    const beat = window.setInterval(async () => {
      if (!sessionRef.current || (phaseRef.current !== "live" && phaseRef.current !== "reconnecting")) return;
      try {
        const res = await api.post<ApiBody>(`/rev/live/session/${session.session_id}/heartbeat`, {
          turn_count: countsRef.current.turns, ask_count: countsRef.current.asks,
        }, { timeoutMs: 8000 });
        const data = res?.data?.data as { status?: string; end_reason?: CallEndReason } | undefined;
        if (data?.status === "ended") void finish(data.end_reason ?? "limit", { notifyServer: false });
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) void finish("error", { notifyServer: false });
      }
    }, interval);
    const tick = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      const started = startedAtRef.current;
      if (started === null || phaseRef.current === "ending" || phaseRef.current === "ended") return;
      const left = session.max_seconds - (t - started) / 1000;
      if (left <= WARN_AT_SECONDS && !warnedRef.current) {
        warnedRef.current = true;
        setNotice("About a minute of voice time left today.");
      }
      if (left <= 0) void finish("limit");
    }, 500);
    timersRef.current.push(beat, tick);

    // Activity: who has the floor, derived from audio and transcripts.
    let lastSample = 0;
    const loop = (frameTime: number) => {
      rafRef.current = requestAnimationFrame(loop);
      const audio = audioRef.current;
      if (!audio) return;
      const output = audio.sampleOutput();
      levelsRef.current = { input: audio.levels.input, output };
      if (frameTime - lastSample < 120) return;
      lastSample = frameTime;
      const t = Date.now();
      let next: CallActivity = "listening";
      if (audio.speaking) next = "rev";
      else if ([...askingRef.current.values()].some(cancelled => !cancelled)) next = "checking";
      else if ((!mutedRef.current && audio.levels.input > USER_LEVEL_THRESHOLD) || t - lastInputAtRef.current < 700) next = "user";
      else if (lastInputAtRef.current > lastOutputAtRef.current && t - lastInputAtRef.current < 4000) next = "thinking";
      setActivity(previous => (previous === next ? previous : next));
    };
    rafRef.current = requestAnimationFrame(loop);
  }, [finish]);

  const start = useCallback(async () => {
    const current = phaseRef.current;
    if (current !== "idle" && current !== "ended" && current !== "error") return;
    if (!supported) {
      setError("Voice calls aren't supported in this browser. Try the latest Chrome, Edge or Safari.");
      setPhaseBoth("error");
      return;
    }
    setError(null);
    setNotice(null);
    setMutedState(false);
    mutedRef.current = false;
    warnedRef.current = false;
    countsRef.current = { turns: 0, asks: 0 };
    handleRef.current = null;
    reconnectsRef.current = 0;
    startedAtRef.current = null;
    setStartedAt(null);
    setActivity("listening");
    // A new call starts a fresh transcript (the previous call's lines are saved).
    transcriptRef.current = [];
    setTranscript([]);
    saveTargetRef.current = null;
    savedIdsRef.current = new Set();
    savedRef.current = { lines: 0, userWords: 0 };
    setSaved(savedRef.current);
    saveFailuresRef.current = 0;
    saveStoppedRef.current = false;
    window.clearTimeout(saveTimerRef.current);
    setPhaseBoth("starting");

    const audio = (createAudio ?? ((onChunk: (pcm: string) => void) => new LiveAudio({ onChunk })))((pcm) => {
      if (phaseRef.current === "live" && !mutedRef.current) clientRef.current?.sendAudio(pcm);
    });
    audioRef.current = audio;
    try {
      audio.prime(); // inside the click: unlocks audio on Safari and iOS
      await audio.start();
      if (phaseRef.current !== "starting") { audio.close(); return; }
      try { authRef.current = await getStreamingAuthHeaders(); } catch { authRef.current = {}; }
      const res = await api.post<ApiBody>("/rev/live/session",
        conversationRef.current ? { conversation_id: conversationRef.current } : {}, { timeoutMs: 15000 });
      const session = res?.data?.data as LiveSession | undefined;
      if (!session?.session_id || !session.token || !session.ws_url) throw new ApiError(503, "unavailable", { error: { code: "VOICE_UNAVAILABLE" } });
      if (phaseRef.current !== "starting") {
        void api.post(`/rev/live/session/${session.session_id}/end`, { reason: "hangup" }).catch(() => undefined);
        return;
      }
      sessionRef.current = session;
      const callConversation = typeof session.conversation_id === "string" && session.conversation_id
        ? session.conversation_id : null;
      saveTargetRef.current = {
        sessionId: session.session_id, conversationId: callConversation, created: session.conversation_created === true,
      };
      setCallConversationId(callConversation);
      if (callConversation) onConversationRef.current?.(callConversation, session.conversation_created === true);
      setMaxSeconds(session.max_seconds);
      setPhaseBoth("connecting");
      connect(session, null);
      startLoops(session);
    } catch (err) {
      teardown();
      setError(errorMessage(err));
      setPhaseBoth("error");
    }
  }, [connect, createAudio, setPhaseBoth, startLoops, supported, teardown]);

  const toggleMute = useCallback(() => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMutedState(next);
    audioRef.current?.setMuted(next);
    if (next) clientRef.current?.sendAudioStreamEnd();
  }, []);

  const clearTranscript = useCallback(() => {
    transcriptRef.current = [];
    setTranscript([]);
  }, []);
  const dismiss = useCallback(() => {
    setError(null);
    setNotice(null);
    if (phaseRef.current === "error" || phaseRef.current === "ended") setPhaseBoth("idle");
  }, [setPhaseBoth]);

  // Closing or leaving the tab hangs up (keepalive survives the unload).
  useEffect(() => {
    const onHide = () => {
      const session = sessionRef.current;
      if (!session) return;
      // Unsaved lines (including the one being spoken) ride along with the
      // hang-up; keepalive bodies are capped (~64 KB) so the newest fit.
      const lines = finalizeTranscript(transcriptRef.current)
        .filter(entry => !savedIdsRef.current.has(entry.id))
        .map(transcriptWire)
        .filter((entry): entry is TranscriptWire => entry !== null)
        .slice(-SAVE_BATCH);
      let budget = KEEPALIVE_TEXT_BUDGET;
      const entries: TranscriptWire[] = [];
      const encoder = new TextEncoder();
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        budget -= encoder.encode(JSON.stringify(lines[i])).length + 4;
        if (budget < 0) break;
        entries.unshift(lines[i]);
      }
      try {
        void fetch(`${getApiBaseUrl()}/rev/live/session/${session.session_id}/end`, {
          method: "POST", keepalive: true, credentials: "include",
          headers: { "Content-Type": "application/json", ...authRef.current },
          body: JSON.stringify({
            reason: "unload", turn_count: countsRef.current.turns, ask_count: countsRef.current.asks,
            ...(entries.length && !saveStoppedRef.current ? { entries } : {}),
          }),
        }).catch(() => undefined);
      } catch { /* best effort; the server reaps silent calls */ }
      sessionRef.current = null;
      saveTargetRef.current = null;
      window.clearTimeout(saveTimerRef.current);
      teardown();
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
    };
  }, [teardown]);

  // Unmount (leaving Rev) hangs up.
  useEffect(() => () => {
    const session = sessionRef.current;
    window.clearTimeout(saveTimerRef.current);
    if (session) {
      const entries = saveStoppedRef.current ? [] : finalizeTranscript(transcriptRef.current)
        .filter(entry => !savedIdsRef.current.has(entry.id))
        .map(transcriptWire)
        .filter((entry): entry is TranscriptWire => entry !== null)
        .slice(-SAVE_BATCH);
      void api.post(`/rev/live/session/${session.session_id}/end`, {
        reason: "hangup", turn_count: countsRef.current.turns, ask_count: countsRef.current.asks,
        ...(entries.length ? { entries } : {}),
      }).catch(() => undefined);
      sessionRef.current = null;
    }
    saveTargetRef.current = null;
    teardown();
    phaseRef.current = "idle";
  }, [teardown]);

  const elapsedMs = startedAt === null ? 0 : Math.max(0, now - startedAt);
  const remainingSeconds = maxSeconds === null ? null : Math.max(0, Math.round(maxSeconds - elapsedMs / 1000));
  const inCall = phase === "starting" || phase === "connecting" || phase === "live" || phase === "reconnecting" || phase === "ending";

  return {
    supported, phase, activity, muted, view, transcript, startedAt, elapsedMs, remainingSeconds,
    error, notice, inCall, levelsRef, conversationId: callConversationId, saved,
    start, end, toggleMute, setView, clearTranscript, dismiss,
  };
}

export type RevLiveCall = ReturnType<typeof useRevLiveCall>;
