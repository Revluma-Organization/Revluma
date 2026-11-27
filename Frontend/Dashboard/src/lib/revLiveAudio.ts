// Audio for live voice calls with Rev (Gemini Live).
//
// Capture: microphone -> AudioWorklet -> 16 kHz mono PCM16 chunks of ~40 ms.
// The browser's echo cancellation, noise suppression and auto gain stay on,
// so Rev's own voice from the speakers is not heard as the merchant barging in
// (the main cause of false interruptions in voice assistants).
//
// Playback: 24 kHz PCM16 chunks from Gemini are scheduled back to back on the
// same AudioContext. `flush()` stops everything instantly; it runs when the
// merchant interrupts, so Rev stops talking the moment they do.
//
// Levels: input and output loudness (0 - 1) are exposed for the orb and
// waveform, read on animation frames without React re-renders.

export const CAPTURE_RATE = 16000;
export const PLAYBACK_RATE = 24000;
const CHUNK_SAMPLES = 640; // 40 ms at 16 kHz

// Box-filter decimation to 16 kHz plus RMS level, in the audio thread.
const WORKLET_SOURCE = `
class RevCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.ratio = sampleRate / ${CAPTURE_RATE};
    this.acc = 0; this.accN = 0; this.pos = 0;
    this.out = new Int16Array(${CHUNK_SAMPLES}); this.fill = 0;
    this.sq = 0; this.sqN = 0;
  }
  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      const s = input[i];
      this.acc += s; this.accN++; this.pos++;
      this.sq += s * s; this.sqN++;
      if (this.pos >= this.ratio) {
        this.pos -= this.ratio;
        const v = Math.max(-1, Math.min(1, this.acc / this.accN));
        this.out[this.fill++] = v < 0 ? v * 0x8000 : v * 0x7fff;
        this.acc = 0; this.accN = 0;
        if (this.fill === ${CHUNK_SAMPLES}) {
          const level = Math.sqrt(this.sq / Math.max(1, this.sqN));
          this.port.postMessage({ pcm: this.out.buffer, level }, [this.out.buffer]);
          this.out = new Int16Array(${CHUNK_SAMPLES}); this.fill = 0;
          this.sq = 0; this.sqN = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("rev-capture", RevCapture);
`;

export type MicErrorKind = "denied" | "no-device" | "unsupported" | "failed";

export class MicError extends Error {
  kind: MicErrorKind;
  constructor(kind: MicErrorKind, message: string) {
    super(message);
    this.name = "MicError";
    this.kind = kind;
  }
}

export function liveAudioSupported(): boolean {
  if (typeof window === "undefined") return false;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return Boolean(Ctor && typeof AudioWorkletNode !== "undefined" && navigator.mediaDevices?.getUserMedia
    && typeof WebSocket !== "undefined");
}

/** PCM16 little-endian bytes to base64 without blowing the call stack. */
export function pcmToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + step)));
  }
  return btoa(binary);
}

/** Base64 PCM16 little-endian to Float32 samples in [-1, 1]. */
export function base64ToFloat32(data: string): Float32Array {
  const binary = atob(data);
  const length = binary.length >> 1;
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const lo = binary.charCodeAt(i * 2);
    const hi = binary.charCodeAt(i * 2 + 1);
    let value = (hi << 8) | lo;
    if (value >= 0x8000) value -= 0x10000;
    out[i] = value / 0x8000;
  }
  return out;
}

/** Perceptual 0 - 1 curve for an RMS value (speech RMS is roughly 0.02 - 0.2). */
export function levelFromRms(rms: number): number {
  if (!Number.isFinite(rms) || rms <= 0) return 0;
  return Math.min(1, Math.pow(rms * 5, 0.7));
}

export interface LiveAudioOptions {
  onChunk: (base64Pcm: string) => void;
}

export class LiveAudio {
  readonly levels = { input: 0, output: 0 };
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private outGain: GainNode | null = null;
  private outAnalyser: AnalyserNode | null = null;
  private outBuffer = new Uint8Array(0);
  private playing = new Set<AudioBufferSourceNode>();
  private nextStart = 0;
  private muted = false;
  private closed = false;
  private onChunk: (base64Pcm: string) => void;
  private drainWaiters: Array<() => void> = [];

  constructor({ onChunk }: LiveAudioOptions) {
    this.onChunk = onChunk;
  }

  /**
   * Create the AudioContext synchronously inside the click handler (iOS and
   * Safari only allow audio to start from a user gesture), then ask for the mic.
   */
  prime(): void {
    if (this.ctx) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) throw new MicError("unsupported", "Voice calls aren't supported in this browser.");
    this.ctx = new Ctor({ latencyHint: "interactive" });
    void this.ctx.resume?.().catch(() => undefined);
  }

  async start(): Promise<void> {
    this.prime();
    const ctx = this.ctx!;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
    } catch (error) {
      const name = (error as { name?: string })?.name;
      if (name === "NotAllowedError" || name === "SecurityError") {
        throw new MicError("denied", "Microphone access is blocked. Allow it in your browser to talk with Rev.");
      }
      if (name === "NotFoundError" || name === "OverconstrainedError") {
        throw new MicError("no-device", "No microphone was found. Connect one and try again.");
      }
      throw new MicError("failed", "The microphone couldn't start. Please try again.");
    }
    if (this.closed) { stream.getTracks().forEach(track => track.stop()); return; }
    this.stream = stream;

    const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "application/javascript" }));
    try {
      await ctx.audioWorklet.addModule(url);
    } catch {
      throw new MicError("unsupported", "Voice calls aren't supported in this browser.");
    } finally {
      URL.revokeObjectURL(url);
    }
    if (this.closed) return;

    this.source = ctx.createMediaStreamSource(stream);
    this.worklet = new AudioWorkletNode(ctx, "rev-capture", { numberOfInputs: 1, numberOfOutputs: 0 });
    this.worklet.port.onmessage = (event: MessageEvent<{ pcm: ArrayBuffer; level: number }>) => {
      const { pcm, level } = event.data;
      this.levels.input = this.muted ? 0 : levelFromRms(level);
      if (!this.muted && !this.closed) this.onChunk(pcmToBase64(pcm));
    };
    this.source.connect(this.worklet);

    this.outGain = ctx.createGain();
    this.outAnalyser = ctx.createAnalyser();
    this.outAnalyser.fftSize = 512;
    this.outAnalyser.smoothingTimeConstant = 0.5;
    this.outBuffer = new Uint8Array(this.outAnalyser.fftSize);
    this.outGain.connect(this.outAnalyser);
    this.outAnalyser.connect(ctx.destination);
    await ctx.resume?.().catch(() => undefined);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.stream?.getAudioTracks().forEach(track => { track.enabled = !muted; });
    if (muted) this.levels.input = 0;
  }

  /** Queue one 24 kHz PCM16 chunk right after whatever is already playing. */
  play(base64Pcm: string): void {
    const ctx = this.ctx;
    if (!ctx || !this.outGain || this.closed) return;
    const samples = base64ToFloat32(base64Pcm);
    if (!samples.length) return;
    const buffer = ctx.createBuffer(1, samples.length, PLAYBACK_RATE);
    buffer.getChannelData(0).set(samples);
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(this.outGain);
    const startAt = Math.max(ctx.currentTime + 0.03, this.nextStart);
    node.start(startAt);
    this.nextStart = startAt + buffer.duration;
    this.playing.add(node);
    node.onended = () => {
      this.playing.delete(node);
      if (!this.playing.size) this.resolveDrain();
    };
  }

  /** Rev was interrupted: stop speaking immediately and drop queued audio. */
  flush(): void {
    for (const node of this.playing) {
      try { node.onended = null; node.stop(); } catch { /* already stopped */ }
    }
    this.playing.clear();
    this.nextStart = 0;
    this.levels.output = 0;
    this.resolveDrain();
  }

  get speaking(): boolean {
    return this.playing.size > 0;
  }

  /** Resolves when queued speech has finished (or after `timeoutMs`). */
  drained(timeoutMs = 5000): Promise<void> {
    if (!this.playing.size) return Promise.resolve();
    return new Promise(resolve => {
      const timer = window.setTimeout(resolve, timeoutMs);
      this.drainWaiters.push(() => { window.clearTimeout(timer); resolve(); });
    });
  }

  /** Sample output loudness; call from requestAnimationFrame. */
  sampleOutput(): number {
    if (!this.outAnalyser || !this.outBuffer.length || !this.playing.size) {
      this.levels.output *= 0.8;
      return this.levels.output;
    }
    this.outAnalyser.getByteTimeDomainData(this.outBuffer);
    let sum = 0;
    for (let i = 0; i < this.outBuffer.length; i += 1) {
      const v = (this.outBuffer[i] - 128) / 128;
      sum += v * v;
    }
    this.levels.output = levelFromRms(Math.sqrt(sum / this.outBuffer.length));
    return this.levels.output;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.flush();
    try { this.worklet?.port.close(); } catch { /* ignore */ }
    try { this.source?.disconnect(); } catch { /* ignore */ }
    try { this.worklet?.disconnect(); } catch { /* ignore */ }
    this.stream?.getTracks().forEach(track => track.stop());
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.stream = null;
    this.levels.input = 0;
    this.levels.output = 0;
  }

  private resolveDrain(): void {
    const waiters = this.drainWaiters;
    this.drainWaiters = [];
    waiters.forEach(fn => fn());
  }
}
