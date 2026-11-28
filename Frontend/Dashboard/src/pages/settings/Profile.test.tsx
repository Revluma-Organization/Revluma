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
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:preview"), revokeObjectURL: vi.fn() });
    seedStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("leads with a centred identity header, then read-first sections", async () => {
    await renderLoaded();
    expect(apiMock.get).toHaveBeenCalledWith("/auth/me");
    expect(screen.getByRole("heading", { level: 1, name: "Profile" })).toBeInTheDocument();
    expect(screen.getByTestId("profile-hero-name")).toHaveTextContent("Amina Bello");
    expect(screen.getByTestId("profile-hero-avatar")).toHaveAccessibleName("Add profile photo");
    expect(screen.getByTestId("profile-email")).toHaveTextContent("amina@example.test");
    expect(screen.getByText("Verified")).toBeInTheDocument();
    expect(screen.getByTestId("profile-role")).toHaveTextContent("Owner");
    expect(screen.getByTestId("profile-workspace")).toHaveTextContent("+1");
    expect(screen.getByText("March 4, 2025")).toBeInTheDocument();
    for (const name of ["Personal info", "Sign-in & security", "Account details"]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
    // Read-first: no editable inputs and no global save bar until the user asks to edit.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Save changes/ })).not.toBeInTheDocument();
    expect(screen.getByTestId("profile-name-value")).toHaveTextContent("Amina Bello");
    expect(screen.getByText(/1 other workspace\b/)).toBeInTheDocument();
    expect(screen.getByTestId("profile-user-id")).toHaveTextContent("user-1");
    expect(screen.getByRole("link", { name: "Manage sessions" })).toHaveAttribute("href", "/dashboard/settings/active-sessions");
  });

  it("edits the name inline, validates, and cancels with Escape", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Edit name" }));
    const first = screen.getByLabelText("First name");
    expect(first).toHaveValue("Amina");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    fireEvent.change(first, { target: { value: "  " } });
    fireEvent.blur(first);
    expect(screen.getByText("First name is required.")).toBeInTheDocument();
    expect(first).toHaveAttribute("aria-invalid", "true");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(apiMock.patch).not.toHaveBeenCalled();

    fireEvent.keyDown(first, { key: "Escape" });
    expect(screen.queryByLabelText("First name")).not.toBeInTheDocument();
    expect(screen.getByTestId("profile-name-value")).toHaveTextContent("Amina Bello");

    fireEvent.click(screen.getByRole("button", { name: "Edit name" }));
    expect(screen.getByLabelText("First name")).toHaveValue("Amina");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("First name")).not.toBeInTheDocument();
  });

  it("saves trimmed names, closes the editor and syncs the sidebar user", async () => {
    apiMock.patch.mockResolvedValue({ data: { data: { full_name: "Amina Okafor" } } });
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Edit name" }));
    fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "  Okafor " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/auth/profile", { firstName: "Amina", lastName: "Okafor" }));
    await waitFor(() => expect(screen.queryByLabelText("Last name")).not.toBeInTheDocument());
    expect(screen.getByTestId("profile-name-value")).toHaveTextContent("Amina Okafor");
    expect(screen.getByTestId("profile-hero-name")).toHaveTextContent("Amina Okafor");
    expect(useAuthStore.getState().user?.full_name).toBe("Amina Okafor");
  });

  it("keeps the editor open with the API's error when saving fails", async () => {
    apiMock.patch.mockRejectedValue(new ApiError(400, "Name is too long."));
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Edit name" }));
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Ami" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Name is too long.");
    expect(screen.getByLabelText("First name")).toHaveValue("Ami");
  });

  it("previews a photo in the dialog and uploads only after Save photo", async () => {
    apiMock.put.mockResolvedValue({ data: { data: { profile_picture_url: "https://cdn.example.test/a.png" } } });
    await renderLoaded();
    fireEvent.click(screen.getByTestId("profile-hero-avatar"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("button", { name: /Remove photo/ })).not.toBeInTheDocument();
    const input = within(dialog).getByTestId("profile-photo-input");

    fireEvent.change(input, { target: { files: [new File(["x"], "a.gif", { type: "image/gif" })] } });
    expect(await within(dialog).findByText("Choose a PNG, JPEG or WebP image.")).toBeInTheDocument();

    fireEvent.change(input, { target: { files: [new File(["x"], "a.png", { type: "image/png" })] } });
    const save = await within(dialog).findByRole("button", { name: "Save photo" });
    expect(apiMock.put).not.toHaveBeenCalled();
    fireEvent.click(save);
    await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/auth/profile/picture", expect.any(FormData)));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(useAuthStore.getState().user?.profile_picture_url).toBe("https://cdn.example.test/a.png");
    expect(screen.getByTestId("profile-hero-avatar")).toHaveAccessibleName("Change profile photo");
  });

  it("removes the photo from the dialog and keeps it when removal fails", async () => {
    apiMock.get.mockResolvedValue({ data: { data: { ...profile, profile_picture_url: "https://cdn.example.test/a.png" } } });
    apiMock.delete.mockRejectedValueOnce(new ApiError(500, "boom")).mockResolvedValueOnce({ data: {} });
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Change profile photo" }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.click(within(dialog).getByRole("button", { name: /Remove photo/ }));
    expect(await within(dialog).findByText("We couldn't remove your photo. Try again.")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: /Remove photo/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(apiMock.delete).toHaveBeenCalledWith("/auth/profile/picture");
    expect(screen.getByText("Showing your initials (AB)")).toBeInTheDocument();
  });

  it("confirms before turning off 2-step verification", async () => {
    apiMock.get.mockResolvedValue({ data: { data: { ...profile, two_factor_enabled: true } } });
    apiMock.post.mockResolvedValue({ data: {} });
    await renderLoaded();
    expect(screen.getByTestId("profile-2fa-status")).toHaveTextContent("On");

    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(apiMock.post).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Turn off" }));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/auth/2fa/disable"));
    await waitFor(() => expect(screen.getByTestId("profile-2fa-status")).toHaveTextContent("Off"));
  });

  it("enables 2-step verification only after a verified code", async () => {
    apiMock.post.mockImplementation(async (path: string) => {
      if (path === "/auth/2fa/setup") return { data: { qrCode: "data:image/png;base64,AAAA", secret: "JBSWY3DPEHPK3PXP" } };
      if (path === "/auth/2fa/verify") throw new ApiError(400, "Invalid verification code");
      return { data: {} };
    });
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: /Set up/ }));
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
    expect(screen.getByTestId("profile-name-value")).toHaveTextContent("Amina Bello");
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    await waitFor(() => expect(screen.getByTestId("profile-workspace")).toHaveTextContent("Northwind Goods"));
  });

  it("expands the password form inline with the API's rules", async () => {
    await renderLoaded();
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    const rules = screen.getByRole("list", { name: "Password requirements" });
    expect(within(rules).getAllByRole("listitem")).toHaveLength(5);
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "Abcdef1!" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "nope" } });
    expect(screen.getByText("Passwords don't match.")).toBeInTheDocument();
  });
});
