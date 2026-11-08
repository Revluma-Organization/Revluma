// Task 220 — Command Center runtime-state classification.
//
// One closed classification for every failure the Command Center can observe,
// with closed merchant-facing messages. The backend remains authoritative for
// what the error *is* (its status code); this module only decides how the
// browser *describes* it and whether a retry is the appropriate action.
//
// No backend text is interpolated into the messages except the sanitized
// ApiError.message (the production error handler strips stack traces and
// internal details), and only for the kinds where the backend message is the
// useful signal (bad_request).

export type CommandCenterFailureKind =
  | "network"
  | "timeout"
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "server_error"
  | "service_unavailable"
  | "invalid_contract";

export interface CommandCenterFailure {
  kind: CommandCenterFailureKind;
  /** Real retry guidance from the backend, seconds, when present (429). */
  retryAfterSeconds: number | null;
  /** Sanitized backend message, when safe and useful to show verbatim. */
  backendMessage: string | null;
}

/** Kinds where "Try again" is an appropriate action. */
export const RETRYABLE_KINDS: ReadonlySet<CommandCenterFailureKind> = new Set([
  "network",
  "timeout",
  "server_error",
  "service_unavailable",
  "conflict",
]);

/** The hook/panel marks a request as timed out with this sentinel name. */
export const COMMAND_CENTER_TIMEOUT_MS = 30_000;

export class CommandCenterTimeoutError extends Error {
  constructor() {
    super("The Command Center request timed out");
    this.name = "CommandCenterTimeoutError";
  }
}

/**
 * AbortController + timer pair for a request with a hard timeout.
 * `timedOut()` tells callers whether the abort was the timeout (classify as
 * timeout) or a deliberate supersede/unmount abort (ignore).
 */
export function createTimedAbortController(timeoutMs: number) {
  const controller = new AbortController();
  let timedOutFlag = false;
  const id = window.setTimeout(() => {
    timedOutFlag = true;
    controller.abort();
  }, timeoutMs);
  const clear = () => window.clearTimeout(id);
  return { controller, clear, timedOut: () => timedOutFlag };
}

function statusOf(reason: unknown): number | null {
  // ApiError carries .status (0 for network-level failure).
  if (reason && typeof reason === "object" && "status" in reason &&
      typeof (reason as { status: unknown }).status === "number") {
    return (reason as { status: number }).status;
  }
  return null;
}

function messageOf(reason: unknown): string | null {
  if (reason instanceof Error && reason.message && reason.message !== "Request failed") {
    return reason.message;
  }
  return null;
}

/**
 * Parse a Retry-After header value (delta-seconds or HTTP-date) to seconds.
 * Returns null when the value carries no usable guidance.
 *
 * An HTTP delta-seconds is `1*DIGIT` (a non-negative integer). We treat any
 * pure-integer string strictly as a delta-seconds and never route it to date
 * parsing — this matters because `Date.parse("-5")` is a *valid* (far-past)
 * date, which would otherwise turn an invalid negative value into
 * "retry in 0 seconds" and seed an immediate retry loop.
 */
export function retryAfterSeconds(value: string | null | undefined): number | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (/^-?\d+$/.test(trimmed)) {
    const n = parseInt(trimmed, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  const asDate = Date.parse(trimmed);
  if (!Number.isNaN(asDate)) return Math.max(0, Math.ceil((asDate - Date.now()) / 1000));
  return null;
}

/**
 * Classify any thrown value (ApiError, CommandCenterTimeoutError, AbortError,
 * or a plain Error from malformed JSON) into a closed CommandCenterFailure.
 * Never throws: an unclassifiable value is `server_error`, never a crash.
 */
export function classifyCommandCenterFailure(
  reason: unknown,
  headers?: { get: (name: string) => string | null },
): CommandCenterFailure {
  if (reason instanceof CommandCenterTimeoutError) {
    return { kind: "timeout", retryAfterSeconds: null, backendMessage: null };
  }
  // api.get carries the server's Retry-After on the ApiError itself
  // (api.ts strips other headers); prefer it, fall back to an explicit
  // header shim when callers have one.
  const embeddedRetryAfter =
    reason && typeof reason === "object" && "retryAfter" in reason
      ? ((reason as { retryAfter?: string | null }).retryAfter ?? null)
      : null;
  const retryAfterOf = (status: number): number | null =>
    embeddedRetryAfter != null
      ? retryAfterSeconds(embeddedRetryAfter)
      : headers
        ? retryAfterSeconds(headers.get("retry-after"))
        : null;
  if (reason instanceof DOMException && reason.name === "AbortError") {
    // Aborted requests are ignored by callers; classified as network so a
    // leaked abort can never masquerade as success.
    return { kind: "network", retryAfterSeconds: null, backendMessage: null };
  }

  const status = statusOf(reason);
  if (status === null) {
    // No status: either a network-level ApiError(0) or a non-Api error
    // (e.g. malformed JSON parsed as a TypeError). Both are transport-level.
    if (reason && typeof reason === "object" && "status" in reason) {
      return { kind: "network", retryAfterSeconds: null, backendMessage: messageOf(reason) };
    }
    return { kind: "network", retryAfterSeconds: null, backendMessage: null };
  }
  if (status === 0) return { kind: "network", retryAfterSeconds: null, backendMessage: null };
  if (status === 400) return { kind: "bad_request", retryAfterSeconds: null, backendMessage: messageOf(reason) };
  if (status === 401) return { kind: "unauthorized", retryAfterSeconds: null, backendMessage: null };
  if (status === 403) return { kind: "forbidden", retryAfterSeconds: null, backendMessage: null };
  if (status === 404) return { kind: "not_found", retryAfterSeconds: null, backendMessage: null };
  if (status === 409) return { kind: "conflict", retryAfterSeconds: null, backendMessage: null };
  if (status === 429) {
    return { kind: "rate_limited", retryAfterSeconds: retryAfterOf(429), backendMessage: null };
  }
  if (status === 502 || status === 503 || status === 504) {
    return { kind: "service_unavailable", retryAfterSeconds: retryAfterOf(status), backendMessage: null };
  }
  if (status >= 400 && status < 600) {
    return { kind: "server_error", retryAfterSeconds: null, backendMessage: null };
  }
  return { kind: "server_error", retryAfterSeconds: null, backendMessage: null };
}

/** Closed merchant-facing messages — no free text, no backend interpolation. */
export const FAILURE_MESSAGES: Record<CommandCenterFailureKind, { title: string; body: string }> = {
  network: {
    title: "The briefing could not be reached",
    body: "A connection problem stopped this request. Your network or the service may be interrupted. The rest of the Command Center is unaffected.",
  },
  timeout: {
    title: "The briefing took too long",
    body: "The request was cancelled after 30 seconds. Nothing is shown rather than an incomplete answer.",
  },
  bad_request: {
    title: "The request was rejected",
    body: "The server could not process this request. If this keeps happening, contact support with the time it happened.",
  },
  unauthorized: {
    title: "Your session is no longer valid",
    body: "Sign in again to view the operational briefing. No store data is inferred from a previous session.",
  },
  forbidden: {
    title: "You do not have permission to view this briefing",
    body: "Your account cannot access this workspace's Command Center. Ask a workspace owner to review your role.",
  },
  not_found: {
    title: "No Command Center exists for this workspace",
    body: "This workspace has no operational briefing to show. Check that you selected the right workspace, or connect a store from Integrations.",
  },
  conflict: {
    title: "Another request is already in progress",
    body: "The server is handling a related operation right now. Try again in a moment.",
  },
  rate_limited: {
    title: "Too many requests",
    body: "The server asked us to slow down. You can retry a little later.",
  },
  server_error: {
    title: "The briefing service had a problem",
    body: "A server error interrupted this request. This is temporary in most cases; other sections below are unaffected.",
  },
  service_unavailable: {
    title: "A supporting service is unavailable",
    body: "An upstream service (for example the database or an integration provider) is not answering right now. Verified data already shown remains valid.",
  },
  invalid_contract: {
    title: "The briefing data was not usable",
    body: "The server responded, but the payload did not match the expected briefing contract, so nothing is displayed rather than a wrong answer.",
  },
};
