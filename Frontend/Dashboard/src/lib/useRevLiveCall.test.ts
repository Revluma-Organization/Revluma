import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import api from "@/lib/api";
import { useRevLiveCall } from "./useRevLiveCall";
import type { LiveConnectOptions } from "./revLiveClient";

vi.mock("@/lib/api", () => {
  class ApiError extends Error {
    constructor(public status: number, message: string, public body?: unknown) { super(message); }
  }
  const mocked = { get: vi.fn(), post: vi.fn() };
  return {
    api: mocked, default: mocked, ApiError,
    getApiBaseUrl: () => "https://api.example.test/api/v1",
    getStreamingAuthHeaders: async () => ({ Authorization: "Bearer fixture" }),
  };
});

const SESSION = {
  session_id: "55555555-5555-4555-8555-555555555555", token: "auth_tokens/t", ws_url: "wss://example.test/ws",
  model: "models/gemini-3.8-live", max_seconds: 120, heartbeat_interval_ms: 15000,
};

class FakeAudio {
  levels = { input: 0, output: 0 };
  speaking = false;
  muted = false;
  closed = false;
  played: string[] = [];
  flushed = 0;
  constructor(public onChunk: (pcm: string) => void) {}
  prime() {}
  async start() {}
  setMuted(muted: boolean) { this.muted = muted; }
  play(pcm: string) { this.played.push(pcm); }
  flush() { this.flushed += 1; }
  drained() { return Promise.resolve(); }
  sampleOutput() { return 0; }
  close() { this.closed = true; }
}

class FakeClient {
  open = true;
  closed = false;
  audio: string[] = [];
  streamEnds = 0;
  sent: Array<{ id: string; name: string; response: Record<string, unknown>; scheduling: string }> = [];
  constructor(public options: LiveConnectOptions) {}
  connect() {}
  sendAudio(pcm: string) { this.audio.push(pcm); }
  sendAudioStreamEnd() { this.streamEnds += 1; }
  sendToolResponse(id: string, name: string, response: Record<string, unknown>, scheduling: string) {
    this.sent.push({ id, name, response, scheduling });
  }
  close() { this.closed = true; }
}

let audios: FakeAudio[] = [];
let clients: FakeClient[] = [];

function setup(onAsk = vi.fn(async () => ({ ok: true, answer: "Revenue was $12,400." }))) {
  return renderHook(() => useRevLiveCall({
    conversationId: null,
    onAsk,
    isSupported: () => true,
    createAudio: (onChunk) => { const audio = new FakeAudio(onChunk); audios.push(audio); return audio; },
    createClient: (options) => { const client = new FakeClient(options); clients.push(client); return client; },
  }));
}

async function connected(onAsk?: Parameters<typeof setup>[0]) {
  const hook = setup(onAsk);
  await act(async () => { await hook.result.current.start(); });
  await act(async () => { clients[0].options.handlers.onReady?.(); });
  return hook;
}

beforeEach(() => {
  audios = []; clients = [];
  vi.mocked(api.post).mockReset();
  vi.mocked(api.post).mockImplementation(async (path: string) => {
    if (path === "/rev/live/session") return { ok: true, status: 201, data: { success: true, data: SESSION } } as never;
    return { ok: true, status: 200, data: { success: true, data: { status: "active" } } } as never;
  });
});
afterEach(() => { vi.useRealTimers(); });

describe("useRevLiveCall", () => {
  it("starts with the mic, mints a session, and streams audio only while live and unmuted", async () => {
    const hook = await connected();
    expect(hook.result.current.phase).toBe("live");
    expect(clients[0].options).toMatchObject({ token: SESSION.token, wsUrl: SESSION.ws_url, model: SESSION.model, resumeHandle: null });
    audios[0].onChunk("pcm-1");
    expect(clients[0].audio).toEqual(["pcm-1"]);
    act(() => hook.result.current.toggleMute());
    expect(audios[0].muted).toBe(true);
    expect(clients[0].streamEnds).toBe(1);
    audios[0].onChunk("pcm-2");
    expect(clients[0].audio).toEqual(["pcm-1"]);
  });

  it("plays Rev's voice and flushes it the moment the merchant interrupts", async () => {
    const hook = await connected();
    act(() => {
      clients[0].options.handlers.onAudio?.("rev-audio");
      clients[0].options.handlers.onOutputTranscript?.("Revenue was");
      clients[0].options.handlers.onInterrupted?.();
    });
    expect(audios[0].played).toEqual(["rev-audio"]);
    expect(audios[0].flushed).toBe(1);
    expect(hook.result.current.transcript[0]).toMatchObject({ speaker: "rev", interrupted: true });
  });

  it("answers ask_rev through onAsk and ignores a cancelled call", async () => {
    let finish!: (value: { ok: boolean; answer: string }) => void;
    const onAsk = vi.fn()
      .mockResolvedValueOnce({ ok: true, answer: "Revenue was $12,400." })
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await connected(onAsk);
    await act(async () => {
      clients[0].options.handlers.onToolCall?.([{ id: "a", name: "ask_rev", args: { question: "Sales last week?" } }]);
    });
    expect(onAsk).toHaveBeenCalledWith("Sales last week?");
    await waitFor(() => expect(clients[0].sent).toHaveLength(1));
    expect(clients[0].sent[0]).toMatchObject({ id: "a", scheduling: "WHEN_IDLE", response: { status: "answered" } });

    await act(async () => {
      clients[0].options.handlers.onToolCall?.([{ id: "b", name: "ask_rev", args: { question: "Refunds?" } }]);
      clients[0].options.handlers.onToolCancel?.(["b"]);
    });
    await act(async () => { finish({ ok: true, answer: "late" }); });
    expect(clients[0].sent).toHaveLength(1);
  });

  it("reconnects with the resumption handle on goAway", async () => {
    const hook = await connected();
    act(() => {
      clients[0].options.handlers.onResumeHandle?.("handle-1");
      clients[0].options.handlers.onGoAway?.(5000);
    });
    expect(clients).toHaveLength(2);
    expect(clients[0].closed).toBe(true);
    expect(clients[1].options.resumeHandle).toBe("handle-1");
    expect(hook.result.current.phase).toBe("reconnecting");
    act(() => clients[1].options.handlers.onReady?.());
    expect(hook.result.current.phase).toBe("live");
  });

  it("recovers from a dropped connection, and ends the call when it cannot", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const hook = await connected();
    act(() => {
      clients[0].options.handlers.onResumeHandle?.("handle-1");
      clients[0].options.handlers.onClose?.({ code: 1006, reason: "", wasClean: false });
    });
    expect(hook.result.current.phase).toBe("reconnecting");
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(clients).toHaveLength(2);
    // An auth/policy close (token expired) is final.
    await act(async () => { clients[1].options.handlers.onClose?.({ code: 1008, reason: "", wasClean: true }); });
    await waitFor(() => expect(hook.result.current.phase).toBe("ended"));
    expect(hook.result.current.error).toMatch(/call dropped/i);
    expect(api.post).toHaveBeenCalledWith(`/rev/live/session/${SESSION.session_id}/end`, expect.objectContaining({ reason: "error" }), expect.anything());
  });

  it("ends when the server says the call is over (limit or another tab)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(api.post).mockImplementation(async (path: string) => {
      if (path === "/rev/live/session") return { ok: true, status: 201, data: { success: true, data: SESSION } } as never;
      if (path.endsWith("/heartbeat")) return { ok: true, status: 200, data: { success: true, data: { status: "ended", end_reason: "replaced" } } } as never;
      return { ok: true, status: 200, data: { success: true } } as never;
    });
    const hook = await connected();
    await act(async () => { vi.advanceTimersByTime(15_100); });
    await waitFor(() => expect(hook.result.current.phase).toBe("ended"));
    expect(hook.result.current.notice).toBe("This call continued in another tab.");
    expect(vi.mocked(api.post).mock.calls.some(([path]) => String(path).endsWith("/end"))).toBe(false);
    expect(audios[0].closed).toBe(true);
  });

  it("hangs up by itself when the day's allowance runs out", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const hook = await connected();
    await act(async () => { vi.advanceTimersByTime(61_000); });
    expect(hook.result.current.notice).toBe("About a minute of voice time left today.");
    await act(async () => { vi.advanceTimersByTime(60_000); });
    await waitFor(() => expect(hook.result.current.phase).toBe("ended"));
    expect(api.post).toHaveBeenCalledWith(`/rev/live/session/${SESSION.session_id}/end`, expect.objectContaining({ reason: "limit" }), expect.anything());
    expect(hook.result.current.notice).toMatch(/resets at midnight UTC/);
  });

  it("explains a blocked microphone without minting a session", async () => {
    const hook = renderHook(() => useRevLiveCall({
      conversationId: null, onAsk: vi.fn(), isSupported: () => true,
      createAudio: (onChunk) => {
        const audio = new FakeAudio(onChunk);
        audio.start = async () => { const { MicError } = await import("./revLiveAudio"); throw new MicError("denied", "Microphone access is blocked. Allow it in your browser to talk with Rev."); };
        return audio;
      },
      createClient: (options) => new FakeClient(options),
    }));
    await act(async () => { await hook.result.current.start(); });
    expect(hook.result.current.phase).toBe("error");
    expect(hook.result.current.error).toMatch(/Microphone access is blocked/);
    expect(api.post).not.toHaveBeenCalled();
  });

  it("hangs up after Rev says goodbye with end_call", async () => {
    const hook = await connected();
    await act(async () => { clients[0].options.handlers.onToolCall?.([{ id: "bye", name: "end_call", args: {} }]); });
    await waitFor(() => expect(hook.result.current.phase).toBe("ended"));
    expect(clients[0].sent[0]).toMatchObject({ name: "end_call", scheduling: "SILENT" });
    expect(api.post).toHaveBeenCalledWith(`/rev/live/session/${SESSION.session_id}/end`, expect.objectContaining({ reason: "assistant" }), expect.anything());
  });
});
