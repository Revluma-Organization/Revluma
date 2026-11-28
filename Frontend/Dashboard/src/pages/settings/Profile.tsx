import { useCallback, useEffect, useId, useRef, useState, type ChangeEvent, type FC, type FormEvent, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, AlertTriangle, Check, ChevronRight, Copy, Loader2, Lock, Pencil, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useAuthStore, type OrgMembership, type User } from "@/store/authStore";
import { api } from "@/lib/api";
import {
  NAME_MAX_LENGTH,
  apiErrorMessage,
  formatAccountDate,
  initialsFor,
  joinFullName,
  namesEqual,
  roleMetaFor,
  splitFullName,
  validateNamePart,
  type NameParts,
} from "@/lib/profileSettings";
import { settingsUi as ui } from "@/lib/settingsStyles";
import { cn } from "@/lib/utils";
import { ProfileHero } from "./components/profile/ProfileHero";
import { ProfileRow, ProfileSection } from "./components/profile/ProfileList";
import { ProfilePhotoDialog } from "./components/profile/ProfilePhotoDialog";
import { ChangePasswordForm } from "./components/ChangePasswordForm";
import { TwoFactorDisableDialog, TwoFactorSetupDialog } from "./components/TwoFactorDialogs";

interface ProfilePayload {
  id?: string;
  full_name?: string | null;
  email?: string | null;
  email_verified?: boolean;
  profile_picture_url?: string | null;
  two_factor_enabled?: boolean;
  created_at?: string | null;
  active_organization_id?: string | null;
  role?: string | null;
  organization_members?: OrgMembership[];
}

type LoadState = "loading" | "ready" | "error";

/** Patch the persisted auth user so the sidebar account menu updates at once. */
function patchAuthUser(patch: Partial<User>) {
  const { user, setUser } = useAuthStore.getState();
  if (user) setUser({ ...user, ...patch });
}

const actionLink = cn(ui.ghostButton, "h-8 px-2.5 text-ink");

const Profile: FC = () => {
  const storeUser = useAuthStore((s) => s.user);

  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [profile, setProfile] = useState<ProfilePayload | null>(null);

  // Name: read-first row, expands into an inline editor (click-to-edit).
  const [savedName, setSavedName] = useState<NameParts>(() => splitFullName(storeUser?.full_name));
  const [editingName, setEditingName] = useState(false);
  const [draft, setDraft] = useState<NameParts>(savedName);
  const [touched, setTouched] = useState({ firstName: false, lastName: false });
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const editingRef = useRef(editingName);
  editingRef.current = editingName;

  const [avatarUrl, setAvatarUrl] = useState<string | null>(storeUser?.profile_picture_url ?? null);
  const [photoOpen, setPhotoOpen] = useState(false);

  const [twoFactorEnabled, setTwoFactorEnabled] = useState<boolean>(Boolean(storeUser?.two_factor_enabled));
  const [setupOpen, setSetupOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [copiedId, setCopiedId] = useState(false);

  const firstNameRef = useRef<HTMLInputElement>(null);
  const lastNameRef = useRef<HTMLInputElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const formId = useId();
  const ids = {
    first: `${formId}-first`,
    last: `${formId}-last`,
    firstError: `${formId}-first-error`,
    lastError: `${formId}-last-error`,
  };

  const loadProfile = useCallback(async () => {
    setLoadState("loading");
    try {
      const res = await api.get<{ data?: ProfilePayload }>("/auth/me");
      const data = res.data?.data;
      if (!data) throw new Error("empty profile");
      setProfile(data);
      const serverName = splitFullName(data.full_name);
      setSavedName(serverName);
      // Never clobber an edit the user opened while the request was in flight.
      if (!editingRef.current) setDraft(serverName);
      setAvatarUrl(data.profile_picture_url ?? null);
      if (typeof data.two_factor_enabled === "boolean") setTwoFactorEnabled(data.two_factor_enabled);
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  // ── Name editing ─────────────────────────────────────────────────────────
  const dirty = editingName && !namesEqual(draft, savedName);
  const firstError = validateNamePart(draft.firstName, "First name");
  const lastError = validateNamePart(draft.lastName, "Last name");
  const showFirstError = Boolean(firstError) && (touched.firstName || submitted);
  const showLastError = Boolean(lastError) && (touched.lastName || submitted);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    if (editingName) firstNameRef.current?.focus();
  }, [editingName]);

  const startEditingName = () => {
    setDraft(savedName);
    setTouched({ firstName: false, lastName: false });
    setSubmitted(false);
    setSaveError(null);
    setEditingName(true);
  };

  const closeNameEditor = () => {
    setEditingName(false);
    setSaveError(null);
    window.requestAnimationFrame(() => editButtonRef.current?.focus());
  };

  const updateDraft = (field: keyof NameParts) => (event: ChangeEvent<HTMLInputElement>) => {
    setDraft((current) => ({ ...current, [field]: event.target.value }));
    setSaveError(null);
  };

  const handleEditorKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && !saving) {
      event.stopPropagation();
      closeNameEditor();
    }
  };

  const handleSaveName = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSubmitted(true);
    if (firstError || lastError) {
      (firstError ? firstNameRef : lastNameRef).current?.focus();
      return;
    }
    if (!dirty) {
      closeNameEditor();
      return;
    }
    const next = { firstName: draft.firstName.trim(), lastName: draft.lastName.trim() };
    setSaving(true);
    setSaveError(null);
    try {
      const res = await api.patch<{ data?: { full_name?: string } }>("/auth/profile", next);
      const fullName = res.data?.data?.full_name ?? joinFullName(next);
      setSavedName(splitFullName(fullName));
      patchAuthUser({ full_name: fullName });
      toast.success("Name updated");
      closeNameEditor();
    } catch (error) {
      setSaveError(apiErrorMessage(error, "We couldn't save your name. Try again."));
    } finally {
      setSaving(false);
    }
  };

  // ── Photo (dialog handles preview + confirm) ─────────────────────────────
  const uploadPhoto = async (file: File): Promise<string | null> => {
    const formData = new FormData();
    formData.append("image", file);
    try {
      const res = await api.put<{ data?: { profile_picture_url?: string | null } }>("/auth/profile/picture", formData);
      const uploaded = res.data?.data?.profile_picture_url ?? null;
      if (!uploaded) return "The upload finished but no photo came back. Try again.";
      setAvatarUrl(uploaded);
      patchAuthUser({ profile_picture_url: uploaded });
      toast.success("Profile photo updated");
      return null;
    } catch (error) {
      return apiErrorMessage(error, "We couldn't upload that photo. Try again.");
    }
  };

  const removePhoto = async (): Promise<string | null> => {
    try {
      await api.delete("/auth/profile/picture");
      setAvatarUrl(null);
      patchAuthUser({ profile_picture_url: null });
      toast.success("Profile photo removed");
      return null;
    } catch (error) {
      return apiErrorMessage(error, "We couldn't remove your photo. Try again.");
    }
  };

  // ── Derived identity / workspace facts (never invented) ─────────────────
  const email = profile?.email ?? storeUser?.email ?? "";
  const emailVerified = profile?.email_verified ?? storeUser?.email_verified;
  const userId = profile?.id ?? storeUser?.id ?? "";
  const memberSince = formatAccountDate(profile?.created_at ?? storeUser?.created_at);
  const memberships = profile?.organization_members ?? storeUser?.organization_memberships ?? [];
  const activeOrgId = profile?.active_organization_id ?? storeUser?.active_organization_id ?? storeUser?.tenant_id ?? null;
  const activeMembership = memberships.find((item) => item.organization_id === activeOrgId) ?? memberships[0];
  const rawRole = profile?.role && profile.role !== "unknown" ? profile.role : activeMembership?.role ?? storeUser?.role;
  const role = roleMetaFor(rawRole);
  const workspaceName = activeMembership?.organizations?.company_name ?? null;
  const otherWorkspaces = Math.max(0, memberships.length - 1);
  const joinedWorkspace = formatAccountDate(activeMembership?.joined_at);
  const fullName = joinFullName(savedName);
  const initials = initialsFor(fullName, email);

  const handleCopyId = async () => {
    if (!userId) return;
    try {
      await navigator.clipboard.writeText(userId);
      setCopiedId(true);
      window.setTimeout(() => setCopiedId(false), 2000);
    } catch {
      toast.error("Couldn't copy. Select the ID and copy it manually.");
    }
  };

  const nameEditor = (
    <form onSubmit={handleSaveName} onKeyDown={handleEditorKeyDown} noValidate aria-label="Edit name" className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor={ids.first} className={ui.fieldLabel}>First name</label>
          <input
            ref={firstNameRef}
            id={ids.first}
            name="firstName"
            autoComplete="given-name"
            maxLength={NAME_MAX_LENGTH}
            value={draft.firstName}
            onChange={updateDraft("firstName")}
            onBlur={() => setTouched((current) => ({ ...current, firstName: true }))}
            aria-invalid={showFirstError ? true : undefined}
            aria-describedby={showFirstError ? ids.firstError : undefined}
            className={ui.input}
          />
          {showFirstError ? (
            <p id={ids.firstError} className={ui.fieldError}><AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{firstError}</p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <label htmlFor={ids.last} className={ui.fieldLabel}>Last name</label>
          <input
            ref={lastNameRef}
            id={ids.last}
            name="lastName"
            autoComplete="family-name"
            maxLength={NAME_MAX_LENGTH}
            value={draft.lastName}
            onChange={updateDraft("lastName")}
            onBlur={() => setTouched((current) => ({ ...current, lastName: true }))}
            aria-invalid={showLastError ? true : undefined}
            aria-describedby={showLastError ? ids.lastError : undefined}
            className={ui.input}
          />
          {showLastError ? (
            <p id={ids.lastError} className={ui.fieldError}><AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{lastError}</p>
          ) : null}
        </div>
      </div>
      {saveError ? (
        <p role="alert" className={ui.fieldError}><AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{saveError}</p>
      ) : null}
      <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:items-center sm:justify-between">
        <p className={ui.helper}>Shown to teammates in activity, mentions and Rev conversations.</p>
        <div className="flex shrink-0 flex-col-reverse gap-2 sm:flex-row">
          <button type="button" onClick={closeNameEditor} disabled={saving} className={ui.secondaryButton}>Cancel</button>
          <button type="submit" disabled={saving || !dirty} className={ui.primaryButton}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {saving ? "Saving" : "Save"}
          </button>
        </div>
      </div>
    </form>
  );

  return (
    <div className="w-full min-w-0 space-y-8 pb-10">
      <header>
        <h1 className="text-[22px] font-semibold leading-8 tracking-[-0.02em] text-ink">Profile</h1>
        <p className="text-[13.5px] leading-5 text-ink-muted">Your identity across Revluma, and how you sign in.</p>
      </header>

      {loadState === "error" ? (
        <div role="alert" className="flex flex-col gap-3 rounded-xl border border-warning-line bg-warning-soft px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 text-[13px] font-medium text-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            We couldn't load your latest profile. You're seeing the details saved on this device.
          </p>
          <button type="button" onClick={() => void loadProfile()} className={cn(ui.secondaryButton, "h-8 self-start sm:self-auto")}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Retry
          </button>
        </div>
      ) : null}

      <ProfileHero
        name={fullName}
        email={email}
        emailVerified={emailVerified}
        avatarUrl={avatarUrl}
        initials={initials}
        role={role}
        workspaceName={workspaceName}
        otherWorkspaces={otherWorkspaces}
        memberSince={memberSince}
        onEditPhoto={() => setPhotoOpen(true)}
      />

      <ProfileSection id="profile-personal" title="Personal info" description="How you appear to your team.">
        <ProfileRow
          label="Name"
          testId="profile-row-name"
          editor={editingName ? nameEditor : undefined}
          action={
            <button ref={editButtonRef} type="button" onClick={startEditingName} className={actionLink} aria-label="Edit name">
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Edit
            </button>
          }
        >
          <span className="break-words font-medium" data-testid="profile-name-value">{fullName || "Not set"}</span>
        </ProfileRow>
        <ProfileRow
          label="Email"
          action={
            <span className="inline-flex items-center gap-1 px-2.5 text-[12.5px] text-ink-faint" title="Contact Revluma support to change your sign-in email">
              <Lock className="h-3.5 w-3.5" aria-hidden="true" /> Managed
            </span>
          }
        >
          <span className="break-all font-medium">{email || "No email on file"}</span>
          <span className="block text-[12.5px] leading-5 text-ink-muted">Your sign-in address. Contact Revluma support to change it.</span>
        </ProfileRow>
        <ProfileRow
          label="Photo"
          action={
            <button type="button" onClick={() => setPhotoOpen(true)} className={actionLink}>
              {avatarUrl ? "Change" : "Add"}
            </button>
          }
        >
          <span className="text-ink-soft">{avatarUrl ? "Custom photo" : `Showing your initials (${initials})`}</span>
        </ProfileRow>
      </ProfileSection>

      <ProfileSection id="profile-security" title="Sign-in & security" description="Applies to every workspace you belong to.">
        <ProfileRow
          label="Password"
          editor={changingPassword ? <ChangePasswordForm onCancel={() => setChangingPassword(false)} /> : undefined}
          action={<button type="button" onClick={() => setChangingPassword(true)} className={actionLink}>Change</button>}
        >
          <span className="text-ink-soft">Changing it signs you out of other devices.</span>
        </ProfileRow>
        <ProfileRow
          label="2-step verification"
          action={
            twoFactorEnabled ? (
              <button type="button" onClick={() => setDisableOpen(true)} className={cn(ui.dangerGhostButton, "h-8 px-2.5")}>Turn off</button>
            ) : (
              <button type="button" onClick={() => setSetupOpen(true)} className={cn(ui.secondaryButton, "h-8 px-3")}>
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> Set up
              </button>
            )
          }
        >
          <span data-testid="profile-2fa-status" className="flex items-start gap-2 sm:items-center">
            {twoFactorEnabled ? (
              <span className={cn(ui.badgeSuccess, "shrink-0")}><ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />On</span>
            ) : (
              <span className={cn(ui.badgeNeutral, "shrink-0")}>Off</span>
            )}
            <span className="text-ink-soft">{twoFactorEnabled ? "Authenticator app" : "Add a code from an authenticator app at sign-in."}</span>
          </span>
        </ProfileRow>
        <ProfileRow
          label="Active sessions"
          action={
            <Link to="/dashboard/settings/active-sessions" className={actionLink} aria-label="Manage sessions">
              Manage <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          }
        >
          <span className="text-ink-soft">See where you're signed in and sign out other devices.</span>
        </ProfileRow>
      </ProfileSection>

      <ProfileSection id="profile-account" title="Account details" description="Reference information for support and access.">
        <ProfileRow
          label="Permissions"
          action={
            <Link to="/dashboard/settings/roles" className={actionLink} aria-label="View roles and permissions">
              View roles <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          }
        >
          <span className="font-medium">{role.label}</span>
          <span className="block text-[12.5px] leading-5 text-ink-muted">{role.description}</span>
        </ProfileRow>
        <ProfileRow label="Workspaces">
          <span className="font-medium">{workspaceName ?? "No workspace selected"}</span>
          <span className="block text-[12.5px] leading-5 text-ink-muted">
            {[
              joinedWorkspace ? `Joined ${joinedWorkspace}` : null,
              otherWorkspaces > 0 ? `${otherWorkspaces} other workspace${otherWorkspaces === 1 ? "" : "s"}, switch from the sidebar account menu` : null,
            ].filter(Boolean).join(" · ") || "Your active workspace"}
          </span>
        </ProfileRow>
        <ProfileRow
          label="User ID"
          action={
            <button
              type="button"
              onClick={() => void handleCopyId()}
              disabled={!userId}
              className={actionLink}
              aria-label={copiedId ? "User ID copied" : "Copy user ID"}
            >
              {copiedId ? <Check className="h-3.5 w-3.5 text-success" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
              {copiedId ? "Copied" : "Copy"}
            </button>
          }
        >
          <code className="block truncate font-mono text-[13px] text-ink-soft" title={userId} data-testid="profile-user-id">{userId || "Unavailable"}</code>
        </ProfileRow>
      </ProfileSection>

      <ProfilePhotoDialog
        open={photoOpen}
        onOpenChange={setPhotoOpen}
        currentUrl={avatarUrl}
        initials={initials}
        onUpload={uploadPhoto}
        onRemove={removePhoto}
      />
      <TwoFactorSetupDialog
        open={setupOpen}
        onOpenChange={setSetupOpen}
        onEnabled={() => {
          setTwoFactorEnabled(true);
          patchAuthUser({ two_factor_enabled: true });
          toast.success("2-step verification is on");
        }}
      />
      <TwoFactorDisableDialog
        open={disableOpen}
        onOpenChange={setDisableOpen}
        onDisabled={() => {
          setTwoFactorEnabled(false);
          patchAuthUser({ two_factor_enabled: false });
          toast.success("2-step verification is off");
        }}
      />
    </div>
  );
};

export default Profile;
