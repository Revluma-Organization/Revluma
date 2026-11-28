import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { useUI } from "@/store/ui";

vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { full_name: "Test Merchant", email: "merchant@example.com", role: "owner", profile_picture_url: null }, logout: vi.fn() }) }));
const renderSidebar = (route = "/dashboard/overview") => render(<MemoryRouter initialEntries={[route]}><Sidebar /></MemoryRouter>);

afterEach(() => {
  cleanup();
  useUI.setState({ sidebarCollapsed: false, mobileSidebarOpen: false });
  window.innerWidth = 1280;
});

// Active nav items wear the Revluma blue pill (bg-[#2B13CF]) in both themes.
const isActive = (element: HTMLElement) => element.className.split(/\s+/).includes("bg-[#2B13CF]");

describe("Landing-language sidebar and responsive navigation", () => {
  it("uses the landing/auth canvas: warm light surface, pure black in dark mode", () => {
    renderSidebar();
    const aside = document.querySelector("aside")?.className ?? "";
    expect(aside).toContain("bg-[#FBFAF8]");
    expect(aside).toContain("dark:bg-black");
    expect(aside).not.toContain("dark:bg-[#0C0A1D]");
  });
  it("shows the Revluma mark and wordmark without a pill behind them", () => {
    renderSidebar();
    const wordmark = screen.getByText("Revluma");
    expect(wordmark.parentElement?.className).not.toContain("bg-[#1C1C1C]");
    expect(wordmark.parentElement?.className).not.toContain("rounded-full");
  });
  it("marks the current page with a blue pill, never black or white", () => {
    renderSidebar();
    const current = screen.getByRole("link", { name: "Command Center" }).className;
    expect(current).toContain("bg-[#2B13CF]");
    expect(current).not.toMatch(/(^|\s)(dark:)?bg-(white|\[#0C0A1D\]|black)(\s|$)/);
  });
  it("preserves all MVP navigation destinations", () => {
    renderSidebar();
    expect(screen.getByRole("link", { name: "Command Center" })).toHaveAttribute("href", "/dashboard/overview");
    expect(screen.getByRole("link", { name: /Rev Intell/ })).toHaveAttribute("href", "/dashboard/rev-intell");
    expect(screen.getByRole("link", { name: "Integrations" })).toHaveAttribute("href", "/dashboard/integrations");
  });
  it("exposes Priorities and Signals as Command Center deep links (anchors, not routes)", () => {
    renderSidebar();
    expect(screen.getByRole("link", { name: "Priorities" })).toHaveAttribute("href", "/dashboard/overview?section=priority");
    expect(screen.getByRole("link", { name: "Signals" })).toHaveAttribute("href", "/dashboard/overview?section=signals");
  });
  it("lights exactly one overview view active for each deep-link state", () => {
    const priority = renderSidebar("/dashboard/overview?section=priority");
    expect(isActive(screen.getByRole("link", { name: "Priorities" }))).toBe(true);
    expect(isActive(screen.getByRole("link", { name: "Command Center" }))).toBe(false);
    expect(isActive(screen.getByRole("link", { name: "Signals" }))).toBe(false);
    priority.unmount();
    renderSidebar("/dashboard/overview?section=signals");
    expect(isActive(screen.getByRole("link", { name: "Signals" }))).toBe(true);
    expect(isActive(screen.getByRole("link", { name: "Command Center" }))).toBe(false);
    expect(isActive(screen.getByRole("link", { name: "Priorities" }))).toBe(false);
  });
  it("treats a finding deep link as the Priorities view", () => {
    renderSidebar("/dashboard/overview?finding=3ed79446-cb6d-4a1c-b174-9ec1ab91fe15");
    expect(isActive(screen.getByRole("link", { name: "Priorities" }))).toBe(true);
    expect(isActive(screen.getByRole("link", { name: "Command Center" }))).toBe(false);
  });
  it("keeps Command Center active for non-nav overview sections", () => {
    renderSidebar("/dashboard/overview?section=activity");
    expect(isActive(screen.getByRole("link", { name: "Command Center" }))).toBe(true);
    expect(isActive(screen.getByRole("link", { name: "Priorities" }))).toBe(false);
    expect(isActive(screen.getByRole("link", { name: "Signals" }))).toBe(false);
  });
  it("announces a single current page across overview deep links", () => {
    const plain = renderSidebar("/dashboard/overview");
    expect(plain.container.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Command Center" })).toHaveAttribute("aria-current", "page");
    plain.unmount();
    renderSidebar("/dashboard/overview?section=signals");
    expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Signals" })).toHaveAttribute("aria-current", "page");
  });
  it("communicates the active route with text and an active surface", () => {
    renderSidebar();
    expect(isActive(screen.getByRole("link", { name: "Command Center" }))).toBe(true);
  });
  it("uses consistent 44px navigation touch targets", () => {
    renderSidebar();
    for (const link of screen.getAllByRole("link")) expect(link.className).toContain("min-h-11");
  });
  it("provides visible keyboard-focus tokens", () => {
    renderSidebar();
    expect(screen.getByRole("link", { name: "Command Center" }).className).toContain("focus-visible:ring-2");
  });
  it("opens mobile navigation without horizontal page content", () => {
    window.innerWidth = 375;
    useUI.setState({ mobileSidebarOpen: true });
    renderSidebar();
    expect(document.querySelector("aside")?.className).toContain("translate-x-0");
    expect(document.querySelector("aside")?.className).toContain("w-[min(84vw,280px)]");
  });
  it("closes mobile navigation through the backdrop", () => {
    useUI.setState({ mobileSidebarOpen: true });
    const { container } = renderSidebar();
    fireEvent.click(container.querySelector("div.fixed[aria-hidden]")!);
    expect(useUI.getState().mobileSidebarOpen).toBe(false);
  });
  it("collapses desktop navigation while retaining accessible icon titles", () => {
    useUI.setState({ sidebarCollapsed: true });
    renderSidebar();
    expect(screen.getByTitle("Command Center")).toBeInTheDocument();
    expect(document.querySelector("aside")?.className).toContain("md:w-[var(--sidebar-w-collapsed)]");
  });
  it("supports Escape for mobile navigation and account menu", () => {
    useUI.setState({ mobileSidebarOpen: true });
    renderSidebar();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useUI.getState().mobileSidebarOpen).toBe(false);
  });
  it("account control has an accessible expanded state", () => {
    renderSidebar();
    const account = screen.getByRole("button", { name: "Open account menu" });
    expect(account).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(account);
    expect(account).toHaveAttribute("aria-expanded", "true");
  });
  it("account menu preserves settings, billing, team and logout actions", () => {
    renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: "Open account menu" }));
    expect(screen.getByRole("menuitem", { name: "Account settings" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Billing & plans" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Team members" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Log out" })).toBeInTheDocument();
  });
  it("theme control describes the action instead of an unlabelled icon", () => {
    renderSidebar();
    expect(screen.getByRole("switch", { name: /Use .* workspace theme/ })).toBeInTheDocument();
  });
  it("brand imagery does not add redundant screen-reader text", () => {
    renderSidebar();
    expect(document.querySelector('img[alt="Revluma"]')).not.toBeInTheDocument();
  });
  it("sidebar motion is reduced when the merchant requests it", () => {
    renderSidebar();
    expect(document.querySelector("aside")?.className).toContain("motion-reduce:transition-none");
  });
});

describe("Settings mode (one sidebar, never two)", () => {
  afterEach(() => window.sessionStorage.clear());

  it("swaps the workspace links for the settings menu in the same rail", () => {
    renderSidebar("/dashboard/settings/profile");
    expect(screen.queryByRole("link", { name: "Command Center" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Workspace" })).not.toBeInTheDocument();
    const settings = screen.getByRole("navigation", { name: "Settings" });
    expect(settings).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    const profile = screen.getByRole("link", { name: "Profile" });
    expect(profile).toHaveAttribute("aria-current", "page");
    expect(isActive(profile)).toBe(true);
    // Brand and account card stay put so the frame doesn't jump.
    expect(screen.getByText("Revluma")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open account menu" })).toBeInTheDocument();
  });

  it("returns to the last app page, remembered while browsing the app", () => {
    const app = renderSidebar("/dashboard/rev-intell?c=7");
    app.unmount();
    renderSidebar("/dashboard/settings/team");
    expect(screen.getByRole("link", { name: "Back to dashboard" })).toHaveAttribute("href", "/dashboard/rev-intell?c=7");
    expect(screen.getByRole("link", { name: "Members" })).toHaveAttribute("aria-current", "page");
  });

  it("falls back to Overview when there is no remembered page", () => {
    renderSidebar("/dashboard/settings/profile");
    expect(screen.getByRole("link", { name: "Back to dashboard" })).toHaveAttribute("href", "/dashboard/overview");
  });

  it("stays expanded even when the user collapsed the app sidebar", () => {
    useUI.setState({ sidebarCollapsed: true });
    renderSidebar("/dashboard/settings/profile");
    const aside = document.querySelector("aside")!.className;
    expect(aside).toContain("md:w-[var(--sidebar-w)]");
    expect(aside).not.toContain("md:w-[var(--sidebar-w-collapsed)]");
    expect(screen.queryByRole("button", { name: "Collapse sidebar" })?.className).toContain("md:hidden");
  });

  it("lights Billing for every billing tab page", () => {
    renderSidebar("/dashboard/settings/invoice-history");
    expect(screen.getByRole("link", { name: "Billing" })).toHaveAttribute("aria-current", "page");
  });

  it("filters settings, shows an empty state, and clears with Escape", () => {
    renderSidebar("/dashboard/settings/profile");
    const search = screen.getByRole("searchbox", { name: "Search settings" });
    fireEvent.change(search, { target: { value: "invoice" } });
    expect(screen.getByRole("link", { name: "Billing" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Profile" })).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: "nothing-here" } });
    expect(screen.getByRole("status")).toHaveTextContent("No settings match");
    fireEvent.keyDown(search, { key: "Escape" });
    expect(search).toHaveValue("");
    expect(screen.getByRole("link", { name: "Profile" })).toBeInTheDocument();
  });

  it("leaves placeholder pages out of the menu", () => {
    renderSidebar("/dashboard/settings/profile");
    for (const name of ["API Keys", "Webhooks", "Audit Log", "SMS", "AI Settings"]) {
      expect(screen.queryByRole("link", { name })).not.toBeInTheDocument();
    }
  });
});
