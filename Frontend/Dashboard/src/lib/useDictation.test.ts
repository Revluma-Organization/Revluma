import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { joinDictation, useDictation, DICTATION_ERROR_MESSAGES } from "./useDictation";

type Part = [transcript: string, isFinal: boolean];

class FakeRecognition {
  static instances: FakeRecognition[] = [];
  lang = ""; continuous = false; interimResults = false; maxAlternatives = 1;
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  onstart: (() => void) | null = null;
  started = false; aborted = false;
  constructor() { FakeRecognition.instances.push(this); }
  start() { this.started = true; this.onstart?.(); }
  stop() { this.onend?.(); }
  abort() { this.aborted = true; }
  emit(parts: Part[]) {
    this.onresult?.({ resultIndex: 0, results: parts.map(([transcript, isFinal]) => Object.assign([{ transcript }], { isFinal })) });
  }
}

const latest = () => FakeRecognition.instances[FakeRecognition.instances.length - 1];

function setup(initial = "", maxLength = 2000) {
  return renderHook(() => {
    const [value, setValue] = useState(initial);
    const dictation = useDictation({ value, onChange: setValue, maxLength, lang: "en-US" });
    return { value, dictation };
  });
}

describe("joinDictation", () => {
  it("capitalises a fresh message and joins with one space", () => {
    expect(joinDictation("", "  hello   there ")).toBe("Hello there");
    expect(joinDictation("Revenue", "this week")).toBe("Revenue this week");
    expect(joinDictation("Revenue ", "this week")).toBe("Revenue this week");
    expect(joinDictation("Revenue", "   ")).toBe("Revenue");
  });
});

describe("useDictation", () => {
  beforeEach(() => {
    FakeRecognition.instances = [];
    (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition = FakeRecognition;
  });
  afterEach(() => {
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    vi.useRealTimers();
  });

  it("streams interim words into the field live and keeps them on stop", async () => {
    const { result } = setup("Why did");
    await act(async () => { await result.current.dictation.start(); });
    expect(result.current.dictation.listening).toBe(true);
    expect(latest().interimResults).toBe(true);
    expect(latest().lang).toBe("en-US");

    act(() => latest().emit([["revenue", false]]));
    expect(result.current.value).toBe("Why did revenue");
    act(() => latest().emit([["revenue drop", true], [" this week", false]]));
    // A finished phrase is written as prose; the live phrase follows it.
    expect(result.current.value).toBe("Why did revenue drop? This week");

    act(() => result.current.dictation.stop());
    expect(result.current.dictation.active).toBe(false);
    expect(latest().aborted).toBe(true);
    expect(result.current.value).toBe("Why did revenue drop? This week.");
  });

  it("restores the original text on cancel", async () => {
    const { result } = setup("Draft");
    await act(async () => { await result.current.dictation.start(); });
    act(() => latest().emit([["something else", false]]));
    expect(result.current.value).toBe("Draft something else");
    act(() => result.current.dictation.cancel());
    expect(result.current.value).toBe("Draft");
    expect(result.current.dictation.active).toBe(false);
  });

  it("keeps listening across an automatic end and keeps earlier words", async () => {
    vi.useFakeTimers();
    const { result } = setup("");
    await act(async () => { await result.current.dictation.start(); });
    const first = latest();
    act(() => first.emit([["hello um what's going on", true]]));
    act(() => first.onend?.());
    expect(result.current.value).toBe("Hello, what's going on?");
    await act(async () => { vi.advanceTimersByTime(200); });
    const second = latest();
    expect(second).not.toBe(first);
    act(() => second.emit([["and how are sales", true]]));
    expect(result.current.value).toBe("Hello, what's going on? And how are sales?");
    expect(result.current.dictation.listening).toBe(true);
  });

  it("ignores silence and reports a blocked microphone clearly", async () => {
    const { result } = setup("");
    await act(async () => { await result.current.dictation.start(); });
    act(() => latest().onerror?.({ error: "no-speech" }));
    expect(result.current.dictation.error).toBeNull();
    act(() => latest().onerror?.({ error: "not-allowed" }));
    expect(result.current.dictation.error).toBe("permission");
    expect(result.current.dictation.active).toBe(false);
    expect(DICTATION_ERROR_MESSAGES.permission).toMatch(/Microphone access is blocked/);
  });

  it("reports a denied permission prompt before starting recognition", async () => {
    const getUserMedia = vi.fn().mockRejectedValue(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
    try {
      const { result } = setup("");
      await act(async () => { await result.current.dictation.start(); });
      expect(getUserMedia).toHaveBeenCalled();
      expect(FakeRecognition.instances).toHaveLength(0);
      expect(result.current.dictation.error).toBe("permission");
    } finally {
      Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
    }
  });

  it("releases the microphone stream when dictation stops", async () => {
    const stopTrack = vi.fn();
    const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: vi.fn().mockResolvedValue(stream) }, configurable: true });
    try {
      const { result } = setup("");
      await act(async () => { await result.current.dictation.start(); });
      expect(result.current.dictation.stream).toBe(stream);
      act(() => result.current.dictation.stop());
      expect(stopTrack).toHaveBeenCalled();
      expect(result.current.dictation.stream).toBeNull();
    } finally {
      Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
    }
  });

  it("stops at the composer length limit", async () => {
    const { result } = setup("", 10);
    await act(async () => { await result.current.dictation.start(); });
    act(() => latest().emit([["this is far too long", false]]));
    expect(result.current.value).toBe("This is fa");
    expect(result.current.dictation.active).toBe(false);
  });

  it("retries a dropped connection and keeps the words", async () => {
    vi.useFakeTimers();
    const { result } = setup("");
    await act(async () => { await result.current.dictation.start(); });
    const first = latest();
    act(() => first.emit([["show me orders", true]]));
    act(() => { first.onerror?.({ error: "network" }); first.onend?.(); });
    expect(result.current.dictation.error).toBeNull();
    expect(result.current.value).toBe("Show me orders.");
    await act(async () => { vi.advanceTimersByTime(500); });
    const second = latest();
    expect(second).not.toBe(first);
    act(() => second.emit([["from last week", true]]));
    expect(result.current.value).toBe("Show me orders. From last week.");
    expect(result.current.dictation.listening).toBe(true);
  });

  it("reports the connection only after repeated failures, keeping the text", async () => {
    vi.useFakeTimers();
    const { result } = setup("");
    await act(async () => { await result.current.dictation.start(); });
    act(() => latest().emit([["hello there", false]]));
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const rec = latest();
      act(() => { rec.onerror?.({ error: "network" }); rec.onend?.(); });
      await act(async () => { vi.advanceTimersByTime(400 * attempt + 50); });
    }
    act(() => latest().onerror?.({ error: "network" }));
    expect(result.current.dictation.error).toBe("network");
    expect(result.current.dictation.active).toBe(false);
    // Words on screen when the service dropped are never lost.
    expect(result.current.value).toBe("Hello there.");
    expect(DICTATION_ERROR_MESSAGES.network).toMatch(/Your words are kept/);
  });

  it("continues the same sentence when the service drops mid-phrase", async () => {
    vi.useFakeTimers();
    const { result } = setup("");
    await act(async () => { await result.current.dictation.start(); });
    act(() => latest().emit([["how are you doing", true], [" I I'm", false]]));
    const dropped = latest();
    act(() => { dropped.onerror?.({ error: "network" }); dropped.onend?.(); });
    expect(result.current.value).toBe("How are you doing? I'm");
    expect(result.current.dictation.error).toBeNull();
    await act(async () => { vi.advanceTimersByTime(450); });
    expect(latest()).not.toBe(dropped);
    act(() => latest().emit([["doing great today", false]]));
    expect(result.current.value).toBe("How are you doing? I'm doing great today");
    act(() => latest().emit([["doing great today", true]]));
    expect(result.current.value).toBe("How are you doing? I'm doing great today.");
  });

  it("closes the last sentence when stopped mid-phrase", async () => {
    const { result } = setup("");
    await act(async () => { await result.current.dictation.start(); });
    act(() => latest().emit([["what sold best", false]]));
    expect(result.current.value).toBe("What sold best");
    act(() => result.current.dictation.stop());
    expect(result.current.value).toBe("What sold best?");
  });

  it("calls a never-working speech service blocked rather than a connection drop", async () => {
    vi.useFakeTimers();
    const { result } = setup("");
    await act(async () => { await result.current.dictation.start(); });
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const rec = latest();
      act(() => { rec.onerror?.({ error: "network" }); rec.onend?.(); });
      await act(async () => { vi.advanceTimersByTime(400 * attempt + 50); });
    }
    expect(result.current.dictation.error).toBe("blocked");
  });

  it("applies the punctuation polish only while the field is unchanged", async () => {
    const polish = vi.fn().mockResolvedValue("Hello, what's going on? And how are you doing?");
    const { result } = renderHook(() => {
      const [value, setValue] = useState("");
      const dictation = useDictation({ value, onChange: setValue, maxLength: 2000, polish });
      return { value, setValue, dictation };
    });
    await act(async () => { await result.current.dictation.start(); });
    act(() => latest().emit([["hello what's going on and how are you doing", true]]));
    await act(async () => { result.current.dictation.stop(); });
    expect(polish).toHaveBeenCalledWith("Hello, what's going on and how are you doing?");
    expect(result.current.value).toBe("Hello, what's going on? And how are you doing?");
    expect(result.current.dictation.polishing).toBe(false);

    // Edited before the polish returned: the merchant's edit wins.
    let resolve!: (text: string) => void;
    polish.mockReturnValueOnce(new Promise<string>(r => { resolve = r; }));
    await act(async () => { await result.current.dictation.start(); });
    act(() => latest().emit([["show me orders", true]]));
    act(() => result.current.dictation.stop());
    expect(result.current.dictation.polishing).toBe(true);
    act(() => result.current.setValue("Typed instead"));
    await act(async () => { resolve("Show me, orders."); });
    expect(result.current.value).toBe("Typed instead");
  });

  it("skips the polish when asked (sending straight away)", async () => {
    const polish = vi.fn().mockResolvedValue("x");
    const { result } = renderHook(() => {
      const [value, setValue] = useState("");
      return useDictation({ value, onChange: setValue, maxLength: 2000, polish });
    });
    await act(async () => { await result.current.start(); });
    act(() => latest().emit([["show me orders", true]]));
    act(() => result.current.stop({ polish: false }));
    expect(polish).not.toHaveBeenCalled();
  });

  it("treats Brave as unsupported (its speech service is blocked)", () => {
    Object.defineProperty(navigator, "brave", { value: {}, configurable: true });
    try {
      const { result } = setup("");
      expect(result.current.dictation.supported).toBe(false);
    } finally {
      delete (navigator as unknown as { brave?: unknown }).brave;
    }
  });

  it("explains when the browser has no speech recognition", async () => {
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    const { result } = setup("");
    expect(result.current.dictation.supported).toBe(false);
    await act(async () => { await result.current.dictation.start(); });
    expect(result.current.dictation.error).toBe("unsupported");
  });
});
