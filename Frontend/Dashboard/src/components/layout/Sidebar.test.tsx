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

// Active nav items wear the landing/auth ink pill (bg-[#0C0A1D], white in dark).
const isActive = (element: HTMLElement) => element.className.split(/\s+/).includes("bg-[#0C0A1D]");

describe("Landing-language sidebar and responsive navigation", () => {
  it("uses the landing/auth canvas: warm light surface, ink in dark mode", () => {
    renderSidebar();
    const aside = document.querySelector("aside")?.className ?? "";
    expect(aside).toContain("bg-[#FBFAF8]");
    expect(aside).toContain("dark:bg-[#0C0A1D]");
    expect(aside).not.toContain("bg-[#111318]");
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
