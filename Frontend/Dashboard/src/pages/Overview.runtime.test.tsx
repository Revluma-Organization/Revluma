import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { CommandCenterData } from "@/components/command-center/types";
import type { CommandCenterFailure } from "@/lib/commandCenterError";

// Task 220 — runtime-state tests drive the Command Center through every
// classified state by controlling the hook directly. This isolates the
// page's *observable* behaviour (banner copy, retry policy, live region,
// skeleton vs. sections vs. honest empty state) from the request lifecycle,
// which is covered separately in useCommandCenter.test.ts.
const hookState = vi.hoisted(() => ({
  data: null as CommandCenterData | null,
  loading: false,
  refreshing: false,
  failure: null as CommandCenterFailure | null,
  lastSuccessfulAt: null as string | null,
  announcement: null as string | null,
  refetch: vi.fn(),
}));

vi.mock("@/hooks/useCommandCenter", () => ({ useCommandCenter: () => hookState }));
// The Task 218 panels perform their own store-scoped requests; they are
// covered by their own retry test files. Stub them here so the banner/
// skeleton/live-region behaviour is tested in isolation.
vi.mock("@/components/dashboard/BusinessHealthPanel", () => ({ default: () => <div data-testid="bhp-stub" /> }));
vi.mock("@/components/dashboard/OperationalActivityPanel", () => ({ default: () => <div data-testid="oap-stub" /> }));

import Overview from "./Overview";
import { commandCenterFixture } from "@/components/command-center/testFixtures";

function renderPage() {
  return render(<MemoryRouter><Overview /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  hookState.data = null;
  hookState.loading = false;
  hookState.refreshing = false;
  hookState.failure = null;
  hookState.lastSuccessfulAt = null;
  hookState.announcement = null;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Command Center runtime states (Task 220)", () => {
  it("SC-RUN-01: initial load shows a skeleton and never flashes the empty or failure state", () => {
    hookState.data = null;
    hookState.loading = true;
    hookState.failure = null;
    renderPage();
    expect(screen.getByRole("status", { name: /loading operational briefing/i })).toBeInTheDocument();
    expect(screen.queryByText(/No operational briefing is available/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Business situation" })).not.toBeInTheDocument();
  });

  it("SC-RUN-02: an initial network failure shows the closed message and offers a foreground retry", () => {
    hookState.failure = { kind: "network", retryAfterSeconds: null, backendMessage: null };
    renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent("The briefing could not be reached");
    expect(screen.getByRole("alert")).toHaveTextContent("A connection problem stopped this request");
    const retry = screen.getByRole("button", { name: /try again/i });
    retry.click();
    expect(hookState.refetch).toHaveBeenCalledWith(false);
    // No fabricated content: sections are not rendered.
    expect(screen.queryByRole("heading", { name: "Business situation" })).not.toBeInTheDocument();
  });

  it("SC-RUN-03: an initial 404 gives workspace guidance and no retry", () => {
    hookState.failure = { kind: "not_found", retryAfterSeconds: null, backendMessage: null };
    renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent("No Command Center exists for this workspace");
    expect(screen.getByRole("alert")).toHaveTextContent(/open Integrations to connect a store/i);
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
  });

  it("SC-RUN-04: an initial 401 shows session copy and never offers a retry", () => {
    hookState.failure = { kind: "unauthorized", retryAfterSeconds: null, backendMessage: null };
    renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent("Your session is no longer valid");
    expect(screen.getByRole("alert")).toHaveTextContent(/Sign in again/i);
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
  });

  it("SC-RUN-05: an initial 403 distinguishes permission from session and offers no retry", () => {
    hookState.failure = { kind: "forbidden", retryAfterSeconds: null, backendMessage: null };
    renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent("You do not have permission to view this briefing");
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
  });

  it("SC-RUN-06: a 429 shows a real countdown from the backend and only enables retry at zero", () => {
    vi.useFakeTimers();
    hookState.failure = { kind: "rate_limited", retryAfterSeconds: 30, backendMessage: null };
    renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent("Too many requests");
    expect(screen.getByRole("status")).toHaveTextContent("Retry available in 30s.");
    const waiting = screen.getByRole("button", { name: /waiting/i });
    expect(waiting).toBeDisabled();
    act(() => { vi.advanceTimersByTime(29_000); });
    expect(screen.getByRole("status")).toHaveTextContent("Retry available in 1s.");
    expect(screen.getByRole("button", { name: /waiting/i })).toBeDisabled();
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(screen.queryByRole("status", { name: undefined })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeEnabled();
  });

  it("SC-RUN-07: a background failure keeps verified siblings visible (isolated, not a full-page error)", () => {
    hookState.data = commandCenterFixture();
    hookState.failure = { kind: "server_error", retryAfterSeconds: null, backendMessage: null };
    renderPage();
    // The failed resource is flagged...
    expect(screen.getByRole("alert")).toHaveTextContent("The briefing service had a problem");
    // ...but every unaffected section remains accessible.
    expect(screen.getByRole("heading", { name: "Your latest synchronized business picture" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Business situation" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Priority finding" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Evidence & data readiness" })).toBeInTheDocument();
  });

  it("SC-RUN-08: a background refresh outcome is announced once in a polite live region", () => {
    hookState.data = commandCenterFixture();
    hookState.announcement = "Briefing refreshed at 12:30:00 PM.";
    const { container } = renderPage();
    const region = container.querySelector('[aria-live="polite"]');
    expect(region).not.toBeNull();
    expect(region).toHaveTextContent("Briefing refreshed at 12:30:00 PM.");
  });

  it("SC-RUN-09: no data, no failure, not loading is an honest empty state (not an error, not zero)", () => {
    hookState.data = null;
    hookState.loading = false;
    hookState.failure = null;
    renderPage();
    expect(screen.getByText(/No operational briefing is available/i)).toBeInTheDocument();
    expect(screen.getByText(/No business information is asserted/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status", { name: /loading operational briefing/i })).not.toBeInTheDocument();
  });

  it("SC-RUN-10: a refresh in flight labels the snapshot, disables the button, and never re-shows the skeleton", () => {
    hookState.data = commandCenterFixture();
    hookState.refreshing = true;
    renderPage();
    expect(screen.getByText("refreshing")).toBeInTheDocument();
    const refresh = screen.getByRole("button", { name: /refreshing/i });
    expect(refresh).toBeDisabled();
    expect(screen.getByRole("heading", { name: "Business situation" })).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: /loading operational briefing/i })).not.toBeInTheDocument();
  });

  it("SC-RUN-11: a failed briefing offers a background retry when data already exists", () => {
    hookState.data = commandCenterFixture();
    hookState.failure = { kind: "service_unavailable", retryAfterSeconds: null, backendMessage: null };
    renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent("A supporting service is unavailable");
    screen.getByRole("button", { name: /try again/i }).click();
    expect(hookState.refetch).toHaveBeenCalledWith(true);
  });

  it("SC-RUN-12: a timeout is described as a cancelled request and is retryable", () => {
    hookState.failure = { kind: "timeout", retryAfterSeconds: null, backendMessage: null };
    renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent("The briefing took too long");
    expect(screen.getByRole("alert")).toHaveTextContent(/cancelled after 30 seconds/i);
    expect(screen.getByRole("button", { name: /try again/i })).toBeEnabled();
  });

  it("SC-RUN-13: an unusable contract is shown as an honest failure with no retry", () => {
    hookState.failure = { kind: "invalid_contract", retryAfterSeconds: null, backendMessage: null };
    renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent("The briefing data was not usable");
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
  });

  it("SC-RUN-14: the snapshot chip surfaces the last successful refresh time (never stale-as-current)", () => {
    hookState.data = commandCenterFixture();
    hookState.lastSuccessfulAt = "2026-11-08T12:00:00Z";
    const { container } = renderPage();
    const chip = container.querySelector("header span[title*='Last successful refresh']");
    expect(chip).not.toBeNull();
    expect(chip?.getAttribute("title")).toMatch(/Last successful refresh/);
  });
});
