// src/components/IntegrationStatus.tsx
// Task 213 — shared canonical integration-status badge.
//
// Renders the server-evaluated rev-integration-state-v1 overall status.
// Green is reserved for `connected`; everything else is amber (in progress /
// degraded), red (authorization or sync failure), or neutral (disconnected /
// unsupported / unknown). A missing or invalid canonical block must be passed
// in as `unknown` by the caller (fail-closed) — never as `connected`.

import { cn } from "@/lib/utils";
import {
  INTEGRATION_STATE_LABELS,
  INTEGRATION_STATE_STYLES,
  type UiIntegrationStatus,
} from "@/lib/integrationState";

interface IntegrationStatusBadgeProps {
  status: UiIntegrationStatus;
  size?: "sm" | "md";
  className?: string;
}

export function IntegrationStatusBadge({
  status,
  size = "md",
  className,
}: IntegrationStatusBadgeProps) {
  const { color, bg, pulse } = INTEGRATION_STATE_STYLES[status];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full font-semibold",
        size === "sm" ? "px-2 py-0.5 text-[0.68rem]" : "px-2.5 py-1 text-[0.72rem]",
        className,
      )}
      style={{ color, background: bg }}
    >
      <span
        aria-hidden="true"
        className={cn("h-1.5 w-1.5 rounded-full", pulse && "animate-pulse")}
        style={{ background: color }}
      />
      {INTEGRATION_STATE_LABELS[status]}
    </span>
  );
}
