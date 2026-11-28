import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import SettingsLayout, { SettingsIndex } from "./SettingsLayout";

const authUser = vi.hoisted(() => ({ role: "owner" }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: authUser, logout: vi.fn() }) }));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/dashboard/settings" element={<SettingsLayout />}>
          <Route index element={<SettingsIndex />} />
          <Route path="profile" element={<p>Profile page</p>} />
          <Route path="subscription" element={<p>Plan page</p>} />
          <Route path="invoice-history" element={<p>Invoices page</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

function mockViewport(desktop: boolean) {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: desktop, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
}

describe("Settings content frame", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); authUser.role = "owner"; });

  it("renders no second sidebar", () => {
    renderAt("/dashboard/settings/profile");
    expect(screen.getByText("Profile page")).toBeInTheDocument();
    expect(document.querySelector("aside")).toBeNull();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("turns the four billing pages into tabs under one Billing entry", () => {
    renderAt("/dashboard/settings/subscription");
    const tabs = screen.getByRole("navigation", { name: "Billing" });
    expect(tabs).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Plan" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("href", "/dashboard/settings/billing");
    cleanup();
    renderAt("/dashboard/settings/invoice-history");
    expect(screen.getByRole("link", { name: "Invoices" })).toHaveAttribute("aria-current", "page");
  });

  it("opens Profile on desktop and a grouped index on phones", () => {
    mockViewport(true);
    renderAt("/dashboard/settings");
    expect(screen.getByText("Profile page")).toBeInTheDocument();
    cleanup();
    mockViewport(false);
    authUser.role = "member";
    renderAt("/dashboard/settings");
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Profile/ })).toHaveAttribute("href", "/dashboard/settings/profile");
    expect(screen.queryByRole("link", { name: /Billing/ })).not.toBeInTheDocument();
  });
});
