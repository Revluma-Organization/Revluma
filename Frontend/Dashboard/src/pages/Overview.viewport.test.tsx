import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { CommandCenterData } from "@/components/command-center/types";

// Task 220 — viewport matrix (320/375/430/600/768/1024/1280/1440/1920).
//
// HONEST SCOPE / jsdom CAVEAT (see diagnostics): jsdom has no layout engine and
// does NOT evaluate CSS @media queries, so Tailwind breakpoint classes
// (sm/md/lg/xl) do not change the rendered box model here. Therefore these
// tests do NOT measure pixel layout. They verify the two width-dependent
// contracts the *application* controls programmatically:
//   1. Content preservation — the full Command Center DOM (briefing, business,
//      priority finding, evidence, the consolidated health/activity sections) is present at
//      every width, i.e. nothing is conditionally removed for mobile.
//   2. The 768px navigation breakpoint — the real resize handler in Sidebar
//      keeps the overlay drawer on mobile widths and closes it (and drops the
//      dialog semantics) once the viewport reaches the desktop breakpoint.
// Pixel-level layout at each width is verified by CSS audit + the production
// live-verification checklist, and is reported separately — not here.

const hookState = vi.hoisted(() => ({
  data: null as CommandCenterData | null,
  loading: false,
  refreshing: false,
  failure: null,
  lastSuccessfulAt: null,
  announcement: null,
  refetch: vi.fn(),
}));
vi.mock("@/hooks/useCommandCenter", () => ({ useCommandCenter: () => hookState }));
const authState = vi.hoisted(() => ({
  user: { id: "u1", full_name: "Test User", email: "test@revluma.app", role: "owner", profile_picture_url: null, status: "pro", tenant_id: "merchant-a" },
  logout: vi.fn(),
  selectWorkspace: vi.fn(),
}));
vi.mock("@/store/authStore", () => ({
  useAuthStore: (selector: (s: typeof authState) => unknown) => selector(authState),
}));

import Overview from "./Overview";
import { Sidebar } from "@/components/layout/Sidebar";
import { AuthProvider } from "@/context/AuthContext";
import { useUIStore } from "@/store/uiStore";
import { commandCenterFixture } from "@/components/command-center/testFixtures";

// The app's navigation breakpoint: below 768px the sidebar is the mobile
// overlay drawer; at/above it is the in-flow sidebar (see Sidebar handleResize
// and the `md:`/`max-md:` classes on the hamburger and aside).
const MOBILE_MAX = 768;
const WIDTHS = [320, 375, 430, 600, 768, 1024, 1280, 1440, 1920] as const;

function renderShell() {
  return render(
    <MemoryRouter initialEntries={["/dashboard/overview"]}>
      <AuthProvider>
        <Sidebar />
        <Overview />
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  hookState.data = commandCenterFixture();
  hookState.loading = false;
  hookState.refreshing = false;
  hookState.failure = null;
  hookState.lastSuccessfulAt = "2026-11-08T12:00:00Z";
  hookState.announcement = null;
  useUIStore.getState().setMobileSidebarOpen(false);
  useUIStore.getState().setSidebarCollapsed(false);
});
afterEach(() => {
  window.innerWidth = 1024;
  document.documentElement.classList.remove("cc-drawer-open");
});

describe("Viewport matrix (Task 220) — JS-driven contract; CSS layout verified separately", () => {
  it.each(WIDTHS)("%ipx: the full Command Center content is present (no information removed for the viewport)", (width) => {
    window.innerWidth = width;
    renderShell();
    expect(screen.getByRole("heading", { name: "Your latest synchronized business picture" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Business health" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Top priority" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Data readiness & limitations" })).toBeInTheDocument();
    expect(screen.getByText("revluma-test-store-v1.myshopify.com")).toBeInTheDocument();
  });

  it.each(WIDTHS)("%ipx: the 768px breakpoint drives the navigation mode", (width) => {
    window.innerWidth = width;
    renderShell();
    // The user opens the drawer, then the viewport is at this width.
    act(() => { useUIStore.getState().setMobileSidebarOpen(true); });
    fireEvent.resize(window);
    // Mobile widths keep the overlay drawer; desktop widths close it.
    expect(useUIStore.getState().mobileSidebarOpen).toBe(width < MOBILE_MAX);
  });
});
