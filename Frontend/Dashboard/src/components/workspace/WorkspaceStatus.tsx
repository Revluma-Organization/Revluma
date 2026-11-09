import { AlertCircle, CheckCircle2, Clock3, Loader2, RefreshCw } from "lucide-react";
import { workspaceDesign as design } from "@/lib/workspaceDesign";
import { cn } from "@/lib/utils";

export function WorkspaceStatus({ state, title, message, onRetry, retryLabel = "Try again", compact = false, announcementId, retryDisabled = false }: {
  state: "loading" | "empty" | "partial" | "error" | "success";
  title: string; message: string; onRetry?: () => void; retryLabel?: string; compact?: boolean; announcementId?: string; retryDisabled?: boolean;
}) {
  const Icon = state === "loading" ? Loader2 : state === "success" ? CheckCircle2 : state === "partial" ? Clock3 : AlertCircle;
  return <section aria-label={title} className={cn("rounded-xl border p-4 text-left", state === "error" ? "border-[#FDA29B] bg-[#FFFBFA] text-[#912018]" : state === "success" ? "border-[#A6F4C5] bg-[#F6FEF9] text-[#05603A]" : state === "partial" ? "border-[#FEDF89] bg-[#FFFCF5] text-[#93370D]" : "border-[#8490A3] bg-white text-[#344054]", compact && "p-3")}>
    <div className="flex items-start gap-3">
      <Icon aria-hidden="true" className={cn("mt-0.5 h-5 w-5 shrink-0", state === "loading" && "animate-spin motion-reduce:animate-none")} />
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p id={announcementId} role={state === "error" ? "alert" : "status"} aria-live={state === "error" ? "assertive" : "polite"} className="mt-1 text-sm leading-6">{message}</p>
        {onRetry && state !== "loading" && <button type="button" onClick={onRetry} disabled={retryDisabled} className={cn(design.control.secondary, design.focus, "mt-3")}><RefreshCw aria-hidden="true" className="h-4 w-4" />{retryLabel}</button>}
      </div>
    </div>
  </section>;
}

