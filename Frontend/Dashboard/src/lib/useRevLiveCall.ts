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
import { useCallback, useEffect, useRef, useState } from "react";
import api, { ApiError, getApiBaseUrl, getStreamingAuthHeaders } from "@/lib/api";
import { LiveAudio, MicError, liveAudioSupported } from "@/lib/revLiveAudio";
import { LiveClient, type LiveConnectOptions, type LiveFunctionCall } from "@/lib/revLiveClient";
import {
  END_MESSAGES, appendTranscript, finalizeTranscript, markInterrupted, questionFromArgs, voiceToolResult,
  type CallActivity, type CallEndReason, type CallPhase, type CallView, type TranscriptEntry, type VoiceAskOutcome,
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
  /** Test seams. */
  createAudio?: (onChunk: (pcm: string) => void) => AudioLike;
  createClient?: (options: LiveConnectOptions) => ClientLike;
  isSupported?: () => boolean;
}

const MAX_RECONNECTS = 3;
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

export function useRevLiveCall({ conversationId, onAsk, createAudio, createClient, isSupported }: UseRevLiveCallOptions) {
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
  const levelsRef = useRef({ input: 0, output: 0 });
  conversationRef.current = conversationId;
  onAskRef.current = onAsk;

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
    setTranscript(entries => finalizeTranscript(entries));
    setActivity("listening");
    setView("chat");
    const session = sessionRef.current;
    if (session && notifyServer) {
      try {
        await api.post(`/rev/live/session/${session.session_id}/end`, {
          reason, turn_count: countsRef.current.turns, ask_count: countsRef.current.asks,
          ...(conversationRef.current ? { conversation_id: conversationRef.current } : {}),
        }, { timeoutMs: 8000 });
      } catch { /* the server reaps calls that stop heartbeating */ }
    }
    sessionRef.current = null;
    setNotice(END_MESSAGES[reason] ?? null);
    setPhaseBoth("ended");
  }, [setPhaseBoth, teardown]);

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
      onAskRef.current(question).then(respond, () => respond({ ok: false, reason: "failed" }));
    }
  }, [finish]);

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
          setTranscript(entries => appendTranscript(entries, "user", text, at));
        },
        onOutputTranscript: (text) => {
          lastOutputAtRef.current = Date.now();
          setTranscript(entries => appendTranscript(entries, "rev", text));
        },
        onInterrupted: () => {
          audioRef.current?.flush();
          setTranscript(entries => markInterrupted(entries));
        },
        onTurnComplete: () => {
          setTranscript(entries => finalizeTranscript(entries));
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
  }, [createClient, finish, handleToolCalls, setPhaseBoth]);

  const startLoops = useCallback((session: LiveSession) => {
    const interval = Math.max(5000, session.heartbeat_interval_ms ?? 15000);
    const beat = window.setInterval(async () => {
      if (!sessionRef.current || (phaseRef.current !== "live" && phaseRef.current !== "reconnecting")) return;
      try {
        const res = await api.post<ApiBody>(`/rev/live/session/${session.session_id}/heartbeat`, {
          turn_count: countsRef.current.turns, ask_count: countsRef.current.asks,
          ...(conversationRef.current ? { conversation_id: conversationRef.current } : {}),
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

  const clearTranscript = useCallback(() => setTranscript([]), []);
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
      try {
        void fetch(`${getApiBaseUrl()}/rev/live/session/${session.session_id}/end`, {
          method: "POST", keepalive: true, credentials: "include",
          headers: { "Content-Type": "application/json", ...authRef.current },
          body: JSON.stringify({ reason: "unload", turn_count: countsRef.current.turns, ask_count: countsRef.current.asks }),
        }).catch(() => undefined);
      } catch { /* best effort; the server reaps silent calls */ }
      sessionRef.current = null;
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
    if (session) {
      void api.post(`/rev/live/session/${session.session_id}/end`, { reason: "hangup" }).catch(() => undefined);
      sessionRef.current = null;
    }
    teardown();
    phaseRef.current = "idle";
  }, [teardown]);

  const elapsedMs = startedAt === null ? 0 : Math.max(0, now - startedAt);
  const remainingSeconds = maxSeconds === null ? null : Math.max(0, Math.round(maxSeconds - elapsedMs / 1000));
  const inCall = phase === "starting" || phase === "connecting" || phase === "live" || phase === "reconnecting" || phase === "ending";

  return {
    supported, phase, activity, muted, view, transcript, startedAt, elapsedMs, remainingSeconds,
    error, notice, inCall, levelsRef,
    start, end, toggleMute, setView, clearTranscript, dismiss,
  };
}

export type RevLiveCall = ReturnType<typeof useRevLiveCall>;
