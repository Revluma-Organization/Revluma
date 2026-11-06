import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowUpRight, LoaderCircle, Plus, Send, Sparkles, Square, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useUI } from "@/store/ui";
import { useThemeStore } from "@/store";
import RevAnswerView from "@/components/rev/RevAnswerView";
import {
  streamRevAnswer, RevStreamError,
  type InvestigationStep, type RevAnswerPayload,
} from "@/lib/revStream";
import {
  storeContextFromResponse, storeLabel, UNKNOWN_STORE,
  type StoreContext, type StoreListResponse,
} from "@/lib/revStoreContext";
import {
  COPILOT_COMMANDS, matchingCopilotCommands, resolveCopilotPrompt,
} from "@/lib/copilotCommands";

interface CopilotMessage {
  id: string;
  role: "merchant" | "rev";
  text: string;
  payload?: RevAnswerPayload;
  steps?: InvestigationStep[];
  streaming?: boolean;
  error?: boolean;
}

const SUGGESTIONS = [
  "Give me a clear overview of how my store is performing.",
  "Which products contributed the most to revenue?",
  "What is the most important issue I should look at first?",
];

export function CopilotPanel() {
  const { copilotOpen, setCopilotOpen, copilotPrefill, clearCopilotPrefill } = useUI();
  const dark = useThemeStore((state) => state.theme) === "dark";
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [storeContext, setStoreContext] = useState<StoreContext>(UNKNOWN_STORE);
  const abortRef = useRef<AbortController | null>(null);
  const pendingRef = useRef(false);
  const turnRef = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!copilotOpen) return;
    let active = true;
    setStoreContext(UNKNOWN_STORE);
    void api.get<StoreListResponse>("/stores").then((response) => {
      if (active) setStoreContext(storeContextFromResponse(response.data));
    }).catch(() => {
      if (active) setStoreContext({ ...UNKNOWN_STORE, loaded: true, loadError: true });
    });
    return () => { active = false; };
  }, [copilotOpen]);

  useEffect(() => {
    if (copilotOpen && copilotPrefill) {
      setInput(copilotPrefill);
      clearCopilotPrefill();
    }
    if (copilotOpen) window.setTimeout(() => inputRef.current?.focus(), 50);
  }, [copilotOpen, copilotPrefill, clearCopilotPrefill]);

  useEffect(() => {
    if (!copilotOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setCopilotOpen(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [copilotOpen, setCopilotOpen]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (copilotOpen && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, thinking, copilotOpen]);

  const commands = useMemo(() => matchingCopilotCommands(input), [input]);
  const contextLabel = storeContext.loadError
    ? "Store status unavailable"
    : storeContext.connected
      ? storeLabel(storeContext)
      : storeContext.loaded ? "No connected Shopify store" : "Checking store connection…";

  const patchMessage = useCallback((id: string, update: (message: CopilotMessage) => CopilotMessage) => {
    setMessages((previous) => previous.map((message) => message.id === id ? update(message) : message));
  }, []);

  const send = useCallback(async (raw: string) => {
    const prompt = resolveCopilotPrompt(raw);
    if (!prompt || pendingRef.current) return;
    pendingRef.current = true;
    const turn = ++turnRef.current;
    const answerId = `rev-${turn}`;
    setInput("");
    setThinking(true);
    setMessages((previous) => [
      ...previous,
      { id: `merchant-${turn}`, role: "merchant", text: raw.trim() },
      { id: answerId, role: "rev", text: "", streaming: true, steps: [] },
    ]);
    const controller = new AbortController();
    abortRef.current = controller;

    const isCurrent = () => turnRef.current === turn;
    try {
      await streamRevAnswer({
        message: prompt,
        conversationId,
        signal: controller.signal,
        handlers: {
          onMeta: ({ conversation_id }) => {
            if (isCurrent()) setConversationId(conversation_id);
          },
          onPlan: (plan) => {
            if (plan.steps?.length) patchMessage(answerId, (message) => ({ ...message, steps: plan.steps }));
          },
          onStep: (step) => {
            if (!isCurrent()) return;
            patchMessage(answerId, (message) => {
              const steps = [...(message.steps ?? [])];
              const index = steps.findIndex((item) => item.id === step.id || item.tool === step.tool);
              if (index >= 0) steps[index] = { ...steps[index], ...step };
              else steps.push(step);
              return { ...message, steps };
            });
          },
          onEvidence: (evidence) => {
            if (!isCurrent()) return;
            patchMessage(answerId, (message) => ({
              ...message,
              payload: {
                ...(message.payload ?? { read_only: true, response_type: "analysis", text: "" }),
                evidence,
              },
            }));
          },
          onFinal: (payload) => {
            if (!isCurrent()) return;
            if (payload.conversation_id) setConversationId(payload.conversation_id);
            patchMessage(answerId, (message) => ({
              ...message,
              text: payload.text || "Rev did not return an answer. Please try again.",
              payload,
              steps: payload.investigation?.steps?.length ? payload.investigation.steps : message.steps,
              streaming: false,
              error: payload.success === false,
            }));
          },
        },
      });
      if (isCurrent()) {
        patchMessage(answerId, (message) => message.streaming
          ? { ...message, streaming: false, error: true, text: controller.signal.aborted
            ? "Response stopped."
            : "This response was interrupted. Please try again." }
          : message);
      }
    } catch (error) {
      if (isCurrent()) {
        patchMessage(answerId, (message) => ({
          ...message,
          streaming: false,
          error: true,
          text: controller.signal.aborted
            ? "Response stopped."
            : error instanceof RevStreamError
              ? error.message
              : "Rev could not answer right now. Please try again.",
        }));
      }
    } finally {
      if (isCurrent()) {
        pendingRef.current = false;
        setThinking(false);
        if (abortRef.current === controller) abortRef.current = null;
      }
    }
  }, [conversationId, patchMessage]);

  const stop = useCallback(() => {
    turnRef.current += 1;
    pendingRef.current = false;
    abortRef.current?.abort();
    abortRef.current = null;
    setThinking(false);
    setMessages((previous) => previous.map((message) => message.streaming
      ? { ...message, streaming: false, text: "Response stopped." }
      : message));
  }, []);

  const newConversation = useCallback(() => {
    if (thinking) stop();
    setMessages([]);
    setConversationId(null);
    setInput("");
    inputRef.current?.focus();
  }, [stop, thinking]);

  const openFullConversation = () => {
    setCopilotOpen(false);
    navigate(conversationId ? `/dashboard/rev-intell/${conversationId}` : "/dashboard/rev-intell");
  };

  return (
    <>
      <div
        className={cn("fixed inset-0 z-[180] bg-black/40 backdrop-blur-sm transition-opacity", copilotOpen ? "opacity-100" : "pointer-events-none opacity-0")}
        onClick={() => setCopilotOpen(false)}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Revluma Copilot"
        aria-hidden={!copilotOpen}
        className={cn(
          "fixed inset-y-0 right-0 z-[200] flex w-full max-w-[520px] flex-col border-l border-border bg-bg-notif transition-transform duration-300 ease-out",
          copilotOpen ? "translate-x-0" : "pointer-events-none translate-x-full",
        )}
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: "hsl(var(--accent) / 0.12)", border: "1px solid hsl(var(--accent) / 0.25)" }}>
              <Sparkles className="h-4 w-4 accent-text" />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-t1">Revluma Copilot</div>
              <div className="truncate text-[0.68rem] text-t3">{contextLabel}</div>
            </div>
          </div>
          <div className="flex items-center gap-0.5">
            <button type="button" onClick={newConversation} className="rounded-md p-2 text-t3 transition-colors hover:bg-white/5 hover:text-t1" aria-label="New copilot conversation" title="New conversation"><Plus className="h-4 w-4" /></button>
            <button type="button" onClick={openFullConversation} className="rounded-md p-2 text-t3 transition-colors hover:bg-white/5 hover:text-t1" aria-label="Open full Rev conversation" title="Open full conversation"><ArrowUpRight className="h-4 w-4" /></button>
            <button type="button" onClick={() => setCopilotOpen(false)} className="rounded-md p-2 text-t3 transition-colors hover:bg-white/5 hover:text-t1" aria-label="Close copilot"><X className="h-4 w-4" /></button>
          </div>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4" aria-live="polite">
          {messages.length === 0 ? (
            <div className="space-y-5">
              <div className="rounded-xl border border-border-md bg-white/[0.035] p-4">
                <div className="mb-2 flex items-center gap-2 text-[0.68rem] font-semibold uppercase tracking-wider text-t3"><Sparkles className="h-3 w-3 accent-text" />Your commerce copilot</div>
                <p className="text-[0.84rem] leading-relaxed text-t2">Ask about your connected store or choose a workflow. Rev grounds answers in available evidence and labels limitations.</p>
                <p className="mt-2 text-[0.72rem] leading-relaxed text-t3">Analysis and drafts only. Rev does not publish content, send campaigns, or change prices, inventory, orders, discounts, themes, or settings.</p>
              </div>
              <section aria-labelledby="copilot-workflows">
                <div className="mb-2 flex items-center justify-between"><h2 id="copilot-workflows" className="text-[0.65rem] font-bold uppercase tracking-[0.11em] text-t4">Quick workflows</h2><span className="text-[0.65rem] text-t4">Type / to browse</span></div>
                <div className="grid grid-cols-2 gap-2">
                  {COPILOT_COMMANDS.map((item) => (
                    <button type="button" key={item.command} onClick={() => void send(item.command)} className="rounded-lg border border-border bg-white/[0.025] p-3 text-left transition-colors hover:border-border-md hover:bg-white/[0.05]">
                      <span className="block text-[0.76rem] font-semibold text-t1">{item.label}</span><span className="mt-1 block text-[0.65rem] leading-4 text-t3">{item.description}</span><span className="mt-2 block font-mono text-[0.62rem] accent-text">{item.command}</span>
                    </button>
                  ))}
                </div>
              </section>
              <section aria-labelledby="copilot-suggestions">
                <h2 id="copilot-suggestions" className="mb-2 text-[0.65rem] font-bold uppercase tracking-[0.11em] text-t4">Ask about your business</h2>
                <div className="space-y-1.5">{SUGGESTIONS.map((suggestion) => <button type="button" key={suggestion} onClick={() => void send(suggestion)} className="w-full rounded-md border border-border bg-white/[0.02] px-3 py-2 text-left text-[0.75rem] text-t2 transition-colors hover:border-border-md hover:text-t1">{suggestion}</button>)}</div>
              </section>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((message) => message.role === "merchant" ? (
                <div key={message.id} className="ml-8 rounded-xl rounded-br-sm bg-[#1F06AC] px-3.5 py-2.5 text-[0.8rem] leading-relaxed text-white">{message.text}</div>
              ) : (
                <article key={message.id} className={cn("mr-2 min-w-0 text-[0.78rem]", message.error && "rounded-lg border border-amber-500/25 p-3")} aria-label={message.streaming ? "Rev is investigating" : "Rev response"}>
                  {message.streaming && <div role="status" className="mb-3 flex items-center gap-2 text-[0.72rem] text-t3"><LoaderCircle className="h-3.5 w-3.5 animate-spin" />{message.steps?.find((step) => step.status === "running")?.label ?? "Rev is reviewing your request…"}</div>}
                  {message.payload ? <RevAnswerView payload={message.payload} streaming={message.streaming} dark={dark} onFollowUp={(text) => setInput(text)} /> : <p className="whitespace-pre-wrap leading-relaxed text-t2">{message.text}</p>}
                </article>
              ))}
            </div>
          )}
        </div>

        <form onSubmit={(event) => { event.preventDefault(); void send(input); }} className="relative border-t border-border p-3">
          {commands.length > 0 && (
            <div className="absolute inset-x-3 bottom-full mb-2 overflow-hidden rounded-lg border border-border-md bg-bg-notif shadow-xl" role="listbox" aria-label="Copilot workflows">
              {commands.map((item) => <button type="button" role="option" aria-selected="false" key={item.command} onClick={() => void send(item.command)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-white/5"><span className="w-24 shrink-0 font-mono text-[0.7rem] accent-text">{item.command}</span><span className="min-w-0"><span className="block text-[0.74rem] font-semibold text-t1">{item.label}</span><span className="block truncate text-[0.65rem] text-t3">{item.description}</span></span></button>)}
            </div>
          )}
          <div className="flex items-end gap-2 rounded-xl border border-border-md bg-white/[0.035] px-3 py-2 focus-within:border-border-hv">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send(input);
                }
              }}
              placeholder="Ask Rev or type / for workflows…"
              aria-label="Message Revluma Copilot"
              rows={2}
              maxLength={2000}
              className="max-h-32 flex-1 resize-none bg-transparent py-1 text-[0.82rem] leading-5 text-t1 outline-none placeholder:text-t3"
            />
            {thinking ? (
              <button type="button" onClick={stop} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border-md text-t2 transition-opacity hover:opacity-80" aria-label="Stop response"><Square className="h-3 w-3 fill-current" /></button>
            ) : (
              <button type="submit" disabled={!input.trim()} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40" style={{ background: "hsl(var(--accent))", color: "#fff" }} aria-label="Send message"><Send className="h-3.5 w-3.5" /></button>
            )}
          </div>
          <p className="mt-2 text-center text-[0.6rem] text-t4">Enter to send · Shift+Enter for a new line · Verify drafts before use</p>
        </form>
      </aside>
    </>
  );
}
