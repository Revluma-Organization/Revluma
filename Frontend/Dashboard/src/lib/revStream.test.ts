import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  getApiBaseUrl: () => "https://api.example.test/api/v1",
  getStreamingAuthHeaders: async () => ({ Authorization: "Bearer test-token" }),
}));

import { createSseParser, RevStreamError, streamRevAnswer } from "./revStream";

function streamResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/event-stream" },
  });
}

const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

const finalPayload = {
  success: true,
  conversation_id: "11111111-1111-4111-8111-111111111111",
  read_only: true,
  response_type: "analysis",
  text: "Orders fell by 12%.",
  evidence: {
    items: [{
      id: "ev-1", metric: "orders_count", label: "Orders", value: 41, unit: "count",
      currency: null, status: "available",
      period: { start: "2026-10-01", end: "2026-10-31" },
      source: "orders", definition: "Count of recorded orders in the period.",
    }],
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("createSseParser", () => {
  it("parses frames split across chunk boundaries", () => {
    const seen: Array<[string, unknown]> = [];
    const parser = createSseParser((event, data) => seen.push([event, data]));
    const raw = frame("plan", { intent: "revenue" }) + frame("step", { tool: "orders_summary" });
    parser.push(raw.slice(0, 15));
    parser.push(raw.slice(15, 45));
    parser.push(raw.slice(45));
    expect(seen.map(([event]) => event)).toEqual(["plan", "step"]);
    expect(seen[0][1]).toMatchObject({ intent: "revenue" });
  });

  it("ignores comment lines, malformed JSON and empty frames", () => {
    const handler = vi.fn();
    const parser = createSseParser(handler);
    parser.push(": keep-alive\n\n");
    parser.push("event: step\ndata: {not-json}\n\n");
    parser.push("\n\n");
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("streamRevAnswer", () => {
  it("dispatches typed events and resolves with the conversation id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(streamResponse([
      frame("meta", { conversation_id: "conv-1", correlation_id: "corr-1" }),
      frame("plan", { intent: "revenue", steps: [{ id: "s1", tool: "orders_summary", label: "Orders", status: "pending" }] }),
      frame("step", { id: "s1", tool: "orders_summary", label: "Orders", status: "completed" }),
      frame("final", finalPayload),
    ]));
    vi.stubGlobal("fetch", fetchMock);

    const onMeta = vi.fn();
    const onPlan = vi.fn();
    const onStep = vi.fn();
    const onFinal = vi.fn();

    const result = await streamRevAnswer({
      message: "How did revenue move?",
      handlers: { onMeta, onPlan, onStep, onFinal },
    });

    // The final frame is authoritative for the persisted conversation id.
    expect(result).toEqual({ conversationId: "11111111-1111-4111-8111-111111111111", completed: true });
    expect(onMeta).toHaveBeenCalledWith({ conversation_id: "conv-1", correlation_id: "corr-1" });
    expect(onPlan.mock.calls[0][0].steps).toHaveLength(1);
    expect(onStep).toHaveBeenCalledWith(expect.objectContaining({ tool: "orders_summary", status: "completed" }));
    expect(onFinal.mock.calls[0][0].evidence.items[0].id).toBe("ev-1");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.test/api/v1/rev/stream");
    expect((init.headers as Record<string, string>).Accept).toBe("text/event-stream");
    expect(JSON.parse(init.body as string)).toEqual({ message: "How did revenue move?" });
  });

  it("sends conversation id and read-only turn options without an execute capability", async () => {
    const fetchMock = vi.fn().mockResolvedValue(streamResponse([frame("final", finalPayload)]));
    vi.stubGlobal("fetch", fetchMock);
    await streamRevAnswer({ message: "Why?", conversationId: "conv-9", handlers: {} });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toEqual({ message: "Why?", conversation_id: "conv-9" });
    expect(body).not.toHaveProperty("execute");
  });

  it("raises a typed error carrying the server error code", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ success: false, error: { code: "READ_ONLY", message: "Read-only release." } }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    await expect(streamRevAnswer({ message: "Change my prices", handlers: {} }))
      .rejects.toMatchObject({ code: "READ_ONLY", status: 403 });
  });

  it("sends the finding identifier and retry options without client-provided evidence", async () => {
    const fetchMock = vi.fn().mockResolvedValue(streamResponse([frame("final", finalPayload)]));
    vi.stubGlobal("fetch", fetchMock);
    await streamRevAnswer({
      message: "My edited question", conversationId: "conv-9",
      findingId: "11111111-1111-4111-8111-111111111111", reuseUserMessage: true, handlers: {},
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      message: "My edited question", conversation_id: "conv-9",
      finding_id: "11111111-1111-4111-8111-111111111111", reuse_user_message: true,
    });
  });

  it("raises a typed error for an in-stream error frame", async () => {
    const fetchMock = vi.fn().mockResolvedValue(streamResponse([
      frame("meta", { conversation_id: "conv-2" }),
      frame("error", { code: "CURRENCY_UNVERIFIED", message: "Currency is not verified." }),
    ]));
    vi.stubGlobal("fetch", fetchMock);

    const rejection = await streamRevAnswer({ message: "Revenue?", handlers: {} }).catch((error) => error);
    expect(rejection).toBeInstanceOf(RevStreamError);
    expect(rejection.code).toBe("CURRENCY_UNVERIFIED");
  });

  it("distinguishes an initial connection timeout from merchant cancellation", async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      (init.signal as AbortSignal).addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(streamRevAnswer({ message: "Wait", handlers: {}, timeoutMs: 5, inactivityTimeoutMs: 1000 }))
      .rejects.toMatchObject({ code: "INTELLIGENCE_TIMEOUT" });
  });

  it("fails a silent in-flight stream instead of reporting cancellation or success", async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          (init.signal as AbortSignal).addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")));
        },
      });
      return new Response(body, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(streamRevAnswer({ message: "Wait", handlers: {}, timeoutMs: 1000, inactivityTimeoutMs: 5 }))
      .rejects.toMatchObject({ code: "INTELLIGENCE_TIMEOUT" });
  });

  it("resolves completed:false when the request is aborted", async () => {
    const encoder = new TextEncoder();
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(frame("meta", { conversation_id: "conv-3" })));
          (init.signal as AbortSignal).addEventListener("abort", () => {
            try { controller.error(new DOMException("Aborted", "AbortError")); } catch { /* noop */ }
          });
        },
      });
      return new Response(body, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const controller = new AbortController();
    const promise = streamRevAnswer({ message: "Stop", conversationId: "conv-3", signal: controller.signal, handlers: {} });
    await Promise.resolve();
    controller.abort();
    await expect(promise).resolves.toEqual({ conversationId: "conv-3", completed: false });
  });
});
