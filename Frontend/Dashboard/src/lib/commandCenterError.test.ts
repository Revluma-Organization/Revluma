import { describe, expect, it, vi } from "vitest";
import {
  classifyCommandCenterFailure,
  CommandCenterTimeoutError,
  FAILURE_MESSAGES,
  RETRYABLE_KINDS,
  retryAfterSeconds,
  createTimedAbortController,
  COMMAND_CENTER_TIMEOUT_MS,
  type CommandCenterFailureKind,
} from "./commandCenterError";
import { ApiError } from "./api";

const apiError = (status: number, message = "x", retryAfter?: string | null) => {
  const err = new ApiError(status, message);
  if (retryAfter !== undefined) err.retryAfter = retryAfter;
  return err;
};

describe("classifyCommandCenterFailure — closed classification (Task 220)", () => {
  it("SC-ERR-01: network-level failure (ApiError status 0) classifies as network", () => {
    expect(classifyCommandCenterFailure(apiError(0, "Network error: fetch failed")).kind).toBe("network");
  });
  it("SC-ERR-02: a plain Error with no status classifies as network (transport)", () => {
    expect(classifyCommandCenterFailure(new Error("connection reset")).kind).toBe("network");
  });
  it("SC-ERR-03: a TypeError from malformed JSON classifies as network, never throws", () => {
    expect(classifyCommandCenterFailure(new TypeError("Unexpected token < in JSON")).kind).toBe("network");
  });
  it("SC-ERR-04: 400 classifies as bad_request and carries the sanitized backend message", () => {
    const f = classifyCommandCenterFailure(apiError(400, "A valid store_id is required."));
    expect(f.kind).toBe("bad_request");
    expect(f.backendMessage).toBe("A valid store_id is required.");
  });
  it("SC-ERR-05: 401 classifies as unauthorized and never leaks a backend message", () => {
    const f = classifyCommandCenterFailure(apiError(401, "Invalid or expired access token"));
    expect(f.kind).toBe("unauthorized");
    expect(f.backendMessage).toBeNull();
  });
  it("SC-ERR-06: 403 classifies as forbidden (permission, not session)", () => {
    expect(classifyCommandCenterFailure(apiError(403, "forbidden")).kind).toBe("forbidden");
  });
  it("SC-ERR-07: 404 classifies as not_found", () => {
    expect(classifyCommandCenterFailure(apiError(404, "Store not found.")).kind).toBe("not_found");
  });
  it("SC-ERR-08: 409 classifies as conflict", () => {
    expect(classifyCommandCenterFailure(apiError(409, "already in progress")).kind).toBe("conflict");
  });
  it("SC-ERR-09: 429 classifies as rate_limited with the embedded Retry-After parsed", () => {
    const f = classifyCommandCenterFailure(apiError(429, "slow down", "45"));
    expect(f.kind).toBe("rate_limited");
    expect(f.retryAfterSeconds).toBe(45);
  });
  it("SC-ERR-10: 429 with an HTTP-date Retry-After parses the delta", () => {
    const date = new Date(Date.now() + 90_000).toUTCString();
    const f = classifyCommandCenterFailure(apiError(429, "slow down", date));
    expect(f.kind).toBe("rate_limited");
    expect(f.retryAfterSeconds).toBeGreaterThanOrEqual(85);
    expect(f.retryAfterSeconds).toBeLessThanOrEqual(95);
  });
  it("SC-ERR-11: 500 classifies as server_error", () => {
    expect(classifyCommandCenterFailure(apiError(500, "An unexpected server error occurred")).kind).toBe("server_error");
  });
  it("SC-ERR-12: 502/503/504 classify as service_unavailable", () => {
    for (const status of [502, 503, 504]) {
      expect(classifyCommandCenterFailure(apiError(status, "x")).kind).toBe("service_unavailable");
    }
  });
  it("SC-ERR-13: 503 with Retry-After carries the guidance", () => {
    const f = classifyCommandCenterFailure(apiError(503, "x", "30"));
    expect(f.retryAfterSeconds).toBe(30);
  });
  it("SC-ERR-14: an unusual 418 still classifies (server_error bucket), never crashes", () => {
    expect(classifyCommandCenterFailure(apiError(418, "teapot")).kind).toBe("server_error");
  });
  it("SC-ERR-15: an explicit AbortError classifies as network (a leaked abort is not success)", () => {
    const e = new DOMException("aborted", "AbortError");
    expect(classifyCommandCenterFailure(e).kind).toBe("network");
  });
  it("SC-ERR-16: the timeout sentinel classifies as timeout", () => {
    expect(classifyCommandCenterFailure(new CommandCenterTimeoutError()).kind).toBe("timeout");
  });
  it("SC-ERR-17: the headers shim is used when the error carries no embedded Retry-After", () => {
    const err = new ApiError(429, "slow down");
    const f = classifyCommandCenterFailure(err, { get: (n) => (n.toLowerCase() === "retry-after" ? "12" : null) });
    expect(f.retryAfterSeconds).toBe(12);
  });
  it("SC-ERR-18: every closed kind has a non-empty merchant-facing message", () => {
    const kinds: CommandCenterFailureKind[] = [
      "network", "timeout", "bad_request", "unauthorized", "forbidden", "not_found",
      "conflict", "rate_limited", "server_error", "service_unavailable", "invalid_contract",
    ];
    for (const kind of kinds) {
      expect(FAILURE_MESSAGES[kind].title.length).toBeGreaterThan(0);
      expect(FAILURE_MESSAGES[kind].body.length).toBeGreaterThan(0);
    }
  });
  it("SC-ERR-19: retry eligibility is closed and matches the classification", () => {
    expect(RETRYABLE_KINDS.has("network")).toBe(true);
    expect(RETRYABLE_KINDS.has("timeout")).toBe(true);
    expect(RETRYABLE_KINDS.has("server_error")).toBe(true);
    expect(RETRYABLE_KINDS.has("service_unavailable")).toBe(true);
    expect(RETRYABLE_KINDS.has("not_found")).toBe(false);
    expect(RETRYABLE_KINDS.has("forbidden")).toBe(false);
    expect(RETRYABLE_KINDS.has("unauthorized")).toBe(false);
    expect(RETRYABLE_KINDS.has("invalid_contract")).toBe(false);
  });
});

describe("retryAfterSeconds — parsing (Task 220)", () => {
  it("SC-ERR-20: parses delta-seconds, rejects junk, null on absence", () => {
    expect(retryAfterSeconds("10")).toBe(10);
    expect(retryAfterSeconds("0")).toBe(0);
    expect(retryAfterSeconds("not-a-number")).toBeNull();
    expect(retryAfterSeconds(null)).toBeNull();
    expect(retryAfterSeconds(undefined)).toBeNull();
    expect(retryAfterSeconds("-5")).toBeNull();
  });
});

describe("createTimedAbortController (Task 220)", () => {
  it("SC-ERR-21: aborts after the configured timeout and reports timedOut()", () => {
    vi.useFakeTimers();
    const { controller, clear, timedOut } = createTimedAbortController(COMMAND_CENTER_TIMEOUT_MS);
    expect(controller.signal.aborted).toBe(false);
    vi.advanceTimersByTime(COMMAND_CENTER_TIMEOUT_MS - 1);
    expect(controller.signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(controller.signal.aborted).toBe(true);
    expect(timedOut()).toBe(true);
    clear();
    vi.useRealTimers();
  });
  it("SC-ERR-22: clear() before the deadline leaves the signal intact", () => {
    vi.useFakeTimers();
    const { controller, clear, timedOut } = createTimedAbortController(COMMAND_CENTER_TIMEOUT_MS);
    clear(); // cancel the pending timer before the deadline
    vi.advanceTimersByTime(COMMAND_CENTER_TIMEOUT_MS + 1000);
    expect(controller.signal.aborted).toBe(false);
    expect(timedOut()).toBe(false);
    vi.useRealTimers();
  });
});
