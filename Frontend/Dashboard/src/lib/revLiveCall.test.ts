import { describe, expect, it } from "vitest";
import {
  activityLabel, appendTranscript, finalizeTranscript, formatCallTime, markInterrupted, mergeTimeline,
  isSavedTranscriptRow, questionFromArgs, savedTranscriptEntry, tidyTranscript, transcriptWire, voiceToolResult,
  type TranscriptEntry,
} from "./revLiveCall";
import { base64ToFloat32, levelFromRms, pcmToBase64 } from "./revLiveAudio";
import { dispatchServerMessage, parseDurationMs } from "./revLiveClient";

describe("call transcript", () => {
  it("joins chunks per speaker and opens a new line when the floor changes", () => {
    let entries: TranscriptEntry[] = [];
    entries = appendTranscript(entries, "user", " How did", 1000);
    entries = appendTranscript(entries, "user", " sales do?", 1100);
    entries = appendTranscript(entries, "rev", "Let me check", 1500);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ speaker: "user", text: "How did sales do?", final: true, at: 1000 });
    expect(entries[1]).toMatchObject({ speaker: "rev", text: "Let me check", final: false });
    entries = finalizeTranscript(entries);
    expect(entries[1].final).toBe(true);
    entries = appendTranscript(entries, "rev", " Next.", 2000);
    expect(entries).toHaveLength(3);
    expect(appendTranscript(entries, "rev", "")).toBe(entries);
  });

  it("marks Rev's line as interrupted when the merchant talks over it", () => {
    let entries = appendTranscript([], "rev", "Revenue was", 1);
    entries = appendTranscript(entries, "user", "wait", 2);
    entries = markInterrupted(entries);
    expect(entries[0]).toMatchObject({ interrupted: true, final: true });
    expect(markInterrupted(entries)).toBe(entries);
    expect(markInterrupted(appendTranscript([], "user", "hi", 1))).toHaveLength(1);
  });

  it("tidies recogniser spacing", () => {
    expect(tidyTranscript("  hello ,  world  ! ")).toBe("hello, world!");
  });
});

describe("timeline", () => {
  const message = (id: string, at: number) => ({ id, timestamp: new Date(at) });
  const line = (id: string, at: number): TranscriptEntry => ({ id, speaker: "user", text: id, at, final: true });

  it("interleaves transcript lines with messages by time, keeping message order", () => {
    const items = mergeTimeline([message("old", 10), message("q", 200), message("a", 201)],
      [line("hello", 100), line("thanks", 300)]);
    expect(items.map(item => item.key)).toEqual(["old", "hello", "q", "a", "thanks"]);
  });

  it("is a plain message list without a transcript", () => {
    expect(mergeTimeline([message("a", 1)], []).map(item => item.kind)).toEqual(["message"]);
  });

  it("renders saved spoken lines as transcript lines and shows a line saved mid-call once", () => {
    const saved = { id: "row-1", timestamp: new Date(100), transcript: line("t100-1", 100) };
    const items = mergeTimeline([saved, message("q", 200)], [line("t100-1", 100), line("t300-2", 300)]);
    expect(items.map(item => [item.kind, item.key])).toEqual([
      ["transcript", "t100-1"], ["message", "q"], ["transcript", "t300-2"],
    ]);
    expect(mergeTimeline([saved], []).map(item => item.kind)).toEqual(["transcript"]);
  });
});

describe("saving the call", () => {
  it("sends a finished line with its stable id, tidy text and when it was said", () => {
    const entry: TranscriptEntry = { id: "t1700000000000-4", speaker: "rev", text: " Up 8 % ,  nice ", at: 1_700_000_000_000, final: true, interrupted: true };
    expect(transcriptWire(entry)).toEqual({
      client_id: "t1700000000000-4", speaker: "rev", text: "Up 8 %, nice", interrupted: true,
      spoken_at: "2023-11-14T22:13:20.000Z",
    });
    expect(transcriptWire({ ...entry, speaker: "user" })).not.toHaveProperty("interrupted");
    expect(transcriptWire({ ...entry, text: "   " })).toBeNull();
  });

  it("reads saved spoken lines back as transcript lines", () => {
    const row = {
      id: "row-9", role: "rev", content: { text: "Revenue was", voice_transcript: true, response_type: "voice" },
      created_at: "2026-11-18T10:00:00.000Z", voice_kind: "transcript", voice_client_id: "t5-1", voice_interrupted: true,
    };
    expect(savedTranscriptEntry(row)).toEqual({
      id: "t5-1", speaker: "rev", text: "Revenue was", at: Date.parse("2026-11-18T10:00:00.000Z"), final: true, interrupted: true,
    });
    expect(savedTranscriptEntry({ ...row, role: "user", voice_client_id: null, content: JSON.stringify({ text: "hi" }) }))
      .toMatchObject({ id: "saved-row-9", speaker: "user", text: "hi" });
    expect(savedTranscriptEntry({ ...row, role: "user" })).not.toHaveProperty("interrupted");
    // Typed and investigated turns (including questions asked by voice) are not transcript.
    expect(savedTranscriptEntry({ ...row, voice_kind: null, content: { text: "How did sales do?" } })).toBeNull();
    expect(isSavedTranscriptRow({ voice_kind: null, content: { voice_transcript: true } })).toBe(true);
    expect(savedTranscriptEntry({ ...row, content: { text: "  " } })).toBeNull();
    expect(savedTranscriptEntry({ ...row, role: "system" })).toBeNull();
  });
});

describe("labels and tool results", () => {
  it("formats time and who has the floor", () => {
    expect(formatCallTime(65_400)).toBe("1:05");
    expect(activityLabel("live", "rev", false)).toBe("Rev is speaking");
    expect(activityLabel("live", "listening", true)).toBe("You're muted");
    expect(activityLabel("live", "checking", false)).toBe("Checking your store…");
    expect(activityLabel("reconnecting", "rev", false)).toBe("Reconnecting…");
  });

  it("hands the written answer to the voice with its caveats and bounds its size", () => {
    const answered = voiceToolResult({ ok: true, answer: "Revenue was $12,400.\n\nUnknowns and limits\n- Refunds are partial." });
    expect(answered).toMatchObject({ status: "answered" });
    expect(String(answered.answer)).toContain("Refunds are partial");
    expect(String(voiceToolResult({ ok: true, answer: "x".repeat(9000) }).answer).length).toBeLessThanOrEqual(3501);
    expect(voiceToolResult({ ok: false, reason: "busy" })).toMatchObject({ status: "busy" });
    expect(voiceToolResult({ ok: false, reason: "failed", message: "Rev is unavailable." }))
      .toMatchObject({ status: "failed", detail: "Rev is unavailable." });
    for (const value of Object.values(voiceToolResult({ ok: false, reason: "failed" }))) {
      expect(String(value)).not.toMatch(/\u2014/);
    }
  });

  it("reads a clean standalone question", () => {
    expect(questionFromArgs({ question: "  Why did   sales drop? " })).toBe("Why did sales drop?");
    expect(questionFromArgs({ question: 3 })).toBeNull();
    expect(questionFromArgs({})).toBeNull();
  });
});

describe("audio encoding", () => {
  it("round-trips PCM16 through base64", () => {
    const pcm = new Int16Array([0, 16384, -16384, 32767, -32768]);
    const floats = base64ToFloat32(pcmToBase64(pcm.buffer));
    expect(Array.from(floats).map(v => Math.round(v * 1000) / 1000)).toEqual([0, 0.5, -0.5, 1, -1]);
    expect(levelFromRms(0)).toBe(0);
    expect(levelFromRms(1)).toBe(1);
    expect(levelFromRms(0.05)).toBeGreaterThan(0.3);
  });
});

describe("Gemini Live server messages", () => {
  it("routes audio, transcripts, interruptions, tools, goAway and resumption handles", () => {
    const seen: string[] = [];
    const handlers = {
      onReady: () => seen.push("ready"),
      onAudio: (data: string) => seen.push(`audio:${data}`),
      onInputTranscript: (text: string) => seen.push(`in:${text}`),
      onOutputTranscript: (text: string) => seen.push(`out:${text}`),
      onInterrupted: () => seen.push("interrupted"),
      onTurnComplete: () => seen.push("turn"),
      onToolCall: (calls: Array<{ id: string; name: string; args: Record<string, unknown> }>) => seen.push(`tool:${calls[0].name}:${String(calls[0].args.question)}`),
      onToolCancel: (ids: string[]) => seen.push(`cancel:${ids.join(",")}`),
      onGoAway: (ms: number) => seen.push(`goaway:${ms}`),
      onResumeHandle: (handle: string) => seen.push(`handle:${handle}`),
      onVoiceActivity: (speaking: boolean) => seen.push(`vad:${speaking}`),
    };
    dispatchServerMessage({ setupComplete: {} }, handlers);
    dispatchServerMessage({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: "AAA=" } }, { text: "thought" }] } } }, handlers);
    dispatchServerMessage({ serverContent: { inputTranscription: { text: "hi" }, outputTranscription: { text: "hello" } } }, handlers);
    dispatchServerMessage({ serverContent: { interrupted: true } }, handlers);
    dispatchServerMessage({ serverContent: { turnComplete: true } }, handlers);
    dispatchServerMessage({ toolCall: { functionCalls: [{ id: "1", name: "ask_rev", args: { question: "Sales?" } }] } }, handlers);
    dispatchServerMessage({ toolCallCancellation: { ids: ["1"] } }, handlers);
    dispatchServerMessage({ goAway: { timeLeft: "5s" } }, handlers);
    dispatchServerMessage({ sessionResumptionUpdate: { newHandle: "h1", resumable: true } }, handlers);
    dispatchServerMessage({ sessionResumptionUpdate: { newHandle: "h2", resumable: false } }, handlers);
    dispatchServerMessage({ voiceActivity: { voiceActivityType: "ACTIVITY_START" } }, handlers);
    dispatchServerMessage(null, handlers);
    expect(seen).toEqual([
      "ready", "audio:AAA=", "in:hi", "out:hello", "interrupted", "turn", "tool:ask_rev:Sales?", "cancel:1",
      "goaway:5000", "handle:h1", "vad:true",
    ]);
    expect(parseDurationMs("1.5s")).toBe(1500);
    expect(parseDurationMs("soon")).toBe(0);
  });
});
