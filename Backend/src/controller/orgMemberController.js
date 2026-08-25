/**
 * Organization Members Controller — RBAC team management.
 *
 * Endpoints:
 *   POST   /org/members/invite      — owner/admin invites a user by email
 *   POST   /org/members/invite/accept — logged-in user accepts an invite
 *   GET    /org/members             — list all members of the org
 *   DELETE /org/members/:memberId   — owner/admin removes a member
 *   PATCH  /org/members/:memberId/role — owner changes a member's role
 */

const dbConfig = require('../configs/database');
const prisma = dbConfig.prisma;
const emailService = require('../utils/emailService');
const { generateInviteToken, hashInviteToken } = require('../utils/tokens');
const logger = require('../utils/logger');

const INVITE_GENERIC_MESSAGE =
  'If this email is associated with a Revluma account, an invitation has been sent.';

// ─── INVITE MEMBER ───────────────────────────────────────────────────────────


exports.inviteMember = async (req, res, next) => {
  try {
    logger.info('invite_member_request', {
      body: req.body,
      organizationId: req.orgMembership?.organizationId,
      role: req.orgMembership?.role,
      userId: req.user?.id,
    });

    const { email, role } = req.body;
    const { organizationId, role: callerRole } = req.orgMembership;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ success: false, error: 'Email is required.' });
    }

    const targetRole = role || 'member';
    const validRoles = ['admin', 'member'];
    if (!validRoles.includes(targetRole)) {
      return res.status(400).json({
        success: false,
        error: 'Role must be one of: admin, member.',
      });
    }

    // Only owner can promote to admin
    if (targetRole === 'admin' && callerRole !== 'owner') {
      return res.status(403).json({
        success: false,
        error: 'Only the organization owner can invite admins.',
      });
    }

    const targetEmail = email.toLowerCase().trim();

    // Check if already a member
    const existingUser = await prisma.users.findUnique({ where: { email: targetEmail } });
    if (existingUser) {
      const existingMember = await prisma.organization_members.findUnique({
        where: { organization_id_user_id: { organization_id: organizationId, user_id: existingUser.id } },
      });
      if (existingMember && existingMember.status === 'active') {
        return res.status(409).json({ success: false, error: 'This user is already a member.' });
      }
    }

    // Check for pending invite
    const existingInvite = await prisma.invite_tokens.findFirst({
      where: {
        organization_id: organizationId,
        email: targetEmail,
        accepted_at: null,
        expires_at: { gt: new Date() },
      },
    });
    if (existingInvite) {
      return res.status(409).json({ success: false, error: 'An active invite already exists for this email.' });
    }

    // Generate invite token
    const { raw: rawToken, hash: tokenHash, expiresAt } = generateInviteToken();

    // Get org name and inviter name for the email
    const org = await prisma.organizations.findUnique({
      where: { id: organizationId },
      select: { company_name: true },
    });
    const inviterName = req.user.email; // fallback to email

    // Store the hashed token
    await prisma.invite_tokens.create({
      data: {
        organization_id: organizationId,
        email: targetEmail,
        role: targetRole,
        invited_by: req.user.id,
        token_hash: tokenHash,
        expires_at: expiresAt,
      },
    });

    // Send invite email (fire-and-forget)
    emailService
      .sendTeamInviteEmail(targetEmail, inviterName, org?.company_name || 'your team', rawToken)
      .catch(() => {});

    return res.status(200).json({
      success: true,
      message: INVITE_GENERIC_MESSAGE,
    });
  } catch (error) {
    next(error);
  }
};

// ─── ACCEPT INVITE ───────────────────────────────────────────────────────────

exports.acceptInvite = async (req, res, next) => {
  try {
    const { token } = req.body;

    if (!token || typeof token !== 'string') {
      return res.status(400).json({ success: false, error: 'Invite token is required.' });
    }

    const tokenHash = hashInviteToken(token);
    const invite = await prisma.invite_tokens.findUnique({
      where: { token_hash: tokenHash },
    });

    if (!invite) {
      return res.status(400).json({ success: false, error: 'Invalid or expired invitation.' });
    }
    if (invite.accepted_at) {
      return res.status(400).json({ success: false, error: 'This invitation has already been accepted.' });
    }
    if (new Date() > invite.expires_at) {
      return res.status(400).json({ success: false, error: 'This invitation has expired.' });
    }

    // The logged-in user must match the invite email
    const userEmail = req.user.email.toLowerCase();
    if (userEmail !== invite.email.toLowerCase()) {
      return res.status(403).json({
        success: false,
        error: 'This invitation was sent to a different email address.',
      });
    }

    // Create membership in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Mark invite as accepted
      await tx.invite_tokens.update({
        where: { id: invite.id },
        data: { accepted_at: new Date() },
      });

      // Upsert membership (in case they were previously removed)
      const membership = await tx.organization_members.upsert({
        where: {
          organization_id_user_id: {
            organization_id: invite.organization_id,
            user_id: req.user.id,
          },
        },
        update: {
          role: invite.role,
          status: 'active',
          joined_at: new Date(),
        },
        create: {
          organization_id: invite.organization_id,
          user_id: req.user.id,
          role: invite.role,
          status: 'active',
          invited_by: invite.invited_by,
          invited_at: invite.created_at,
          joined_at: new Date(),
        },
      });

      return membership;
    });

    return res.status(200).json({
      success: true,
      message: 'Invitation accepted. You are now a member of this organization.',
      data: {
        organizationId: invite.organization_id,
        role: result.role,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ─── LIST MEMBERS ────────────────────────────────────────────────────────────

exports.listMembers = async (req, res, next) => {
  try {
    const { organizationId } = req.orgMembership;

    const members = await prisma.organization_members.findMany({
      where: { organization_id: organizationId, status: 'active' },
      select: {
        id: true,
        role: true,
        status: true,
        invited_at: true,
        joined_at: true,
        created_at: true,
        users: {
          select: { id: true, full_name: true, email: true },
        },
      },
      orderBy: { created_at: 'asc' },
    });

    return res.status(200).json({
      success: true,
      data: {
        members: members.map((m) => ({
          membershipId: m.id,
          role: m.role,
          status: m.status,
          user: m.users,
          invitedAt: m.invited_at,
          joinedAt: m.joined_at,
          createdAt: m.created_at,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
};

// ─── REMOVE MEMBER ───────────────────────────────────────────────────────────

exports.removeMember = async (req, res, next) => {
  try {
    const { memberId } = req.params;
    const { organizationId, role: callerRole, membershipId: callerMembershipId } = req.orgMembership;

    if (memberId === callerMembershipId) {
      return res.status(400).json({
        success: false,
        error: 'You cannot remove yourself. Use "leave organization" instead.',
      });
    }

    const targetMember = await prisma.organization_members.findUnique({
      where: { id: memberId },
    });

    if (!targetMember || targetMember.organization_id !== organizationId) {
      return res.status(404).json({ success: false, error: 'Member not found.' });
    }

    // Only owner can remove admins; admin can remove members
    if (targetMember.role === 'owner') {
      return res.status(403).json({ success: false, error: 'Cannot remove the organization owner.' });
    }
    if (targetMember.role === 'admin' && callerRole !== 'owner') {
      return res.status(403).json({ success: false, error: 'Only the owner can remove admins.' });
    }

    await prisma.organization_members.update({
      where: { id: memberId },
      data: { status: 'removed', updated_at: new Date() },
    });

    // Revoke all refresh tokens for the removed user (instant session kill)
    await prisma.refresh_tokens.deleteMany({
      where: { user_id: targetMember.user_id },
    });

    return res.status(200).json({
      success: true,
      message: 'Member removed from the organization.',
    });
  } catch (error) {
    next(error);
  }
};

// ─── UPDATE MEMBER ROLE ──────────────────────────────────────────────────────

exports.updateMemberRole = async (req, res, next) => {
  try {
    const { memberId } = req.params;
    const { role } = req.body;
    const { organizationId, role: callerRole } = req.orgMembership;

    if (!role || !['admin', 'member'].includes(role)) {
      return res.status(400).json({
        success: false,
        error: 'Role must be one of: admin, member.',
      });
    }

    if (callerRole !== 'owner') {
      return res.status(403).json({
        success: false,
        error: 'Only the organization owner can change member roles.',
      });
    }

    const targetMember = await prisma.organization_members.findUnique({
      where: { id: memberId },
    });

    if (!targetMember || targetMember.organization_id !== organizationId) {
      return res.status(404).json({ success: false, error: 'Member not found.' });
    }

    if (targetMember.role === 'owner') {
      return res.status(403).json({ success: false, error: 'Cannot change the owner role.' });
    }

    await prisma.organization_members.update({
      where: { id: memberId },
      data: { role, updated_at: new Date() },
    });

    return res.status(200).json({
      success: true,
      message: `Member role updated to ${role}.`,
    });
  } catch (error) {
    next(error);
  }
};
