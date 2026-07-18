import { api } from "@/lib/api";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OrgMember {
  membershipId: string;
  role: "owner" | "admin" | "member";
  status: string;
  user: { id: string; full_name: string; email: string };
  invitedAt: string | null;
  joinedAt: string | null;
  createdAt: string;
}

export interface InviteResult {
  message: string;
}

export interface AcceptInviteResult {
  organizationId: string;
  role: string;
}

// ─── API Functions ───────────────────────────────────────────────────────────

export async function listMembers(): Promise<OrgMember[]> {
  const res = await api.get<{ success: boolean; data: { members: OrgMember[] } }>(
    "/org/members",
  );
  return res.data.data.members;
}

export async function inviteMember(
  email: string,
  role: "admin" | "member" = "member",
): Promise<InviteResult> {
  const res = await api.post<{ success: boolean; message: string }>(
    "/org/members/invite",
    { email, role },
  );
  return { message: res.data.message };
}

export async function acceptInvite(
  token: string,
): Promise<AcceptInviteResult> {
  const res = await api.post<{
    success: boolean;
    data: AcceptInviteResult;
  }>("/org/members/invite/accept", { token });
  return res.data.data;
}

export async function removeMember(membershipId: string): Promise<void> {
  await api.delete(`/org/members/${membershipId}`);
}

export async function updateMemberRole(
  membershipId: string,
  role: "admin" | "member",
): Promise<void> {
  await api.patch(`/org/members/${membershipId}/role`, { role });
}
