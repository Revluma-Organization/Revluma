// Pure state helpers for live voice calls with Rev (transcript, timeline,
// labels and the tool result Rev's voice reads from). No browser APIs here so
// the behaviour is unit-tested directly.

export type CallPhase =
  | "idle" | "starting" | "connecting" | "live" | "reconnecting" | "ending" | "ended" | "error";

/** Who has the floor right now, as shown to the merchant. */
export type CallActivity = "listening" | "user" | "thinking" | "rev" | "checking";

export type CallView = "chat" | "full";

export type CallEndReason =
  | "hangup" | "assistant" | "limit" | "error" | "replaced" | "stale" | "unavailable" | "unload";

export interface TranscriptEntry {
  id: string;
  speaker: "user" | "rev";
  text: string;
  /** Client time the entry started (ms). */
  at: number;
  final: boolean;
  /** Rev was cut off by the merchant mid-sentence. */
  interrupted?: boolean;
}

let entrySeq = 0;

/** Tidy recogniser spacing: collapse runs, no space before punctuation. */
export function tidyTranscript(text: string): string {
  return text.replace(/\s+/g, " ").replace(/\s+([,.!?;:])/g, "$1").trim();
}

/**
 * Add an incremental transcription chunk. Chunks from the same speaker join
 * the open entry; a change of speaker closes it and opens a new one.
 */
export function appendTranscript(entries: TranscriptEntry[], speaker: "user" | "rev", chunk: string,
  now = Date.now()): TranscriptEntry[] {
  if (!chunk) return entries;
  const last = entries[entries.length - 1];
  if (last && last.speaker === speaker && !last.final) {
    return [...entries.slice(0, -1), { ...last, text: last.text + chunk }];
  }
  const closed = last && !last.final ? [...entries.slice(0, -1), { ...last, final: true }] : entries;
  entrySeq += 1;
  return [...closed, { id: `t${now}-${entrySeq}`, speaker, text: chunk.replace(/^\s+/, ""), at: now, final: false }];
}

/** Close the open entry (turn complete). */
export function finalizeTranscript(entries: TranscriptEntry[]): TranscriptEntry[] {
  const last = entries[entries.length - 1];
  if (!last || last.final) return entries;
  return [...entries.slice(0, -1), { ...last, final: true }];
}

/** The merchant talked over Rev: close Rev's open line as interrupted. */
export function markInterrupted(entries: TranscriptEntry[]): TranscriptEntry[] {
  let index = entries.length - 1;
  // The merchant's barge-in line may already have started.
  if (index >= 0 && entries[index].speaker === "user") index -= 1;
  const entry = entries[index];
  if (!entry || entry.speaker !== "rev" || entry.interrupted) return entries;
  const next = [...entries];
  next[index] = { ...entry, final: true, interrupted: true };
  return next;
}

/** A finished spoken line as the server saves it. */
export interface TranscriptWire {
  client_id: string;
  speaker: "user" | "rev";
  text: string;
  interrupted?: boolean;
  spoken_at: string;
}

/** The save payload for a finished line, or null when nothing was said. */
export function transcriptWire(entry: TranscriptEntry): TranscriptWire | null {
  const text = tidyTranscript(entry.text);
  if (!text) return null;
  return {
    client_id: entry.id,
    speaker: entry.speaker,
    text,
    ...(entry.speaker === "rev" && entry.interrupted ? { interrupted: true } : {}),
    spoken_at: new Date(entry.at).toISOString(),
  };
}

/** A saved conversation row, as GET /rev/conversations/:id returns it. */
export interface SavedVoiceRow {
  id: string;
  role: string;
  content: unknown;
  created_at?: string | null;
  voice_kind?: string | null;
  voice_client_id?: string | null;
  voice_interrupted?: boolean | null;
}

/** True for a spoken line saved from a call (not a typed or investigated turn). */
export function isSavedTranscriptRow(row: Pick<SavedVoiceRow, "voice_kind" | "content">): boolean {
  if (row.voice_kind === "transcript") return true;
  const content = row.content as { voice_transcript?: unknown } | null;
  return Boolean(content && typeof content === "object" && content.voice_transcript === true);
}

/** Turn a saved spoken line back into a transcript line (same id as when it was spoken). */
export function savedTranscriptEntry(row: SavedVoiceRow): TranscriptEntry | null {
  if (!isSavedTranscriptRow(row) || (row.role !== "user" && row.role !== "rev")) return null;
  let content = row.content as { text?: unknown } | string | null;
  if (typeof content === "string") {
    try { content = JSON.parse(content) as { text?: unknown }; } catch { content = { text: content }; }
  }
  const text = content && typeof content === "object" && typeof content.text === "string" ? content.text.trim() : "";
  if (!text) return null;
  const at = row.created_at ? new Date(row.created_at).getTime() : 0;
  return {
    id: row.voice_client_id || `saved-${row.id}`,
    speaker: row.role === "user" ? "user" : "rev",
    text,
    at: Number.isNaN(at) ? 0 : at,
    final: true,
    ...(row.role === "rev" && row.voice_interrupted ? { interrupted: true } : {}),
  };
}

export type TimelineItem<M> =
  | { kind: "message"; key: string; message: M }
  | { kind: "transcript"; key: string; entry: TranscriptEntry };

/**
 * Interleave the call transcript with chat messages by time. Messages keep
 * their order; each transcript line lands after the last message that existed
 * when it was spoken (so a question Rev investigates shows its answer card
 * where it happened in the conversation).
 */
export function mergeTimeline<M extends { id: string; timestamp: Date; transcript?: TranscriptEntry }>(messages: M[],
  liveTranscript: TranscriptEntry[]): Array<TimelineItem<M>> {
  // Saved spoken lines (a reloaded or finished call) render as transcript
  // lines in their saved place; a line still in the live transcript that has
  // already been saved is shown once, from the saved copy.
  const savedIds = new Set<string>();
  for (const message of messages) if (message.transcript) savedIds.add(message.transcript.id);
  const transcript = savedIds.size ? liveTranscript.filter(entry => !savedIds.has(entry.id)) : liveTranscript;
  const asItem = (message: M): TimelineItem<M> => (message.transcript
    ? { kind: "transcript", key: message.transcript.id, entry: message.transcript }
    : { kind: "message", key: message.id, message });
  if (!transcript.length) return messages.map(asItem);
  const items: Array<TimelineItem<M>> = [];
  let t = 0;
  for (const message of messages) {
    const time = message.timestamp instanceof Date ? message.timestamp.getTime() : Number(message.timestamp);
    while (t < transcript.length && transcript[t].at < time) {
      items.push({ kind: "transcript", key: transcript[t].id, entry: transcript[t] });
      t += 1;
    }
    items.push(asItem(message));
  }
  for (; t < transcript.length; t += 1) items.push({ kind: "transcript", key: transcript[t].id, entry: transcript[t] });
  return items;
}

export function formatCallTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function activityLabel(phase: CallPhase, activity: CallActivity, muted: boolean): string {
  if (phase === "starting" || phase === "connecting") return "Connecting…";
  if (phase === "reconnecting") return "Reconnecting…";
  if (phase === "ending") return "Ending call…";
  if (phase === "ended") return "Call ended";
  if (phase === "error") return "Call unavailable";
  if (activity === "checking") return "Checking your store…";
  if (activity === "rev") return "Rev is speaking";
  if (activity === "thinking") return "Thinking…";
  if (muted) return "You're muted";
  if (activity === "user") return "Listening to you";
  return "Listening";
}

export const END_MESSAGES: Partial<Record<CallEndReason, string>> = {
  limit: "You've used today's voice time with Rev. It resets at midnight UTC.",
  replaced: "This call continued in another tab.",
  stale: "The call was disconnected.",
  error: "The call dropped. Start a new call to keep talking.",
  unavailable: "Voice calls with Rev are unavailable right now.",
};

export interface VoiceAskOutcome {
  ok: boolean;
  /** Rev's full written answer, flattened to plain text. */
  answer?: string;
  /** Why the question could not be answered (busy, failed, cancelled). */
  reason?: "busy" | "failed" | "cancelled" | "blocked";
  message?: string;
}

const MAX_TOOL_ANSWER_CHARS = 3500;

/**
 * What Rev's voice receives back from ask_rev. The written answer stays the
 * source of truth (shown in the chat with its evidence); the voice explains it.
 */
export function voiceToolResult(outcome: VoiceAskOutcome): Record<string, unknown> {
  if (outcome.ok && outcome.answer) {
    const answer = outcome.answer.length > MAX_TOOL_ANSWER_CHARS
      ? `${outcome.answer.slice(0, MAX_TOOL_ANSWER_CHARS).trimEnd()}…`
      : outcome.answer;
    return {
      status: "answered",
      answer,
      note: "The full written answer with its evidence is now shown in the chat. Summarise it by voice; keep its caveats.",
    };
  }
  if (outcome.reason === "busy") {
    return { status: "busy", note: "Rev is still finishing the previous question. Tell the merchant briefly and offer to ask again in a moment." };
  }
  if (outcome.reason === "blocked") {
    return { status: "unavailable", note: "This conversation can't take new questions right now. Tell the merchant briefly." };
  }
  return {
    status: "failed",
    note: "Rev couldn't complete that investigation. Say so honestly, without guessing any figures, and offer to try again.",
    ...(outcome.message ? { detail: outcome.message.slice(0, 300) } : {}),
  };
}

/** Stand-alone question text from the voice model's ask_rev args. */
export function questionFromArgs(args: Record<string, unknown>): string | null {
  const raw = typeof args.question === "string" ? args.question : "";
  const question = raw.replace(/\s+/g, " ").trim().slice(0, 2000);
  return question.length >= 2 ? question : null;
}
