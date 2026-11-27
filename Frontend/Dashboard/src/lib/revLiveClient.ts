// Gemini Live WebSocket protocol for Rev voice calls.
//
// The browser connects straight to Google with a single-use ephemeral token
// (?access_token=auth_tokens/...) minted by our backend. The token locks the
// whole session setup (persona, tools, voice, turn detection, transcription),
// so the first message only names the model and, when reconnecting, the
// session-resumption handle that carries the conversation across Gemini's
// periodic connection resets.

export interface LiveFunctionCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type LiveScheduling = "INTERRUPT" | "WHEN_IDLE" | "SILENT";

export interface LiveClientHandlers {
  onOpen?: () => void;
  /** Setup accepted: audio can flow. */
  onReady?: () => void;
  /** 24 kHz PCM16 base64. */
  onAudio?: (base64Pcm: string) => void;
  /** Merchant speech recognised so far (incremental chunk). */
  onInputTranscript?: (text: string) => void;
  /** Rev speech recognised so far (incremental chunk). */
  onOutputTranscript?: (text: string) => void;
  /** The merchant started talking over Rev; stop playback now. */
  onInterrupted?: () => void;
  /** Rev finished generating this turn (audio may still be playing). */
  onGenerationComplete?: () => void;
  onTurnComplete?: () => void;
  onToolCall?: (calls: LiveFunctionCall[]) => void;
  onToolCancel?: (ids: string[]) => void;
  onVoiceActivity?: (speaking: boolean) => void;
  /** The server will close this connection soon; reconnect with the handle. */
  onGoAway?: (timeLeftMs: number) => void;
  onResumeHandle?: (handle: string) => void;
  onClose?: (event: { code: number; reason: string; wasClean: boolean }) => void;
  onError?: () => void;
}

export interface LiveConnectOptions {
  wsUrl: string;
  token: string;
  model: string;
  resumeHandle?: string | null;
  handlers: LiveClientHandlers;
  /** Injected in tests. */
  WebSocketImpl?: typeof WebSocket;
}

/** "5s" / "1.5s" protobuf durations to milliseconds. */
export function parseDurationMs(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value * 1000;
  if (typeof value !== "string") return 0;
  const match = /^(\d+(?:\.\d+)?)s$/.exec(value.trim());
  return match ? Math.round(Number(match[1]) * 1000) : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Route one decoded server message to handlers. Exported for tests. */
export function dispatchServerMessage(message: unknown, handlers: LiveClientHandlers): void {
  if (!isRecord(message)) return;
  if ("setupComplete" in message) handlers.onReady?.();

  const content = message.serverContent;
  if (isRecord(content)) {
    if (content.interrupted === true) handlers.onInterrupted?.();
    const turn = content.modelTurn;
    if (isRecord(turn) && Array.isArray(turn.parts)) {
      for (const part of turn.parts) {
        const inline = isRecord(part) ? part.inlineData : null;
        if (isRecord(inline) && typeof inline.data === "string"
          && (typeof inline.mimeType !== "string" || inline.mimeType.startsWith("audio/"))) {
          handlers.onAudio?.(inline.data);
        }
      }
    }
    const input = content.inputTranscription;
    if (isRecord(input) && typeof input.text === "string" && input.text) handlers.onInputTranscript?.(input.text);
    const output = content.outputTranscription;
    if (isRecord(output) && typeof output.text === "string" && output.text) handlers.onOutputTranscript?.(output.text);
    if (content.generationComplete === true) handlers.onGenerationComplete?.();
    if (content.turnComplete === true) handlers.onTurnComplete?.();
  }

  const toolCall = message.toolCall;
  if (isRecord(toolCall) && Array.isArray(toolCall.functionCalls)) {
    const calls = toolCall.functionCalls.flatMap((call): LiveFunctionCall[] => {
      if (!isRecord(call) || typeof call.name !== "string") return [];
      return [{
        id: typeof call.id === "string" ? call.id : "",
        name: call.name,
        args: isRecord(call.args) ? call.args : {},
      }];
    });
    if (calls.length) handlers.onToolCall?.(calls);
  }
  const cancellation = message.toolCallCancellation;
  if (isRecord(cancellation) && Array.isArray(cancellation.ids)) {
    handlers.onToolCancel?.(cancellation.ids.filter((id): id is string => typeof id === "string"));
  }

  const activity = message.voiceActivity;
  if (isRecord(activity) && typeof activity.voiceActivityType === "string") {
    handlers.onVoiceActivity?.(activity.voiceActivityType === "ACTIVITY_START");
  } else if (isRecord(activity) && typeof activity.type === "string") {
    handlers.onVoiceActivity?.(activity.type === "ACTIVITY_START");
  }

  const goAway = message.goAway;
  if (isRecord(goAway)) handlers.onGoAway?.(parseDurationMs(goAway.timeLeft));

  const resumption = message.sessionResumptionUpdate;
  if (isRecord(resumption) && resumption.resumable !== false
    && typeof resumption.newHandle === "string" && resumption.newHandle) {
    handlers.onResumeHandle?.(resumption.newHandle);
  }
}

const decoder = typeof TextDecoder !== "undefined" ? new TextDecoder() : null;

export class LiveClient {
  private ws: WebSocket | null = null;
  private closedByUs = false;

  constructor(private readonly options: LiveConnectOptions) {}

  connect(): void {
    const { wsUrl, token, model, resumeHandle, handlers } = this.options;
    const Impl = this.options.WebSocketImpl ?? WebSocket;
    const url = `${wsUrl}?access_token=${encodeURIComponent(token)}`;
    const ws = new Impl(url);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onopen = () => {
      handlers.onOpen?.();
      this.sendJson({
        setup: {
          model,
          sessionResumption: resumeHandle ? { handle: resumeHandle } : {},
        },
      });
    };
    ws.onmessage = (event: MessageEvent) => {
      let text: string | null = null;
      if (typeof event.data === "string") text = event.data;
      else if (event.data instanceof ArrayBuffer && decoder) text = decoder.decode(event.data);
      if (!text) return;
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { return; }
      dispatchServerMessage(parsed, handlers);
    };
    ws.onerror = () => { if (!this.closedByUs) handlers.onError?.(); };
    ws.onclose = (event: CloseEvent) => {
      if (this.ws === ws) this.ws = null;
      if (!this.closedByUs) handlers.onClose?.({ code: event.code, reason: event.reason, wasClean: event.wasClean });
    };
  }

  get open(): boolean {
    return Boolean(this.ws && this.ws.readyState === 1);
  }

  sendAudio(base64Pcm: string): void {
    this.sendJson({ realtimeInput: { audio: { data: base64Pcm, mimeType: "audio/pcm;rate=16000" } } });
  }

  /** Mic muted or paused: lets the server close the merchant's turn cleanly. */
  sendAudioStreamEnd(): void {
    this.sendJson({ realtimeInput: { audioStreamEnd: true } });
  }

  sendText(text: string): void {
    this.sendJson({ realtimeInput: { text } });
  }

  sendToolResponse(id: string, name: string, response: Record<string, unknown>, scheduling: LiveScheduling): void {
    this.sendJson({ toolResponse: { functionResponses: [{ id, name, response: { ...response, scheduling } }] } });
  }

  close(): void {
    this.closedByUs = true;
    const ws = this.ws;
    this.ws = null;
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) {
      try { ws.close(1000, "call ended"); } catch { /* ignore */ }
    }
  }

  private sendJson(payload: unknown): void {
    if (!this.ws || this.ws.readyState !== 1) return;
    try { this.ws.send(JSON.stringify(payload)); } catch { /* socket closing */ }
  }
}
