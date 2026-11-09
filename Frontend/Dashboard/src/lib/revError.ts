// Task 224 (original Tasks 305–306) — conversation error classification & recovery.
//
// This module is the SINGLE decision layer for how the browser *recovers* from a
// failure the Rev Intelligence conversation can observe: whether "Try again" is an
// honest action (retryable), the real backend rate-limit guidance (Retry-After),
// and whether the failure should be announced assertively (urgent) or politely.
//
// It deliberately owns NO message text. The closed, merchant-facing wording for a
// failure is the single source of truth in the page's cleanError(), which delegates
// to the shared workspace-language classifier (Task 226's explainWorkspaceError /
// merchantMessage). Keeping the two layers separate means the recoverable/permanent
// decision and the human wording can never drift: a failure's words always come from
// cleanError(), its recovery semantics from here.
//
// Two layers, in priority order (mirroring how the error is observed):
//   1. A structured backend error code the AI pipeline attached
//      (INTELLIGENCE_*, FINDING_*, RATE_LIMITED, READ_ONLY, …). Most specific, so it
//      wins over the raw transport status.
//   2. The raw transport/HTTP status (400–504, network, timeout) classified by the
//      shared Task 220 closed classifier (classifyCommandCenterFailure) — no backend
//      text is interpolated, and no stack trace, SQL error, provider detail, or
//      credential can surface.
//
// A thrown value that carries neither a code nor a status is a transport-level
// `network` failure (retryable), never a crash and never a fabricated success.

import {
  classifyCommandCenterFailure,
  RETRYABLE_KINDS,
  type CommandCenterFailureKind,
} from "./commandCenterError";

export type RevFailureKind =
  | CommandCenterFailureKind
  | "read_only"
  | "finding_error"
  | "unsupported_browser";

export interface RevFailure {
  kind: RevFailureKind;
  /** Whether "Try again" is an honest, recoverable action for this failure. */
  retryable: boolean;
  /** Real retry guidance from the backend (429 / 5xx Retry-After), seconds. */
  retryAfterSeconds: number | null;
}

// Backend AI-pipeline / Rev-specific codes → kind + retryable decision.
// (The human wording for these codes lives in cleanError(), not here.)
const CODE_CLASSIFICATION: Record<string, { kind: RevFailureKind; retryable: boolean }> = {
  // Transient server/pipeline failures the merchant can recover from by retrying.
  INTELLIGENCE_TIMEOUT:          { kind: "timeout",             retryable: true },
  INTELLIGENCE_UNAVAILABLE:      { kind: "service_unavailable", retryable: true },
  INTELLIGENCE_INVALID_RESPONSE: { kind: "invalid_contract",    retryable: true },
  INTELLIGENCE_AUTH_FAILED:      { kind: "server_error",        retryable: true },
  STREAM_START_FAILED:           { kind: "server_error",        retryable: true },
  RATE_LIMITED:                  { kind: "rate_limited",        retryable: true },
  // Permanent / not-actionable-by-retry failures: re-sending the identical request
  // is futile, so the "Try again" control is withheld.
  INTELLIGENCE_NOT_CONFIGURED:   { kind: "server_error",        retryable: false },
  READ_ONLY:                     { kind: "read_only",           retryable: false },
  NOTHING_TO_RETRY:              { kind: "server_error",        retryable: false },
  INVALID_FINDING_ID:            { kind: "finding_error",       retryable: false },
  FINDING_NOT_FOUND:             { kind: "finding_error",       retryable: false },
  FINDING_EVIDENCE_UNVERIFIED:   { kind: "finding_error",       retryable: false },
  STREAM_UNSUPPORTED:            { kind: "unsupported_browser", retryable: false },
  UNAUTHORIZED:                  { kind: "unauthorized",        retryable: false },
  VALIDATION_ERROR:              { kind: "bad_request",         retryable: false },
};

/** Classify an error that arrived as a *structured response* (the request completed,
 *  so there is no transport status to read) into its recovery decision. A known code
 *  uses its closed mapping; an unknown/absent code is an unreadable response
 *  (retryable), never a fabricated transport failure. */
export function classifyRevResponseError(code?: string | null): RevFailure {
  if (code && CODE_CLASSIFICATION[code]) {
    const c = CODE_CLASSIFICATION[code];
    return { kind: c.kind, retryable: c.retryable, retryAfterSeconds: null };
  }
  return { kind: "invalid_contract", retryable: true, retryAfterSeconds: null };
}

/**
 * Classify any thrown value (ApiError, RevStreamError, timeout/abort, or a plain
 * Error from a malformed response) plus an optional structured backend code into a
 * recovery decision. Never throws: an unclassifiable value is a retryable
 * transport-level `network` failure, never a crash.
 */
export function classifyRevFailure(
  reason: unknown,
  backendCode?: string | null,
): RevFailure {
  // 422 Unprocessable Entity is a validation failure — permanent, not a transient
  // server error — so it must not offer a retry. The shared 4xx-5xx catch would
  // otherwise classify it as a retryable server_error.
  const status =
    reason && typeof reason === "object" && "status" in reason &&
    typeof (reason as { status: unknown }).status === "number"
      ? (reason as { status: number }).status
      : null;
  if (status === 422 && !(backendCode && CODE_CLASSIFICATION[backendCode])) {
    return { kind: "bad_request", retryable: false, retryAfterSeconds: null };
  }

  // The raw classification also yields real rate-limit guidance (Retry-After):
  // api.ts always copies the server's Retry-After onto the ApiError itself.
  const raw = classifyCommandCenterFailure(reason);

  if (backendCode && CODE_CLASSIFICATION[backendCode]) {
    const c = CODE_CLASSIFICATION[backendCode];
    return {
      kind: c.kind,
      retryable: c.retryable,
      // Rate-limit guidance is only meaningful for the rate_limited kind.
      retryAfterSeconds: c.kind === "rate_limited" ? raw.retryAfterSeconds : null,
    };
  }

  return {
    kind: raw.kind,
    // A 429 is recoverable too — the merchant can retry once the Retry-After
    // window elapses — so it joins the retryable set the Task 220 panel keeps
    // out (there, a countdown disables the button rather than an immediate retry).
    retryable: RETRYABLE_KINDS.has(raw.kind) || raw.kind === "rate_limited",
    retryAfterSeconds: raw.retryAfterSeconds,
  };
}

/**
 * True when a failure should be announced ASSERTIVELY (an urgent error needing
 * immediate attention) rather than as a polite status change. Session/permission
 * failures (401/403) and every transient outage the merchant must know about
 * immediately (5xx, rate-limit, timeout, network, malformed) are urgent; an
 * "in-progress" style status that the merchant can resolve by simply waiting is a
 * polite status.
 */
export function isAssertiveRevFailure(kind: RevFailureKind): boolean {
  return (
    kind === "unauthorized" ||
    kind === "forbidden" ||
    kind === "server_error" ||
    kind === "service_unavailable" ||
    kind === "rate_limited" ||
    kind === "timeout" ||
    kind === "network" ||
    kind === "invalid_contract"
  );
}
