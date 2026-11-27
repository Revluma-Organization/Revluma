// Model-written conversation titles (ChatGPT-style naming).
//
// After the first answer in a new conversation the dashboard asks the server
// for a short title. The server replaces the conversation's automatic draft
// title only (never a merchant's rename) and falls back to that draft when the
// model is unavailable. Any failure here resolves to null: naming is a nicety
// and must never surface an error or block the conversation.
import api from "@/lib/api";

type TitleReply = { success?: boolean; data?: { id?: string; title?: string | null; source?: string } };

export async function requestConversationTitle(conversationId: string): Promise<string | null> {
  try {
    const res = await api.post<TitleReply>(
      `/rev/conversation/${encodeURIComponent(conversationId)}/title/generate`, {},
    );
    const title = res?.data?.success === true ? res.data.data?.title : null;
    return typeof title === "string" && title.trim() ? title.trim() : null;
  } catch {
    return null;
  }
}
