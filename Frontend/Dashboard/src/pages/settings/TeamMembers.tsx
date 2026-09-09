import { FC, useState, useEffect, useCallback, type FormEvent } from "react";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { api } from "@/lib/api";
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

// Defines the structure we use in the UI
export interface TeamMemberItem {
  id: string;
  fullName: string | null;
  email: string;
  role: "Admin" | "Member";
  avatarUrl?: string;
  status: "pending" | "active";
}

// Defines what backend actually sends
interface ApiMemberResponse {
  membershipId: string | null;
  invitationId: string | null;
  role: string;
  status: string;
  user: {
    id: string | null;
    full_name: string | null;
    email: string;
  };
  }

export const TeamMembers: FC = () => {
  const [members, setMembers] = useState<TeamMemberItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const fetchMembers = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.get<{ members: ApiMemberResponse[] }>("/org/members", undefined, {
        skipAuthRedirect: true,
      });

      if (res?.data?.members && Array.isArray(res.data.members)) {
        const mappedMembers: TeamMemberItem[] = res.data.members.map((m) => ({
          id: m.membershipId || m.invitationId || Math.random().toString(),
          fullName: m.user.full_name,
          email: m.user.email,
          role: m.role.toLowerCase() === "admin" ? "Admin" : "Member",
          status: m.status === "pending" ? "pending" : "active",
        }));
        setMembers(mappedMembers);
      } else {
        setMembers([]);
      }
    } catch (err) {
      console.warn("Failed to fetch team members from API:", err);
      setMembers([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);
  const [isInviteModalOpen, setIsInviteModalOpen] = useState<boolean>(false);
  const [inviteEmail, setInviteEmail] = useState<string>("");
  const [inviteRole, setInviteRole] = useState<"Admin" | "Member">("Member");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  const handleOpenInviteModal = () => {
    setInviteEmail("");
    setInviteRole("Member");
    setIsInviteModalOpen(true);
  };

  const handleCloseInviteModal = () => {
    if (isSubmitting) return;
    setIsInviteModalOpen(false);
  };

    const handleInviteSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!inviteEmail || !inviteEmail.includes("@")) return;

    setIsSubmitting(true);
    try {
      await api.post("/org/members/invite", {
        email: inviteEmail.toLowerCase(),
        role: inviteRole.toLowerCase(), 
      });
      
      // Re-fetch the list to get the real Database ID for the new member
      await fetchMembers();
      
      setFeedbackMessage(`Invited ${inviteEmail} as an ${inviteRole} successfully.`);
      setIsInviteModalOpen(false);
    } catch (err) {
      console.error(err);
      setFeedbackMessage("Failed to send invitation. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

    const handleRemoveMember = async (id: string) => {
    try {
      await api.delete(`/org/members/${id}`);
      setMembers((prev) => prev.filter((m) => m.id !== id));
      setFeedbackMessage("Team member removed from workspace.");
    } catch (err) {
      console.error(err);
      setFeedbackMessage("Failed to remove team member.");
    }
  };
  
    const handleToggleRole = async (id: string) => {
    const memberToUpdate = members.find((m) => m.id === id);
    if (!memberToUpdate) return;
    
    const updatedRole = memberToUpdate.role === "Admin" ? "Member" : "Admin";

    try {
      await api.patch(`/org/members/${id}/role`, { role: updatedRole });
      
      setMembers((prev) =>
        prev.map((m) => (m.id === id ? { ...m, role: updatedRole } : m))
      );
      setFeedbackMessage(`Updated team member role to ${updatedRole} successfully.`);
    } catch (err) {
      console.error(err);
      setFeedbackMessage("Failed to update team member role.");
    }
  };

  const getInitials = (name: string): string => {
    const parts = name.trim().split(" ");
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  return (
    <div className="w-full max-w-5xl space-y-8 text-slate-900 dark:text-slate-100">
      {/* Page Header with Invite Member button at top right */}
      <div className="flex flex-col justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-6 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-500/10 text-sky-400 ring-1 ring-sky-500/20">
            <Users className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-3xl">
              Team Members
            </h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Invite colleagues and manage role permissions across your workspace.
            </p>
          </div>
        </div>

        <div className="flex items-center">
          <Button
            type="button"
            onClick={handleOpenInviteModal}
            className="h-10 bg-sky-600 px-5 text-sm font-semibold text-white shadow-lg shadow-sky-600/20 hover:bg-sky-500"
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

      {/* Main Populated Data Table (User, Role, Actions) */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/40 shadow-xl"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-100/60 dark:border-slate-800 dark:bg-slate-950/60 text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                <th className="px-6 py-4">User</th>
                <th className="px-6 py-4">Role</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/80 dark:divide-slate-800/80">
              {isLoading ? (
                <tr>
                  <td colSpan={3} className="px-6 py-12 text-center text-sm text-slate-600 dark:text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Loader2 className="h-6 w-6 animate-spin text-sky-400" />
                      <span>Loading team members...</span>
                    </div>
                  </td>
                </tr>
              ) : members.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-6 py-12 text-center text-sm text-slate-500 dark:text-slate-500">
                    No team members found. Click &quot;Invite Member&quot; to add someone to your workspace.
                  </td>
                </tr>
              ) : (
                members.map((member) => (
                  <tr
                    key={member.id}
                    className="group transition-colors hover:bg-slate-100/60 dark:hover:bg-slate-800/40"
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
                            {getInitials(member.fullName || member.email)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white">
                            {member.fullName || member.email}
                            {member.status === "pending" && (
                              <Badge variant="outline" className="h-5 px-1.5 text-[0.65rem] border-amber-500/40 bg-amber-500/10 text-amber-500">
                                Pending
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
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
                ))
              )}
            </tbody>
          </table>
        </div>
      </motion.div>

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
