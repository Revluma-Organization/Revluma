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
    expect(result.current.value).toBe("Why did revenue drop this week");

    act(() => result.current.dictation.stop());
    expect(result.current.dictation.active).toBe(false);
    expect(latest().aborted).toBe(true);
    expect(result.current.value).toBe("Why did revenue drop this week");
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
    act(() => first.emit([["show me orders", true]]));
    act(() => first.onend?.());
    expect(result.current.value).toBe("Show me orders");
    await act(async () => { vi.advanceTimersByTime(200); });
    const second = latest();
    expect(second).not.toBe(first);
    act(() => second.emit([["from last week", false]]));
    expect(result.current.value).toBe("Show me orders from last week");
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

  it("explains when the browser has no speech recognition", async () => {
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    const { result } = setup("");
    expect(result.current.dictation.supported).toBe(false);
    await act(async () => { await result.current.dictation.start(); });
    expect(result.current.dictation.error).toBe("unsupported");
  });
});
