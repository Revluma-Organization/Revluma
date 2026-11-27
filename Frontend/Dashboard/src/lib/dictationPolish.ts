// Model punctuation pass for dictated text (ChatGPT-quality written prose).
//
// The server asks a small, fast model to add punctuation, capitals and
// sentence breaks, and rejects any answer that changes, adds or reorders words
// (only filler sounds and stutters may be dropped). Any failure resolves to
// null and the on-device formatting from lib/dictationText.ts stays as is.
import api from "@/lib/api";

type PolishReply = { success?: boolean; data?: { text?: string | null } };

export async function polishDictation(text: string): Promise<string | null> {
  try {
    const res = await api.post<PolishReply>("/rev/dictation/punctuate", { text }, { timeoutMs: 10000 });
    const polished = res?.data?.success === true ? res.data.data?.text : null;
    return typeof polished === "string" && polished.trim() ? polished.trim() : null;
  } catch {
    return null;
  }
}
