import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useAuthStore } from "@/store/authStore";
import {
  passwordRequirements,
  roleMetaFor,
  splitFullName,
  validateAvatarFile,
  validateNamePart,
} from "@/lib/profileSettings";

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("@/lib/api", () => {
  class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
  return { api: apiMock, ApiError };
});

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import { ApiError } from "@/lib/api";
import Profile from "./Profile";

const profile = {
  id: "user-1",
  full_name: "Amina Bello",
  email: "amina@example.test",
  email_verified: true,
  profile_picture_url: null,
  two_factor_enabled: false,
  created_at: "2025-03-04T10:00:00Z",
  active_organization_id: "org-1",
  role: "owner",
  organization_members: [
    { id: "m1", role: "owner", organization_id: "org-1", joined_at: "2025-03-04T10:00:00Z", organizations: { id: "org-1", company_name: "Northwind Goods" } },
    { id: "m2", role: "admin", organization_id: "org-2", joined_at: null, organizations: { id: "org-2", company_name: "Harbor" } },
  ],
};

function seedStore() {
  useAuthStore.setState({
    user: {
      id: "user-1",
      email: "amina@example.test",
      full_name: "Amina Bello",
      role: "owner",
      tenant_id: "org-1",
      email_verified: true,
      onboarding_status: "completed",
    },
  });
}

function renderProfile() {
  return render(
    <MemoryRouter>
      <Profile />
    </MemoryRouter>,
  );
}

async function renderLoaded() {
  renderProfile();
  await waitFor(() => expect(screen.getByTestId("profile-workspace")).toHaveTextContent("Northwind Goods"));
}

describe("profile settings helpers", () => {
  it("splits names on the first token and mirrors backend name limits", () => {
    expect(splitFullName("  Mary  Ann   Smith ")).toEqual({ firstName: "Mary", lastName: "Ann Smith" });
    expect(splitFullName(null)).toEqual({ firstName: "", lastName: "" });
    expect(validateNamePart("   ", "First name")).toBe("First name is required.");
    expect(validateNamePart("x".repeat(101), "Last name")).toMatch(/100 characters/);
    expect(validateNamePart("Ada", "First name")).toBeNull();
  });

  it("accepts exactly the photo types and size the upload API accepts", () => {
    expect(validateAvatarFile({ type: "image/png", size: 1024 })).toBeNull();
    expect(validateAvatarFile({ type: "image/webp", size: 5 * 1024 * 1024 })).toBeNull();
    expect(validateAvatarFile({ type: "image/gif", size: 1024 })).toMatch(/PNG, JPEG or WebP/);
    expect(validateAvatarFile({ type: "image/jpeg", size: 5 * 1024 * 1024 + 1 })).toMatch(/5 MB/);
  });

  it("normalizes roles and password rules", () => {
    expect(roleMetaFor("Owner").label).toBe("Owner");
    expect(roleMetaFor("unknown").label).toBe("Member");
    expect(passwordRequirements("Abcdef1!").every((rule) => rule.met)).toBe(true);
    expect(passwordRequirements("Abcdef1#").find((rule) => rule.id === "symbol")?.met).toBe(false);
  });
});

describe("Profile settings page", () => {
  beforeEach(() => {
    Object.values(apiMock).forEach((fn) => fn.mockReset());
    apiMock.get.mockResolvedValue({ data: { success: true, data: profile } });
    seedStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders enterprise sections with real account facts and no close button", async () => {
    await renderLoaded();
    expect(apiMock.get).toHaveBeenCalledWith("/auth/me");
    expect(screen.getByRole("heading", { level: 1, name: "Profile" })).toBeInTheDocument();
    for (const name of ["Personal information", "Workspace access", "Sign-in & security", "Account"]) {
      expect(screen.getByRole("heading", { level: 2, name })).toBeInTheDocument();
    }
    expect(screen.getByTestId("profile-email")).toHaveTextContent("amina@example.test");
    expect(screen.getByText("Verified")).toBeInTheDocument();
    expect(screen.getByTestId("profile-role")).toHaveTextContent("Owner");
    expect(screen.getByText(/1 other workspace\b/)).toBeInTheDocument();
    expect(screen.getByTestId("profile-user-id")).toHaveTextContent("user-1");
    expect(screen.getByText("PNG, JPEG or WebP, up to 5 MB.", { exact: false })).toBeInTheDocument();
    expect(screen.queryByText(/GIF/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /close/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Manage sessions/ })).toHaveAttribute("href", "/dashboard/settings/active-sessions");
  });

  it("keeps Save disabled until the name changes, validates on blur, and discards", async () => {
    await renderLoaded();
    const save = screen.getByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled();
    const first = screen.getByLabelText("First name");
    fireEvent.change(first, { target: { value: "  " } });
    fireEvent.blur(first);
    expect(screen.getByText("First name is required.")).toBeInTheDocument();
    expect(first).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("You have unsaved changes.")).toBeInTheDocument();

    fireEvent.click(save);
    expect(apiMock.patch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(first).toHaveValue("Amina");
    expect(save).toBeDisabled();
  });

  it("saves trimmed names and syncs the sidebar user", async () => {
    apiMock.patch.mockResolvedValue({ data: { data: { full_name: "Amina Okafor" } } });
    await renderLoaded();
    fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "  Okafor " } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/auth/profile", { firstName: "Amina", lastName: "Okafor" }));
    await waitFor(() => expect(screen.getByText("All changes saved.")).toBeInTheDocument());
    expect(useAuthStore.getState().user?.full_name).toBe("Amina Okafor");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("surfaces the API's save error instead of failing silently", async () => {
    apiMock.patch.mockRejectedValue(new ApiError(400, "Name is too long."));
    await renderLoaded();
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Ami" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Name is too long.")).toBeInTheDocument();
  });

  it("rejects unsupported photos client-side and uploads valid ones", async () => {
    const createUrl = vi.fn(() => "blob:preview");
    Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: vi.fn() });
    apiMock.put.mockResolvedValue({ data: { data: { profile_picture_url: "https://cdn.example.test/a.png" } } });
    await renderLoaded();
    const input = screen.getByTestId("profile-photo-input");

    fireEvent.change(input, { target: { files: [new File(["x"], "a.gif", { type: "image/gif" })] } });
    expect(await screen.findByText("Choose a PNG, JPEG or WebP image.")).toBeInTheDocument();
    expect(apiMock.put).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { files: [new File(["x"], "a.png", { type: "image/png" })] } });
    await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/auth/profile/picture", expect.any(FormData)));
    await waitFor(() => expect(useAuthStore.getState().user?.profile_picture_url).toBe("https://cdn.example.test/a.png"));
    expect(screen.getByRole("button", { name: "Replace photo" })).toBeInTheDocument();
  });

  it("removes the photo through the API and keeps it when removal fails", async () => {
    apiMock.get.mockResolvedValue({ data: { data: { ...profile, profile_picture_url: "https://cdn.example.test/a.png" } } });
    apiMock.delete.mockRejectedValueOnce(new ApiError(500, "boom")).mockResolvedValueOnce({ data: {} });
    await renderLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(await screen.findByText("We couldn't remove your photo. Try again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Upload photo" })).toBeInTheDocument());
    expect(apiMock.delete).toHaveBeenCalledWith("/auth/profile/picture");
  });

  it("confirms before turning off 2FA", async () => {
    apiMock.get.mockResolvedValue({ data: { data: { ...profile, two_factor_enabled: true } } });
    apiMock.post.mockResolvedValue({ data: {} });
    await renderLoaded();
    expect(screen.getByTestId("profile-2fa-status")).toHaveTextContent("Enabled");

    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(apiMock.post).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Turn off" }));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/auth/2fa/disable"));
    await waitFor(() => expect(screen.getByTestId("profile-2fa-status")).toHaveTextContent("Off"));
  });

  it("enables 2FA only after a verified code and shows verification errors", async () => {
    apiMock.post.mockImplementation(async (path: string) => {
      if (path === "/auth/2fa/setup") return { data: { qrCode: "data:image/png;base64,AAAA", secret: "JBSWY3DPEHPK3PXP" } };
      if (path === "/auth/2fa/verify") throw new ApiError(400, "Invalid verification code");
      return { data: {} };
    });
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: /Set up 2FA/ }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("JBSW Y3DP EHPK 3PXP")).toBeInTheDocument();

    const code = within(dialog).getByLabelText("2. Enter the 6-digit code");
    fireEvent.change(code, { target: { value: "12a3456" } });
    expect(code).toHaveValue("123456");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Verify and enable" }));
    });
    expect(await within(dialog).findByText("Invalid verification code")).toBeInTheDocument();
    expect(screen.getByTestId("profile-2fa-status")).toHaveTextContent("Off");
  });

  it("falls back to cached details with a retry when the profile request fails", async () => {
    apiMock.get.mockRejectedValueOnce(new Error("offline"));
    renderProfile();
    expect(await screen.findByText(/couldn't load your latest profile/)).toBeInTheDocument();
    expect(screen.getByLabelText("First name")).toHaveValue("Amina");
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    await waitFor(() => expect(screen.getByTestId("profile-workspace")).toHaveTextContent("Northwind Goods"));
  });

  it("shows the password rules the API enforces", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    const rules = screen.getByRole("list", { name: "Password requirements" });
    expect(within(rules).getAllByRole("listitem")).toHaveLength(5);
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "Abcdef1!" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "nope" } });
    expect(screen.getByText("Passwords don't match.")).toBeInTheDocument();
  });
});
