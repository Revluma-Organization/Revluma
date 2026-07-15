import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ProtectedRoute } from "./ProtectedRoute";
import { useAuthStore } from "@/store/authStore";
import { LOGIN_PATH } from "@/lib/auth/constants";

describe("ProtectedRoute", () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: null,
      csrfToken: null,
      isHydrated: true,
      loading: false,
      error: null,
    });
  });

  it("renders children when authenticated", () => {
    useAuthStore.setState({
      user: {
        id: "1",
        email: "a@b.com",
        full_name: "Ada",
        role: "admin",
        tenant_id: "t1",
        email_verified: true,
        onboarding_status: "completed",
      },
      csrfToken: "token",
      isHydrated: true,
    });

    render(
      <MemoryRouter>
        <ProtectedRoute>
          <div>Secret dashboard</div>
        </ProtectedRoute>
      </MemoryRouter>,
    );

    expect(screen.getByText("Secret dashboard")).toBeInTheDocument();
  });

  it("redirects unauthenticated users to login", () => {
    const replace = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        pathname: "/dashboard/overview",
        search: "",
        replace,
      },
    });

    render(
      <MemoryRouter initialEntries={["/dashboard/overview"]}>
        <ProtectedRoute>
          <div>Secret dashboard</div>
        </ProtectedRoute>
      </MemoryRouter>,
    );

    expect(screen.queryByText("Secret dashboard")).toBeNull();
    expect(replace).toHaveBeenCalledWith(
      expect.stringContaining(LOGIN_PATH),
    );
  });

  it("does not flash protected content while hydrating", () => {
    useAuthStore.setState({ isHydrated: false, user: null, csrfToken: null });

    render(
      <MemoryRouter>
        <ProtectedRoute>
          <div>Secret dashboard</div>
        </ProtectedRoute>
      </MemoryRouter>,
    );

    expect(screen.queryByText("Secret dashboard")).toBeNull();
    expect(screen.getByLabelText("Loading session")).toBeInTheDocument();
  });
});
