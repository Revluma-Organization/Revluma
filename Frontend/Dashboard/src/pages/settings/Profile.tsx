import { useCallback, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type FC, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  AlertTriangle,
  BadgeCheck,
  Camera,
  Check,
  ChevronRight,
  Copy,
  Crown,
  Loader2,
  RefreshCw,
  Shield,
  ShieldCheck,
  User as UserIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useAuthStore, type OrgMembership, type User } from "@/store/authStore";
import { api } from "@/lib/api";
import {
  AVATAR_ACCEPT,
  AVATAR_HINT,
  NAME_MAX_LENGTH,
  apiErrorMessage,
  formatAccountDate,
  initialsFor,
  joinFullName,
  namesEqual,
  roleMetaFor,
  splitFullName,
  validateAvatarFile,
  validateNamePart,
  type NameParts,
} from "@/lib/profileSettings";
import { settingsUi as ui } from "@/lib/settingsStyles";
import { cn } from "@/lib/utils";
import { SettingsRow, SettingsSection } from "./components/SettingsSection";
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
type AvatarBusy = "upload" | "remove" | null;

/** Patch the persisted auth user so the sidebar account menu updates at once. */
function patchAuthUser(patch: Partial<User>) {
  const { user, setUser } = useAuthStore.getState();
  if (user) setUser({ ...user, ...patch });
}

const RoleIcon: FC<{ role: string; className?: string }> = ({ role, className }) => {
  if (role === "owner") return <Crown className={className} aria-hidden="true" />;
  if (role === "admin") return <Shield className={className} aria-hidden="true" />;
  return <UserIcon className={className} aria-hidden="true" />;
};

const Profile: FC = () => {
  const storeUser = useAuthStore((s) => s.user);
  const initialName = useMemo(() => splitFullName(storeUser?.full_name), [storeUser?.full_name]);

  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [profile, setProfile] = useState<ProfilePayload | null>(null);

  // Name form: `saved` is the server baseline, `draft` what the user typed.
  const [savedName, setSavedName] = useState<NameParts>(initialName);
  const [draft, setDraft] = useState<NameParts>(initialName);
  const [touched, setTouched] = useState({ firstName: false, lastName: false });
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const draftRef = useRef(draft);
  const savedRef = useRef(savedName);
  draftRef.current = draft;
  savedRef.current = savedName;

  const [avatarUrl, setAvatarUrl] = useState<string | null>(storeUser?.profile_picture_url ?? null);
  const [avatarBusy, setAvatarBusy] = useState<AvatarBusy>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const objectUrlRef = useRef<string | null>(null);

  const [twoFactorEnabled, setTwoFactorEnabled] = useState<boolean>(Boolean(storeUser?.two_factor_enabled));
  const [setupOpen, setSetupOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [copiedId, setCopiedId] = useState(false);

  const firstNameRef = useRef<HTMLInputElement>(null);
  const lastNameRef = useRef<HTMLInputElement>(null);
  const formId = useId();
  const ids = {
    first: `${formId}-first`,
    last: `${formId}-last`,
    firstError: `${formId}-first-error`,
    lastError: `${formId}-last-error`,
    nameLabel: `${formId}-name-label`,
    photoHint: `${formId}-photo-hint`,
  };

  const loadProfile = useCallback(async () => {
    setLoadState("loading");
    try {
      const res = await api.get<{ data?: ProfilePayload }>("/auth/me");
      const data = res.data?.data;
      if (!data) throw new Error("empty profile");
      setProfile(data);
      const serverName = splitFullName(data.full_name);
      // Never clobber edits the user started while the request was in flight.
      if (namesEqual(draftRef.current, savedRef.current)) setDraft(serverName);
      setSavedName(serverName);
      if (!objectUrlRef.current) setAvatarUrl(data.profile_picture_url ?? null);
      if (typeof data.two_factor_enabled === "boolean") setTwoFactorEnabled(data.two_factor_enabled);
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
  }, []);

  // ── Name form ────────────────────────────────────────────────────────────
  const dirty = !namesEqual(draft, savedName);
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
    if (!justSaved) return;
    const timer = window.setTimeout(() => setJustSaved(false), 4000);
    return () => window.clearTimeout(timer);
  }, [justSaved]);

  const updateDraft = (field: keyof NameParts) => (event: ChangeEvent<HTMLInputElement>) => {
    setDraft((current) => ({ ...current, [field]: event.target.value }));
    setSaveError(null);
    setJustSaved(false);
  };

  const discardChanges = () => {
    setDraft(savedName);
    setTouched({ firstName: false, lastName: false });
    setSubmitted(false);
    setSaveError(null);
  };

  const handleSaveName = async (event: FormEvent) => {
    event.preventDefault();
    if (!dirty || saving) return;
    setSubmitted(true);
    if (firstError || lastError) {
      (firstError ? firstNameRef : lastNameRef).current?.focus();
      return;
    }
    const next = { firstName: draft.firstName.trim(), lastName: draft.lastName.trim() };
    setSaving(true);
    setSaveError(null);
    try {
      const res = await api.patch<{ data?: { full_name?: string } }>("/auth/profile", next);
      const fullName = res.data?.data?.full_name ?? joinFullName(next);
      const confirmed = splitFullName(fullName);
      setSavedName(confirmed);
      setDraft(confirmed);
      setTouched({ firstName: false, lastName: false });
      setSubmitted(false);
      setJustSaved(true);
      patchAuthUser({ full_name: fullName });
      toast.success("Profile updated");
    } catch (error) {
      setSaveError(apiErrorMessage(error, "We couldn't save your name. Try again."));
    } finally {
      setSaving(false);
    }
  };

  // ── Photo ────────────────────────────────────────────────────────────────
  const releaseObjectUrl = () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const invalid = validateAvatarFile(file);
    if (invalid) {
      setAvatarError(invalid);
      return;
    }
    const previous = avatarUrl;
    releaseObjectUrl();
    const preview = URL.createObjectURL(file);
    objectUrlRef.current = preview;
    setAvatarUrl(preview);
    setAvatarError(null);
    setAvatarBusy("upload");
    const formData = new FormData();
    formData.append("image", file);
    try {
      const res = await api.put<{ data?: { profile_picture_url?: string | null } }>("/auth/profile/picture", formData);
      const uploaded = res.data?.data?.profile_picture_url ?? null;
      if (uploaded) {
        releaseObjectUrl();
        setAvatarUrl(uploaded);
      }
      patchAuthUser({ profile_picture_url: uploaded ?? previous });
      toast.success("Profile photo updated");
    } catch (error) {
      releaseObjectUrl();
      setAvatarUrl(previous);
      setAvatarError(apiErrorMessage(error, "We couldn't upload that photo. Try again."));
    } finally {
      setAvatarBusy(null);
    }
  };

  const handleRemovePhoto = async () => {
    if (!avatarUrl || avatarBusy) return;
    setAvatarBusy("remove");
    setAvatarError(null);
    try {
      await api.delete("/auth/profile/picture");
      releaseObjectUrl();
      setAvatarUrl(null);
      patchAuthUser({ profile_picture_url: null });
      toast.success("Profile photo removed");
    } catch (error) {
      setAvatarError(apiErrorMessage(error, "We couldn't remove your photo. Try again."));
    } finally {
      setAvatarBusy(null);
    }
  };

  const openFilePicker = () => {
    if (!avatarBusy) fileInputRef.current?.click();
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
  const initials = initialsFor(joinFullName(savedName), email);

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

  const footerStatus = saving
    ? "Saving your changes…"
    : saveError
      ? null
      : dirty
        ? "You have unsaved changes."
        : justSaved
          ? "All changes saved."
          : "Photo changes save as soon as you upload.";

  return (
    <div className="w-full min-w-0 space-y-6 pb-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-[22px] font-semibold leading-8 tracking-[-0.02em] text-ink">Profile</h1>
        <p className="text-[13.5px] leading-5 text-ink-muted">
          Manage your personal details, how you sign in, and how teammates see you across Revluma.
        </p>
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

      {/* ── Personal information ─────────────────────────────────────── */}
      <form onSubmit={handleSaveName} noValidate aria-label="Personal information">
        <SettingsSection
          id="profile-personal"
          title="Personal information"
          description="This is how you appear to teammates in activity, mentions and Rev conversations."
          footer={
            <>
              <p className="flex min-h-5 items-center gap-2 text-[12.5px] text-ink-muted" aria-live="polite">
                {saveError ? (
                  <span role="alert" className="flex items-center gap-1.5 font-medium text-danger">
                    <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />{saveError}
                  </span>
                ) : (
                  <>
                    {dirty && !saving ? <span className="h-1.5 w-1.5 rounded-full bg-warning-strong" aria-hidden="true" /> : null}
                    {justSaved && !dirty ? <Check className="h-3.5 w-3.5 text-success" aria-hidden="true" /> : null}
                    {footerStatus}
                  </>
                )}
              </p>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                {dirty ? (
                  <button type="button" onClick={discardChanges} disabled={saving} className={ui.ghostButton}>Discard</button>
                ) : null}
                <button type="submit" disabled={!dirty || saving} className={ui.primaryButton}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                  {saving ? "Saving" : "Save changes"}
                </button>
              </div>
            </>
          }
        >
          <SettingsRow label="Profile photo" description="A clear, recognizable photo helps teammates know who did what.">
            <div className="flex items-start gap-4">
              <button
                type="button"
                onClick={openFilePicker}
                disabled={Boolean(avatarBusy)}
                aria-label={avatarUrl ? "Change profile photo" : "Upload profile photo"}
                aria-describedby={ids.photoHint}
                className={cn(
                  "group relative h-16 w-16 shrink-0 cursor-pointer overflow-hidden rounded-full border border-line bg-brand-soft disabled:cursor-progress",
                  ui.focusRing,
                  "focus-visible:rounded-full",
                )}
              >
                {avatarUrl ? (
                  <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-[20px] font-semibold tracking-[-0.02em] text-brand-deep" aria-hidden="true">
                    {initials}
                  </span>
                )}
                <span
                  className={cn(
                    "absolute inset-0 flex items-center justify-center bg-black/45 text-white transition-opacity",
                    avatarBusy ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
                  )}
                  aria-hidden="true"
                >
                  {avatarBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
                </span>
              </button>
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={openFilePicker} disabled={Boolean(avatarBusy)} className={ui.secondaryButton}>
                    {avatarBusy === "upload" ? "Uploading…" : avatarUrl ? "Replace photo" : "Upload photo"}
                  </button>
                  {avatarUrl ? (
                    <button type="button" onClick={() => void handleRemovePhoto()} disabled={Boolean(avatarBusy)} className={ui.dangerGhostButton}>
                      {avatarBusy === "remove" ? "Removing…" : "Remove"}
                    </button>
                  ) : null}
                </div>
                <p id={ids.photoHint} className={ui.helper}>{AVATAR_HINT}</p>
                {avatarError ? (
                  <p role="alert" className={ui.fieldError}><AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{avatarError}</p>
                ) : null}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept={AVATAR_ACCEPT}
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
                data-testid="profile-photo-input"
                onChange={(event) => void handleFileChange(event)}
              />
            </div>
          </SettingsRow>

          <SettingsRow label="Full name" labelId={ids.nameLabel} description="Use the name your team knows you by.">
            <div role="group" aria-labelledby={ids.nameLabel} className="grid gap-3 sm:grid-cols-2">
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
          </SettingsRow>

          <SettingsRow label="Email address" description="Used to sign in and for account notifications.">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                <span className="min-w-0 break-all text-[14px] font-medium text-ink" data-testid="profile-email">
                  {email || "No email on file"}
                </span>
                {emailVerified === true ? (
                  <span className={ui.badgeSuccess}><BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />Verified</span>
                ) : emailVerified === false ? (
                  <span className={ui.badgeWarning}><AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />Not verified</span>
                ) : null}
              </div>
              <p className={ui.helper}>To move your account to a different address, contact Revluma support.</p>
            </div>
          </SettingsRow>
        </SettingsSection>
      </form>

      {/* ── Workspace access ─────────────────────────────────────────── */}
      <SettingsSection
        id="profile-workspace"
        title="Workspace access"
        description="Your membership and permissions in the workspace you're working in."
        aside={
          <Link to="/dashboard/settings/roles" className={cn(ui.textLink, "inline-flex items-center gap-0.5")}>
            Roles & permissions <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        }
      >
        <SettingsRow label="Workspace">
          <div className="flex flex-col gap-0.5">
            <span className="text-[14px] font-medium leading-5 text-ink" data-testid="profile-workspace">{workspaceName ?? "No workspace selected"}</span>
            {otherWorkspaces > 0 ? (
              <span className={ui.helper}>
                You belong to {otherWorkspaces} other workspace{otherWorkspaces === 1 ? "" : "s"}. Switch workspaces from the account menu in the sidebar.
              </span>
            ) : null}
          </div>
        </SettingsRow>
        <SettingsRow label="Role" description={role.description}>
          <div className="flex items-center">
            <span className={role.role === "member" ? ui.badgeNeutral : ui.badgeBrand} data-testid="profile-role">
              <RoleIcon role={role.role} className="h-3.5 w-3.5" />
              {role.label}
            </span>
          </div>
        </SettingsRow>
        {joinedWorkspace ? (
          <SettingsRow label="Joined workspace">
            <div className="text-[14px] leading-5 text-ink">{joinedWorkspace}</div>
          </SettingsRow>
        ) : null}
      </SettingsSection>

      {/* ── Sign-in & security ───────────────────────────────────────── */}
      <SettingsSection
        id="profile-security"
        title="Sign-in & security"
        description="Keep your account protected. Changes here apply to every workspace you belong to."
      >
        <SettingsRow label="Password" description="Changing your password signs you out of every other device.">
          {changingPassword ? (
            <ChangePasswordForm onCancel={() => setChangingPassword(false)} />
          ) : (
            <div className="flex min-h-[38px] flex-wrap items-center justify-between gap-3">
              <span className={ui.helper}>Use a strong password you don't use anywhere else.</span>
              <button type="button" onClick={() => setChangingPassword(true)} className={ui.secondaryButton}>Change password</button>
            </div>
          )}
        </SettingsRow>

        <SettingsRow label="Two-factor authentication" description="Require a code from your authenticator app each time you sign in.">
          <div className="flex min-h-[38px] flex-wrap items-center justify-between gap-3">
            {twoFactorEnabled ? (
              <span className={ui.badgeSuccess} data-testid="profile-2fa-status"><ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />Enabled · Authenticator app</span>
            ) : (
              <span className={ui.badgeNeutral} data-testid="profile-2fa-status">Off</span>
            )}
            {twoFactorEnabled ? (
              <button type="button" onClick={() => setDisableOpen(true)} className={ui.dangerGhostButton}>Turn off</button>
            ) : (
              <button type="button" onClick={() => setSetupOpen(true)} className={ui.secondaryButton}>
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> Set up 2FA
              </button>
            )}
          </div>
        </SettingsRow>

        <SettingsRow label="Active sessions" description="Review the devices signed in to your account and sign out any you don't recognize.">
          <div className="flex min-h-[38px] items-center sm:justify-end">
            <Link to="/dashboard/settings/active-sessions" className={ui.secondaryButton}>
              Manage sessions <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
        </SettingsRow>
      </SettingsSection>

      {/* ── Account ──────────────────────────────────────────────────── */}
      <SettingsSection id="profile-account" title="Account" description="Reference details for your Revluma account.">
        <SettingsRow label="User ID" description="Share this with Revluma support so they can find your account quickly.">
          <div className="flex min-h-[38px] items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border border-line bg-subtle px-2.5 py-1.5 font-mono text-[12.5px] text-ink-soft" title={userId} data-testid="profile-user-id">
              {userId || "Unavailable"}
            </code>
            <button
              type="button"
              onClick={() => void handleCopyId()}
              disabled={!userId}
              className={cn(ui.secondaryButton, "w-9 px-0")}
              aria-label={copiedId ? "User ID copied" : "Copy user ID"}
            >
              {copiedId ? <Check className="h-4 w-4 text-success" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
            </button>
          </div>
        </SettingsRow>
        {memberSince ? (
          <SettingsRow label="Member since">
            <div className="text-[14px] leading-5 text-ink">{memberSince}</div>
          </SettingsRow>
        ) : null}
      </SettingsSection>

      <TwoFactorSetupDialog
        open={setupOpen}
        onOpenChange={setSetupOpen}
        onEnabled={() => {
          setTwoFactorEnabled(true);
          patchAuthUser({ two_factor_enabled: true });
          toast.success("Two-factor authentication is on");
        }}
      />
      <TwoFactorDisableDialog
        open={disableOpen}
        onOpenChange={setDisableOpen}
        onDisabled={() => {
          setTwoFactorEnabled(false);
          patchAuthUser({ two_factor_enabled: false });
          toast.success("Two-factor authentication is off");
        }}
      />
    </div>
  );
};

export default Profile;
