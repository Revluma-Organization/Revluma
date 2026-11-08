import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Task 220 — mobile navigation contract: the sidebar is an accessible
// overlay drawer (dialog) below the 768px breakpoint, opened by the top-bar
// hamburger. These tests drive the real Sidebar + Topbar and verify the
// observable a11y behaviour (dialog semantics, focus move/restore/trap,
// Escape, outside-click, scroll lock, breakpoint close, menu + switch
// semantics). jsdom has no layout engine, so two stand-ins are provided:
//  - `window.innerWidth` is set explicitly to represent each width, and
//  - `Element.offsetParent` (always null in jsdom) is mapped to the element's
//    parent so the drawer's real "is this element actionable" logic runs.
// Actual pixel-level media-query layout is NOT measured here (see the
// viewport test and diagnostics); this verifies the JS-driven contract.

const authState = vi.hoisted(() => ({
  user: { id: "u1", full_name: "Test User", email: "test@revluma.app", role: "owner", profile_picture_url: null, status: "pro", tenant_id: "merchant-a" },
  logout: vi.fn(),
  selectWorkspace: vi.fn(),
}));

vi.mock("@/store/authStore", () => ({
  useAuthStore: (selector: (s: typeof authState) => unknown) => selector(authState),
}));
vi.mock("@/lib/api", () => ({
  api: { get: vi.fn().mockResolvedValue({ ok: true, status: 200, data: { data: { count: 0 } } }) },
}));

import { Topbar } from "@/components/layout/Topbar";
import { Sidebar } from "@/components/layout/Sidebar";
import { AuthProvider } from "@/context/AuthContext";
import { useUIStore } from "@/store/uiStore";
import { useThemeStore } from "@/store";

Object.defineProperty(HTMLElement.prototype, "offsetParent", {
  configurable: true,
  get() { return this.parentElement; },
});

const setWidth = (w: number) => { window.innerWidth = w; };
function renderShell() {
  return render(
    <MemoryRouter initialEntries={["/dashboard/overview"]}>
      <AuthProvider>
        <Topbar section="Overview" />
        <Sidebar />
      </AuthProvider>
    </MemoryRouter>,
  );
}
const drawer = () => document.getElementById("sidebar-drawer") as HTMLElement;
const focusableEls = (root: HTMLElement) =>
  Array.from(root.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'));
const openHamburger = () => fireEvent.click(screen.getByRole("button", { name: /open navigation menu/i }));

beforeEach(() => {
  setWidth(375);
  useUIStore.getState().setMobileSidebarOpen(false);
  useUIStore.getState().setSidebarCollapsed(false);
});
afterEach(() => {
  document.documentElement.classList.remove("cc-drawer-open");
});

describe("Mobile navigation drawer (Task 220)", () => {
  it("SC-NAV-01: the hamburger opens the drawer as an accessible dialog", () => {
    renderShell();
    openHamburger();
    expect(useUIStore.getState().mobileSidebarOpen).toBe(true);
    expect(drawer()).toHaveAttribute("role", "dialog");
    expect(drawer()).toHaveAttribute("aria-modal", "true");
    expect(drawer()).toHaveAttribute("aria-label", "Navigation");
  });

  it("SC-NAV-02: the hamburger exposes and reflects the drawer state", () => {
    renderShell();
    const h = screen.getByRole("button", { name: /open navigation menu/i });
    expect(h).toHaveAttribute("aria-expanded", "false");
    expect(h).toHaveAttribute("aria-controls", "sidebar-drawer");
    openHamburger();
    const h2 = screen.getByRole("button", { name: /close navigation menu/i });
    expect(h2).toHaveAttribute("aria-expanded", "true");
    expect(h2).toHaveAttribute("aria-controls", "sidebar-drawer");
  });

  it("SC-NAV-03: opening the drawer moves focus into it", () => {
    renderShell();
    openHamburger();
    expect(drawer().contains(document.activeElement)).toBe(true);
  });

  it("SC-NAV-04: opening locks background scroll and closing restores it", () => {
    renderShell();
    expect(document.documentElement.classList.contains("cc-drawer-open")).toBe(false);
    openHamburger();
    expect(document.documentElement.classList.contains("cc-drawer-open")).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.documentElement.classList.contains("cc-drawer-open")).toBe(false);
  });

  it("SC-NAV-05: Escape closes the drawer and returns focus to the opener", () => {
    renderShell();
    const h = screen.getByRole("button", { name: /open navigation menu/i });
    h.focus();
    fireEvent.click(h);
    expect(drawer().contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(useUIStore.getState().mobileSidebarOpen).toBe(false);
    expect(document.activeElement).toBe(h);
  });

  it("SC-NAV-06: Tab wraps from the last focusable back to the first inside the drawer", () => {
    renderShell();
    openHamburger();
    const els = focusableEls(drawer());
    expect(els.length).toBeGreaterThan(1);
    const first = els[0];
    const last = els[els.length - 1];
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);
  });

  it("SC-NAV-07: Shift+Tab wraps from the first focusable to the last inside the drawer", () => {
    renderShell();
    openHamburger();
    const els = focusableEls(drawer());
    const first = els[0];
    const last = els[els.length - 1];
    first.focus();
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("SC-NAV-08: clicking the backdrop (outside the drawer) closes it", () => {
    const { container } = renderShell();
    openHamburger();
    expect(useUIStore.getState().mobileSidebarOpen).toBe(true);
    const backdrop = container.querySelector("div.fixed[aria-hidden]");
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop as Element);
    expect(useUIStore.getState().mobileSidebarOpen).toBe(false);
  });

  it("SC-NAV-09: choosing a navigation destination closes the drawer", () => {
    renderShell();
    openHamburger();
    expect(useUIStore.getState().mobileSidebarOpen).toBe(true);
    const navLink = focusableEls(drawer()).find(el => el.tagName === "A");
    expect(navLink).toBeTruthy();
    fireEvent.click(navLink as Element);
    expect(useUIStore.getState().mobileSidebarOpen).toBe(false);
  });

  it("SC-NAV-10: growing past the mobile breakpoint closes the drawer and removes dialog semantics", () => {
    setWidth(375);
    renderShell();
    openHamburger();
    expect(drawer().getAttribute("role")).toBe("dialog");
    setWidth(1024);
    fireEvent.resize(window);
    expect(useUIStore.getState().mobileSidebarOpen).toBe(false);
    expect(drawer().getAttribute("role")).toBeNull();
    expect(drawer().getAttribute("aria-modal")).toBeNull();
  });

  it("SC-NAV-11: at a mobile width the sidebar cannot remain collapsed", () => {
    setWidth(375);
    useUIStore.getState().setSidebarCollapsed(true);
    renderShell(); // the mount-time breakpoint check forces it expanded
    expect(useUIStore.getState().sidebarCollapsed).toBe(false);
  });

  it("SC-NAV-12: on desktop the sidebar is not a dialog while the drawer is closed", () => {
    setWidth(1280);
    renderShell();
    expect(drawer().getAttribute("role")).toBeNull();
    expect(drawer().getAttribute("aria-modal")).toBeNull();
  });

  it("SC-NAV-13: the account control exposes menu semantics", () => {
    setWidth(1280);
    const { container } = renderShell();
    const account = container.querySelector("[aria-haspopup='menu']");
    expect(account).not.toBeNull();
    expect(account).toHaveAttribute("aria-controls", "sidebar-user-menu");
    expect(account).toHaveAttribute("aria-expanded", "false");
  });

  it("SC-NAV-14: the account menu opens as a menu and dismisses on Escape and outside click", () => {
    setWidth(1280);
    const { container } = renderShell();
    const account = container.querySelector("[aria-haspopup='menu']") as HTMLElement;
    fireEvent.click(account);
    expect(account).toHaveAttribute("aria-expanded", "true");
    const menu = document.getElementById("sidebar-user-menu");
    expect(menu).not.toBeNull();
    expect(menu).toHaveAttribute("role", "menu");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(account).toHaveAttribute("aria-expanded", "false");
    // Re-open and dismiss via an outside click.
    fireEvent.click(account);
    expect(account).toHaveAttribute("aria-expanded", "true");
    fireEvent.mouseDown(document.body);
    expect(account).toHaveAttribute("aria-expanded", "false");
  });

  it("SC-NAV-15: the theme control is a switch whose state mirrors the theme", () => {
    setWidth(1280);
    renderShell();
    const before = useThemeStore.getState().theme;
    const sw = screen.getByRole("switch");
    expect(sw).toHaveAttribute("aria-checked", String(before === "dark"));
    fireEvent.click(sw);
    const after = useThemeStore.getState().theme;
    expect(after).not.toBe(before);
    expect(sw).toHaveAttribute("aria-checked", String(after === "dark"));
  });

  it("SC-NAV-16: the drawer exposes a labelled close affordance", () => {
    renderShell();
    expect(screen.getByRole("button", { name: /close sidebar/i })).toBeInTheDocument();
  });
});
