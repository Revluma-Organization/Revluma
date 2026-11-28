/**
 * Pure helpers for Settings → Account → Profile.
 *
 * Limits mirror the backend contract exactly so the client never promises
 * something the API rejects:
 * - names: PATCH /auth/profile trims both parts, requires each, max 100 chars
 * - photo: PUT /auth/profile/picture (multer) accepts JPEG, PNG, WebP ≤ 5 MB
 */

export const NAME_MAX_LENGTH = 100;
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const AVATAR_ACCEPT = "image/png,image/jpeg,image/webp";
export const AVATAR_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const AVATAR_HINT = "Square image, at least 256 × 256 px. PNG, JPEG or WebP, up to 5 MB.";

export interface NameParts {
  firstName: string;
  lastName: string;
}

/** Splits a stored full name into the first token and everything after it. */
export function splitFullName(fullName: string | null | undefined): NameParts {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? "", lastName: parts.slice(1).join(" ") };
}

export function joinFullName({ firstName, lastName }: NameParts): string {
  return [firstName.trim(), lastName.trim()].filter(Boolean).join(" ");
}

/** Returns a user-facing error for one name field, or null when valid. */
export function validateNamePart(value: string, label: "First name" | "Last name"): string | null {
  const trimmed = value.trim();
  if (!trimmed) return `${label} is required.`;
  if (trimmed.length > NAME_MAX_LENGTH) return `${label} must be ${NAME_MAX_LENGTH} characters or fewer.`;
  return null;
}

export function namesEqual(a: NameParts, b: NameParts): boolean {
  return a.firstName.trim() === b.firstName.trim() && a.lastName.trim() === b.lastName.trim();
}

/** Returns a user-facing error for a chosen photo, or null when it can upload. */
export function validateAvatarFile(file: Pick<File, "type" | "size">): string | null {
  if (!(AVATAR_TYPES as readonly string[]).includes(file.type)) {
    return "Choose a PNG, JPEG or WebP image.";
  }
  if (file.size > AVATAR_MAX_BYTES) return "That image is larger than 5 MB. Choose a smaller file.";
  if (file.size === 0) return "That file is empty. Choose another image.";
  return null;
}

export function initialsFor(name: string | null | undefined, email?: string | null): string {
  const { firstName, lastName } = splitFullName(name);
  const initials = `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
  if (initials) return initials;
  return (email ?? "").trim().charAt(0).toUpperCase() || "?";
}

export type WorkspaceRole = "owner" | "admin" | "member";

export interface RoleMeta {
  role: WorkspaceRole;
  label: string;
  description: string;
}

/** Normalizes backend role strings ("Owner", "admin", "unknown") to a known role. */
export function roleMetaFor(role: string | null | undefined): RoleMeta {
  const normalized = (role ?? "").trim().toLowerCase();
  if (normalized === "owner") {
    return { role: "owner", label: "Owner", description: "Full control of the workspace, billing and members." };
  }
  if (normalized === "admin") {
    return { role: "admin", label: "Admin", description: "Can manage members, integrations and workspace settings." };
  }
  return { role: "member", label: "Member", description: "Ask a workspace owner if you need a different role." };
}

/** "March 4, 2026" for valid timestamps, null otherwise (never a fake date). */
export function formatAccountDate(value: string | null | undefined, locale?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", day: "numeric" }).format(date);
}

/**
 * Prefers the API's own `error` text (ApiError.message already carries it),
 * but falls back for 404/5xx where the raw message is not merchant-facing.
 */
export function apiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const status = (error as Error & { status?: unknown }).status;
    if (typeof status === "number" && (status === 404 || status >= 500)) return fallback;
    if (typeof status === "number" && error.message.trim()) return error.message;
  }
  return fallback;
}

export interface PasswordRequirement {
  id: "length" | "lower" | "upper" | "number" | "symbol";
  label: string;
  met: boolean;
}

/**
 * Mirrors validateChangePassword on the API: ≥ 8 chars with a lowercase,
 * uppercase, number and one of @ $ ! % * ? &.
 */
export function passwordRequirements(password: string): PasswordRequirement[] {
  return [
    { id: "length", label: "At least 8 characters", met: password.length >= 8 },
    { id: "lower", label: "A lowercase letter", met: /[a-z]/.test(password) },
    { id: "upper", label: "An uppercase letter", met: /[A-Z]/.test(password) },
    { id: "number", label: "A number", met: /\d/.test(password) },
    { id: "symbol", label: "One of @ $ ! % * ? &", met: /[@$!%*?&]/.test(password) },
  ];
}
