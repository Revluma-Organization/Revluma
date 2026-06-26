import { ExternalLink, X } from "lucide-react";
import { useState } from "react";

interface Props {
  storeConnected: boolean | null;
}

export function ConnectBanner({ storeConnected }: Props) {
  const [dismissed, setDismissed] = useState(false);

  // Hide if user dismissed OR store is confirmed connected
  if (dismissed || storeConnected === true) return null;

  return (
    <div
      data-tour="connect-banner"
      className="mb-5 flex flex-col items-start justify-between gap-3 rounded-xl border border-border bg-bg-2 px-4 py-3 sm:flex-row sm:items-center"
    >
      <div className="flex items-start gap-3">
        <span
          className="mt-1 h-2 w-2 shrink-0 rounded-full"
          style={{ background: "hsl(var(--amber))", boxShadow: "0 0 0 4px hsl(var(--amber) / 0.18)" }}
        />
        <p className="text-[0.82rem] leading-snug text-t2">
          <strong className="text-t1">Your store isn't connected yet.</strong>{" "}
          Connect your Store to unlock live recovery data, customer intelligence, and automated messaging sequences.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[0.75rem] font-bold transition-opacity hover:opacity-90"
          style={{ background: "hsl(var(--accent))", color: "#000" }}
        >
          <ExternalLink className="h-3 w-3" />
          Connect Store
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-white/[0.035] text-t3 transition-colors hover:text-t1"
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
