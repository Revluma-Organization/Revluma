import { describe, expect, it } from "vitest";
import { resolveSectionTitle } from "./DashboardLayout";

// Stage 2 — the breadcrumb names the nav-owned `?section=` overview views.
// Priorities / Signals are anchors, not routes, so the title comes from the
// query string; every other state keeps the route-level workspace title.
describe("resolveSectionTitle", () => {
  it("names the Priorities view", () => {
    expect(resolveSectionTitle("/dashboard/overview", "priority")).toBe("Priorities");
  });
  it("names the Signals view", () => {
    expect(resolveSectionTitle("/dashboard/overview", "signals")).toBe("Signals");
  });
  it("keeps the workspace title on the plain overview", () => {
    expect(resolveSectionTitle("/dashboard/overview", null)).toBe("Overview");
  });
  it("keeps the workspace title for non-nav overview sections", () => {
    expect(resolveSectionTitle("/dashboard/overview", "activity")).toBe("Overview");
    expect(resolveSectionTitle("/dashboard/overview", "evidence")).toBe("Overview");
  });
  it("ignores section hints outside the overview", () => {
    expect(resolveSectionTitle("/dashboard/rev-intell", "priority")).toBe("Rev Intelligence");
  });
  it("falls back to Overview for unknown routes", () => {
    expect(resolveSectionTitle("/dashboard/unknown", null)).toBe("Overview");
  });
});
