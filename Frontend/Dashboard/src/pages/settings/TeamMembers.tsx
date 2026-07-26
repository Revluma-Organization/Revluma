import { FC, useState, type FormEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users,
  UserPlus,
  MoreVertical,
  Shield,
  User,
  Mail,
  Trash2,
  Edit2,
  CheckCircle2,
  X,
  Loader2,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface TeamMemberItem {
  id: string;
  fullName: string;
  email: string;
  role: "Admin" | "Member";
  avatarUrl?: string;
  joinedDate: string;
}

const INITIAL_POPULATED_MEMBERS: TeamMemberItem[] = [
  {
    id: "usr-1",
    fullName: "Elena Rostova",
    email: "elena.rostova@revluma.com",
    role: "Admin",
    joinedDate: "Jul 12, 2026",
  },
  {
    id: "usr-2",
    fullName: "Marcus Vance",
    email: "marcus.vance@revluma.com",
    role: "Member",
    joinedDate: "Jul 15, 2026",
  },
  {
    id: "usr-3",
    fullName: "Sarah Jenkins",
    email: "sarah.j@revluma.com",
    role: "Member",
    joinedDate: "Jul 20, 2026",
  },
];

export const TeamMembers: FC = () => {
  // Start in empty state as requested by the prompt ("The current state is empty, so start by designing a beautiful 'Empty State' placeholder...")
  const [members, setMembers] = useState<TeamMemberItem[]>([]);
  const [isInviteModalOpen, setIsInviteModalOpen] = useState<boolean>(false);
  const [inviteEmail, setInviteEmail] = useState<string>("");
  const [inviteRole, setInviteRole] = useState<"Admin" | "Member">("Member");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  // Toggle helper for easy testing of both empty and populated states
  const toggleDemoState = () => {
    if (members.length === 0) {
      setMembers(INITIAL_POPULATED_MEMBERS);
      setFeedbackMessage("Switched demo to Populated State (3 members).");
    } else {
      setMembers([]);
      setFeedbackMessage("Switched demo to Empty State.");
    }
  };

  const handleOpenInviteModal = () => {
    setInviteEmail("");
    setInviteRole("Member");
    setIsInviteModalOpen(true);
  };

  const handleCloseInviteModal = () => {
    if (isSubmitting) return;
    setIsInviteModalOpen(false);
  };

  const handleInviteSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!inviteEmail || !inviteEmail.includes("@")) return;

    setIsSubmitting(true);
    setTimeout(() => {
      const emailParts = inviteEmail.split("@")[0];
      const displayName =
        emailParts
          .split(".")
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(" ") || "New Member";

      const newMember: TeamMemberItem = {
        id: `usr-${Date.now()}`,
        fullName: displayName,
        email: inviteEmail.toLowerCase(),
        role: inviteRole,
        joinedDate: "Just now",
      };

      setMembers((prev) => [newMember, ...prev]);
      setIsSubmitting(false);
      setIsInviteModalOpen(false);
      setFeedbackMessage(
        `Invited ${inviteEmail} as an ${inviteRole} successfully.`
      );
    }, 800);
  };

  const handleRemoveMember = (id: string) => {
    setMembers((prev) => prev.filter((m) => m.id !== id));
    setFeedbackMessage("Team member removed from workspace.");
  };

  const handleToggleRole = (id: string) => {
    setMembers((prev) =>
      prev.map((m) => {
        if (m.id === id) {
          const updatedRole = m.role === "Admin" ? "Member" : "Admin";
          return { ...m, role: updatedRole };
        }
        return m;
      })
    );
    setFeedbackMessage("Updated team member role successfully.");
  };

  const getInitials = (name: string): string => {
    const parts = name.trim().split(" ");
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  return (
    <div className="w-full max-w-5xl space-y-8 text-slate-100">
      {/* Page Header with Demo Toggle */}
      <div className="flex flex-col justify-between gap-4 border-b border-slate-800 pb-6 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-500/10 text-sky-400 ring-1 ring-sky-500/20">
            <Users className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Team Members
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Invite colleagues and manage role permissions across your workspace.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={toggleDemoState}
            className="border-slate-700 bg-slate-900/80 text-xs text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            <Sparkles className="mr-1.5 h-3.5 w-3.5 text-sky-400" />
            <span>
              {members.length === 0
                ? "Preview Populated State"
                : "Preview Empty State"}
            </span>
          </Button>

          <Button
            type="button"
            onClick={handleOpenInviteModal}
            className="h-9 bg-sky-600 px-4 text-xs font-semibold text-white shadow-lg shadow-sky-600/20 hover:bg-sky-500 sm:h-10 sm:text-sm"
          >
            <UserPlus className="mr-2 h-4 w-4" />
            <span>Invite Member</span>
          </Button>
        </div>
      </div>

      {/* Inline Feedback Toast */}
      <AnimatePresence>
        {feedbackMessage && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="flex items-center justify-between rounded-xl border border-sky-500/30 bg-sky-500/10 p-4 text-sm text-sky-200"
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-sky-400" />
              <span>{feedbackMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setFeedbackMessage(null)}
              className="rounded p-1 text-slate-400 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content Area: Empty State vs. Populated State */}
      {members.length === 0 ? (
        /* Empty State */
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
          className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-800 bg-slate-900/30 px-6 py-20 text-center sm:px-12 sm:py-24"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-full border border-slate-800 bg-slate-900 text-slate-400 shadow-inner">
            <Users className="h-8 w-8 text-slate-500" />
          </div>

          <h2 className="mt-6 text-xl font-bold text-white sm:text-2xl">
            No team members yet
          </h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-400">
            You have not invited any colleagues to this workspace yet. Add staff to share analytics, manage integrations, and collaborate on customer revenue.
          </p>

          <Button
            type="button"
            onClick={handleOpenInviteModal}
            className="mt-8 h-11 bg-sky-600 px-6 font-semibold text-white shadow-xl shadow-sky-600/20 hover:bg-sky-500"
          >
            <UserPlus className="mr-2 h-4 w-4" />
            <span>Invite Member</span>
          </Button>
        </motion.div>
      ) : (
        /* Populated State Data Table */
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/40 shadow-xl"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/60 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  <th className="px-6 py-4">User</th>
                  <th className="px-6 py-4">Role</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {members.map((member) => (
                  <tr
                    key={member.id}
                    className="group transition-colors hover:bg-slate-800/40"
                  >
                    {/* User Column (Avatar + Name + Email) */}
                    <td className="whitespace-nowrap px-6 py-4">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-10 w-10 border border-slate-700 bg-slate-950">
                          {member.avatarUrl && (
                            <AvatarImage
                              src={member.avatarUrl}
                              alt={member.fullName}
                            />
                          )}
                          <AvatarFallback className="bg-slate-800 text-xs font-bold text-sky-400">
                            {getInitials(member.fullName)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <div className="font-semibold text-white">
                            {member.fullName}
                          </div>
                          <div className="flex items-center gap-1.5 text-xs text-slate-400">
                            <Mail className="h-3 w-3 opacity-60" />
                            <span>{member.email}</span>
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Role Column (Admin/Member badge) */}
                    <td className="whitespace-nowrap px-6 py-4">
                      <Badge
                        variant="outline"
                        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                          member.role === "Admin"
                            ? "border-sky-500/30 bg-sky-500/10 text-sky-300"
                            : "border-slate-700 bg-slate-800/60 text-slate-300"
                        }`}
                      >
                        {member.role === "Admin" ? (
                          <Shield className="h-3 w-3 text-sky-400" />
                        ) : (
                          <User className="h-3 w-3 text-slate-400" />
                        )}
                        <span>{member.role}</span>
                      </Badge>
                    </td>

                    {/* Trailing Column with Action Menu */}
                    <td className="whitespace-nowrap px-6 py-4 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-slate-400 hover:bg-slate-800 hover:text-white"
                          >
                            <MoreVertical className="h-4 w-4" />
                            <span className="sr-only">Open member actions</span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          className="w-44 border-slate-800 bg-slate-950 text-slate-100"
                        >
                          <DropdownMenuItem
                            onClick={() => handleToggleRole(member.id)}
                            className="flex cursor-pointer items-center gap-2 text-xs focus:bg-slate-800 focus:text-white"
                          >
                            <Edit2 className="h-3.5 w-3.5 text-sky-400" />
                            <span>
                              {member.role === "Admin"
                                ? "Change to Member"
                                : "Promote to Admin"}
                            </span>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator className="bg-slate-800" />
                          <DropdownMenuItem
                            onClick={() => handleRemoveMember(member.id)}
                            className="flex cursor-pointer items-center gap-2 text-xs text-red-400 focus:bg-red-500/10 focus:text-red-300"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span>Remove Member</span>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}

      {/* Framer Motion Modal for Invite Member */}
      <AnimatePresence>
        {isInviteModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                handleCloseInviteModal();
              }
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              transition={{
                type: "spring",
                stiffness: 300,
                damping: 28,
              }}
              className="relative w-full max-w-md overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 p-6 text-slate-100 shadow-2xl sm:p-8"
            >
              <button
                type="button"
                onClick={handleCloseInviteModal}
                disabled={isSubmitting}
                className="absolute right-4 top-4 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white disabled:opacity-50"
                aria-label="Close invite modal"
              >
                <X className="h-5 w-5" />
              </button>

              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-sky-500/10 text-sky-400 ring-1 ring-sky-500/30">
                  <UserPlus className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white sm:text-xl">
                    Invite Team Member
                  </h3>
                  <p className="text-xs text-slate-400">
                    Send an invitation email to add a staff member.
                  </p>
                </div>
              </div>

              <form onSubmit={handleInviteSubmit} className="mt-6 space-y-4">
                {/* Email Input */}
                <div className="space-y-2">
                  <Label
                    htmlFor="invite-email"
                    className="text-xs font-semibold uppercase tracking-wider text-slate-400"
                  >
                    Email Address
                  </Label>
                  <Input
                    id="invite-email"
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="colleague@company.com"
                    required
                    disabled={isSubmitting}
                    className="h-11 w-full border-slate-700 bg-slate-900 text-slate-100 placeholder:text-slate-500 focus-visible:border-sky-500 focus-visible:ring-sky-500/30"
                  />
                </div>

                {/* Role Select Dropdown */}
                <div className="space-y-2">
                  <Label
                    htmlFor="invite-role"
                    className="text-xs font-semibold uppercase tracking-wider text-slate-400"
                  >
                    Workspace Role
                  </Label>
                  <Select
                    value={inviteRole}
                    onValueChange={(value: "Admin" | "Member") =>
                      setInviteRole(value)
                    }
                    disabled={isSubmitting}
                  >
                    <SelectTrigger
                      id="invite-role"
                      className="h-11 w-full border-slate-700 bg-slate-900 text-slate-100 focus:border-sky-500 focus:ring-1 focus:ring-sky-500/30"
                    >
                      <SelectValue placeholder="Select role" />
                    </SelectTrigger>
                    <SelectContent className="border-slate-800 bg-slate-950 text-slate-100">
                      <SelectItem value="Member">
                        <div className="flex items-center gap-2">
                          <User className="h-4 w-4 text-slate-400" />
                          <span>Member (Can view and manage data)</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="Admin">
                        <div className="flex items-center gap-2">
                          <Shield className="h-4 w-4 text-sky-400" />
                          <span>Admin (Can manage settings and staff)</span>
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Action Buttons */}
                <div className="flex flex-col-reverse gap-3 pt-4 sm:flex-row">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleCloseInviteModal}
                    disabled={isSubmitting}
                    className="h-11 flex-1 border-slate-700 bg-transparent text-slate-300 hover:bg-slate-800 hover:text-white"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={!inviteEmail || isSubmitting}
                    className="h-11 flex-1 bg-sky-600 font-semibold text-white shadow-lg shadow-sky-600/30 hover:bg-sky-500"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        <span>Sending...</span>
                      </>
                    ) : (
                      "Send Invite"
                    )}
                  </Button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default TeamMembers;
