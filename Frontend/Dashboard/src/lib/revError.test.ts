import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import { CommandCenterTimeoutError } from "./commandCenterError";
import { classifyRevFailure, isAssertiveRevFailure, type RevFailureKind } from "./revError";

// Task 224 (§2 conversation error handling) — the closed Rev recovery decision layer.
// Every failure the conversation can observe maps to a recoverable/permanent decision
// (retryable), a kind, and (for 429/5xx) real Retry-After guidance. This module owns
// NO message text: the merchant-facing wording is the single source of truth in the
// page's cleanError() (Task 226 workspace language), which is asserted separately in
// RevIntell.test.tsx. Here we verify the recovery semantics that cleanError does not
// decide.

const statusError = (status: number) => new ApiError(status, "Request failed");

describe("classifyRevFailure — raw HTTP / transport statuses", () => {
  it.each([
    [400, "bad_request", false],
    [401, "unauthorized", false],
    [403, "forbidden", false],
    [404, "not_found", false],
    [409, "conflict", true],
    [422, "bad_request", false],
    [429, "rate_limited", true],
    [500, "server_error", true],
    [502, "service_unavailable", true],
    [503, "service_unavailable", true],
    [504, "service_unavailable", true],
  ] as const)("maps HTTP %i to kind %s (retryable=%s)", (status, kind, retryable) => {
    const result = classifyRevFailure(statusError(status));
    expect(result.kind).toBe(kind);
    expect(result.retryable).toBe(retryable);
  });

  it("maps a network-level failure (status 0) to a recoverable network kind", () => {
    const result = classifyRevFailure(statusError(0));
    expect(result.kind).toBe("network");
    expect(result.retryable).toBe(true);
  });

  it("maps a request timeout to a recoverable timeout kind", () => {
    const result = classifyRevFailure(new CommandCenterTimeoutError());
    expect(result.kind).toBe("timeout");
    expect(result.retryable).toBe(true);
  });

  it("maps a malformed/unknown thrown value to a recoverable transport-level failure, never a crash", () => {
    const result = classifyRevFailure(new Error("boom"));
    expect(result.kind).toBe("network");
    expect(result.retryable).toBe(true);
  });
});

describe("classifyRevFailure — rate-limit guidance (Retry-After)", () => {
  it("surfaces a delta-seconds Retry-After from the ApiError", () => {
    const err = new ApiError(429, "Request failed");
    err.retryAfter = "45";
    const result = classifyRevFailure(err);
    expect(result.kind).toBe("rate_limited");
    expect(result.retryAfterSeconds).toBe(45);
  });

  it("surfaces an HTTP-date Retry-After carried on the ApiError", () => {
    const err = new ApiError(503, "Request failed");
    err.retryAfter = new Date(Date.now() + 30_000).toUTCString();
    const result = classifyRevFailure(err);
    expect(result.kind).toBe("service_unavailable");
    expect(result.retryAfterSeconds).not.toBeNull();
    expect(result.retryAfterSeconds as number).toBeGreaterThanOrEqual(25);
  });

  it("ignores a negative Retry-After (no immediate-retry loop)", () => {
    const err = new ApiError(429, "Request failed");
    err.retryAfter = "-5";
    expect(classifyRevFailure(err).retryAfterSeconds).toBeNull();
  });

  it("does not attach rate-limit guidance to non-rate-limit failures", () => {
    const err = new ApiError(500, "Request failed");
    err.retryAfter = "30";
    expect(classifyRevFailure(err).retryAfterSeconds).toBeNull();
  });
});

describe("classifyRevFailure — structured backend codes", () => {
  it.each([
    ["INTELLIGENCE_TIMEOUT", "timeout", true],
    ["INTELLIGENCE_UNAVAILABLE", "service_unavailable", true],
    ["INTELLIGENCE_INVALID_RESPONSE", "invalid_contract", true],
    ["INTELLIGENCE_AUTH_FAILED", "server_error", true],
    ["INTELLIGENCE_NOT_CONFIGURED", "server_error", false],
    ["RATE_LIMITED", "rate_limited", true],
    ["READ_ONLY", "read_only", false],
    ["NOTHING_TO_RETRY", "server_error", false],
    ["INVALID_FINDING_ID", "finding_error", false],
    ["FINDING_NOT_FOUND", "finding_error", false],
    ["FINDING_EVIDENCE_UNVERIFIED", "finding_error", false],
    ["STREAM_START_FAILED", "server_error", true],
    ["STREAM_UNSUPPORTED", "unsupported_browser", false],
    ["UNAUTHORIZED", "unauthorized", false],
    ["VALIDATION_ERROR", "bad_request", false],
  ] as const)("%s → kind %s (retryable=%s)", (code, kind, retryable) => {
    // A structured code wins even when the transport status would say otherwise.
    const result = classifyRevFailure(new ApiError(500, "Request failed"), code);
    expect(result.kind).toBe(kind);
    expect(result.retryable).toBe(retryable);
  });

  it("keeps the read-only boundary truthful and non-retryable", () => {
    const result = classifyRevFailure(new ApiError(403, "Request failed"), "READ_ONLY");
    expect(result.kind).toBe("read_only");
    expect(result.retryable).toBe(false);
  });

  it("an unknown backend code falls back to a truthful, retryable transport decision", () => {
    const result = classifyRevFailure(new ApiError(500, "Request failed"), "SOMETHING_NEW");
    expect(result.kind).toBe("server_error");
    expect(result.retryable).toBe(true);
  });
});

describe("classifyRevFailure — recoverable vs permanent", () => {
  it("treats session and permission failures as permanent (no retry offered)", () => {
    for (const status of [401, 403] as const) {
      expect(classifyRevFailure(statusError(status)).retryable).toBe(false);
    }
  });

  it("treats network, timeout, 5xx and conflict as recoverable", () => {
    for (const status of [0, 409, 500, 502, 503, 504] as const) {
      expect(classifyRevFailure(statusError(status)).retryable).toBe(true);
    }
    expect(classifyRevFailure(new CommandCenterTimeoutError()).retryable).toBe(true);
  });

  it("isAssertiveRevFailure flags urgent outages (5xx/rate-limit/timeout/network) and session failures", () => {
    const assertive: RevFailureKind[] = [
      "unauthorized", "forbidden", "server_error", "service_unavailable",
      "rate_limited", "timeout", "network", "invalid_contract",
    ];
    const polite: RevFailureKind[] = ["bad_request", "not_found", "conflict", "read_only", "finding_error", "unsupported_browser"];
    for (const kind of assertive) expect(isAssertiveRevFailure(kind), kind).toBe(true);
    for (const kind of polite) expect(isAssertiveRevFailure(kind), kind).toBe(false);
  });
});
