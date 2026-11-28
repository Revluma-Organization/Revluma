import type { FC, ReactNode } from "react";
import { BadgeCheck, Building2, Camera, Crown, Shield, User as UserIcon } from "lucide-react";
import type { RoleMeta } from "@/lib/profileSettings";
import { settingsUi as ui } from "@/lib/settingsStyles";
import { cn } from "@/lib/utils";

interface ProfileHeroProps {
  name: string;
  email: string;
  emailVerified?: boolean;
  avatarUrl: string | null;
  initials: string;
  role: RoleMeta;
  workspaceName: string | null;
  otherWorkspaces: number;
  memberSince: string | null;
  onEditPhoto: () => void;
}

const RoleIcon: FC<{ role: RoleMeta["role"] }> = ({ role }) => {
  const className = "h-3.5 w-3.5";
  if (role === "owner") return <Crown className={className} aria-hidden="true" />;
  if (role === "admin") return <Shield className={className} aria-hidden="true" />;
  return <UserIcon className={className} aria-hidden="true" />;
};

function Fact({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-4 px-4 py-2.5 sm:block sm:px-5 sm:py-3.5 sm:text-center">
      <p className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">{label}</p>
      <div className="flex min-h-6 min-w-0 items-center justify-end text-[14px] font-medium text-ink sm:mt-1 sm:justify-center" data-testid={testId}>{children}</div>
    </div>
  );
}

/**
 * Identity header: a large, centred avatar overlapping a restrained brand
 * band, then name, sign-in email and an at-a-glance strip. Modelled on the
 * Google Account home and Atlassian "Profile and visibility" headers, where
 * the person, not the form, is the first thing on the page.
 */
export const ProfileHero: FC<ProfileHeroProps> = ({
  name,
  email,
  emailVerified,
  avatarUrl,
  initials,
  role,
  workspaceName,
  otherWorkspaces,
  memberSince,
  onEditPhoto,
}) => (
  <section aria-label="Your profile" className="overflow-hidden rounded-2xl border border-line bg-panel shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
    <div
      aria-hidden="true"
      className="h-24 border-b border-line bg-brand-soft sm:h-28"
      style={{
        backgroundImage:
          "radial-gradient(70% 140% at 12% 0%, rgba(68,56,232,0.22), transparent 62%), radial-gradient(60% 120% at 92% 10%, rgba(20,184,166,0.16), transparent 60%), linear-gradient(180deg, rgba(255,255,255,0.06), transparent)",
      }}
    />

    <div className="flex flex-col items-center px-5 pb-6 text-center sm:px-8">
      <div className="relative -mt-12 sm:-mt-14">
        <button
          type="button"
          onClick={onEditPhoto}
          aria-label={avatarUrl ? "Change profile photo" : "Add profile photo"}
          className={cn(
            "group relative block h-24 w-24 cursor-pointer overflow-hidden rounded-full bg-brand-soft ring-4 ring-panel shadow-[0_10px_30px_-12px_rgba(16,24,40,0.45)] sm:h-28 sm:w-28",
            ui.focusRing,
            "focus-visible:rounded-full",
          )}
          data-testid="profile-hero-avatar"
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-[32px] font-semibold tracking-[-0.03em] text-brand-deep" aria-hidden="true">
              {initials}
            </span>
          )}
          <span className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/20" aria-hidden="true" />
        </button>
        <span
          className="pointer-events-none absolute bottom-0.5 right-0.5 flex h-8 w-8 items-center justify-center rounded-full border border-line-strong bg-panel text-ink-soft shadow-[0_2px_6px_rgba(16,24,40,0.18)]"
          aria-hidden="true"
        >
          <Camera className="h-4 w-4" />
        </span>
      </div>

      <h2 className="mt-4 max-w-full break-words text-[24px] font-semibold leading-8 tracking-[-0.025em] text-ink" data-testid="profile-hero-name">
        {name || "Add your name"}
      </h2>
      <p className="mt-1 flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[14px] text-ink-muted">
        <span className="break-all" data-testid="profile-email">{email || "No email on file"}</span>
        {emailVerified === true ? (
          <span className="inline-flex items-center gap-1 text-[12.5px] font-medium text-success">
            <BadgeCheck className="h-4 w-4" aria-hidden="true" />Verified
          </span>
        ) : emailVerified === false ? (
          <span className={ui.badgeWarning}>Not verified</span>
        ) : null}
      </p>
    </div>

    <div className="grid grid-cols-1 divide-y divide-line border-t border-line bg-subtle sm:grid-cols-3 sm:divide-x sm:divide-y-0">
      <Fact label="Workspace" testId="profile-workspace">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <Building2 className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden="true" />
          <span className="truncate">{workspaceName ?? "None selected"}</span>
          {otherWorkspaces > 0 ? <span className="shrink-0 text-[12.5px] font-normal text-ink-muted">+{otherWorkspaces}</span> : null}
        </span>
      </Fact>
      <Fact label="Role" testId="profile-role">
        <span className={role.role === "member" ? ui.badgeNeutral : ui.badgeBrand}>
          <RoleIcon role={role.role} />{role.label}
        </span>
      </Fact>
      <Fact label="Member since">{memberSince ?? "Unavailable"}</Fact>
    </div>
  </section>
);
