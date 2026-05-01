import { useUI } from "@/store/ui";
import { Sparkles, X, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";

const STARTERS = [
  "Why is my recovery rate below benchmark?",
  "Draft a Friday win-back campaign",
  "Predict next month's recovered revenue",
  "Which products should I prioritize?",
];

export function CopilotPanel() {
  const { copilotOpen, setCopilotOpen } = useUI();
  const [input, setInput] = useState("");

  return (
    <>
      <div
        className={cn("fixed inset-0 z-[180] bg-black/40 backdrop-blur-sm transition-opacity", copilotOpen ? "opacity-100" : "pointer-events-none opacity-0")}
        onClick={() => setCopilotOpen(false)}
      />
      <aside
        className={cn(
          "fixed inset-y-0 right-0 z-[200] flex w-full max-w-[420px] flex-col border-l border-border bg-bg-notif transition-transform duration-300 ease-out",
          copilotOpen ? "translate-x-0" : "translate-x-full",
        )}
      >
        <header className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md" style={{ background: "hsl(var(--accent) / 0.12)", border: "1px solid hsl(var(--accent) / 0.25)" }}>
              <Sparkles className="h-3.5 w-3.5" style={{ color: "hsl(var(--accent))" }} />
            </span>
            <div>
              <div className="text-sm font-semibold text-t1">Revluma Copilot</div>
              <div className="text-[0.7rem] text-t3">Powered by your store data</div>
            </div>
          </div>
          <button onClick={() => setCopilotOpen(false)} className="text-t3 transition-colors hover:text-t1" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          <div className="rounded-xl border border-border-md p-4" style={{ background: "hsl(var(--glass) / 0.035)" }}>
            <div className="mb-2 flex items-center gap-2 text-[0.7rem] font-semibold uppercase tracking-wider text-t3">
              <Sparkles className="h-3 w-3" style={{ color: "hsl(var(--accent))" }} />
              Suggested
            </div>
            <p className="text-[0.85rem] leading-relaxed text-t1">
              Hi Alex 👋 I noticed your <strong className="accent-text">Friday 6–9 PM window</strong> drives 32% of weekly abandonments.
              Want me to draft a 3-step recovery sequence targeted at that window?
            </p>
          </div>

          <div>
            <div className="mb-2 text-[0.62rem] font-bold uppercase tracking-[0.11em] text-t4">Try asking</div>
            <div className="space-y-1.5">
              {STARTERS.map((s) => (
                <button
                  key={s}
                  onClick={() => setInput(s)}
                  className="w-full rounded-md border border-border bg-white/[0.035] px-3 py-2 text-left text-[0.78rem] text-t2 transition-colors hover:border-border-md hover:text-t1"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); setInput(""); }}
          className="border-t border-border p-3"
        >
          <div className="flex items-center gap-2 rounded-lg border border-border-md bg-white/[0.035] px-3 py-2 focus-within:border-border-hv">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask Copilot anything…"
              className="flex-1 bg-transparent text-[0.85rem] text-t1 outline-none placeholder:text-t3"
            />
            <button type="submit" className="flex h-7 w-7 items-center justify-center rounded-md transition-opacity hover:opacity-80" style={{ background: "hsl(var(--accent))", color: "#000" }}>
              <Send className="h-3.5 w-3.5" />
            </button>
          </div>
        </form>
      </aside>
    </>
  );
}
