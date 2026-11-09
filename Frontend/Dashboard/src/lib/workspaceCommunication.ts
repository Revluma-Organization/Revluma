import { ApiError } from "./api";

/** Shared merchant language. Never interpolate provider payloads or stack traces. */
export type MerchantMessage = { title: string; body: string; action: "retry" | "reconnect" | "sign_in" | "wait" | "review" | "none" };

const MESSAGES = {
  network: { title: "Revluma couldn’t retrieve this information", body: "Check your connection, then try again. Information already shown has not been changed. No completion is assumed.", action: "retry" },
  unauthorized: { title: "Your session has expired", body: "Sign in again to continue. Revluma has not changed your store connection.", action: "sign_in" },
  forbidden: { title: "Your Shopify connection needs attention", body: "Reconnect Shopify or ask a workspace owner to review your access.", action: "reconnect" },
  rate_limited: { title: "Shopify is temporarily limiting requests", body: "Wait a moment before trying again. Existing information remains available.", action: "wait" },
  sync_failed: { title: "Data synchronization didn’t complete", body: "Some information may be missing or out of date. Retry synchronization when ready.", action: "retry" },
  stale: { title: "This information may be out of date", body: "Revluma is showing the last verified information and its recorded time, not current performance.", action: "retry" },
  partial: { title: "Some information is available", body: "Verified information remains visible. Revluma hasn’t verified the missing coverage.", action: "review" },
  insufficient_history: { title: "There isn’t enough history to make this comparison", body: "Choose a period with verified history or ask a question about the available information.", action: "review" },
  unsupported: { title: "This information isn’t currently available", body: "The connected store does not provide the information needed for this request.", action: "none" },
  unknown: { title: "Revluma hasn’t verified this information", body: "No coverage or completion is assumed. Check store setup or try again.", action: "review" },
  contradictory: { title: "The available information doesn’t agree", body: "Revluma won’t choose between conflicting records. Review the evidence and its freshness.", action: "review" },
  invalid_response: { title: "Revluma received an unusable response", body: "Nothing has been marked complete. Try again; contact support if this continues.", action: "retry" },
  unavailable: { title: "This information isn’t currently available", body: "A supporting service did not respond. Verified information already shown remains available.", action: "retry" },
  read_only: { title: "Rev Intelligence is read-only", body: "Ask Rev to explain or recommend next steps. It cannot change your store.", action: "none" },
  validation: { title: "Check this request and try again", body: "Revluma couldn’t accept the information provided. No new operation was started.", action: "review" },
  not_found: { title: "This information is no longer available", body: "It may have been removed or replaced. Return to the workspace and choose a current item.", action: "review" },
  failed: { title: "Revluma couldn’t complete this request", body: "No success is assumed. Try again or review the affected connection.", action: "retry" },
} as const satisfies Record<string, MerchantMessage>;

export type MerchantMessageKind = keyof typeof MESSAGES;
export type ResourceState = "connected" | "disconnected" | "unauthorized" | "syncing" | "in_progress" | "pending" | "stale" | "partial" | "unsupported" | "failed" | "unknown" | "not_synchronized" | "complete" | "available" | "limited" | "insufficient_history";

export function merchantMessage(kind: MerchantMessageKind): MerchantMessage { return { ...MESSAGES[kind] }; }

const CODE_KIND: Record<string, MerchantMessageKind> = {
  UNAUTHORIZED: "unauthorized", AUTH_REQUIRED: "unauthorized", SESSION_EXPIRED: "unauthorized",
  FORBIDDEN: "forbidden", SHOPIFY_UNAUTHORIZED: "forbidden", REAUTHORIZATION_REQUIRED: "forbidden",
  RATE_LIMITED: "rate_limited", TOO_MANY_REQUESTS: "rate_limited",
  SYNC_FAILED: "sync_failed", SYNC_WORKER_FAILED: "sync_failed", INITIAL_SYNC_FAILED: "sync_failed",
  STALE_EVIDENCE: "stale", DATA_STALE: "stale", PARTIAL_DATA: "partial", INITIAL_SYNC_PARTIAL: "partial",
  INSUFFICIENT_HISTORY: "insufficient_history", INSUFFICIENT_HISTORICAL_DATA: "insufficient_history",
  UNSUPPORTED: "unsupported", CAPABILITY_UNSUPPORTED: "unsupported", STREAM_UNSUPPORTED: "unsupported",
  UNKNOWN_COVERAGE: "unknown", UNKNOWN: "unknown", CONTRADICTORY_EVIDENCE: "contradictory",
  INTELLIGENCE_INVALID_RESPONSE: "invalid_response", INVALID_CONTRACT: "invalid_response",
  INTELLIGENCE_UNAVAILABLE: "unavailable", SERVICE_UNAVAILABLE: "unavailable",
  INTELLIGENCE_TIMEOUT: "unavailable", TIMEOUT: "unavailable",
  READ_ONLY: "read_only", VALIDATION_ERROR: "validation", NOT_FOUND: "not_found", FINDING_NOT_FOUND: "not_found",
};

function errorCode(reason: unknown): string | undefined {
  if (reason instanceof ApiError) {
    const body = reason.body as { code?: unknown; error?: string | { code?: unknown }; reason_code?: unknown } | null;
    if (typeof body?.code === "string") return body.code;
    if (typeof body?.reason_code === "string") return body.reason_code;
    if (typeof body?.error === "string") return body.error;
    if (typeof body?.error?.code === "string") return body.error.code;
  }
  if (reason && typeof reason === "object" && "code" in reason && typeof reason.code === "string") return reason.code;
  return undefined;
}

/** Classify typed backend codes and HTTP status only; raw messages are never rendered. */
export function explainWorkspaceError(reason: unknown, subject = "information"): MerchantMessage {
  const code = errorCode(reason);
  if (code && CODE_KIND[code]) return merchantMessage(CODE_KIND[code]);
  const status = reason instanceof ApiError ? reason.status : reason && typeof reason === "object" && "status" in reason && typeof reason.status === "number" ? reason.status : null;
  if (status === 0 || status === null) return merchantMessage("network");
  if (status === 401) return merchantMessage("unauthorized");
  if (status === 403) return merchantMessage("forbidden");
  if (status === 404) return merchantMessage("not_found");
  if (status === 429) return merchantMessage("rate_limited");
  if (status === 400 || status === 422) return merchantMessage("validation");
  if (status === 502 || status === 503 || status === 504) return merchantMessage("unavailable");
  return { ...merchantMessage("failed"), title: `Revluma couldn’t retrieve this ${subject}` };
}

export function resourceLanguage(state: string): { label: string; explanation: string; tone: "positive" | "warning" | "negative" | "neutral" | "progress" } {
  switch (state.toLowerCase()) {
    case "connected": case "complete": case "available": case "ok": return { label: "Connected" , explanation: "The recorded connection and synchronization are verified.", tone: "positive" };
    case "disconnected": return { label: "Disconnected", explanation: "Reconnect the store to retrieve new information.", tone: "negative" };
    case "unauthorized": case "shopify_authorization_required": case "reauthorization_required": return { label: "Connection needs attention", explanation: "Shopify authorization must be reviewed before new information can be retrieved.", tone: "negative" };
    case "syncing": case "in_progress": case "pending": return { label: "Synchronizing", explanation: "Revluma is retrieving information. Completion is not assumed yet.", tone: "progress" };
    case "stale": return { label: "May be out of date", explanation: merchantMessage("stale").body, tone: "warning" };
    case "partial": case "limited": return { label: "Partially available", explanation: merchantMessage("partial").body, tone: "warning" };
    case "unsupported": return { label: "Not available", explanation: merchantMessage("unsupported").body, tone: "neutral" };
    case "failed": case "retrieval_failed": return { label: "Synchronization didn’t complete", explanation: merchantMessage("sync_failed").body, tone: "negative" };
    case "not_synchronized": return { label: "Not synchronized", explanation: "Revluma has not retrieved this information yet.", tone: "neutral" };
    case "insufficient_history": return { label: "Not enough history", explanation: merchantMessage("insufficient_history").body, tone: "warning" };
    default: return { label: "Not yet verified", explanation: merchantMessage("unknown").body, tone: "neutral" };
  }
}

export function resourceName(resource: string): string {
  const names: Record<string, string> = { abandoned_checkouts: "Abandoned checkouts", orders: "Orders", products: "Products", customers: "Customers", inventory: "Inventory" };
  return names[resource] ?? resource.replaceAll("_", " ").replace(/^./, letter => letter.toUpperCase());
}
