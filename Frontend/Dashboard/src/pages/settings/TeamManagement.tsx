import { FC, useState, useCallback, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { useAuthStore } from "@/store/authStore";
import {
  listMembers,
  inviteMember,
  removeMember,
  updateMemberRole,
  type OrgMember,
} from "@/lib/org";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/seperator";
import { DESIGN_TOKENS } from "@/lib/DesignConstants";
import { motion } from "framer-motion";
import {
  PageTransition,
  StaggeredList,
  StaggeredItem,
} from "@/components/MotionWrappers";
import {
  X,
  UserPlus,
  MoreVertical,
  Crown,
  Shield,
  User,
  Trash2,
  ArrowUpCircle,
  ArrowDownCircle,
  Mail,
  Check,
  Copy,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

const MotionButton = motion.create(Button);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function roleBadgeStyle(role: string): string {
  switch (role) {
    case "owner":
      return "bg-amber-500/15 text-amber-400 border border-amber-500/25";
    case "admin":
      return "bg-blue-500/15 text-blue-400 border border-blue-500/25";
    default:
      return "bg-slate-500/15 text-slate-400 border border-slate-500/25";
  }
}

function roleIcon(role: string) {
  switch (role) {
    case "owner":
      return <Crown className="h-3 w-3" />;
    case "admin":
      return <Shield className="h-3 w-3" />;
    default:
      return <User className="h-3 w-3" />;
  }
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "Pending";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ─── Component ───────────────────────────────────────────────────────────────

const TeamManagement: FC = () => {
  const { user } = useAuth();
  const userRole = useAuthStore((s) =>
    s.user?.role?.toLowerCase(),
  ) as string | undefined;

  const [members, setMembers] = useState<OrgMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [inviteLoading, setInviteLoading] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<OrgMember | null>(null);
  const [removeLoading, setRemoveLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const canManage = userRole === "owner" || userRole === "admin";
  const isOwner = userRole === "owner";

  const fetchMembers = useCallback(async () => {
    try {
      setLoading(true);
      const data = await listMembers();
      setMembers(data);
    } catch {
      toast.error("Failed to load team members.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  // ── Invite ───────────────────────────────────────────────────────────────

  const handleInvite = async () => {
    const email = inviteEmail.trim().toLowerCase();
    if (!email) return;

    try {
      setInviteLoading(true);
      await inviteMember(email, inviteRole);
      toast.success(`Invitation sent to ${email}`);
      setInviteOpen(false);
      setInviteEmail("");
      setInviteRole("member");
      fetchMembers();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to send invitation.";
      toast.error(msg);
    } finally {
      setInviteLoading(false);
    }
  };

  // ── Remove ───────────────────────────────────────────────────────────────

  const handleRemove = async () => {
    if (!removeTarget) return;
    try {
      setRemoveLoading(true);
      await removeMember(removeTarget.membershipId);
      toast.success(`${removeTarget.user.full_name} removed from the team.`);
      setRemoveTarget(null);
      fetchMembers();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to remove member.";
      toast.error(msg);
    } finally {
      setRemoveLoading(false);
    }
  };

  // ── Role change ──────────────────────────────────────────────────────────

  const handleRoleChange = async (
    membershipId: string,
    newRole: "admin" | "member",
  ) => {
    try {
      await updateMemberRole(membershipId, newRole);
      toast.success(`Role updated to ${newRole}.`);
      fetchMembers();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to update role.";
      toast.error(msg);
    }
  };

  // ── Copy invite link ─────────────────────────────────────────────────────

  const copyInviteLink = () => {
    const url = `${window.location.origin}/invite/accept`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <PageTransition className="max-w-4xl space-y-8 relative">
      {/* Header */}
      <motion.div layout className="flex items-center justify-between">
        <div>
          <motion.h1
            layout
            className={`text-2xl font-bold tracking-tight display ${DESIGN_TOKENS.primaryText}`}
          >
            Team Members
          </motion.h1>
          <motion.p
            layout
            className={`text-[0.85rem] mt-1 ${DESIGN_TOKENS.secondaryText}`}
          >
            Manage who has access to your organization.
          </motion.p>
        </div>
        <div className="flex items-center gap-2">
          {canManage && (
            <MotionButton
              whileTap={{ scale: 0.98 }}
              onClick={() => setInviteOpen(true)}
              className="bg-[hsl(var(--accent))] hover:bg-[hsl(var(--accent-2))] !text-black border-none font-bold shadow-[0_0_15px_hsl(var(--accent)/0.3)] flex items-center gap-2 rounded-lg text-xs h-9 px-4"
            >
              <UserPlus className="h-3.5 w-3.5" />
              Invite Member
            </MotionButton>
          )}
          <MotionButton
            whileTap={{ scale: 0.98 }}
            variant="ghost"
            size="icon"
            onClick={() => window.history.back()}
            className="rounded-full hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="h-5 w-5 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white" />
          </MotionButton>
        </div>
      </motion.div>

      {/* Members List */}
      <StaggeredList
        className={`space-y-0 shadow-sm relative overflow-hidden ${DESIGN_TOKENS.card}`}
      >
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-glass/[0.015] to-transparent" />

        {loading ? (
          <div className="relative z-10 p-12 flex flex-col items-center justify-center text-t3">
            <Loader2 className="h-5 w-5 animate-spin mb-3" />
            <p className="text-sm">Loading team members...</p>
          </div>
        ) : members.length === 0 ? (
          <div className="relative z-10 p-12 flex flex-col items-center justify-center text-t3">
            <User className="h-8 w-8 mb-3 opacity-40" />
            <p className="text-sm font-medium">No team members yet</p>
            <p className="text-xs mt-1 opacity-70">
              Invite your first team member to get started.
            </p>
          </div>
        ) : (
          members.map((m, i) => {
            const isCurrentUser = m.user.id === user?.id;
            const isTargetOwner = m.role === "owner";
            const canRemove =
              canManage && !isCurrentUser && !isTargetOwner;
            const canChangeRole = isOwner && !isTargetOwner && !isCurrentUser;

            return (
              <StaggeredItem
                key={m.membershipId}
                className={`relative z-10 p-4 flex items-center gap-4 ${
                  i < members.length - 1
                    ? "border-b border-slate-200 dark:border-slate-800"
                    : ""
                }`}
              >
                {/* Avatar */}
                <Avatar className="h-10 w-10 border border-border shrink-0">
                  <AvatarFallback className="bg-bg-3 text-sm font-bold text-[hsl(var(--accent))]">
                    {initials(m.user.full_name)}
                  </AvatarFallback>
                </Avatar>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-t1 truncate">
                      {m.user.full_name}
                    </p>
                    {isCurrentUser && (
                      <span className="text-[0.65rem] font-medium text-t4 bg-bg-3 px-1.5 py-0.5 rounded">
                        You
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-t3 truncate flex items-center gap-1 mt-0.5">
                    <Mail className="h-3 w-3 opacity-50" />
                    {m.user.email}
                  </p>
                </div>

                {/* Role + joined */}
                <div className="hidden sm:flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <p className="text-[0.7rem] text-t4">
                      {m.joinedAt ? `Joined ${timeAgo(m.joinedAt)}` : `Invited ${timeAgo(m.invitedAt)}`}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className={`text-[0.7rem] font-semibold px-2.5 py-0.5 rounded-md capitalize gap-1 ${roleBadgeStyle(m.role)}`}
                  >
                    {roleIcon(m.role)}
                    {m.role}
                  </Badge>
                </div>

                {/* Mobile role badge */}
                <div className="sm:hidden shrink-0">
                  <Badge
                    variant="outline"
                    className={`text-[0.65rem] font-semibold px-2 py-0.5 rounded-md capitalize gap-1 ${roleBadgeStyle(m.role)}`}
                  >
                    {roleIcon(m.role)}
                    {m.role}
                  </Badge>
                </div>

                {/* Actions */}
                {(canRemove || canChangeRole) && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 text-t4 hover:text-t1"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      {canChangeRole && (
                        <>
                          {m.role === "member" ? (
                            <DropdownMenuItem
                              onClick={() =>
                                handleRoleChange(m.membershipId, "admin")
                              }
                              className="gap-2 text-xs"
                            >
                              <ArrowUpCircle className="h-3.5 w-3.5" />
                              Promote to Admin
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onClick={() =>
                                handleRoleChange(m.membershipId, "member")
                              }
                              className="gap-2 text-xs"
                            >
                              <ArrowDownCircle className="h-3.5 w-3.5" />
                              Demote to Member
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                        </>
                      )}
                      {canRemove && (
                        <DropdownMenuItem
                          onClick={() => setRemoveTarget(m)}
                          className="gap-2 text-xs text-red-500 focus:text-red-500"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Remove from Team
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </StaggeredItem>
            );
          })
        )}
      </StaggeredList>

      {/* Invite Link Helper */}
      {canManage && (
        <motion.div
          layout
          className={`p-4 ${DESIGN_TOKENS.card} flex items-center justify-between gap-4`}
        >
          <div>
            <p className="text-sm font-medium text-t1">Invite Link</p>
            <p className="text-xs text-t3 mt-0.5">
              Share this link with people you want to invite. They'll need to
              sign up first.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={copyInviteLink}
            className="shrink-0 gap-1.5 text-xs h-8 rounded-lg"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                Copy Link
              </>
            )}
          </Button>
        </motion.div>
      )}

      {/* ─── Invite Dialog ─────────────────────────────────────────────────── */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold display">
              Invite Team Member
            </DialogTitle>
            <DialogDescription className="text-sm text-t3">
              They'll receive an email with instructions to join your
              organization.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="invite-email" className="text-xs font-semibold text-t3">
                Email Address
              </Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="colleague@company.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleInvite()}
                className={`h-9 text-sm ${DESIGN_TOKENS.input}`}
                autoFocus
              />
            </div>

            {isOwner && (
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-t3">Role</Label>
                <div className="flex gap-2">
                  {(["member", "admin"] as const).map((r) => (
                    <button
                      key={r}
                      onClick={() => setInviteRole(r)}
                      className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border text-xs font-semibold capitalize transition-all ${
                        inviteRole === r
                          ? "border-[hsl(var(--accent)/0.4)] bg-[hsl(var(--accent)/0.08)] text-[hsl(var(--accent))]"
                          : "border-border text-t3 hover:border-t4 hover:text-t2"
                      }`}
                    >
                      {roleIcon(r)}
                      {r}
                    </button>
                  ))}
                </div>
                <p className="text-[0.7rem] text-t4">
                  Admins can invite and remove members. Only owners can manage
                  admin roles.
                </p>
              </div>
            )}

            <Separator className="my-2" />

            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setInviteOpen(false)}
                className="text-xs h-8"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleInvite}
                disabled={!inviteEmail.trim() || inviteLoading}
                className="bg-[hsl(var(--accent))] hover:bg-[hsl(var(--accent-2))] !text-black font-bold text-xs h-8 px-4 gap-1.5"
              >
                {inviteLoading && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                )}
                Send Invitation
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── Remove Confirmation Dialog ────────────────────────────────────── */}
      <Dialog
        open={!!removeTarget}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold display">
              Remove Team Member
            </DialogTitle>
            <DialogDescription className="text-sm text-t3">
              {removeTarget && (
                <>
                  Are you sure you want to remove{" "}
                  <strong className="text-t1">
                    {removeTarget.user.full_name}
                  </strong>{" "}
                  from your organization? They will lose access immediately.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRemoveTarget(null)}
              className="text-xs h-8"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={handleRemove}
              disabled={removeLoading}
              className="text-xs h-8 px-4 gap-1.5"
            >
              {removeLoading && (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              )}
              Remove
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </PageTransition>
  );
};

export default TeamManagement;
