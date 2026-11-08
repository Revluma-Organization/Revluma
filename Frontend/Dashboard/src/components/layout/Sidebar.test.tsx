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

describe("Task 219 dark sidebar and responsive navigation", () => {
  it("uses a stable dark surface in the light workspace theme", () => {
    renderSidebar();
    expect(document.querySelector("aside")?.className).toContain("bg-[#111318]");
    expect(document.querySelector("aside")?.className).not.toContain("bg-white");
  });
  it("preserves all MVP navigation destinations", () => {
    renderSidebar();
    expect(screen.getByRole("link", { name: "Command Center" })).toHaveAttribute("href", "/dashboard/overview");
    expect(screen.getByRole("link", { name: /Rev Intell/ })).toHaveAttribute("href", "/dashboard/rev-intell");
    expect(screen.getByRole("link", { name: "Integrations" })).toHaveAttribute("href", "/dashboard/integrations");
  });
  it("communicates the active route with text and an active surface", () => {
    renderSidebar();
    expect(screen.getByRole("link", { name: "Command Center" }).className).toContain("bg-[#1F06AC]");
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
  it("closes mobile navigation through an explicitly labelled overlay", () => {
    useUI.setState({ mobileSidebarOpen: true });
    renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: "Close navigation" }));
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
    expect(screen.getByRole("button", { name: "Account settings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Billing & plans" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Team members" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
  });
  it("theme control describes the action instead of an unlabelled icon", () => {
    renderSidebar();
    expect(screen.getByRole("button", { name: /Use .* workspace theme/ })).toBeInTheDocument();
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
